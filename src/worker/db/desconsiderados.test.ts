// RIFA-028 (D20, OBRIGATÓRIO 4 e 7): o pedido desconsiderado pelo admin sai de TODO lugar que soma pedidos, nas
// consultas de src/worker/db/ (o painel e a visão individual, a view lida pela adesão e pelos afiliados, o mapa, os
// totais da lista e as somas da conferência), e continua onde é listado (a lista de pedidos, com o selo e o filtro,
// e a de suspeitos), sem que o webhook o devolva às contas. A desconsideração é gravada à mão aqui (as rotas que a
// gravam são da tarefa -api); o mesmo cenário passa por cada leitura. O banco é do arquivo de teste.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import expiredOrder from "../../../test/fixtures/rifei/expired_order.json";
import newOrderAfiliado from "../../../test/fixtures/rifei/new_order.afiliado.json";
import paidOrderAfiliado from "../../../test/fixtures/rifei/paid_order.afiliado.json";
import {
  ROTAS,
  payloadRifeiSchema,
  redigirPayloadRifei,
  type ItemPedido,
} from "../../shared/contracts";
import {
  AGORA,
  DESCONSIDERADO_EM,
  aprovado,
  desconsiderado,
  dia,
  semearCenario,
} from "../test/painel-apoio";
import { listarAfiliados, obterAdesao, salvarAfiliado } from "./adesao";
import { listarPedidos } from "./lista-pedidos";
import { lerMapaDdd } from "./mapa-ddd";
import { lerEntradaDoCalculo } from "./painel";
import { MAX_TENTATIVAS, processarEventoPedido } from "./pedidos";
import { listarPedidosSuspeitos } from "./pedidos-suspeitos";
import { lerParaAgregado, lerParaPorPedido } from "./reconciliacao";
import { SEM_CACHE_DA_BASE, lerBaseDaVisao } from "./visao-individual";

const db = env.DB;
const relogio = () => AGORA;
/** 12:00 em Belém do dia `n` da campanha. */
const meioDia = (n: number) => `${dia(n)}T15:00:00.000Z`;

// Os que contam: Ágape (101) e Betel (102) vendem; um sem afiliado.
const A1 = { ...aprovado(101, meioDia(2), 2), pais: "55", ddd: "91" };
const A2 = aprovado(null, meioDia(3), 4);
const A3 = aprovado(102, meioDia(4), 3);
// Os desconsiderados: a única venda da Canaã (103), um sem afiliado (fraude), um estorno da Ágape (suspeito) e um
// pedido de teste da Ágape ainda não pago.
const D1 = desconsiderado({
  ...aprovado(103, meioDia(2), 5),
  pais: "55",
  ddd: "91",
});
const D2 = desconsiderado(aprovado(null, meioDia(3), 7), "fraude");
const D3 = desconsiderado(aprovado(101, meioDia(4), 6), "estorno");
const D4 = desconsiderado({
  ...aprovado(101, meioDia(5), 1),
  status: "in_process",
  aprovado_em: null,
});
const CONTAM = [A1, A2, A3];
const DESCONSIDERADOS = [D1, D2, D3, D4];
const OBSERVACAO = "compra de teste na reunião";

const somar = <T>(lista: readonly T[], campo: (item: T) => number) =>
  lista.reduce((soma, item) => soma + campo(item), 0);

let campanhaId: number;

beforeAll(async () => {
  ({ campanhaId } = await semearCenario({
    pedidos: [...CONTAM, ...DESCONSIDERADOS],
  }));
  await db.batch([
    db
      .prepare(
        "UPDATE pedidos SET desconsiderado_observacao = ?1 WHERE id = ?2",
      )
      .bind(OBSERVACAO, D2.id),
    // O estorno também estava na lista de suspeitos (o webhook o marcou ao aprovar).
    db
      .prepare(
        `INSERT INTO pedidos_suspeitos (pedido_id, qtd_bilhetes, total_centavos, esperado_centavos, motivos, marcado_em)
         VALUES (?1, 6, 12000, 12000,
           '[{"caminho":["numbers_count"],"codigo":"quantidade_acima_do_teto","mensagem":"x","ocorrencias":1}]',
           '2026-11-27T15:00:01.000Z')`,
      )
      .bind(D3.id),
  ]);
});

describe("somam só o que conta", () => {
  it("o painel (metas, rankings, público, bumbo) e a visão individual: as vendas sem nenhum desconsiderado", async () => {
    const leitura = await lerEntradaDoCalculo(db, relogio);
    if (!leitura.ok) throw new Error(leitura.mensagem);
    const { vendas } = leitura.entrada;
    expect(somar(vendas, (venda) => venda.pedidos)).toBe(3);
    expect(somar(vendas, (venda) => venda.bilhetes)).toBe(9);
    expect(vendas.filter((venda) => venda.celula_id === 3)).toEqual([]);

    const visao = await lerBaseDaVisao(
      db,
      AGORA,
      { tipo: "celula", id: 3, nome: "Célula Canaã", divisao: "jovens" },
      SEM_CACHE_DA_BASE,
    );
    if (!visao.ok) throw new Error(visao.mensagem);
    expect(visao.base.entrada.vendas).toEqual(vendas);
  });

  it("a view (afiliados): vendas, primeira e última venda de cada afiliado e o sem afiliado; a resposta do PUT", async () => {
    const { itens, sem_afiliado } = await listarAfiliados(db, {});
    const afiliado = (id: number) =>
      itens.find((item) => item.affiliate_id === id)!;
    expect(afiliado(101)).toMatchObject({
      vendas: { pedidos_aprovados: 1, bilhetes: 2, total_centavos: 4000 },
      primeira_venda_em: A1.aprovado_em,
      ultima_venda_em: A1.aprovado_em,
    });
    expect(afiliado(103)).toMatchObject({
      vendas: { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 },
      primeira_venda_em: null,
      ultima_venda_em: null,
    });
    expect(sem_afiliado).toEqual({
      pedidos_aprovados: 1,
      bilhetes: 4,
      total_centavos: 8000,
    });

    const salvo = await salvarAfiliado(
      db,
      103,
      { celula_id: 3 },
      "2026-12-01T12:00:00.000Z",
    );
    expect(salvo).toMatchObject({
      ok: true,
      afiliado: { vendas: { pedidos_aprovados: 0 }, primeira_venda_em: null },
    });
  });

  it('a adesão: a célula que só tem venda desconsiderada não "Já vendeu" (e não entra no com_venda)', async () => {
    const { itens, resumo } = await obterAdesao(db);
    const celula = (id: number) => itens.find((item) => item.celula_id === id)!;
    expect(celula(3)).toMatchObject({
      pedidos_aprovados: 0,
      primeira_venda_em: null,
    });
    expect(celula(1)).toMatchObject({
      pedidos_aprovados: 1,
      primeira_venda_em: A1.aprovado_em,
    });
    expect(resumo.com_venda).toBe(2);
  });

  it("o mapa por DDD: só o aprovado que conta no DDD 91", async () => {
    const leitura = await lerMapaDdd(db, relogio, { periodo: "campanha" });
    if (!leitura.ok) throw new Error(leitura.mensagem);
    expect(leitura.linhas).toEqual(
      expect.arrayContaining([
        { pais: "55", ddd: "91", pedidos: 1, bilhetes: 2, centavos: 4000 },
      ]),
    );
    expect(somar(leitura.linhas, (linha) => linha.pedidos)).toBe(3);
  });

  it("a conferência: o total do sistema, os ausentes do arquivo e as somas sem o desconsiderado; a busca pelos códigos o traz com a marca", async () => {
    const porPedido = await lerParaPorPedido(db, {
      campanhaId,
      codigos: [A1.id, D1.id, D2.id, D4.id, "NAO-EXISTE"],
      periodoUtc: null,
      comAusentes: true,
    });
    expect(porPedido.aprovados).toEqual({
      pedidos_aprovados: 3,
      bilhetes: 9,
      total_centavos: 18000,
    });
    expect(porPedido.pagosNoPeriodo).toBe(3);
    // Fora do arquivo e que contam: A2 e A3 (o estorno D3 não está no arquivo e não conta: não é "ausente").
    expect(porPedido.ausentes.itens.map((item) => item.id).sort()).toEqual(
      [A2.id, A3.id].sort(),
    );
    expect(porPedido.encontrados.get(A1.id)?.desconsiderado).toBeNull();
    expect(porPedido.encontrados.get(D1.id)).toMatchObject({
      status: "approved",
      desconsiderado: {
        motivo: "teste",
        observacao: null,
        em: DESCONSIDERADO_EM,
      },
    });
    expect(porPedido.encontrados.get(D2.id)?.desconsiderado).toEqual({
      motivo: "fraude",
      observacao: OBSERVACAO,
      em: DESCONSIDERADO_EM,
    });
    expect(porPedido.encontrados.get(D4.id)).toMatchObject({
      status: "in_process",
      desconsiderado: { motivo: "teste" },
    });

    const agregado = await lerParaAgregado(db, {
      campanhaId,
      periodoUtc: null,
      deslocamento: "-180 minutes",
    });
    expect(agregado.total).toEqual({
      pedidos: 3,
      bilhetes: 9,
      centavos: 18000,
    });
    expect(somar(agregado.porDia ?? [], (linha) => linha.soma.pedidos)).toBe(3);
    expect(
      agregado.porAfiliado
        .filter((linha) => linha.affiliate_id === 103)
        .map((linha) => linha.soma.pedidos),
    ).toEqual([]);
  });
});

describe("continuam listados, com a marca", () => {
  const consulta = (
    filtros: Partial<Parameters<typeof listarPedidos>[1]> = {},
  ) => ROTAS.listarPedidos.consulta.parse({ limite: "50", ...filtros });

  it("a lista de pedidos: todos, com o selo e a origem; os totais por status só com o que conta", async () => {
    const resposta = await listarPedidos(db, consulta(), null);
    ROTAS.listarPedidos.sucesso.corpo.parse(resposta);
    const porId = new Map(resposta.itens.map((item) => [item.id, item]));
    expect(porId.size).toBe(7);
    expect(porId.get(A1.id)).toMatchObject({
      desconsiderado: null,
      origem: "webhook",
    });
    expect(porId.get(D2.id)?.desconsiderado).toEqual({
      motivo: "fraude",
      observacao: OBSERVACAO,
      em: DESCONSIDERADO_EM,
    });
    expect(porId.get(D3.id)).toMatchObject({
      status: "approved",
      suspeito: true,
      desconsiderado: { motivo: "estorno", observacao: null },
    });
    expect(resposta.totais).toEqual({
      in_process: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
      approved: { pedidos: 3, bilhetes: 9, total_centavos: 18000 },
      expired: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
    });
  });

  it("o filtro desconsiderado: true traz só eles, false só os que contam; os totais não mudam com ele", async () => {
    const ids = (itens: ItemPedido[]) => itens.map((item) => item.id).sort();
    const so = await listarPedidos(
      db,
      consulta({ desconsiderado: "true" } as never),
      null,
    );
    const contam = await listarPedidos(
      db,
      consulta({ desconsiderado: "false" } as never),
      null,
    );
    const todos = await listarPedidos(db, consulta(), null);
    expect(ids(so.itens)).toEqual(
      DESCONSIDERADOS.map((pedido) => pedido.id).sort(),
    );
    expect(ids(contam.itens)).toEqual(CONTAM.map((pedido) => pedido.id).sort());
    expect(so.totais).toEqual(todos.totais);
    expect(contam.totais).toEqual(todos.totais);
    // Com os outros filtros (célula, sem célula, id), o mesmo.
    const daAgape = await listarPedidos(
      db,
      consulta({ celula_id: "1", desconsiderado: "true" } as never),
      null,
    );
    expect(ids(daAgape.itens)).toEqual([D3.id, D4.id].sort());
    const semCelula = await listarPedidos(
      db,
      consulta({ sem_celula: "true", desconsiderado: "false" } as never),
      null,
    );
    expect(ids(semCelula.itens)).toEqual([A2.id]);
    const peloId = await listarPedidos(
      db,
      consulta({ id: D1.id, desconsiderado: "false" } as never),
      null,
    );
    expect(peloId.itens).toEqual([]);
  });

  it("a lista de suspeitos: o desconsiderado continua nela e no total, com a desconsideração", async () => {
    const resposta = await listarPedidosSuspeitos(db);
    ROTAS.pedidosSuspeitos.sucesso.corpo.parse(resposta);
    expect(resposta.total).toBe(1);
    expect(resposta.itens).toEqual([
      expect.objectContaining({
        pedido_id: D3.id,
        desconsiderado: {
          motivo: "estorno",
          observacao: null,
          em: DESCONSIDERADO_EM,
        },
      }),
    ]);
  });
});

describe("o webhook nunca escreve na desconsideração (db/pedidos.ts)", () => {
  const evento = (fixture: unknown, recebidoEm: string) =>
    processarEventoPedido(db, {
      campanhaId,
      precoBilheteCentavos: 2000,
      payload: redigirPayloadRifei(
        payloadRifeiSchema.parse({
          ...(fixture as object),
          slug: "rifa-videira-kids-teste",
        }),
      ),
      avisos: [],
      recebidoEm,
    });
  const lerPedido = (id: string) =>
    db
      .prepare(
        `SELECT status, affiliate_id, desconsiderado_em, desconsiderado_motivo, desconsiderado_observacao
         FROM pedidos WHERE id = ?1`,
      )
      .bind(id)
      .first();

  it("o paid_order de um pedido de teste in_process desconsiderado o aprova, mas ele continua desconsiderado e fora das contas", async () => {
    const id = newOrderAfiliado.id;
    await evento(newOrderAfiliado, "2026-11-25T15:00:00.000Z");
    await db
      .prepare(
        `UPDATE pedidos SET desconsiderado_em = ?2, desconsiderado_motivo = 'teste',
           desconsiderado_observacao = ?3 WHERE id = ?1`,
      )
      .bind(id, DESCONSIDERADO_EM, OBSERVACAO)
      .run();
    const antes = await lerEntradaDoCalculo(db, relogio);

    expect(
      await evento(paidOrderAfiliado, "2026-11-25T15:05:00.000Z"),
    ).toMatchObject({
      resultado: "processado",
    });
    // Um evento repetido também não mexe.
    expect(
      await evento(paidOrderAfiliado, "2026-11-25T15:06:00.000Z"),
    ).toMatchObject({
      resultado: "duplicado",
    });

    expect(await lerPedido(id)).toEqual({
      status: "approved",
      affiliate_id: paidOrderAfiliado.affiliate_id,
      desconsiderado_em: DESCONSIDERADO_EM,
      desconsiderado_motivo: "teste",
      desconsiderado_observacao: OBSERVACAO,
    });
    const depois = await lerEntradaDoCalculo(db, relogio);
    expect(depois.ok && depois.entrada.vendas).toEqual(
      antes.ok && antes.entrada.vendas,
    );
    const visto = await db
      .prepare(
        "SELECT count(*) AS n FROM vendas_aprovadas WHERE pedido_id = ?1",
      )
      .bind(id)
      .first<{ n: number }>();
    expect(visto?.n).toBe(0);
  });

  it("o expired_order de um pedido desconsiderado também não o toca", async () => {
    const id = expiredOrder.id;
    await db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, desconsiderado_em,
           desconsiderado_motivo)
         VALUES (?1, ?2, 'in_process', 1, 2000, ?3, 'outro')`,
      )
      .bind(id, campanhaId, DESCONSIDERADO_EM)
      .run();
    await evento(expiredOrder, "2026-11-26T15:00:00.000Z");
    expect(await lerPedido(id)).toMatchObject({
      status: "expired",
      desconsiderado_em: DESCONSIDERADO_EM,
      desconsiderado_motivo: "outro",
    });
  });

  it("a concorrência otimista do webhook tem 7 tentativas: a remoção do afiliado de teste (RIFA-031) e o afiliado tardio de novo (D20)", () => {
    expect(MAX_TENTATIVAS).toBe(7);
  });
});
