// RIFA-090 (adendo da D12): o ranking geral na /minha do discipulador e da rede. A resposta sai dos rankings da
// coordenação (`montarRankingPainel`) com a mesma posição e a mesma ordem, sem nenhum valor além do nome, do % da meta
// e dos bilhetes; `eu` marca as linhas de quem pede pelo id. E o schema estrito e o catálogo à parte. Nomes fictícios.
// A rota no D1 local e o 401/403 de cada papel: src/worker/routes/minha-todas-as-redes.test.ts e protecao.test.ts.
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { ROTAS_ACESSO, ROTAS_ACESSO_HIERARQUIA } from "./acesso";
import {
  ROTAS,
  ROTAS_ARRECADADO,
  ROTAS_CONEXAO_RIFEI,
  ROTAS_LINK_VENDAS,
  ROTAS_MAIORES_COMPRADORES,
  ROTAS_REGRAS_CAMPANHA,
  ROTAS_RELATORIO,
  ROTAS_RELATORIO_DIARIO,
  ROTAS_RIFEI_API,
  ROTAS_TOKEN_WEBHOOK,
  type DefinicaoRota,
  type JanelaRanking,
} from "./api";
import { somarDias } from "./calendario";
import {
  montarRankingPainel,
  type CampanhaCalculo,
  type CelulaCalculo,
  type EntradaCalculo,
  type VendasDoDia,
} from "./calculos";
import type { Alvo } from "./dominio";
import * as contrato from "./index";
import {
  ROTAS_TODAS_AS_REDES,
  consultaTodasAsRedesSchema,
  montarTodasAsRedes,
  respostaTodasAsRedesSchema,
  type RespostaTodasAsRedes,
} from "./todas-as-redes";

/** 21 dias (7/7/7, com 35/25/40), 10 bilhetes por pessoa, a partir de 23/11/2026, ranking único (D27) pelo % da meta. */
const CAMPANHA: CampanhaCalculo = {
  nome: "Projeto Videira Kids",
  fuso_horario: "America/Belem",
  data_inicio: "2026-11-23",
  meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
  periodos: [
    { nome: "Semana 1", dias: 7, percentual_bp: 3500 },
    { nome: "Semana 2", dias: 7, percentual_bp: 2500 },
    { nome: "Semana 3", dias: 7, percentual_bp: 4000 },
  ],
  ranking: { criterio: "percentual_meta", por_divisao: false },
  publico: { mostra_percentual_meta: false, limite_ranking: 3 },
};

function celula(
  id: number,
  nome: string,
  qtd_pessoas: number,
  discipulador: [number, string],
  rede: [number, string, "jovens" | "adultos"],
): CelulaCalculo {
  return {
    id,
    nome,
    qtd_pessoas,
    discipulador_id: discipulador[0],
    discipulador_nome: discipulador[1],
    rede_id: rede[0],
    rede_nome: rede[1],
    divisao: rede[2],
  };
}

const ABEL: [number, string] = [10, "Discipulador Abel"];
const BOAZ: [number, string] = [20, "Discipulador Boaz"];
const CALEB: [number, string] = [30, "Discipulador Caleb"];
const JOVEM: [number, string, "jovens"] = [
  100,
  "Rede Jovem Ficticia",
  "jovens",
];
const ADULTA: [number, string, "adultos"] = [
  200,
  "Rede Adulta Ficticia",
  "adultos",
];

/** Metas da campanha (10 por pessoa): Ágape 120, Betel 60, Canaã 120, Dorcas 200, Éfeso 100. */
const CELULAS: CelulaCalculo[] = [
  celula(1, "Célula Ágape", 12, ABEL, JOVEM),
  celula(2, "Célula Betel", 6, ABEL, JOVEM),
  celula(3, "Célula Canaã", 12, BOAZ, JOVEM),
  celula(4, "Célula Dorcas", 20, CALEB, ADULTA),
  celula(5, "Célula Éfeso", 10, CALEB, ADULTA),
];

const dia = (n: number) => somarDias("2026-11-23", n - 1);

/** Vendas com totais inconfundíveis (centavos que não são bilhetes × preço), para provar que não vazam. */
const venda = (
  celula_id: number | null,
  n: number,
  bilhetes: number,
): VendasDoDia => ({
  celula_id,
  dia: dia(n),
  pedidos: 1,
  bilhetes,
  centavos: bilhetes * 1_987 + 13,
});

const VENDAS: VendasDoDia[] = [
  // Semana 1.
  venda(1, 2, 30),
  venda(3, 3, 12),
  venda(4, 4, 50),
  // Semana 2 (dia 9 = hoje).
  venda(2, 8, 9),
  venda(5, 9, 25),
  venda(1, 9, 6),
  // Sem célula: entra no total da campanha, nunca numa linha.
  venda(null, 9, 40),
];

const ENTRADA: EntradaCalculo = {
  campanha: CAMPANHA,
  celulas: CELULAS,
  vendas: VENDAS,
};
/** Meio-dia em Belém do dia 9 (2º dia da Semana 2). */
const AGORA = new Date(`${dia(9)}T15:00:00.000Z`);

const ALVO_ABEL: Alvo = {
  tipo: "discipulador",
  id: 10,
  nome: "Discipulador Abel",
  divisao: "jovens",
};
const ALVO_ADULTA: Alvo = {
  tipo: "rede",
  id: 200,
  nome: "Rede Adulta Ficticia",
  divisao: "adultos",
};

function rankings(janela: JanelaRanking, entrada: EntradaCalculo = ENTRADA) {
  return {
    discipuladores: montarRankingPainel(
      entrada,
      { nivel: "discipulador", periodo: janela },
      AGORA,
    ),
    celulas: montarRankingPainel(
      entrada,
      { nivel: "celula", periodo: janela },
      AGORA,
    ),
  };
}

function todasAsRedes(
  janela: JanelaRanking,
  alvo: Alvo = ALVO_ABEL,
  entrada: EntradaCalculo = ENTRADA,
): RespostaTodasAsRedes {
  const resposta = montarTodasAsRedes(rankings(janela, entrada), alvo);
  // O que a função monta é exatamente o schema da rota (estrito, com as posições conferidas).
  expect(respostaTodasAsRedesSchema.parse(resposta)).toEqual(resposta);
  return resposta;
}

/** Todas as chaves de um valor JSON, em qualquer nível. */
function chavesDe(valor: unknown, chaves: string[] = []): string[] {
  if (Array.isArray(valor)) for (const item of valor) chavesDe(item, chaves);
  else if (valor !== null && typeof valor === "object")
    for (const [chave, item] of Object.entries(valor)) {
      chaves.push(chave);
      chavesDe(item, chaves);
    }
  return chaves;
}

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

describe("montarTodasAsRedes: o ranking da coordenação, sem os valores", () => {
  it.each(["atual", "campanha"] as const)(
    "janela %s: todos os discipuladores com células e todas as células, na posição e na ordem da coordenação",
    (janela) => {
      const daCoordenacao = rankings(janela);
      const resposta = todasAsRedes(janela);
      expect(resposta.janela).toEqual(daCoordenacao.celulas.janela);
      expect(resposta.janela.tipo).toBe(janela);
      expect(resposta.criterio).toBe("percentual_meta");
      expect(resposta.referencia).toEqual(daCoordenacao.celulas.referencia);
      expect(resposta.atualizado_em).toBe(AGORA.toISOString());
      expect(resposta.discipuladores).toEqual(
        daCoordenacao.discipuladores.itens.map((item) => ({
          posicao: item.posicao,
          nome: item.nome,
          percentual_meta_bp: item.percentual_meta_bp,
          bilhetes: item.vendas.bilhetes,
          eu: item.id === 10,
        })),
      );
      expect(resposta.celulas).toEqual(
        daCoordenacao.celulas.itens.map((item) => ({
          posicao: item.posicao,
          nome: item.nome,
          discipulador: item.discipulador?.nome,
          percentual_meta_bp: item.percentual_meta_bp,
          bilhetes: item.vendas.bilhetes,
          eu: item.discipulador?.id === 10,
        })),
      );
      expect(resposta.discipuladores).toHaveLength(3);
      expect(resposta.celulas).toHaveLength(5);
    },
  );

  it("as contas de exemplo: na Semana 2, Éfeso 1º (25 de 25), Betel 2º (9 de 15); na campanha, Dorcas no topo dos bilhetes", () => {
    const semana = todasAsRedes("atual");
    expect(
      semana.celulas.map((item) => [item.posicao, item.nome, item.bilhetes]),
    ).toEqual([
      [1, "Célula Éfeso", 25],
      [2, "Célula Betel", 9],
      [3, "Célula Ágape", 6],
      [4, "Célula Canaã", 0],
      [4, "Célula Dorcas", 0],
    ]);
    // O % da meta do período: Éfeso vendeu os 25 da Semana 2 (100 × 25%).
    expect(semana.celulas[0].percentual_meta_bp).toBe(10_000);
    const campanha = todasAsRedes("campanha");
    expect(
      campanha.celulas.find((item) => item.nome === "Célula Dorcas"),
    ).toMatchObject({ bilhetes: 50, discipulador: "Discipulador Caleb" });
    // As vendas sem célula não viram linha.
    expect(
      campanha.celulas.reduce((soma, item) => soma + item.bilhetes, 0),
    ).toBe(132);
  });

  it("eu: o discipulador marca a linha dele e as células dele; a rede, os discipuladores e as células dela (pelo id)", () => {
    const abel = todasAsRedes("campanha", ALVO_ABEL);
    expect(
      abel.discipuladores.filter((item) => item.eu).map((item) => item.nome),
    ).toEqual(["Discipulador Abel"]);
    expect(
      abel.celulas
        .filter((item) => item.eu)
        .map((item) => item.nome)
        .sort(),
    ).toEqual(["Célula Betel", "Célula Ágape"].sort());
    const adulta = todasAsRedes("campanha", ALVO_ADULTA);
    expect(
      adulta.discipuladores.filter((item) => item.eu).map((item) => item.nome),
    ).toEqual(["Discipulador Caleb"]);
    expect(
      adulta.celulas
        .filter((item) => item.eu)
        .map((item) => item.nome)
        .sort(),
    ).toEqual(["Célula Dorcas", "Célula Éfeso"].sort());
    // Pelo id, nunca pelo nome: um alvo com o nome do Abel e outro id não marca nada.
    const xara = todasAsRedes("campanha", { ...ALVO_ABEL, id: 99 });
    expect(
      [...xara.discipuladores, ...xara.celulas].some((item) => item.eu),
    ).toBe(false);
  });

  it("nenhum valor sai: nem centavos, nem meta, nem realizado, nem vizinhos, nem ids (em bilhetes e em centavos, em qualquer critério)", () => {
    for (const campanha of [
      CAMPANHA,
      {
        ...CAMPANHA,
        meta: { unidade: "centavos", regra: "por_pessoa", valor: 20_000 },
        ranking: { criterio: "arrecadacao", por_divisao: false },
      } satisfies CampanhaCalculo,
    ]) {
      const entrada = { ...ENTRADA, campanha };
      const resposta = todasAsRedes("campanha", ALVO_ABEL, entrada);
      const texto = JSON.stringify(resposta);
      const centavos = VENDAS.map((item) => item.centavos);
      const daCoordenacao = rankings("campanha", entrada);
      const totais = daCoordenacao.celulas.itens.map(
        (item) => item.vendas.total_centavos,
      );
      for (const valor of [...centavos, ...totais].filter((v) => v > 0))
        expect(texto).not.toContain(String(valor));
      expect(
        chavesDe(resposta).filter((chave) =>
          /centavos|total|^meta$|realizado|esperado|acima|abaixo|^id$|rede|telefone|comprador|senha/.test(
            chave,
          ),
        ),
      ).toEqual([]);
      expect(texto).not.toMatch(/R\$|Rede|telefone|senha/);
    }
  });

  it("o schema não tem campo de dinheiro, de contato nem de comprador (só nome, %, bilhetes, posição e o 'eu')", () => {
    expect(campos(respostaTodasAsRedesSchema)).toEqual(
      [
        "atualizado_em",
        "bilhetes",
        "celulas",
        "criterio",
        "data",
        "data_fim",
        "data_inicio",
        "dia_campanha",
        "dia_no_periodo",
        "dias",
        "dias_para_inicio",
        "dias_restantes",
        "discipulador",
        "discipuladores",
        "duracao_dias",
        "eu",
        "fase",
        "janela",
        "nome",
        "ordem",
        "percentual_meta_bp",
        "periodo",
        "posicao",
        "referencia",
        "tipo",
      ].sort(),
    );
  });

  it("o schema recusa campo a mais, posição fora da ordem e célula sem discipulador", () => {
    const certa = todasAsRedes("campanha");
    const aceita = (resposta: object) =>
      respostaTodasAsRedesSchema.safeParse(resposta).success;
    expect(aceita(certa)).toBe(true);
    const [primeira, ...resto] = certa.celulas;
    for (const errada of [
      { ...certa, celulas: [{ ...primeira, total_centavos: 100 }, ...resto] },
      { ...certa, celulas: [{ ...primeira, telefone: "x" }, ...resto] },
      { ...certa, celulas: [{ ...primeira, id: 1 }, ...resto] },
      { ...certa, celulas: [{ ...primeira, posicao: 2 }, ...resto] },
      { ...certa, celulas: [{ ...primeira, discipulador: null }, ...resto] },
      {
        ...certa,
        discipuladores: [
          certa.discipuladores[0],
          { ...certa.discipuladores[1], posicao: 3 },
        ],
      },
      { ...certa, vendas: { bilhetes: 1 } },
    ])
      expect(aceita(errada)).toBe(false);
    // Empate divide a posição (1, 1, 3).
    expect(
      aceita({
        ...certa,
        discipuladores: [
          { ...certa.discipuladores[0], posicao: 1 },
          { ...certa.discipuladores[1], posicao: 1 },
          { ...certa.discipuladores[2], posicao: 3 },
        ],
      }),
    ).toBe(true);
  });

  it("sem células: as duas listas vazias", () => {
    const vazia = todasAsRedes("atual", ALVO_ABEL, {
      ...ENTRADA,
      celulas: [],
      vendas: [],
    });
    expect(vazia.discipuladores).toEqual([]);
    expect(vazia.celulas).toEqual([]);
  });

  it("recusa os rankings trocados de nível", () => {
    const { discipuladores, celulas } = rankings("atual");
    expect(() =>
      montarTodasAsRedes(
        { discipuladores: celulas, celulas: discipuladores },
        ALVO_ABEL,
      ),
    ).toThrow(RangeError);
  });
});

describe("o catálogo à parte (ROTAS_TODAS_AS_REDES)", () => {
  it("GET /api/minha/todas-as-redes, da hierarquia, só do discipulador e da rede (o líder não)", () => {
    const rota: DefinicaoRota = ROTAS_TODAS_AS_REDES.todasAsRedes;
    expect([
      `${rota.metodo} ${rota.caminho}`,
      rota.grupo,
      rota.papeis,
      rota.situacao,
      rota.sucesso,
    ]).toEqual([
      "GET /api/minha/todas-as-redes",
      "hierarquia",
      ["discipulador", "rede"],
      "detalhada",
      { status: 200, corpo: respostaTodasAsRedesSchema },
    ]);
    expectTypeOf(ROTAS_TODAS_AS_REDES.todasAsRedes).toExtend<DefinicaoRota>();
  });

  it("não aceita id de nada (o alvo vem só da sessão, D12): sem parâmetros nem corpo, e a consulta só tem a janela", () => {
    const rota: DefinicaoRota = ROTAS_TODAS_AS_REDES.todasAsRedes;
    expect(rota.caminho).not.toContain(":");
    expect(rota.parametros).toBeUndefined();
    expect(rota.corpo).toBeUndefined();
    expect(rota.consulta).toBe(consultaTodasAsRedesSchema);
    expect(Object.keys(consultaTodasAsRedesSchema.shape)).toEqual(["janela"]);
    expect(
      consultaTodasAsRedesSchema.parse({ discipulador_id: "30", rede_id: "2" }),
    ).toEqual({ janela: "atual" });
    expect(consultaTodasAsRedesSchema.parse({ janela: "campanha" })).toEqual({
      janela: "campanha",
    });
    expect(
      consultaTodasAsRedesSchema.safeParse({ janela: "semana" }).success,
    ).toBe(false);
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
        ...Object.values(ROTAS_MAIORES_COMPRADORES),
        ...Object.values(ROTAS_RELATORIO_DIARIO),
        ...Object.values(ROTAS_ARRECADADO),
      ].map((rota) => `${rota.metodo} ${rota.caminho}`),
    );
    for (const rota of Object.values(ROTAS_TODAS_AS_REDES))
      expect(existentes.has(`${rota.metodo} ${rota.caminho}`)).toBe(false);
    expect(
      Object.values(ROTAS)
        .filter((rota) => rota.caminho.startsWith("/api/minha"))
        .map((rota) => rota.caminho),
    ).toEqual(["/api/minha/visao"]);
  });

  it("o index exporta o catálogo, os schemas e o montador", () => {
    expect(contrato.ROTAS_TODAS_AS_REDES).toBe(ROTAS_TODAS_AS_REDES);
    expect(contrato.respostaTodasAsRedesSchema).toBe(
      respostaTodasAsRedesSchema,
    );
    expect(contrato.consultaTodasAsRedesSchema).toBe(
      consultaTodasAsRedesSchema,
    );
    expect(contrato.montarTodasAsRedes).toBe(montarTodasAsRedes);
  });
});
