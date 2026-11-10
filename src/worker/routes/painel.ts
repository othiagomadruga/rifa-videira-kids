/**
 * Painel e ranking da coordenação (RIFA-PAINEL; docs/api.md, Sprint 3), do grupo `coordenacao`:
 * - GET /api/painel/resumo: meta do dia, ritmo do período e da campanha, projeção, curva e vendas de um
 *   escopo (campanha, divisão, rede, discipulador ou célula);
 * - GET /api/painel/ranking: todas as instâncias do nível, com valores, situação e vizinhos.
 *
 * Caminhos e schemas vêm do contrato (`ROTAS`). Este sub-app NÃO autentica: o index.ts o monta sob
 * /api/painel, depois do login da coordenação (passo 4): `app.route(PREFIXO_PAINEL, painel)`.
 * A regra é toda de calculos.ts: a rota valida a consulta, lê o banco (db/painel.ts) e devolve o que o
 * montador entrega, como está. As respostas têm valores: saem com `Cache-Control: no-store` e nunca passam
 * pelo cache das rotas abertas (lib/cache-publico.ts).
 */
import { Hono } from "hono";
import {
  ROTAS,
  montarRankingPainel,
  montarResumoPainel,
} from "../../shared/contracts";
import {
  lerEntradaDoCalculo,
  relogioDoSistema,
  type Relogio,
} from "../db/painel";
import { responderErro } from "../lib/respostas-erro";
import { validarConsulta } from "../middleware/validacao";

type Ambiente = { Bindings: Cloudflare.Env };

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_PAINEL = "/api/painel";

type CaminhoLocal<T extends string> =
  T extends `${typeof PREFIXO_PAINEL}${infer Resto}` ? Resto : never;

/** Caminho de ROTAS sem o prefixo de montagem ("/api/painel/resumo" → "/resumo"). */
function local<T extends `${typeof PREFIXO_PAINEL}/${string}`>(
  caminho: T,
): CaminhoLocal<T> {
  return caminho.slice(PREFIXO_PAINEL.length) as CaminhoLocal<T>;
}

/**
 * Os montadores do contrato que o painel usa. Injetáveis, como os das rotas abertas (routes/publico.ts): o teste de
 * desempenho (painel-desempenho.test.ts) conta o trabalho de cada requisição. Em produção, os de calculos.ts.
 */
export const MONTADORES_DO_PAINEL = { montarResumoPainel, montarRankingPainel };
export type MontadoresDoPainel = typeof MONTADORES_DO_PAINEL;

/** O sub-app com o relógio dado (os testes fixam o instante; em produção, o do sistema). */
export function criarPainel(
  relogio: Relogio = relogioDoSistema,
  montadores: MontadoresDoPainel = MONTADORES_DO_PAINEL,
) {
  const painel = new Hono<Ambiente>();

  // Valores da coordenação nunca ficam em cache (o login também marca no-store; aqui vale até no erro).
  painel.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  painel.get(
    local(ROTAS.painelResumo.caminho),
    validarConsulta(ROTAS.painelResumo.consulta),
    async (c) => {
      const consulta = c.req.valid("query");
      const lido = await lerEntradaDoCalculo(c.env.DB, relogio, {
        data: consulta.data,
        escopo: consulta,
      });
      if (!lido.ok)
        return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
      return c.json(
        montadores.montarResumoPainel(
          lido.entrada,
          { escopo: lido.escopo, data: consulta.data },
          lido.agora,
        ),
      );
    },
  );

  painel.get(
    local(ROTAS.painelRanking.caminho),
    validarConsulta(ROTAS.painelRanking.consulta),
    async (c) => {
      const consulta = c.req.valid("query");
      const lido = await lerEntradaDoCalculo(c.env.DB, relogio, {
        data: consulta.data,
      });
      if (!lido.ok)
        return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
      return c.json(
        montadores.montarRankingPainel(lido.entrada, consulta, lido.agora),
      );
    },
  );

  return painel;
}

/** O sub-app de produção (relógio do sistema). */
export const painel = criarPainel();
