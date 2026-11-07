import { describe, expect, it } from "vitest";
import { CENARIOS, resumoDoCenario } from "./teste-apoio";
import {
  contagem,
  dataCurta,
  descricaoDaCurva,
  explicacaoDaMetaDoDia,
  faltam,
  quantidade,
  situacaoDaCampanha,
  situacaoDaJanela,
  situacaoDoPeriodo,
  textoDaFase,
  textoDaProjecao,
  textoDasVendas,
  textoDosTotais,
  textoSemVendas,
  valorCurto,
  valorDoEixo,
} from "./textos";

// O Intl põe um espaço não separável depois de "R$".
const reais = (texto: string) => texto.replace(/\u00a0/g, " ");

describe("unidade da meta", () => {
  it("bilhetes com singular e plural; centavos em R$", () => {
    expect(quantidade(1, "bilhetes")).toBe("1 bilhete");
    expect(quantidade(1234, "bilhetes")).toBe("1.234 bilhetes");
    expect(quantidade(0, "bilhetes")).toBe("0 bilhetes");
    expect(reais(quantidade(20_980, "centavos"))).toBe("R$ 209,80");
    expect(contagem(1, "dia", "dias")).toBe("1 dia");
    expect(faltam(1, "bilhetes")).toBe("Falta 1 bilhete");
    expect(faltam(39, "bilhetes")).toBe("Faltam 39 bilhetes");
    expect(reais(faltam(100, "centavos"))).toBe("Faltam R$ 1,00");
  });

  it("no gráfico: o número sozinho (bilhetes) ou R$; no eixo, R$ sem os centavos", () => {
    expect(valorCurto(1234, "bilhetes")).toBe("1.234");
    expect(reais(valorCurto(278_000, "centavos"))).toBe("R$ 2.780,00");
    expect(valorDoEixo(400, "bilhetes")).toBe("400");
    expect(reais(valorDoEixo(2_000_000, "centavos"))).toBe("R$ 20.000");
    expect(reais(valorDoEixo(0, "centavos"))).toBe("R$ 0");
    expect(dataCurta("2026-12-04")).toBe("04/12");
  });
});

describe("CA1: fase, dia e período", () => {
  it("durante: dia N de T, o período e quanto falta dele; e quanto falta da campanha", () => {
    expect(textoDaFase(resumoDoCenario(CENARIOS.emDia).referencia)).toEqual({
      titulo: "Dia 12 de 24 · Semana 2 (faltam 6 dias)",
      partes: ["Dia 12 de 24", "Semana 2 (faltam 6 dias)"],
      detalhe: "Faltam 13 dias, contando hoje (até 16/12/2026).",
    });
  });

  it("último dia do período e da campanha", () => {
    expect(textoDaFase(resumoDoCenario(CENARIOS.ultimoDia).referencia)).toEqual(
      {
        titulo: "Dia 24 de 24 · Semana 3 (último dia)",
        partes: ["Dia 24 de 24", "Semana 3 (último dia)"],
        detalhe: "Hoje é o último dia da campanha (16/12/2026).",
      },
    );
  });

  it("antes: contagem regressiva (amanhã na véspera)", () => {
    expect(textoDaFase(resumoDoCenario(CENARIOS.antes).referencia)).toEqual({
      titulo: "A campanha começa em 3 dias",
      partes: ["A campanha começa em 3 dias"],
      detalhe: "De 23/11/2026 a 16/12/2026: 24 dias de vendas.",
    });
    expect(
      textoDaFase(resumoDoCenario(CENARIOS.vespera).referencia).titulo,
    ).toBe("A campanha começa amanhã");
  });

  it("encerrada", () => {
    expect(textoDaFase(resumoDoCenario(CENARIOS.encerrada).referencia)).toEqual(
      {
        titulo: "Campanha encerrada",
        partes: ["Campanha encerrada"],
        detalhe: "Foi de 23/11/2026 a 16/12/2026 (24 dias de vendas).",
      },
    );
  });
});

describe("CA2: situação, meta do dia e projeção", () => {
  it("em dia e abaixo, com a diferença na unidade da meta", () => {
    const emDia = resumoDoCenario(CENARIOS.emDia);
    expect(situacaoDaCampanha(emDia)).toEqual({
      tom: "sucesso",
      titulo: "Em dia",
      detalhe: "6 bilhetes acima do esperado até ontem",
    });
    const abaixo = resumoDoCenario(CENARIOS.abaixo);
    expect(situacaoDaCampanha(abaixo)).toEqual({
      tom: "alerta",
      icone: "↓",
      titulo: "Abaixo do esperado",
      detalhe: "Faltam 39 bilhetes para o esperado até ontem",
    });
    expect(
      reais(situacaoDaCampanha(resumoDoCenario(CENARIOS.emReais)).detalhe),
    ).toBe("R$ 135,10 acima do esperado até ontem");
  });

  it("exatamente no esperado e sem meta", () => {
    const ritmo = resumoDoCenario(CENARIOS.emDia).campanha;
    expect(
      situacaoDaJanela({ ...ritmo, diferenca: 0 }, "bilhetes").detalhe,
    ).toBe("Exatamente no esperado até ontem");
    expect(
      situacaoDaJanela({ ...ritmo, situacao: "sem_meta" }, "bilhetes"),
    ).toMatchObject({ tom: "neutro", titulo: "Sem meta" });
  });

  it("1º dia da campanha e do período: neutro (ainda não há dia fechado para comparar)", () => {
    const resumo = resumoDoCenario(CENARIOS.primeiroDia);
    expect(situacaoDaCampanha(resumo)).toMatchObject({
      tom: "neutro",
      titulo: "1º dia de vendas",
    });
    const { periodo, referencia } = resumo;
    if (!periodo || !referencia.periodo) throw new Error("sem período");
    expect(
      situacaoDoPeriodo(periodo, referencia.periodo, "bilhetes"),
    ).toMatchObject({ tom: "neutro", titulo: "1º dia de Semana 1" });
  });

  it("antes do início e encerrada (meta batida ou não)", () => {
    expect(situacaoDaCampanha(resumoDoCenario(CENARIOS.antes))).toEqual({
      tom: "neutro",
      titulo: "Ainda não começou",
      detalhe: "Meta: 360 bilhetes",
    });
    const encerrada = resumoDoCenario(CENARIOS.encerrada);
    expect(situacaoDaCampanha(encerrada)).toEqual({
      tom: "sucesso",
      titulo: "Meta batida",
      detalhe: "27 bilhetes acima da meta",
    });
    const faltou = {
      ...encerrada,
      campanha: {
        ...encerrada.campanha,
        realizado: 359,
        diferenca: -1,
        situacao: "abaixo" as const,
      },
    };
    expect(situacaoDaCampanha(faltou)).toMatchObject({
      tom: "alerta",
      titulo: "Abaixo da meta",
      detalhe: "Faltou 1 bilhete para a meta",
    });
  });

  it("meta do dia: a parte da curva, mais o que faltou ou menos o que sobrou até ontem", () => {
    const emDia = resumoDoCenario(CENARIOS.emDia);
    if (!emDia.hoje) throw new Error("sem hoje");
    expect(explicacaoDaMetaDoDia(emDia.hoje, "bilhetes", false)).toBe(
      "12 bilhetes da curva de hoje − 1 bilhete que sobrou até ontem.",
    );
    expect(
      explicacaoDaMetaDoDia({ ...emDia.hoje, meta: 55 }, "bilhetes", false),
    ).toBe(
      "12 bilhetes da curva de hoje + 43 bilhetes que faltaram até ontem.",
    );
    expect(
      explicacaoDaMetaDoDia({ ...emDia.hoje, meta: 13 }, "bilhetes", false),
    ).toBe("12 bilhetes da curva de hoje + 1 bilhete que faltou até ontem.");
    expect(
      explicacaoDaMetaDoDia({ ...emDia.hoje, meta: 12 }, "bilhetes", false),
    ).toBe("É a parte da curva de hoje.");
    expect(
      explicacaoDaMetaDoDia({ ...emDia.hoje, meta: 0 }, "bilhetes", false),
    ).toBe("O que sobrou até ontem já cobre a curva de hoje (12 bilhetes).");
    expect(explicacaoDaMetaDoDia(emDia.hoje, "bilhetes", true)).toBe(
      "Último dia: a meta de hoje é tudo o que falta para a meta da campanha.",
    );
    expect(
      explicacaoDaMetaDoDia({ ...emDia.hoje, meta: 0 }, "bilhetes", true),
    ).toBe("Último dia: a meta da campanha já foi alcançada até ontem.");
    const emReais = resumoDoCenario(CENARIOS.emReais);
    if (!emReais.hoje) throw new Error("sem hoje");
    expect(reais(explicacaoDaMetaDoDia(emReais.hoje, "centavos", false))).toBe(
      "R$ 244,90 da curva de hoje − R$ 35,10 que sobraram até ontem.",
    );
  });

  it("projeção: no ritmo atual; sem projeção no 1º dia e antes; o resultado depois do fim", () => {
    expect(textoDaProjecao(resumoDoCenario(CENARIOS.emDia))).toBe(
      "No ritmo atual, chega a 101% da meta (364 bilhetes).",
    );
    expect(textoDaProjecao(resumoDoCenario(CENARIOS.abaixo))).toBe(
      "No ritmo atual, chega a 68% da meta (245 bilhetes).",
    );
    expect(textoDaProjecao(resumoDoCenario(CENARIOS.primeiroDia))).toBe(
      "Sem projeção ainda: ela aparece depois do 1º dia fechado.",
    );
    expect(textoDaProjecao(resumoDoCenario(CENARIOS.antes))).toBe(
      "A projeção aparece depois do 1º dia de vendas.",
    );
    expect(textoDaProjecao(resumoDoCenario(CENARIOS.encerrada))).toBe(
      "Resultado final: 107% da meta (387 bilhetes).",
    );
    expect(reais(textoDaProjecao(resumoDoCenario(CENARIOS.emReais)))).toBe(
      "No ritmo atual, chega a 101% da meta (R$ 7.295,55).",
    );
  });
});

describe("avisos, vendas, vazio e a descrição do gráfico", () => {
  it("totais na unidade da meta, com os pedidos; vendas com o arrecadado", () => {
    const resumo = resumoDoCenario(CENARIOS.emDia);
    if (!resumo.vendas_sem_celula) throw new Error("sem vendas sem célula");
    expect(textoDosTotais(resumo.vendas_sem_celula, "bilhetes")).toBe(
      "3 bilhetes (2 pedidos)",
    );
    expect(reais(textoDosTotais(resumo.vendas_sem_celula, "centavos"))).toBe(
      "R$ 60,00 (2 pedidos)",
    );
    expect(reais(textoDasVendas(resumo.vendas))).toBe(
      "81 pedidos aprovados · 139 bilhetes · R$ 2.780,00",
    );
  });

  it("vazio antes da 1ª venda, conforme a fase e o recorte", () => {
    expect(textoSemVendas(resumoDoCenario(CENARIOS.antes))).toEqual({
      titulo: "Nenhuma venda ainda",
      descricao:
        "As vendas contam a partir de 23/11/2026, o 1º dia da campanha.",
    });
    const durante = resumoDoCenario(CENARIOS.semVendas);
    expect(textoSemVendas(durante).descricao).toBe(
      "Assim que o primeiro pedido for aprovado na Rifei, ele aparece aqui.",
    );
    expect(
      textoSemVendas({
        ...durante,
        escopo: {
          tipo: "celula",
          id: 3,
          divisao: "adultos",
          nome: "Célula Ficticia 03",
        },
      }).descricao,
    ).toBe(
      "Ainda não há venda aprovada para Célula Ficticia 03. Assim que houver, ela aparece aqui.",
    );
  });

  it("a descrição do gráfico dá a conclusão", () => {
    expect(descricaoDaCurva(resumoDoCenario(CENARIOS.emDia))).toBe(
      "O esperado acumulado sobe de 23/11/2026 a 16/12/2026, até a meta de 360 bilhetes. Até hoje, dia 12 (04/12/2026), o realizado é 139 bilhetes; o esperado até ontem era 133 bilhetes: em dia.",
    );
    expect(descricaoDaCurva(resumoDoCenario(CENARIOS.abaixo))).toMatch(
      /: abaixo do esperado\.$/,
    );
    // 1º dia: sem situação (neutro, como no cartão).
    expect(descricaoDaCurva(resumoDoCenario(CENARIOS.primeiroDia))).toMatch(
      / Hoje é o 1º dia \(23\/11\/2026\): o realizado é 3 bilhetes; a comparação com a curva começa amanhã\.$/,
    );
    expect(descricaoDaCurva(resumoDoCenario(CENARIOS.antes))).toMatch(
      /As vendas ainda não começaram\.$/,
    );
    expect(descricaoDaCurva(resumoDoCenario(CENARIOS.encerrada))).toMatch(
      /Resultado final: 387 bilhetes\.$/,
    );
  });
});
