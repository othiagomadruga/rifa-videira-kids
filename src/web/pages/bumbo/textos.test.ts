// Regras puras da tela do bumbo: datas do calendário, os dias do seletor (a janela que a API aceita), a
// referência da mensagem, o link do WhatsApp e os avisos. O aviso de "sem vendas" é conferido contra o
// texto que o montador do contrato escreve (montarBumbo), não contra um texto copiado.
import { describe, expect, it } from "vitest";
import type { RespostaBumbo } from "../../../shared/contracts/calculos";
import { CELULAS, INSTANTES, VENDAS, respostaDoBumbo } from "./teste-apoio";
import {
  avisoDaMensagem,
  diaDaSemana,
  diasEntre,
  linkWhatsApp,
  opcoesDoSeletor,
  rankingSemVendas,
  somarDias,
  textoDaReferencia,
  ultimoDiaDoBumbo,
} from "./textos";

const CAMPANHA = { inicio: "2026-11-23", fim: "2026-12-13" };

describe("datas do calendário", () => {
  it("somarDias e diasEntre atravessam meses e anos (sem fuso)", () => {
    expect(somarDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(somarDias("2028-03-01", -1)).toBe("2028-02-29");
    expect(diasEntre("2026-11-23", "2026-12-13")).toBe(20);
    expect(diasEntre("2026-12-13", "2026-11-23")).toBe(-20);
    expect(ultimoDiaDoBumbo("2026-12-13")).toBe("2026-12-14");
  });

  it("dia da semana em português, com maiúscula e sem o '-feira'", () => {
    expect(
      ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"]
        .concat(["2026-11-27", "2026-11-28"])
        .map(diaDaSemana),
    ).toEqual([
      "Domingo",
      "Segunda",
      "Terça",
      "Quarta",
      "Quinta",
      "Sexta",
      "Sábado",
    ]);
  });
});

describe("os dias do seletor: só a janela que a API aceita", () => {
  it("durante: hoje (sem data) e do dia anterior ao 1º dia, nunca depois de hoje", () => {
    const opcoes = opcoesDoSeletor({ ...CAMPANHA, hoje: "2026-11-25" });

    expect(opcoes).toEqual([
      { valor: "", data: "2026-11-25", rotulo: "Quarta, 25/11 (hoje) · dia 3" },
      {
        valor: "2026-11-24",
        data: "2026-11-24",
        rotulo: "Terça, 24/11 (ontem) · dia 2",
      },
      {
        valor: "2026-11-23",
        data: "2026-11-23",
        rotulo: "Segunda, 23/11 · dia 1",
      },
    ]);
  });

  it("antes do início e no 1º dia, só hoje (a tela não mostra o seletor)", () => {
    expect(opcoesDoSeletor({ ...CAMPANHA, hoje: "2026-11-20" })).toEqual([
      {
        valor: "",
        data: "2026-11-20",
        rotulo: "Sexta, 20/11 (hoje) · antes do início",
      },
    ]);
    expect(opcoesDoSeletor({ ...CAMPANHA, hoje: "2026-11-23" })).toHaveLength(
      1,
    );
  });

  it("no dia seguinte ao fim, ele é o hoje (sem repetir); depois, a janela para nele", () => {
    const noDiaSeguinte = opcoesDoSeletor({ ...CAMPANHA, hoje: "2026-12-14" });
    expect(noDiaSeguinte[0]).toEqual({
      valor: "",
      data: "2026-12-14",
      rotulo: "Segunda, 14/12 (hoje) · dia seguinte ao fim",
    });
    expect(noDiaSeguinte.map(({ data }) => data)).not.toContain("2026-12-15");
    expect(
      noDiaSeguinte.filter(({ data }) => data === "2026-12-14"),
    ).toHaveLength(1);
    expect(noDiaSeguinte).toHaveLength(22);

    const meses = opcoesDoSeletor({ ...CAMPANHA, hoje: "2027-02-01" });
    expect(meses).toHaveLength(23);
    expect(meses[1]).toMatchObject({
      valor: "2026-12-14",
      rotulo: "Segunda, 14/12 · dia seguinte ao fim",
    });
    expect(meses.at(-1)).toMatchObject({ valor: "2026-11-23" });
    for (const { valor } of meses.slice(1)) {
      expect(valor >= "2026-11-23" && valor <= "2026-12-14").toBe(true);
    }
  });
});

describe("a referência da mensagem", () => {
  const referencia = (data: string, agora: Date) =>
    respostaDoBumbo(agora, data).referencia;

  it("data por extenso (marcando hoje) e o dia da campanha, a contagem regressiva ou o fim", () => {
    expect(
      textoDaReferencia(
        referencia("2026-12-01", INSTANTES.durante),
        "2026-12-01",
      ),
    ).toEqual({ data: "Terça, 01/12/2026 (hoje)", fase: "Dia 9 de 21" });
    expect(
      textoDaReferencia(
        referencia("2026-11-30", INSTANTES.durante),
        "2026-12-01",
      ),
    ).toEqual({ data: "Segunda, 30/11/2026", fase: "Dia 8 de 21" });
    expect(
      textoDaReferencia(
        respostaDoBumbo(INSTANTES.antes).referencia,
        "2026-11-20",
      ),
    ).toEqual({
      data: "Sexta, 20/11/2026 (hoje)",
      fase: "Faltam 3 dias para começar",
    });
    expect(
      textoDaReferencia(
        respostaDoBumbo(new Date("2026-11-22T15:00:00.000Z")).referencia,
        null,
      ),
    ).toEqual({
      data: "Domingo, 22/11/2026",
      fase: "A campanha começa amanhã",
    });
    expect(
      textoDaReferencia(
        referencia("2026-12-14", INSTANTES.encerrada),
        "2026-12-20",
      ).fase,
    ).toBe("Campanha encerrada");
  });
});

describe("o link do WhatsApp", () => {
  it("wa.me sem número, com o texto inteiro codificado", () => {
    expect(linkWhatsApp("*Oi* & #1\nTchau?")).toBe(
      "https://wa.me/?text=*Oi*%20%26%20%231%0ATchau%3F",
    );
  });
});

describe("os avisos, conferidos com o texto do montador do contrato", () => {
  const SEM_VENDAS_ATE_O_DIA_7 = VENDAS.filter(({ dia }) => dia > "2026-11-29");
  const SO_JOVENS = VENDAS.filter(({ celula_id }) =>
    CELULAS.some(({ id, divisao }) => id === celula_id && divisao === "jovens"),
  );

  it.each<[string, RespostaBumbo, boolean]>([
    [
      "sem venda nenhuma",
      respostaDoBumbo(INSTANTES.durante, undefined, []),
      true,
    ],
    [
      "campanha encerrada sem venda nenhuma",
      respostaDoBumbo(INSTANTES.encerrada, undefined, []),
      true,
    ],
    [
      "sem venda no período de ontem (Semana 1 sem vendas, dia 7)",
      respostaDoBumbo(INSTANTES.durante, "2026-11-30", SEM_VENDAS_ATE_O_DIA_7),
      true,
    ],
    ["com vendas nas duas divisões", respostaDoBumbo(INSTANTES.durante), false],
    [
      "com vendas só nos jovens",
      respostaDoBumbo(INSTANTES.durante, undefined, SO_JOVENS),
      false,
    ],
    ["antes do início", respostaDoBumbo(INSTANTES.antes, undefined, []), false],
    ["1º dia", respostaDoBumbo(INSTANTES.primeiroDia, undefined, []), false],
  ])("%s: ranking sem vendas = %s", (_caso, resposta, esperado) => {
    expect(rankingSemVendas(resposta.texto)).toBe(esperado);
  });

  it("um aviso por situação: antes do início, 1º dia, ranking sem vendas; no dia a dia, nenhum", () => {
    expect(avisoDaMensagem(respostaDoBumbo(INSTANTES.antes))?.titulo).toBe(
      "A campanha começa em 23/11/2026.",
    );
    expect(
      avisoDaMensagem(respostaDoBumbo(INSTANTES.primeiroDia))?.titulo,
    ).toBe("1º dia de vendas: a mensagem é a da largada.");
    expect(
      avisoDaMensagem(respostaDoBumbo(INSTANTES.durante, undefined, []))
        ?.titulo,
    ).toBe("Ainda sem vendas no ranking.");
    expect(avisoDaMensagem(respostaDoBumbo(INSTANTES.durante))).toBeNull();
    expect(avisoDaMensagem(respostaDoBumbo(INSTANTES.encerrada))).toBeNull();
  });
});
