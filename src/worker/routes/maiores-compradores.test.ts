// RIFA-083 (D38): os maiores compradores no D1 local, com o relógio fixo no dia 9 da campanha do cenário do painel
// (01/12/2026 12:00 em Belém, 2º dia da Semana 2). Os sub-apps são montados como o index.ts os monta (o do admin sob
// /api/admin e a /minha sob /api/minha), com o login dentro deles; o app real (a ordem de montagem e o 401/403 de cada
// papel) é provado em src/worker/protecao.test.ts. Um teste por critério:
// - a ordem e o desempate (bilhetes, total pago, quem comprou primeiro);
// - a janela: atual (a semana) × campanha; venda de outro período, de depois de hoje e de antes do início fora;
//   desconsiderado, reservado e expirado fora; outra campanha fora;
// - a junção por telefone e por nome (D36); sem nome e sem telefone, fora;
// - o limite;
// - o admin vê telefone (legível e o WhatsApp) e total; a coordenação leva 403;
// - o discipulador só vê as células dele, sem telefone e sem valor; líder e rede levam 403; acesso desligado, 403.
// Nomes e telefones fictícios.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  erroApiSchema,
  respostaMaioresCompradoresSchema,
  respostaMeusMaioresCompradoresSchema,
} from "../../shared/contracts";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
} from "../test/acesso-teste";
import {
  AGORA,
  aprovado,
  desconsiderado,
  dia,
  semearCenario,
  type PedidoTeste,
} from "../test/painel-apoio";
import {
  PREFIXO_MAIORES_COMPRADORES,
  criarMaioresCompradores,
} from "./maiores-compradores";
import { PREFIXO_MINHA, criarMinha } from "./minha";

const db = env.DB;

// Os sub-apps como o index.ts os monta, com o relógio do teste.
const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.route(
  PREFIXO_MAIORES_COMPRADORES,
  criarMaioresCompradores({ relogio: () => AGORA }),
);
app.route(PREFIXO_MINHA, criarMinha({ relogio: () => AGORA }));
app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

const ADMIN = "/api/admin/maiores-compradores";
const MINHA = "/api/minha/maiores-compradores";

/** Um pedido do cenário com o contato do comprador (D36). */
type Compra = {
  pedido: PedidoTeste;
  nome: string | null;
  telefone: string | null;
};
const compra = (
  pedido: PedidoTeste,
  nome: string | null,
  telefone: string | null = null,
): Compra => ({ pedido, nome, telefone });

const ANA = "+5591911110001";
const BRUNO = "+5591922220002";
const DAVI = "+5591933330003";
const ELISA = "+5591944440004";
const FABIO = "+5591955550005";

/**
 * Afiliados do cenário: 101 Ágape e 102 Betel (discipulador 10), 103 Canaã (20), 104 Dorcas (30), 900 não vinculado.
 * A Semana 2 vai de 30/11 (dia 8) a 06/12; "agora" é o dia 9.
 */
const COMPRAS: Compra[] = [
  // Semana 2 (a janela atual).
  compra(aprovado(101, `${dia(8)}T15:00:00.000Z`, 3), "Ana Ficticia", ANA),
  compra(aprovado(102, `${dia(9)}T13:00:00.000Z`, 2), "Ana Ficticia", ANA),
  compra(aprovado(103, `${dia(8)}T12:00:00.000Z`, 6), "Bruno Ficticio", BRUNO),
  // Sem telefone: juntada pelo nome (maiúsculas e acento não separam). Empata com a Ana em bilhetes e total, mas
  // comprou depois dela.
  compra(aprovado(101, `${dia(8)}T16:00:00.000Z`, 2), "Carla Ficticia"),
  compra(aprovado(102, `${dia(9)}T12:00:00.000Z`, 3), "CARLA FICTÍCIA"),
  // Sem célula (sem afiliado); empata em bilhetes com a Elisa, com o total maior.
  compra(aprovado(null, `${dia(9)}T11:00:00.000Z`, 4), "Davi Ficticio", DAVI),
  compra(
    aprovado(104, `${dia(9)}T10:00:00.000Z`, 4, 4 * 1800),
    "Elisa Ficticia",
    ELISA,
  ),
  // Semana 1: só na campanha toda.
  compra(aprovado(101, `${dia(3)}T15:00:00.000Z`, 10), "Ana Ficticia", ANA),
  // Não contam em janela nenhuma.
  compra(
    desconsiderado(aprovado(101, `${dia(9)}T14:00:00.000Z`, 20)),
    "Fabio Ficticio",
    FABIO,
  ),
  compra(
    {
      id: "PT-RESERVADO-083",
      affiliate_id: 101,
      status: "in_process",
      aprovado_em: null,
      qtd_bilhetes: 30,
      total_centavos: 60_000,
    },
    "Gabi Ficticia",
    "+5591966660006",
  ),
  compra(
    {
      id: "PT-EXPIRADO-083",
      affiliate_id: 102,
      status: "expired",
      aprovado_em: null,
      qtd_bilhetes: 30,
      total_centavos: 60_000,
    },
    "Hugo Ficticio",
    "+5591977770007",
  ),
  compra(aprovado(101, "2026-11-20T15:00:00.000Z", 8), "Iris Ficticia"),
  compra(aprovado(101, `${dia(15)}T15:00:00.000Z`, 9), "Jonas Ficticio"),
  compra(aprovado(101, `${dia(9)}T09:00:00.000Z`, 50), null, null),
  compra(
    { ...aprovado(101, `${dia(9)}T15:00:00.000Z`, 40), campanha: "outra" },
    "Lia Ficticia",
  ),
];

let admin: Record<string, string>;
let coordenacao: Record<string, string>;
const hierarquia = {} as Record<
  "discipulador10" | "discipulador20" | "lider" | "rede",
  Record<string, string>
>;

beforeAll(async () => {
  await semearCenario({ pedidos: COMPRAS.map((item) => item.pedido) });
  await db.batch(
    COMPRAS.map(({ pedido, nome, telefone }) =>
      db
        .prepare(
          "UPDATE pedidos SET comprador_nome = ?2, comprador_telefone = ?3 WHERE id = ?1",
        )
        .bind(pedido.id, nome, telefone),
    ),
  );
  // As sessões depois do cenário (semear a hierarquia apaga os usuários dos alvos em cascata).
  admin = await cabecalhosDeSessao("admin");
  coordenacao = await cabecalhosDeSessao("coordenacao");
  hierarquia.discipulador10 = await cabecalhosDeSessaoDaHierarquia(
    "discipulador",
    10,
  );
  hierarquia.discipulador20 = await cabecalhosDeSessaoDaHierarquia(
    "discipulador",
    20,
  );
  hierarquia.lider = await cabecalhosDeSessaoDaHierarquia("lider", 1);
  hierarquia.rede = await cabecalhosDeSessaoDaHierarquia("rede", 1);
});

async function chamar(caminho: string, cabecalhos: Record<string, string>) {
  const res = await app.request(caminho, { headers: cabecalhos }, env);
  return {
    status: res.status,
    corpo: (await res.json()) as unknown,
    cacheControl: res.headers.get("Cache-Control"),
  };
}

async function doAdmin(consulta = "") {
  const resposta = await chamar(`${ADMIN}${consulta}`, admin);
  expect(resposta).toMatchObject({ status: 200, cacheControl: "no-store" });
  return respostaMaioresCompradoresSchema.parse(resposta.corpo);
}

async function doDiscipulador(
  consulta = "",
  sessao = hierarquia.discipulador10,
) {
  const resposta = await chamar(`${MINHA}${consulta}`, sessao);
  expect(resposta).toMatchObject({ status: 200, cacheControl: "no-store" });
  return respostaMeusMaioresCompradoresSchema.parse(resposta.corpo);
}

describe("admin: GET /api/admin/maiores-compradores", () => {
  it("a semana (padrão): a ordem por bilhetes, total pago e quem comprou primeiro, com telefone, WhatsApp, total e células", async () => {
    const resposta = await doAdmin();
    expect(resposta.janela).toMatchObject({
      tipo: "atual",
      nome: "Semana 2",
      data_inicio: "2026-11-30",
    });
    expect(resposta.atualizado_em).toBe(AGORA.toISOString());
    expect(resposta.itens).toEqual([
      {
        posicao: 1,
        nome: "Bruno Ficticio",
        telefone: "(91) 92222-0002",
        whatsapp: "5591922220002",
        bilhetes: 6,
        total_centavos: 12_000,
        pedidos: 1,
        celulas: ["Célula Canaã"],
        sem_celula: false,
      },
      {
        posicao: 2,
        nome: "Ana Ficticia",
        telefone: "(91) 91111-0001",
        whatsapp: "5591911110001",
        bilhetes: 5,
        total_centavos: 10_000,
        pedidos: 2,
        celulas: ["Célula Ágape", "Célula Betel"],
        sem_celula: false,
      },
      // Mesmos bilhetes e total da Ana, mas a primeira compra foi depois: fica atrás (outra posição).
      {
        posicao: 3,
        nome: "CARLA FICTÍCIA",
        telefone: null,
        whatsapp: null,
        bilhetes: 5,
        total_centavos: 10_000,
        pedidos: 2,
        celulas: ["Célula Ágape", "Célula Betel"],
        sem_celula: false,
      },
      {
        posicao: 4,
        nome: "Davi Ficticio",
        telefone: "(91) 93333-0003",
        whatsapp: "5591933330003",
        bilhetes: 4,
        total_centavos: 8000,
        pedidos: 1,
        celulas: [],
        sem_celula: true,
      },
      {
        posicao: 5,
        nome: "Elisa Ficticia",
        telefone: "(91) 94444-0004",
        whatsapp: "5591944440004",
        bilhetes: 4,
        total_centavos: 7200,
        pedidos: 1,
        celulas: ["Célula Dorcas"],
        sem_celula: false,
      },
    ]);
  });

  it("a campanha toda: soma a Semana 1; antes do início, depois de hoje, desconsiderado, reservado, expirado, sem contato e outra campanha ficam fora", async () => {
    const resposta = await doAdmin("?janela=campanha");
    expect(resposta.janela).toMatchObject({
      tipo: "campanha",
      data_inicio: "2026-11-23",
    });
    expect(
      resposta.itens.map((item) => [item.posicao, item.nome, item.bilhetes]),
    ).toEqual([
      [1, "Ana Ficticia", 15],
      [2, "Bruno Ficticio", 6],
      [3, "CARLA FICTÍCIA", 5],
      [4, "Davi Ficticio", 4],
      [5, "Elisa Ficticia", 4],
    ]);
    const nomes = JSON.stringify(resposta);
    for (const fora of ["Fabio", "Gabi", "Hugo", "Iris", "Jonas", "Lia"])
      expect(nomes).not.toContain(fora);
  });

  it("o limite: só os primeiros, sem mudar a posição; fora de 1 a 50, 400", async () => {
    const resposta = await doAdmin("?limite=2");
    expect(resposta.itens.map((item) => [item.posicao, item.nome])).toEqual([
      [1, "Bruno Ficticio"],
      [2, "Ana Ficticia"],
    ]);
    for (const consulta of ["?limite=0", "?limite=51", "?janela=semana"]) {
      const invalida = await chamar(`${ADMIN}${consulta}`, admin);
      expect(invalida.status).toBe(400);
      expect(erroApiSchema.parse(invalida.corpo).erro.codigo).toBe(
        "requisicao_invalida",
      );
    }
  });

  it("só o admin: a coordenação e a hierarquia levam 403 (antes da consulta); sem sessão, 401", async () => {
    for (const sessao of [
      coordenacao,
      hierarquia.discipulador10,
      hierarquia.lider,
    ]) {
      const res = await chamar(`${ADMIN}?limite=0`, sessao);
      expect(res.status).toBe(403);
      expect(erroApiSchema.parse(res.corpo).erro.codigo).toBe("proibido");
    }
    expect((await chamar(ADMIN, {})).status).toBe(401);
  });
});

describe("discipulador: GET /api/minha/maiores-compradores", () => {
  it("só os compradores das células dele, com nome, bilhetes e a célula de mais bilhetes; sem telefone e sem valor", async () => {
    const resposta = await doDiscipulador();
    expect(resposta.itens).toEqual([
      // Ágape 3 × Betel 2: a célula é a Ágape.
      { posicao: 1, nome: "Ana Ficticia", bilhetes: 5, celula: "Célula Ágape" },
      // Ágape 2 × Betel 3: a Betel.
      {
        posicao: 2,
        nome: "CARLA FICTÍCIA",
        bilhetes: 5,
        celula: "Célula Betel",
      },
    ]);
    const texto = JSON.stringify(resposta);
    // Nenhum telefone, WhatsApp, total ou valor; e nada dos compradores das células dos outros.
    expect(texto).not.toMatch(
      /telefone|whatsapp|centavos|total|R\$|9111|10000|Bruno|Davi|Elisa/,
    );
    for (const item of resposta.itens)
      expect(Object.keys(item).sort()).toEqual([
        "bilhetes",
        "celula",
        "nome",
        "posicao",
      ]);
  });

  it("outro discipulador vê só os das células dele; a campanha toda soma a Semana 1", async () => {
    expect((await doDiscipulador("", hierarquia.discipulador20)).itens).toEqual(
      [
        {
          posicao: 1,
          nome: "Bruno Ficticio",
          bilhetes: 6,
          celula: "Célula Canaã",
        },
      ],
    );
    expect(
      (await doDiscipulador("?janela=campanha")).itens.map((item) => [
        item.nome,
        item.bilhetes,
      ]),
    ).toEqual([
      ["Ana Ficticia", 15],
      ["CARLA FICTÍCIA", 5],
    ]);
    expect((await doDiscipulador("?limite=1")).itens).toHaveLength(1);
  });

  it("o alvo vem só da sessão: um id na consulta não muda nada", async () => {
    const pedido = await doDiscipulador(
      "?discipulador_id=20&celula_id=3&alvo=20",
    );
    expect(pedido.itens.map((item) => item.nome)).toEqual([
      "Ana Ficticia",
      "CARLA FICTÍCIA",
    ]);
  });

  it("líder, rede e coordenação levam 403; sem sessão, 401", async () => {
    for (const sessao of [hierarquia.lider, hierarquia.rede, coordenacao]) {
      const res = await chamar(MINHA, sessao);
      expect(res.status).toBe(403);
      expect(erroApiSchema.parse(res.corpo).erro.codigo).toBe("proibido");
    }
    expect((await chamar(MINHA, {})).status).toBe(401);
  });

  it("acesso dos discipuladores desligado: 403 acesso_desligado (D20); religado, volta", async () => {
    const ligar = (valor: number) =>
      db
        .prepare(
          "UPDATE campanhas SET acesso_discipuladores = ?1 WHERE ativa = 1",
        )
        .bind(valor)
        .run();
    await ligar(0);
    try {
      const res = await chamar(MINHA, hierarquia.discipulador10);
      expect(res.status).toBe(403);
      expect(erroApiSchema.parse(res.corpo).erro.codigo).toBe(
        "acesso_desligado",
      );
    } finally {
      await ligar(1);
    }
    expect((await doDiscipulador()).itens).toHaveLength(2);
  });
});

describe("sem campanha ativa", () => {
  it("as duas rotas: 404 nao_encontrado", async () => {
    await db.prepare("UPDATE campanhas SET ativa = 0 WHERE ativa = 1").run();
    try {
      for (const [caminho, sessao] of [
        [ADMIN, admin],
        [MINHA, hierarquia.discipulador10],
      ] as const) {
        const res = await chamar(caminho, sessao);
        expect(res.status).toBe(404);
        expect(erroApiSchema.parse(res.corpo).erro.codigo).toBe(
          "nao_encontrado",
        );
      }
    } finally {
      await db
        .prepare(
          "UPDATE campanhas SET ativa = 1 WHERE id = (SELECT max(id) FROM campanhas WHERE slug_rifei = 'rifa-videira-kids-teste')",
        )
        .run();
    }
  });
});
