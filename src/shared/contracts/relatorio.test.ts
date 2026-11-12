// RIFA-038 (docs/decisions.md D23): o relatório da campanha para baixar, em CSV. Um teste por critério do contrato:
// a rota e o catálogo, os tipos e as colunas, o formato dos números, a proteção contra fórmula, o arquivo (BOM, ";",
// CRLF) e o nome. As linhas de cada tipo, a leitura do banco e o botão são das tarefas -api e -web.
import { describe, expect, expectTypeOf, it } from "vitest";
import { lerCsv } from "../csv";
import { ROTAS_ACESSO, ROTAS_ACESSO_HIERARQUIA } from "./acesso";
import {
  FASES_CAMPANHA,
  ROTAS,
  ROTAS_REGRAS_CAMPANHA,
  ROTAS_RELATORIO,
  ROTAS_TOKEN_WEBHOOK,
  consultaRelatorioSchema,
  respostaRelatorioCsvSchema,
  type ConsultaRelatorio,
  type DefinicaoRota,
} from "./api";
import { CRITERIOS_RANKING, UNIDADES_META } from "./dominio";
import * as contrato from "./index";
import {
  BOM_UTF8,
  COLUNAS_RELATORIO,
  FIM_DE_LINHA_CSV_RELATORIO,
  LINHA_EXTERIOR_RELATORIO,
  LINHA_SEM_DDD_RELATORIO,
  PREFIXO_ARQUIVO_RELATORIO,
  SEPARADOR_CSV_RELATORIO,
  TEXTO_CRITERIO_RELATORIO,
  TEXTO_FASE_RELATORIO,
  TIPOS_RELATORIO,
  TIPO_CONTEUDO_CSV,
  TITULOS_COLUNAS_RELATORIO,
  cabecalhoDoRelatorio,
  cabecalhosDoRelatorio,
  celulaCsv,
  formatarCentavosCsv,
  formatarDataCsv,
  formatarInteiroCsv,
  formatarMetaCsv,
  formatarPercentualBpCsv,
  montarCsvRelatorio,
  nomeDoArquivoRelatorio,
  pareceFormulaNoCsv,
  tituloDaColuna,
  type ColunaRelatorio,
  type TipoRelatorio,
} from "./relatorio";
import fonteRelatorio from "./relatorio.ts?raw";

/** Lê o arquivo com o leitor de CSV do projeto (o da importação da hierarquia e da conferência). */
function lerArquivo(texto: string): string[][] {
  const leitura = lerCsv(texto);
  if (!leitura.ok) throw new Error(leitura.mensagem);
  expect(leitura.separador).toBe(";");
  return leitura.registros.map((registro) => registro.campos);
}

describe("D23: a rota", () => {
  const rota = ROTAS_RELATORIO.baixarRelatorio;

  it("GET /api/painel/relatorio, do grupo da coordenação, para admin e coordenação (sem `papeis`)", () => {
    expect(Object.keys(ROTAS_RELATORIO)).toEqual(["baixarRelatorio"]);
    expect(rota.metodo).toBe("GET");
    expect(rota.caminho).toBe("/api/painel/relatorio");
    expect(rota.grupo).toBe("coordenacao");
    expect(rota.situacao).toBe("detalhada");
    expect("papeis" in rota).toBe(false);
    expect("corpo" in rota).toBe(false);
    expect(rota.consulta).toBe(consultaRelatorioSchema);
    expect(rota.sucesso).toEqual({
      status: 200,
      corpo: respostaRelatorioCsvSchema,
      tipoConteudo: "text/csv; charset=utf-8",
    });
    expectTypeOf(rota).toExtend<DefinicaoRota>();
  });

  it("não repete rota de nenhum outro catálogo, e só ela responde em CSV", () => {
    const outras: readonly {
      metodo: string;
      caminho: string;
      sucesso: object;
    }[] = [
      ...Object.values(ROTAS),
      ...Object.values(ROTAS_ACESSO),
      ...Object.values(ROTAS_ACESSO_HIERARQUIA),
      ...Object.values(ROTAS_REGRAS_CAMPANHA),
      ...Object.values(ROTAS_TOKEN_WEBHOOK),
    ];
    expect(
      outras.map((outra) => `${outra.metodo} ${outra.caminho}`),
    ).not.toContain(`${rota.metodo} ${rota.caminho}`);
    expect(outras.filter((outra) => "tipoConteudo" in outra.sucesso)).toEqual(
      [],
    );
  });

  it("consulta: `tipo` obrigatório, um dos 7; sem `data` (um `data` na URL é ignorado)", () => {
    for (const tipo of TIPOS_RELATORIO)
      expect(consultaRelatorioSchema.parse({ tipo })).toEqual({ tipo });
    expect(
      consultaRelatorioSchema.parse({ tipo: "celulas", data: "2026-12-01" }),
    ).toEqual({ tipo: "celulas" });
    for (const consulta of [
      {},
      { tipo: "" },
      { tipo: "Celulas" },
      { tipo: "pedidos" },
      { tipo: "zip" },
      { tipo: ["celulas", "redes"] },
    ])
      expect(consultaRelatorioSchema.safeParse(consulta).success).toBe(false);
    expectTypeOf<ConsultaRelatorio>().toEqualTypeOf<{ tipo: TipoRelatorio }>();
  });

  it("resposta 200: o texto do CSV, sempre com o BOM do UTF-8 no começo", () => {
    const csv = montarCsvRelatorio(["Rede"], [["Rede Ficticia"]]);
    expect(respostaRelatorioCsvSchema.parse(csv)).toBe(csv);
    expect(
      respostaRelatorioCsvSchema.safeParse(csv.slice(BOM_UTF8.length)).success,
    ).toBe(false);
    expect(respostaRelatorioCsvSchema.safeParse({ itens: [] }).success).toBe(
      false,
    );
  });

  it("cabeçalhos da resposta: CSV em UTF-8, anexo com o nome do arquivo e no-store", () => {
    expect(cabecalhosDoRelatorio("celulas", "2026-12-04")).toEqual({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="rifa-videira-kids-celulas-2026-12-04.csv"',
      "Cache-Control": "no-store",
    });
    expect(TIPO_CONTEUDO_CSV).toBe("text/csv; charset=utf-8");
  });

  it("nome do arquivo: rifa-videira-kids-<tipo>-<data>.csv, só ASCII sem aspas (não precisa de filename*)", () => {
    expect(PREFIXO_ARQUIVO_RELATORIO).toBe("rifa-videira-kids");
    for (const tipo of TIPOS_RELATORIO) {
      const nome = nomeDoArquivoRelatorio(tipo, "2026-12-16");
      expect(nome).toBe(`rifa-videira-kids-${tipo}-2026-12-16.csv`);
      expect(nome).toMatch(/^[a-z0-9-]+\.csv$/);
    }
    for (const data of ["16/12/2026", "2026-12-16T00:00:00Z", "", '2026"'])
      expect(() => nomeDoArquivoRelatorio("totais", data)).toThrow(RangeError);
  });

  it("o index exporta o catálogo, os schemas e as regras do arquivo", () => {
    expect(contrato.ROTAS_RELATORIO).toBe(ROTAS_RELATORIO);
    expect(contrato.consultaRelatorioSchema).toBe(consultaRelatorioSchema);
    expect(contrato.TIPOS_RELATORIO).toBe(TIPOS_RELATORIO);
    expect(contrato.COLUNAS_RELATORIO).toBe(COLUNAS_RELATORIO);
    expect(contrato.montarCsvRelatorio).toBe(montarCsvRelatorio);
    expect(contrato.cabecalhosDoRelatorio).toBe(cabecalhosDoRelatorio);
  });

  it("relatorio.ts não carrega o zod: de outros módulos do contrato só vêm tipos (o site importa daqui)", () => {
    const declaracoes =
      fonteRelatorio
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
        .match(/^(?:import|export)\b[^;]*?\bfrom\s+"[^"]+";/gms) ?? [];
    expect(declaracoes.length).toBeGreaterThan(0);
    for (const declaracao of declaracoes)
      expect(declaracao).toMatch(/^import type\b/);
  });
});

describe("D23: tipos e colunas (nomes e ordem)", () => {
  it("os 7 tipos, na ordem da tela", () => {
    expect(TIPOS_RELATORIO).toEqual([
      "totais",
      "celulas",
      "discipuladores",
      "redes",
      "periodos",
      "dias",
      "ddd",
    ]);
    expect(Object.keys(COLUNAS_RELATORIO)).toEqual([...TIPOS_RELATORIO]);
  });

  // O cabeçalho exato de cada tipo, com a meta em bilhetes. Mudar uma coluna é mudar o contrato (só o SM).
  const CABECALHOS: Record<TipoRelatorio, string[]> = {
    totais: [
      "Campanha",
      "Data de referência",
      "Situação da campanha",
      "Início",
      "Fim",
      "Meta (bilhetes)",
      "Pedidos aprovados",
      "Bilhetes",
      "Arrecadação (R$)",
      "% da meta",
      "Pedidos sem célula",
      "Bilhetes sem célula",
      "Arrecadação sem célula (R$)",
      "Pedidos fora das datas da campanha",
      "Bilhetes fora das datas da campanha",
      "Arrecadação fora das datas da campanha (R$)",
      "Pedidos desconsiderados",
      "Critério do ranking",
    ],
    celulas: [
      "Divisão",
      "Rede",
      "Discipulador",
      "Célula",
      "Líder",
      "Meta (bilhetes)",
      "Pedidos aprovados",
      "Bilhetes",
      "Arrecadação (R$)",
      "% da meta",
      "Posição na divisão",
    ],
    discipuladores: [
      "Divisão",
      "Rede",
      "Discipulador",
      "Meta (bilhetes)",
      "Pedidos aprovados",
      "Bilhetes",
      "Arrecadação (R$)",
      "% da meta",
      "Posição na divisão",
    ],
    redes: [
      "Divisão",
      "Rede",
      "Meta (bilhetes)",
      "Pedidos aprovados",
      "Bilhetes",
      "Arrecadação (R$)",
      "% da meta",
      "Posição na divisão",
    ],
    periodos: [
      "Período",
      "Início",
      "Fim",
      "Pedidos aprovados",
      "Bilhetes",
      "Arrecadação (R$)",
    ],
    dias: [
      "Data",
      "Dia da campanha",
      "Período",
      "Pedidos aprovados",
      "Bilhetes",
      "Arrecadação (R$)",
    ],
    ddd: [
      "UF",
      "DDD",
      "Pedidos aprovados",
      "Bilhetes",
      "Arrecadação (R$)",
      "% dos bilhetes",
    ],
  };

  it.each(TIPOS_RELATORIO)(
    "%s: o cabeçalho exato, na ordem; a meta em R$ quando a meta da campanha é em centavos",
    (tipo) => {
      expect(cabecalhoDoRelatorio(tipo, "bilhetes")).toEqual(CABECALHOS[tipo]);
      expect(cabecalhoDoRelatorio(tipo, "centavos")).toEqual(
        CABECALHOS[tipo].map((titulo) =>
          titulo === "Meta (bilhetes)" ? "Meta (R$)" : titulo,
        ),
      );
      // Sem coluna repetida.
      expect(new Set(COLUNAS_RELATORIO[tipo]).size).toBe(
        COLUNAS_RELATORIO[tipo].length,
      );
    },
  );

  it("célula, discipulador e rede: os mesmos totais (meta, pedidos, bilhetes, R$, % da meta e posição), no fim da linha", () => {
    const totais = [
      "meta",
      "pedidos",
      "bilhetes",
      "arrecadacao",
      "percentual_meta",
      "posicao_divisao",
    ];
    for (const tipo of ["celulas", "discipuladores", "redes"] as const)
      expect(COLUNAS_RELATORIO[tipo].slice(-totais.length)).toEqual(totais);
  });

  it("toda coluna usada tem título, e todo título é usado", () => {
    const usadas = new Set<ColunaRelatorio>(
      Object.values(COLUNAS_RELATORIO).flat(),
    );
    expect([...usadas].sort()).toEqual(
      Object.keys(TITULOS_COLUNAS_RELATORIO).sort(),
    );
    for (const unidade of UNIDADES_META)
      expect(tituloDaColuna("meta", unidade)).toBe(
        TITULOS_COLUNAS_RELATORIO.meta[unidade],
      );
  });

  it("nenhuma coluna de dado pessoal: nada de telefone, e-mail, comprador, afiliado ou id", () => {
    const nomes = [
      ...Object.keys(TITULOS_COLUNAS_RELATORIO),
      ...UNIDADES_META.flatMap((unidade) =>
        TIPOS_RELATORIO.flatMap((tipo) => cabecalhoDoRelatorio(tipo, unidade)),
      ),
    ].join(" ");
    expect(nomes).not.toMatch(
      /telefone|celular|whats|e-?mail|comprador|cliente|afiliad|affiliate|\bid\b|cpf|token|usu[aá]rio/i,
    );
  });

  it("textos fixos: a situação de cada fase, o critério do ranking e as linhas sem DDD", () => {
    expect(Object.keys(TEXTO_FASE_RELATORIO)).toEqual([...FASES_CAMPANHA]);
    expect(TEXTO_FASE_RELATORIO).toEqual({
      antes: "Antes do início",
      durante: "Em andamento",
      encerrada: "Encerrada",
    });
    expect(Object.keys(TEXTO_CRITERIO_RELATORIO)).toEqual([
      ...CRITERIOS_RANKING,
    ]);
    expect(TEXTO_CRITERIO_RELATORIO).toEqual({
      percentual_meta: "% da meta",
      bilhetes: "Bilhetes",
      arrecadacao: "Arrecadação",
    });
    expect([LINHA_EXTERIOR_RELATORIO, LINHA_SEM_DDD_RELATORIO]).toEqual([
      "Exterior",
      "Sem DDD",
    ]);
  });
});

describe("D23: formato dos números", () => {
  it("quantidade: só os dígitos, sem separador de milhar", () => {
    expect(
      [0, 7, 1234, 259_000, 1_000_000].map((valor) =>
        formatarInteiroCsv(valor),
      ),
    ).toEqual(["0", "7", "1234", "259000", "1000000"]);
  });

  it("R$: reais com vírgula e sempre 2 casas, sem 'R$' e sem milhar (por texto, sem float)", () => {
    expect(
      [
        0, 5, 50, 100, 2000, 123_456, 278_000, 1_000_000_000, 999_999_999_999,
      ].map((centavos) => formatarCentavosCsv(centavos)),
    ).toEqual([
      "0,00",
      "0,05",
      "0,50",
      "1,00",
      "20,00",
      "1234,56",
      "2780,00",
      "10000000,00",
      "9999999999,99",
    ]);
  });

  it("% (pontos-base já truncados): 2 casas com vírgula, sem o '%'; passa de 100 acima da meta; sem meta, vazio", () => {
    expect(
      [0, 1, 99, 933, 3861, 10_000, 12_345].map((bp) =>
        formatarPercentualBpCsv(bp),
      ),
    ).toEqual(["0,00", "0,01", "0,99", "9,33", "38,61", "100,00", "123,45"]);
    expect(formatarPercentualBpCsv(null)).toBe("");
  });

  it("meta na unidade da campanha: bilhetes como quantidade, centavos como R$", () => {
    expect(formatarMetaCsv(360, "bilhetes")).toBe("360");
    expect(formatarMetaCsv(720_000, "centavos")).toBe("7200,00");
  });

  it("datas em AAAA-MM-DD (sem ambiguidade de dia e mês); outro formato é erro de programação", () => {
    expect(formatarDataCsv("2026-11-23")).toBe("2026-11-23");
    for (const data of [
      "23/11/2026",
      "2026-11-23T03:00:00.000Z",
      "",
      "2026-1-3",
    ])
      expect(() => formatarDataCsv(data)).toThrow(RangeError);
  });

  it("negativo, fração, NaN ou infinito é erro de programação (o relatório nunca tem número negativo)", () => {
    for (const valor of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
    ]) {
      expect(() => formatarInteiroCsv(valor)).toThrow(RangeError);
      expect(() => formatarCentavosCsv(valor)).toThrow(RangeError);
      expect(() => formatarPercentualBpCsv(valor)).toThrow(RangeError);
    }
  });

  it("o que os formatadores produzem passa pela célula sem mudar (número nunca ganha apóstrofo nem aspas)", () => {
    for (let valor = 0; valor <= 100_000; valor += 37) {
      for (const texto of [
        formatarInteiroCsv(valor),
        formatarCentavosCsv(valor),
        formatarPercentualBpCsv(valor),
      ]) {
        expect(texto).toMatch(/^\d+(?:,\d{2})?$/);
        expect(celulaCsv(texto)).toBe(texto);
      }
    }
    expect(celulaCsv(formatarDataCsv("2026-12-16"))).toBe("2026-12-16");
    expect(celulaCsv("")).toBe("");
  });
});

describe("D23: proteção contra fórmula e aspas", () => {
  it.each([
    "=1+1",
    '=HYPERLINK("https://site.example";"clique")',
    "=cmd|' /C calc'!A0",
    "+123",
    "+Vida",
    "-2+3",
    "-Célula",
    "@SUM(A1:A2)",
    "  =1+1",
    " =1+1",
    "\t=1+1",
    "\tCélula",
    "\rCélula",
    "\n=1+1",
    "＝1+1",
    "＋Vida",
    "－2",
    "＠SUM(A1)",
  ])("%j parece fórmula e ganha o apóstrofo na frente", (texto) => {
    expect(pareceFormulaNoCsv(texto)).toBe(true);
    const celula = celulaCsv(texto);
    const lida = celula.startsWith('"')
      ? celula.slice(1, -1).replace(/""/g, '"')
      : celula;
    expect(lida).toBe(`'${texto}`);
  });

  it.each([
    "Célula Ágape",
    "Rede Jovem Ficticia",
    "Célula 2 = Betel",
    "Célula +Vida",
    "Ágape - Jovens",
    "e-mail@não-é-coluna",
    "1º lugar",
    "",
  ])("%j não parece fórmula e não muda", (texto) => {
    expect(pareceFormulaNoCsv(texto)).toBe(false);
    expect(celulaCsv(texto)).toBe(texto);
  });

  it("aspas só quando precisa: separador, aspas, quebra de linha ou espaço nas pontas; aspas internas dobradas", () => {
    expect(celulaCsv("Célula; Betel")).toBe('"Célula; Betel"');
    expect(celulaCsv('Célula "Betel"')).toBe('"Célula ""Betel"""');
    expect(celulaCsv("Célula\nBetel")).toBe('"Célula\nBetel"');
    expect(celulaCsv("Célula\r\nBetel")).toBe('"Célula\r\nBetel"');
    expect(celulaCsv(" Betel")).toBe('" Betel"');
    expect(celulaCsv("Betel ")).toBe('"Betel "');
    expect(celulaCsv("Célula, Betel")).toBe("Célula, Betel");
    // Fórmula com separador: o apóstrofo e as aspas.
    expect(celulaCsv('=HYPERLINK("x";"y")')).toBe(
      '"\'=HYPERLINK(""x"";""y"")"',
    );
  });
});

describe("D23: o arquivo", () => {
  it("BOM do UTF-8, ';' entre as colunas, CRLF no fim de cada linha (também da última)", () => {
    const csv = montarCsvRelatorio(
      ["Período", "Bilhetes", "Arrecadação (R$)"],
      [
        ["Semana 1", formatarInteiroCsv(42), formatarCentavosCsv(84_000)],
        ["Semana 2", formatarInteiroCsv(0), formatarCentavosCsv(0)],
      ],
    );
    expect(csv).toBe(
      "﻿Período;Bilhetes;Arrecadação (R$)\r\n" +
        "Semana 1;42;840,00\r\n" +
        "Semana 2;0;0,00\r\n",
    );
    expect(BOM_UTF8).toBe("﻿");
    expect(SEPARADOR_CSV_RELATORIO).toBe(";");
    expect(FIM_DE_LINHA_CSV_RELATORIO).toBe("\r\n");
    // Em bytes, o BOM é EF BB BF.
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([
      0xef, 0xbb, 0xbf,
    ]);
  });

  it("sem linhas de dados, sai só o cabeçalho (ex.: os dias, antes do início)", () => {
    expect(
      montarCsvRelatorio(cabecalhoDoRelatorio("dias", "bilhetes"), []),
    ).toBe(
      "﻿Data;Dia da campanha;Período;Pedidos aprovados;Bilhetes;Arrecadação (R$)\r\n",
    );
  });

  it("toda célula passa pela proteção, inclusive no cabeçalho", () => {
    const csv = montarCsvRelatorio(["Célula", "Líder"], [["=1+1", "@Maria"]]);
    expect(csv).toBe("﻿Célula;Líder\r\n'=1+1;'@Maria\r\n");
  });

  it("linha com número de células diferente do cabeçalho, ou cabeçalho vazio: erro de programação", () => {
    expect(() => montarCsvRelatorio(["A", "B"], [["1"]])).toThrow(RangeError);
    expect(() => montarCsvRelatorio(["A"], [["1", "2"]])).toThrow(RangeError);
    expect(() => montarCsvRelatorio([], [])).toThrow(RangeError);
  });

  it("um leitor de CSV comum (o do projeto) lê de volta as mesmas células: acentos, ';', aspas, quebra de linha e o apóstrofo", () => {
    const cabecalho = cabecalhoDoRelatorio("celulas", "centavos");
    const linhas = [
      [
        "Jovens",
        "Rede; Sul",
        'Discipulador "Zé"',
        "Célula\nÁgape",
        '=HYPERLINK("x")',
        formatarMetaCsv(720_000, "centavos"),
        formatarInteiroCsv(54),
        formatarInteiroCsv(139),
        formatarCentavosCsv(278_000),
        formatarPercentualBpCsv(3861),
        formatarInteiroCsv(1),
      ],
      [
        "Adultos",
        "Rede Adulta Ficticia",
        "Discipulador Ficticio B",
        "Célula Ficticia 03",
        "Líder Ficticio",
        formatarMetaCsv(0, "centavos"),
        formatarInteiroCsv(0),
        formatarInteiroCsv(0),
        formatarCentavosCsv(0),
        formatarPercentualBpCsv(null),
        formatarInteiroCsv(2),
      ],
    ];
    const lidas = lerArquivo(montarCsvRelatorio(cabecalho, linhas));

    expect(lidas[0]).toEqual(cabecalho);
    expect(lidas.slice(1)).toEqual([
      linhas[0].map((celula, indice) => (indice === 4 ? `'${celula}` : celula)),
      linhas[1],
    ]);
  });
});
