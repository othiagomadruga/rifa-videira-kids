/**
 * Painel e ranking da coordenação (RIFA-PAINEL; docs/api.md, Sprint 3), do grupo `coordenacao`:
 * - GET /api/painel/resumo: meta do dia, ritmo do período e da campanha, projeção, curva e vendas de um
 *   escopo (campanha, divisão, grupo, rede, discipulador ou célula; o grupo, RIFA-092, pelo grupo efetivo da célula);
 * - GET /api/painel/ranking: todas as instâncias do nível, com valores, situação e vizinhos;
 * - GET /api/painel/ranking-grupos (RIFA-084, D39): o mesmo ranking separado pelo grupo do discipulador (adultos da
 *   manhã, adultos da noite, jovens, adolescentes), com a posição dentro do grupo; no nível célula, vale o grupo próprio
 *   da célula quando há (RIFA-085). Só a coordenação (o ranking aberto não muda). Os grupos vão no mesmo lote da
 *   leitura (db/grupos.ts): uma ida a mais, nenhuma;
 * - GET /api/painel/mapa-ddd (RIFA-015, D17): as vendas da janela por UF e DDD do comprador, mais exterior e sem
 *   DDD. Mesma janela e mesmo filtro de venda do painel (R6): db/mapa-ddd.ts lê, lib/mapa-ddd.ts monta;
 * - GET /api/painel/relatorio (RIFA-038, D23): o relatório da campanha para baixar, um CSV por tipo, das MESMAS
 *   leituras e montadores do painel, dos rankings e do mapa (lib/relatorio.ts monta as linhas; db/relatorio.ts tem os
 *   dois comandos a mais do lote). Catálogo `ROTAS_RELATORIO`.
 *
 * Caminhos e schemas vêm do contrato (`ROTAS`). Este sub-app NÃO autentica: o index.ts o monta sob
 * /api/painel, depois do login da coordenação (passo 4): `app.route(PREFIXO_PAINEL, painel)`.
 * A regra do resumo e do ranking é toda de calculos.ts: a rota valida a consulta, lê o banco (db/painel.ts) e
 * devolve o que o montador entrega, como está. As respostas têm valores: saem com `Cache-Control: no-store` e nunca passam
 * pelo cache das rotas abertas (lib/cache-publico.ts).
 */
import { Hono } from "hono";
import {
  ROTAS,
  ROTAS_RELATORIO,
  cabecalhosDoRelatorio,
  montarRankingGruposPainel,
  montarRankingPainel,
  montarResumoPainel,
} from "../../shared/contracts";
import { lerBilhete, lerBilhetes } from "../db/bilhetes";
import { comandosDosGrupos, gruposDoRanking } from "../db/grupos";
import { lerMapaDdd } from "../db/mapa-ddd";
import {
  lerEntradaDoCalculo,
  relogioDoSistema,
  type Relogio,
} from "../db/painel";
import { comandosDoRelatorio, extrasDoRelatorio } from "../db/relatorio";
import { montarMapaDdd } from "../lib/mapa-ddd";
import { arquivoDoDdd, arquivoDoPainel } from "../lib/relatorio";
import { responderErro } from "../lib/respostas-erro";
import { validarConsulta, validarParametros } from "../middleware/validacao";

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
export const MONTADORES_DO_PAINEL = Object.freeze({
  montarResumoPainel,
  montarRankingPainel,
});
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

  // Ranking por grupo (RIFA-084, D39): 400 consulta inválida; 404 sem campanha ativa; 200 (`grupos: []` sem grupo com
  // células). A resposta passa pelo schema estrito do contrato antes de sair (um campo a mais vira 500).
  painel.get(
    local(ROTAS.painelRankingGrupos.caminho),
    validarConsulta(ROTAS.painelRankingGrupos.consulta),
    async (c) => {
      const consulta = c.req.valid("query");
      const lido = await lerEntradaDoCalculo(
        c.env.DB,
        relogio,
        {},
        comandosDosGrupos,
      );
      if (!lido.ok)
        return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
      return c.json(
        ROTAS.painelRankingGrupos.sucesso.corpo.parse(
          montarRankingGruposPainel(
            lido.entrada,
            gruposDoRanking(lido.extras[0]),
            consulta,
            lido.agora,
          ),
        ),
      );
    },
  );

  painel.get(
    local(ROTAS.mapaDdd.caminho),
    validarConsulta(ROTAS.mapaDdd.consulta),
    async (c) => {
      const consulta = c.req.valid("query");
      const lido = await lerMapaDdd(c.env.DB, relogio, consulta);
      if (!lido.ok) return responderErro(c, lido.codigo, lido.mensagem);
      return c.json(
        montarMapaDdd(lido.linhas, {
          janela: lido.janela,
          divisao: consulta.divisao,
          agora: lido.agora,
        }),
      );
    },
  );

  // Bilhetes pagos, reservados e livres (RIFA-075, D35): a grade em mapas de bits e a busca por número.
  painel.get(local(ROTAS.painelBilhetes.caminho), async (c) => {
    const lido = await lerBilhetes(c.env.DB, relogio);
    if (!lido.ok) return responderErro(c, lido.codigo, lido.mensagem);
    return c.json(lido.resposta);
  });

  painel.get(
    local(ROTAS.painelBilhete.caminho),
    validarParametros(ROTAS.painelBilhete.parametros),
    async (c) => {
      const { numero } = c.req.valid("param");
      const lido = await lerBilhete(c.env.DB, relogio, numero);
      if (!lido.ok) return responderErro(c, lido.codigo, lido.mensagem);
      return c.json(lido.resposta);
    },
  );

  // Relatório (D23): 400 sem `tipo` ou fora da lista (validarConsulta); 404 sem campanha ativa, antes de montar
  // qualquer coisa (a leitura devolve antes do lote); 200 com o CSV e TODOS os cabeçalhos do contrato. Duas idas ao D1
  // por download em todos os tipos; sem cache (o no-store acima vale também nos erros).
  painel.get(
    local(ROTAS_RELATORIO.baixarRelatorio.caminho),
    validarConsulta(ROTAS_RELATORIO.baixarRelatorio.consulta),
    async (c) => {
      const { tipo } = c.req.valid("query");
      if (tipo === "ddd") {
        const lido = await lerMapaDdd(c.env.DB, relogio, {
          periodo: "campanha",
        });
        if (!lido.ok) return responderErro(c, lido.codigo, lido.mensagem);
        const mapa = montarMapaDdd(lido.linhas, {
          janela: lido.janela,
          divisao: undefined,
          agora: lido.agora,
        });
        return c.body(
          arquivoDoDdd(mapa),
          200,
          cabecalhosDoRelatorio(tipo, lido.hoje),
        );
      }
      const lido = await lerEntradaDoCalculo(
        c.env.DB,
        relogio,
        {},
        comandosDoRelatorio(tipo),
      );
      if (!lido.ok)
        return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
      const arquivo = arquivoDoPainel(
        tipo,
        lido,
        extrasDoRelatorio(tipo, lido.extras),
        montadores,
      );
      return c.body(
        arquivo.csv,
        200,
        cabecalhosDoRelatorio(tipo, arquivo.data),
      );
    },
  );

  return painel;
}

/** O sub-app de produção (relógio do sistema). */
export const painel = criarPainel();
