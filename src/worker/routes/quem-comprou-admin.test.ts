// RIFA-093 (adendo da D36): "Quem comprou" por célula do admin, no app real (workerd, D1 local com as migrações).
// GET /api/admin/quem-comprou/celulas (todas as células com os totais, pela célula efetiva) e
// GET /api/admin/celulas/:id/compradores (as vendas pagas que contam da célula, da mais recente para a mais antiga, com
// o telefone do pedido e a origem da célula, com o cursor). Só admin: a coordenação e a hierarquia levam 403.
import { env, exports } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ROTAS_QUEM_COMPROU_ADMIN,
  respostaCelulasQuemComprouSchema,
  respostaCompradoresDaCelulaSchema,
  type RespostaCompradoresDaCelula,
} from "../../shared/contracts";
import { comandoQuemComprou } from "../db/quem-comprou";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
} from "../test/acesso-teste";
import {
  aprovado,
  desconsiderado,
  limparBanco,
  semearCenario,
  type PedidoTeste,
} from "../test/painel-apoio";

const db = env.DB;
const CELULAS = ROTAS_QUEM_COMPROU_ADMIN.celulasQuemComprou.caminho;
const CANAA = 3;
const daCelula = (id: number) =>
  ROTAS_QUEM_COMPROU_ADMIN.compradoresDaCelula.caminho.replace(
    ":id",
    String(id),
  );

const pedido = (
  id: string,
  aprovadoEm: string,
  bilhetes: number,
  afiliado: number | null = 103,
): PedidoTeste => ({ ...aprovado(afiliado, aprovadoEm, bilhetes), id });

const VENDAS: PedidoTeste[] = [
  pedido("CANAA-1", "2026-11-23T15:01:00.000Z", 2),
  pedido("CANAA-2", "2026-11-23T17:03:00.000Z", 4),
  pedido("CANAA-3", "2026-11-24T12:30:00.000Z", 1),
  // Sem afiliado, atribuída à mão à Canaã (RIFA-088): entra, como "manual".
  pedido("ATRIBUIDA", "2026-11-24T13:00:00.000Z", 5, null),
  // Desconsiderado: fica fora (da lista e dos totais).
  desconsiderado(pedido("TESTE-CANAA", "2026-11-24T14:00:00.000Z", 9)),
  // Reserva (não paga): fica fora.
  {
    ...pedido("RESERVA-CANAA", "2026-11-24T15:00:00.000Z", 3),
    status: "in_process",
    aprovado_em: null,
  },
  // Da Ágape (afiliado 101) e da Betel (102): outras células.
  pedido("AGAPE-1", "2026-11-24T16:00:00.000Z", 7, 101),
  pedido("BETEL-1", "2026-11-24T16:30:00.000Z", 12, 102),
  // Sem célula (afiliado 900 não vinculado, sem atribuição): não entra em célula nenhuma.
  pedido("SEM-CELULA", "2026-11-24T17:00:00.000Z", 30, 900),
];

const COMPRADORES: Record<string, [string | null, string | null]> = {
  "CANAA-1": ["Comprador Ficticio Um", "+5591900000001"],
  "CANAA-2": [null, "+5591900000002"],
  "CANAA-3": ["Compradora Ficticia Tres", null],
  ATRIBUIDA: ["Comprador Ficticio Atribuido", "+5591900000004"],
  "AGAPE-1": ["Comprador Da Outra Celula", "+5591900000005"],
};

let admin: Record<string, string>;

function chamar(caminho: string, cabecalhos: Record<string, string>) {
  return exports.default.fetch(`${ORIGEM}${caminho}`, { headers: cabecalhos });
}

async function ler(
  consulta = "",
  celula = CANAA,
): Promise<RespostaCompradoresDaCelula> {
  const res = await chamar(`${daCelula(celula)}${consulta}`, admin);
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  return respostaCompradoresDaCelulaSchema.parse(await res.json());
}

beforeAll(async () => {
  await semearCenario({ pedidos: VENDAS });
  await db.batch([
    ...Object.entries(COMPRADORES).map(([id, [nome, telefone]]) =>
      db
        .prepare(
          "UPDATE pedidos SET comprador_nome = ?2, comprador_telefone = ?3 WHERE id = ?1",
        )
        .bind(id, nome, telefone),
    ),
    db
      .prepare(
        `UPDATE pedidos SET celula_atribuida_id = ?1, celula_atribuida_em = '2026-11-24T18:00:00.000Z',
           celula_atribuida_por = 1 WHERE id = 'ATRIBUIDA'`,
      )
      .bind(CANAA),
  ]);
  admin = await cabecalhosDeSessao("admin");
});

afterAll(async () => {
  await limparBanco();
});

describe("GET /api/admin/quem-comprou/celulas (admin)", () => {
  it("todas as células, as sem venda também, de mais bilhetes para menos (empate pelo nome), pela célula efetiva", async () => {
    const res = await chamar(CELULAS, admin);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const resposta = respostaCelulasQuemComprouSchema.parse(await res.json());
    expect(resposta.celulas).toEqual([
      // Empate em 12 bilhetes: pelo nome (Betel antes de Canaã).
      {
        id: 2,
        nome: "Célula Betel",
        discipulador: "Discipulador Abel",
        pedidos: 1,
        bilhetes: 12,
      },
      {
        id: 3,
        nome: "Célula Canaã",
        discipulador: "Discipulador Boaz",
        pedidos: 4,
        bilhetes: 12,
      },
      {
        id: 1,
        nome: "Célula Ágape",
        discipulador: "Discipulador Abel",
        pedidos: 1,
        bilhetes: 7,
      },
      {
        id: 4,
        nome: "Célula Dorcas",
        discipulador: "Discipulador Caleb",
        pedidos: 0,
        bilhetes: 0,
      },
      {
        id: 5,
        nome: "Célula Éfeso",
        discipulador: "Discipulador Caleb",
        pedidos: 0,
        bilhetes: 0,
      },
    ]);
  });
});

describe("GET /api/admin/celulas/:id/compradores (admin)", () => {
  it("só as vendas pagas que contam da célula pedida, da mais recente para a mais antiga, com telefone e origem; a atribuída à mão entra", async () => {
    const resposta = await ler();
    expect(resposta.celula).toEqual({ id: CANAA, nome: "Célula Canaã" });
    expect(resposta.fuso_horario).toBe("America/Belem");
    expect(resposta.totais).toEqual({ pedidos: 4, bilhetes: 12 });
    expect(resposta.proximo).toBeNull();
    expect(resposta.itens).toEqual([
      {
        pedido_id: "ATRIBUIDA",
        nome: "Comprador Ficticio Atribuido",
        telefone: "+5591900000004",
        aprovado_em: "2026-11-24T13:00:00.000Z",
        bilhetes: 5,
        origem_celula: "manual",
      },
      {
        pedido_id: "CANAA-3",
        nome: "Compradora Ficticia Tres",
        telefone: null,
        aprovado_em: "2026-11-24T12:30:00.000Z",
        bilhetes: 1,
        origem_celula: "afiliado",
      },
      {
        pedido_id: "CANAA-2",
        nome: null,
        telefone: "+5591900000002",
        aprovado_em: "2026-11-23T17:03:00.000Z",
        bilhetes: 4,
        origem_celula: "afiliado",
      },
      {
        pedido_id: "CANAA-1",
        nome: "Comprador Ficticio Um",
        telefone: "+5591900000001",
        aprovado_em: "2026-11-23T15:01:00.000Z",
        bilhetes: 2,
        origem_celula: "afiliado",
      },
    ]);
  });

  it("a outra célula só tem as dela; sem venda, lista vazia e totais zerados; célula inexistente, 404", async () => {
    const agape = await ler("", 1);
    expect(agape.itens.map((item) => item.pedido_id)).toEqual(["AGAPE-1"]);
    expect(agape.totais).toEqual({ pedidos: 1, bilhetes: 7 });
    const dorcas = await ler("", 4);
    expect(dorcas).toMatchObject({
      celula: { id: 4, nome: "Célula Dorcas" },
      totais: { pedidos: 0, bilhetes: 0 },
      itens: [],
      proximo: null,
    });
    const inexistente = await chamar(daCelula(999), admin);
    expect(inexistente.status).toBe(404);
    expect(await inexistente.json()).toMatchObject({
      erro: { codigo: "nao_encontrado", mensagem: "Célula não encontrada" },
    });
    expect((await chamar(daCelula(0), admin)).status).toBe(400);
  });

  it("'Ver mais': o cursor percorre tudo sem repetir nem pular, com os totais da célula inteira; cursor inválido dá 400", async () => {
    const primeira = await ler("?limite=3");
    expect(primeira.itens).toHaveLength(3);
    expect(primeira.totais).toEqual({ pedidos: 4, bilhetes: 12 });
    expect(primeira.proximo).not.toBeNull();
    const segunda = await ler(
      `?limite=3&antes_de=${encodeURIComponent(primeira.proximo!)}`,
    );
    expect(segunda.proximo).toBeNull();
    expect(segunda.totais).toEqual({ pedidos: 4, bilhetes: 12 });
    expect([...primeira.itens, ...segunda.itens]).toEqual((await ler()).itens);
    const invalido = await chamar(`${daCelula(CANAA)}?antes_de=xyz`, admin);
    expect(invalido.status).toBe(400);
    expect(await invalido.json()).toMatchObject({
      erro: {
        codigo: "requisicao_invalida",
        detalhes: [{ caminho: ["antes_de"], codigo: "cursor_invalido" }],
      },
    });
  });

  it("sem R$, sem DDD e sem os números dos bilhetes", async () => {
    const texto = await (
      await chamar(`${daCelula(CANAA)}?limite=50`, admin)
    ).text();
    expect(texto).not.toMatch(/centavos|total_|numeros|"ddd"|R\$/);
  });

  it("só admin: coordenação, líder, discipulador e rede levam 403 nas duas; sem sessão, 401", async () => {
    for (const caminho of [CELULAS, daCelula(CANAA)]) {
      for (const cabecalhos of [
        await cabecalhosDeSessao("coordenacao"),
        await cabecalhosDeSessaoDaHierarquia("lider", CANAA),
        await cabecalhosDeSessaoDaHierarquia("discipulador", 20),
        await cabecalhosDeSessaoDaHierarquia("rede", 1),
      ]) {
        const res = await chamar(caminho, cabecalhos);
        expect({ caminho, status: res.status }).toEqual({
          caminho,
          status: 403,
        });
      }
      expect((await chamar(caminho, { Origin: ORIGEM })).status).toBe(401);
    }
    // A coordenação leva 403 mesmo com uma consulta inválida (o papel vem antes da consulta).
    const comConsultaInvalida = await chamar(
      `${daCelula(CANAA)}?limite=0`,
      await cabecalhosDeSessao("coordenacao"),
    );
    expect(comConsultaInvalida.status).toBe(403);
  });

  it("o plano da página do admin é o do líder: um MULTI-INDEX OR (nunca a campanha inteira)", async () => {
    const { results } = await db
      .prepare(`EXPLAIN QUERY PLAN ${comandoQuemComprou(true, true)}`)
      .bind(CANAA, 21, "2026-12-01T00:00:00.000Z", "Z")
      .all<{ detail: string }>();
    const plano = results.map((linha) => linha.detail);
    expect(plano[0]).toBe("MULTI-INDEX OR");
    expect(plano.join("\n")).not.toMatch(
      /pedidos_por_campanha_registro|pedidos_por_status_aprovacao/,
    );
  });

  it("sem campanha ativa: 404 nas duas", async () => {
    await db.prepare("UPDATE campanhas SET ativa = 0 WHERE ativa = 1").run();
    try {
      for (const caminho of [CELULAS, daCelula(CANAA)])
        expect((await chamar(caminho, admin)).status).toBe(404);
    } finally {
      await db
        .prepare(
          "UPDATE campanhas SET ativa = 1 WHERE slug_rifei = 'rifa-videira-kids-teste'",
        )
        .run();
    }
  });
});
