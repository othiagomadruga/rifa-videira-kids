/**
 * Visão pública (RIFA-PAINEL; docs/api.md, Sprint 3), do grupo `aberto`: sem login e NUNCA com valores
 * em unidades (R$, centavos ou bilhetes), com qualquer configuração da campanha (R9):
 * - GET /api/publico/ranking: posição, nome e divisão de quem já vendeu na janela (e o % da meta, se a
 *   campanha permitir), sempre na data de hoje (um `data` na URL é ignorado pelo schema);
 * - GET /api/publico/bumbo: o texto do dia para o grupo dos líderes, sobre o dia anterior já fechado.
 *
 * O index.ts monta este sub-app sob /api/publico, FORA dos prefixos do login (passo 6).
 * A regra é toda de calculos.ts. Como defesa a mais, a resposta passa pelo schema ESTRITO do contrato
 * antes de sair: um campo a mais (um valor que vazasse) vira 500 `erro_interno`, nunca chega ao público.
 * Respostas 200 saem com cache curto (`public, max-age=30`); erros, com `no-store`.
 *
 * Cache (lib/cache-publico.ts): depois da validação, a resposta 200 de cada consulta fica guardada por
 * 30 s, com a chave na URL normalizada (sem cookies nem cabeçalhos do cliente); dentro do prazo, a
 * requisição não vai ao D1. Erros nunca são guardados.
 */
import { Hono, type Context } from "hono";
import {
  ROTAS,
  montarBumbo,
  montarRankingPublico,
} from "../../shared/contracts";
import {
  lerEntradaDoCalculo,
  relogioDoSistema,
  type Relogio,
} from "../db/painel";
import {
  CACHE_PUBLICO,
  cacheDeProducao,
  chaveDoCache,
  type CacheDeRespostas,
} from "../lib/cache-publico";
import { responderErro } from "../lib/respostas-erro";
import { validarConsulta } from "../middleware/validacao";

export { CACHE_PUBLICO };

type Ambiente = { Bindings: Cloudflare.Env };

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_PUBLICO = "/api/publico";

type CaminhoLocal<T extends string> =
  T extends `${typeof PREFIXO_PUBLICO}${infer Resto}` ? Resto : never;

/** Caminho de ROTAS sem o prefixo de montagem ("/api/publico/bumbo" → "/bumbo"). */
function local<T extends `${typeof PREFIXO_PUBLICO}/${string}`>(
  caminho: T,
): CaminhoLocal<T> {
  return caminho.slice(PREFIXO_PUBLICO.length) as CaminhoLocal<T>;
}

/** Os montadores do contrato que as rotas abertas usam. */
const MONTADORES = { montarRankingPublico, montarBumbo };

export interface OpcoesPublico {
  /** "Agora" (os testes fixam o instante); padrão: o relógio do sistema. */
  relogio?: Relogio;
  /** Injetáveis para o teste provar que uma resposta fora do schema estrito não sai. */
  montadores?: typeof MONTADORES;
  /** Cache das respostas 200; padrão: o de produção (memória do isolate e `caches.default`). */
  cache?: CacheDeRespostas;
}

export function criarPublico({
  relogio = relogioDoSistema,
  montadores = MONTADORES,
  cache = cacheDeProducao(),
}: OpcoesPublico = {}) {
  const publico = new Hono<Ambiente>();

  publico.use("*", async (c, next) => {
    await next();
    c.header(
      "Cache-Control",
      c.res.status === 200 ? CACHE_PUBLICO : "no-store",
    );
  });

  /**
   * A resposta da consulta já validada: a guardada, se estiver no prazo (sem ir ao banco); senão, a que
   * `montar` gerar agora, que fica guardada se for 200. Um só instante por requisição: o do cache é o
   * mesmo `agora` dos montadores.
   */
  async function comCache(
    c: Context<Ambiente>,
    consulta: Readonly<Record<string, string | undefined>>,
    montar: (agora: Date) => Promise<Response>,
  ): Promise<Response> {
    const agora = relogio();
    const chave = chaveDoCache(c.req.url, consulta);
    const guardada = await cache.ler(chave, agora);
    if (guardada !== null) return guardada;
    const resposta = await montar(agora);
    await cache.gravar(chave, resposta, agora);
    return resposta;
  }

  publico.get(
    local(ROTAS.rankingPublico.caminho),
    validarConsulta(ROTAS.rankingPublico.consulta),
    (c) => {
      const consulta = c.req.valid("query");
      return comCache(c, consulta, async (agora) => {
        const lido = await lerEntradaDoCalculo(c.env.DB, () => agora);
        if (!lido.ok)
          return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
        return c.json(
          ROTAS.rankingPublico.sucesso.corpo.parse(
            montadores.montarRankingPublico(lido.entrada, consulta, lido.agora),
          ),
        );
      });
    },
  );

  publico.get(
    local(ROTAS.bumbo.caminho),
    validarConsulta(ROTAS.bumbo.consulta),
    (c) => {
      const consulta = c.req.valid("query");
      const { data } = consulta;
      return comCache(c, consulta, async (agora) => {
        const lido = await lerEntradaDoCalculo(c.env.DB, () => agora, {
          data,
        });
        if (!lido.ok)
          return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
        return c.json(
          ROTAS.bumbo.sucesso.corpo.parse(
            montadores.montarBumbo(lido.entrada, { data }, lido.agora),
          ),
        );
      });
    },
  );

  return publico;
}

/** O sub-app de produção (relógio do sistema e cache de produção). */
export const publico = criarPublico();
