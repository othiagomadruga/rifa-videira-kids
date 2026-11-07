/**
 * Visão pública (RIFA-PAINEL; docs/api.md, Sprint 3), do grupo `aberto`: sem login e NUNCA com valores
 * em unidades (R$, centavos ou bilhetes), com qualquer configuração da campanha (R9):
 * - GET /api/publico/ranking: posição, nome e divisão de quem já vendeu na janela (e o % da meta, se a
 *   campanha permitir), sempre na data de hoje (um `data` na URL é ignorado pelo schema);
 * - GET /api/publico/bumbo: o texto do dia para o grupo dos líderes, sobre o dia anterior já fechado;
 *   um `data` informado só vale na janela da campanha (do 1º dia ao dia seguinte ao último).
 *
 * O index.ts monta este sub-app sob /api/publico, FORA dos prefixos do login (passo 6).
 * A regra é toda de calculos.ts. Como defesa a mais, a resposta passa pelo schema ESTRITO do contrato
 * antes de sair: um campo a mais (um valor que vazasse) vira 500 `erro_interno`, nunca chega ao público.
 * Respostas 200 saem com cache curto (`public, max-age=30`); erros, com `no-store`.
 *
 * Cache (lib/cache-publico.ts): depois da validação, a resposta 200 de cada consulta fica guardada por
 * 30 s, com a chave na URL normalizada (sem cookies nem cabeçalhos do cliente); dentro do prazo, a
 * requisição não vai ao D1. Erros nunca são guardados. No bumbo, a janela do `data` limita as chaves às
 * datas que têm mensagem (algumas dezenas): uma data qualquer não enche o cache nem lê as vendas.
 */
import { Hono, type Context } from "hono";
import {
  DIAS_DO_BUMBO_DEPOIS_DO_FIM,
  ROTAS,
  calcularCalendario,
  diasEntre,
  montarBumbo,
  montarRankingPublico,
  somarDias,
  type DetalheValidacao,
} from "../../shared/contracts";
import { buscarCampanhaAtiva } from "../db/campanha";
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
import {
  LIMITE_PUBLICO,
  dentroDoLimite,
  responderLimiteExcedido,
} from "../lib/limite-requisicoes";
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

/** Código do detalhe do 400 quando o `data` do bumbo sai da janela da campanha. */
export const CODIGO_FORA_DA_CAMPANHA = "fora_da_campanha";

/** "2026-11-23" → "23/11/2026" (data local, sem fuso). */
const dataPorExtenso = (data: string) =>
  `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`;

/**
 * O `data` do bumbo fora da janela da campanha, do 1º dia ao dia seguinte ao último
 * (DIAS_DO_BUMBO_DEPOIS_DO_FIM): o detalhe do 400, ou null quando a data está dentro. Lê só a campanha
 * (um comando pequeno), ANTES das vendas: a data fora da janela não chega aos pedidos e, como é erro,
 * não entra no cache. Sem campanha ativa também devolve null: o 404 é da leitura que vem em seguida.
 */
async function foraDaJanelaDoBumbo(
  db: D1Database,
  data: string,
): Promise<DetalheValidacao | null> {
  const ativa = await buscarCampanhaAtiva(db);
  if (!ativa) return null;
  const inicio = ativa.data_inicio;
  const ate = somarDias(
    calcularCalendario(inicio, ativa.periodos).data_fim,
    DIAS_DO_BUMBO_DEPOIS_DO_FIM,
  );
  if (diasEntre(inicio, data) >= 0 && diasEntre(data, ate) >= 0) return null;
  return {
    caminho: ["data"],
    codigo: CODIGO_FORA_DA_CAMPANHA,
    mensagem: `A data precisa estar entre ${dataPorExtenso(inicio)} e ${dataPorExtenso(ate)} (do 1º dia da campanha ao dia seguinte ao último)`,
  };
}

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
   *
   * Limite por IP (RIFA-013b, LIMITE_PUBLICO): só a ida ao banco conta. A resposta guardada sai sem contar
   * (muita gente no mesmo IP vê o ranking sem esbarrar no limite); acima dele, 429 sem ler o banco.
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
    if (!(await dentroDoLimite(c.env, c.req.raw, LIMITE_PUBLICO)))
      return responderLimiteExcedido(c, LIMITE_PUBLICO);
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
        // Sem `data` (hoje), vale em qualquer fase; com `data`, só na janela (uma ida a mais, pequena).
        const fora =
          data === undefined ? null : await foraDaJanelaDoBumbo(c.env.DB, data);
        if (fora)
          return responderErro(c, "requisicao_invalida", fora.mensagem, [fora]);
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
