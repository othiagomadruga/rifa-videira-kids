// RIFA-089 (adendo da D38): GET /api/minha/compradores, "Quem comprou" do líder da célula, no app real (workerd, D1
// local com as migrações). Só a própria célula (pela célula efetiva da RIFA-088: a venda atribuída à mão entra), só as
// vendas pagas que contam (o desconsiderado e a reserva ficam fora), da mais recente para a mais antiga, sem telefone
// nem valor, com o cursor; 401 sem sessão e 403 para os outros papéis.
import { env, exports } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ROTAS_QUEM_COMPROU,
  respostaQuemComprouSchema,
  type RespostaQuemComprou,
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
const CAMINHO = ROTAS_QUEM_COMPROU.quemComprou.caminho;
const CANAA = 3;

/** Vendas da Canaã (afiliado 103), em minutos distintos do mesmo dia, com nomes fictícios. */
const pedidoDaCanaa = (
  id: string,
  aprovadoEm: string,
  bilhetes: number,
  afiliado: number | null = 103,
): PedidoTeste => ({ ...aprovado(afiliado, aprovadoEm, bilhetes), id });

const VENDAS: PedidoTeste[] = [
  pedidoDaCanaa("CANAA-1", "2026-11-23T15:01:00.000Z", 2),
  pedidoDaCanaa("CANAA-2", "2026-11-23T17:03:00.000Z", 4),
  pedidoDaCanaa("CANAA-3", "2026-11-24T12:30:00.000Z", 1),
  // Sem afiliado, atribuída à mão à Canaã (RIFA-088): entra.
  pedidoDaCanaa("ATRIBUIDA", "2026-11-24T13:00:00.000Z", 5, null),
  // Desconsiderado: fica fora.
  desconsiderado(pedidoDaCanaa("TESTE-CANAA", "2026-11-24T14:00:00.000Z", 9)),
  // Reserva (não paga): fica fora.
  {
    ...pedidoDaCanaa("RESERVA-CANAA", "2026-11-24T15:00:00.000Z", 3),
    status: "in_process",
    aprovado_em: null,
  },
  // De outra célula (Ágape): nunca aparece para o líder da Canaã.
  pedidoDaCanaa("AGAPE-1", "2026-11-24T16:00:00.000Z", 7, 101),
];

const NOMES: Record<string, string | null> = {
  "CANAA-1": "Comprador Ficticio Um",
  "CANAA-2": null,
  "CANAA-3": "Compradora Ficticia Tres",
  ATRIBUIDA: "Comprador Ficticio Atribuido",
  "AGAPE-1": "Comprador Da Outra Celula",
};

let lider: Record<string, string>;

function chamar(caminho: string, cabecalhos: Record<string, string>) {
  return exports.default.fetch(`${ORIGEM}${caminho}`, { headers: cabecalhos });
}

async function ler(
  consulta = "",
  cabecalhos = lider,
): Promise<RespostaQuemComprou> {
  const res = await chamar(`${CAMINHO}${consulta}`, cabecalhos);
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  return respostaQuemComprouSchema.parse(await res.json());
}

beforeAll(async () => {
  await semearCenario({ pedidos: VENDAS });
  await db.batch([
    ...Object.entries(NOMES).map(([id, nome]) =>
      db
        .prepare(
          "UPDATE pedidos SET comprador_nome = ?2, comprador_telefone = '+5591900000001' WHERE id = ?1",
        )
        .bind(id, nome),
    ),
    db
      .prepare(
        `UPDATE pedidos SET celula_atribuida_id = ?1, celula_atribuida_em = '2026-11-24T18:00:00.000Z',
           celula_atribuida_por = 1 WHERE id = 'ATRIBUIDA'`,
      )
      .bind(CANAA),
  ]);
  lider = await cabecalhosDeSessaoDaHierarquia("lider", CANAA);
});

afterAll(async () => {
  await limparBanco();
});

describe("GET /api/minha/compradores (líder da célula)", () => {
  it("só as vendas pagas que contam da própria célula, da mais recente para a mais antiga; a atribuída à mão entra", async () => {
    const resposta = await ler();
    expect(resposta.fuso_horario).toBe("America/Belem");
    expect(resposta.proximo).toBeNull();
    expect(resposta.itens).toEqual([
      {
        nome: "Comprador Ficticio Atribuido",
        aprovado_em: "2026-11-24T13:00:00.000Z",
        bilhetes: 5,
      },
      {
        nome: "Compradora Ficticia Tres",
        aprovado_em: "2026-11-24T12:30:00.000Z",
        bilhetes: 1,
      },
      // Sem nome na Rifei: null (o site mostra "Comprador sem nome").
      { nome: null, aprovado_em: "2026-11-23T17:03:00.000Z", bilhetes: 4 },
      {
        nome: "Comprador Ficticio Um",
        aprovado_em: "2026-11-23T15:01:00.000Z",
        bilhetes: 2,
      },
    ]);
  });

  it("sem telefone, sem valor e sem os números dos bilhetes; um id de célula na consulta não muda nada", async () => {
    const res = await chamar(`${CAMINHO}?celula_id=1&limite=50`, lider);
    const texto = await res.text();
    expect(texto).not.toMatch(
      /telefone|\+55|9190000|centavos|total|numeros|Da Outra Celula/,
    );
    expect(
      respostaQuemComprouSchema.parse(JSON.parse(texto)).itens,
    ).toHaveLength(4);
  });

  it("'Ver mais': o cursor percorre tudo sem repetir nem pular; cursor inválido dá 400", async () => {
    const primeira = await ler("?limite=3");
    expect(primeira.itens).toHaveLength(3);
    expect(primeira.proximo).not.toBeNull();
    const segunda = await ler(
      `?limite=3&antes_de=${encodeURIComponent(primeira.proximo!)}`,
    );
    expect(segunda.proximo).toBeNull();
    expect([...primeira.itens, ...segunda.itens]).toEqual((await ler()).itens);
    const invalido = await chamar(`${CAMINHO}?antes_de=xyz`, lider);
    expect(invalido.status).toBe(400);
    expect(await invalido.json()).toMatchObject({
      erro: {
        codigo: "requisicao_invalida",
        detalhes: [{ caminho: ["antes_de"], codigo: "cursor_invalido" }],
      },
    });
  });

  it("o líder de outra célula vê só as dele; discipulador, rede e coordenação levam 403; sem sessão, 401", async () => {
    const daAgape = await ler(
      "",
      await cabecalhosDeSessaoDaHierarquia("lider", 1),
    );
    expect(daAgape.itens.map((item) => item.nome)).toContain(
      "Comprador Da Outra Celula",
    );
    expect(daAgape.itens.map((item) => item.nome)).not.toContain(
      "Comprador Ficticio Um",
    );
    for (const cabecalhos of [
      await cabecalhosDeSessaoDaHierarquia("discipulador", 20),
      await cabecalhosDeSessaoDaHierarquia("rede", 1),
      await cabecalhosDeSessao("coordenacao"),
      await cabecalhosDeSessao("admin"),
    ]) {
      const res = await chamar(CAMINHO, cabecalhos);
      expect(res.status).toBe(403);
    }
    expect((await chamar(CAMINHO, { Origin: ORIGEM })).status).toBe(401);
  });

  it("o plano: um MULTI-INDEX OR pelos afiliados da célula e pelos atribuídos (nunca a campanha inteira)", async () => {
    const { results } = await db
      .prepare(`EXPLAIN QUERY PLAN ${comandoQuemComprou(true)}`)
      .bind(CANAA, 21, "2026-12-01T00:00:00.000Z", "Z")
      .all<{ detail: string }>();
    const plano = results.map((linha) => linha.detail);
    expect(plano[0]).toBe("MULTI-INDEX OR");
    expect(plano).toContain(
      "SEARCH p USING INDEX pedidos_por_afiliado_status (affiliate_id=?)",
    );
    expect(plano).toContain(
      "SEARCH p USING INDEX pedidos_por_celula_atribuida (celula_atribuida_id=?)",
    );
    expect(plano.join("\n")).not.toMatch(
      /pedidos_por_campanha_registro|pedidos_por_status_aprovacao/,
    );
  });

  it("sem campanha ativa: 404", async () => {
    await db.prepare("UPDATE campanhas SET ativa = 0 WHERE ativa = 1").run();
    try {
      const res = await chamar(CAMINHO, lider);
      expect(res.status).toBe(404);
    } finally {
      await db
        .prepare(
          "UPDATE campanhas SET ativa = 1 WHERE slug_rifei = 'rifa-videira-kids-teste'",
        )
        .run();
    }
  });
});
