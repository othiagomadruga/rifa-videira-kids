// Regras de cálculo (RIFA-008): cada regra de docs/regras-de-calculo.md com exemplos numéricos
// calculados à mão. Os montadores são conferidos contra os schemas estritos das rotas (CA3).
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import * as contrato from ".";
import {
  JANELAS_RANKING,
  NIVEIS_RANKING,
  itemRankingPublicoSchema,
  janelaRankingSchema,
  metaDoDiaSchema,
  pontoCurvaSchema,
  referenciaCampanhaSchema,
  respostaBumboSchema,
  respostaPainelResumoSchema,
  respostaRankingPublicoSchema,
  respostaRankingSchema,
  vizinhoRankingSchema,
  type ConsultaRanking,
  type RespostaPainelResumo,
  type SituacaoRitmo,
} from "./api";
import {
  BUMBO_PADRAO,
  NOMES_DIVISAO,
  ORDEM_DIVISOES,
  agruparVendasPorDia,
  classificarRanking,
  curvaEsperada,
  diaLocalDoInstante,
  esperadoAteODia,
  hojeNoFuso,
  intervaloUtcDoDia,
  janelaUtcDaCampanha,
  metaArredondada,
  metaDoDia,
  metasDasCelulas,
  montarBumbo,
  montarRankingPainel,
  montarRankingPublico,
  montarResumoPainel,
  percentualEsperadoBp,
  projecaoDoFim,
  rankingPorDivisao,
  referenciaDaCampanha,
  situacaoDoRitmo,
  somarMetas,
  vendaContaNaCampanha,
  type CampanhaCalculo,
  type CelulaCalculo,
  type EntradaCalculo,
  type EscopoResolvido,
  type ItemRankingPublico,
  type JanelaRanking,
  type JanelaRankingResposta,
  type MetaDoDia,
  type PeriodoDaReferencia,
  type PontoCurva,
  type RitmoCampanha,
  type VendaAprovada,
  type VendasDoDia,
  type VendasForaDaJanela,
  type VinculoRanking,
  type VizinhoRanking,
} from "./calculos";
import fonteCalculos from "./calculos.ts?raw";
import {
  diasEntre,
  hojeNoFuso as hojeNoFusoDoCalendario,
  somarDias,
} from "./calendario";
import fonteCalendario from "./calendario.ts?raw";
import { CRITERIOS_RANKING, DIVISOES, REGRAS_META } from "./dominio";
import { RANKING_POR_DIVISAO_PADRAO } from "./regras";

// ---------------------------------------------------------------------------------------------------
// Cenário: 21 dias (7/7/7) com 35/25/45 (soma 105%), 10 bilhetes por pessoa, início em 23/11/2026.
// Dias: 1 = 23/11 … 7 = 29/11 (Semana 1), 8 = 30/11 … 14 = 06/12 (Semana 2), 15 = 07/12 … 21 = 13/12.
// ---------------------------------------------------------------------------------------------------

const CAMPANHA: CampanhaCalculo = {
  nome: "Projeto Videira Kids",
  fuso_horario: "America/Belem",
  data_inicio: "2026-11-23",
  meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
  periodos: [
    { nome: "Semana 1", dias: 7, percentual_bp: 3500 },
    { nome: "Semana 2", dias: 7, percentual_bp: 2500 },
    { nome: "Semana 3", dias: 7, percentual_bp: 4500 },
  ],
  ranking: { criterio: "percentual_meta" },
  publico: { mostra_percentual_meta: false, limite_ranking: 3 },
};

/** Modelo de Santo André: 24 dias em 10/7/7 com 35/25/45. */
const PERIODOS_SA = [
  { nome: "Semana 1", dias: 10, percentual_bp: 3500 },
  { nome: "Semana 2", dias: 7, percentual_bp: 2500 },
  { nome: "Semana 3", dias: 7, percentual_bp: 4500 },
];

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
const JOVEM: [number, string, "jovens"] = [100, "Rede Jovem Norte", "jovens"];
const ADULTA: [number, string, "adultos"] = [200, "Rede Adulta Sul", "adultos"];

/** Metas (10 por pessoa): Ágape 120, Betel 60, Canaã 120, Dorcas 200, Éfeso 100; campanha 600. */
const CELULAS: CelulaCalculo[] = [
  celula(1, "Célula Ágape", 12, ABEL, JOVEM),
  celula(2, "Célula Betel", 6, ABEL, JOVEM),
  celula(3, "Célula Canaã", 12, BOAZ, JOVEM),
  celula(4, "Célula Dorcas", 20, CALEB, ADULTA),
  celula(5, "Célula Éfeso", 10, CALEB, ADULTA),
];

/** Data do dia `n` da campanha (1 = 23/11/2026). */
const dia = (n: number) => somarDias("2026-11-23", n - 1);

function venda(
  celula_id: number | null,
  data: string,
  bilhetes: number,
  centavos = bilhetes * 2000,
  pedidos = 1,
): VendasDoDia {
  return { celula_id, dia: data, pedidos, bilhetes, centavos };
}

/** `quantidade` bilhetes por dia nos dias de `de` a `ate`. */
function porDia(
  celula_id: number | null,
  de: number,
  ate: number,
  quantidade: number,
): VendasDoDia[] {
  const vendas: VendasDoDia[] = [];
  for (let n = de; n <= ate; n++)
    vendas.push(venda(celula_id, dia(n), quantidade));
  return vendas;
}

function entrada(
  vendas: VendasDoDia[],
  campanha: CampanhaCalculo = CAMPANHA,
  celulas: CelulaCalculo[] = CELULAS,
): EntradaCalculo {
  return { campanha, celulas, vendas };
}

/** Meio-dia em Belém (15:00Z) do dia `n` da campanha. */
const meioDia = (n: number) => new Date(`${dia(n)}T15:00:00.000Z`);

const ESCOPO_CAMPANHA: EscopoResolvido = {
  tipo: "campanha",
  id: null,
  divisao: null,
  nome: "Projeto Videira Kids",
};
const ESCOPO_AGAPE: EscopoResolvido = {
  tipo: "celula",
  id: 1,
  divisao: "jovens",
  nome: "Célula Ágape",
};

function resumo(
  vendas: VendasDoDia[],
  agora: Date,
  escopo: EscopoResolvido = ESCOPO_AGAPE,
  campanha: CampanhaCalculo = CAMPANHA,
  data?: string,
) {
  const resposta = montarResumoPainel(
    entrada(vendas, campanha),
    { escopo, data },
    agora,
  );
  // CA3: o que a função monta é exatamente o schema da rota (estrito).
  expect(respostaPainelResumoSchema.parse(resposta)).toEqual(resposta);
  return resposta;
}

function ranking(
  vendas: VendasDoDia[],
  agora: Date,
  consulta: Partial<ConsultaRanking> = {},
  campanha: CampanhaCalculo = CAMPANHA,
  celulas: CelulaCalculo[] = CELULAS,
) {
  const resposta = montarRankingPainel(
    entrada(vendas, campanha, celulas),
    { nivel: "celula", periodo: "campanha", ...consulta },
    agora,
  );
  expect(respostaRankingSchema.parse(resposta)).toEqual(resposta);
  return resposta;
}

const posicoes = (resposta: { itens: { posicao: number; nome: string }[] }) =>
  resposta.itens.map((item) => [item.posicao, item.nome]);

it("as regras saem pelo index do contrato (Worker e site importam de lá)", () => {
  expect(contrato.montarResumoPainel).toBe(montarResumoPainel);
  expect(contrato.montarRankingPainel).toBe(montarRankingPainel);
  expect(contrato.montarRankingPublico).toBe(montarRankingPublico);
  expect(contrato.montarBumbo).toBe(montarBumbo);
  expect(contrato.vendaContaNaCampanha).toBe(vendaContaNaCampanha);
  expect([...ORDEM_DIVISOES]).toEqual([...DIVISOES]);
  expect(Object.keys(NOMES_DIVISAO).sort()).toEqual([...DIVISOES].sort());
});

describe("RIFA-008b: o que as rotas e as telas importam", () => {
  it("'hoje no fuso' é uma função só: hojeNoFuso, e diaLocalDoInstante delega para ela", () => {
    expect(hojeNoFuso).toBe(hojeNoFusoDoCalendario);
    expect(contrato.hojeNoFuso).toBe(hojeNoFusoDoCalendario);
    for (const instante of [
      "2026-11-23T02:59:59.999Z",
      "2026-11-23T03:00:00.000Z",
      "2026-12-31T23:59:59.999Z",
      "2028-02-29T12:00:00.000Z",
    ])
      for (const fuso of ["America/Belem", "UTC", "America/Sao_Paulo"])
        expect(diaLocalDoInstante(instante, fuso), `${instante} ${fuso}`).toBe(
          hojeNoFuso(fuso, new Date(instante)),
        );
  });

  it("tipos nomeados para as telas são os das respostas (conferido pelo typecheck)", () => {
    expectTypeOf<MetaDoDia>().toEqualTypeOf<z.infer<typeof metaDoDiaSchema>>();
    expectTypeOf<PontoCurva>().toEqualTypeOf<
      z.infer<typeof pontoCurvaSchema>
    >();
    expectTypeOf<ItemRankingPublico>().toEqualTypeOf<
      z.infer<typeof itemRankingPublicoSchema>
    >();
    expectTypeOf<VizinhoRanking>().toEqualTypeOf<
      z.infer<typeof vizinhoRankingSchema>
    >();
    expectTypeOf<JanelaRankingResposta>().toEqualTypeOf<
      z.infer<typeof janelaRankingSchema>
    >();
    expectTypeOf<RitmoCampanha>().toEqualTypeOf<
      RespostaPainelResumo["campanha"]
    >();
    expectTypeOf<VendasForaDaJanela>().toEqualTypeOf<
      NonNullable<RespostaPainelResumo["vendas_fora_da_janela"]>
    >();
    expectTypeOf<PeriodoDaReferencia>().toEqualTypeOf<
      NonNullable<RespostaPainelResumo["referencia"]["periodo"]>
    >();
    expectTypeOf<VinculoRanking>().toEqualTypeOf<{
      id: number;
      nome: string;
    }>();
    // JanelaRanking é o valor pedido na consulta; o objeto da resposta é JanelaRankingResposta.
    expectTypeOf<JanelaRanking>().toEqualTypeOf<"atual" | "campanha">();
    expectTypeOf<
      JanelaRankingResposta["tipo"]
    >().toEqualTypeOf<JanelaRanking>();
  });

  it("calculos.ts e calendario.ts não carregam o zod: de zod e dos schemas só vêm tipos", () => {
    // Sem os comentários (primeiro as linhas `//`, que podem citar "/api/painel/*"; depois os blocos).
    const declaracoes = (fonte: string) =>
      fonte
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
        .match(/^(?:import|export)\b[^;]*?\bfrom\s+"[^"]+";/gms) ?? [];
    const comZod =
      /from\s+"(?:zod|\.|\.\/(?:api|dominio|rifei|erros|acesso|index))"/;
    for (const [arquivo, fonte] of [
      ["calculos.ts", fonteCalculos],
      ["calendario.ts", fonteCalendario],
    ] as const) {
      const lista = declaracoes(fonte);
      expect(lista.length, arquivo).toBeGreaterThan(0);
      for (const declaracao of lista.filter((d) => comZod.test(d)))
        expect(declaracao, arquivo).toMatch(/^(?:import|export) type\b/);
    }
    // calculos.ts traz os valores só de calendario.ts.
    expect(
      declaracoes(fonteCalculos)
        .filter((d) => !/^(?:import|export) type\b/.test(d))
        .map((d) => /from\s+"([^"]+)"/.exec(d)?.[1]),
    ).toEqual(["./calendario"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// R6. Dia local e janela da campanha
// ---------------------------------------------------------------------------------------------------

describe("R6: dia local (America/Belem, UTC−3) e janela da campanha", () => {
  it.each([
    ["2026-11-23T02:59:59.999Z", "2026-11-22"],
    ["2026-11-23T03:00:00.000Z", "2026-11-23"],
    ["2026-11-23T00:30:00.000-03:00", "2026-11-23"],
    ["2026-12-14T02:59:59.999Z", "2026-12-13"],
    ["2026-12-14T03:00:00.000Z", "2026-12-14"],
  ])("%s é do dia local %s", (instante, esperado) => {
    expect(diaLocalDoInstante(instante, "America/Belem")).toBe(esperado);
    expect(diaLocalDoInstante(new Date(instante), "America/Belem")).toBe(
      esperado,
    );
  });

  it.each([
    [
      "2026-11-20T15:00:00.000Z",
      false,
      "compra de teste na reunião de cadastro",
    ],
    ["2026-11-23T02:59:59.999Z", false, "22/11 às 23:59 em Belém"],
    ["2026-11-23T03:00:00.000Z", true, "23/11 à 00:00 em Belém (1º dia)"],
    ["2026-12-14T02:59:59.999Z", true, "13/12 às 23:59 em Belém (último dia)"],
    ["2026-12-14T03:00:00.000Z", false, "14/12 à 00:00 em Belém"],
  ])("venda aprovada em %s conta? %s (%s)", (instante, conta) => {
    expect(vendaContaNaCampanha(instante, CAMPANHA)).toBe(conta);
    // A janela UTC (para filtrar no banco) diz o mesmo: [inicio, fim).
    const { inicio, fim } = janelaUtcDaCampanha(CAMPANHA);
    const instanteUtc = new Date(instante).toISOString();
    expect(instanteUtc >= inicio && instanteUtc < fim).toBe(conta);
  });

  it("janela UTC: do início do primeiro dia local ao fim do último (exclusivo)", () => {
    expect(janelaUtcDaCampanha(CAMPANHA)).toEqual({
      inicio: "2026-11-23T03:00:00.000Z",
      fim: "2026-12-14T03:00:00.000Z",
    });
    expect(intervaloUtcDoDia("2026-12-01", "America/Belem")).toEqual({
      inicio: "2026-12-01T03:00:00.000Z",
      fim: "2026-12-02T03:00:00.000Z",
    });
  });

  it("vale para outro fuso, inclusive com horário de verão começando à meia-noite", () => {
    // São Paulo, 04/11/2018: o relógio pulou de 00:00 para 01:00 (−3 → −2).
    expect(intervaloUtcDoDia("2018-11-04", "America/Sao_Paulo")).toEqual({
      inicio: "2018-11-04T03:00:00.000Z",
      fim: "2018-11-05T02:00:00.000Z",
    });
    // 17/02/2019: a meia-noite voltou para 23:00 do dia 16 (−2 → −3).
    expect(intervaloUtcDoDia("2019-02-16", "America/Sao_Paulo")).toEqual({
      inicio: "2019-02-16T02:00:00.000Z",
      fim: "2019-02-17T03:00:00.000Z",
    });
    expect(intervaloUtcDoDia("2026-11-23", "UTC").inicio).toBe(
      "2026-11-23T00:00:00.000Z",
    );
  });

  it("instante sem fuso ou inválido é recusado (o fuso do aparelho não pode decidir o dia)", () => {
    expect(() =>
      diaLocalDoInstante("2026-11-23T12:00:00", "America/Belem"),
    ).toThrow(RangeError);
    expect(() => diaLocalDoInstante("ontem", "America/Belem")).toThrow(
      RangeError,
    );
  });

  it("agruparVendasPorDia: soma por célula e dia local, separando 02:59Z de 03:00Z", () => {
    const linhas = [
      {
        celula_id: 1,
        aprovado_em: "2026-11-23T02:59:59.999Z",
        qtd_bilhetes: 2,
        total_centavos: 4000,
      },
      {
        celula_id: 1,
        aprovado_em: "2026-11-23T03:00:00.000Z",
        qtd_bilhetes: 3,
        total_centavos: 6000,
      },
      {
        celula_id: 1,
        aprovado_em: "2026-11-24T02:00:00.000Z",
        qtd_bilhetes: 1,
        total_centavos: 1990,
      },
      {
        celula_id: null,
        aprovado_em: "2026-11-23T15:00:00.000Z",
        qtd_bilhetes: 1,
        total_centavos: 2000,
      },
      {
        celula_id: 2,
        aprovado_em: "2026-11-23T15:00:00.000Z",
        qtd_bilhetes: 4,
        total_centavos: 8000,
      },
    ];
    expect(agruparVendasPorDia(linhas, "America/Belem")).toEqual([
      {
        celula_id: 1,
        dia: "2026-11-22",
        pedidos: 1,
        bilhetes: 2,
        centavos: 4000,
      },
      {
        celula_id: null,
        dia: "2026-11-23",
        pedidos: 1,
        bilhetes: 1,
        centavos: 2000,
      },
      {
        celula_id: 1,
        dia: "2026-11-23",
        pedidos: 2,
        bilhetes: 4,
        centavos: 7990,
      },
      {
        celula_id: 2,
        dia: "2026-11-23",
        pedidos: 1,
        bilhetes: 4,
        centavos: 8000,
      },
    ]);
    expect(() =>
      agruparVendasPorDia(
        [{ ...linhas[0], qtd_bilhetes: 1.5 }],
        "America/Belem",
      ),
    ).toThrow(RangeError);
  });

  it("a data de referência vira à 00:00 de Belém (03:00Z), não à meia-noite UTC", () => {
    const vendas = porDia(1, 1, 7, 6);
    const antes = resumo(vendas, new Date("2026-11-30T02:59:59.999Z"));
    const depois = resumo(vendas, new Date("2026-11-30T03:00:00.000Z"));
    expect(antes.referencia).toMatchObject({
      data: "2026-11-29",
      dia_campanha: 7,
    });
    expect(depois.referencia).toMatchObject({
      data: "2026-11-30",
      dia_campanha: 8,
    });
    expect(antes.hoje?.realizado).toBe(6);
    expect(depois.hoje?.realizado).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------
// R7. Fase, dia e período
// ---------------------------------------------------------------------------------------------------

describe("R7: fase, dia N de total, período atual e dias restantes", () => {
  it.each([
    [
      "2026-11-20",
      {
        fase: "antes",
        dia_campanha: null,
        dias_restantes: 21,
        dias_para_inicio: 3,
        periodo: null,
      },
    ],
    [
      "2026-11-22",
      {
        fase: "antes",
        dia_campanha: null,
        dias_restantes: 21,
        dias_para_inicio: 1,
        periodo: null,
      },
    ],
    [
      "2026-11-23",
      {
        fase: "durante",
        dia_campanha: 1,
        dias_restantes: 21,
        dias_para_inicio: null,
        periodo: {
          ordem: 1,
          nome: "Semana 1",
          data_inicio: "2026-11-23",
          data_fim: "2026-11-29",
          dias: 7,
          dia_no_periodo: 1,
          dias_restantes: 7,
        },
      },
    ],
    [
      "2026-11-30",
      {
        fase: "durante",
        dia_campanha: 8,
        dias_restantes: 14,
        dias_para_inicio: null,
        periodo: {
          ordem: 2,
          nome: "Semana 2",
          data_inicio: "2026-11-30",
          data_fim: "2026-12-06",
          dias: 7,
          dia_no_periodo: 1,
          dias_restantes: 7,
        },
      },
    ],
    [
      "2026-12-13",
      {
        fase: "durante",
        dia_campanha: 21,
        dias_restantes: 1,
        dias_para_inicio: null,
        periodo: {
          ordem: 3,
          nome: "Semana 3",
          data_inicio: "2026-12-07",
          data_fim: "2026-12-13",
          dias: 7,
          dia_no_periodo: 7,
          dias_restantes: 1,
        },
      },
    ],
    [
      "2026-12-14",
      {
        fase: "encerrada",
        dia_campanha: null,
        dias_restantes: 0,
        dias_para_inicio: null,
        periodo: null,
      },
    ],
  ] as const)("em %s", (data, esperado) => {
    expect(referenciaDaCampanha(CAMPANHA, data)).toEqual({
      data,
      data_inicio: "2026-11-23",
      data_fim: "2026-12-13",
      duracao_dias: 21,
      ...esperado,
    });
  });

  it("modelo de Santo André (10/7/7): o dia 11 é o 1º da Semana 2", () => {
    const campanha = { ...CAMPANHA, periodos: PERIODOS_SA };
    expect(referenciaDaCampanha(campanha, "2026-12-03")).toMatchObject({
      dia_campanha: 11,
      duracao_dias: 24,
      data_fim: "2026-12-16",
      periodo: { ordem: 2, dia_no_periodo: 1, dias_restantes: 7 },
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// R1. Metas da célula e dos agregados
// ---------------------------------------------------------------------------------------------------

describe("R1: metas", () => {
  const tres = [
    { id: 1, qtd_pessoas: 12 },
    { id: 2, qtd_pessoas: 6 },
    { id: 3, qtd_pessoas: 0 },
  ];
  const arredondadas = (metas: Map<number, contrato.MetaExata>) =>
    [...metas.values()].map(metaArredondada);

  it.each([
    ["por_pessoa", 10, [120, 60, 0]],
    ["fixa_por_celula", 150, [150, 150, 150]],
    ["total_proporcional", 900, [600, 300, 0]],
  ] as const)(
    "%s com valor %i: %j (0 pessoas fica sem meta, salvo na fixa)",
    (regra, valor, esperado) => {
      expect(arredondadas(metasDasCelulas({ regra, valor }, tres))).toEqual(
        esperado,
      );
    },
  );

  it("total_proporcional: exata, igual para células do mesmo tamanho, e a soma dá o total", () => {
    const metas = metasDasCelulas(
      { regra: "total_proporcional", valor: 1000 },
      [
        { id: 1, qtd_pessoas: 12 },
        { id: 2, qtd_pessoas: 7 },
        { id: 3, qtd_pessoas: 12 },
        { id: 4, qtd_pessoas: 20 },
      ],
    );
    // 1000 × 12/51 = 235,29 → 236 para mostrar; a soma exata continua 1000.
    expect(arredondadas(metas)).toEqual([236, 138, 236, 393]);
    expect(metas.get(1)).toEqual(metas.get(3));
    expect(metaArredondada(somarMetas(metas.values()))).toBe(1000);
    const soma = somarMetas(metas.values());
    expect(soma.num % soma.den).toBe(0n);
  });

  it("sem nenhuma pessoa, o total proporcional fica sem meta (sem dividir por zero)", () => {
    expect(
      arredondadas(
        metasDasCelulas({ regra: "total_proporcional", valor: 500 }, [
          { id: 1, qtd_pessoas: 0 },
        ]),
      ),
    ).toEqual([0]);
  });

  it("recusa célula repetida e valores que não são inteiros", () => {
    expect(() =>
      metasDasCelulas({ regra: "por_pessoa", valor: 10 }, [
        { id: 1, qtd_pessoas: 1 },
        { id: 1, qtd_pessoas: 2 },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      metasDasCelulas({ regra: "por_pessoa", valor: 1.5 }, [
        { id: 1, qtd_pessoas: 1 },
      ]),
    ).toThrow(RangeError);
  });

  it.each([
    [{ tipo: "celula", id: 1, divisao: "jovens", nome: "Célula Ágape" }, 120],
    [
      {
        tipo: "discipulador",
        id: 10,
        divisao: "jovens",
        nome: "Discipulador Abel",
      },
      180,
    ],
    [
      {
        tipo: "discipulador",
        id: 30,
        divisao: "adultos",
        nome: "Discipulador Caleb",
      },
      300,
    ],
    [
      { tipo: "rede", id: 100, divisao: "jovens", nome: "Rede Jovem Norte" },
      300,
    ],
    [{ tipo: "divisao", id: null, divisao: "adultos", nome: "Adultos" }, 300],
    [
      {
        tipo: "campanha",
        id: null,
        divisao: null,
        nome: "Projeto Videira Kids",
      },
      600,
    ],
  ] as const)(
    "agregado %j: meta = soma das células abaixo (%i)",
    (escopo, meta) => {
      expect(resumo([], meioDia(8), escopo).campanha.meta).toBe(meta);
    },
  );

  it("RIFA-092: escopo grupo = as células do grupo efetivo (Ágape e Dorcas no 1; Betel no 2; sem grupo, fora de todos)", () => {
    // Grupo efetivo já resolvido pelo Worker: Ágape (1) e Dorcas (4) no grupo 1, de divisões diferentes; Betel (2) no
    // 2; Canaã (3) sem grupo (null) e Éfeso (5) sem o campo (ausente = sem grupo).
    const GRUPO_EFETIVO: Record<number, number | null | undefined> = {
      1: 1,
      2: 2,
      3: null,
      4: 1,
      5: undefined,
    };
    const celulas = CELULAS.map((item) =>
      GRUPO_EFETIVO[item.id] === undefined
        ? item
        : { ...item, grupo_efetivo_id: GRUPO_EFETIVO[item.id] },
    );
    const vendas = [
      ...porDia(1, 1, 7, 2),
      ...porDia(2, 1, 7, 1),
      ...porDia(3, 1, 7, 5),
      ...porDia(4, 1, 7, 3),
      ...porDia(5, 1, 7, 4),
      ...porDia(null, 1, 7, 9),
    ];
    const doGrupo = (id: number, nome: string) =>
      montarResumoPainel(
        entrada(vendas, CAMPANHA, celulas),
        { escopo: { tipo: "grupo", id, divisao: null, nome } },
        meioDia(8),
      );
    const manha = doGrupo(1, "Adultos da manhã");
    expect(respostaPainelResumoSchema.parse(manha)).toEqual(manha);
    expect(manha.escopo).toEqual({
      tipo: "grupo",
      id: 1,
      divisao: null,
      nome: "Adultos da manhã",
    });
    // Metas: Ágape 120 + Dorcas 200; vendas: (2 + 3) por dia nos 7 dias, sem as vendas sem célula.
    expect(manha.campanha.meta).toBe(320);
    expect(manha.campanha.realizado).toBe(35);
    expect(manha.vendas_sem_celula).toBeNull();
    expect(doGrupo(2, "Adultos da noite").campanha).toMatchObject({
      meta: 60,
      realizado: 7,
    });
    // Um grupo sem células: sem meta e sem vendas (a API só chega aqui com um grupo que existe).
    expect(doGrupo(4, "Adolescentes").campanha).toMatchObject({
      meta: 0,
      realizado: 0,
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// R2. Curva esperada
// ---------------------------------------------------------------------------------------------------

describe("R2: curva esperada (períodos, percentuais normalizados, linear no período)", () => {
  const curva = curvaEsperada(CAMPANHA.periodos);
  const meta120 = { num: 120n, den: 1n };

  it("35/25/45 soma 105% e é normalizada: 1/3 no fim da Semana 1, 4/7 no fim da 2, 100% no fim", () => {
    expect(
      [0, 7, 8, 14, 21].map((n) => percentualEsperadoBp(curva, n)),
    ).toEqual([0, 3333, 3673, 5714, 10_000]);
  });

  it.each([
    [-1, 0],
    [0, 0],
    [1, 6], // 120 × 1/21 = 5,71 → 6 (para cima)
    [7, 40],
    [8, 45], // 120 × 54/147 = 44,08
    [14, 69],
    [20, 113],
    [21, 120],
    [30, 120],
  ])("célula de meta 120: esperado ao fim do dia %i = %i", (n, esperado) => {
    expect(esperadoAteODia(meta120, curva, n)).toBe(esperado);
  });

  it("nunca é a meta dividida pelos dias: no modelo de SA, o dia 10 de 24 espera 33,3%, não 41,7%", () => {
    const sa = curvaEsperada(PERIODOS_SA);
    expect(percentualEsperadoBp(sa, 10)).toBe(3333);
    expect(percentualEsperadoBp(sa, 8)).toBe(2666);
    expect(percentualEsperadoBp(sa, 17)).toBe(5714);
    expect(percentualEsperadoBp(sa, 24)).toBe(10_000);
  });

  it("soma 100% não muda nada: 35/25/40 espera exatamente 35% no fim da Semana 1", () => {
    const cem = curvaEsperada([
      { dias: 7, percentual_bp: 3500 },
      { dias: 7, percentual_bp: 2500 },
      { dias: 7, percentual_bp: 4000 },
    ]);
    expect(esperadoAteODia(meta120, cem, 7)).toBe(42);
  });

  it("período com 0% fica parado; a curva nunca desce e termina em 100%", () => {
    const comZero = curvaEsperada([
      { dias: 2, percentual_bp: 0 },
      { dias: 2, percentual_bp: 10_000 },
    ]);
    expect([1, 2, 3, 4].map((n) => percentualEsperadoBp(comZero, n))).toEqual([
      0, 0, 5000, 10_000,
    ]);
    const valores = Array.from({ length: 22 }, (_, n) =>
      esperadoAteODia(meta120, curva, n),
    );
    expect(valores).toEqual([...valores].sort((a, b) => a - b));
  });

  it("todos os percentuais zerados não formam curva", () => {
    expect(() => curvaEsperada([{ dias: 3, percentual_bp: 0 }])).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------------------------------
// R3. Meta do dia
// ---------------------------------------------------------------------------------------------------

describe("R3: meta do dia = esperado até o fim de hoje − realizado até ontem (nunca negativa)", () => {
  const curva = curvaEsperada(CAMPANHA.periodos);
  const meta120 = { num: 120n, den: 1n };

  it.each([
    [8, 42, { meta: 3, meta_base: 5 }, "2 acima ontem: a sobra reduz a meta"],
    [
      8,
      40,
      { meta: 5, meta_base: 5 },
      "exatamente em dia: só a parte da curva",
    ],
    [
      8,
      30,
      { meta: 15, meta_base: 5 },
      "faltaram 10 ontem: entram na meta de hoje",
    ],
    [8, 50, { meta: 0, meta_base: 5 }, "muito acima: zero, nunca negativa"],
    [1, 0, { meta: 6, meta_base: 6 }, "dia 1"],
    [21, 100, { meta: 20, meta_base: 7 }, "último dia: tudo o que falta"],
  ])("dia %i com %i até ontem → %j (%s)", (n, ateOntem, esperado, caso) => {
    expect(metaDoDia(meta120, curva, n, ateOntem), caso).toEqual(esperado);
  });

  it("no painel: quem vendeu 6/dia e zerou no dia 7 carrega a falta para o dia 8", () => {
    const { hoje, campanha } = resumo(porDia(1, 1, 6, 6), meioDia(8));
    // Até ontem: 36 de 40 esperados. Hoje: 45 − 36 = 9 (5 da curva + 4 que faltaram).
    expect(campanha).toMatchObject({
      esperado: 40,
      realizado_ate_ontem: 36,
      situacao: "abaixo",
    });
    expect(hoje).toEqual({
      data: "2026-11-30",
      meta: 9,
      meta_base: 5,
      realizado: 0,
      falta: 9,
      percentual_meta_bp: 0,
      batida: false,
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// R4. Situação (em dia / abaixo) e o critério "dia 8 de 21"
// ---------------------------------------------------------------------------------------------------

describe("R4: situação contra a curva (esperado até o fim de ontem)", () => {
  it("critério: no dia 8 de 21 (1º período de 7 dias a 35%), a célula com 35% da meta está em dia", () => {
    const { referencia, campanha } = resumo(porDia(1, 1, 7, 6), meioDia(8));
    expect(referencia).toMatchObject({ dia_campanha: 8, duracao_dias: 21 });
    expect(campanha).toEqual({
      meta: 120,
      esperado: 40,
      realizado: 42,
      realizado_ate_ontem: 42,
      diferenca: 2,
      situacao: "em_dia",
      percentual_meta_bp: 3500,
      percentual_esperado_bp: 3333,
      ritmo_bp: 10_500,
      projecao: 126,
      projecao_percentual_meta_bp: 10_500,
    });
  });

  it.each([
    [CAMPANHA, 40, "em_dia", 0],
    [CAMPANHA, 39, "abaixo", -1],
    // Sem normalização (35/25/40 = 100%): o esperado é exatamente 35% = 42.
    [
      {
        ...CAMPANHA,
        periodos: [
          { nome: "S1", dias: 7, percentual_bp: 3500 },
          { nome: "S2", dias: 7, percentual_bp: 2500 },
          { nome: "S3", dias: 7, percentual_bp: 4000 },
        ],
      },
      42,
      "em_dia",
      0,
    ],
    [
      {
        ...CAMPANHA,
        periodos: [
          { nome: "S1", dias: 7, percentual_bp: 3500 },
          { nome: "S2", dias: 7, percentual_bp: 2500 },
          { nome: "S3", dias: 7, percentual_bp: 4000 },
        ],
      },
      41,
      "abaixo",
      -1,
    ],
  ] as const)(
    "dia 8, curva %#, %i até ontem → %s (diferença %i)",
    (campanha, ateOntem, situacao, diferenca) => {
      const vendas = [venda(1, dia(1), ateOntem)];
      expect(
        resumo(vendas, meioDia(8), ESCOPO_AGAPE, campanha).campanha,
      ).toMatchObject({
        situacao,
        diferenca,
      });
    },
  );

  it("no modelo de SA, 40 de 120 no fim do dia 10 está em dia (pela meta ÷ dias estaria abaixo)", () => {
    const campanha = { ...CAMPANHA, periodos: PERIODOS_SA };
    const vendas = [venda(1, dia(1), 40)];
    expect(
      resumo(vendas, meioDia(11), ESCOPO_AGAPE, campanha).campanha,
    ).toMatchObject({
      esperado: 40,
      situacao: "em_dia",
    });
  });

  it("em tempo real: quem estava 1 abaixo ontem fica em dia ao vender 1 hoje (a meta do dia segue à parte)", () => {
    const vendas = [venda(1, dia(1), 39), venda(1, dia(8), 1)];
    const { campanha, hoje } = resumo(vendas, meioDia(8));
    expect(campanha).toMatchObject({
      realizado: 40,
      esperado: 40,
      situacao: "em_dia",
      diferenca: 0,
    });
    expect(hoje).toMatchObject({
      meta: 6,
      realizado: 1,
      falta: 5,
      batida: false,
    });
  });

  it("sem meta: célula com 0 pessoas não tem o que cobrar", () => {
    const celulas = [celula(1, "Célula Zero", 0, ABEL, JOVEM)];
    const resposta = montarResumoPainel(
      entrada([venda(1, dia(1), 3)], CAMPANHA, celulas),
      { escopo: { ...ESCOPO_AGAPE, nome: "Célula Zero" } },
      meioDia(8),
    );
    expect(resposta.campanha).toMatchObject({
      meta: 0,
      realizado: 3,
      situacao: "sem_meta",
      percentual_meta_bp: null,
      percentual_esperado_bp: null,
      ritmo_bp: null,
    });
    expect(situacaoDoRitmo({ num: 0n, den: 1n }, 0, 0)).toBe("sem_meta");
  });
});

// ---------------------------------------------------------------------------------------------------
// R5. Projeção
// ---------------------------------------------------------------------------------------------------

describe("R5: projeção do fim no ritmo dos dias fechados", () => {
  const curva = curvaEsperada(CAMPANHA.periodos);
  const meta120 = { num: 120n, den: 1n };

  it.each([
    [
      0,
      0,
      { projecao: null, percentual_meta_bp: null },
      "antes do início ou no 1º dia: sem dia fechado",
    ],
    [
      7,
      42,
      { projecao: 126, percentual_meta_bp: 10_500 },
      "42 de 40 esperados: chega a 105%",
    ],
    [
      7,
      35,
      { projecao: 105, percentual_meta_bp: 8750 },
      "no ritmo atual, chega a 87%",
    ],
    [
      21,
      90,
      { projecao: 90, percentual_meta_bp: 7500 },
      "depois do fim: é o resultado",
    ],
  ])(
    "%i dias fechados, %i vendidos → %j (%s)",
    (fechados, vendidos, esperado, caso) => {
      expect(projecaoDoFim(meta120, curva, fechados, vendidos), caso).toEqual(
        esperado,
      );
    },
  );

  it("a venda parcial de hoje não infla a projeção", () => {
    const semHoje = resumo(porDia(1, 1, 7, 6), meioDia(8)).campanha;
    const comHoje = resumo(
      [...porDia(1, 1, 7, 6), venda(1, dia(8), 30)],
      meioDia(8),
    ).campanha;
    expect(comHoje.realizado).toBe(72);
    expect([comHoje.projecao, comHoje.projecao_percentual_meta_bp]).toEqual([
      semHoje.projecao,
      semHoje.projecao_percentual_meta_bp,
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Painel: dia 1, último dia, antes do início, depois do fim e vendas fora da janela
// ---------------------------------------------------------------------------------------------------

describe("painel: fases e vendas fora da janela", () => {
  const testeNaReuniao = venda(1, "2026-11-20", 3, 6000);
  const semCelulaAntes = venda(null, "2026-11-22", 1, 2000);

  it("antes do início: tudo zerado, sem meta do dia nem projeção; a compra de teste aparece à parte", () => {
    const r = resumo(
      [testeNaReuniao, semCelulaAntes],
      new Date("2026-11-21T15:00:00.000Z"),
      ESCOPO_CAMPANHA,
    );
    expect(r.referencia).toMatchObject({ fase: "antes", dias_para_inicio: 2 });
    expect([r.hoje, r.periodo]).toEqual([null, null]);
    expect(r.campanha).toMatchObject({
      meta: 600,
      esperado: 0,
      realizado: 0,
      situacao: "em_dia",
      projecao: null,
    });
    expect(r.vendas).toEqual({
      pedidos_aprovados: 0,
      bilhetes: 0,
      total_centavos: 0,
    });
    // A venda de 22/11 ainda não aconteceu no retrato de 21/11.
    expect(r.vendas_fora_da_janela).toEqual({
      antes_do_inicio: {
        pedidos_aprovados: 1,
        bilhetes: 3,
        total_centavos: 6000,
      },
      depois_do_fim: { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 },
    });
    expect(r.curva.every((ponto) => ponto.realizado === null)).toBe(true);
    expect(r.curva.map((ponto) => ponto.esperado).slice(0, 8)).toEqual([
      29, 58, 86, 115, 143, 172, 200, 221,
    ]);
  });

  it("venda aprovada antes do início não entra na meta, no realizado nem no ranking", () => {
    const vendas = [testeNaReuniao, semCelulaAntes, ...porDia(2, 1, 7, 1)];
    const r = resumo(vendas, meioDia(8), ESCOPO_CAMPANHA);
    expect(r.campanha.realizado).toBe(7);
    expect(r.vendas).toEqual({
      pedidos_aprovados: 7,
      bilhetes: 7,
      total_centavos: 14_000,
    });
    expect(r.vendas_fora_da_janela?.antes_do_inicio).toEqual({
      pedidos_aprovados: 2,
      bilhetes: 4,
      total_centavos: 8000,
    });
    expect(resumo(vendas, meioDia(8)).campanha.realizado).toBe(0);
    const itens = ranking(vendas, meioDia(8)).itens;
    expect(
      itens.find((item) => item.nome === "Célula Ágape")?.vendas
        .pedidos_aprovados,
    ).toBe(0);
    expect(posicoes(ranking(vendas, meioDia(8)))[0]).toEqual([
      1,
      "Célula Betel",
    ]);
  });

  it("dia 1: meta do dia é o primeiro pedaço da curva; esperado zero e sem projeção", () => {
    const r = resumo(
      [venda(1, dia(1), 2)],
      new Date("2026-11-23T12:00:00.000Z"),
    );
    expect(r.referencia).toMatchObject({ fase: "durante", dia_campanha: 1 });
    expect(r.hoje).toEqual({
      data: "2026-11-23",
      meta: 6,
      meta_base: 6,
      realizado: 2,
      falta: 4,
      percentual_meta_bp: 3333,
      batida: false,
    });
    expect(r.campanha).toMatchObject({
      esperado: 0,
      realizado: 2,
      situacao: "em_dia",
      ritmo_bp: null,
      projecao: null,
    });
    expect(r.periodo).toMatchObject({
      meta: 40,
      esperado: 0,
      realizado: 2,
      percentual_meta_bp: 500,
    });
  });

  it("último dia: a meta do dia é tudo o que falta", () => {
    const r = resumo([venda(1, dia(1), 100)], meioDia(21));
    expect(r.referencia).toMatchObject({ dia_campanha: 21, dias_restantes: 1 });
    expect(r.hoje).toMatchObject({ meta: 20, meta_base: 7 });
    // Semana 3: meta 120 × 45/105 = 51,4 → 52; 6 de 7 dias fechados: 120 × 18/49 = 44,1 → 45.
    expect(r.periodo).toMatchObject({ meta: 52, esperado: 45, realizado: 0 });
  });

  it("depois do fim: sem hoje nem período; esperado = meta e a projeção é o resultado; venda tardia à parte", () => {
    const vendas = [
      venda(1, dia(3), 90),
      venda(1, "2026-12-14", 5),
      venda(null, "2026-12-15", 1),
    ];
    const r = resumo(
      vendas,
      new Date("2026-12-20T15:00:00.000Z"),
      ESCOPO_CAMPANHA,
    );
    expect(r.referencia).toMatchObject({
      fase: "encerrada",
      dia_campanha: null,
      dias_restantes: 0,
    });
    expect([r.hoje, r.periodo]).toEqual([null, null]);
    expect(r.campanha).toMatchObject({
      meta: 600,
      esperado: 600,
      realizado: 90,
      situacao: "abaixo",
      projecao: 90,
      projecao_percentual_meta_bp: 1500,
      percentual_meta_bp: 1500,
    });
    expect(r.vendas_fora_da_janela?.depois_do_fim).toEqual({
      pedidos_aprovados: 2,
      bilhetes: 6,
      total_centavos: 12_000,
    });
    expect(r.curva).toHaveLength(21);
    expect(r.curva[20]).toMatchObject({
      dia: 21,
      data: "2026-12-13",
      esperado: 600,
      realizado: 90,
    });
  });

  it("vendas sem célula: contam na campanha, aparecem à parte e não entram na divisão", () => {
    const vendas = [
      venda(null, dia(2), 5),
      venda(1, dia(2), 3),
      venda(999, dia(2), 2),
    ];
    const campanha = resumo(vendas, meioDia(8), ESCOPO_CAMPANHA);
    // A célula 999 não existe (afiliado sem célula válida): vai para "sem célula".
    expect(campanha.campanha.realizado).toBe(10);
    expect(campanha.vendas_sem_celula).toEqual({
      pedidos_aprovados: 2,
      bilhetes: 7,
      total_centavos: 14_000,
    });
    const jovens = resumo(vendas, meioDia(8), {
      tipo: "divisao",
      id: null,
      divisao: "jovens",
      nome: "Jovens",
    });
    expect(jovens.campanha.realizado).toBe(3);
    expect([jovens.vendas_sem_celula, jovens.vendas_fora_da_janela]).toEqual([
      null,
      null,
    ]);
  });

  it("data consultada no passado: o retrato vai até o fim daquele dia", () => {
    const vendas = [...porDia(1, 1, 9, 6)];
    const r = resumo(vendas, meioDia(10), ESCOPO_AGAPE, CAMPANHA, dia(8));
    expect(r.referencia.data).toBe(dia(8));
    expect(r.campanha.realizado).toBe(48);
    expect(r.hoje).toMatchObject({ data: dia(8), realizado: 6 });
    expect(r.curva[8]).toMatchObject({ dia: 9, realizado: null });
  });

  it("curva do gráfico: esperado e realizado acumulados por dia, nulos no futuro", () => {
    const r = resumo(porDia(1, 1, 8, 6), meioDia(8));
    expect(r.curva.slice(5, 9)).toEqual([
      {
        dia: 6,
        data: "2026-11-28",
        esperado: 35,
        realizado: 36,
        realizado_no_dia: 6,
      },
      {
        dia: 7,
        data: "2026-11-29",
        esperado: 40,
        realizado: 42,
        realizado_no_dia: 6,
      },
      {
        dia: 8,
        data: "2026-11-30",
        esperado: 45,
        realizado: 48,
        realizado_no_dia: 6,
      },
      {
        dia: 9,
        data: "2026-12-01",
        esperado: 49,
        realizado: null,
        realizado_no_dia: null,
      },
    ]);
  });

  it("meta em centavos: o realizado é a arrecadação", () => {
    const campanha: CampanhaCalculo = {
      ...CAMPANHA,
      meta: {
        unidade: "centavos",
        regra: "total_proporcional",
        valor: 6_000_000,
      },
    };
    const r = resumo(
      [venda(1, dia(1), 10, 19_990)],
      meioDia(8),
      ESCOPO_AGAPE,
      campanha,
    );
    expect(r.unidade).toBe("centavos");
    // 6.000.000 × 12/60 = 1.200.000; um terço até o fim do dia 7 = 400.000.
    expect(r.campanha).toMatchObject({
      meta: 1_200_000,
      esperado: 400_000,
      realizado: 19_990,
      percentual_meta_bp: 166,
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// R8. Ranking
// ---------------------------------------------------------------------------------------------------

describe("R8: ranking por nível, critério, janela, empates e vizinhos", () => {
  // Ágape 60 de 120 (50%), Betel 45 de 60 (75%), Canaã 60 de 120 (50%), Dorcas 70 de 200 (35%).
  const vendas = [
    venda(1, dia(2), 60, 108_000),
    venda(2, dia(3), 45, 90_000),
    venda(3, dia(4), 60, 120_000),
    venda(4, dia(5), 70, 140_000),
  ];

  it.each([
    [
      "percentual_meta",
      [
        [1, "Célula Betel"],
        [2, "Célula Ágape"],
        [2, "Célula Canaã"],
        [4, "Célula Dorcas"],
        [5, "Célula Éfeso"],
      ],
    ],
    [
      "bilhetes",
      [
        [1, "Célula Dorcas"],
        [2, "Célula Ágape"],
        [2, "Célula Canaã"],
        [4, "Célula Betel"],
        [5, "Célula Éfeso"],
      ],
    ],
    [
      "arrecadacao",
      [
        [1, "Célula Dorcas"],
        [2, "Célula Canaã"],
        [3, "Célula Ágape"],
        [4, "Célula Betel"],
        [5, "Célula Éfeso"],
      ],
    ],
  ] as const)("critério %s", (criterio, esperado) => {
    const campanha = { ...CAMPANHA, ranking: { criterio } };
    const resposta = ranking(vendas, meioDia(9), {}, campanha);
    expect(resposta.criterio).toBe(criterio);
    expect(posicoes(resposta)).toEqual(esperado);
  });

  it("empates dividem a posição (1º, 1º, 3º) e o desempate na lista é pelo nome", () => {
    const empate = [
      venda(3, dia(2), 30),
      venda(1, dia(2), 30),
      venda(2, dia(2), 10),
    ];
    const resposta = ranking(
      empate,
      meioDia(9),
      {},
      { ...CAMPANHA, ranking: { criterio: "bilhetes" } },
    );
    expect(posicoes(resposta)).toEqual([
      [1, "Célula Ágape"],
      [1, "Célula Canaã"],
      [3, "Célula Betel"],
      [4, "Célula Dorcas"],
      [4, "Célula Éfeso"],
    ]);
  });

  it("cada item conhece quem está logo acima e logo abaixo (empatados não são vizinhos)", () => {
    const vizinhos = ranking(vendas, meioDia(9)).itens.map((item) => ({
      nome: item.nome,
      acima: item.acima && [
        item.acima.posicao,
        item.acima.nome,
        item.acima.diferenca,
      ],
      abaixo: item.abaixo && [
        item.abaixo.posicao,
        item.abaixo.nome,
        item.abaixo.diferenca,
      ],
    }));
    expect(vizinhos).toEqual([
      { nome: "Célula Betel", acima: null, abaixo: [2, "Célula Ágape", 2500] },
      {
        nome: "Célula Ágape",
        acima: [1, "Célula Betel", 2500],
        abaixo: [4, "Célula Dorcas", 1500],
      },
      {
        nome: "Célula Canaã",
        acima: [1, "Célula Betel", 2500],
        abaixo: [4, "Célula Dorcas", 1500],
      },
      {
        nome: "Célula Dorcas",
        acima: [2, "Célula Canaã", 1500],
        abaixo: [5, "Célula Éfeso", 3500],
      },
      { nome: "Célula Éfeso", acima: [4, "Célula Dorcas", 3500], abaixo: null },
    ]);
  });

  it("classificarRanking: sem meta (chave null) vai para o fim, empatado entre si", () => {
    const resultado = classificarRanking([
      { id: 1, nome: "B", chave: null },
      { id: 2, nome: "A", chave: 0 },
      { id: 3, nome: "C", chave: 10 },
      { id: 4, nome: "D", chave: null },
    ]);
    const dif = (vizinho: { diferenca: number | null } | null) =>
      vizinho === null ? "-" : vizinho.diferenca;
    expect(
      resultado.map((r) => [
        r.posicao,
        r.item.nome,
        dif(r.acima),
        dif(r.abaixo),
      ]),
    ).toEqual([
      [1, "C", "-", 10],
      [2, "A", 10, null],
      [3, "B", null, "-"],
      [3, "D", null, "-"],
    ]);
  });

  it("célula sem meta no critério % da meta vai para o fim mesmo vendendo; em bilhetes, entra normal", () => {
    const celulas = [...CELULAS, celula(6, "Célula Zero", 0, CALEB, ADULTA)];
    const comZero = [...vendas, venda(6, dia(2), 99)];
    expect(
      posicoes(ranking(comZero, meioDia(9), {}, CAMPANHA, celulas)).at(-1),
    ).toEqual([6, "Célula Zero"]);
    const porBilhetes = ranking(
      comZero,
      meioDia(9),
      {},
      { ...CAMPANHA, ranking: { criterio: "bilhetes" } },
      celulas,
    );
    expect(posicoes(porBilhetes)[0]).toEqual([1, "Célula Zero"]);
    expect(porBilhetes.itens[0]).toMatchObject({
      meta: 0,
      situacao: "sem_meta",
      percentual_meta_bp: null,
    });
  });

  it("janela do período atual × campanha inteira", () => {
    // Semana 1: Ágape 42, Betel 5. Semana 2 (dia 9): Betel 15.
    const janelas = [
      venda(1, dia(3), 42),
      venda(2, dia(3), 5),
      venda(2, dia(9), 15),
    ];
    const atual = ranking(janelas, meioDia(10), { periodo: "atual" });
    expect(atual.janela).toEqual({
      tipo: "atual",
      ordem: 2,
      nome: "Semana 2",
      data_inicio: "2026-11-30",
      data_fim: "2026-12-06",
    });
    expect(posicoes(atual).slice(0, 2)).toEqual([
      [1, "Célula Betel"],
      [2, "Célula Ágape"],
    ]);
    // Meta da Betel na Semana 2: 60 × 25/105 = 14,29 → 15; esperado até ontem (2 de 7 dias): 4,08 → 5.
    expect(atual.itens[0]).toMatchObject({
      meta: 15,
      esperado: 5,
      realizado: 15,
      diferenca: 10,
      situacao: "em_dia",
      percentual_meta_bp: 10_500,
    });
    const campanha = ranking(janelas, meioDia(10), { periodo: "campanha" });
    expect(campanha.janela).toEqual({
      tipo: "campanha",
      ordem: null,
      nome: "Campanha inteira",
      data_inicio: "2026-11-23",
      data_fim: "2026-12-13",
    });
    expect(posicoes(campanha).slice(0, 2)).toEqual([
      [1, "Célula Ágape"],
      [2, "Célula Betel"],
    ]);
  });

  it("antes do início a janela atual é a 1ª semana (todos empatados); depois do fim, a última", () => {
    const antes = ranking([], new Date("2026-11-20T15:00:00.000Z"), {
      periodo: "atual",
    });
    expect(antes.janela.ordem).toBe(1);
    expect(antes.itens.every((item) => item.posicao === 1)).toBe(true);
    expect(
      ranking([], new Date("2026-12-20T15:00:00.000Z"), { periodo: "atual" })
        .janela.ordem,
    ).toBe(3);
  });

  it("níveis discipulador e rede somam as células; filtro de divisão separa jovens e adultos", () => {
    const discipuladores = ranking(vendas, meioDia(9), {
      nivel: "discipulador",
    });
    expect(
      discipuladores.itens.map((i) => [
        i.posicao,
        i.nome,
        i.meta,
        i.realizado,
        i.rede?.nome,
      ]),
    ).toEqual([
      [1, "Discipulador Abel", 180, 105, "Rede Jovem Norte"],
      [2, "Discipulador Boaz", 120, 60, "Rede Jovem Norte"],
      [3, "Discipulador Caleb", 300, 70, "Rede Adulta Sul"],
    ]);
    const redes = ranking(vendas, meioDia(9), { nivel: "rede" });
    expect(
      redes.itens.map((i) => [
        i.nome,
        i.meta,
        i.percentual_meta_bp,
        i.rede,
        i.discipulador,
      ]),
    ).toEqual([
      ["Rede Jovem Norte", 300, 5500, null, null],
      ["Rede Adulta Sul", 300, 2333, null, null],
    ]);
    const adultos = ranking(vendas, meioDia(9), { divisao: "adultos" });
    expect(adultos.divisao).toBe("adultos");
    expect(posicoes(adultos)).toEqual([
      [1, "Célula Dorcas"],
      [2, "Célula Éfeso"],
    ]);
    expect(adultos.itens[0].discipulador).toEqual({
      id: 30,
      nome: "Discipulador Caleb",
    });
  });

  describe("RIFA-061 (D27): ranking por divisão ligado e desligado", () => {
    const UNICO: CampanhaCalculo = {
      ...CAMPANHA,
      ranking: { criterio: "percentual_meta", por_divisao: false },
    };

    it("a opção vale o padrão (separa) quando a campanha não a traz; true também separa", () => {
      expect(rankingPorDivisao(CAMPANHA)).toBe(RANKING_POR_DIVISAO_PADRAO);
      expect(RANKING_POR_DIVISAO_PADRAO).toBe(true);
      expect(rankingPorDivisao({ ranking: { por_divisao: true } })).toBe(true);
      expect(rankingPorDivisao(UNICO)).toBe(false);
    });

    it("ligada: a resposta é a de sempre, sem a marca, e o filtro separa a divisão", () => {
      const ligada: CampanhaCalculo = {
        ...CAMPANHA,
        ranking: { criterio: "percentual_meta", por_divisao: true },
      };
      for (const campanha of [CAMPANHA, ligada]) {
        const jovens = ranking(
          vendas,
          meioDia(9),
          { divisao: "jovens" },
          campanha,
        );
        expect(jovens).not.toHaveProperty("por_divisao");
        expect(jovens.divisao).toBe("jovens");
        expect(posicoes(jovens)).toEqual([
          [1, "Célula Betel"],
          [2, "Célula Ágape"],
          [2, "Célula Canaã"],
        ]);
      }
    });

    it("desligada: a divisão da consulta é ignorada; um ranking só, de todas as células, com as posições e os vizinhos de todos", () => {
      const geral = ranking(vendas, meioDia(9));
      for (const divisao of [undefined, "jovens", "adultos"] as const) {
        const unico = ranking(vendas, meioDia(9), { divisao }, UNICO);
        expect(unico.por_divisao).toBe(false);
        expect(unico.divisao).toBeNull();
        expect(unico.itens).toEqual(geral.itens);
        expect(posicoes(unico)).toEqual([
          [1, "Célula Betel"],
          [2, "Célula Ágape"],
          [2, "Célula Canaã"],
          [4, "Célula Dorcas"],
          [5, "Célula Éfeso"],
        ]);
      }
      // Dorcas (adultos) tem Ágape e Canaã (jovens, empatadas em 2º) logo acima: os vizinhos atravessam as divisões.
      const dorcas = ranking(vendas, meioDia(9), {}, UNICO).itens[3];
      expect(dorcas.acima?.posicao).toBe(2);
      expect(["Célula Ágape", "Célula Canaã"]).toContain(dorcas.acima?.nome);
      expect(dorcas.abaixo?.nome).toBe("Célula Éfeso");
    });

    it("desligada, nos níveis discipulador e rede também: todos juntos", () => {
      const redes = ranking(
        vendas,
        meioDia(9),
        { nivel: "rede", divisao: "adultos" },
        UNICO,
      );
      expect(redes.itens.map((item) => item.nome)).toEqual([
        "Rede Jovem Norte",
        "Rede Adulta Sul",
      ]);
      const discipuladores = ranking(
        vendas,
        meioDia(9),
        { nivel: "discipulador", divisao: "jovens" },
        UNICO,
      );
      expect(discipuladores.itens).toHaveLength(3);
    });

    it("meta fixa igual para todas as células (a decisão do PO): o ranking único compara o % de cada uma", () => {
      // 10 pessoas em todas (a planilha provisória), meta fixa de 50 bilhetes: o % e os bilhetes andam juntos.
      const iguais = CELULAS.map((c) => ({ ...c, qtd_pessoas: 10 }));
      const fixa: CampanhaCalculo = {
        ...UNICO,
        meta: { unidade: "bilhetes", regra: "fixa_por_celula", valor: 50 },
      };
      const resposta = ranking(vendas, meioDia(9), {}, fixa, iguais);
      expect(resposta.itens.map((item) => item.meta)).toEqual([
        50, 50, 50, 50, 50,
      ]);
      expect(
        resposta.itens.map((item) => [
          item.posicao,
          item.nome,
          item.percentual_meta_bp,
        ]),
      ).toEqual([
        [1, "Célula Dorcas", 14_000],
        [2, "Célula Ágape", 12_000],
        [2, "Célula Canaã", 12_000],
        [4, "Célula Betel", 9000],
        [5, "Célula Éfeso", 0],
      ]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// R9. Visão pública
// ---------------------------------------------------------------------------------------------------

describe("R9: ranking público (sem valores)", () => {
  // Betel 75%, Ágape 50%, Canaã 40%, Dorcas 40%, Éfeso sem vendas.
  const vendas = [
    venda(2, dia(2), 45),
    venda(1, dia(2), 60),
    venda(3, dia(2), 48),
    venda(4, dia(2), 80),
  ];
  const publico = (
    campanha: CampanhaCalculo = CAMPANHA,
    agora = meioDia(9),
  ) => {
    const resposta = montarRankingPublico(
      entrada(vendas, campanha),
      { nivel: "celula", periodo: "campanha" },
      agora,
    );
    expect(respostaRankingPublicoSchema.parse(resposta)).toEqual(resposta);
    return resposta;
  };

  it("top 3 com empate na última posição: entram todos; quem não vendeu não aparece", () => {
    expect(publico().itens).toEqual([
      { posicao: 1, nome: "Célula Betel", divisao: "jovens" },
      { posicao: 2, nome: "Célula Ágape", divisao: "jovens" },
      { posicao: 3, nome: "Célula Canaã", divisao: "jovens" },
      { posicao: 3, nome: "Célula Dorcas", divisao: "adultos" },
    ]);
  });

  it("o % da meta só aparece se a campanha permitir; o limite vem da configuração", () => {
    const comPercentual = publico({
      ...CAMPANHA,
      publico: { mostra_percentual_meta: true, limite_ranking: 1 },
    });
    expect(comPercentual.itens).toEqual([
      {
        posicao: 1,
        nome: "Célula Betel",
        divisao: "jovens",
        percentual_meta_bp: 7500,
      },
    ]);
    const todos = publico({
      ...CAMPANHA,
      publico: { mostra_percentual_meta: false, limite_ranking: null },
    });
    expect(todos.itens.map((item) => item.nome)).toEqual([
      "Célula Betel",
      "Célula Ágape",
      "Célula Canaã",
      "Célula Dorcas",
    ]);
  });

  it("RIFA-061 (D27): sem ranking por divisão, a divisão da consulta é ignorada e a resposta vem marcada", () => {
    const unico: CampanhaCalculo = {
      ...CAMPANHA,
      ranking: { criterio: "percentual_meta", por_divisao: false },
    };
    const consultar = (
      campanha: CampanhaCalculo,
      divisao?: "jovens" | "adultos",
    ) => {
      const resposta = montarRankingPublico(
        entrada(vendas, campanha),
        { nivel: "celula", periodo: "campanha", divisao },
        meioDia(9),
      );
      expect(respostaRankingPublicoSchema.parse(resposta)).toEqual(resposta);
      return resposta;
    };
    // Ligada (o padrão): adultos só com a Dorcas, como sempre, e sem a marca.
    const adultos = consultar(CAMPANHA, "adultos");
    expect(adultos).not.toHaveProperty("por_divisao");
    expect(adultos.divisao).toBe("adultos");
    expect(adultos.itens).toEqual([
      { posicao: 1, nome: "Célula Dorcas", divisao: "adultos" },
    ]);
    // Desligada: o pedido de jovens ou de adultos devolve o ranking de todas (o mesmo top 3 com o empate).
    for (const divisao of [undefined, "jovens", "adultos"] as const) {
      const resposta = consultar(unico, divisao);
      expect(resposta.por_divisao).toBe(false);
      expect(resposta.divisao).toBeNull();
      expect(resposta.itens).toEqual(publico().itens);
    }
  });

  it("as posições são as do ranking da coordenação", () => {
    const coordenacao = ranking(vendas, meioDia(9));
    const daCoordenacao = new Map(
      coordenacao.itens.map((item) => [item.nome, item.posicao]),
    );
    for (const item of publico().itens)
      expect(item.posicao).toBe(daCoordenacao.get(item.nome));
  });

  it("antes do início: lista vazia, com a referência para a tela contar os dias", () => {
    const antes = publico(CAMPANHA, new Date("2026-11-20T15:00:00.000Z"));
    expect(antes.itens).toEqual([]);
    expect(antes.referencia).toMatchObject({
      fase: "antes",
      dias_para_inicio: 3,
    });
  });

  it("nenhum campo de valor chega ao público, em nenhum nível do objeto", () => {
    const resposta = publico({
      ...CAMPANHA,
      publico: { mostra_percentual_meta: true, limite_ranking: null },
    });
    const chaves: string[] = [];
    const visitar = (valor: unknown) => {
      if (Array.isArray(valor)) valor.forEach(visitar);
      else if (valor && typeof valor === "object")
        for (const [chave, filho] of Object.entries(valor)) {
          chaves.push(chave);
          visitar(filho);
        }
    };
    visitar(resposta);
    expect(
      chaves.filter((chave) =>
        /centavos|valor|reais|total|preco|arrecad|vendas|realizado|bilhetes|meta$|esperado|projecao|diferenca/i.test(
          chave,
        ),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// R10. Bumbo do dia
// ---------------------------------------------------------------------------------------------------

describe("R10: bumbo do dia (texto para o grupo dos líderes)", () => {
  // Até o dia 7: Ágape 42, Betel 25, Canaã 20, Dorcas 70 e 2 sem célula (159). Dia 8: Ágape 6,
  // Betel 5, Dorcas 10 (21). Campanha: meta 600; esperado até o dia 8 = 600 × 54/147 = 220,4.
  const vendas = [
    ...porDia(1, 1, 8, 6),
    venda(2, dia(2), 25),
    venda(2, dia(8), 5),
    venda(3, dia(5), 20),
    ...porDia(4, 1, 8, 10),
    venda(null, dia(3), 2),
  ];
  const bumbo = (
    data: string,
    campanha: CampanhaCalculo = CAMPANHA,
    opcoes = BUMBO_PADRAO,
    lista = vendas,
    celulas = CELULAS,
  ) => {
    const resposta = montarBumbo(
      entrada(lista, campanha, celulas),
      { data },
      new Date(`${data}T13:00:00.000Z`),
      opcoes,
    );
    expect(respostaBumboSchema.parse(resposta)).toEqual(resposta);
    return resposta.texto;
  };

  it("dia 9: venda de ontem e acumulado em %, ranking da semana por divisão, quem mais subiu e chamada", () => {
    expect(bumbo(dia(9))).toBe(
      [
        "*Projeto Videira Kids · Dia 9 de 21*",
        "",
        // Meta do dia 8 = 221 − 159 = 62; vendidos 21 → 33%.
        "*Ontem (dia 8):* vendemos 33% da meta do dia.",
        "*Acumulado:* 30% da meta. Pela curva, o esperado até ontem era 36%.",
        // 180 ÷ 220,4 = 81,7%.
        "Estamos abaixo da curva: no ritmo atual, chegamos a 81% da meta.",
        "",
        "*Ranking · Semana 2 (até ontem)*",
        "_Jovens_",
        "1º Célula Betel",
        "2º Célula Ágape",
        "_Adultos_",
        "1º Célula Dorcas",
        "",
        // Avanço ontem em % da própria meta: Betel 8,3%; Ágape e Dorcas 5% (desempate pelo nome).
        "*Quem mais subiu ontem:* Célula Betel, Célula Ágape e Célula Dorcas.",
        "",
        "Faltam 13 dias e dá para virar o jogo: compartilhe hoje o seu link de afiliado com quem é de fora da igreja!",
      ].join("\n"),
    );
  });

  it("com o % da meta liberado para o público, as células ganham o percentual", () => {
    const texto = bumbo(dia(9), {
      ...CAMPANHA,
      publico: { mostra_percentual_meta: true, limite_ranking: 3 },
    });
    expect(texto).toContain("1º Célula Betel · 35%");
    expect(texto).toContain(
      "*Quem mais subiu ontem:* Célula Betel (+8%), Célula Ágape (+5%) e Célula Dorcas (+5%).",
    );
  });

  it("R9: o bumbo é público e nunca mostra bilhetes, nem com a opção ligada (ela é ignorada)", () => {
    const comOpcao = bumbo(dia(9), CAMPANHA, { mostrar_bilhetes: true });
    expect(comOpcao).toBe(bumbo(dia(9)));
    expect(comOpcao).not.toMatch(/bilhete/i);
    // Chamada sem o 4º argumento (o que a rota precisa) dá o mesmo texto.
    const semOpcoes = montarBumbo(
      entrada(vendas),
      { data: dia(9) },
      new Date(`${dia(9)}T13:00:00.000Z`),
    );
    expect(semOpcoes.texto).toBe(comOpcao);
  });

  it("fala só do dia fechado: as vendas de hoje não mudam o texto", () => {
    expect(
      bumbo(dia(9), CAMPANHA, BUMBO_PADRAO, [...vendas, venda(5, dia(9), 50)]),
    ).toBe(bumbo(dia(9)));
  });

  it.each([
    [
      "2026-11-20",
      [
        "*Projeto Videira Kids*",
        "Faltam 3 dias para começar: as vendas vão de 23/11 a 13/12.",
      ],
    ],
    ["2026-11-22", ["Falta 1 dia para começar"]],
    [
      dia(1),
      [
        "*Projeto Videira Kids · Dia 1 de 21*",
        "Começou! As vendas vão até 13/12.",
      ],
    ],
    [dia(15), ["*Ranking · Semana 2 (resultado final)*"]],
    [
      dia(21),
      ["*Projeto Videira Kids · Dia 21 de 21*", "*Hoje é o último dia!*"],
    ],
    [
      "2026-12-14",
      [
        "*Projeto Videira Kids · Campanha encerrada*",
        "*Último dia (dia 21):*",
        "*Resultado final:* 30% da meta.",
        "*Ranking final da campanha*",
        "Obrigado a todas as células pelo empenho!",
      ],
    ],
  ])("em %s o texto traz %j", (data, trechos) => {
    const texto = bumbo(data);
    for (const trecho of trechos) expect(texto).toContain(trecho);
  });

  it("RIFA-040: o convite a compartilhar fala do link de afiliado (como o site), em todas as fases; depois do fim, nenhum", () => {
    // Abaixo da curva (as vendas do cenário) e em dia (100 bilhetes por dia em cada célula): as duas chamadas.
    const emDia = [1, 2, 3, 4].flatMap((id) => porDia(id, 1, 21, 100));
    const chamada =
      "compartilhe hoje o seu link de afiliado com quem é de fora da igreja!";
    const vistas = new Set<string>();
    for (const lista of [vendas, emDia])
      for (let n = -3; n <= 24; n++) {
        const data = dia(n);
        const texto = bumbo(data, CAMPANHA, BUMBO_PADRAO, lista);
        // O link da Rifei do líder não é "da célula" (o site diz "link de afiliado" em tudo).
        expect(texto, data).not.toMatch(/link d[ae] (sua )?c[ée]lula/i);
        const ultima = texto.split("\n").at(-1) ?? "";
        if (n < 1) {
          expect(ultima, data).toBe(
            "Confira se o seu link de afiliado está pronto para compartilhar!",
          );
        } else if (n <= 21) {
          expect(ultima, data).toMatch(
            /^(Bora: |\*Hoje é o último dia!\* Bora: |Faltam \d+ dias? e dá para virar o jogo: |Faltam \d+ dias?\. Bora manter o ritmo: )/,
          );
          expect(ultima.endsWith(chamada), data).toBe(true);
          vistas.add(
            ultima.slice(0, -chamada.length).replace(/\d+ dias?/, "N dias"),
          );
        } else {
          expect(texto, data).not.toMatch(/link/i);
        }
      }
    // As quatro formas da chamada apareceram (a largada, o meio da campanha nos dois ritmos e o último dia).
    expect([...vistas].sort()).toEqual(
      [
        "*Hoje é o último dia!* Bora: ",
        "Bora: ",
        "Faltam N dias e dá para virar o jogo: ",
        "Faltam N dias. Bora manter o ritmo: ",
      ].sort(),
    );
  });

  it("depois do fim só o resultado final; antes do início não fala de vendas", () => {
    expect(bumbo("2026-12-20")).not.toContain("Último dia");
    expect(bumbo("2026-11-20")).not.toMatch(/vendemos|Ranking/);
  });

  it("respeita o limite público (top 1) e, com uma divisão só, não separa por divisão", () => {
    const top1 = bumbo(dia(9), {
      ...CAMPANHA,
      publico: { mostra_percentual_meta: false, limite_ranking: 1 },
    });
    expect(top1).not.toContain("2º");
    const soJovens = CELULAS.filter((c) => c.divisao === "jovens");
    const texto = bumbo(dia(9), CAMPANHA, BUMBO_PADRAO, vendas, soJovens);
    expect(texto).not.toContain("_Jovens_");
    expect(texto).toContain("1º Célula Betel");
  });

  it("RIFA-061 (D27): sem ranking por divisão, um ranking só, de todas as células, sem o título da divisão", () => {
    const unico: CampanhaCalculo = {
      ...CAMPANHA,
      ranking: { criterio: "percentual_meta", por_divisao: false },
    };
    const texto = bumbo(dia(9), unico);
    expect(texto).not.toMatch(/_Jovens_|_Adultos_/);
    // Semana 2 até ontem (dia 8): Betel 5 de 15 (33%), Ágape 6 de 30 (20%), Dorcas 10 de 50 (20%).
    expect(texto).toContain(
      [
        "*Ranking · Semana 2 (até ontem)*",
        "1º Célula Betel",
        "2º Célula Ágape",
        "2º Célula Dorcas",
        "",
      ].join("\n"),
    );
    // O resto do texto é o de sempre.
    const separado = bumbo(dia(9));
    const semRanking = (t: string) => t.replace(/\*Ranking[^]*?\n\n/, "");
    expect(semRanking(texto)).toBe(semRanking(separado));
    // Sem nenhuma venda no período, a linha "ainda sem vendas" vem sem o nome da divisão.
    expect(bumbo(dia(9), unico, BUMBO_PADRAO, [])).toContain(
      "*Ranking · Semana 2 (até ontem)*\nAinda sem vendas.",
    );
  });

  it("guarda: nunca R$, centavos nem bilhetes, com ou sem a opção (todas as fases, duas campanhas)", () => {
    const centavos: CampanhaCalculo = {
      ...CAMPANHA,
      meta: {
        unidade: "centavos",
        regra: "total_proporcional",
        valor: 12_345_678,
      },
      publico: { mostra_percentual_meta: true, limite_ranking: null },
    };
    // Valores e quantidades que não se confundem com dias, datas ou percentuais.
    const distintas = [
      venda(1, dia(2), 4567, 1_234_567),
      venda(4, dia(8), 3891, 987_654),
      venda(null, dia(8), 2345, 555_555),
      venda(2, "2026-11-20", 7777, 777_777),
    ];
    const proibidosSempre = [
      /R\$/,
      /centavo/i,
      /reais/i,
      /\d,\d{2}\b/,
      /1\.234/,
      /1234/,
      /987\.?654/,
      /9\.876/,
      /555\.?555/,
      /5\.555/,
      /777\.?777/,
      /7\.777/,
    ];
    for (const campanha of [CAMPANHA, centavos])
      for (let n = -3; n <= 24; n++) {
        const data = dia(n);
        const semBilhetes = bumbo(data, campanha, BUMBO_PADRAO, distintas);
        const comBilhetes = bumbo(
          data,
          campanha,
          { mostrar_bilhetes: true },
          distintas,
        );
        for (const texto of [semBilhetes, comBilhetes]) {
          for (const proibido of proibidosSempre)
            expect(texto, `${data}: ${proibido}`).not.toMatch(proibido);
          expect(texto, data).not.toMatch(
            /bilhete|4\.567|4567|3\.891|3891|2\.345|2345|6\.236|10\.803/i,
          );
        }
      }
  });

  // Pior caso do limite de 4000 caracteres: 36 células de cada divisão empatadas, nomes de 120
  // caracteres (o máximo da célula), campanha e período com o nome no máximo e % por célula ligado.
  it("S22: com empates longos o texto corta em 'e mais N' e sempre cabe nos 4000 caracteres", () => {
    const nomeLongo = (rotulo: string) => rotulo.padEnd(120, "x");
    const celulasEmpatadas = Array.from({ length: 72 }, (_, indice) =>
      celula(
        indice + 1,
        nomeLongo(`Célula ${String(indice + 1).padStart(2, "0")} `),
        10,
        indice < 36 ? ABEL : CALEB,
        indice < 36 ? JOVEM : ADULTA,
      ),
    );
    const campanhaLonga: CampanhaCalculo = {
      ...CAMPANHA,
      nome: nomeLongo("Rifa "),
      periodos: CAMPANHA.periodos.map((periodo) => ({
        ...periodo,
        nome: periodo.nome.padEnd(60, "y"),
      })),
      publico: { mostra_percentual_meta: true, limite_ranking: null },
    };
    // Todas vendem o mesmo (e muito: % com muitos dígitos), todos os dias: empate em 1º.
    const empatadas = celulasEmpatadas.flatMap((c) =>
      porDia(c.id, 1, 21, 9_000_000),
    );
    for (let n = -3; n <= 24; n++) {
      const resposta = montarBumbo(
        entrada(empatadas, campanhaLonga, celulasEmpatadas),
        { data: dia(n) },
        new Date(`${dia(n)}T13:00:00.000Z`),
      );
      expect(respostaBumboSchema.parse(resposta)).toEqual(resposta);
      expect(resposta.texto.length, dia(n)).toBeLessThanOrEqual(4000);
      if (n >= 2) {
        expect(resposta.texto).toContain("e mais 31 empatadas no 1º lugar");
        expect(resposta.texto.match(/^1º /gm)).toHaveLength(10);
      }
    }
  });

  it("S22: o corte só aparece acima de 5 nomes e diz quantas ficaram de fora e em que lugar", () => {
    const seteJovens = Array.from({ length: 7 }, (_, indice) =>
      celula(indice + 1, `Célula ${indice + 1}`, 10, ABEL, JOVEM),
    );
    const vendasIguais = (quantas: number) =>
      seteJovens.slice(0, quantas).map((c) => venda(c.id, dia(8), 10));
    const ranking = (quantas: number) =>
      bumbo(dia(9), CAMPANHA, BUMBO_PADRAO, vendasIguais(quantas), seteJovens)
        .split("\n")
        .filter((linha) => /^\dº |^e mais/.test(linha));
    expect(ranking(5)).toEqual([
      "1º Célula 1",
      "1º Célula 2",
      "1º Célula 3",
      "1º Célula 4",
      "1º Célula 5",
    ]);
    expect(ranking(6).slice(-2)).toEqual([
      "1º Célula 5",
      "e mais 1 empatada no 1º lugar",
    ]);
    expect(ranking(7)).toHaveLength(6);
    expect(ranking(7).at(-1)).toBe("e mais 2 empatadas no 1º lugar");
    // 1º, 2º e 3º com cinco empatadas em 3º: lista 1º, 2º e três dos 3º.
    const comDegraus = [
      venda(1, dia(8), 30),
      venda(2, dia(8), 20),
      ...[3, 4, 5, 6, 7].map((id) => venda(id, dia(8), 10)),
    ];
    const linhas = bumbo(dia(9), CAMPANHA, BUMBO_PADRAO, comDegraus, seteJovens)
      .split("\n")
      .filter((linha) => /^\dº |^e mais/.test(linha));
    expect(linhas).toEqual([
      "1º Célula 1",
      "2º Célula 2",
      "3º Célula 3",
      "3º Célula 4",
      "3º Célula 5",
      "e mais 2 empatadas no 3º lugar",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Revisão (RIFA-008): propriedades e bordas com entradas sorteadas. A semente é fixa: mesma entrada,
// mesmo resultado. Cada teste sorteia muitas campanhas (curvas, regras, unidades, células e vendas,
// inclusive fora da janela e sem célula) e confere uma promessa de docs/regras-de-calculo.md.
// ---------------------------------------------------------------------------------------------------

type Sorteador = {
  inteiro: (minimo: number, maximo: number) => number;
  chance: (probabilidade: number) => boolean;
  um: <T>(lista: readonly T[]) => T;
  embaralhar: <T>(lista: readonly T[]) => T[];
};

/** Pseudoaleatório com semente (mulberry32): o teste que falha falha sempre igual. */
function sorteador(semente: number): Sorteador {
  let estado = semente >>> 0;
  const proximo = () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const inteiro = (minimo: number, maximo: number) =>
    minimo + Math.floor(proximo() * (maximo - minimo + 1));
  return {
    inteiro,
    chance: (probabilidade) => proximo() < probabilidade,
    um: <T>(lista: readonly T[]): T => lista[inteiro(0, lista.length - 1)],
    embaralhar: <T>(lista: readonly T[]): T[] => {
      const copia = [...lista];
      for (let i = copia.length - 1; i > 0; i--) {
        const j = inteiro(0, i);
        [copia[i], copia[j]] = [copia[j], copia[i]];
      }
      return copia;
    },
  };
}

const NOMES_SORTEADOS = [
  "Ágape",
  "Betel",
  "Canaã",
  "Dorcas",
  "Éfeso",
  "Filadélfia",
  "Gileade",
  "Hebrom",
  "Israel",
  "Jope",
];
const DAVI: [number, string] = [40, "Discipulador Davi"];
const DISCIPULADORES_SORTEADOS = [
  [ABEL, JOVEM],
  [BOAZ, JOVEM],
  [CALEB, ADULTA],
  [DAVI, ADULTA],
] as const;

/** 1 a 5 períodos de 1 a 9 dias; percentuais de 0 a 100% (pelo menos um > 0), quase nunca somando 100%. */
function periodosSorteados(s: Sorteador) {
  const periodos = Array.from({ length: s.inteiro(1, 5) }, (_, indice) => ({
    nome: `Semana ${indice + 1}`,
    dias: s.inteiro(1, 9),
    percentual_bp: s.chance(0.2) ? 0 : s.inteiro(1, 10_000),
  }));
  if (periodos.every((periodo) => periodo.percentual_bp === 0))
    periodos[0].percentual_bp = 3500;
  return periodos;
}

/** Campanha, células e vendas sorteadas (de 3 dias antes do início a 3 depois do fim) e um "agora". */
function cenarioSorteado(s: Sorteador) {
  const periodos = periodosSorteados(s);
  const duracao = periodos.reduce((soma, periodo) => soma + periodo.dias, 0);
  const unidade = s.um(["bilhetes", "centavos"] as const);
  const campanha: CampanhaCalculo = {
    ...CAMPANHA,
    meta: {
      unidade,
      regra: s.um(REGRAS_META),
      valor:
        unidade === "bilhetes"
          ? s.inteiro(1, 3000)
          : s.inteiro(100_000, 9_000_000),
    },
    periodos,
    ranking: { criterio: s.um(CRITERIOS_RANKING) },
    publico: {
      mostra_percentual_meta: s.chance(0.5),
      limite_ranking: s.chance(0.2) ? null : s.inteiro(1, 5),
    },
  };
  const celulas = Array.from({ length: s.inteiro(1, 10) }, (_, indice) => {
    const [discipulador, rede] = s.um(DISCIPULADORES_SORTEADOS);
    return celula(
      indice + 1,
      `Célula ${NOMES_SORTEADOS[indice]}`,
      s.inteiro(1, 25),
      discipulador,
      rede,
    );
  });
  const preco = s.um([1990, 2000, 2500]);
  const vendas = Array.from({ length: s.inteiro(0, 40) }, () => {
    const bilhetes = s.inteiro(1, 30);
    return venda(
      s.chance(0.1)
        ? null
        : s.chance(0.05)
          ? 999
          : s.inteiro(1, celulas.length),
      dia(s.inteiro(-3, duracao + 3)),
      bilhetes,
      bilhetes * preco,
      s.inteiro(1, 3),
    );
  });
  const hora = String(s.inteiro(3, 26) % 24).padStart(2, "0");
  const agora = new Date(
    `${dia(s.inteiro(-3, duracao + 3))}T${hora}:30:00.000Z`,
  );
  const entradaSorteada: EntradaCalculo = { campanha, celulas, vendas };
  return { entrada: entradaSorteada, duracao, agora };
}

/** Uma venda de `quantidade` na unidade da meta (bilhetes ou centavos). */
function vendaNaUnidade(
  campanha: CampanhaCalculo,
  celulaId: number | null,
  data: string,
  quantidade: number,
): VendasDoDia {
  return campanha.meta.unidade === "bilhetes"
    ? venda(celulaId, data, quantidade, quantidade * 2000)
    : venda(
        celulaId,
        data,
        Math.max(1, Math.ceil(quantidade / 2000)),
        quantidade,
      );
}

/** Todo número da resposta é finito (sem NaN nem Infinity escondidos atrás de um null do JSON). */
function numerosFinitos(valor: unknown): boolean {
  if (typeof valor === "number") return Number.isFinite(valor);
  if (Array.isArray(valor)) return valor.every(numerosFinitos);
  if (valor && typeof valor === "object")
    return Object.values(valor).every(numerosFinitos);
  return true;
}

const textoPorcento = (bp: number) =>
  `${new Intl.NumberFormat("pt-BR").format(Math.floor(bp / 100))}%`;

describe("Revisão: propriedades e bordas (entradas sorteadas)", () => {
  it("R1: a meta da campanha é a regra aplicada ao todo; células, discipuladores, redes e divisões somam a ela", () => {
    const s = sorteador(1);
    for (let rodada = 0; rodada < 150; rodada++) {
      const { entrada: e, agora } = cenarioSorteado(s);
      const { meta } = e.campanha;
      const pessoas = e.celulas.reduce((soma, c) => soma + c.qtd_pessoas, 0);
      const daRegra = {
        por_pessoa: meta.valor * pessoas,
        fixa_por_celula: meta.valor * e.celulas.length,
        total_proporcional: meta.valor,
      }[meta.regra];
      const metaDoEscopo = (escopo: EscopoResolvido) =>
        montarResumoPainel(e, { escopo }, agora).campanha.meta;
      expect(metaDoEscopo(ESCOPO_CAMPANHA)).toBe(daRegra);
      // Por pessoa e fixa: soma exata. Proporcional: cada instância arredonda para cima (S5), então a
      // soma mostrada passa do total em menos de 1 por instância.
      const conferirSoma = (metas: number[]) => {
        const soma = metas.reduce((total, valor) => total + valor, 0);
        const folga =
          meta.regra === "total_proporcional" ? metas.length - 1 : 0;
        expect(soma - daRegra).toBeGreaterThanOrEqual(0);
        expect(soma - daRegra).toBeLessThanOrEqual(folga);
      };
      for (const nivel of NIVEIS_RANKING)
        conferirSoma(
          montarRankingPainel(
            e,
            { nivel, periodo: "campanha" },
            agora,
          ).itens.map((item) => item.meta),
        );
      const divisoes = DIVISOES.filter((divisao) =>
        e.celulas.some((c) => c.divisao === divisao),
      );
      conferirSoma(
        divisoes.map((divisao) =>
          metaDoEscopo({
            tipo: "divisao",
            id: null,
            divisao,
            nome: NOMES_DIVISAO[divisao],
          }),
        ),
      );
      // Mesmo número de pessoas, mesma meta, em qualquer regra.
      const metas = metasDasCelulas(meta, e.celulas);
      for (const a of e.celulas)
        for (const b of e.celulas)
          if (a.qtd_pessoas === b.qtd_pessoas)
            expect(metas.get(a.id)).toEqual(metas.get(b.id));
    }
  });

  it("R2: a curva começa em 0, nunca desce, é linear dentro de cada período e termina em 100% exatos", () => {
    const s = sorteador(2);
    for (let rodada = 0; rodada < 300; rodada++) {
      const periodos = periodosSorteados(s);
      const curva = curvaEsperada(periodos);
      const soma = BigInt(periodos.reduce((t, p) => t + p.percentual_bp, 0));
      const duracao = periodos.reduce((t, p) => t + p.dias, 0);
      expect(curva).toHaveLength(duracao + 1);
      expect(curva[0].num).toBe(0n);
      expect(curva[duracao].num).toBe(curva[duracao].den);
      // Cada dia do período anda percentual ÷ (soma dos percentuais × dias do período): normaliza os
      // 105% e reparte o período em partes iguais.
      let n = 0;
      for (const periodo of periodos)
        for (let t = 1; t <= periodo.dias; t++) {
          n++;
          const [a, b] = [curva[n - 1], curva[n]];
          expect(
            (b.num * a.den - a.num * b.den) * soma * BigInt(periodo.dias),
          ).toBe(BigInt(periodo.percentual_bp) * a.den * b.den);
        }
      const meta = {
        num: BigInt(s.inteiro(0, 50_000)),
        den: BigInt(s.inteiro(1, 60)),
      };
      const esperados = Array.from({ length: duracao + 3 }, (_, i) =>
        esperadoAteODia(meta, curva, i - 1),
      );
      expect(esperados).toEqual([...esperados].sort((x, y) => x - y));
      expect(esperados.slice(0, 2)).toEqual([0, 0]);
      expect(esperados.slice(-2)).toEqual([
        metaArredondada(meta),
        metaArredondada(meta),
      ]);
      expect(percentualEsperadoBp(curva, duracao)).toBe(10_000);
    }
  });

  it("R3: a meta do dia nunca é negativa, as partes da curva somam a meta e quem cumpre a meta do dia termina nela", () => {
    const s = sorteador(3);
    for (let rodada = 0; rodada < 300; rodada++) {
      const curva = curvaEsperada(periodosSorteados(s));
      const duracao = curva.length - 1;
      const meta = {
        num: BigInt(s.inteiro(0, 50_000)),
        den: BigInt(s.inteiro(1, 60)),
      };
      const total = metaArredondada(meta);
      let somaDasPartes = 0;
      let cumprindo = 0; // vende exatamente a meta do dia, todo dia
      let qualquer = 0; // vende um valor sorteado (às vezes zero, às vezes muito acima)
      for (let n = 1; n <= duracao; n++) {
        const doDia = metaDoDia(meta, curva, n, cumprindo);
        expect(doDia.meta_base).toBeGreaterThanOrEqual(0);
        expect(doDia.meta).toBe(doDia.meta_base);
        somaDasPartes += doDia.meta_base;
        cumprindo += doDia.meta;
        expect(cumprindo).toBe(esperadoAteODia(meta, curva, n));
        const sorteado = metaDoDia(meta, curva, n, qualquer);
        expect(sorteado.meta).toBe(
          Math.max(0, esperadoAteODia(meta, curva, n) - qualquer),
        );
        if (n === duracao)
          expect(sorteado.meta).toBe(Math.max(0, total - qualquer));
        qualquer += s.inteiro(0, Math.ceil((2 * total) / duracao) + 1);
      }
      expect(somaDasPartes).toBe(total);
      expect(cumprindo).toBe(total);
    }
  });

  it("R3/R4 no painel: quem vende a meta do dia fica em dia e fecha na meta; o dia zerado entra na meta do dia seguinte", () => {
    const s = sorteador(4);
    for (let rodada = 0; rodada < 40; rodada++) {
      const { entrada: e, duracao } = cenarioSorteado(s);
      const vendas: VendasDoDia[] = [];
      const zerado = s.inteiro(1, duracao);
      let metaZerada = 0;
      for (let n = 1; n <= duracao + 1; n++) {
        const r = montarResumoPainel(
          { ...e, vendas },
          { escopo: ESCOPO_CAMPANHA },
          meioDia(n),
        );
        expect(respostaPainelResumoSchema.parse(r)).toEqual(r);
        const { campanha } = r;
        if (n > duracao) {
          expect(r.hoje).toBeNull();
          expect(campanha.esperado).toBe(campanha.meta);
          expect(campanha.realizado).toBe(
            campanha.meta - (zerado === duracao ? metaZerada : 0),
          );
          break;
        }
        const hoje = obrigatorioNoTeste(r.hoje);
        // "120 + 30 que faltaram": a meta do dia é a parte da curva mais a falta (menos a sobra).
        expect(hoje.meta).toBe(
          Math.max(
            0,
            hoje.meta_base + campanha.esperado - campanha.realizado_ate_ontem,
          ),
        );
        if (n === zerado + 1) {
          expect(campanha.situacao).toBe(metaZerada > 0 ? "abaixo" : "em_dia");
          expect(campanha.diferenca).toBe(0 - metaZerada);
          expect(hoje.meta).toBe(hoje.meta_base + metaZerada);
        } else {
          expect(campanha.situacao).toBe("em_dia");
          expect(campanha.diferenca).toBe(0);
        }
        if (n === zerado) metaZerada = hoje.meta;
        else if (hoje.meta > 0)
          vendas.push(
            vendaNaUnidade(e.campanha, s.um([1, null]), dia(n), hoje.meta),
          );
      }
    }
  });

  it("R11: realizado ≥ alvo arredondado vale exatamente quando o percentual chega a 100% (painel e ranking)", () => {
    const s = sorteador(5);
    const conferir = (valores: {
      meta: number;
      esperado: number;
      realizado: number;
      diferenca: number;
      situacao: SituacaoRitmo;
      percentual_meta_bp: number | null;
    }) => {
      expect(valores.diferenca).toBe(valores.realizado - valores.esperado);
      expect(valores.esperado).toBeLessThanOrEqual(valores.meta);
      if (valores.percentual_meta_bp === null)
        expect(valores.situacao).toBe("sem_meta");
      else {
        expect(valores.percentual_meta_bp >= 10_000).toBe(
          valores.realizado >= valores.meta,
        );
        expect(valores.situacao).toBe(
          valores.realizado >= valores.esperado ? "em_dia" : "abaixo",
        );
      }
    };
    for (let rodada = 0; rodada < 150; rodada++) {
      const { entrada: e, agora } = cenarioSorteado(s);
      for (const escopo of [
        ESCOPO_CAMPANHA,
        { ...ESCOPO_AGAPE, nome: "Célula Ágape" },
      ]) {
        const r = montarResumoPainel(e, { escopo }, agora);
        for (const ritmo of [r.campanha, r.periodo]) {
          if (!ritmo) continue;
          conferir(ritmo);
          expect(ritmo.ritmo_bp === null).toBe(ritmo.esperado === 0);
          if (ritmo.ritmo_bp !== null)
            expect(ritmo.ritmo_bp >= 10_000).toBe(
              ritmo.realizado_ate_ontem >= ritmo.esperado,
            );
          expect(ritmo.percentual_esperado_bp === null).toBe(
            ritmo.percentual_meta_bp === null,
          );
        }
        if (r.hoje) {
          expect(r.hoje.batida).toBe(r.hoje.realizado >= r.hoje.meta);
          expect(r.hoje.falta).toBe(
            Math.max(0, r.hoje.meta - r.hoje.realizado),
          );
          if (r.hoje.percentual_meta_bp !== null)
            expect(r.hoje.percentual_meta_bp >= 10_000).toBe(r.hoje.batida);
        }
      }
      for (const periodo of JANELAS_RANKING)
        for (const item of montarRankingPainel(
          e,
          { nivel: "celula", periodo },
          agora,
        ).itens)
          conferir(item);
    }
  });

  it("R6: em todos os dias, 03:00:00.000Z abre e 02:59:59.999Z do dia seguinte fecha o dia de Belém", () => {
    const linhas: VendaAprovada[] = [];
    for (let n = 0; n <= 22; n++)
      linhas.push(
        {
          celula_id: 1,
          aprovado_em: `${dia(n)}T03:00:00.000Z`,
          qtd_bilhetes: 1,
          total_centavos: 2000,
        },
        {
          celula_id: 1,
          aprovado_em: `${dia(n + 1)}T02:59:59.999Z`,
          qtd_bilhetes: 2,
          total_centavos: 4000,
        },
      );
    const porDiaLocal = agruparVendasPorDia(linhas, "America/Belem");
    expect(porDiaLocal.map((l) => [l.dia, l.pedidos, l.bilhetes])).toEqual(
      Array.from({ length: 23 }, (_, n) => [dia(n), 2, 3]),
    );
    const { inicio, fim } = janelaUtcDaCampanha(CAMPANHA);
    for (const linha of linhas)
      expect(vendaContaNaCampanha(linha.aprovado_em, CAMPANHA)).toBe(
        linha.aprovado_em >= inicio && linha.aprovado_em < fim,
      );
    // A consulta SQL de regras-de-calculo.md (seção 5), date(aprovado_em, '-3 hours'), dá o mesmo dia.
    const s = sorteador(6);
    const tresHoras = 3 * 3_600_000;
    for (let i = 0; i < 500; i++) {
      const instante = new Date(
        Date.UTC(2026, 0, 1) +
          s.inteiro(0, 2 * 365 * 24 * 60) * 60_000 -
          s.inteiro(0, 1),
      ).toISOString();
      expect(diaLocalDoInstante(instante, "America/Belem")).toBe(
        new Date(Date.parse(instante) - tresHoras).toISOString().slice(0, 10),
      );
    }
    // No painel, depois do fim: 3 bilhetes em cada um dos 21 dias e os dias 0 e 22 fora da janela.
    const r = resumo(
      porDiaLocal,
      new Date("2026-12-20T15:00:00.000Z"),
      ESCOPO_CAMPANHA,
    );
    expect(r.curva.map((ponto) => ponto.realizado_no_dia)).toEqual(
      Array(21).fill(3),
    );
    const doisPedidos = {
      pedidos_aprovados: 2,
      bilhetes: 3,
      total_centavos: 6000,
    };
    expect(r.vendas_fora_da_janela).toEqual({
      antes_do_inicio: doisPedidos,
      depois_do_fim: doisPedidos,
    });
  });

  it("S8: vendas aprovadas antes do 1º dia ou depois do último não mudam meta, realizado, rankings nem bumbo", () => {
    const s = sorteador(7);
    for (let rodada = 0; rodada < 60; rodada++) {
      const { entrada: e, duracao, agora } = cenarioSorteado(s);
      const naJanela = (v: VendasDoDia) => {
        const n = diasEntre(e.campanha.data_inicio, v.dia) + 1;
        return n >= 1 && n <= duracao;
      };
      const extras = Array.from({ length: s.inteiro(1, 6) }, () =>
        venda(
          s.chance(0.2) ? null : s.inteiro(1, e.celulas.length),
          s.chance(0.5)
            ? dia(s.inteiro(-30, 0))
            : dia(duracao + s.inteiro(1, 30)),
          s.inteiro(1, 9),
        ),
      );
      const semFora = { ...e, vendas: e.vendas.filter(naJanela) };
      const comFora = { ...semFora, vendas: [...semFora.vendas, ...extras] };
      const r1 = montarResumoPainel(
        semFora,
        { escopo: ESCOPO_CAMPANHA },
        agora,
      );
      const r2 = montarResumoPainel(
        comFora,
        { escopo: ESCOPO_CAMPANHA },
        agora,
      );
      expect({ ...r2, vendas_fora_da_janela: null }).toEqual({
        ...r1,
        vendas_fora_da_janela: null,
      });
      // À parte, só o que já foi aprovado até a data de referência.
      const hoje = diaLocalDoInstante(agora, "America/Belem");
      const jaAconteceu = extras.filter((v) => diasEntre(v.dia, hoje) >= 0);
      const fora = obrigatorioNoTeste(r2.vendas_fora_da_janela);
      expect(fora.antes_do_inicio.bilhetes + fora.depois_do_fim.bilhetes).toBe(
        jaAconteceu.reduce((soma, v) => soma + v.bilhetes, 0),
      );
      for (const periodo of JANELAS_RANKING) {
        const consulta = { nivel: "celula" as const, periodo };
        expect(montarRankingPainel(comFora, consulta, agora)).toEqual(
          montarRankingPainel(semFora, consulta, agora),
        );
        expect(montarRankingPublico(comFora, consulta, agora)).toEqual(
          montarRankingPublico(semFora, consulta, agora),
        );
      }
      for (let n = -1; n <= duracao + 2; n++)
        expect(montarBumbo(comFora, { data: dia(n) }, agora).texto).toBe(
          montarBumbo(semFora, { data: dia(n) }, agora).texto,
        );
    }
  });

  it("S17: o retrato de uma data passada não muda com vendas posteriores nem com a hora da consulta", () => {
    const s = sorteador(8);
    const semHora = <T extends { atualizado_em: string }>(resposta: T) => ({
      ...resposta,
      atualizado_em: "",
    });
    for (let rodada = 0; rodada < 60; rodada++) {
      const { entrada: e, duracao } = cenarioSorteado(s);
      const n = s.inteiro(-1, duracao + 1);
      const data = dia(n);
      const ate = (limite: string) => ({
        ...e,
        vendas: e.vendas.filter((v) => diasEntre(v.dia, limite) >= 0),
      });
      const fimDoDia = new Date(`${dia(n + 1)}T02:59:59.999Z`); // último instante de `data` em Belém
      const muitoDepois = new Date(`${dia(duracao + 5)}T15:00:00.000Z`);
      const escopo = s.chance(0.5) ? ESCOPO_CAMPANHA : ESCOPO_AGAPE;
      expect(
        semHora(montarResumoPainel(e, { escopo, data }, muitoDepois)),
      ).toEqual(semHora(montarResumoPainel(ate(data), { escopo }, fimDoDia)));
      const consulta = {
        nivel: s.um(NIVEIS_RANKING),
        periodo: s.um(JANELAS_RANKING),
      };
      expect(
        semHora(montarRankingPainel(e, { ...consulta, data }, muitoDepois)),
      ).toEqual(semHora(montarRankingPainel(ate(data), consulta, fimDoDia)));
      // O bumbo de `data` fala do dia anterior: as vendas do próprio dia também não contam.
      const bumbo1 = montarBumbo(e, { data }, muitoDepois);
      const bumbo2 = montarBumbo(ate(dia(n - 1)), {}, fimDoDia);
      expect([bumbo1.texto, bumbo1.referencia]).toEqual([
        bumbo2.texto,
        bumbo2.referencia,
      ]);
    }
  });

  it("R8: classificarRanking não depende da ordem de entrada; posição de competição, empates e vizinhos corretos", () => {
    const s = sorteador(9);
    const nomes = [
      "Célula Ágape",
      "célula agape",
      "Célula Betel",
      "Célula 2",
      "Célula 10",
      "Célula Éfeso",
      "CÉLULA EFESO",
      "Célula Canaã",
    ];
    const ordemPt = new Intl.Collator("pt-BR", {
      sensitivity: "base",
      numeric: true,
    });
    // `a` é estritamente melhor que `b` (null = sem meta, o pior).
    const melhor = (a: number | null, b: number | null) =>
      a !== null && (b === null || a > b);
    for (let rodada = 0; rodada < 300; rodada++) {
      const participantes = Array.from(
        { length: s.inteiro(0, 10) },
        (_, indice) => ({
          id: indice + 1,
          nome: s.um(nomes),
          chave: s.chance(0.15) ? null : s.inteiro(0, 4),
        }),
      );
      const resultado = classificarRanking(participantes);
      const resumir = (lista: typeof resultado) =>
        lista.map((c) => [
          c.item.id,
          c.posicao,
          c.acima && [c.acima.item.id, c.acima.posicao, c.acima.diferenca],
          c.abaixo && [c.abaixo.item.id, c.abaixo.posicao, c.abaixo.diferenca],
        ]);
      expect(resumir(classificarRanking(s.embaralhar(participantes)))).toEqual(
        resumir(resultado),
      );
      expect(resultado).toHaveLength(participantes.length);
      resultado.forEach((c, i) => {
        expect(c.posicao).toBe(
          1 + participantes.filter((p) => melhor(p.chave, c.item.chave)).length,
        );
        if (i > 0) {
          const anterior = resultado[i - 1].item;
          expect(melhor(c.item.chave, anterior.chave)).toBe(false);
          if (anterior.chave === c.item.chave)
            expect(
              ordemPt.compare(anterior.nome, c.item.nome) ||
                anterior.id - c.item.id,
            ).toBeLessThan(0);
        }
        const distancia = (maior: number | null, menor: number | null) =>
          maior === null || menor === null ? null : maior - menor;
        const acima = resultado
          .slice(0, i)
          .reverse()
          .find((o) => o.posicao < c.posicao);
        expect(
          c.acima && [c.acima.item, c.acima.posicao, c.acima.diferenca],
        ).toEqual(
          acima
            ? [
                acima.item,
                acima.posicao,
                distancia(acima.item.chave, c.item.chave),
              ]
            : null,
        );
        const abaixo = resultado
          .slice(i + 1)
          .find((o) => o.posicao > c.posicao);
        expect(
          c.abaixo && [c.abaixo.item, c.abaixo.posicao, c.abaixo.diferenca],
        ).toEqual(
          abaixo
            ? [
                abaixo.item,
                abaixo.posicao,
                distancia(c.item.chave, abaixo.item.chave),
              ]
            : null,
        );
      });
    }
  });

  it("R9: o ranking público é o da coordenação cortado (só quem vendeu, até o limite, com empates) e sem valores", () => {
    const s = sorteador(10);
    for (let rodada = 0; rodada < 100; rodada++) {
      const { entrada: e, agora } = cenarioSorteado(s);
      const { publico } = e.campanha;
      for (const nivel of NIVEIS_RANKING)
        for (const periodo of JANELAS_RANKING)
          for (const divisao of [undefined, ...DIVISOES]) {
            const consulta =
              divisao === undefined
                ? { nivel, periodo }
                : { nivel, periodo, divisao };
            const coordenacao = montarRankingPainel(e, consulta, agora);
            const aberto = montarRankingPublico(e, consulta, agora);
            expect(respostaRankingPublicoSchema.parse(aberto)).toEqual(aberto);
            expect(aberto.itens).toEqual(
              coordenacao.itens
                .filter(
                  (item) =>
                    item.vendas.pedidos_aprovados > 0 &&
                    (publico.limite_ranking === null ||
                      item.posicao <= publico.limite_ranking),
                )
                .map((item) => ({
                  posicao: item.posicao,
                  nome: item.nome,
                  divisao: item.divisao,
                  ...(publico.mostra_percentual_meta &&
                  item.percentual_meta_bp !== null
                    ? { percentual_meta_bp: item.percentual_meta_bp }
                    : {}),
                })),
            );
            expect([aberto.janela, aberto.referencia, aberto.criterio]).toEqual(
              [
                coordenacao.janela,
                coordenacao.referencia,
                coordenacao.criterio,
              ],
            );
            for (const item of aberto.itens)
              expect(
                Object.keys(item).every((chave) =>
                  ["posicao", "nome", "divisao", "percentual_meta_bp"].includes(
                    chave,
                  ),
                ),
              ).toBe(true);
          }
    }
  });

  it("R10: o bumbo nunca traz R$, centavos, bilhetes nem número cru, com ou sem a opção", () => {
    const s = sorteador(11);
    const proibidos = [
      /R\$/,
      /centavo/i,
      /\breais?\b/i,
      /\d,\d/, // vírgula decimal: nenhum valor em dinheiro formatado
      /\d{4,}/, // número cru: tudo acima de 999 sai com separador de milhar
      /NaN|Infinity|undefined|null/,
    ];
    for (let rodada = 0; rodada < 50; rodada++) {
      const { entrada: e, duracao } = cenarioSorteado(s);
      for (let n = -2; n <= duracao + 2; n++)
        for (const mostrar_bilhetes of [false, true]) {
          const resposta = montarBumbo(
            e,
            { data: dia(n) },
            new Date(`${dia(n)}T13:00:00.000Z`),
            { mostrar_bilhetes },
          );
          expect(respostaBumboSchema.parse(resposta)).toEqual(resposta);
          for (const proibido of proibidos)
            expect(resposta.texto, `${dia(n)}: ${proibido}`).not.toMatch(
              proibido,
            );
          // R9: o bumbo é público; a opção não muda nada (é ignorada).
          expect(resposta.texto, dia(n)).not.toMatch(/bilhete/i);
          if (mostrar_bilhetes)
            expect(resposta.texto).toBe(
              montarBumbo(
                e,
                { data: dia(n) },
                new Date(`${dia(n)}T13:00:00.000Z`),
              ).texto,
            );
        }
    }
  });

  it("R10: o bumbo do dia D repete o painel do fim do dia D−1 (venda de ontem, acumulado, curva, situação e projeção)", () => {
    const s = sorteador(12);
    for (let rodada = 0; rodada < 40; rodada++) {
      const { entrada: e, duracao } = cenarioSorteado(s);
      const curva = curvaEsperada(e.campanha.periodos);
      for (let n = 2; n <= duracao + 1; n++) {
        const texto = montarBumbo(e, { data: dia(n) }, meioDia(n)).texto;
        const ontem = montarResumoPainel(
          e,
          { escopo: ESCOPO_CAMPANHA, data: dia(n - 1) },
          meioDia(n),
        );
        const rotulo =
          n > duracao
            ? `*Último dia (dia ${n - 1}):*`
            : `*Ontem (dia ${n - 1}):*`;
        const doDia = obrigatorioNoTeste(ontem.hoje).percentual_meta_bp;
        expect(texto).toContain(
          doDia === null
            ? `${rotulo} a meta do dia já estava coberta.`
            : `${rotulo} vendemos ${textoPorcento(doDia)} da meta do dia.`,
        );
        const acumulado = textoPorcento(
          obrigatorioNoTeste(ontem.campanha.percentual_meta_bp),
        );
        if (n > duracao) {
          expect(texto).toContain(`*Resultado final:* ${acumulado} da meta.`);
          continue;
        }
        expect(texto).toContain(
          `*Acumulado:* ${acumulado} da meta. Pela curva, o esperado até ontem era ${textoPorcento(percentualEsperadoBp(curva, n - 1))}.`,
        );
        // Situação e projeção: as do painel na manhã do dia D, antes de qualquer venda do dia.
        const manha = montarResumoPainel(
          {
            ...e,
            vendas: e.vendas.filter((v) => diasEntre(v.dia, dia(n - 1)) >= 0),
          },
          { escopo: ESCOPO_CAMPANHA, data: dia(n) },
          meioDia(n),
        ).campanha;
        if (manha.projecao_percentual_meta_bp === null)
          expect(texto).not.toContain("no ritmo atual");
        else
          expect(texto).toContain(
            `${manha.situacao === "em_dia" ? "Estamos em dia" : "Estamos abaixo da curva"}: no ritmo atual, chegamos a ${textoPorcento(manha.projecao_percentual_meta_bp)} da meta.`,
          );
        const faltam = duracao - n + 1;
        expect(texto).toContain(
          n === duracao
            ? "*Hoje é o último dia!*"
            : `Faltam ${faltam === 1 ? "1 dia" : `${faltam} dias`}${manha.situacao === "abaixo" ? " e dá para virar o jogo" : ". Bora manter o ritmo"}`,
        );
      }
    }
  });

  it("R7: fase, dia N de total e período batem com o calendário em todas as datas, inclusive o último dia", () => {
    const s = sorteador(13);
    for (let rodada = 0; rodada < 100; rodada++) {
      const periodos = periodosSorteados(s);
      const campanha = { ...CAMPANHA, periodos };
      const duracao = periodos.reduce((t, p) => t + p.dias, 0);
      const doDia: { ordem: number; noPeriodo: number; dias: number }[] = [];
      periodos.forEach((periodo, indice) => {
        for (let t = 1; t <= periodo.dias; t++)
          doDia.push({ ordem: indice + 1, noPeriodo: t, dias: periodo.dias });
      });
      for (let n = -2; n <= duracao + 2; n++) {
        const referencia = referenciaDaCampanha(campanha, dia(n));
        expect(referenciaCampanhaSchema.parse(referencia)).toEqual(referencia);
        expect(referencia).toMatchObject({
          data: dia(n),
          duracao_dias: duracao,
          data_fim: dia(duracao),
        });
        if (n < 1)
          expect(referencia).toMatchObject({
            fase: "antes",
            dia_campanha: null,
            dias_restantes: duracao,
            dias_para_inicio: 1 - n,
            periodo: null,
          });
        else if (n > duracao)
          expect(referencia).toMatchObject({
            fase: "encerrada",
            dia_campanha: null,
            dias_restantes: 0,
            dias_para_inicio: null,
            periodo: null,
          });
        else {
          const { ordem, noPeriodo, dias } = doDia[n - 1];
          expect(referencia).toMatchObject({
            fase: "durante",
            dia_campanha: n,
            dias_restantes: duracao - n + 1,
            dias_para_inicio: null,
            periodo: {
              ordem,
              nome: periodos[ordem - 1].nome,
              data_inicio: dia(n - noPeriodo + 1),
              data_fim: dia(n - noPeriodo + dias),
              dias,
              dia_no_periodo: noPeriodo,
              dias_restantes: dias - noPeriodo + 1,
            },
          });
        }
      }
    }
  });

  it("bordas: 0 pessoas, meta zero e período a 0% não dividem por zero, não lançam e cabem nos schemas", () => {
    const zeradas = [
      celula(1, "Célula Zero", 0, ABEL, JOVEM),
      celula(2, "Célula Vazia", 0, CALEB, ADULTA),
    ];
    const comUma = [...zeradas, celula(3, "Célula Uma", 1, BOAZ, JOVEM)];
    const aquecimento: CampanhaCalculo = {
      ...CAMPANHA,
      periodos: [
        { nome: "Aquecimento", dias: 3, percentual_bp: 0 },
        { nome: "Reta final", dias: 4, percentual_bp: 10_000 },
      ],
    };
    const campanhas: CampanhaCalculo[] = [
      ...REGRAS_META.map((regra) => ({
        ...CAMPANHA,
        meta: { ...CAMPANHA.meta, regra },
      })),
      { ...CAMPANHA, meta: { ...CAMPANHA.meta, valor: 0 } },
      aquecimento,
    ];
    const vendas = [
      venda(1, dia(1), 3),
      venda(2, dia(2), 1),
      venda(3, dia(3), 2),
      venda(null, dia(2), 1),
    ];
    for (const campanha of campanhas)
      for (const celulas of [zeradas, comUma])
        for (const n of [-1, 0, 1, 2, 4, 7, 8, 21, 22, 30]) {
          const e = { campanha, celulas, vendas };
          const agora = meioDia(n);
          const respostas = [
            respostaPainelResumoSchema.parse(
              montarResumoPainel(e, { escopo: ESCOPO_CAMPANHA }, agora),
            ),
            respostaPainelResumoSchema.parse(
              montarResumoPainel(
                e,
                { escopo: { ...ESCOPO_AGAPE, nome: "Célula Zero" } },
                agora,
              ),
            ),
            ...JANELAS_RANKING.map((periodo) =>
              respostaRankingSchema.parse(
                montarRankingPainel(e, { nivel: "celula", periodo }, agora),
              ),
            ),
            respostaRankingPublicoSchema.parse(
              montarRankingPublico(
                e,
                { nivel: "celula", periodo: "atual" },
                agora,
              ),
            ),
            respostaBumboSchema.parse(montarBumbo(e, {}, agora)),
          ];
          expect(numerosFinitos(respostas)).toBe(true);
        }
    // No período a 0%, ninguém tem meta: todos "sem meta", empatados em 1º no % da meta.
    const itens = montarRankingPainel(
      { campanha: aquecimento, celulas: comUma, vendas },
      { nivel: "celula", periodo: "atual" },
      meioDia(3),
    ).itens;
    expect(itens.map((i) => [i.posicao, i.situacao, i.meta])).toEqual([
      [1, "sem_meta", 0],
      [1, "sem_meta", 0],
      [1, "sem_meta", 0],
    ]);
    // Período de 0 dias não forma curva: erro explícito (a configuração exige ≥ 1 dia), nunca divisão por zero.
    expect(() => curvaEsperada([{ dias: 0, percentual_bp: 10_000 }])).toThrow(
      RangeError,
    );
  });
});

function obrigatorioNoTeste<T>(valor: T | null | undefined): T {
  if (valor === null || valor === undefined)
    throw new Error("valor ausente no teste");
  return valor;
}
