// RIFA-083 (docs/decisions.md D38): o ranking dos maiores compradores, para o admin (telefone e R$) e para o
// discipulador (só o nome, os bilhetes e a célula, das células dele). Um teste por critério da regra única
// (`classificarMaioresCompradores`), dos itens de cada rota, dos schemas estritos e do catálogo. Nomes e telefones
// fictícios. O filtro do que conta (aprovado, janela, desconsiderado, células do discipulador) é do banco: veja
// src/worker/routes/maiores-compradores.test.ts.
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { ROTAS_ACESSO, ROTAS_ACESSO_HIERARQUIA } from "./acesso";
import {
  ROTAS,
  ROTAS_CONEXAO_RIFEI,
  ROTAS_LINK_VENDAS,
  ROTAS_MAIORES_COMPRADORES,
  ROTAS_REGRAS_CAMPANHA,
  ROTAS_RELATORIO,
  ROTAS_RIFEI_API,
  ROTAS_TOKEN_WEBHOOK,
  consultaMaioresCompradoresSchema,
  respostaMaioresCompradoresSchema,
  respostaMeusMaioresCompradoresSchema,
  type DefinicaoRota,
  type JanelaRanking,
} from "./api";
import * as contrato from "./index";
import {
  LIMITE_MAIORES_COMPRADORES_MAXIMO,
  LIMITE_MAIORES_COMPRADORES_PADRAO,
  chaveDoComprador,
  classificarMaioresCompradores,
  itemMaiorCompradorAdmin,
  itemMeuMaiorComprador,
  type PedidoDoMaiorComprador,
} from "./maiores-compradores";

/** Todos os nomes de campo que um schema pode devolver. */
function campos(schema: z.ZodType): string[] {
  const nomes = new Set<string>();
  const visitar = (no: unknown): void => {
    if (Array.isArray(no)) return no.forEach(visitar);
    if (typeof no !== "object" || no === null) return;
    for (const [chave, valor] of Object.entries(no)) {
      if (chave === "properties" && typeof valor === "object" && valor !== null)
        for (const nome of Object.keys(valor)) nomes.add(nome);
      visitar(valor);
    }
  };
  visitar(z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }));
  return [...nomes].sort();
}

let minuto = 0;
/** Um pedido aprovado; cada chamada aprova um minuto depois da anterior (a ordem de chegada). */
function pedido(
  dados: Partial<PedidoDoMaiorComprador>,
): PedidoDoMaiorComprador {
  minuto += 1;
  return {
    nome: null,
    telefone: null,
    qtd_bilhetes: 1,
    total_centavos: 2000,
    celula_nome: "Célula Ficticia A",
    aprovado_em: new Date(
      Date.UTC(2026, 10, 23, 12, 0) + minuto * 60_000,
    ).toISOString(),
    ...dados,
  };
}

const JANELA = {
  tipo: "atual" as JanelaRanking,
  ordem: 1,
  nome: "Semana 1",
  data_inicio: "2026-11-23",
  data_fim: "2026-11-29",
};
const AGORA = "2026-11-25T15:00:00.000Z";

describe("a regra do maior comprador: a ordem e o desempate", () => {
  it("mais bilhetes primeiro; empate em bilhetes, o maior total pago; empate nos dois, quem comprou primeiro", () => {
    const itens = classificarMaioresCompradores([
      pedido({
        nome: "Comprador Terceiro",
        telefone: "+5591900000003",
        qtd_bilhetes: 5,
        total_centavos: 10_000,
      }),
      // Os mesmos 5 bilhetes com desconto: total menor, fica atrás do de cima.
      pedido({
        nome: "Comprador Desconto",
        telefone: "+5591900000004",
        qtd_bilhetes: 5,
        total_centavos: 9_000,
      }),
      pedido({
        nome: "Comprador Primeiro",
        telefone: "+5591900000001",
        qtd_bilhetes: 9,
        total_centavos: 18_000,
      }),
      // 5 bilhetes e o mesmo total do "Terceiro", mas comprou depois: fica atrás dele.
      pedido({
        nome: "Comprador Atrasado",
        telefone: "+5591900000005",
        qtd_bilhetes: 5,
        total_centavos: 10_000,
      }),
      pedido({
        nome: "Comprador Segundo",
        telefone: "+5591900000002",
        qtd_bilhetes: 7,
        total_centavos: 14_000,
      }),
    ]);
    expect(itens.map((item) => [item.posicao, item.nome])).toEqual([
      [1, "Comprador Primeiro"],
      [2, "Comprador Segundo"],
      [3, "Comprador Terceiro"],
      [4, "Comprador Atrasado"],
      [5, "Comprador Desconto"],
    ]);
  });

  it("a primeira compra é a mais antiga da pessoa na janela, não a última", () => {
    const antes = pedido({
      nome: "Comprador Cedo",
      telefone: "+5591900000010",
      qtd_bilhetes: 1,
    });
    const outro = pedido({
      nome: "Comprador Meio",
      telefone: "+5591900000011",
      qtd_bilhetes: 4,
      total_centavos: 4000,
    });
    const depois = pedido({
      nome: "Comprador Cedo",
      telefone: "+5591900000010",
      qtd_bilhetes: 3,
    });
    const itens = classificarMaioresCompradores([depois, outro, antes]);
    expect(itens.map((item) => item.nome)).toEqual([
      "Comprador Cedo",
      "Comprador Meio",
    ]);
    expect(itens[0]).toMatchObject({
      bilhetes: 4,
      pedidos: 2,
      primeira: antes.aprovado_em,
    });
  });

  it("empate perfeito (bilhetes, total e primeira compra) divide a posição (1, 1, 3), em ordem de nome", () => {
    const mesmoInstante = "2026-11-24T15:00:00.000Z";
    const itens = classificarMaioresCompradores([
      pedido({
        nome: "Zélia Ficticia",
        telefone: "+5591900000021",
        qtd_bilhetes: 3,
        aprovado_em: mesmoInstante,
      }),
      pedido({
        nome: "Ágata Ficticia",
        telefone: "+5591900000022",
        qtd_bilhetes: 3,
        aprovado_em: mesmoInstante,
      }),
      pedido({
        nome: "Bruno Ficticio",
        telefone: "+5591900000023",
        qtd_bilhetes: 2,
      }),
    ]);
    expect(itens.map((item) => [item.posicao, item.nome])).toEqual([
      [1, "Ágata Ficticia"],
      [1, "Zélia Ficticia"],
      [3, "Bruno Ficticio"],
    ]);
    expect(
      respostaMaioresCompradoresSchema.safeParse({
        janela: JANELA,
        itens: itens.map(itemMaiorCompradorAdmin),
        atualizado_em: AGORA,
      }).success,
    ).toBe(true);
  });
});

describe("a regra do maior comprador: a junção por comprador (D36)", () => {
  it("pelo telefone: nomes diferentes no mesmo telefone são uma pessoa, com o nome do pedido mais recente", () => {
    const itens = classificarMaioresCompradores([
      pedido({
        nome: "Maria Ficticia",
        telefone: "+5591988887777",
        qtd_bilhetes: 2,
        total_centavos: 4000,
      }),
      pedido({
        nome: "Maria F. Ficticia",
        telefone: "+5591988887777",
        qtd_bilhetes: 1,
        total_centavos: 2000,
      }),
      // Sem nome no mais recente: o nome continua o último que veio.
      pedido({ nome: null, telefone: "+5591988887777", qtd_bilhetes: 1 }),
    ]);
    expect(itens).toEqual([
      expect.objectContaining({
        posicao: 1,
        nome: "Maria F. Ficticia",
        telefone: "+5591988887777",
        bilhetes: 4,
        pedidos: 3,
        total_centavos: 8000,
      }),
    ]);
  });

  it("sem telefone, pelo nome normalizado (maiúsculas, acentos e espaços não separam); com telefone, não junta com quem não tem", () => {
    const itens = classificarMaioresCompradores([
      pedido({ nome: "João  da Silva Ficticio", qtd_bilhetes: 2 }),
      pedido({ nome: "joao da silva ficticio", qtd_bilhetes: 3 }),
      pedido({
        nome: "João da Silva Ficticio",
        telefone: "+5511987654321",
        qtd_bilhetes: 1,
      }),
    ]);
    expect(
      itens.map((item) => [item.nome, item.telefone, item.bilhetes]),
    ).toEqual([
      ["joao da silva ficticio", null, 5],
      ["João da Silva Ficticio", "+5511987654321", 1],
    ]);
    expect(
      chaveDoComprador({ nome: " JOÃO DA SILVA FICTICIO ", telefone: null }),
    ).toBe(
      chaveDoComprador({ nome: "joao da silva ficticio", telefone: null }),
    );
  });

  it("sem nome e sem telefone (ou nome sem letra), o pedido fica de fora", () => {
    expect(
      classificarMaioresCompradores([
        pedido({ nome: null, telefone: null, qtd_bilhetes: 30 }),
        pedido({ nome: "   ", telefone: null, qtd_bilhetes: 30 }),
        pedido({ nome: "Ana Ficticia", qtd_bilhetes: 1 }),
      ]).map((item) => item.nome),
    ).toEqual(["Ana Ficticia"]);
  });

  it("as células dele (sem repetir, em português), o 'sem célula' e a célula com mais bilhetes (empate: a primeira em português)", () => {
    const [item] = classificarMaioresCompradores([
      pedido({
        telefone: "+5591900000030",
        celula_nome: "Célula Ficticia Zion",
        qtd_bilhetes: 2,
      }),
      pedido({
        telefone: "+5591900000030",
        celula_nome: "Célula Ficticia Betel",
        qtd_bilhetes: 1,
      }),
      pedido({
        telefone: "+5591900000030",
        celula_nome: "Célula Ficticia Betel",
        qtd_bilhetes: 1,
      }),
      pedido({
        telefone: "+5591900000030",
        celula_nome: null,
        qtd_bilhetes: 5,
      }),
    ]);
    expect(item).toMatchObject({
      celulas: ["Célula Ficticia Betel", "Célula Ficticia Zion"],
      sem_celula: true,
      // 2 × 2 empatados: Betel vem antes de Zion. O "sem célula" (5) não concorre.
      celula_principal: "Célula Ficticia Betel",
    });
    const [soSemCelula] = classificarMaioresCompradores([
      pedido({ nome: "Sem Celula Ficticio", celula_nome: null }),
    ]);
    expect(soSemCelula).toMatchObject({
      celulas: [],
      sem_celula: true,
      celula_principal: null,
    });
  });
});

describe("a regra do maior comprador: o limite", () => {
  const muitos = Array.from({ length: 60 }, (_, indice) =>
    pedido({
      nome: `Comprador Ficticio ${String(indice + 1).padStart(2, "0")}`,
      telefone: `+55919000${String(indice + 1).padStart(5, "0")}`,
      qtd_bilhetes: 100 - indice,
    }),
  );

  it("no máximo 10 por padrão, ou o limite pedido; as posições não mudam com o corte", () => {
    expect(LIMITE_MAIORES_COMPRADORES_PADRAO).toBe(10);
    expect(LIMITE_MAIORES_COMPRADORES_MAXIMO).toBe(50);
    const padrao = classificarMaioresCompradores(muitos);
    expect(padrao).toHaveLength(10);
    expect(padrao.at(-1)).toMatchObject({ posicao: 10, bilhetes: 91 });
    expect(
      classificarMaioresCompradores(muitos, 3).map((item) => item.posicao),
    ).toEqual([1, 2, 3]);
    expect(classificarMaioresCompradores(muitos, 50)).toHaveLength(50);
    expect(classificarMaioresCompradores([], 10)).toEqual([]);
  });

  it("a consulta: janela atual e 10 por padrão; limite de 1 a 50 (texto da URL vira número); fora disso, recusa", () => {
    expect(consultaMaioresCompradoresSchema.parse({})).toEqual({
      janela: "atual",
      limite: 10,
    });
    expect(
      consultaMaioresCompradoresSchema.parse({
        janela: "campanha",
        limite: "25",
      }),
    ).toEqual({
      janela: "campanha",
      limite: 25,
    });
    for (const consulta of [
      { limite: "0" },
      { limite: "51" },
      { limite: "2.5" },
      { limite: "dez" },
      { janela: "semana" },
      { janela: "" },
    ])
      expect(
        consultaMaioresCompradoresSchema.safeParse(consulta).success,
        JSON.stringify(consulta),
      ).toBe(false);
  });
});

describe("o item do admin (D36: telefone e R$ só para ele)", () => {
  it("telefone legível como no CSV, o número do WhatsApp, bilhetes, total, pedidos e células", () => {
    const [comTelefone, semTelefone] = classificarMaioresCompradores([
      pedido({
        nome: "Clara Ficticia",
        telefone: "+5511987654321",
        qtd_bilhetes: 4,
        total_centavos: 8000,
      }),
      pedido({ nome: "Davi Ficticio", qtd_bilhetes: 1, celula_nome: null }),
    ]).map(itemMaiorCompradorAdmin);
    expect(comTelefone).toEqual({
      posicao: 1,
      nome: "Clara Ficticia",
      telefone: "(11) 98765-4321",
      whatsapp: "5511987654321",
      bilhetes: 4,
      total_centavos: 8000,
      pedidos: 1,
      celulas: ["Célula Ficticia A"],
      sem_celula: false,
    });
    expect(semTelefone).toMatchObject({
      telefone: null,
      whatsapp: null,
      celulas: [],
      sem_celula: true,
    });
    respostaMaioresCompradoresSchema.parse({
      janela: JANELA,
      itens: [comTelefone, semTelefone],
      atualizado_em: AGORA,
    });
  });

  it("fora do Brasil, o E.164 como veio (e o WhatsApp com o país)", () => {
    const [item] = classificarMaioresCompradores([
      pedido({ nome: "Pessoa Ficticia de Fora", telefone: "+351912345678" }),
    ]).map(itemMaiorCompradorAdmin);
    expect(item).toMatchObject({
      telefone: "+351912345678",
      whatsapp: "351912345678",
    });
  });
});

describe("o item do discipulador (D12 e D38): sem telefone e sem R$", () => {
  it("só posição, nome, bilhetes e a célula com mais bilhetes", () => {
    const [item] = classificarMaioresCompradores([
      pedido({
        nome: "Elisa Ficticia",
        telefone: "+5591911112222",
        qtd_bilhetes: 2,
        celula_nome: "Célula Ficticia Betel",
      }),
      pedido({
        nome: "Elisa Ficticia",
        telefone: "+5591911112222",
        qtd_bilhetes: 3,
        celula_nome: "Célula Ficticia Ágape",
      }),
    ]).map(itemMeuMaiorComprador);
    expect(item).toEqual({
      posicao: 1,
      nome: "Elisa Ficticia",
      bilhetes: 5,
      celula: "Célula Ficticia Ágape",
    });
    respostaMeusMaioresCompradoresSchema.parse({
      janela: JANELA,
      itens: [item],
      atualizado_em: AGORA,
    });
  });

  it("o schema dele não tem campo de telefone, WhatsApp, dinheiro nem pedidos, e recusa um campo a mais", () => {
    expect(campos(respostaMeusMaioresCompradoresSchema)).toEqual(
      [
        "atualizado_em",
        "bilhetes",
        "celula",
        "data_fim",
        "data_inicio",
        "itens",
        "janela",
        "nome",
        "ordem",
        "posicao",
        "tipo",
      ].sort(),
    );
    for (const campo of campos(respostaMeusMaioresCompradoresSchema))
      expect(campo).not.toMatch(
        /telefone|whatsapp|centavos|total|valor|pedidos|email/,
      );
    const item = {
      posicao: 1,
      nome: "Elisa Ficticia",
      bilhetes: 5,
      celula: "Célula Ficticia Ágape",
    };
    for (const extra of [
      { telefone: "(91) 91111-2222" },
      { total_centavos: 10_000 },
      { whatsapp: "5591911112222" },
    ])
      expect(
        respostaMeusMaioresCompradoresSchema.safeParse({
          janela: JANELA,
          itens: [{ ...item, ...extra }],
          atualizado_em: AGORA,
        }).success,
      ).toBe(false);
  });
});

describe("os schemas das respostas: estritos e com as posições em ordem", () => {
  const item = (posicao: number, bilhetes: number) => ({
    posicao,
    nome: `Comprador Ficticio ${posicao}`,
    bilhetes,
    celula: "Célula Ficticia A",
  });
  const resposta = (itens: unknown[]) => ({
    janela: JANELA,
    itens,
    atualizado_em: AGORA,
  });

  it("aceita 1, 1, 3 e lista vazia; recusa posição fora da ordem e bilhetes subindo", () => {
    const aceita = (itens: unknown[]) =>
      respostaMeusMaioresCompradoresSchema.safeParse(resposta(itens)).success;
    expect(aceita([])).toBe(true);
    expect(aceita([item(1, 5), item(1, 5), item(3, 2)])).toBe(true);
    expect(aceita([item(2, 5)])).toBe(false);
    expect(aceita([item(1, 5), item(3, 4)])).toBe(false);
    expect(aceita([item(1, 5), item(2, 6)])).toBe(false);
    expect(
      aceita(
        Array.from({ length: 51 }, (_, indice) =>
          item(indice + 1, 60 - indice),
        ),
      ),
    ).toBe(false);
  });

  it("admin: telefone e WhatsApp vêm juntos; sem célula nenhuma, `sem_celula`", () => {
    const base = {
      posicao: 1,
      nome: "Clara Ficticia",
      telefone: "(11) 98765-4321",
      whatsapp: "5511987654321",
      bilhetes: 4,
      total_centavos: 8000,
      pedidos: 1,
      celulas: ["Célula Ficticia A"],
      sem_celula: false,
    };
    const aceita = (dados: object) =>
      respostaMaioresCompradoresSchema.safeParse(
        resposta([{ ...base, ...dados }]),
      ).success;
    expect(aceita({})).toBe(true);
    // Telefone sem WhatsApp é aceito (E.164 curto, de 7 algarismos: a tela mostra o número sem o link, em vez de o
    // cartão cair com 500; revisão da RIFA-083). WhatsApp sem telefone, não.
    expect(aceita({ whatsapp: null })).toBe(true);
    expect(aceita({ telefone: null, whatsapp: null })).toBe(true);
    expect(aceita({ telefone: null })).toBe(false);
    expect(aceita({ celulas: [] })).toBe(false);
    expect(aceita({ celulas: [], sem_celula: true })).toBe(true);
    expect(aceita({ email: "x" })).toBe(false);
  });
});

describe("o catálogo à parte (ROTAS_MAIORES_COMPRADORES)", () => {
  const definicoes = Object.values(ROTAS_MAIORES_COMPRADORES);

  it("a do admin (só admin) e a do discipulador (só discipulador), com a mesma consulta", () => {
    expect(
      definicoes.map((rota) => [
        `${rota.metodo} ${rota.caminho}`,
        rota.grupo,
        rota.papeis,
      ]),
    ).toEqual([
      ["GET /api/admin/maiores-compradores", "coordenacao", ["admin"]],
      ["GET /api/minha/maiores-compradores", "hierarquia", ["discipulador"]],
    ]);
    for (const rota of definicoes) {
      expect(rota.situacao).toBe("detalhada");
      expect(rota.sucesso.status).toBe(200);
      expect(rota.consulta).toBe(consultaMaioresCompradoresSchema);
      expectTypeOf(rota).toExtend<DefinicaoRota>();
    }
    expect(ROTAS_MAIORES_COMPRADORES.maioresCompradores.sucesso.corpo).toBe(
      respostaMaioresCompradoresSchema,
    );
    expect(ROTAS_MAIORES_COMPRADORES.meusMaioresCompradores.sucesso.corpo).toBe(
      respostaMeusMaioresCompradoresSchema,
    );
  });

  it("a do discipulador não aceita id de nada (o alvo vem só da sessão, D12): sem parâmetros nem corpo, e a consulta só tem janela e limite", () => {
    const rota: DefinicaoRota =
      ROTAS_MAIORES_COMPRADORES.meusMaioresCompradores;
    expect(rota.caminho).not.toContain(":");
    expect(rota.parametros).toBeUndefined();
    expect(rota.corpo).toBeUndefined();
    expect(Object.keys(consultaMaioresCompradoresSchema.shape).sort()).toEqual([
      "janela",
      "limite",
    ]);
    expect(
      consultaMaioresCompradoresSchema.parse({
        discipulador_id: "30",
        celula_id: "4",
      }),
    ).toEqual({
      janela: "atual",
      limite: 10,
    });
  });

  it("não repete rota de nenhum outro catálogo, e ROTAS continua com só a visão em /api/minha", () => {
    const existentes = new Set(
      [
        ...Object.values(ROTAS),
        ...Object.values(ROTAS_ACESSO),
        ...Object.values(ROTAS_ACESSO_HIERARQUIA),
        ...Object.values(ROTAS_REGRAS_CAMPANHA),
        ...Object.values(ROTAS_TOKEN_WEBHOOK),
        ...Object.values(ROTAS_RELATORIO),
        ...Object.values(ROTAS_LINK_VENDAS),
        ...Object.values(ROTAS_RIFEI_API),
        ...Object.values(ROTAS_CONEXAO_RIFEI),
      ].map((rota) => `${rota.metodo} ${rota.caminho}`),
    );
    for (const rota of definicoes)
      expect(existentes.has(`${rota.metodo} ${rota.caminho}`)).toBe(false);
    expect(
      Object.values(ROTAS)
        .filter((rota) => rota.caminho.startsWith("/api/minha"))
        .map((rota) => rota.caminho),
    ).toEqual(["/api/minha/visao"]);
  });

  it("o index exporta o catálogo, os schemas e a regra", () => {
    expect(contrato.ROTAS_MAIORES_COMPRADORES).toBe(ROTAS_MAIORES_COMPRADORES);
    expect(contrato.respostaMaioresCompradoresSchema).toBe(
      respostaMaioresCompradoresSchema,
    );
    expect(contrato.respostaMeusMaioresCompradoresSchema).toBe(
      respostaMeusMaioresCompradoresSchema,
    );
    expect(contrato.classificarMaioresCompradores).toBe(
      classificarMaioresCompradores,
    );
    expect(contrato.itemMaiorCompradorAdmin).toBe(itemMaiorCompradorAdmin);
    expect(contrato.itemMeuMaiorComprador).toBe(itemMeuMaiorComprador);
  });
});
