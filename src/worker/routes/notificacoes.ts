/**
 * As notificações de venda (RIFA-095, D43; ROTAS_NOTIFICACOES do contrato), ABERTAS como as de /api/publico: quem
 * quiser recebe, sem login. O index.ts monta este sub-app em /api/publico/notificacoes ANTES do sub-app de
 * /api/publico (assim o cache e o Cache-Control de lá não valem aqui).
 *
 * - GET /: o estado para o botão "Avisos no celular": `ligadas` (as chaves VAPID no servidor, uma campanha ativa
 *   e a opção `notificacoes.vendas` ligada) e a chave VAPID pública. Igual para todos: cache de 30 s como as rotas
 *   abertas (lib/cache-publico.ts) e o limite por IP só nas idas ao banco.
 * - POST /inscrever e /cancelar: só da mesma origem (403), o limite por IP (429; toda requisição conta), o corpo até
 *   LIMITE_CORPO_NOTIFICACOES_BYTES (413) e o schema do contrato (400; o endpoint de fora da lista de serviços de push
 *   também, contra SSRF, sem ecoar o valor). A inscrição: 503 `nao_configurado` sem as chaves VAPID (antes de ler o
 *   corpo), 409 `acao_desligada` sem campanha ativa ou com a opção desligada, 400 com a chave do aparelho que não é um
 *   ponto da P-256; senão grava (ou troca, pelo endpoint) e responde 204. O cancelamento apaga e responde 204, exista a
 *   inscrição ou não (não diz se o endpoint estava lá).
 * - Erros e POSTs com `no-store`. O endpoint nunca vai para log, resposta ou trilha.
 */
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import {
  ROTAS_NOTIFICACOES,
  type RespostaEstadoNotificacoes,
} from "../../shared/contracts";
import {
  apagarInscricao,
  gravarInscricao,
  lerOpcaoDasNotificacoes,
} from "../db/push-inscricoes";
import {
  CACHE_PUBLICO,
  cacheDeProducao,
  chaveDoCache,
  type CacheDeRespostas,
} from "../lib/cache-publico";
import {
  LIMITE_PUBLICO,
  dentroDoLimite,
  limitarRequisicoes,
  responderLimiteExcedido,
} from "../lib/limite-requisicoes";
import { responderErro } from "../lib/respostas-erro";
import { base64UrlParaBytes, chavesVapidDoAmbiente } from "../lib/web-push";
import { limitarCorpo } from "../middleware/limite-corpo";
import { exigirMesmaOrigem } from "../middleware/sessao";
import { validarJson } from "../middleware/validacao";

type Ambiente = { Bindings: Cloudflare.Env };

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_NOTIFICACOES = "/api/publico/notificacoes";

/** O corpo da inscrição tem uns 400 bytes (o endpoint e as duas chaves). */
export const LIMITE_CORPO_NOTIFICACOES_BYTES = 4 * 1024;

const ROTA_ESTADO = ROTAS_NOTIFICACOES.estadoNotificacoes;
const ROTA_INSCREVER = ROTAS_NOTIFICACOES.inscreverNotificacoes;
const ROTA_CANCELAR = ROTAS_NOTIFICACOES.cancelarNotificacoes;

const local = (caminho: string) => caminho.slice(PREFIXO_NOTIFICACOES.length);

/** Sem as chaves VAPID no servidor: 503 `nao_configurado`, antes de ler o corpo. */
const exigirChavesVapid = createMiddleware<Ambiente>(async (c, next) => {
  if (chavesVapidDoAmbiente(c.env) === null)
    return responderErro(
      c,
      "nao_configurado",
      "As notificações de venda não estão configuradas no servidor",
    );
  await next();
});

/** A chave do aparelho é um ponto da curva P-256? (a Web Crypto recusa um ponto fora dela) */
async function chaveDoAparelhoValida(p256dh: string): Promise<boolean> {
  try {
    await crypto.subtle.importKey(
      "raw",
      base64UrlParaBytes(p256dh),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    return true;
  } catch {
    return false;
  }
}

export interface OpcoesNotificacoes {
  /** Cache do GET; padrão: o de produção (memória do isolate e `caches.default`). */
  cache?: CacheDeRespostas;
  /** "Agora" (os testes fixam). */
  relogio?: () => Date;
}

export function criarNotificacoes({
  cache = cacheDeProducao(),
  relogio = () => new Date(),
}: OpcoesNotificacoes = {}) {
  const app = new Hono<Ambiente>();

  app.use("*", async (c, next) => {
    await next();
    c.header(
      "Cache-Control",
      c.req.method === "GET" && c.res.status === 200
        ? CACHE_PUBLICO
        : "no-store",
    );
  });

  async function montarEstado(
    c: Context<Ambiente>,
  ): Promise<RespostaEstadoNotificacoes> {
    const chaves = chavesVapidDoAmbiente(c.env);
    if (chaves === null) return { ligadas: false, chave_publica: null };
    const opcao = await lerOpcaoDasNotificacoes(c.env.DB);
    return opcao === true
      ? { ligadas: true, chave_publica: chaves.publica }
      : { ligadas: false, chave_publica: null };
  }

  app.get(local(ROTA_ESTADO.caminho) || "/", async (c) => {
    const agora = relogio();
    const chave = chaveDoCache(c.req.url, {});
    const guardada = await cache.ler(chave, agora);
    if (guardada !== null) return guardada;
    if (!(await dentroDoLimite(c.env, c.req.raw, LIMITE_PUBLICO)))
      return responderLimiteExcedido(c, LIMITE_PUBLICO);
    const resposta = c.json(
      ROTA_ESTADO.sucesso.corpo.parse(await montarEstado(c)),
    );
    await cache.gravar(chave, resposta, agora);
    return resposta;
  });

  app.post(
    local(ROTA_INSCREVER.caminho),
    exigirMesmaOrigem,
    limitarRequisicoes(LIMITE_PUBLICO),
    exigirChavesVapid,
    limitarCorpo(LIMITE_CORPO_NOTIFICACOES_BYTES),
    validarJson(ROTA_INSCREVER.corpo),
    async (c) => {
      const { endpoint, chaves, origem } = c.req.valid("json");
      if ((await lerOpcaoDasNotificacoes(c.env.DB)) !== true)
        return responderErro(
          c,
          "acao_desligada",
          "As notificações de venda estão desligadas na campanha",
        );
      if (!(await chaveDoAparelhoValida(chaves.p256dh)))
        return responderErro(c, "requisicao_invalida", "Dados inválidos", [
          {
            caminho: ["chaves", "p256dh"],
            codigo: "chave_invalida",
            mensagem: "A chave do aparelho não é uma chave P-256 válida",
          },
        ]);
      await gravarInscricao(c.env.DB, {
        endpoint,
        p256dh: chaves.p256dh,
        auth: chaves.auth,
        origem,
        agora: relogio().toISOString(),
      });
      return c.body(null, 204);
    },
  );

  app.post(
    local(ROTA_CANCELAR.caminho),
    exigirMesmaOrigem,
    limitarRequisicoes(LIMITE_PUBLICO),
    limitarCorpo(LIMITE_CORPO_NOTIFICACOES_BYTES),
    validarJson(ROTA_CANCELAR.corpo),
    async (c) => {
      await apagarInscricao(c.env.DB, c.req.valid("json").endpoint);
      return c.body(null, 204);
    },
  );

  return app;
}

/** O sub-app de produção. */
export const notificacoes = criarNotificacoes();
