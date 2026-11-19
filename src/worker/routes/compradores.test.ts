// RIFA-076 (D36): o nome e o telefone de quem reserva ou compra, no app real (exports.default.fetch), com o D1 local.
// - o webhook grava buyer.name e buyer.phone (E.164) no pedido, em evento novo e nas atualizações (um valor ausente
//   não apaga); a trilha (webhook_eventos) continua sem os dois;
// - GET /api/admin/pedidos: o `comprador` vem SÓ para o admin; para a coordenação o campo nem existe;
// - GET /api/admin/pedidos/compradores: a planilha (CSV com BOM e ";"), só admin, uma linha por comprador (telefone;
//   sem telefone, nome), filtro "só quem pagou", sem os desconsiderados, e a trilha registra quem exportou sem os dados.
// Dados fictícios.
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import newOrderAfiliado from "../../../test/fixtures/rifei/new_order.afiliado.json";
import {
  BOM_UTF8,
  COLUNAS_COMPRADORES,
  ROTAS,
  respostaPedidosSchema,
} from "../../shared/contracts";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
  erro,
} from "../test/acesso-teste";

const db = env.DB;
const SLUG = "videira-kids-teste";
const TOKEN = env.RIFEI_WEBHOOK_TOKEN ?? "";

let admin: Record<string, string>;
let coordenacao: Record<string, string>;
let celulaId: number;

async function limpar() {
  await db.batch(
    [
      "auditoria",
      "pedidos_suspeitos",
      "webhook_eventos",
      "pedidos",
      "afiliados",
      "campanha_periodos",
      "campanhas",
    ].map((tabela) => db.prepare(`DELETE FROM ${tabela}`)),
  );
}

async function ativarCampanha(): Promise<number> {
  const campanha = await db
    .prepare(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, fuso_horario, data_inicio, preco_bilhete_centavos,
         meta_unidade, meta_regra, meta_valor, ranking_criterio)
       VALUES ('Campanha dos compradores', ?1, 1, 'America/Sao_Paulo', '2026-11-23', 2000, 'bilhetes',
         'por_pessoa', 10, 'percentual_meta') RETURNING id`,
    )
    .bind(SLUG)
    .first<{ id: number }>();
  return campanha!.id;
}

async function webhook(payload: unknown): Promise<Response> {
  return exports.default.fetch(`${ORIGEM}/api/webhooks/rifei`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
}

async function contatoGravado(id: string) {
  return db
    .prepare(
      "SELECT comprador_nome, comprador_telefone FROM pedidos WHERE id = ?1",
    )
    .bind(id)
    .first<{
      comprador_nome: string | null;
      comprador_telefone: string | null;
    }>();
}

/** O texto do CSV com o BOM (o res.text() o tira). */
async function textoComBom(res: Response): Promise<string> {
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(
    await res.arrayBuffer(),
  );
}

const pedir = (caminho: string, cabecalhos: Record<string, string>) =>
  exports.default.fetch(`${ORIGEM}${caminho}`, { headers: cabecalhos });

beforeAll(async () => {
  admin = await cabecalhosDeSessao("admin");
  coordenacao = await cabecalhosDeSessao("coordenacao");
  const rede = await db
    .prepare(
      "INSERT INTO redes (nome, divisao) VALUES ('Rede Ficticia dos Compradores', 'adultos') RETURNING id",
    )
    .first<{ id: number }>();
  const discipulador = await db
    .prepare(
      "INSERT INTO discipuladores (rede_id, nome) VALUES (?1, 'Discipulador Ficticio dos Compradores') RETURNING id",
    )
    .bind(rede!.id)
    .first<{ id: number }>();
  const celula = await db
    .prepare(
      `INSERT INTO celulas (discipulador_id, nome, qtd_pessoas, lider_nome)
       VALUES (?1, 'Célula Ficticia dos Compradores', 10, 'Lider Ficticio') RETURNING id`,
    )
    .bind(discipulador!.id)
    .first<{ id: number }>();
  celulaId = celula!.id;
});

beforeEach(limpar);

describe("webhook: grava nome e telefone no pedido, nunca na trilha", () => {
  it("evento novo grava; evento seguinte sem os dados não apaga; com dados novos, atualiza (também no duplicado)", async () => {
    await ativarCampanha();
    expect((await webhook(newOrderAfiliado)).status).toBe(200);
    expect(await contatoGravado("PEDTESTE0001")).toEqual({
      comprador_nome: "Comprador Ficticio Um",
      comprador_telefone: "+5591900000001",
    });

    // paid_order sem buyer: o status muda, o contato fica.
    const semBuyer: Record<string, unknown> = { ...newOrderAfiliado };
    delete semBuyer.buyer;
    expect(
      (
        await webhook({
          ...semBuyer,
          event: "paid_order",
          status: "approved",
          approved_at: "2026-12-01T09:20:00.000-03:00",
        })
      ).status,
    ).toBe(200);
    expect(await contatoGravado("PEDTESTE0001")).toEqual({
      comprador_nome: "Comprador Ficticio Um",
      comprador_telefone: "+5591900000001",
    });

    // Um new_order repetido (ignorado: o pedido já está pago) com o telefone formatado e outro nome: atualiza só o contato.
    const res = await webhook({
      ...newOrderAfiliado,
      buyer: {
        ...newOrderAfiliado.buyer,
        name: "  Comprador   Ficticio Corrigido ",
        phone: "+55 (91) 90000-0009",
      },
    });
    expect(res.status).toBe(200);
    expect(await contatoGravado("PEDTESTE0001")).toEqual({
      comprador_nome: "Comprador Ficticio Corrigido",
      comprador_telefone: "+5591900000009",
    });
    const pedido = await db
      .prepare("SELECT status FROM pedidos WHERE id = 'PEDTESTE0001'")
      .first<{ status: string }>();
    expect(pedido?.status).toBe("approved");

    // A trilha nunca tem nome nem telefone (nem e-mail).
    const { results } = await db
      .prepare("SELECT payload_redigido, avisos FROM webhook_eventos")
      .all<{ payload_redigido: string | null; avisos: string | null }>();
    expect(results.length).toBe(3);
    const trilha = JSON.stringify(results);
    for (const proibido of [
      "Comprador Ficticio",
      "900000001",
      "900000009",
      "example.com",
    ])
      expect(trilha).not.toContain(proibido);
  });

  it("telefone fora do E.164 fica null; o nome fica", async () => {
    await ativarCampanha();
    await webhook({
      ...newOrderAfiliado,
      buyer: { ...newOrderAfiliado.buyer, phone: "91 90000-0001" },
    });
    expect(await contatoGravado("PEDTESTE0001")).toEqual({
      comprador_nome: "Comprador Ficticio Um",
      comprador_telefone: null,
    });
  });
});

async function semearPedidos() {
  const campanha = await ativarCampanha();
  await db.batch([
    db
      .prepare(
        `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
         VALUES (7601, ?1, 'manual', '2026-11-20T12:00:00.000Z')`,
      )
      .bind(celulaId),
    db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, ddd, pais,
           criado_em, aprovado_em, registrado_em, atualizado_em, comprador_nome, comprador_telefone) VALUES
           ('C-01', ?1, 7601, 'approved', 2, 4000, '11', '55', '2026-11-23T13:00:00.000Z',
             '2026-11-23T13:05:00.000Z', '2026-11-23T13:00:00.000Z', '2026-11-23T13:05:00.000Z',
             'Maria Ficticia', '+5511987654321'),
           ('C-02', ?1, 7601, 'in_process', 1, 2000, '11', '55', '2026-11-24T13:00:00.000Z', NULL,
             '2026-11-24T13:00:00.000Z', '2026-11-24T13:00:00.000Z', 'Maria F.', '+5511987654321'),
           ('C-03', ?1, NULL, 'expired', 3, 6000, NULL, NULL, '2026-11-23T14:00:00.000Z', NULL,
             '2026-11-23T14:00:00.000Z', '2026-11-23T14:00:00.000Z', 'João Ficticio', NULL),
           ('C-04', ?1, NULL, 'approved', 1, 2000, NULL, NULL, '2026-11-23T15:00:00.000Z',
             '2026-11-23T15:00:00.000Z', '2026-11-23T15:00:00.000Z', '2026-11-23T15:00:00.000Z', NULL, NULL)`,
      )
      .bind(campanha),
    // Desconsiderado pelo admin: fica fora da planilha.
    db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, criado_em, aprovado_em,
           registrado_em, atualizado_em, comprador_nome, comprador_telefone, desconsiderado_em,
           desconsiderado_motivo)
         VALUES ('C-05', ?1, 'approved', 1, 2000, '2026-11-23T16:00:00.000Z', '2026-11-23T16:00:00.000Z',
           '2026-11-23T16:00:00.000Z', '2026-11-23T16:00:00.000Z', 'Teste Desconsiderado', '+5591911112222',
           '2026-11-23T17:00:00.000Z', 'teste')`,
      )
      .bind(campanha),
  ]);
}

describe("GET /api/admin/pedidos: o comprador só para o admin", () => {
  it("admin recebe nome e telefone; coordenação não recebe o campo (nem os valores no texto)", async () => {
    await semearPedidos();
    const resAdmin = await pedir(ROTAS.listarPedidos.caminho, admin);
    expect(resAdmin.status).toBe(200);
    const doAdmin = respostaPedidosSchema.parse(await resAdmin.json());
    const porId = new Map(doAdmin.itens.map((item) => [item.id, item]));
    expect(porId.get("C-01")?.comprador).toEqual({
      nome: "Maria Ficticia",
      telefone: "+5511987654321",
    });
    expect(porId.get("C-04")?.comprador).toEqual({
      nome: null,
      telefone: null,
    });

    const resCoordenacao = await pedir(
      ROTAS.listarPedidos.caminho,
      coordenacao,
    );
    expect(resCoordenacao.status).toBe(200);
    const texto = await resCoordenacao.text();
    const daCoordenacao = respostaPedidosSchema.parse(JSON.parse(texto));
    expect(daCoordenacao.itens.length).toBe(doAdmin.itens.length);
    for (const item of daCoordenacao.itens)
      expect(Object.keys(item)).not.toContain("comprador");
    for (const proibido of ["comprador", "Maria", "João", "987654321"])
      expect(texto).not.toContain(proibido);
  });

  it("a resposta de desconsiderar (só admin) traz o comprador, como a lista do admin", async () => {
    await semearPedidos();
    await db.prepare("UPDATE campanhas SET pedidos_desconsiderar = 1").run();
    const res = await exports.default.fetch(
      `${ORIGEM}${ROTAS.listarPedidos.caminho}/desconsiderar`,
      {
        method: "POST",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_id: "C-01", motivo: "teste" }),
      },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { comprador?: unknown }).comprador).toEqual({
      nome: "Maria Ficticia",
      telefone: "+5511987654321",
    });
  });
});

describe("GET /api/admin/pedidos/compradores: a planilha, só admin", () => {
  const CAMINHO = ROTAS.exportarCompradores.caminho;

  it("sem sessão 401; coordenação e hierarquia 403 (nada na trilha)", async () => {
    await semearPedidos();
    const semSessao = await pedir(CAMINHO, {});
    expect(semSessao.status).toBe(401);
    expect(await semSessao.json()).toEqual(erro("nao_autenticado"));
    for (const cabecalhos of [
      coordenacao,
      await cabecalhosDeSessaoDaHierarquia("lider", celulaId),
    ]) {
      const res = await pedir(CAMINHO, cabecalhos);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(erro("proibido"));
    }
    const trilha = await db
      .prepare("SELECT count(*) AS total FROM auditoria")
      .first<{ total: number }>();
    expect(trilha?.total).toBe(0);
  });

  it("admin: CSV com BOM e ';', uma linha por comprador, sem desconsiderados; a trilha registra sem os dados", async () => {
    await semearPedidos();
    const res = await pedir(CAMINHO, admin);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="rifa-videira-kids-compradores-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const csv = await textoComBom(res);
    expect(csv.startsWith(BOM_UTF8)).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      COLUNAS_COMPRADORES.join(";"),
      "João Ficticio;;;1;3;0,00;23/11/2026 11:00;23/11/2026 11:00;Só reservou",
      "Maria F.;(11) 98765-4321;Célula Ficticia dos Compradores;2;3;40,00;23/11/2026 10:00;24/11/2026 10:00;Pagou",
      "",
    ]);
    expect(csv).not.toContain("Desconsiderado");

    const { results } = await db
      .prepare("SELECT acao, alvo, resumo FROM auditoria")
      .all<{ acao: string; alvo: string; resumo: string }>();
    expect(results).toEqual([
      {
        acao: "compradores.exportar",
        alvo: "compradores",
        resumo: "Planilha de compradores baixada (todos)",
      },
    ]);
  });

  it("so_pagou=true: só quem pagou; consulta inválida 400; sem campanha 404 sem registro", async () => {
    await semearPedidos();
    const csv = await textoComBom(
      await pedir(`${CAMINHO}?so_pagou=true`, admin),
    );
    expect(csv.slice(1).split("\r\n").slice(1, -1)).toEqual([
      "Maria F.;(11) 98765-4321;Célula Ficticia dos Compradores;2;3;40,00;23/11/2026 10:00;24/11/2026 10:00;Pagou",
    ]);
    expect((await pedir(`${CAMINHO}?so_pagou=sim`, admin)).status).toBe(400);

    await limpar();
    const semCampanha = await pedir(CAMINHO, admin);
    expect(semCampanha.status).toBe(404);
    expect(await semCampanha.json()).toEqual(erro("nao_encontrado"));
    const trilha = await db
      .prepare("SELECT count(*) AS total FROM auditoria")
      .first<{ total: number }>();
    expect(trilha?.total).toBe(0);
  });
});
