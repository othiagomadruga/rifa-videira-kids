// A tela Mapa usa cópias de valores do contrato (os valores de api.ts poriam o zod no pacote do site; veja
// mapa-api.ts). Este teste garante que as cópias continuam iguais ao contrato, que as consultas que a tela monta
// passam pelo schema da rota, que a grade do mapa tem as 27 UFs da tabela da Anatel e as regras das faixas e dos
// textos.
import { describe, expect, it } from "vitest";
import {
  JANELAS_RANKING,
  ROTAS,
  consultaMapaDddSchema,
} from "../../../shared/contracts/api";
import { DIVISOES } from "../../../shared/contracts/dominio";
import { UFS, UF_DO_DDD } from "../../../shared/contracts/ddd";
import { TELAS_COORDENACAO } from "../coordenacao/telas";
import {
  COLUNAS_DA_GRADE,
  LINHAS_DA_GRADE,
  POSICAO_DA_UF,
  UFS_NA_ORDEM_DA_GRADE,
} from "./grade";
import {
  CAMINHO_MAPA_DDD,
  PERIODOS,
  caminhoDoMapa,
  lerFiltros,
  parametrosDosFiltros,
} from "./mapa-api";
import {
  LIMITES_DAS_FAIXAS,
  ROTULO_DA_FAIXA,
  TEXTO_PERIODO,
  faixaDaUf,
  posicoesDoTop3,
  rotuloDaUf,
  textoParte,
  type DddDoMapa,
  type TotaisMapa,
} from "./textos";

/** A consulta de um caminho como objeto, para passar pelo schema da rota. */
function consultaDe(caminho: string): Record<string, string> {
  return Object.fromEntries(new URL(caminho, "http://localhost").searchParams);
}

const totais = (parcial: Partial<TotaisMapa>): TotaisMapa => ({
  pedidos_aprovados: 1,
  bilhetes: 1,
  total_centavos: 1000,
  parte_bilhetes_bp: 0,
  ...parcial,
});

describe("cópias do contrato do mapa no site", () => {
  it("caminho e método da rota; rota e tela abertas a toda a coordenação", () => {
    expect(ROTAS.mapaDdd).toMatchObject({
      metodo: "GET",
      caminho: CAMINHO_MAPA_DDD,
      grupo: "coordenacao",
    });
    expect("papeis" in ROTAS.mapaDdd).toBe(false);
    const tela = TELAS_COORDENACAO.find(({ segmento }) => segmento === "mapa");
    expect(tela?.rotulo).toBe("Mapa");
    expect(tela?.papeis).toBeUndefined();
  });

  it("os períodos são os do contrato, cada um com um texto; o padrão é o da API (a campanha)", () => {
    expect([...PERIODOS].sort()).toEqual([...JANELAS_RANKING].sort());
    expect(Object.keys(TEXTO_PERIODO).sort()).toEqual(
      [...JANELAS_RANKING].sort(),
    );
    expect(consultaMapaDddSchema.parse({}).periodo).toBe(PERIODOS[0]);
  });

  it("as consultas montadas pela tela passam pelo schema da rota, e a URL da tela vai e volta sem perder nada", () => {
    for (const periodo of PERIODOS) {
      for (const divisao of [null, ...DIVISOES]) {
        const filtros = { periodo, divisao };
        expect(
          consultaMapaDddSchema.parse(consultaDe(caminhoDoMapa(filtros))),
        ).toEqual({ periodo, ...(divisao ? { divisao } : {}) });
        expect(lerFiltros(parametrosDosFiltros(filtros))).toEqual(filtros);
      }
    }
    // Os padrões ficam fora da URL; valor desconhecido vale o padrão.
    expect(
      parametrosDosFiltros({ periodo: "campanha", divisao: null }).toString(),
    ).toBe("");
    expect(
      lerFiltros(new URLSearchParams("periodo=semana&divisao=criancas")),
    ).toEqual({ periodo: "campanha", divisao: null });
  });
});

describe("a grade do mapa (cartograma)", () => {
  it("tem as 27 UFs da tabela da Anatel, cada uma numa casa só, dentro de 7 colunas por 8 linhas", () => {
    expect(Object.keys(POSICAO_DA_UF).sort()).toEqual([...UFS].sort());
    expect(new Set(Object.values(UF_DO_DDD))).toEqual(new Set(UFS));
    const casas = Object.values(POSICAO_DA_UF).map(([l, c]) => `${l},${c}`);
    expect(new Set(casas).size).toBe(UFS.length);
    for (const [linha, coluna] of Object.values(POSICAO_DA_UF)) {
      expect(linha).toBeGreaterThanOrEqual(0);
      expect(linha).toBeLessThan(LINHAS_DA_GRADE);
      expect(coluna).toBeGreaterThanOrEqual(0);
      expect(coluna).toBeLessThan(COLUNAS_DA_GRADE);
    }
  });

  it("o canto do quadro (linhas 5 a 8, colunas 1 a 3, como no mapa.css) fica livre", () => {
    for (const [uf, [linha, coluna]] of Object.entries(POSICAO_DA_UF)) {
      expect(linha >= 4 && coluna <= 2, uf).toBe(false);
    }
  });

  it("a forma do Brasil: norte em cima, sul embaixo, Nordeste à direita e o Centro-Oeste no meio", () => {
    const linha = (uf: keyof typeof POSICAO_DA_UF) => POSICAO_DA_UF[uf][0];
    const coluna = (uf: keyof typeof POSICAO_DA_UF) => POSICAO_DA_UF[uf][1];
    expect(linha("RR")).toBe(0);
    expect(linha("AP")).toBe(0);
    expect(linha("RS")).toBe(LINHAS_DA_GRADE - 1);
    expect(linha("PA")).toBeLessThan(linha("TO"));
    expect(linha("TO")).toBeLessThan(linha("GO"));
    expect(linha("SP")).toBeLessThan(linha("PR"));
    expect(linha("PR")).toBeLessThan(linha("SC"));
    expect(linha("SC")).toBeLessThan(linha("RS"));
    expect(coluna("RN")).toBe(COLUNAS_DA_GRADE - 1);
    expect(coluna("AC")).toBe(0);
    expect(coluna("AM")).toBeLessThan(coluna("PA"));
    expect(coluna("GO")).toBeLessThan(coluna("DF"));
  });

  it("a ordem do HTML (e do Tab) é a de leitura da grade: linha a linha, da esquerda para a direita", () => {
    expect(UFS_NA_ORDEM_DA_GRADE).toHaveLength(27);
    expect(UFS_NA_ORDEM_DA_GRADE.slice(0, 8)).toEqual([
      "RR",
      "AP",
      "AM",
      "PA",
      "MA",
      "PI",
      "CE",
      "RN",
    ]);
    expect(UFS_NA_ORDEM_DA_GRADE.at(-1)).toBe("RS");
  });
});

describe("faixas da cor e textos", () => {
  it("cada faixa começa no seu limite; quem vendeu nunca fica neutro, nem com a parte truncada em 0", () => {
    expect(LIMITES_DAS_FAIXAS).toEqual([100, 500, 1500, 4000]);
    expect(faixaDaUf(undefined)).toBe(0);
    expect(faixaDaUf(totais({ pedidos_aprovados: 0, bilhetes: 0 }))).toBe(0);
    expect(faixaDaUf(totais({ parte_bilhetes_bp: 0 }))).toBe(1);
    expect(faixaDaUf(totais({ parte_bilhetes_bp: 99 }))).toBe(1);
    expect(faixaDaUf(totais({ parte_bilhetes_bp: 100 }))).toBe(2);
    expect(faixaDaUf(totais({ parte_bilhetes_bp: 499 }))).toBe(2);
    expect(faixaDaUf(totais({ parte_bilhetes_bp: 500 }))).toBe(3);
    expect(faixaDaUf(totais({ parte_bilhetes_bp: 1499 }))).toBe(3);
    expect(faixaDaUf(totais({ parte_bilhetes_bp: 1500 }))).toBe(4);
    expect(faixaDaUf(totais({ parte_bilhetes_bp: 3999 }))).toBe(4);
    expect(faixaDaUf(totais({ parte_bilhetes_bp: 4000 }))).toBe(5);
    expect(faixaDaUf(totais({ parte_bilhetes_bp: 10000 }))).toBe(5);
    expect(Object.keys(ROTULO_DA_FAIXA)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("a parte com uma casa, truncada; abaixo de 0,1% com venda, 'menos de 0,1%'", () => {
    expect(textoParte(totais({ parte_bilhetes_bp: 8847 }))).toBe("88,4%");
    expect(textoParte(totais({ parte_bilhetes_bp: 10000 }))).toBe("100,0%");
    expect(textoParte(totais({ parte_bilhetes_bp: 10 }))).toBe("0,1%");
    expect(textoParte(totais({ parte_bilhetes_bp: 9 }))).toBe("menos de 0,1%");
    expect(textoParte(totais({ parte_bilhetes_bp: 0 }))).toBe("menos de 0,1%");
    expect(textoParte(totais({ bilhetes: 0, pedidos_aprovados: 0 }))).toBe(
      "0,0%",
    );
  });

  it("o rótulo de uma UF tem o nome, a sigla (o texto visível) e os números; sem venda, diz que não vendeu", () => {
    expect(
      rotuloDaUf(
        "PA",
        totais({
          pedidos_aprovados: 1,
          bilhetes: 1234,
          total_centavos: 1234000,
          parte_bilhetes_bp: 7230,
        }),
      ),
    ).toBe(
      "Pará (PA): 1 pedido aprovado, 1.234 bilhetes, R$\u00a012.340,00, 72,3% dos bilhetes",
    );
    expect(rotuloDaUf("TO", undefined)).toBe("Tocantins (TO): sem venda");
  });

  it("top 3 por bilhetes, em qualquer lugar da lista; empates dividem a posição", () => {
    const ddd = (codigo: string, bilhetes: number): DddDoMapa => ({
      ...totais({ bilhetes }),
      ddd: codigo,
      uf: UF_DO_DDD[codigo],
    });
    expect([
      ...posicoesDoTop3([
        ddd("91", 100),
        ddd("94", 5),
        ddd("11", 40),
        ddd("61", 20),
      ]),
    ]).toEqual([
      ["91", 1],
      ["11", 2],
      ["61", 3],
    ]);
    expect([
      ...posicoesDoTop3([
        ddd("91", 10),
        ddd("94", 10),
        ddd("11", 7),
        ddd("61", 7),
        ddd("21", 3),
      ]),
    ]).toEqual([
      ["91", 1],
      ["94", 1],
      ["11", 3],
      ["61", 3],
    ]);
  });
});
