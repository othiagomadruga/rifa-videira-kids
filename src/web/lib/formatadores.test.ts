import { describe, expect, it } from "vitest";
import {
  formatarData,
  formatarDataHora,
  formatarHora,
  formatarMoeda,
  formatarNumero,
  formatarPercentual,
  paraData,
} from "./formatadores";

// O Intl separa "R$" do número com espaço não separável (U+00A0).
const NBSP = " ";

describe("formatarMoeda (centavos → R$)", () => {
  it("formata centavos em reais no padrão pt-BR", () => {
    expect(formatarMoeda(123456)).toBe(`R$${NBSP}1.234,56`);
    expect(formatarMoeda(0)).toBe(`R$${NBSP}0,00`);
    expect(formatarMoeda(5)).toBe(`R$${NBSP}0,05`);
    expect(formatarMoeda(100_000_000)).toBe(`R$${NBSP}1.000.000,00`);
    expect(formatarMoeda(-2550)).toBe(`-R$${NBSP}25,50`);
  });

  it("recusa centavos que não são inteiros", () => {
    expect(() => formatarMoeda(12.5)).toThrow(RangeError);
    expect(() => formatarMoeda(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatarNumero", () => {
  it("usa ponto como separador de milhar e vírgula nos decimais", () => {
    expect(formatarNumero(1234567)).toBe("1.234.567");
    expect(formatarNumero(36)).toBe("36");
    expect(formatarNumero(1234.5, { casasDecimais: 2 })).toBe("1.234,50");
  });

  it("recusa valores que não são finitos", () => {
    expect(() => formatarNumero(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("formatarPercentual (pontos-base → %)", () => {
  it("converte pontos-base em percentual", () => {
    expect(formatarPercentual(3500)).toBe("35%");
    expect(formatarPercentual(0)).toBe("0%");
    expect(formatarPercentual(10_000)).toBe("100%");
    expect(formatarPercentual(12_500)).toBe("125%");
    expect(formatarPercentual(1250, { casasDecimais: 1 })).toBe("12,5%");
    expect(formatarPercentual(1234, { casasDecimais: 2 })).toBe("12,34%");
    expect(formatarPercentual(3500, { casasDecimais: 1 })).toBe("35,0%");
  });

  it("trunca: nunca mostra 100% antes de a meta ser batida", () => {
    expect(formatarPercentual(9999)).toBe("99%");
    expect(formatarPercentual(2999)).toBe("29%");
    expect(formatarPercentual(9999, { casasDecimais: 1 })).toBe("99,9%");
  });

  it("negativos e sinal opcional, sem '-0%'", () => {
    expect(formatarPercentual(-1250)).toBe("-12%");
    expect(formatarPercentual(-40)).toBe("0%");
    expect(formatarPercentual(1200, { sinal: true })).toBe("+12%");
    expect(formatarPercentual(-1200, { sinal: true })).toBe("-12%");
    expect(formatarPercentual(0, { sinal: true })).toBe("0%");
  });
});

describe("datas e horas no fuso America/Belem (UTC-3)", () => {
  it("converte o instante UTC para o horário de Belém", () => {
    expect(formatarDataHora("2026-11-23T22:30:00Z")).toBe("23/11/2026 19:30");
    expect(formatarData("2026-11-23T22:30:00Z")).toBe("23/11/2026");
    expect(formatarHora("2026-11-23T22:30:00Z")).toBe("19:30");
  });

  it("depois da meia-noite em UTC ainda pode ser o dia anterior em Belém", () => {
    expect(formatarDataHora("2026-11-24T01:15:00Z")).toBe("23/11/2026 22:15");
    expect(formatarDataHora(Date.UTC(2026, 0, 1, 2, 59))).toBe(
      "31/12/2025 23:59",
    );
  });

  it("aceita Date, milissegundos e texto com deslocamento", () => {
    expect(formatarDataHora(new Date(Date.UTC(2026, 10, 23, 3, 0)))).toBe(
      "23/11/2026 00:00",
    );
    expect(formatarHora("2026-11-23T19:30:00-03:00")).toBe("19:30");
  });

  it("texto de data e hora sem fuso é UTC (padrão do D1)", () => {
    expect(formatarDataHora("2026-11-23 22:30:00")).toBe("23/11/2026 19:30");
    expect(formatarDataHora("2026-11-23T22:30")).toBe("23/11/2026 19:30");
  });

  it("só a data é o dia do calendário, sem trocar de dia", () => {
    expect(formatarData("2026-11-23")).toBe("23/11/2026");
    expect(formatarDataHora("2026-11-23")).toBe("23/11/2026 00:00");
  });

  it("data inválida lança RangeError", () => {
    expect(() => formatarData("ontem")).toThrow(RangeError);
    expect(() => paraData(Number.NaN)).toThrow(RangeError);
  });
});
