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
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { z } from "zod";
import {
  ROTAS,
  detalhesDeValidacao,
  montarBumbo,
  montarRankingPublico,
} from "../../shared/contracts";
import {
  lerEntradaDoCalculo,
  relogioDoSistema,
  type Relogio,
} from "../db/painel";
import { mensagemDeCampo } from "../lib/mensagens-validacao";
import { responderErro } from "../lib/respostas-erro";

type Ambiente = { Bindings: Cloudflare.Env };

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_PUBLICO = "/api/publico";

/** Cache das respostas 200: curto, porque o ranking muda a cada venda. */
export const CACHE_PUBLICO = "public, max-age=30";

type CaminhoLocal<T extends string> =
  T extends `${typeof PREFIXO_PUBLICO}${infer Resto}` ? Resto : never;

/** Caminho de ROTAS sem o prefixo de montagem ("/api/publico/bumbo" → "/bumbo"). */
function local<T extends `${typeof PREFIXO_PUBLICO}/${string}`>(
  caminho: T,
): CaminhoLocal<T> {
  return caminho.slice(PREFIXO_PUBLICO.length) as CaminhoLocal<T>;
}

/** Consulta pelo schema do contrato; fora dele, 400 `requisicao_invalida` com os problemas em português. */
function validarConsulta<S extends z.ZodType>(schema: S) {
  return zValidator("query", schema, async (resultado, c) => {
    if (resultado.success) return;
    const emPortugues = await schema.safeParseAsync(resultado.data, {
      error: mensagemDeCampo,
    });
    const erro = emPortugues.success ? resultado.error : emPortugues.error;
    return responderErro(
      c,
      "requisicao_invalida",
      "Consulta inválida",
      detalhesDeValidacao(erro),
    );
  });
}

/** Os montadores do contrato que as rotas abertas usam. */
const MONTADORES = { montarRankingPublico, montarBumbo };

/**
 * O sub-app com o relógio dado (os testes fixam o instante; em produção, o do sistema). Os montadores
 * também são injetáveis, para o teste provar que uma resposta fora do schema estrito não sai.
 */
export function criarPublico(
  relogio: Relogio = relogioDoSistema,
  montadores: typeof MONTADORES = MONTADORES,
) {
  const publico = new Hono<Ambiente>();

  publico.use("*", async (c, next) => {
    await next();
    c.header(
      "Cache-Control",
      c.res.status === 200 ? CACHE_PUBLICO : "no-store",
    );
  });

  publico.get(
    local(ROTAS.rankingPublico.caminho),
    validarConsulta(ROTAS.rankingPublico.consulta),
    async (c) => {
      const lido = await lerEntradaDoCalculo(c.env.DB, relogio);
      if (!lido.ok)
        return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
      return c.json(
        ROTAS.rankingPublico.sucesso.corpo.parse(
          montadores.montarRankingPublico(
            lido.entrada,
            c.req.valid("query"),
            lido.agora,
          ),
        ),
      );
    },
  );

  publico.get(
    local(ROTAS.bumbo.caminho),
    validarConsulta(ROTAS.bumbo.consulta),
    async (c) => {
      const { data } = c.req.valid("query");
      const lido = await lerEntradaDoCalculo(c.env.DB, relogio, { data });
      if (!lido.ok)
        return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
      return c.json(
        ROTAS.bumbo.sucesso.corpo.parse(
          montadores.montarBumbo(lido.entrada, { data }, lido.agora),
        ),
      );
    },
  );

  return publico;
}

/** O sub-app de produção (relógio do sistema). */
export const publico = criarPublico();
