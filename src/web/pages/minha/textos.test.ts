// Textos da visão individual: concordância (1 bilhete, 2 bilhetes), a meta de hoje com e sem quantidades
// (meta em bilhetes ou em centavos), a situação em cada fase, as frases do ranking e nenhum dinheiro.
import { describe, expect, it } from "vitest";
import type {
  MetaDoDiaIndividual,
  ReferenciaCampanha,
  RitmoIndividual,
} from "../../../shared/contracts/api";
import { REFERENCIAS } from "./teste-apoio";
import {
  bilhetes,
  emBilhetes,
  fraseSemCelulas,
  fraseSemVendas,
  situacaoDaCampanha,
  situacaoDoPeriodo,
  textoDaFase,
  textoDaJanela,
  textoDaMetaAntes,
  textoDaProjecao,
  textoDeHoje,
  textoDoVizinho,
  textoDosPares,
  tituloSemAdesao,
  type RitmoDaCampanha,
} from "./textos";

const DURANTE = REFERENCIAS.durante;
const PRIMEIRO_DIA: ReferenciaCampanha = {
  ...DURANTE,
  data: "2026-11-23",
  dia_campanha: 1,
  dias_restantes: 24,
  periodo: {
    ordem: 1,
    nome: "Semana 1",
    data_inicio: "2026-11-23",
    data_fim: "2026-12-02",
    dias: 10,
    dia_no_periodo: 1,
    dias_restantes: 10,
  },
};
const ULTIMO_DIA: ReferenciaCampanha = {
  ...DURANTE,
  data: "2026-12-16",
  dia_campanha: 24,
  dias_restantes: 1,
};

const hoje = (dados: Partial<MetaDoDiaIndividual>): MetaDoDiaIndividual => ({
  data: "2026-12-04",
  meta: 9,
  realizado: 2,
  falta: 7,
  percentual_meta_bp: 2222,
  batida: false,
  ...dados,
});

const ritmo = (dados: Partial<RitmoDaCampanha>): RitmoDaCampanha => ({
  meta: 120,
  esperado: 45,
  realizado: 42,
  diferenca: -3,
  situacao: "abaixo",
  percentual_meta_bp: 3500,
  percentual_esperado_bp: 3673,
  projecao_percentual_meta_bp: 9074,
  ...dados,
});

const EM_CENTAVOS = {
  meta: null,
  esperado: null,
  realizado: null,
  diferenca: null,
} as const;

describe("quantidades: só em bilhetes", () => {
  it("concordância e a quantidade da meta só com a meta em bilhetes", () => {
    expect(bilhetes(1)).toBe("1 bilhete");
    expect(bilhetes(0)).toBe("0 bilhetes");
    expect(bilhetes(1234)).toBe("1.234 bilhetes");
    expect(emBilhetes(42, "bilhetes")).toBe(42);
    // Com a meta em centavos, um número que chegasse seria dinheiro: nunca é mostrado.
    expect(emBilhetes(4200, "centavos")).toBeNull();
    expect(emBilhetes(null, "bilhetes")).toBeNull();
  });
});

describe("fase e destaque", () => {
  it("antes: contagem regressiva (véspera: amanhã); durante: o dia; encerrada", () => {
    expect(textoDaFase(REFERENCIAS.antes)).toEqual({
      destaque: "Faltam 3 dias para começar",
      detalhe: "As vendas vão de 23/11/2026 a 16/12/2026.",
    });
    expect(
      textoDaFase({ ...REFERENCIAS.antes, dias_para_inicio: 1 }).destaque,
    ).toBe("As vendas começam amanhã");
    expect(textoDaFase(DURANTE)).toEqual({
      destaque: "Dia 12 de 24",
      detalhe: "Faltam 13 dias, contando hoje (até 16/12/2026).",
    });
    expect(textoDaFase(ULTIMO_DIA).detalhe).toBe(
      "Hoje é o último dia da campanha (16/12/2026).",
    );
    expect(textoDaFase(REFERENCIAS.encerrada)).toEqual({
      destaque: "Campanha encerrada",
      detalhe: "Terminou em 16/12/2026.",
    });
  });

  it("a meta antes do início só aparece em bilhetes", () => {
    expect(textoDaMetaAntes(ritmo({}), "bilhetes")).toBe(
      "Meta da campanha: 120 bilhetes.",
    );
    expect(textoDaMetaAntes(ritmo(EM_CENTAVOS), "centavos")).toBeNull();
    expect(textoDaMetaAntes(ritmo({ meta: 0 }), "bilhetes")).toBeNull();
  });
});

describe("meta de hoje", () => {
  it("em bilhetes: quanto falta, a meta e o vendido (com o singular)", () => {
    expect(textoDeHoje(hoje({}), 2, "bilhetes")).toEqual({
      destaque: "Faltam 7 bilhetes hoje",
      detalhe: "Meta de hoje: 9 bilhetes; vendidos hoje: 2.",
      batida: false,
    });
    expect(
      textoDeHoje(hoje({ realizado: 8, falta: 1 }), 8, "bilhetes").destaque,
    ).toBe("Falta 1 bilhete hoje");
    expect(
      textoDeHoje(
        hoje({
          realizado: 10,
          falta: 0,
          batida: true,
          percentual_meta_bp: 11111,
        }),
        10,
        "bilhetes",
      ),
    ).toEqual({
      destaque: "Meta de hoje batida",
      detalhe: "Meta de hoje: 9 bilhetes; vendidos hoje: 10.",
      batida: true,
    });
  });

  it("alvo sem meta na campanha: 'Sem meta hoje' e os bilhetes vendidos, nunca 'coberta' (nos dois casos)", () => {
    const semMetaNoDia = {
      meta: 0,
      realizado: 0,
      falta: 0,
      batida: true,
      percentual_meta_bp: null,
    };
    expect(textoDeHoje(hoje(semMetaNoDia), 2, "bilhetes", true)).toEqual({
      destaque: "Sem meta hoje",
      detalhe: "Vendidos hoje: 2 bilhetes.",
      batida: false,
    });
    expect(
      textoDeHoje(
        hoje({ ...semMetaNoDia, meta: null, realizado: null, falta: null }),
        1,
        "centavos",
        true,
      ),
    ).toEqual({
      destaque: "Sem meta hoje",
      detalhe: "Vendidos hoje: 1 bilhete.",
      batida: false,
    });
  });

  it("meta de hoje zero (o que sobrou até ontem cobre o dia): coberta, nos dois casos", () => {
    const coberta = {
      destaque: "Meta de hoje já coberta",
      batida: true,
    };
    expect(
      textoDeHoje(
        hoje({ meta: 0, falta: 0, batida: true, percentual_meta_bp: null }),
        3,
        "bilhetes",
      ),
    ).toMatchObject(coberta);
    expect(
      textoDeHoje(
        hoje({
          meta: null,
          realizado: null,
          falta: null,
          batida: true,
          percentual_meta_bp: null,
        }),
        3,
        "centavos",
      ),
    ).toEqual({
      ...coberta,
      detalhe:
        "O que foi vendido até ontem já cobre a curva de hoje. Vendidos hoje: 3 bilhetes.",
    });
  });

  it("com a meta em centavos: só o percentual (e os bilhetes vendidos, que não são dinheiro)", () => {
    const semQuantidades = { meta: null, realizado: null, falta: null };
    expect(textoDeHoje(hoje(semQuantidades), 2, "centavos")).toEqual({
      destaque: "22% da meta de hoje",
      detalhe: "Vendidos hoje: 2 bilhetes.",
      batida: false,
    });
    expect(
      textoDeHoje(
        hoje({ ...semQuantidades, batida: true, percentual_meta_bp: 12000 }),
        1,
        "centavos",
      ),
    ).toEqual({
      destaque: "Meta de hoje batida",
      detalhe: "120% da meta de hoje. Vendidos hoje: 1 bilhete.",
      batida: true,
    });
  });
});

describe("situação, projeção e período", () => {
  it("durante, em bilhetes: em dia (acima ou no esperado) e abaixo (com o singular)", () => {
    expect(
      situacaoDaCampanha(
        ritmo({ diferenca: 6, situacao: "em_dia" }),
        DURANTE,
        "bilhetes",
      ),
    ).toEqual({
      tom: "sucesso",
      titulo: "Em dia",
      detalhe: "6 bilhetes acima do esperado até ontem",
    });
    expect(
      situacaoDaCampanha(
        ritmo({ diferenca: 0, situacao: "em_dia" }),
        DURANTE,
        "bilhetes",
      )?.detalhe,
    ).toBe("Exatamente no esperado até ontem");
    expect(
      situacaoDaCampanha(ritmo({ diferenca: -1 }), DURANTE, "bilhetes"),
    ).toEqual({
      tom: "alerta",
      icone: "caiu",
      titulo: "Abaixo do esperado",
      detalhe: "Falta 1 bilhete para o esperado até ontem",
    });
  });

  it("com a meta em centavos: a comparação em percentual", () => {
    expect(
      situacaoDaCampanha(ritmo(EM_CENTAVOS), DURANTE, "centavos")?.detalhe,
    ).toBe("35% da meta; a curva esperava 36% até ontem");
  });

  it("antes: nenhuma situação; 1º dia: neutra; sem meta: neutra", () => {
    expect(situacaoDaCampanha(ritmo({}), REFERENCIAS.antes, "bilhetes")).toBe(
      null,
    );
    expect(
      situacaoDaCampanha(ritmo({}), PRIMEIRO_DIA, "bilhetes"),
    ).toMatchObject({ tom: "neutro", titulo: "1º dia de vendas" });
    expect(
      situacaoDaCampanha(
        ritmo({ situacao: "sem_meta", percentual_meta_bp: null }),
        DURANTE,
        "bilhetes",
      ),
    ).toMatchObject({ tom: "neutro", titulo: "Sem meta" });
  });

  it("depois do fim: meta batida ou abaixo da meta (em bilhetes e em percentual)", () => {
    const encerrada = REFERENCIAS.encerrada;
    expect(
      situacaoDaCampanha(
        ritmo({ diferenca: 6, situacao: "em_dia", percentual_meta_bp: 10500 }),
        encerrada,
        "bilhetes",
      ),
    ).toMatchObject({
      titulo: "Meta batida",
      detalhe: "6 bilhetes acima da meta",
    });
    expect(
      situacaoDaCampanha(ritmo({ diferenca: -1 }), encerrada, "bilhetes")
        ?.detalhe,
    ).toBe("Faltou 1 bilhete para a meta");
    expect(
      situacaoDaCampanha(ritmo({ diferenca: -12 }), encerrada, "bilhetes")
        ?.detalhe,
    ).toBe("Faltaram 12 bilhetes para a meta");
    expect(
      situacaoDaCampanha(
        ritmo({ ...EM_CENTAVOS, percentual_meta_bp: 8700 }),
        encerrada,
        "centavos",
      ),
    ).toMatchObject({
      titulo: "Abaixo da meta",
      detalhe: "Resultado: 87% da meta",
    });
  });

  it("projeção só durante, quando existe", () => {
    expect(textoDaProjecao(ritmo({}), DURANTE)).toBe(
      "No ritmo atual, chega a 90% da meta até 16/12/2026.",
    );
    expect(
      textoDaProjecao(ritmo({ projecao_percentual_meta_bp: null }), DURANTE),
    ).toBeNull();
    expect(textoDaProjecao(ritmo({}), REFERENCIAS.encerrada)).toBeNull();
  });

  it("1º dia do período: neutra", () => {
    const periodo: RitmoIndividual = ritmo({});
    const info = PRIMEIRO_DIA.periodo;
    if (!info) throw new Error("sem período");
    expect(situacaoDoPeriodo(periodo, info, "bilhetes")).toMatchObject({
      tom: "neutro",
      titulo: "1º dia de Semana 1",
    });
  });
});

describe("ranking", () => {
  it("a janela: o período, a campanha inteira e, depois do fim, o resultado final", () => {
    const semana = {
      tipo: "atual",
      ordem: 2,
      nome: "Semana 2",
      data_inicio: "2026-12-03",
      data_fim: "2026-12-09",
    } as const;
    const campanha = {
      tipo: "campanha",
      ordem: null,
      nome: "Campanha inteira",
      data_inicio: "2026-11-23",
      data_fim: "2026-12-16",
    } as const;
    expect(textoDaJanela(semana, DURANTE)).toBe("Semana 2 · 03/12 a 09/12");
    expect(textoDaJanela(campanha, DURANTE)).toBe("Campanha inteira");
    expect(textoDaJanela(campanha, REFERENCIAS.encerrada)).toBe(
      "Resultado final da campanha",
    );
  });

  it("os pares de cada nível, na divisão e no geral", () => {
    expect(textoDosPares("celula", "jovens")).toBe(
      "Entre as células dos Jovens",
    );
    expect(textoDosPares("discipulador", "adultos")).toBe(
      "Entre os discipuladores dos Adultos",
    );
    expect(textoDosPares("rede", null)).toBe(
      "Entre todas as redes, jovens e adultos",
    );
    expect(textoDosPares("discipulador", null)).toBe(
      "Entre todos os discipuladores, jovens e adultos",
    );
  });

  it("o vizinho: só o nome e a posição, nunca a distância", () => {
    expect(
      textoDoVizinho({ nome: "Célula Betel", posicao: 1, diferenca: null }),
    ).toBe("Célula Betel (1º)");
    // Mesmo que a distância um dia venha preenchida (o PO pode liberar), ela não aparece aqui.
    expect(
      textoDoVizinho({ nome: "Célula Betel", posicao: 1, diferenca: 250 }),
    ).toBe("Célula Betel (1º)");
    expect(textoDoVizinho(null)).toBe("Ninguém");
  });

  it("frases no lugar da posição: incentivo antes da 1ª venda e alvo sem células", () => {
    expect(fraseSemVendas("celula", REFERENCIAS.antes)).toBe(
      "As vendas começam em 23/11/2026: a primeira venda já coloca a sua célula na disputa. Compartilhe o seu link de afiliado com amigos e familiares!",
    );
    expect(fraseSemVendas("discipulador", DURANTE)).toBe(
      "Falta só a primeira venda para você entrar na disputa. Anime os líderes das suas células!",
    );
    expect(fraseSemVendas("rede", DURANTE)).toBe(
      "Falta só a primeira venda para a sua rede entrar na disputa. Anime os discipuladores e os líderes da rede!",
    );
    expect(fraseSemVendas("celula", REFERENCIAS.encerrada)).toBe(
      "A sua célula não teve vendas nesta campanha.",
    );
    expect(fraseSemCelulas("discipulador")).toMatch(
      /^Ainda não há células ligadas a você/,
    );
    expect(fraseSemCelulas("rede")).toMatch(/^Ainda não há células nesta rede/);
  });

  it("quem ainda não aderiu: singular e plural", () => {
    expect(tituloSemAdesao(1)).toBe("1 célula ainda não aderiu");
    expect(tituloSemAdesao(3)).toBe("3 células ainda não aderiram");
  });
});
