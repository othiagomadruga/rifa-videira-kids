// RIFA-038 (D23): as linhas de cada tipo do relatório, sem banco (lib/relatorio.ts é puro). A entrada é a do cenário
// do painel montada no JS (painel-apoio.ts: entradaEsperada, sem o SQL), e o "agora" é o dia 9 de 21. Os números
// esperados foram conferidos à mão, pedido por pedido, contra o cenário (comentários abaixo). As contas que fecham
// entre os arquivos, a leitura do banco e a rota estão em routes/relatorio.test.ts.
import { describe, expect, it } from "vitest";
import {
  BOM_UTF8,
  COLUNAS_RELATORIO,
  TIPOS_RELATORIO,
  campanhaEntradaSchema,
  cabecalhoDoRelatorio,
  montarRankingPainel,
  montarResumoPainel,
  type CampanhaCalculo,
  type EscopoResolvido,
  type RespostaMapaDdd,
} from "../../shared/contracts";
import { lerCsv } from "../../shared/csv";
import {
  AGORA,
  CAMPANHA,
  DADOS_CAMPANHA,
  entradaEsperada,
} from "../test/painel-apoio";
import {
  arquivoDoDdd,
  arquivoDoPainel,
  linhaDosTotais,
  linhasDasCelulas,
  linhasDoDdd,
  type DadosDoPainel,
  type ExtrasDoRelatorio,
  type MontadoresDoRelatorio,
  type TipoDoPainel,
} from "./relatorio";

const ESCOPO: EscopoResolvido = {
  tipo: "campanha",
  id: null,
  divisao: null,
  nome: "Rifa Videira Kids",
};

const LIDERES = new Map(
  [1, 2, 3, 4, 5].map((id) => [id, `Líder ${id}`] as const),
);
const EXTRAS: ExtrasDoRelatorio = { lideres: LIDERES, desconsiderados: 7 };

function dadosEm(
  agora: Date = AGORA,
  campanha: CampanhaCalculo = CAMPANHA,
): DadosDoPainel {
  return {
    agora,
    entrada: entradaEsperada(campanha),
    escopo: { ...ESCOPO, nome: campanha.nome },
  };
}

const TIPOS_DO_PAINEL = TIPOS_RELATORIO.filter(
  (tipo): tipo is TipoDoPainel => tipo !== "ddd",
);

/** As linhas de um arquivo (sem o cabeçalho), separadas como o arquivo as separa. */
function linhasDoArquivo(csv: string): string[] {
  expect(csv.startsWith(BOM_UTF8)).toBe(true);
  expect(csv.endsWith("\r\n")).toBe(true);
  return csv.slice(BOM_UTF8.length, -2).split("\r\n");
}

/** A campanha do cenário com a meta em R$ (R$ 200,00 por pessoa) e o critério em bilhetes. */
const CAMPANHA_EM_REAIS: CampanhaCalculo = campanhaEntradaSchema.parse({
  ...DADOS_CAMPANHA,
  meta: { unidade: "centavos", regra: "por_pessoa", valor: 20000 },
  ranking: { criterio: "bilhetes" },
});

describe("os 7 tipos: as colunas do contrato, na ordem, nas duas unidades da meta", () => {
  it.each(["bilhetes", "centavos"] as const)(
    "meta em %s: o cabeçalho é o do contrato e toda linha tem uma célula por coluna",
    (unidade) => {
      const campanha = unidade === "bilhetes" ? CAMPANHA : CAMPANHA_EM_REAIS;
      for (const tipo of TIPOS_DO_PAINEL) {
        const { csv, data } = arquivoDoPainel(
          tipo,
          dadosEm(AGORA, campanha),
          EXTRAS,
        );
        const [cabecalho, ...linhas] = linhasDoArquivo(csv);
        expect({ tipo, cabecalho }).toEqual({
          tipo,
          cabecalho: cabecalhoDoRelatorio(tipo, unidade).join(";"),
        });
        expect(data).toBe("2026-12-01");
        const lidas = lerCsv(csv);
        if (!lidas.ok) throw new Error(lidas.mensagem);
        expect(lidas.separador).toBe(";");
        expect(lidas.registros).toHaveLength(linhas.length + 1);
        for (const registro of lidas.registros)
          expect({ tipo, celulas: registro.campos.length }).toEqual({
            tipo,
            celulas: COLUNAS_RELATORIO[tipo].length,
          });
      }
    },
  );

  it("o ddd não depende da unidade (o cabeçalho não tem meta)", () => {
    expect(linhasDoArquivo(arquivoDoDdd(MAPA))[0]).toBe(
      cabecalhoDoRelatorio("ddd", "centavos").join(";"),
    );
  });
});

describe("os números de cada tipo, byte a byte (cenário do painel, dia 9: 01/12/2026)", () => {
  it("totais: o resumo da campanha (vendas até hoje com as sem célula; fora das datas = antes do início)", () => {
    // 25 pedidos / 149 bilhetes / R$ 2.964,00 do dia 1 ao 9 (3 sem célula: 4 + 2 + 1 bilhetes); a meta é 10 × 60
    // pessoas; 149 ÷ 600 = 24,83%; antes do início, 1 + 2 bilhetes. Os 7 desconsiderados vêm dos extras.
    expect(arquivoDoPainel("totais", dadosEm(), EXTRAS).csv).toBe(
      BOM_UTF8 +
        "Campanha;Data de referência;Situação da campanha;Início;Fim;Meta (bilhetes);Pedidos aprovados;Bilhetes;" +
        "Arrecadação (R$);% da meta;Pedidos sem célula;Bilhetes sem célula;Arrecadação sem célula (R$);" +
        "Pedidos fora das datas da campanha;Bilhetes fora das datas da campanha;" +
        "Arrecadação fora das datas da campanha (R$);Pedidos desconsiderados;Critério do ranking\r\n" +
        "Rifa Videira Kids;2026-12-01;Em andamento;2026-11-23;2026-12-13;600;25;149;2964,00;24,83;3;7;140,00;2;3;" +
        "60,00;7;% da meta\r\n",
    );
  });

  it("totais com a meta em R$: Meta (R$) em reais e o % da meta sobre a arrecadação", () => {
    // Meta: 60 pessoas × R$ 200,00 = R$ 12.000,00; 2.964 ÷ 12.000 = 24,70%.
    const [cabecalho, linha] = linhasDoArquivo(
      arquivoDoPainel("totais", dadosEm(AGORA, CAMPANHA_EM_REAIS), EXTRAS).csv,
    );
    expect(cabecalho.split(";")[5]).toBe("Meta (R$)");
    expect(linha).toBe(
      "Rifa Videira Kids;2026-12-01;Em andamento;2026-11-23;2026-12-13;12000,00;25;149;2964,00;24,70;3;7;140,00;2;3;" +
        "60,00;7;Bilhetes",
    );
  });

  it("celulas: por divisão (jovens, depois adultos), na ordem do ranking da divisão, com o nome do líder", () => {
    // Ágape 48/120 = 40%, Betel 18/60 = 30%, Canaã 24/120 = 20%; Dorcas 47/200 = 23,5% (com o desconto de 8 × R$ 18),
    // Éfeso 5/100 = 5%.
    expect(
      linhasDoArquivo(arquivoDoPainel("celulas", dadosEm(), EXTRAS).csv),
    ).toEqual([
      "Divisão;Rede;Discipulador;Célula;Líder;Meta (bilhetes);Pedidos aprovados;Bilhetes;Arrecadação (R$);% da meta;Posição na divisão",
      "Jovens;Rede Jovem Ficticia;Discipulador Abel;Célula Ágape;Líder 1;120;9;48;960,00;40,00;1",
      "Jovens;Rede Jovem Ficticia;Discipulador Abel;Célula Betel;Líder 2;60;4;18;360,00;30,00;2",
      "Jovens;Rede Jovem Ficticia;Discipulador Boaz;Célula Canaã;Líder 3;120;3;24;480,00;20,00;3",
      "Adultos;Rede Adulta Ficticia;Discipulador Caleb;Célula Dorcas;Líder 4;200;5;47;924,00;23,50;1",
      "Adultos;Rede Adulta Ficticia;Discipulador Caleb;Célula Éfeso;Líder 5;100;1;5;100,00;5,00;2",
    ]);
  });

  it("discipuladores e redes: só os com célula (Davi não aparece); % truncado (66/180 = 36,66%)", () => {
    expect(
      linhasDoArquivo(arquivoDoPainel("discipuladores", dadosEm(), EXTRAS).csv),
    ).toEqual([
      "Divisão;Rede;Discipulador;Meta (bilhetes);Pedidos aprovados;Bilhetes;Arrecadação (R$);% da meta;Posição na divisão",
      "Jovens;Rede Jovem Ficticia;Discipulador Abel;180;13;66;1320,00;36,66;1",
      "Jovens;Rede Jovem Ficticia;Discipulador Boaz;120;3;24;480,00;20,00;2",
      "Adultos;Rede Adulta Ficticia;Discipulador Caleb;300;6;52;1024,00;17,33;1",
    ]);
    expect(
      linhasDoArquivo(arquivoDoPainel("redes", dadosEm(), EXTRAS).csv),
    ).toEqual([
      "Divisão;Rede;Meta (bilhetes);Pedidos aprovados;Bilhetes;Arrecadação (R$);% da meta;Posição na divisão",
      "Jovens;Rede Jovem Ficticia;300;16;90;1800,00;30,00;1",
      "Adultos;Rede Adulta Ficticia;300;6;52;1024,00;17,33;1",
    ]);
  });

  it("periodos e dias: só os já começados, até hoje (o de hoje, parcial), com as sem célula", () => {
    expect(
      linhasDoArquivo(arquivoDoPainel("periodos", dadosEm(), EXTRAS).csv),
    ).toEqual([
      "Período;Início;Fim;Pedidos aprovados;Bilhetes;Arrecadação (R$)",
      "Semana 1;2026-11-23;2026-11-29;18;118;2344,00",
      "Semana 2;2026-11-30;2026-12-06;7;31;620,00",
    ]);
    expect(
      linhasDoArquivo(arquivoDoPainel("dias", dadosEm(), EXTRAS).csv),
    ).toEqual([
      "Data;Dia da campanha;Período;Pedidos aprovados;Bilhetes;Arrecadação (R$)",
      // A largada às 03:00Z é do dia 1; a véspera às 02:59:59.999Z fica fora (nos totais, "fora das datas").
      "2026-11-23;1;Semana 1;3;29;580,00",
      "2026-11-24;2;Semana 1;3;21;420,00",
      "2026-11-25;3;Semana 1;3;14;280,00",
      "2026-11-26;4;Semana 1;3;16;320,00",
      "2026-11-27;5;Semana 1;2;11;220,00",
      "2026-11-28;6;Semana 1;3;21;404,00",
      // 30/11 02:59:59.999Z ainda é 29/11 em Belém (dia 7); 03:00Z já é o dia 8.
      "2026-11-29;7;Semana 1;1;6;120,00",
      "2026-11-30;8;Semana 2;3;17;340,00",
      "2026-12-01;9;Semana 2;4;14;280,00",
    ]);
  });

  it("antes do início: períodos e dias só com o cabeçalho; depois do fim: todos, e o período da última semana inteiro", () => {
    const antes = dadosEm(new Date("2026-11-22T15:00:00.000Z"));
    expect(
      linhasDoArquivo(arquivoDoPainel("periodos", antes, EXTRAS).csv),
    ).toHaveLength(1);
    expect(
      linhasDoArquivo(arquivoDoPainel("dias", antes, EXTRAS).csv),
    ).toHaveLength(1);
    expect(
      linhasDoArquivo(arquivoDoPainel("totais", antes, EXTRAS).csv)[1],
    ).toMatch(/^Rifa Videira Kids;2026-11-22;Antes do início;/);

    const depois = dadosEm(new Date("2026-12-20T15:00:00.000Z"));
    const periodos = linhasDoArquivo(
      arquivoDoPainel("periodos", depois, EXTRAS).csv,
    );
    expect(periodos.slice(1).map((linha) => linha.split(";")[0])).toEqual([
      "Semana 1",
      "Semana 2",
      "Semana 3",
    ]);
    const dias = linhasDoArquivo(arquivoDoPainel("dias", depois, EXTRAS).csv);
    expect(dias).toHaveLength(1 + 21);
    // O último dia (13/12) tem a venda de 02:59:59.999Z do dia 14 em UTC; a de 03:00Z é depois do fim.
    expect(dias.at(-1)).toBe("2026-12-13;21;Semana 3;1;3;60,00");
    // Encerrada: 28 pedidos / 171 bilhetes (171 ÷ 600 = 28,50%); fora das datas, os 2 de antes do início e o de
    // 14/12 00:00 em Belém (4 bilhetes).
    expect(
      linhasDoArquivo(arquivoDoPainel("totais", depois, EXTRAS).csv)[1],
    ).toBe(
      "Rifa Videira Kids;2026-12-20;Encerrada;2026-11-23;2026-12-13;600;28;171;3404,00;28,50;3;7;140,00;3;7;140,00;7;" +
        "% da meta",
    );
  });
});

/** Um mapa do contrato montado à mão (a ordem é a do mapa: UFs e DDDs pelos bilhetes). */
const MAPA: RespostaMapaDdd = {
  janela: {
    tipo: "campanha",
    ordem: null,
    nome: "Campanha inteira",
    data_inicio: "2026-11-23",
    data_fim: "2026-12-13",
  },
  divisao: null,
  ufs: [
    {
      uf: "PA",
      pedidos_aprovados: 12,
      bilhetes: 72,
      total_centavos: 144000,
      parte_bilhetes_bp: 4832,
    },
    {
      uf: "SP",
      pedidos_aprovados: 4,
      bilhetes: 18,
      total_centavos: 36000,
      parte_bilhetes_bp: 1208,
    },
  ],
  ddds: [
    {
      ddd: "91",
      uf: "PA",
      pedidos_aprovados: 10,
      bilhetes: 60,
      total_centavos: 120000,
      parte_bilhetes_bp: 4026,
    },
    {
      ddd: "94",
      uf: "PA",
      pedidos_aprovados: 2,
      bilhetes: 12,
      total_centavos: 24000,
      parte_bilhetes_bp: 805,
    },
    {
      ddd: "11",
      uf: "SP",
      pedidos_aprovados: 4,
      bilhetes: 18,
      total_centavos: 36000,
      parte_bilhetes_bp: 1208,
    },
  ],
  exterior: {
    pedidos_aprovados: 0,
    bilhetes: 0,
    total_centavos: 0,
    parte_bilhetes_bp: 0,
  },
  sem_ddd: {
    pedidos_aprovados: 9,
    bilhetes: 59,
    total_centavos: 118005,
    parte_bilhetes_bp: 3959,
  },
  total: {
    pedidos_aprovados: 25,
    bilhetes: 149,
    total_centavos: 298005,
    parte_bilhetes_bp: 10000,
  },
  atualizado_em: "2026-12-01T15:00:00.000Z",
};

describe("ddd: o mapa, na ordem dele, mais Exterior e Sem DDD (sempre, mesmo zeradas)", () => {
  it("uma linha por DDD com a UF, e as duas linhas sem DDD com a coluna vazia", () => {
    expect(linhasDoArquivo(arquivoDoDdd(MAPA))).toEqual([
      "UF;DDD;Pedidos aprovados;Bilhetes;Arrecadação (R$);% dos bilhetes",
      "PA;91;10;60;1200,00;40,26",
      "PA;94;2;12;240,00;8,05",
      "SP;11;4;18;360,00;12,08",
      "Exterior;;0;0;0,00;0,00",
      "Sem DDD;;9;59;1180,05;39,59",
    ]);
    // Sem nenhuma venda: só as duas linhas fixas.
    expect(
      linhasDoDdd({ ...MAPA, ufs: [], ddds: [] }).map((linha) => linha[0]),
    ).toEqual(["Exterior", "Sem DDD"]);
  });
});

describe("as fontes: os montadores do painel, uma chamada por divisão nos rankings", () => {
  it("totais chama o resumo uma vez; os três níveis, o ranking duas vezes (jovens e adultos) na campanha inteira; períodos e dias, nenhum", () => {
    for (const tipo of TIPOS_DO_PAINEL) {
      const chamadas: string[] = [];
      const montadores: MontadoresDoRelatorio = {
        montarResumoPainel: (entrada, consulta, agora) => {
          chamadas.push(`resumo ${consulta.escopo.tipo}`);
          return montarResumoPainel(entrada, consulta, agora);
        },
        montarRankingPainel: (entrada, consulta, agora) => {
          chamadas.push(
            `ranking ${consulta.nivel} ${consulta.divisao} ${consulta.periodo}`,
          );
          return montarRankingPainel(entrada, consulta, agora);
        },
      };
      arquivoDoPainel(tipo, dadosEm(), EXTRAS, montadores);
      const nivel = {
        celulas: "celula",
        discipuladores: "discipulador",
        redes: "rede",
      } as const;
      expect({ tipo, chamadas }).toEqual({
        tipo,
        chamadas:
          tipo === "totais"
            ? ["resumo campanha"]
            : tipo in nivel
              ? [
                  `ranking ${nivel[tipo as keyof typeof nivel]} jovens campanha`,
                  `ranking ${nivel[tipo as keyof typeof nivel]} adultos campanha`,
                ]
              : [],
      });
    }
  });

  it("faltar o extra do tipo (a contagem em totais, os líderes em celulas) é erro de programação", () => {
    const vazio: ExtrasDoRelatorio = { lideres: null, desconsiderados: null };
    expect(() => arquivoDoPainel("totais", dadosEm(), vazio)).toThrow(
      RangeError,
    );
    expect(() => arquivoDoPainel("celulas", dadosEm(), vazio)).toThrow(
      RangeError,
    );
    expect(() => linhasDasCelulas(dadosEm(), new Map())).toThrow(RangeError);
    for (const tipo of ["discipuladores", "redes", "periodos", "dias"] as const)
      expect(() => arquivoDoPainel(tipo, dadosEm(), vazio)).not.toThrow();
    // Contagem negativa não existe: o formatador recusa.
    expect(() => linhaDosTotais(dadosEm(), -1)).toThrow(RangeError);
  });
});
