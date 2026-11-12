// RIFA-038 (D23, OBRIGATÓRIO 4; D10): o orçamento do D1 do relatório para baixar, com o volume sintético dos testes
// de desempenho do painel (painel-apoio.ts: 36 células × 24 dias, 6.939 pedidos aprovados; "agora" no dia 20 de 24,
// como em painel-desempenho.test.ts). Travas exatas, que não dependem da máquina:
// - duas idas ao D1 por download em TODOS os tipos (a campanha ativa e um lote; no `ddd`, a campanha e a consulta do
//   mapa), sem N+1: os comandos a mais (os líderes em `celulas`, a contagem em `totais`) vão no lote do painel;
// - as linhas lidas no D1 (`meta.rows_read`, da requisição inteira) de cada tipo, abaixo do teto (o medido + 10%) e
//   da ordem de grandeza da D23 (~1,3 por pedido aprovado nos seis tipos do painel; ~2 por aprovado da janela no
//   `ddd`, o mesmo que o mapa);
// - o plano da contagem dos desconsiderados, pelo índice parcial da 0008, e ~1 linha lida por desconsiderado.
// Nenhum índice novo, e os planos do painel e do mapa continuam travados em painel.test.ts e mapa-ddd-desempenho.test.ts.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { TIPOS_RELATORIO, type TipoRelatorio } from "../../shared/contracts";
import { CONTAR_DESCONSIDERADOS, SELECIONAR_LIDERES } from "../db/relatorio";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import { bancoQueRegistra } from "../test/banco-que-registra";
import {
  CAMPANHA_DE_CARGA,
  bancoQueConta,
  limparBanco,
  semearCampanha,
  semearHierarquiaDeCarga,
  semearPedidosDeCarga,
} from "../test/painel-apoio";
import { textoDoCsv } from "../test/relatorio-apoio";
import { PREFIXO_PAINEL, criarPainel } from "./painel";

/** Dia 20 de 24, às 12:00 em Belém: a campanha até hoje são os dias 23/11 a 12/12. */
const AGORA = new Date("2026-12-12T15:00:00.000Z");

const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.route(
  PREFIXO_PAINEL,
  criarPainel(() => AGORA),
);
app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

/**
 * Linhas lidas por download, medidas em 2026-11-12 com este volume (a requisição inteira: a campanha ativa, 4 linhas,
 * e o lote; ou a campanha e a consulta do mapa). Os seis tipos do painel leem o mesmo lote do painel (8.876 linhas, 1,28
 * por pedido aprovado, o número da D23), mais as 36 dos líderes em `celulas` e a contagem em `totais` (nenhuma linha
 * sem desconsiderado); o `ddd`, 2,0 por aprovado da janela (5.636 aprovados até hoje), como o mapa. O teto é o medido +
 * 10%: passar dele falha. Se a leitura ficar mais barata (ou o volume mudar), atualize o medido.
 */
const LINHAS_MEDIDAS: Record<TipoRelatorio, number> = {
  totais: 8880,
  celulas: 8916,
  discipuladores: 8880,
  redes: 8880,
  periodos: 8880,
  dias: 8880,
  ddd: 11277,
};
const FOLGA = 1.1;
/** A ordem de grandeza da D23, por pedido aprovado (painel) e por aprovado da janela (ddd), com a folga dos testes do painel e do mapa. */
const LIMITE_POR_APROVADO_NO_PAINEL = 1.5;
const LIMITE_POR_APROVADO_NO_DDD = 2.2;
/** A campanha ativa (~4 linhas) e os 36 líderes. */
const FOLGA_FIXA = 100;

let campanhaId: number;
let aprovados: number;
let aprovadosNaJanela: number;

beforeAll(async () => {
  await limparBanco();
  await semearHierarquiaDeCarga();
  campanhaId = await semearCampanha(env.DB, CAMPANHA_DE_CARGA);
  aprovados = await semearPedidosDeCarga(env.DB, campanhaId, 8);
  // Telefones (só país e DDD) em todos: o mapa tem linhas por DDD. Não muda nenhuma leitura do painel.
  await env.DB.prepare(
    `UPDATE pedidos SET pais = '55',
       ddd = CASE abs(unicode(substr(id, -1))) % 4 WHEN 0 THEN '91' WHEN 1 THEN '11' WHEN 2 THEN '61' ELSE NULL END`,
  ).run();
  const naJanela = await env.DB.prepare(
    `SELECT count(*) AS total FROM pedidos
     WHERE status = 'approved' AND aprovado_em >= '2026-11-23T03:00:00.000Z' AND aprovado_em < '2026-12-13T03:00:00.000Z'`,
  ).first<{ total: number }>();
  aprovadosNaJanela = naJanela!.total;
}, 60_000);

async function baixar(tipo: TipoRelatorio, db: D1Database) {
  const res = await app.request(
    `/api/painel/relatorio?tipo=${tipo}`,
    {},
    { ...env, DB: db },
  );
  expect({ tipo, status: res.status }).toEqual({ tipo, status: 200 });
  return textoDoCsv(res);
}

/** Idas ao D1 e linhas lidas (a requisição inteira) de um download. */
async function medir(tipo: TipoRelatorio) {
  const { db, contagem } = bancoQueConta();
  const csv = await baixar(tipo, db);
  return { idas: contagem.idas, linhas: contagem.linhasLidasTotal, csv };
}

it("o volume é o dos testes de desempenho do painel (6.939 aprovados; 5.636 na janela até hoje)", () => {
  expect(aprovados).toBe(6939);
  expect(aprovadosNaJanela).toBe(5636);
});

describe("cada download: duas idas ao D1 e as linhas lidas no teto", () => {
  const medidas: string[] = [];

  it.each(TIPOS_RELATORIO)("%s", async (tipo) => {
    const { idas, linhas } = await medir(tipo);

    expect({ tipo, idas }).toEqual({ tipo, idas: 2 });
    const porAprovado =
      tipo === "ddd" ? linhas / aprovadosNaJanela : linhas / aprovados;
    expect({
      tipo,
      linhas,
      dentroDaOrdemDaD23:
        linhas <=
        (tipo === "ddd"
          ? LIMITE_POR_APROVADO_NO_DDD * aprovadosNaJanela
          : LIMITE_POR_APROVADO_NO_PAINEL * aprovados) +
          FOLGA_FIXA,
      dentroDoTeto: linhas <= Math.ceil(FOLGA * LINHAS_MEDIDAS[tipo]),
    }).toEqual({
      tipo,
      linhas,
      dentroDaOrdemDaD23: true,
      dentroDoTeto: true,
    });
    medidas.push(
      `${tipo.padEnd(15)} ${String(linhas).padStart(6)} linhas lidas (${porAprovado.toFixed(2)} por aprovado${tipo === "ddd" ? " da janela" : ""}); teto ${Math.ceil(FOLGA * LINHAS_MEDIDAS[tipo])}`,
    );
    if (medidas.length === TIPOS_RELATORIO.length)
      console.log(
        [
          `RIFA-038: relatório, ${aprovados} pedidos aprovados (${aprovadosNaJanela} na janela até hoje)`,
          ...medidas,
        ].join("\n"),
      );
  });
});

describe("os comandos a mais do lote", () => {
  it("os líderes: só em `celulas`, uma linha lida por célula", async () => {
    for (const tipo of TIPOS_RELATORIO) {
      const { db, comandos } = bancoQueRegistra();
      await baixar(tipo, db);
      const lideres = comandos.filter(
        (comando) => comando.sql === SELECIONAR_LIDERES,
      );
      const contagem = comandos.filter(
        (comando) => comando.sql === CONTAR_DESCONSIDERADOS,
      );
      expect({
        tipo,
        lideres: lideres.map((comando) => comando.lidas),
        contagem: contagem.length,
      }).toEqual({
        tipo,
        lideres: tipo === "celulas" ? [36] : [],
        contagem: tipo === "totais" ? 1 : 0,
      });
    }
  });

  it("a contagem dos desconsiderados: pelo índice parcial da 0008 (campanha_id=?), ~1 linha lida por desconsiderado, e cada desconsiderado sai da leitura do painel", async () => {
    const plano = await env.DB.prepare(
      `EXPLAIN QUERY PLAN ${CONTAR_DESCONSIDERADOS}`,
    )
      .bind(campanhaId)
      .all<{ detail: string }>();
    // O índice é parcial (WHERE desconsiderado_em IS NOT NULL) e não tem a coluna: o SQLite não marca o plano como
    // COVERING (ele só tira do que falta ler os termos `coluna = constante` do índice parcial), mas o D1 conta
    // as linhas do índice percorridas (medido abaixo): ~1 por desconsiderado.
    expect(plano.results.map((linha) => linha.detail)).toEqual([
      "SEARCH pedidos USING INDEX pedidos_desconsiderados_por_registro (campanha_id=?)",
    ]);

    const antes = await medir("totais");
    // 1 de cada 10 pedidos com afiliado (como o teste D20 do painel): cada célula continua com venda em todo dia.
    const { meta } = await env.DB.prepare(
      `UPDATE pedidos SET desconsiderado_em = '2026-12-01T12:00:00.000Z', desconsiderado_motivo = 'teste'
       WHERE id GLOB 'CARGA-*0' AND affiliate_id IS NOT NULL`,
    ).run();
    const desconsiderados = meta.changes;
    try {
      expect(desconsiderados).toBeGreaterThan(600);
      const { db, comandos } = bancoQueRegistra();
      await baixar("totais", db);
      const contagem = comandos.find(
        (comando) => comando.sql === CONTAR_DESCONSIDERADOS,
      );
      // As entradas do índice na campanha (medido: N). Com desconsiderados de uma campanha de id maior no índice, o
      // passo que acha o fim do intervalo lê mais uma (N + 1).
      expect(contagem!.lidas).toBeGreaterThanOrEqual(desconsiderados);
      expect(contagem!.lidas).toBeLessThanOrEqual(desconsiderados + 1);

      // A leitura do painel lê um a menos por desconsiderado, e a contagem, um a mais: o total quase não muda.
      const depois = await medir("totais");
      expect(depois.idas).toBe(2);
      expect(Math.abs(depois.linhas - antes.linhas)).toBeLessThanOrEqual(1);
      expect(depois.csv).toMatch(
        new RegExp(`;${desconsiderados};% da meta\\r\\n$`),
      );
    } finally {
      await env.DB.prepare(
        `UPDATE pedidos SET desconsiderado_em = NULL, desconsiderado_motivo = NULL
         WHERE desconsiderado_em IS NOT NULL`,
      ).run();
    }
  });
});
