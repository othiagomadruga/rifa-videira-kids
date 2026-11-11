// CA6 (RIFA-015, D17, D10): orçamento do D1 e plano travados do mapa de vendas por DDD, com o volume da revisão do
// contrato (7 mil pedidos em 20 dias, 5,6 mil aprovados; 36 células em duas divisões, 40 afiliados, 10% sem
// afiliado). O D1 cobra por linha lida e o mapa fica com os índices atuais (D17: sem índice novo): a consulta desce
// pelo índice (status, aprovado_em) SÓ na janela e agrupa por país e DDD numa B-tree temporária, que o D1 também
// conta (a volta à tabela para ler país e DDD, não). Medido em 2026-11-11, por requisição (a campanha ativa e a
// consulta): campanha inteira 10.925 linhas (2,0 por aprovado da janela), semana 3.939 (2,0); com divisão, 8.172 e
// 2.796 (~1,5: a B-tree só recebe os da divisão). O teto tem folga sobre o medido; o plano travado barra os planos
// ruins, que leem a campanha inteira em qualquer janela: pelo índice da migração 0003 (campanha, afiliado, dia), a
// semana leria ~7,6 mil linhas; pelo de (affiliate_id, status), com a divisão, ~6,7 mil (e cresce com as edições).
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { respostaMapaDddSchema, type Divisao } from "../../shared/contracts";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import { PREFIXO_PAINEL, criarPainel } from "../routes/painel";
import { comandoMapaDdd } from "./mapa-ddd";

const db = env.DB;

/** Dia 20 de 24, 12:00 em Belém: a campanha até hoje são os dias 23/11 a 12/12. */
const AGORA = new Date("2026-12-12T15:00:00.000Z");
/** 09/12, 20:00 em Belém: o período atual é a Semana 2 (03/12 a 09/12), uma semana inteira. */
const NA_SEMANA_2 = new Date("2026-12-09T23:00:00.000Z");

/** As janelas UTC das duas medidas (o que a rota calcula pelo intervaloUtcDoDia). */
const JANELAS = {
  campanha: {
    inicio: "2026-11-23T03:00:00.000Z",
    fim: "2026-12-13T03:00:00.000Z",
  },
  semana: {
    inicio: "2026-12-03T03:00:00.000Z",
    fim: "2026-12-10T03:00:00.000Z",
  },
} as const;

/**
 * Teto de linhas lidas por pedido aprovado da janela. Medido: 2,0 (1 no índice e 1 na B-tree temporária do GROUP
 * BY; com divisão, a B-tree só recebe os da divisão, ~1,5). Na semana, o teto (~4,3 mil) fica bem abaixo dos planos
 * ruins (~7,6 mil e ~6,7 mil).
 */
const LIMITE_POR_APROVADO = 2.2;
/** A leitura da campanha ativa (~4 linhas) e, com divisão, a lista dos afiliados da divisão (~150). */
const FOLGA_FIXA = 300;

/** O plano esperado sem divisão: o índice (status, aprovado_em) na janela e o agrupamento por país e DDD. */
const PLANO_SEM_DIVISAO = [
  "SEARCH pedidos USING INDEX pedidos_por_status_aprovacao (status=? AND aprovado_em>? AND aprovado_em<?)",
  "USE TEMP B-TREE FOR GROUP BY",
];

/** Aprovados da campanha ativa em cada janela (contados à parte). */
let aprovados: Record<keyof typeof JANELAS, number>;

beforeAll(async () => {
  await db.batch([
    db.prepare(
      `INSERT INTO campanhas (id, nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
           meta_regra, meta_valor, ranking_criterio)
         VALUES (1, 'Rifa de carga', 'rifa-kids-carga', 1, '2026-11-23', 2000, 'bilhetes', 'por_pessoa', 10,
           'percentual_meta')`,
    ),
    db.prepare(
      `INSERT INTO campanha_periodos (campanha_id, ordem, nome, dias, percentual_bp)
       VALUES (1, 1, 'Semana 1', 10, 3500), (1, 2, 'Semana 2', 7, 2500), (1, 3, 'Semana 3', 7, 4000)`,
    ),
    // A edição anterior (inativa), com pedidos aprovados um ano antes: fora do intervalo do índice, não são lidos.
    // (Um aprovado de outra campanha DENTRO da janela custaria 1 linha do índice, conferido e descartado.)
    db.prepare(
      `INSERT INTO campanhas (id, nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
           meta_regra, meta_valor, ranking_criterio)
         VALUES (2, 'Rifa antiga', 'rifa-antiga', 0, '2025-11-23', 2000, 'bilhetes', 'por_pessoa', 10,
           'percentual_meta')`,
    ),
    db.prepare(
      "INSERT INTO redes (id, nome, divisao) VALUES (1, 'Rede de Carga J', 'jovens'), (2, 'Rede de Carga A', 'adultos')",
    ),
    db.prepare(
      "INSERT INTO discipuladores (id, rede_id, nome) VALUES (1, 1, 'Discipulador J'), (2, 2, 'Discipulador A')",
    ),
    db.prepare(
      `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
       WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 36)
       SELECT 100 + i, 1 + i % 2, 'Célula de Carga ' || i, 10, 'Líder ' || i FROM n`,
    ),
    // 36 afiliados vinculados (7000 a 7035) e 4 órfãos (7036 a 7039).
    db.prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
       WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 39)
       SELECT 7000 + i, CASE WHEN i < 36 THEN 101 + i END, CASE WHEN i < 36 THEN 'manual' ELSE 'webhook' END,
         CASE WHEN i < 36 THEN '2026-11-20T12:00:00.000Z' END FROM n`,
    ),
    // 7000 pedidos em 20 dias até AGORA (os primeiros, antes da largada): 80% aprovados, 10% in_process,
    // 10% expirados; 10% sem afiliado. Telefones: metade do DDD 91, o resto em PA, SP, DF, RJ, um DDD fora da
    // tabela, sem país, exterior e Brasil sem DDD.
    db.prepare(
      `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, ddd, pais,
         aprovado_em)
       WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 7000),
       t(i, ddd, pais) AS (
         SELECT i,
           CASE WHEN k < 10 THEN '91' WHEN k < 12 THEN '94' WHEN k = 12 THEN '93' WHEN k = 13 THEN '11'
             WHEN k = 14 THEN '61' WHEN k = 15 THEN '21' WHEN k = 16 THEN '23' END,
           CASE WHEN k <= 16 OR k = 19 THEN '55' WHEN k = 18 THEN '351' END
         FROM (SELECT i, (i / 10) % 20 AS k FROM n))
       SELECT 'R-' || i, 1, CASE WHEN i % 10 = 0 THEN NULL ELSE 7000 + (i % 40) END,
         CASE WHEN i % 10 < 8 THEN 'approved' WHEN i % 10 = 8 THEN 'in_process' ELSE 'expired' END,
         1 + i % 4, (1 + i % 4) * 2000, ddd, pais,
         CASE WHEN i % 10 < 8 THEN strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-22T15:05:00.000Z', '+' || (i * 246) || ' seconds') END
       FROM t`,
    ),
    db.prepare(
      `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, ddd, pais,
         aprovado_em)
       WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
       SELECT 'ANTIGA-' || i, 2, 7000 + (i % 40), 'approved', 2, 4000, '91', '55',
         strftime('%Y-%m-%dT%H:%M:%fZ', '2025-11-23T15:00:00.000Z', '+' || (i * 3000) || ' seconds')
       FROM n`,
    ),
  ]);
  const contar = (janela: (typeof JANELAS)[keyof typeof JANELAS]) =>
    db
      .prepare(
        `SELECT count(*) AS total FROM pedidos
         WHERE campanha_id = 1 AND status = 'approved' AND aprovado_em >= ?1 AND aprovado_em < ?2`,
      )
      .bind(janela.inicio, janela.fim)
      .first<{ total: number }>();
  aprovados = {
    campanha: (await contar(JANELAS.campanha))!.total,
    semana: (await contar(JANELAS.semana))!.total,
  };
}, 60_000);

it("o volume é o da revisão do contrato", async () => {
  const volume = await db
    .prepare(
      `SELECT count(*) AS pedidos, sum(status = 'approved') AS aprovados, sum(affiliate_id IS NULL) AS semAfiliado
       FROM pedidos WHERE campanha_id = 1`,
    )
    .first();
  expect(volume).toEqual({ pedidos: 7000, aprovados: 5600, semAfiliado: 700 });
  expect(aprovados).toEqual({ campanha: 5460, semana: 1967 });
});

// ---------------------------------------------------------------------------------------------------
// A consulta sozinha: plano e linhas lidas
// ---------------------------------------------------------------------------------------------------

async function medir(
  janela: keyof typeof JANELAS,
  divisao?: Divisao,
): Promise<{ plano: string[]; linhasLidas: number; linhas: number }> {
  const { sql, valores } = comandoMapaDdd(1, JANELAS[janela], divisao);
  const plano = await db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...valores)
    .all<{ detail: string }>();
  const resultado = await db
    .prepare(sql)
    .bind(...valores)
    .all();
  return {
    plano: plano.results.map((linha) => linha.detail),
    linhasLidas: resultado.meta.rows_read,
    linhas: resultado.results.length,
  };
}

describe("a consulta desce pelo índice (status, aprovado_em) só na janela, sem índice novo", () => {
  it.each(["campanha", "semana"] as const)(
    "sem divisão, %s: o plano travado e ~2 linhas por aprovado da janela (medido: campanha 10.921; semana 3.935)",
    async (janela) => {
      const { plano, linhasLidas, linhas } = await medir(janela);

      expect(plano).toEqual(PLANO_SEM_DIVISAO);
      expect(linhas).toBe(10);
      expect(linhasLidas).toBeLessThanOrEqual(
        LIMITE_POR_APROVADO * aprovados[janela],
      );
    },
  );

  it.each(["campanha", "semana"] as const)(
    "com divisão, %s: o mesmo índice, os afiliados da divisão numa lista (medido, jovens: campanha 8.168; semana 3.039)",
    async (janela) => {
      const { plano, linhasLidas } = await medir(janela, "jovens");

      expect(plano[0]).toBe(PLANO_SEM_DIVISAO[0]);
      expect(plano).toContain("LIST SUBQUERY 1");
      expect(plano.filter((passo) => passo.includes("TEMP B-TREE"))).toEqual([
        "USE TEMP B-TREE FOR GROUP BY",
      ]);
      // Nem o índice da 0003 nem o de (affiliate_id, status), que leriam a campanha inteira ou todas as datas.
      expect(plano.join("\n")).not.toMatch(
        /pedidos_aprovados_por_afiliado_dia|pedidos_por_afiliado_status|pedidos_por_campanha_registro/,
      );
      expect(linhasLidas).toBeLessThanOrEqual(
        LIMITE_POR_APROVADO * aprovados[janela] + FOLGA_FIXA,
      );
    },
  );
});

// ---------------------------------------------------------------------------------------------------
// A requisição inteira: duas idas ao banco e as linhas lidas de todas
// ---------------------------------------------------------------------------------------------------

/** Um D1 que conta as idas e as linhas lidas de cada first e all (o first não traz `meta`: lê pelo all). */
function bancoQueConta() {
  const contagem = { idas: 0, linhasLidas: 0 };
  const embrulhar = (comando: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(comando, {
      get(alvo, nome) {
        if (nome === "bind")
          return (...args: unknown[]) => embrulhar(alvo.bind(...args));
        if (nome === "first" || nome === "all")
          return async () => {
            contagem.idas += 1;
            const resultado = await alvo.all();
            contagem.linhasLidas += resultado.meta.rows_read;
            return nome === "first"
              ? (resultado.results[0] ?? null)
              : resultado;
          };
        if (nome === "run" || nome === "raw")
          throw new Error(`${nome} não é usado pelo mapa`);
        return Reflect.get(alvo, nome, alvo) as unknown;
      },
    });
  const banco = new Proxy(db, {
    get(alvo, nome) {
      if (nome === "prepare")
        return (sql: string) => embrulhar(alvo.prepare(sql));
      // Uma ida que esta contagem não veria (batch, exec, dump...) falha o teste.
      if (nome === "batch" || nome === "exec" || nome === "dump")
        throw new Error(`${nome} não é usado pelo mapa`);
      return Reflect.get(alvo, nome, alvo) as unknown;
    },
  });
  return { db: banco, contagem };
}

async function requisitar(caminho: string, agora: Date) {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.route(
    PREFIXO_PAINEL,
    criarPainel(() => agora),
  );
  app.notFound(rotaInexistente);
  app.onError(erroNaoTratado);
  const { db: contado, contagem } = bancoQueConta();
  const res = await app.request(caminho, {}, { ...env, DB: contado });
  expect(res.status).toBe(200);
  return {
    corpo: respostaMapaDddSchema.parse(await res.json()),
    contagem,
  };
}

describe("a requisição: a campanha ativa e a consulta, nada mais", () => {
  const medidas: string[] = [];

  it.each([
    ["campanha inteira", "", AGORA, "campanha"],
    ["campanha inteira, divisão jovens", "?divisao=jovens", AGORA, "campanha"],
    ["semana (período atual)", "?periodo=atual", NA_SEMANA_2, "semana"],
    [
      "semana, divisão adultos",
      "?periodo=atual&divisao=adultos",
      NA_SEMANA_2,
      "semana",
    ],
  ] as const)("%s", async (nome, consulta, agora, janela) => {
    const { corpo, contagem } = await requisitar(
      `/api/painel/mapa-ddd${consulta}`,
      agora,
    );

    expect(contagem.idas).toBe(2);
    if (consulta.includes("divisao"))
      expect(corpo.total.pedidos_aprovados).toBeLessThan(aprovados[janela]);
    else expect(corpo.total.pedidos_aprovados).toBe(aprovados[janela]);
    const porAprovado = contagem.linhasLidas / aprovados[janela];
    expect({ nome, linhasLidas: contagem.linhasLidas }).toEqual({
      nome,
      linhasLidas: expect.any(Number),
    });
    expect(contagem.linhasLidas).toBeLessThanOrEqual(
      LIMITE_POR_APROVADO * aprovados[janela] + FOLGA_FIXA,
    );
    medidas.push(
      `${nome.padEnd(34)} ${String(contagem.linhasLidas).padStart(6)} linhas lidas (${porAprovado.toFixed(2)} por aprovado da janela; ${aprovados[janela]} aprovados)`,
    );
    if (medidas.length === 4)
      console.log(["CA6: mapa por DDD, 7 mil pedidos", ...medidas].join("\n"));
  });
});
