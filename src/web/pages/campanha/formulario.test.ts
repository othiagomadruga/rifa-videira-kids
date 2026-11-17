// Conversões do formulário e mensagens de erro por campo.
import { describe, expect, it } from "vitest";
import { MENSAGENS_PADRAO, PEDIDOS_PADRAO } from "../../../shared/contracts";
import {
  errosDosDetalhes,
  formularioVazio,
  lerInteiro,
  lerPercentual,
  lerReais,
  montarCorpo,
  ordenarChavesDeErro,
  percentualParaTexto,
  periodosDoModeloSantoAndre,
  reaisParaTexto,
  rotuloDoCampo,
  slugDoLink,
  type Formulario,
} from "./formulario";

describe("reais em centavos (sem ponto flutuante)", () => {
  it.each([
    ["20", 2000],
    ["20,5", 2050],
    ["20,50", 2050],
    ["0,10", 10],
    ["1.234,56", 123456],
    ["1.234", 123400],
    ["20.50", 2050],
    ["R$ 20,00", 2000],
    ["R$ 1.000,00", 100000],
    ["0", 0],
  ])("%j → %i", (texto, centavos) => {
    expect(lerReais(texto)).toBe(centavos);
  });

  it.each(["", "abc", "20,555", "1,234,56", "-5", "12.3456", "1.23,45"])(
    "%j não é valor em reais",
    (texto) => {
      expect(lerReais(texto)).toBeNull();
    },
  );

  it("centavos para o campo, sem R$ (o rótulo já diz)", () => {
    expect(reaisParaTexto(2000)).toBe("20,00");
    expect(reaisParaTexto(5)).toBe("0,05");
    expect(reaisParaTexto(123456789)).toBe("1.234.567,89");
  });
});

describe("percentual em pontos-base", () => {
  it.each([
    ["35", 3500],
    ["12,5", 1250],
    ["12.75", 1275],
    ["0", 0],
    ["100", 10_000],
    ["45 %", 4500],
  ])("%j → %i", (texto, pontosBase) => {
    expect(lerPercentual(texto)).toBe(pontosBase);
  });

  it.each(["", "abc", "1000", "12,345", "-1"])(
    "%j não é percentual",
    (texto) => {
      expect(lerPercentual(texto)).toBeNull();
    },
  );

  it("pontos-base para o campo", () => {
    expect(percentualParaTexto(3500)).toBe("35");
    expect(percentualParaTexto(1250)).toBe("12,5");
    expect(percentualParaTexto(1205)).toBe("12,05");
  });
});

describe("inteiros", () => {
  it("aceita dígitos e milhar com ponto; recusa o resto", () => {
    expect(lerInteiro("10")).toBe(10);
    expect(lerInteiro(" 1.000 ")).toBe(1000);
    expect(lerInteiro("7,5")).toBeNull();
    expect(lerInteiro("1.00")).toBeNull();
    expect(lerInteiro("")).toBeNull();
  });
});

describe("montarCorpo", () => {
  function preenchido(): Formulario {
    return {
      ...formularioVazio(),
      nome: " Rifa de teste ",
      slug_rifei: " rifa-teste ",
      data_inicio: "2026-11-23",
      preco: "12,34",
      meta_unidade: "centavos",
      meta_regra: "fixa_por_celula",
      meta_valor: "1.500,00",
      periodos: periodosDoModeloSantoAndre(),
      ranking_criterio: "arrecadacao",
      publico_limite_ranking: "",
    };
  }

  const DO_ADMIN = { regrasDoAdmin: true };

  it("corpo do contrato: espaços tirados, centavos, pontos-base, padrões e limite vazio = todas", () => {
    expect(montarCorpo(preenchido(), DO_ADMIN)).toEqual({
      ok: true,
      corpo: {
        nome: "Rifa de teste",
        slug_rifei: "rifa-teste",
        fuso_horario: "America/Belem",
        data_inicio: "2026-11-23",
        preco_bilhete_centavos: 1234,
        meta: { unidade: "centavos", regra: "fixa_por_celula", valor: 150000 },
        periodos: [
          { nome: "Período 1", dias: 10, percentual_bp: 3500 },
          { nome: "Período 2", dias: 7, percentual_bp: 2500 },
          { nome: "Período 3", dias: 7, percentual_bp: 4500 },
        ],
        ranking: { criterio: "arrecadacao" },
        publico: { mostra_percentual_meta: false, limite_ranking: null },
        // Regras do admin (D20): do admin, os três grupos vão sempre, com o que está no formulário.
        pedidos: { ...PEDIDOS_PADRAO },
        acesso: { discipuladores: true, redes: true },
        mensagens: { ...MENSAGENS_PADRAO },
      },
    });
  });

  it("RIFA-042: da coordenação, o corpo vai sem pedidos, acesso e mensagens (a API mantém o gravado), e um modelo com problema não barra o resto", () => {
    const resultado = montarCorpo(
      {
        ...preenchido(),
        pedidos_desconsiderar: true,
        acesso_redes: false,
        mensagens: { ...MENSAGENS_PADRAO, link_rede: "Oi {nomee}, sem o link" },
      },
      { regrasDoAdmin: false },
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(Object.keys(resultado.corpo)).toEqual([
      "nome",
      "slug_rifei",
      "fuso_horario",
      "data_inicio",
      "preco_bilhete_centavos",
      "meta",
      "periodos",
      "ranking",
      "publico",
    ]);
  });

  it("fuso vazio usa o padrão do contrato", () => {
    const resultado = montarCorpo(
      { ...preenchido(), fuso_horario: " " },
      DO_ADMIN,
    );
    expect(resultado.ok && resultado.corpo.fuso_horario).toBe("America/Belem");
  });

  it("erros de leitura e do contrato juntos, um por campo", () => {
    const resultado = montarCorpo(
      {
        ...preenchido(),
        preco: "0",
        meta_unidade: "bilhetes",
        meta_valor: "10,5",
        periodos: [
          { chave: "a", nome: "  ", dias: "", percentual: "35" },
          { chave: "b", nome: "Período 2", dias: "400", percentual: "x" },
        ],
        publico_limite_ranking: "0",
      },
      DO_ADMIN,
    );

    expect(resultado).toEqual({
      ok: false,
      erros: {
        preco_bilhete_centavos:
          "O preço do bilhete precisa ser maior que zero.",
        "meta.valor": "Use um número inteiro de bilhetes.",
        "periodos.0.nome": "Dê um nome ao período, com até 60 caracteres.",
        "periodos.0.dias": "Informe quantos dias o período dura.",
        "periodos.1.dias": "Use um número inteiro de 1 a 366.",
        "periodos.1.percentual_bp":
          "Use um percentual de 0 a 100, com até 2 casas decimais. Ex.: 35 ou 12,5.",
        "publico.limite_ranking":
          "Use um número inteiro de 1 a 100, ou deixe em branco para mostrar todas.",
      },
    });
  });
});

describe("errosDosDetalhes (formato de detalhes da API)", () => {
  it("troca as mensagens genéricas do zod pela do campo e mantém as próprias do contrato e da API", () => {
    expect(
      errosDosDetalhes([
        { caminho: ["nome"], codigo: "too_big", mensagem: "Too big" },
        { caminho: ["nome"], codigo: "custom", mensagem: "Segundo problema" },
        {
          caminho: ["periodos", 4, "percentual_bp"],
          codigo: "too_big",
          mensagem: "Too big",
        },
        {
          caminho: ["periodos"],
          codigo: "custom",
          mensagem:
            "Pelo menos um período precisa ter percentual maior que zero",
        },
        {
          caminho: ["slug_rifei"],
          codigo: "slug_duplicado",
          mensagem:
            "Este slug já pertence a outra campanha (inativa) do sistema",
        },
        { caminho: ["campo_novo"], codigo: "too_small", mensagem: "Too small" },
      ]),
    ).toEqual({
      nome: "Informe o nome da campanha, com até 120 caracteres.",
      "periodos.4.percentual_bp": "Use um percentual de 0 a 100.",
      periodos: "Pelo menos um período precisa ter percentual maior que zero",
      slug_rifei: "Este slug já pertence a outra campanha (inativa) do sistema",
      campo_novo: "Too small",
    });
  });

  it("rótulos e ordem da lista de erros seguem a tela", () => {
    expect(rotuloDoCampo("periodos.1.dias")).toBe("Dias do período 2");
    expect(rotuloDoCampo("meta.valor")).toBe("Valor da meta");
    expect(
      ordenarChavesDeErro([
        "ranking.criterio",
        "periodos.1.nome",
        "preco_bilhete_centavos",
        "periodos.0.percentual_bp",
        "periodos",
        "campo_novo",
        "nome",
        "periodos.0.dias",
      ]),
    ).toEqual([
      "nome",
      "periodos",
      "periodos.0.dias",
      "periodos.0.percentual_bp",
      "periodos.1.nome",
      "preco_bilhete_centavos",
      "ranking.criterio",
      "campo_novo",
    ]);
  });
});

describe("slugDoLink", () => {
  it.each([
    ["https://rifei.com.br/rifa-teste", "rifa-teste"],
    ["rifei.com.br/rifa-teste/", "rifa-teste"],
    ["https://rifei.com.br/campanha/rifa-teste?ref=12#topo", "rifa-teste"],
  ])("%j → %j", (texto, slug) => {
    expect(slugDoLink(texto)).toBe(slug);
  });

  it.each(["rifa-teste", "https://rifei.com.br", "https://", ""])(
    "%j não sugere nada",
    (texto) => {
      expect(slugDoLink(texto)).toBeNull();
    },
  );
});
