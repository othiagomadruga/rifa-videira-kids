// Regras de cálculo (RIFA-008): cada regra de docs/regras-de-calculo.md com exemplos numéricos
// calculados à mão. Os montadores são conferidos contra os schemas estritos das rotas (CA3).
import { describe, expect, it } from "vitest";
import * as contrato from ".";
import {
  respostaBumboSchema,
  respostaPainelResumoSchema,
  respostaRankingPublicoSchema,
  respostaRankingSchema,
  type ConsultaRanking,
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
  referenciaDaCampanha,
  situacaoDoRitmo,
  somarMetas,
  vendaContaNaCampanha,
  type CampanhaCalculo,
  type CelulaCalculo,
  type EntradaCalculo,
  type EscopoResolvido,
  type VendasDoDia,
} from "./calculos";
import { somarDias } from "./calendario";
import { DIVISOES } from "./dominio";

// ---------------------------------------------------------------------------------------------------
// Cenário: 21 dias (7/7/7) com 35/25/45 (soma 105%), 10 bilhetes por pessoa, início em 23/11/2026.
// Dias: 1 = 23/11 … 7 = 29/11 (Semana 1), 8 = 30/11 … 14 = 06/12 (Semana 2), 15 = 07/12 … 21 = 13/12.
// ---------------------------------------------------------------------------------------------------

const CAMPANHA: CampanhaCalculo = {
  nome: "Rifa Videira Kids",
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
  nome: "Rifa Videira Kids",
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
      { tipo: "campanha", id: null, divisao: null, nome: "Rifa Videira Kids" },
      600,
    ],
  ] as const)(
    "agregado %j: meta = soma das células abaixo (%i)",
    (escopo, meta) => {
      expect(resumo([], meioDia(8), escopo).campanha.meta).toBe(meta);
    },
  );
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
        "*Rifa Videira Kids · Dia 9 de 21*",
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
        "Faltam 13 dias e dá para virar o jogo: compartilhe hoje o link da sua célula com quem é de fora da igreja!",
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

  it("bilhetes só com a opção ligada", () => {
    const texto = bumbo(dia(9), CAMPANHA, { mostrar_bilhetes: true });
    expect(texto).toContain(
      "*Ontem (dia 8):* 21 bilhetes, 33% da meta do dia.",
    );
    expect(texto).toContain("*Acumulado:* 180 bilhetes, 30% da meta.");
    expect(bumbo(dia(9))).not.toMatch(/bilhete/i);
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
        "*Rifa Videira Kids*",
        "Faltam 3 dias para começar: as vendas vão de 23/11 a 13/12.",
      ],
    ],
    ["2026-11-22", ["Falta 1 dia para começar"]],
    [
      dia(1),
      [
        "*Rifa Videira Kids · Dia 1 de 21*",
        "Começou! As vendas vão até 13/12.",
      ],
    ],
    [dia(15), ["*Ranking · Semana 2 (resultado final)*"]],
    [dia(21), ["*Rifa Videira Kids · Dia 21 de 21*", "*Hoje é o último dia!*"]],
    [
      "2026-12-14",
      [
        "*Rifa Videira Kids · Campanha encerrada*",
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

  it("guarda: nunca R$ nem centavos; sem a opção, nenhum bilhete (todas as fases, duas campanhas)", () => {
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
        for (const texto of [semBilhetes, comBilhetes])
          for (const proibido of proibidosSempre)
            expect(texto, `${data}: ${proibido}`).not.toMatch(proibido);
        expect(semBilhetes, data).not.toMatch(
          /bilhete|4\.567|4567|3\.891|3891|2\.345|2345/i,
        );
      }
    expect(
      bumbo(dia(9), centavos, { mostrar_bilhetes: true }, distintas),
    ).toContain("6.236 bilhetes");
  });
});
