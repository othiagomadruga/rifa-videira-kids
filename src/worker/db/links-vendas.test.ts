// RIFA-046 (D24, OBRIGATÓRIO 2; CA6): o orçamento do D1 do link de vendas (D10), com o volume sintético dos testes
// de desempenho: 2 redes, 6 discipuladores e 36 células, cada uma com um afiliado, 6 delas (as do discipulador 1) com
// um segundo, 2 afiliados sem célula e ~7 mil pedidos aprovados (que a leitura nunca toca).
// - As consultas: um db.batch com três (a campanha ativa, as células do escopo, os afiliados delas), sem pedidos,
//   com as linhas lidas (`meta.rows_read`) EXATAS em cada escopo e os planos travados (EXPLAIN QUERY PLAN): os
//   afiliados sempre pelo índice afiliados_por_celula, as células pelos índices da hierarquia.
// - As rotas no app real: as idas ao D1 por requisição (a sessão e um lote), as linhas lidas da requisição inteira no
//   líder, no discipulador, na rede e na coordenação, e o PUT do modelo (as escritas também).
// Uma linha a mais (uma consulta nova, um plano que mudou, um índice que desviou o planejador) falha aqui. Os números
// estão em docs/modelo-de-dados.md, seção 11.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ROTAS_LINK_VENDAS,
  respostaLinksVendasSchema,
  respostaMeusLinksVendasSchema,
  type PapelHierarquia,
} from "../../shared/contracts";
import app from "../index";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
} from "../test/acesso-teste";
import { bancoQueRegistra } from "../test/banco-que-registra";
import {
  CAMPANHA_DE_CARGA,
  CELULAS_DE_CARGA,
  bancoQueConta,
  limparBanco,
  semearCampanha,
  semearHierarquiaDeCarga,
  semearPedidosDeCarga,
} from "../test/painel-apoio";
import {
  GRAVAR_MODELO_LINK_VENDAS,
  LER_CAMPANHA_LINKS_VENDAS,
  REGISTRAR_MODELO_LINK_VENDAS,
  lerLinksVendas,
  sqlAfiliadosLinksVendas,
  sqlCelulasLinksVendas,
  type EscopoLinksVendas,
} from "./links-vendas";

const db = env.DB;
const MODELO = "https://rifei.com.br/{slug}?afiliado={afiliado}";
/** Pedidos aprovados por célula por dia no volume sintético (36 × 24 × 8 = 6.912). */
const PEDIDOS_POR_CELULA_POR_DIA = 8;

/** Os alvos medidos: a célula 7 (do discipulador 1, com dois afiliados), o discipulador 1 e a rede 1. */
const ALVO = { lider: 7, discipulador: 1, rede: 1 } as const satisfies Record<
  PapelHierarquia,
  number
>;
const ESCOPOS: Record<PapelHierarquia | "coordenacao", EscopoLinksVendas> = {
  lider: { tipo: "celula", id: ALVO.lider },
  discipulador: { tipo: "discipulador", id: ALVO.discipulador },
  rede: { tipo: "rede", id: ALVO.rede },
  coordenacao: "todas",
};

/**
 * O que cada escopo devolve: as células e os afiliados vinculados delas. O discipulador 1 tem as células 1, 7, 13,
 * 19, 25 e 31 (todas com dois afiliados); a rede 1, os discipuladores 1 a 3 (18 células, 24 afiliados).
 */
const DEVOLVE = {
  lider: { celulas: 1, afiliados: 2 },
  discipulador: { celulas: 6, afiliados: 12 },
  rede: { celulas: 18, afiliados: 24 },
  coordenacao: { celulas: CELULAS_DE_CARGA, afiliados: CELULAS_DE_CARGA + 6 },
} as const;

/**
 * As linhas lidas de cada consulta do lote, medidas no D1 local do workerd em 2026-11-12 (D10; docs/modelo-de-dados.md,
 * seção 11). A campanha: 1 linha, pelo índice parcial. As células: a célula, o discipulador e a rede de cada uma (3 por
 * célula na coordenação; com as entradas dos índices da hierarquia no discipulador e na rede). Os afiliados: pelo
 * índice, mais as células do escopo lidas na subconsulta do discipulador e da rede; na coordenação, uma por afiliado
 * vinculado (os sem célula e as células não são lidos). Nenhum pedido.
 */
const LIDAS = {
  lider: { campanha: 1, celulas: 3, afiliados: 3 },
  discipulador: { campanha: 1, celulas: 9, afiliados: 31 },
  rede: { campanha: 1, celulas: 26, afiliados: 85 },
  coordenacao: { campanha: 1, celulas: 108, afiliados: 42 },
} as const;

/** Os planos (EXPLAIN QUERY PLAN) das células e dos afiliados de cada escopo. */
const PLANOS = {
  lider: {
    celulas: [
      "SEARCH c USING INTEGER PRIMARY KEY (rowid=?)",
      "SEARCH d USING INTEGER PRIMARY KEY (rowid=?)",
      "SEARCH r USING INTEGER PRIMARY KEY (rowid=?)",
    ],
    afiliados: [
      "SEARCH afiliados USING INDEX afiliados_por_celula (celula_id=?)",
    ],
  },
  discipulador: {
    celulas: [
      "SEARCH d USING INTEGER PRIMARY KEY (rowid=?)",
      "SEARCH r USING INTEGER PRIMARY KEY (rowid=?)",
      "SEARCH c USING INDEX celulas_por_discipulador (discipulador_id=?)",
    ],
    afiliados: [
      "SEARCH afiliados USING INDEX afiliados_por_celula (celula_id=?)",
      "LIST SUBQUERY 1",
      "SEARCH celulas USING COVERING INDEX celulas_por_discipulador (discipulador_id=?)",
    ],
  },
  rede: {
    celulas: [
      "SEARCH r USING INTEGER PRIMARY KEY (rowid=?)",
      "SEARCH d USING INDEX discipuladores_por_rede (rede_id=?)",
      "SEARCH c USING INDEX celulas_por_discipulador (discipulador_id=?)",
    ],
    afiliados: [
      "SEARCH afiliados USING INDEX afiliados_por_celula (celula_id=?)",
      "LIST SUBQUERY 1",
      "SEARCH d USING COVERING INDEX discipuladores_por_rede (rede_id=?)",
      "SEARCH c USING COVERING INDEX celulas_por_discipulador (discipulador_id=?)",
    ],
  },
  coordenacao: {
    // Todas as células: a lista inteira, com o discipulador e a rede de cada uma pela chave.
    celulas: [
      "SCAN c",
      "SEARCH d USING INTEGER PRIMARY KEY (rowid=?)",
      "SEARCH r USING INTEGER PRIMARY KEY (rowid=?)",
    ],
    // Só os vinculados, pelo índice (os sem célula ficam de fora sem ser lidos).
    afiliados: [
      "SEARCH afiliados USING INDEX afiliados_por_celula (celula_id>?)",
    ],
  },
} as const;

/**
 * As linhas lidas pela sessão em cada papel (a mesma consulta de toda rota autenticada; minha-desempenho.test.ts):
 * a sessão, o usuário e o alvo com a hierarquia (o líder 5) e, no discipulador e na rede, a campanha ativa da chave de
 * acesso do papel (RIFA-029), lida na mesma consulta; a coordenação, a sessão e o usuário.
 */
const LIDAS_DA_SESSAO = {
  lider: 5,
  discipulador: 5,
  rede: 4,
  coordenacao: 2,
} as const;

const PAPEIS = ["lider", "discipulador", "rede", "coordenacao"] as const;

const comBind = (sql: string, escopo: EscopoLinksVendas) =>
  escopo === "todas" ? db.prepare(sql) : db.prepare(sql).bind(escopo.id);

async function planoDe(sql: string, escopo: EscopoLinksVendas) {
  const { results } = await comBind(`EXPLAIN QUERY PLAN ${sql}`, escopo).all<{
    detail: string;
  }>();
  return results.map((passo) => passo.detail);
}

const sessoes = {} as Record<(typeof PAPEIS)[number], Record<string, string>>;
let admin: Record<string, string>;

beforeAll(async () => {
  await limparBanco(db);
  await semearHierarquiaDeCarga(db);
  await db.batch([
    // Um segundo afiliado nas células do discipulador 1 (vinculado depois) e dois afiliados sem célula.
    db.prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
       SELECT 2000 + id, id, 'manual', '2026-11-21T12:00:00.000Z' FROM celulas WHERE discipulador_id = 1`,
    ),
    db.prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
       VALUES (9001, NULL, 'webhook', NULL), (9002, NULL, 'webhook', NULL)`,
    ),
  ]);
  const campanhaId = await semearCampanha(db, CAMPANHA_DE_CARGA);
  await semearPedidosDeCarga(db, campanhaId, PEDIDOS_POR_CELULA_POR_DIA);
  await db
    .prepare("UPDATE campanhas SET link_vendas_modelo = ?1 WHERE ativa = 1")
    .bind(MODELO)
    .run();
  for (const papel of ["lider", "discipulador", "rede"] as const)
    sessoes[papel] = await cabecalhosDeSessaoDaHierarquia(papel, ALVO[papel]);
  sessoes.coordenacao = await cabecalhosDeSessao("coordenacao");
  admin = await cabecalhosDeSessao("admin");
});

describe("as consultas do lote (lerLinksVendas)", () => {
  it("o volume: ~7 mil pedidos aprovados que a leitura não toca", async () => {
    const pedidos = await db
      .prepare("SELECT count(*) AS n FROM pedidos WHERE status = 'approved'")
      .first<{ n: number }>();
    expect(pedidos?.n).toBeGreaterThan(6_900);
  });

  it.each(PAPEIS)(
    "%s: uma ida (um lote com três consultas), as linhas lidas exatas de cada uma e nenhum pedido",
    async (papel) => {
      const escopo = ESCOPOS[papel];
      const registrado = bancoQueRegistra(db);
      const contado = bancoQueConta(registrado.db);
      const leitura = await lerLinksVendas(contado.db, escopo);

      expect(contado.contagem.idas).toBe(1);
      expect(registrado.comandos.map((comando) => comando.sql)).toEqual([
        LER_CAMPANHA_LINKS_VENDAS,
        sqlCelulasLinksVendas(escopo),
        sqlAfiliadosLinksVendas(escopo),
      ]);
      expect(
        registrado.comandos.some((comando) =>
          /pedidos|vendas_aprovadas|lider_telefone|lider_email|rotulo/.test(
            comando.sql,
          ),
        ),
      ).toBe(false);
      const [campanha, celulas, afiliados] = registrado.comandos.map(
        (comando) => comando.lidas,
      );
      expect({ campanha, celulas, afiliados }).toEqual(LIDAS[papel]);
      expect({
        celulas: leitura?.celulas.length,
        afiliados: leitura?.afiliados.length,
      }).toEqual(DEVOLVE[papel]);
    },
  );

  it.each(PAPEIS)(
    "%s: os planos (os afiliados pelo índice afiliados_por_celula; a campanha pelo índice parcial)",
    async (papel) => {
      const escopo = ESCOPOS[papel];
      expect(await planoDe(LER_CAMPANHA_LINKS_VENDAS, "todas")).toEqual([
        "SEARCH campanhas USING INDEX campanhas_uma_ativa (ativa=?)",
      ]);
      expect({
        celulas: await planoDe(sqlCelulasLinksVendas(escopo), escopo),
        afiliados: await planoDe(sqlAfiliadosLinksVendas(escopo), escopo),
      }).toEqual(PLANOS[papel]);
    },
  );

  it("as linhas lidas não crescem com os pedidos: o dobro de pedidos, as mesmas linhas", async () => {
    const antes = bancoQueRegistra(db);
    await lerLinksVendas(antes.db, "todas");
    const campanhaId = (await db
      .prepare("SELECT id FROM campanhas WHERE ativa = 1")
      .first<{ id: number }>())!.id;
    await db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em)
         SELECT 'EXTRA-' || id, ?1, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em
         FROM pedidos WHERE campanha_id = ?1`,
      )
      .bind(campanhaId)
      .run();
    const depois = bancoQueRegistra(db);
    await lerLinksVendas(depois.db, "todas");
    expect(depois.comandos.map((comando) => comando.lidas)).toEqual(
      antes.comandos.map((comando) => comando.lidas),
    );
  });
});

describe("as rotas no app real: idas e linhas da requisição inteira", () => {
  function requisitar(
    metodo: "GET" | "PUT",
    caminho: string,
    cabecalhos: Record<string, string>,
    banco: D1Database,
    corpo?: unknown,
  ) {
    const headers = new Headers(cabecalhos);
    if (corpo !== undefined) headers.set("Content-Type", "application/json");
    return Promise.resolve(
      app.request(
        `${ORIGEM}${caminho}`,
        {
          method: metodo,
          headers,
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
        },
        { ...env, DB: banco },
      ),
    );
  }

  it.each(PAPEIS)(
    "%s: duas idas (a sessão e o lote), as linhas da sessão e do lote exatas",
    async (papel) => {
      const contado = bancoQueConta(db);
      const caminho =
        papel === "coordenacao"
          ? ROTAS_LINK_VENDAS.linksVendas.caminho
          : ROTAS_LINK_VENDAS.meusLinksVendas.caminho;
      const res = await requisitar("GET", caminho, sessoes[papel], contado.db);
      expect(res.status).toBe(200);
      const corpo: unknown = await res.json();
      const itens = (
        papel === "coordenacao"
          ? respostaLinksVendasSchema.parse(corpo)
          : respostaMeusLinksVendasSchema.parse(corpo)
      ).itens;
      expect(itens).toHaveLength(DEVOLVE[papel].celulas);
      expect(itens.flatMap((item) => item.links)).toHaveLength(
        DEVOLVE[papel].afiliados,
      );

      const lote = Object.values(LIDAS[papel]).reduce((a, b) => a + b, 0);
      expect({
        idas: contado.contagem.idas,
        lote: contado.contagem.linhasLidas,
        sessao:
          contado.contagem.linhasLidasTotal - contado.contagem.linhasLidas,
      }).toEqual({ idas: 2, lote, sessao: LIDAS_DA_SESSAO[papel] });
    },
  );

  it("PUT do modelo (admin): duas idas (a sessão e um lote com a trilha, a gravação e a lista); as linhas lidas e escritas exatas; o mesmo modelo de novo não escreve", async () => {
    const OUTRO = "https://rifei.com.br/{slug}/a/{afiliado}";
    const registrado = bancoQueRegistra(db);
    const contado = bancoQueConta(registrado.db);
    const res = await requisitar(
      "PUT",
      ROTAS_LINK_VENDAS.salvarModeloLinkVendas.caminho,
      admin,
      contado.db,
      { modelo: OUTRO },
    );
    expect(res.status).toBe(200);
    expect(respostaLinksVendasSchema.parse(await res.json()).modelo).toBe(
      OUTRO,
    );
    expect(contado.contagem.idas).toBe(2);
    const doLote = registrado.comandos.slice(1);
    expect(doLote.map((comando) => comando.sql)).toEqual([
      REGISTRAR_MODELO_LINK_VENDAS,
      GRAVAR_MODELO_LINK_VENDAS,
      LER_CAMPANHA_LINKS_VENDAS,
      sqlCelulasLinksVendas("todas"),
      sqlAfiliadosLinksVendas("todas"),
    ]);
    const { campanha, celulas, afiliados } = LIDAS.coordenacao;
    expect(doLote.map(({ lidas, escritas }) => ({ lidas, escritas }))).toEqual([
      // A trilha: a linha da campanha ativa (pelo índice parcial) e o autor (a chave estrangeira); a linha e a entrada
      // do índice auditoria_por_usuario escritas.
      { lidas: 2, escritas: 2 },
      // A gravação: a linha da campanha ativa; 1 escrita (a linha; o índice parcial não muda).
      { lidas: 1, escritas: 1 },
      { lidas: campanha, escritas: 0 },
      { lidas: celulas, escritas: 0 },
      { lidas: afiliados, escritas: 0 },
    ]);

    registrado.comandos.length = 0;
    const igual = await requisitar(
      "PUT",
      ROTAS_LINK_VENDAS.salvarModeloLinkVendas.caminho,
      admin,
      registrado.db,
      { modelo: OUTRO },
    );
    expect(igual.status).toBe(200);
    expect(
      registrado.comandos
        .slice(1, 3)
        .map(({ lidas, escritas }) => ({ lidas, escritas })),
    ).toEqual([
      { lidas: 1, escritas: 0 },
      { lidas: 1, escritas: 0 },
    ]);
  });
});
