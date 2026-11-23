// RIFA-088 (D41): a célula atribuída à mão a uma venda sem célula pelo afiliado. PUT /api/admin/pedidos/:id/celula no
// app real (workerd, D1 local com as migrações), e a célula EFETIVA em todo lugar que liga venda a célula: lista de
// pedidos (filtros e origem), ranking unificado e por grupo, resumo ("sem célula"), /minha do líder, CSV da
// coordenação e relatório por e-mail. O webhook nunca mexe na atribuição; a célula do afiliado sempre vence.
import { env, exports } from "cloudflare:workers";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  itemPedidoSchema,
  respostaPainelResumoSchema,
  respostaPedidosSchema,
  respostaRankingGruposSchema,
  respostaRankingSchema,
  respostaVisaoIndividualSchema,
  somarDias,
  hojeNoFuso,
  type ItemPedido,
} from "../../shared/contracts";
import { TTL_BASE_DA_VISAO_MS } from "../db/visao-individual";
import { lerRelatorioDiario } from "../lib/relatorio-diario-envio";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
  erro,
} from "../test/acesso-teste";
import {
  AGORA,
  DADOS_CAMPANHA_RANKING_UNICO,
  PEDIDOS,
  aprovado,
  limparBanco,
  semearCenario,
  type PedidoTeste,
} from "../test/painel-apoio";

const db = env.DB;

/** Venda sem afiliado (link geral), com um número de bilhetes inconfundível. */
const SEM_AFILIADO: PedidoTeste = {
  ...aprovado(null, "2026-11-25T15:00:00.000Z", 37),
  id: "SEM-AFILIADO-37",
};
/** Venda de afiliado não vinculado (o 900 do cenário). */
const DE_ORFAO: PedidoTeste = {
  ...aprovado(900, "2026-11-26T15:00:00.000Z", 11),
  id: "DE-ORFAO-11",
};
/** Venda de afiliado com célula (o 101, da Ágape). */
const DE_AFILIADO: PedidoTeste = {
  ...aprovado(101, "2026-11-26T16:00:00.000Z", 5),
  id: "DE-AFILIADO-5",
};
/** Reserva sem afiliado, que o webhook aprova depois. */
const RESERVA: PedidoTeste = {
  id: "RESERVA-SEM-AFILIADO",
  affiliate_id: null,
  status: "in_process",
  aprovado_em: null,
  qtd_bilhetes: 3,
  total_centavos: 6000,
};

const CANAA = 3;
const DORCAS = 4;

let admin: Record<string, string>;
let coordenacao: Record<string, string>;
let liderCanaa: Record<string, string>;
let instante = AGORA.getTime();

function requisitar(
  metodo: "GET" | "PUT" | "DELETE",
  caminho: string,
  cabecalhos: Record<string, string>,
  corpo?: unknown,
): Promise<Response> {
  const headers = new Headers(cabecalhos);
  if (corpo !== undefined) headers.set("Content-Type", "application/json");
  return exports.default.fetch(`${ORIGEM}${caminho}`, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

const caminho = (id: string) =>
  `/api/admin/pedidos/${encodeURIComponent(id)}/celula`;

async function atribuir(
  id: string,
  celulaId: number | null,
  cabecalhos = admin,
): Promise<Response> {
  return requisitar("PUT", caminho(id), cabecalhos, { celula_id: celulaId });
}

async function atribuirOk(id: string, celulaId: number | null) {
  const res = await atribuir(id, celulaId);
  expect(res.status).toBe(200);
  return itemPedidoSchema.parse(await res.json());
}

async function lerJson<T>(
  schema: { parse: (valor: unknown) => T },
  url: string,
  cabecalhos = admin,
): Promise<T> {
  const res = await requisitar("GET", url, cabecalhos);
  expect(res.status).toBe(200);
  return schema.parse(await res.json());
}

const colunas = (id: string) =>
  db
    .prepare(
      `SELECT celula_atribuida_id, celula_atribuida_em, celula_atribuida_por
       FROM pedidos WHERE id = ?1`,
    )
    .bind(id)
    .first<{
      celula_atribuida_id: number | null;
      celula_atribuida_em: string | null;
      celula_atribuida_por: number | null;
    }>();

const trilha = async () =>
  (
    await db
      .prepare(
        `SELECT alvo, resumo FROM auditoria WHERE acao = 'pedido.atribuir_celula' ORDER BY id`,
      )
      .all<{ alvo: string; resumo: string }>()
  ).results;

/** Anda mais que o cache de 30 s da base da visão (/minha), no mesmo dia. */
function andarDoRelogio(): void {
  instante += TTL_BASE_DA_VISAO_MS + 1_000;
  vi.setSystemTime(instante);
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instante);
  admin = await cabecalhosDeSessao("admin");
  coordenacao = await cabecalhosDeSessao("coordenacao");
});

beforeEach(async () => {
  await semearCenario({
    campanha: DADOS_CAMPANHA_RANKING_UNICO,
    pedidos: [...PEDIDOS, SEM_AFILIADO, DE_ORFAO, DE_AFILIADO, RESERVA],
  });
  await db.prepare("DELETE FROM auditoria").run();
  liderCanaa = await cabecalhosDeSessaoDaHierarquia("lider", CANAA);
  andarDoRelogio();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  vi.useRealTimers();
  await limparBanco();
});

describe("PUT /api/admin/pedidos/:id/celula: atribuir e desfazer", () => {
  it("atribui a venda sem afiliado: 200 com a célula efetiva e a origem manual; grava quem e quando; trilha só com ids", async () => {
    const item = await atribuirOk(SEM_AFILIADO.id, CANAA);
    expect(item).toMatchObject({
      id: SEM_AFILIADO.id,
      affiliate_id: null,
      celula_id: CANAA,
      celula_nome: "Célula Canaã",
      celula_origem: "manual",
    });
    // Só o admin atribui: o item volta com o comprador, como na lista dele.
    expect(item.comprador).toBeDefined();
    const gravado = await colunas(SEM_AFILIADO.id);
    expect(gravado?.celula_atribuida_id).toBe(CANAA);
    expect(gravado?.celula_atribuida_em).toBe(new Date(instante).toISOString());
    expect(gravado?.celula_atribuida_por).toEqual(expect.any(Number));
    expect(await trilha()).toEqual([
      {
        alvo: `pedido:${SEM_AFILIADO.id}`,
        resumo: `Pedido "${SEM_AFILIADO.id}": célula atribuída à mão nenhuma → ${CANAA}`,
      },
    ]);
  });

  it("atribui a venda de afiliado não vinculado; trocar de célula e desfazer (null) também registram; repetir não", async () => {
    await atribuirOk(DE_ORFAO.id, CANAA);
    // Repetir a mesma célula: 200 como está, sem trilha.
    expect((await atribuirOk(DE_ORFAO.id, CANAA)).celula_id).toBe(CANAA);
    expect((await atribuirOk(DE_ORFAO.id, DORCAS)).celula_nome).toBe(
      "Célula Dorcas",
    );
    const desfeito = await atribuirOk(DE_ORFAO.id, null);
    expect(desfeito).toMatchObject({
      celula_id: null,
      celula_nome: null,
      celula_origem: null,
    });
    expect(await colunas(DE_ORFAO.id)).toEqual({
      celula_atribuida_id: null,
      celula_atribuida_em: null,
      celula_atribuida_por: null,
    });
    // Desfazer o que não existe: 200 como está, sem trilha.
    expect((await atribuirOk(DE_ORFAO.id, null)).celula_id).toBeNull();
    expect((await trilha()).map((linha) => linha.resumo)).toEqual([
      `Pedido "${DE_ORFAO.id}": célula atribuída à mão nenhuma → ${CANAA}`,
      `Pedido "${DE_ORFAO.id}": célula atribuída à mão ${CANAA} → ${DORCAS}`,
      `Pedido "${DE_ORFAO.id}": célula atribuída à mão ${DORCAS} → nenhuma`,
    ]);
    // Nada do comprador na trilha.
    for (const { resumo } of await trilha())
      expect(resumo).not.toMatch(/Comprador|\+55|@/);
  });

  it("404 pedido inexistente ou de outra campanha; 400 célula inexistente; 409 pedido com célula pelo afiliado; 400 corpo", async () => {
    expect(await (await atribuir("NAO-EXISTE", CANAA)).json()).toEqual(
      erro("nao_encontrado"),
    );
    // PT de outra campanha: o cenário tem um pedido da campanha inativa.
    const daOutra = PEDIDOS.find((pedido) => pedido.campanha === "outra");
    if (daOutra) {
      const res = await atribuir(daOutra.id, CANAA);
      expect(res.status).toBe(404);
    }
    const inexistente = await atribuir(SEM_AFILIADO.id, 999_999);
    expect(inexistente.status).toBe(400);
    expect(await inexistente.json()).toMatchObject({
      erro: {
        codigo: "referencia_invalida",
        detalhes: [{ caminho: ["celula_id"] }],
      },
    });
    const comCelula = await atribuir(DE_AFILIADO.id, CANAA);
    expect(comCelula.status).toBe(409);
    expect(await comCelula.json()).toEqual(erro("pedido_ja_tem_celula"));
    for (const corpo of [{}, { celula_id: "3" }, { celula_id: 3, x: 1 }]) {
      const res = await requisitar(
        "PUT",
        caminho(SEM_AFILIADO.id),
        admin,
        corpo,
      );
      expect(res.status).toBe(400);
    }
    expect(await colunas(SEM_AFILIADO.id)).toMatchObject({
      celula_atribuida_id: null,
    });
    expect(await colunas(DE_AFILIADO.id)).toMatchObject({
      celula_atribuida_id: null,
    });
    expect(await trilha()).toEqual([]);
  });

  it("só admin: 401 sem sessão, 403 da coordenação e do líder (nada muda)", async () => {
    const semSessao = await requisitar(
      "PUT",
      caminho(SEM_AFILIADO.id),
      { Origin: ORIGEM },
      { celula_id: CANAA },
    );
    expect(semSessao.status).toBe(401);
    for (const sessao of [coordenacao, liderCanaa]) {
      const res = await atribuir(SEM_AFILIADO.id, CANAA, sessao);
      expect(res.status).toBe(403);
    }
    expect(await colunas(SEM_AFILIADO.id)).toMatchObject({
      celula_atribuida_id: null,
    });
  });
});

describe("a célula do afiliado vence; o webhook não apaga a atribuição", () => {
  it("o afiliado que ganha célula depois vence: a atribuída fica gravada, mas não conta; atribuir de novo dá 409", async () => {
    await atribuirOk(DE_ORFAO.id, CANAA);
    await db
      .prepare(
        "UPDATE afiliados SET celula_id = ?1, vinculado_em = '2026-11-27T12:00:00.000Z' WHERE affiliate_id = 900",
      )
      .bind(DORCAS)
      .run();
    const { itens } = await lerJson(
      respostaPedidosSchema,
      `/api/admin/pedidos?id=${DE_ORFAO.id}`,
    );
    expect(itens[0]).toMatchObject({
      celula_id: DORCAS,
      celula_origem: "afiliado",
    });
    expect((await colunas(DE_ORFAO.id))?.celula_atribuida_id).toBe(CANAA);
    expect((await atribuir(DE_ORFAO.id, CANAA)).status).toBe(409);
    // Desfazer continua valendo (a atribuída não contava e sai).
    expect((await atribuirOk(DE_ORFAO.id, null)).celula_id).toBe(DORCAS);
  });

  it("o webhook aprova a reserva atribuída sem tocar nas três colunas; a venda passa a contar na célula atribuída", async () => {
    await atribuirOk(RESERVA.id, CANAA);
    const antes = await colunas(RESERVA.id);
    const token = env.RIFEI_WEBHOOK_TOKEN;
    const res = await exports.default.fetch(`${ORIGEM}/api/webhooks/rifei`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        event: "paid_order",
        id: RESERVA.id,
        slug: DADOS_CAMPANHA_RANKING_UNICO.slug_rifei,
        is_rifinha: false,
        buyer: { name: "Comprador Ficticio", phone: "+5591900000009" },
        numbers_count: 3,
        subtotal: 60,
        total: 60,
        payment_method: "pix",
        status: "approved",
        status_detail: "accredited",
        created_at: "2026-11-27T10:00:00.000-03:00",
        approved_at: "2026-11-27T10:05:00.000-03:00",
        upsells: [],
      }),
    });
    expect(res.status).toBe(200);
    const pedido = await db
      .prepare("SELECT status FROM pedidos WHERE id = ?1")
      .bind(RESERVA.id)
      .first<{ status: string }>();
    expect(pedido?.status).toBe("approved");
    expect(await colunas(RESERVA.id)).toEqual(antes);
    const { itens } = await lerJson(
      respostaPedidosSchema,
      `/api/admin/pedidos?celula_id=${CANAA}&status=approved`,
    );
    expect(itens.map((item) => item.id)).toContain(RESERVA.id);
  });
});

describe("a venda atribuída conta na célula em todo lugar", () => {
  const realizadoNoRanking = async (celulaId: number) => {
    const ranking = await lerJson(
      respostaRankingSchema,
      "/api/painel/ranking?nivel=celula&periodo=campanha",
    );
    return ranking.itens.find((item) => item.id === celulaId)!.realizado;
  };
  const semCelula = async (data?: string) =>
    (
      await lerJson(
        respostaPainelResumoSchema,
        `/api/painel/resumo?escopo=campanha${data ? `&data=${data}` : ""}`,
      )
    ).vendas_sem_celula!.bilhetes;

  it("lista de pedidos: entra no filtro da célula (origem manual), sai do sem célula; a coordenação vê a célula efetiva", async () => {
    await atribuirOk(SEM_AFILIADO.id, CANAA);
    const daCelula = await lerJson(
      respostaPedidosSchema,
      `/api/admin/pedidos?celula_id=${CANAA}&limite=200`,
    );
    const atribuido = daCelula.itens.find(
      (item) => item.id === SEM_AFILIADO.id,
    ) as ItemPedido;
    expect(atribuido).toMatchObject({
      celula_id: CANAA,
      celula_origem: "manual",
    });
    expect(
      daCelula.itens.filter((item) => item.id !== SEM_AFILIADO.id).length,
    ).toBeGreaterThan(0);
    expect(
      daCelula.itens
        .filter((item) => item.id !== SEM_AFILIADO.id)
        .every((item) => item.celula_origem === "afiliado"),
    ).toBe(true);
    expect(daCelula.totais?.approved.bilhetes).toBeGreaterThanOrEqual(37);
    const semCelulaLista = await lerJson(
      respostaPedidosSchema,
      "/api/admin/pedidos?sem_celula=true&limite=200",
    );
    const ids = semCelulaLista.itens.map((item) => item.id);
    expect(ids).not.toContain(SEM_AFILIADO.id);
    expect(ids).toContain(DE_ORFAO.id);
    // A coordenação vê a célula efetiva (sem o comprador).
    const vistoPelaCoordenacao = await lerJson(
      respostaPedidosSchema,
      `/api/admin/pedidos?id=${SEM_AFILIADO.id}`,
      coordenacao,
    );
    expect(vistoPelaCoordenacao.itens[0]).toMatchObject({
      celula_id: CANAA,
      celula_origem: "manual",
    });
    expect(vistoPelaCoordenacao.itens[0].comprador).toBeUndefined();
  });

  it("ranking unificado, por grupo e resumo (sai do sem célula)", async () => {
    await db
      .prepare("UPDATE discipuladores SET grupo_id = 3 WHERE id = 20")
      .run();
    const grupos = async () =>
      (
        await lerJson(
          respostaRankingGruposSchema,
          "/api/painel/ranking-grupos?janela=campanha&nivel=celula",
        )
      ).grupos
        .find((grupo) => grupo.id === 3)!
        .itens.find((item) => item.id === CANAA)!.realizado;
    const antes = {
      ranking: await realizadoNoRanking(CANAA),
      grupo: await grupos(),
      semCelula: await semCelula(),
    };
    await atribuirOk(SEM_AFILIADO.id, CANAA);
    expect(await realizadoNoRanking(CANAA)).toBe(antes.ranking + 37);
    expect(await grupos()).toBe(antes.grupo + 37);
    expect(await semCelula()).toBe(antes.semCelula - 37);
  });

  it("na /minha do líder da célula", async () => {
    const bilhetes = async () =>
      (
        await lerJson(
          respostaVisaoIndividualSchema,
          "/api/minha/visao",
          liderCanaa,
        )
      ).desempenho.bilhetes.campanha;
    const antes = await bilhetes();
    await atribuirOk(SEM_AFILIADO.id, CANAA);
    andarDoRelogio();
    expect(await bilhetes()).toBe(antes + 37);
  });

  it("no CSV da coordenação (tipo células) e no relatório por e-mail", async () => {
    const linhaDaCanaa = async () => {
      const res = await requisitar(
        "GET",
        "/api/painel/relatorio?tipo=celulas",
        admin,
      );
      expect(res.status).toBe(200);
      return (await res.text())
        .split("\n")
        .find((linha) => linha.includes("Célula Canaã"))!;
    };
    const ontem = somarDias(
      hojeNoFuso(DADOS_CAMPANHA_RANKING_UNICO.fuso_horario, new Date(instante)),
      -1,
    );
    const textoDoEmail = async () => {
      const lido = await lerRelatorioDiario(env, () => new Date(instante), {
        tipo: "manha",
        data: ontem,
      });
      if (!lido.ok) throw new Error(lido.mensagem);
      return lido.email.texto;
    };
    const semCelulaNoEmail = (texto: string) =>
      Number(
        /([\d.]+) bilhetes? (?:foi|foram) vendidos? sem link de célula/
          .exec(texto)![1]
          .replaceAll(".", ""),
      );
    const csvAntes = await linhaDaCanaa();
    const emailAntes = semCelulaNoEmail(await textoDoEmail());
    await atribuirOk(SEM_AFILIADO.id, CANAA);
    const realizado = await realizadoNoRanking(CANAA);
    const csvDepois = await linhaDaCanaa();
    expect(csvDepois).not.toBe(csvAntes);
    expect(csvDepois.split(/[;,]/)).toContain(String(realizado));
    expect(semCelulaNoEmail(await textoDoEmail())).toBe(emailAntes - 37);
  });
});

describe("a célula com venda atribuída não sai da hierarquia", () => {
  it("excluir a célula dá 409 em_uso e diz para remover a atribuição", async () => {
    await db
      .prepare(
        `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
         VALUES (60, 30, 'Célula Sem Afiliado', 5, 'Líder Fictício')`,
      )
      .run();
    await atribuirOk(SEM_AFILIADO.id, 60);
    const res = await requisitar("DELETE", "/api/admin/celulas/60", admin);
    expect(res.status).toBe(409);
    const corpo = (await res.json()) as {
      erro: { codigo: string; mensagem: string };
    };
    expect(corpo.erro.codigo).toBe("em_uso");
    expect(corpo.erro.mensagem).toContain("atribuído à mão");
  });
});
