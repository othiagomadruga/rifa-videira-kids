// RIFA-013b, item 5: plausibilidade no webhook, sem perder venda, e a lista de revisão
// GET /api/admin/pedidos/suspeitos, no app real (exports.default.fetch). O pedido implausível é gravado e
// CONTA nas vendas; o evento leva os motivos em webhook_eventos.avisos (DetalheResumido) e o pedido fica
// em pedidos_suspeitos. Nada do comprador sai na lista.
import { env, exports } from "cloudflare:workers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import newOrderAfiliado from "../../../test/fixtures/rifei/new_order.afiliado.json";
import paidOrderAfiliado from "../../../test/fixtures/rifei/paid_order.afiliado.json";
import {
  LIMITE_PEDIDOS_SUSPEITOS,
  respostaPedidosSuspeitosSchema,
  respostaWebhookRifeiSchema,
  type RespostaPedidosSuspeitos,
} from "../../shared/contracts";
import { ORIGEM, cabecalhosDeSessao } from "../test/acesso-teste";

const db = env.DB;
const SLUG = paidOrderAfiliado.slug;
const PRECO = 2000;

let coordenacao: Record<string, string>;
let celulaId: number;

async function limpar() {
  await db.batch(
    [
      "pedidos_suspeitos",
      "webhook_eventos",
      "pedidos",
      "afiliados",
      "celulas",
      "discipuladores",
      "redes",
      "campanhas",
    ].map((tabela) => db.prepare(`DELETE FROM ${tabela}`)),
  );
}

async function criarCampanha(slug: string, ativa: boolean): Promise<number> {
  const linha = await db
    .prepare(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
         meta_unidade, meta_regra, meta_valor, ranking_criterio)
       VALUES ('Campanha de teste', ?1, ?2, '2026-11-23', ?3, 'bilhetes', 'por_pessoa', 10,
         'percentual_meta')
       RETURNING id`,
    )
    .bind(slug, ativa ? 1 : 0, PRECO)
    .first<{ id: number }>();
  return linha!.id;
}

async function criarCelulaComAfiliado(affiliateId: number): Promise<number> {
  const [, , celula] = await db.batch<{ id: number }>([
    db.prepare(
      "INSERT INTO redes (nome, divisao) VALUES ('Rede Ficticia Suspeitos', 'jovens')",
    ),
    db.prepare(
      `INSERT INTO discipuladores (rede_id, nome)
       SELECT id, 'Discipulador Ficticio Suspeitos' FROM redes WHERE nome = 'Rede Ficticia Suspeitos'`,
    ),
    db.prepare(
      `INSERT INTO celulas (discipulador_id, nome, qtd_pessoas, lider_nome, lider_telefone)
       SELECT id, 'Célula Ficticia Suspeitos', 12, 'Lider Ficticio Suspeitos', '(91) 90000-0777'
       FROM discipuladores WHERE nome = 'Discipulador Ficticio Suspeitos'
       RETURNING id`,
    ),
  ]);
  const id = celula.results[0].id;
  await db
    .prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
       VALUES (?1, ?2, 'manual', '2026-11-20T12:00:00.000Z')`,
    )
    .bind(affiliateId, id)
    .run();
  return id;
}

async function enviar(corpo: object) {
  const res = await exports.default.fetch(`${ORIGEM}/api/webhooks/rifei`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RIFEI_WEBHOOK_TOKEN}`,
    },
    body: JSON.stringify(corpo),
  });
  expect(res.status).toBe(200);
  return respostaWebhookRifeiSchema.parse(await res.json());
}

async function listar(): Promise<{
  texto: string;
  corpo: RespostaPedidosSuspeitos;
}> {
  const res = await exports.default.fetch(
    `${ORIGEM}/api/admin/pedidos/suspeitos`,
    { headers: coordenacao },
  );
  expect(res.status).toBe(200);
  const texto = await res.text();
  return {
    texto,
    corpo: respostaPedidosSuspeitosSchema.parse(JSON.parse(texto)),
  };
}

async function avisosDoEvento(eventoId: number): Promise<unknown> {
  const linha = await db
    .prepare("SELECT avisos FROM webhook_eventos WHERE id = ?1")
    .bind(eventoId)
    .first<{ avisos: string | null }>();
  return linha?.avisos === null || linha === null
    ? null
    : JSON.parse(linha.avisos);
}

async function contarVendas(pedidoId: string): Promise<number> {
  const linha = await db
    .prepare(
      "SELECT count(*) AS total FROM vendas_aprovadas WHERE pedido_id = ?1",
    )
    .bind(pedidoId)
    .first<{ total: number }>();
  return linha?.total ?? 0;
}

/** O pedido da fixture com 300 bilhetes por R$ 60,00 (esperado: 300 × R$ 20,00 = R$ 6.000,00). */
const implausivel = {
  ...paidOrderAfiliado,
  numbers_count: 300,
  numbers: null,
  total: 60,
};

const MOTIVOS_DO_IMPLAUSIVEL = [
  {
    caminho: ["numbers_count"],
    codigo: "quantidade_acima_do_teto",
    mensagem:
      "Mais de 200 bilhetes num pedido só: confira na Rifei (o pedido continua contando)",
    ocorrencias: 1,
  },
  {
    caminho: ["total"],
    codigo: "total_abaixo_do_esperado",
    mensagem:
      "Total abaixo de bilhetes × preço do bilhete da campanha com mais de 50% de desconto: confira na Rifei (o pedido continua contando)",
    ocorrencias: 1,
  },
];

beforeAll(async () => {
  coordenacao = await cabecalhosDeSessao("coordenacao");
});

beforeEach(async () => {
  await limpar();
  await criarCampanha(SLUG, true);
  celulaId = await criarCelulaComAfiliado(paidOrderAfiliado.affiliate_id);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webhook: pedido aprovado implausível é gravado, conta e fica marcado", () => {
  it("300 bilhetes por R$ 60,00: processado, conta nas vendas, avisos no evento e na lista de revisão", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resposta = await enviar(implausivel);

    expect(resposta.resultado).toBe("processado");
    expect(await contarVendas(implausivel.id)).toBe(1);
    expect(await avisosDoEvento(resposta.evento_id)).toEqual(
      MOTIVOS_DO_IMPLAUSIVEL,
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      aviso: "pedido_implausivel",
      mensagem: expect.any(String),
      evento_id: resposta.evento_id,
      pedido_id: implausivel.id,
      affiliate_id: implausivel.affiliate_id,
      motivos: ["quantidade_acima_do_teto", "total_abaixo_do_esperado"],
    });

    const { texto, corpo } = await listar();
    expect(corpo).toEqual({
      itens: [
        {
          pedido_id: implausivel.id,
          affiliate_id: implausivel.affiliate_id,
          celula_id: celulaId,
          celula_nome: "Célula Ficticia Suspeitos",
          qtd_bilhetes: 300,
          total_centavos: 6000,
          esperado_centavos: 300 * PRECO,
          motivos: MOTIVOS_DO_IMPLAUSIVEL,
          aprovado_em: "2026-12-01T12:20:31.512Z",
          marcado_em: expect.any(String),
          // D20: o padrão do contrato até a API ler a desconsideração (migração 0008).
          desconsiderado: null,
        },
      ],
      total: 1,
    });
    // Nada do comprador: nem nome, e-mail, documento ou telefone, nem o líder da célula.
    const { buyer } = paidOrderAfiliado;
    for (const valor of [
      buyer.name,
      buyer.email,
      buyer.document,
      "900000001",
      "90000-0777",
      "Lider Ficticio",
    ])
      expect(texto).not.toContain(valor);
  });

  it("pedido plausível não é marcado: avisos null e lista vazia", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resposta = await enviar(paidOrderAfiliado);

    expect(resposta.resultado).toBe("processado");
    expect(await avisosDoEvento(resposta.evento_id)).toBeNull();
    expect((await listar()).corpo).toEqual({ itens: [], total: 0 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("só a aprovação é avaliada: o new_order implausível não marca; o paid_order marca; a reentrega não duplica", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const novo = await enviar({
      ...newOrderAfiliado,
      numbers_count: 300,
      numbers: null,
      total: 60,
    });
    expect(novo.resultado).toBe("processado");
    expect(await avisosDoEvento(novo.evento_id)).toBeNull();
    expect((await listar()).corpo.total).toBe(0);

    const pago = await enviar(implausivel);
    expect(pago.resultado).toBe("processado");
    const primeira = (await listar()).corpo.itens;
    expect(primeira).toHaveLength(1);

    const reentrega = await enviar(implausivel);
    expect(reentrega.resultado).toBe("duplicado");
    expect(await avisosDoEvento(reentrega.evento_id)).toBeNull();
    expect((await listar()).corpo.itens).toEqual(primeira);
  });

  it("o total acima de bilhetes × preço também marca, e o pedido conta do mesmo jeito", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const resposta = await enviar({ ...paidOrderAfiliado, total: 60.01 });

    expect(await contarVendas(paidOrderAfiliado.id)).toBe(1);
    expect(await avisosDoEvento(resposta.evento_id)).toEqual([
      expect.objectContaining({
        caminho: ["total"],
        codigo: "total_acima_do_esperado",
      }),
    ]);
  });

  it("evento de outra campanha (slug diferente) é ignorado e não marca nada", async () => {
    const resposta = await enviar({ ...implausivel, slug: "outra-rifa" });

    expect(resposta.resultado).toBe("ignorado_outra_campanha");
    expect((await listar()).corpo.total).toBe(0);
  });
});

describe("GET /api/admin/pedidos/suspeitos", () => {
  it("lista só os da campanha ativa, o mais recente primeiro", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await enviar(implausivel);
    await enviar({ ...implausivel, id: "PEDTESTE-SUSPEITO-2" });
    expect((await listar()).corpo.itens.map((item) => item.pedido_id)).toEqual([
      "PEDTESTE-SUSPEITO-2",
      implausivel.id,
    ]);

    // Outra campanha passa a ser a ativa: os marcados da anterior saem da lista (continuam no banco).
    await db.prepare("UPDATE campanhas SET ativa = 0").run();
    await criarCampanha("campanha-nova", true);
    expect((await listar()).corpo).toEqual({ itens: [], total: 0 });
    const guardados = await db
      .prepare("SELECT count(*) AS total FROM pedidos_suspeitos")
      .first<{ total: number }>();
    expect(guardados?.total).toBe(2);
  });

  it(`no máximo ${LIMITE_PEDIDOS_SUSPEITOS} itens; o total conta todos`, async () => {
    const campanha = await db
      .prepare("SELECT id FROM campanhas WHERE ativa = 1")
      .first<{ id: number }>();
    const quantidade = LIMITE_PEDIDOS_SUSPEITOS + 3;
    const ids = Array.from({ length: quantidade }, (_, i) => `LOTE-${i}`);
    await db.batch(
      ids.flatMap((id, i) => [
        db
          .prepare(
            `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, aprovado_em)
             VALUES (?1, ?2, 'approved', 300, 6000, '2026-12-01T12:00:00.000Z')`,
          )
          .bind(id, campanha!.id),
        db
          .prepare(
            `INSERT INTO pedidos_suspeitos
               (pedido_id, qtd_bilhetes, total_centavos, esperado_centavos, motivos, marcado_em)
             VALUES (?1, 300, 6000, 600000, ?2, ?3)`,
          )
          .bind(
            id,
            JSON.stringify(MOTIVOS_DO_IMPLAUSIVEL),
            new Date(Date.UTC(2026, 11, 1, 12, 0, 0, i)).toISOString(),
          ),
      ]),
    );

    const { corpo } = await listar();

    expect(corpo.total).toBe(quantidade);
    expect(corpo.itens).toHaveLength(LIMITE_PEDIDOS_SUSPEITOS);
    expect(corpo.itens[0].pedido_id).toBe(`LOTE-${quantidade - 1}`);
    expect(corpo.itens[0]).toMatchObject({
      affiliate_id: null,
      celula_id: null,
      celula_nome: null,
    });
  });

  it("sem sessão: 401, sem nenhum pedido no corpo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await enviar(implausivel);

    const res = await exports.default.fetch(
      `${ORIGEM}/api/admin/pedidos/suspeitos`,
    );

    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(implausivel.id);
  });
});
