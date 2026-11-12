// CA4 (RIFA-025, D16): orçamento do D1 (D10) e planos travados da lista de pedidos, das entregas e do estado do
// webhook, com ~7 mil pedidos e 20 mil entregas (o volume da revisão do contrato). O D1 cobra por linha lida, e o
// índice da migração 0007 (pedidos_por_campanha_registro) atrai o planejador também onde ele piora a leitura:
// cada consulta tem o plano travado com EXPLAIN QUERY PLAN e as linhas lidas (`meta.rows_read`) com folga sobre o
// medido, mas bem abaixo da armadilha que a revisão mediu (entre parênteses em cada teste). Cada teste lê o mesmo
// banco semeado uma vez; só o do slug trocado escreve, e desfaz no fim.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { ROTAS } from "../../shared/contracts";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import { PREFIXO_PEDIDOS, pedidos } from "../routes/pedidos";
import {
  PREFIXO_WEBHOOK_COORDENACAO,
  criarWebhookCoordenacao,
} from "../routes/webhook-coordenacao";
import { comandoEntregasWebhook } from "./entregas-webhook";
import {
  CONTAR_ULTIMAS_24H,
  ERRO_RECENTE,
  ESPACOS_DO_TRIM,
  ULTIMA_DA_CAMPANHA,
  ULTIMA_ENTREGA,
  ULTIMO_APROVADO,
} from "./estado-webhook";
import {
  comandoListaPedidos,
  comandoTotaisPedidos,
  type ComandoSql,
  type CursorPedidos,
} from "./lista-pedidos";

const db = env.DB;
const SLUG = "rifa-kids-carga";
/** Dia 20 da campanha, 12:00 em Belém: as entregas vão até ~2 h antes. */
const AGORA = new Date("2026-12-12T15:00:00.000Z");
const DESDE_24H = new Date(AGORA.getTime() - 86_400_000).toISOString();
/** Célula 105: o afiliado 7004, com 1 de cada 40 pedidos (175). */
const CELULA = 105;

/** O volume, contado do banco semeado. */
let volume: {
  /** Pedidos da campanha ativa. */
  pedidos: number;
  /** Pedidos da célula 105. */
  daCelula: number;
  /** Pedidos sem célula (sem afiliado ou com afiliado não vinculado). */
  semCelula: number;
  /** Pedidos desconsiderados pelo admin (RIFA-028, D20): 1 de cada 100. */
  desconsiderados: number;
  entregas: number;
  entregas24h: number;
  erros24h: number;
};
/** Um cursor no meio da lista (o 3.500º pedido). */
let meio: CursorPedidos;

interface Medida {
  plano: string[];
  linhasLidas: number;
  linhas: number;
}

async function medir({ sql, valores }: ComandoSql): Promise<Medida> {
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

/** O plano não passa por uma B-tree temporária (a leitura para no limite, sem ordenar tudo). */
const semBtreeTemporaria = (plano: string[]) =>
  plano.filter((passo) => passo.includes("TEMP B-TREE"));

// ---------------------------------------------------------------------------------------------------
// D1 que conta TODAS as leituras (first, all, run, raw e batch), para medir a requisição inteira
// ---------------------------------------------------------------------------------------------------

const ORIGINAL = Symbol("comando original");

function bancoQueContaTudo(): {
  db: D1Database;
  contagem: { idas: number; linhasLidas: number };
} {
  const contagem = { idas: 0, linhasLidas: 0 };
  const embrulhar = (comando: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(comando, {
      get(alvo, nome) {
        if (nome === ORIGINAL) return alvo;
        if (nome === "bind")
          return (...args: unknown[]) => embrulhar(alvo.bind(...args));
        if (nome === "first")
          // O first não traz `meta`: lê pelo all (mesma consulta) e devolve a primeira linha.
          return async () => {
            contagem.idas += 1;
            const resultado = await alvo.all();
            contagem.linhasLidas += resultado.meta.rows_read;
            return resultado.results[0] ?? null;
          };
        if (nome === "all" || nome === "run")
          return async () => {
            contagem.idas += 1;
            const resultado = await alvo[nome]();
            contagem.linhasLidas += resultado.meta.rows_read;
            return resultado;
          };
        if (nome === "raw") throw new Error("raw não é usado aqui");
        const valor: unknown = Reflect.get(alvo, nome, alvo);
        return typeof valor === "function"
          ? (...args: unknown[]) => Reflect.apply(valor, alvo, args)
          : valor;
      },
    });
  const original = (comando: D1PreparedStatement) =>
    (comando as unknown as { [ORIGINAL]?: D1PreparedStatement })[ORIGINAL] ??
    comando;
  const banco = new Proxy(db, {
    get(alvo, nome) {
      if (nome === "prepare")
        return (sql: string) => embrulhar(alvo.prepare(sql));
      if (nome === "batch")
        return async (comandos: D1PreparedStatement[]) => {
          contagem.idas += 1;
          const resultados = await alvo.batch(comandos.map(original));
          for (const resultado of resultados)
            contagem.linhasLidas += resultado.meta.rows_read;
          return resultados;
        };
      const valor: unknown = Reflect.get(alvo, nome, alvo);
      return typeof valor === "function"
        ? (...args: unknown[]) => Reflect.apply(valor, alvo, args)
        : valor;
    },
  });
  return { db: banco, contagem };
}

/** As rotas reais (sem o login, que não lê pedidos nem entregas) com o banco que conta e o relógio fixo. */
async function requisitar(caminho: string) {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.route(PREFIXO_PEDIDOS, pedidos);
  app.route(
    PREFIXO_WEBHOOK_COORDENACAO,
    criarWebhookCoordenacao(() => AGORA),
  );
  app.notFound(rotaInexistente);
  app.onError(erroNaoTratado);
  const { db: contado, contagem } = bancoQueContaTudo();
  const res = await app.request(caminho, {}, { ...env, DB: contado });
  expect(res.status).toBe(200);
  return { corpo: (await res.json()) as unknown, contagem };
}

// ---------------------------------------------------------------------------------------------------
// Volume: o da revisão do contrato (36 células, 40 afiliados, 7 mil pedidos em 20 dias, 20 mil entregas)
// ---------------------------------------------------------------------------------------------------

beforeAll(async () => {
  await db.batch([
    db
      .prepare(
        `INSERT INTO campanhas (id, nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
           meta_regra, meta_valor, ranking_criterio)
         VALUES (1, 'Rifa de carga', ?1, 1, '2026-11-23', 2000, 'bilhetes', 'por_pessoa', 10, 'percentual_meta')`,
      )
      .bind(SLUG),
    db.prepare(
      `INSERT INTO campanha_periodos (campanha_id, ordem, nome, dias, percentual_bp)
       VALUES (1, 1, 'Semana 1', 10, 3500), (1, 2, 'Semana 2', 7, 2500), (1, 3, 'Semana 3', 7, 4000)`,
    ),
    db.prepare(
      "INSERT INTO redes (id, nome, divisao) VALUES (1, 'Rede de Carga', 'jovens')",
    ),
    db.prepare(
      "INSERT INTO discipuladores (id, rede_id, nome) VALUES (1, 1, 'Discipulador de Carga')",
    ),
    db.prepare(
      `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
       WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 36)
       SELECT 100 + i, 1, 'Célula de Carga ' || i, 10, 'Líder ' || i FROM n`,
    ),
    // 36 afiliados vinculados (7000 a 7035) e 4 órfãos (7036 a 7039).
    db.prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
       WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 39)
       SELECT 7000 + i, CASE WHEN i < 36 THEN 101 + i END, CASE WHEN i < 36 THEN 'manual' ELSE 'webhook' END,
         CASE WHEN i < 36 THEN '2026-11-20T12:00:00.000Z' END FROM n`,
    ),
    // 7000 pedidos em 20 dias até AGORA: 80% aprovados, 10% in_process, 10% expirados; 10% sem afiliado.
    db.prepare(
      `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, ddd, pais,
         criado_em, aprovado_em, registrado_em, atualizado_em)
       WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 7000)
       SELECT 'R-' || i, 1, CASE WHEN i % 10 = 0 THEN NULL ELSE 7000 + (i % 40) END,
         CASE WHEN i % 10 < 8 THEN 'approved' WHEN i % 10 = 8 THEN 'in_process' ELSE 'expired' END,
         3, 6000, '91', '55',
         strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-22T15:00:00.000Z', '+' || (i * 246) || ' seconds'),
         CASE WHEN i % 10 < 8 THEN strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-22T15:05:00.000Z', '+' || (i * 246) || ' seconds') END,
         strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-22T15:00:01.000Z', '+' || (i * 246) || ' seconds'),
         strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-22T15:05:01.000Z', '+' || (i * 246) || ' seconds')
       FROM n`,
    ),
    // 1 de cada 100 pedidos (de todos os status) foi desconsiderado pelo admin (D20).
    db.prepare(
      `UPDATE pedidos SET desconsiderado_em = '2026-12-01T12:00:00.000Z', desconsiderado_motivo = 'teste'
       WHERE CAST(substr(id, 3) AS INTEGER) % 100 = 7`,
    ),
    // 1 de cada 50 aprovados está na lista de suspeitos.
    db.prepare(
      `INSERT INTO pedidos_suspeitos (pedido_id, qtd_bilhetes, total_centavos, esperado_centavos, motivos, marcado_em)
       SELECT id, qtd_bilhetes, total_centavos, 6000,
         '[{"caminho":["total"],"codigo":"total_abaixo_do_esperado","mensagem":"x","ocorrencias":1}]', atualizado_em
       FROM pedidos WHERE status = 'approved' AND CAST(substr(id, 3) AS INTEGER) % 50 = 1`,
    ),
    // 20000 entregas no mesmo período: 70% processado, 15% duplicado, 10% outra campanha, 3% transição, 2% erro.
    db
      .prepare(
        `INSERT INTO webhook_eventos (recebido_em, evento, pedido_id, slug, resultado, status_anterior,
           status_resultante, payload_redigido, erro, avisos)
         WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000),
         m AS (SELECT i, CASE WHEN i % 100 < 70 THEN 'processado' WHEN i % 100 < 85 THEN 'duplicado'
                 WHEN i % 100 < 95 THEN 'ignorado_outra_campanha' WHEN i % 100 < 98 THEN 'ignorado_transicao'
                 ELSE 'erro_validacao' END AS r FROM n)
         SELECT strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-22T15:00:00.000Z', '+' || (i * 86) || ' seconds'),
           'paid_order', 'R-' || ((i % 7000) + 1), CASE WHEN r = 'ignorado_outra_campanha' THEN 'outra' ELSE ?1 END,
           r, NULL, CASE WHEN r IN ('processado', 'duplicado', 'ignorado_transicao') THEN 'approved' END,
           CASE WHEN r <> 'erro_validacao' THEN '{}' END,
           CASE WHEN r = 'erro_validacao'
             THEN '[{"caminho":["total"],"codigo":"invalid_type","mensagem":"Invalid input","ocorrencias":1}]' END,
           CASE WHEN r = 'processado' AND i % 7 = 0
             THEN '[{"caminho":["total"],"codigo":"fracao_de_centavo","mensagem":"x","ocorrencias":1}]' END
         FROM m`,
      )
      .bind(SLUG),
  ]);
  const contagem = await db
    .prepare(
      `SELECT
         (SELECT count(*) FROM pedidos WHERE campanha_id = 1) AS pedidos,
         (SELECT count(*) FROM pedidos AS p JOIN afiliados AS a ON a.affiliate_id = p.affiliate_id
           WHERE a.celula_id = ?1) AS daCelula,
         (SELECT count(*) FROM pedidos AS p LEFT JOIN afiliados AS a ON a.affiliate_id = p.affiliate_id
           WHERE a.celula_id IS NULL) AS semCelula,
         (SELECT count(*) FROM pedidos WHERE desconsiderado_em IS NOT NULL) AS desconsiderados,
         (SELECT count(*) FROM webhook_eventos) AS entregas,
         (SELECT count(*) FROM webhook_eventos WHERE recebido_em >= ?2) AS entregas24h,
         (SELECT count(*) FROM webhook_eventos WHERE resultado = 'erro_validacao' AND recebido_em >= ?2)
           AS erros24h`,
    )
    .bind(CELULA, DESDE_24H)
    .first<typeof volume>();
  volume = contagem!;
  meio = (await db
    .prepare(
      "SELECT registrado_em, id FROM pedidos ORDER BY registrado_em DESC, id DESC LIMIT 1 OFFSET 3500",
    )
    .first<CursorPedidos>())!;
}, 60_000);

it("o volume é o da revisão do contrato", () => {
  expect(volume).toEqual({
    pedidos: 7000,
    daCelula: 175,
    semCelula: 1400,
    desconsiderados: 70,
    entregas: 20000,
    entregas24h: 912,
    erros24h: 20,
  });
});

// ---------------------------------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------------------------------

describe("pedidos: a lista sem filtro de célula desce pelo índice da 0007 e para no limite", () => {
  it("1ª página: ~134 linhas lidas (sem o índice, ~26 mil)", async () => {
    const { plano, linhasLidas, linhas } = await medir(
      comandoListaPedidos({}, null, 50),
    );
    expect(linhas).toBe(51);
    expect(plano).toContain(
      "SEARCH p USING INDEX pedidos_por_campanha_registro (campanha_id=?)",
    );
    expect(semBtreeTemporaria(plano)).toEqual([]);
    expect(linhasLidas).toBeLessThanOrEqual(200);
  });

  it("com o cursor no meio: o índice começa no cursor, ~141 linhas lidas (sem o índice, ~16 mil)", async () => {
    const { plano, linhasLidas, linhas } = await medir(
      comandoListaPedidos({}, meio, 50),
    );
    expect(linhas).toBe(51);
    expect(plano).toContain(
      "SEARCH p USING INDEX pedidos_por_campanha_registro (campanha_id=? AND (registrado_em,id)<(?,?))",
    );
    expect(semBtreeTemporaria(plano)).toEqual([]);
    expect(linhasLidas).toBeLessThanOrEqual(210);
  });

  it("página máxima (200): ~542 linhas lidas", async () => {
    const { linhasLidas, linhas } = await medir(
      comandoListaPedidos({}, null, 200),
    );
    expect(linhas).toBe(201);
    expect(linhasLidas).toBeLessThanOrEqual(800);
  });

  it("por status: o mesmo índice, conferindo o status na linha (~593 linhas lidas com 10% do status)", async () => {
    const { plano, linhasLidas, linhas } = await medir(
      comandoListaPedidos({ status: "in_process" }, null, 50),
    );
    expect(linhas).toBe(51);
    expect(plano).toContain(
      "SEARCH p USING INDEX pedidos_por_campanha_registro (campanha_id=?)",
    );
    expect(semBtreeTemporaria(plano)).toEqual([]);
    expect(linhasLidas).toBeLessThanOrEqual(900);
  });

  it("pelo id: a chave primária, com os outros filtros conferidos na linha", async () => {
    for (const filtros of [
      { id: "R-4242" },
      { id: "R-4242", celula_id: CELULA, status: "approved" as const },
      { id: "R-4242", sem_celula: true },
    ]) {
      const lista = await medir(comandoListaPedidos(filtros, null, 50));
      const totais = await medir(comandoTotaisPedidos(filtros));
      for (const { plano, linhasLidas } of [lista, totais]) {
        expect(plano[0]).toBe(
          "SEARCH p USING INDEX sqlite_autoindex_pedidos_1 (id=?)",
        );
        expect(linhasLidas).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe("pedidos: o filtro desconsiderado (RIFA-028, D20) e a origem (D16) na lista", () => {
  it("desconsiderado=true: o índice parcial da 0008, que só tem os desconsiderados (~2 linhas por desconsiderado)", async () => {
    for (const cursor of [null, meio]) {
      const { plano, linhasLidas, linhas } = await medir(
        comandoListaPedidos({ desconsiderado: true }, cursor, 50),
      );
      expect(linhas).toBe(cursor === null ? 51 : 35);
      expect(plano[0]).toMatch(
        /^SEARCH p USING INDEX pedidos_desconsiderados_por_registro \(campanha_id=\?/,
      );
      expect(semBtreeTemporaria(plano)).toEqual([]);
      // Medido: 154 (a 1ª página) com 70 desconsiderados; pelo índice da 0007, a página leria ~10 mil linhas.
      expect(linhasLidas).toBeLessThanOrEqual(3 * volume.desconsiderados);
    }
  });

  it("desconsiderado=false, com e sem status: o índice da 0007 (nunca o parcial da 0003, que ordenaria tudo)", async () => {
    for (const filtros of [
      { desconsiderado: false },
      { desconsiderado: false, status: "approved" as const },
    ]) {
      const { plano, linhasLidas, linhas } = await medir(
        comandoListaPedidos(filtros, null, 50),
      );
      expect(linhas).toBe(51);
      expect(plano).toContain(
        "SEARCH p USING INDEX pedidos_por_campanha_registro (campanha_id=?)",
      );
      expect(plano.join("\n")).not.toContain(
        "pedidos_aprovados_por_afiliado_dia",
      );
      expect(semBtreeTemporaria(plano)).toEqual([]);
      // Medido: ~135 e ~152.
      expect(linhasLidas).toBeLessThanOrEqual(250);
    }
  });

  it("com célula, sem célula ou id, o filtro é conferido na linha (o mesmo plano de sem ele)", async () => {
    for (const filtros of [
      { celula_id: CELULA },
      { sem_celula: true },
      { id: "R-4207" },
    ]) {
      for (const desconsiderado of [true, false]) {
        const com = await medir(
          comandoListaPedidos({ ...filtros, desconsiderado }, null, 50),
        );
        const sem = await medir(comandoListaPedidos(filtros, null, 50));
        expect(com.plano).toEqual(sem.plano);
        expect(com.linhasLidas).toBeLessThanOrEqual(sem.linhasLidas);
      }
    }
  });

  it("os totais contam só o que conta e ignoram o filtro: o mesmo plano, ~1 linha por pedido", async () => {
    const sem = await medir(comandoTotaisPedidos({}));
    const com = await medir(comandoTotaisPedidos({ desconsiderado: true }));
    expect(com).toEqual(sem);
    expect(sem.plano.join("\n")).not.toMatch(
      /pedidos_por_campanha_registro|pedidos_aprovados_por_afiliado_dia|pedidos_desconsiderados_por_registro/,
    );
    expect(sem.linhasLidas).toBeLessThanOrEqual(1.1 * volume.pedidos);
    const { results } = await db
      .prepare(comandoTotaisPedidos({}).sql)
      .all<{ status: string; pedidos: number }>();
    expect(results.reduce((soma, linha) => soma + linha.pedidos, 0)).toBe(
      volume.pedidos - volume.desconsiderados,
    );
  });
});

describe("pedidos: por célula, afiliados CROSS JOIN pedidos (nunca o índice da 0007)", () => {
  it("lista: os afiliados da célula e os pedidos de cada um, ~3 linhas por pedido da célula (pela campanha, ~3.900)", async () => {
    for (const cursor of [null, meio]) {
      const { plano, linhasLidas, linhas } = await medir(
        comandoListaPedidos({ celula_id: CELULA }, cursor, 50),
      );
      expect(linhas).toBe(51);
      expect(plano.slice(0, 2)).toEqual([
        "SEARCH a USING INDEX afiliados_por_celula (celula_id=?)",
        "SEARCH p USING INDEX pedidos_por_afiliado_status (affiliate_id=?)",
      ]);
      expect(plano.join("\n")).not.toContain("pedidos_por_campanha_registro");
      expect(linhasLidas).toBeLessThanOrEqual(4 * volume.daCelula);
    }
  });

  it("totais: ~2 linhas por pedido da célula (pela campanha, ~13.500)", async () => {
    const { plano, linhasLidas } = await medir(
      comandoTotaisPedidos({ celula_id: CELULA }),
    );
    expect(plano.slice(0, 2)).toEqual([
      "SEARCH a USING INDEX afiliados_por_celula (celula_id=?)",
      "SEARCH p USING INDEX pedidos_por_afiliado_status (affiliate_id=?)",
    ]);
    expect(plano.join("\n")).not.toContain("pedidos_por_campanha_registro");
    expect(linhasLidas).toBeLessThanOrEqual(3 * volume.daCelula);
  });
});

describe("pedidos: sem célula, `affiliate_id IS NULL OR affiliate_id IN (afiliados sem célula)` (MULTI-INDEX OR)", () => {
  // O custo acompanha os pedidos sem célula, não a campanha: perto do fim, com quase todos vinculados, a lista
  // sem célula fica barata (pelo índice da 0007, a página percorreria a campanha inteira para achar poucos).
  it("lista e totais pelo índice por afiliado, nunca pelo da 0007 (com o LEFT JOIN, ~14.700 nos totais)", async () => {
    const lista = await medir(
      comandoListaPedidos({ sem_celula: true }, null, 50),
    );
    const totais = await medir(comandoTotaisPedidos({ sem_celula: true }));
    for (const { plano } of [lista, totais]) {
      expect(plano[0]).toBe("MULTI-INDEX OR");
      expect(plano).toContain(
        "SEARCH p USING INDEX pedidos_por_afiliado_status (affiliate_id=?)",
      );
      expect(plano.join("\n")).not.toContain("pedidos_por_campanha_registro");
    }
    expect(lista.linhas).toBe(51);
    // Medido: ~2,5 linhas por pedido sem célula na lista (~3.500) e ~2 nos totais (~2.800).
    expect(lista.linhasLidas).toBeLessThanOrEqual(3 * volume.semCelula);
    expect(totais.linhasLidas).toBeLessThanOrEqual(2.5 * volume.semCelula);
  });
});

describe("pedidos: totais sem filtro com `+campanha_id` (nunca o índice da 0007)", () => {
  it("1 linha lida por pedido (pelo índice da 0007, 2 por pedido: ~14 mil)", async () => {
    const { plano, linhasLidas, linhas } = await medir(
      comandoTotaisPedidos({}),
    );
    expect(linhas).toBe(3);
    expect(plano.join("\n")).not.toContain("pedidos_por_campanha_registro");
    expect(linhasLidas).toBeLessThanOrEqual(1.1 * volume.pedidos);
  });
});

// ---------------------------------------------------------------------------------------------------
// Entregas
// ---------------------------------------------------------------------------------------------------

describe("entregas: pela chave primária ou pelo índice (resultado, id) da 0007, parando no limite", () => {
  it("sem filtro: o id de trás para frente, 51 linhas lidas", async () => {
    const { plano, linhasLidas } = await medir(
      comandoEntregasWebhook({ limite: 50 }),
    );
    expect(plano).toEqual(["SCAN webhook_eventos"]);
    expect(linhasLidas).toBeLessThanOrEqual(60);
  });

  it("por resultado, com e sem cursor: ~51 linhas lidas (sem o índice da 0007, ~800 e ~21 mil)", async () => {
    for (const resultado of [
      "processado",
      "erro_validacao",
      "ignorado_outra_campanha",
    ] as const) {
      const sem = await medir(
        comandoEntregasWebhook({ limite: 50, resultado }),
      );
      const com = await medir(
        comandoEntregasWebhook({ limite: 50, resultado, antes_de: 10_000 }),
      );
      expect(sem.plano).toEqual([
        "SEARCH webhook_eventos USING INDEX webhook_eventos_por_resultado_id (resultado=?)",
      ]);
      expect(com.plano).toEqual([
        "SEARCH webhook_eventos USING INDEX webhook_eventos_por_resultado_id (resultado=? AND id<?)",
      ]);
      expect(sem.linhasLidas).toBeLessThanOrEqual(60);
      expect(com.linhasLidas).toBeLessThanOrEqual(60);
    }
  });

  it("por pedido: o índice por pedido (já na ordem do id)", async () => {
    const { plano, linhasLidas } = await medir(
      comandoEntregasWebhook({ limite: 50, pedido_id: "R-4242" }),
    );
    expect(plano).toEqual([
      "SEARCH webhook_eventos USING INDEX webhook_eventos_por_pedido (pedido_id=?)",
    ]);
    expect(linhasLidas).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------------------------------

describe("estado: contagem com `resultado IN (...)` e últimas por `MAX(recebido_em)`", () => {
  it("contagem das 24 h: só a janela de cada resultado no índice de cobertura (~921; sem o IN, 20 mil)", async () => {
    const { plano, linhasLidas } = await medir({
      sql: CONTAR_ULTIMAS_24H,
      valores: [DESDE_24H],
    });
    expect(plano).toEqual([
      "SEARCH webhook_eventos USING COVERING INDEX webhook_eventos_por_resultado (resultado=? AND recebido_em>?)",
    ]);
    expect(linhasLidas).toBeLessThanOrEqual(1.1 * volume.entregas24h);
  });

  it("última entrega e última da campanha: o MAX para no topo do índice (com ORDER BY ... LIMIT 1, ~34 mil)", async () => {
    const ultima = await medir({ sql: ULTIMA_ENTREGA, valores: [] });
    const daCampanha = await medir({
      sql: ULTIMA_DA_CAMPANHA,
      valores: [SLUG],
    });
    expect(ultima.plano).toEqual([
      "SEARCH webhook_eventos USING COVERING INDEX webhook_eventos_por_resultado (resultado=?)",
    ]);
    // A da campanha: o índice parcial da 0007 (só as entregas da campanha, por slug).
    expect(daCampanha.plano).toEqual([
      "SEARCH webhook_eventos USING INDEX webhook_eventos_da_campanha_por_slug (slug=?)",
    ]);
    // Medido: 10 (2 por resultado) e 1.
    expect(ultima.linhasLidas).toBeLessThanOrEqual(20);
    expect(daCampanha.linhasLidas).toBeLessThanOrEqual(3);
  });

  it("última da campanha com o slug trocado depois de entregas processadas: 0 linha lida (pelo índice (resultado, recebido_em), ~17,6 mil)", async () => {
    // Todas as entregas da campanha semeadas têm o slug antigo (SLUG); o novo não tem nenhuma.
    const { plano, linhasLidas, linhas } = await medir({
      sql: ULTIMA_DA_CAMPANHA,
      valores: ["rifa-kids-slug-novo"],
    });
    expect(linhas).toBe(1);
    expect(plano).toEqual([
      "SEARCH webhook_eventos USING INDEX webhook_eventos_da_campanha_por_slug (slug=?)",
    ]);
    expect(linhasLidas).toBeLessThanOrEqual(3);
  });

  it("última aprovação: o índice (status, aprovado_em), 1 linha lida", async () => {
    const { plano, linhasLidas } = await medir({
      sql: ULTIMO_APROVADO,
      valores: [1],
    });
    expect(plano).toEqual([
      "SEARCH pedidos USING INDEX pedidos_por_status_aprovacao (status=?)",
    ]);
    expect(linhasLidas).toBeLessThanOrEqual(5);
  });

  it("erro recente: só os erro_validacao das 24 h", async () => {
    for (const slug of [SLUG, null]) {
      const { plano, linhasLidas } = await medir({
        sql: ERRO_RECENTE,
        valores: [DESDE_24H, ESPACOS_DO_TRIM, slug],
      });
      expect(plano).toContain(
        "SEARCH webhook_eventos USING INDEX webhook_eventos_por_resultado (resultado=? AND recebido_em>?)",
      );
      expect(linhasLidas).toBeLessThanOrEqual(volume.erros24h + 5);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// As requisições inteiras, pelas rotas reais
// ---------------------------------------------------------------------------------------------------

describe("orçamento por requisição (rotas reais, todas as leituras contadas)", () => {
  it("pedidos, 1ª página: uma ida ao banco, a página e os totais (~134 + ~7.001)", async () => {
    const { corpo, contagem } = await requisitar(ROTAS.listarPedidos.caminho);
    ROTAS.listarPedidos.sucesso.corpo.parse(corpo);
    expect(contagem.idas).toBe(1);
    expect(contagem.linhasLidas).toBeLessThanOrEqual(
      200 + 1.1 * volume.pedidos,
    );
  });

  it("pedidos, carregar mais: sem os totais, ~141 linhas lidas", async () => {
    const primeira = await requisitar(ROTAS.listarPedidos.caminho);
    const { proximo } = ROTAS.listarPedidos.sucesso.corpo.parse(primeira.corpo);
    const { corpo, contagem } = await requisitar(
      `${ROTAS.listarPedidos.caminho}?antes_de=${proximo}`,
    );
    expect(ROTAS.listarPedidos.sucesso.corpo.parse(corpo).totais).toBeNull();
    expect(contagem.idas).toBe(1);
    expect(contagem.linhasLidas).toBeLessThanOrEqual(210);
  });

  it("entregas por resultado: uma ida, ~51 linhas lidas", async () => {
    const { corpo, contagem } = await requisitar(
      `${ROTAS.entregasWebhook.caminho}?resultado=erro_validacao`,
    );
    ROTAS.entregasWebhook.sucesso.corpo.parse(corpo);
    expect(contagem.idas).toBe(1);
    expect(contagem.linhasLidas).toBeLessThanOrEqual(60);
  });

  it("estado com o slug da campanha trocado depois de entregas processadas: o mesmo orçamento, nunca_recebeu", async () => {
    // O único teste que escreve: troca o slug da campanha e desfaz no fim.
    await db
      .prepare(
        "UPDATE campanhas SET slug_rifei = 'rifa-kids-slug-novo' WHERE id = 1",
      )
      .run();
    try {
      const { corpo, contagem } = await requisitar(ROTAS.estadoWebhook.caminho);
      const estado = ROTAS.estadoWebhook.sucesso.corpo.parse(corpo);
      // Dia da campanha, 12:00 em ponto: ainda não passou de 4 h desde as 8h (D16).
      expect(estado.situacao).toBe("nunca_recebeu");
      expect(estado.ultima_processada_em).toBeNull();
      expect(contagem.idas).toBe(2);
      expect(contagem.linhasLidas).toBeLessThanOrEqual(
        1.1 * volume.entregas24h + 100,
      );
    } finally {
      await db
        .prepare("UPDATE campanhas SET slug_rifei = ?1 WHERE id = 1")
        .bind(SLUG)
        .run();
    }
  });

  it("estado: duas idas (a campanha e um lote), ~940 linhas lidas (≲ 1 mil)", async () => {
    const { corpo, contagem } = await requisitar(ROTAS.estadoWebhook.caminho);
    const estado = ROTAS.estadoWebhook.sucesso.corpo.parse(corpo);
    // Os 2% de erro_validacao semeados têm o slug da campanha: o alerta acende (a leitura é a mesma em toda situação).
    expect(estado.situacao).toBe("erros_recentes");
    expect(contagem.idas).toBe(2);
    expect(contagem.linhasLidas).toBeLessThanOrEqual(
      1.1 * volume.entregas24h + 100,
    );
  });
});
