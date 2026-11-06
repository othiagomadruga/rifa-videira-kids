// Calendário da campanha (o mesmo código que a API usa para devolver as datas).
import { describe, expect, it } from "vitest";
import {
  calcularCalendario,
  diaDoCalendario,
  diasEntre,
  faseDaCampanha,
  hojeNoFuso,
  somarDias,
  somarPercentuais,
} from "./calendario";

describe("calcularCalendario", () => {
  it("modelo de Santo André a partir de 23/11/2026: períodos seguidos e fim em 16/12/2026", () => {
    expect(
      calcularCalendario("2026-11-23", [
        { dias: 10 },
        { dias: 7 },
        { dias: 7 },
      ]),
    ).toEqual({
      periodos: [
        { data_inicio: "2026-11-23", data_fim: "2026-12-02" },
        { data_inicio: "2026-12-03", data_fim: "2026-12-09" },
        { data_inicio: "2026-12-10", data_fim: "2026-12-16" },
      ],
      data_fim: "2026-12-16",
      total_dias: 24,
    });
  });

  it("vira o ano e respeita o 29 de fevereiro", () => {
    expect(calcularCalendario("2026-12-30", [{ dias: 3 }])).toMatchObject({
      data_fim: "2027-01-01",
    });
    expect(
      calcularCalendario("2028-02-27", [{ dias: 2 }, { dias: 2 }]).periodos,
    ).toEqual([
      { data_inicio: "2028-02-27", data_fim: "2028-02-28" },
      { data_inicio: "2028-02-29", data_fim: "2028-03-01" },
    ]);
  });

  it("um dia só: começa e termina no mesmo dia", () => {
    expect(calcularCalendario("2026-11-23", [{ dias: 1 }])).toEqual({
      periodos: [{ data_inicio: "2026-11-23", data_fim: "2026-11-23" }],
      data_fim: "2026-11-23",
      total_dias: 1,
    });
  });

  it("data inválida lança RangeError", () => {
    expect(() => calcularCalendario("2026-02-30", [{ dias: 1 }])).toThrow(
      RangeError,
    );
  });
});

describe("datas do calendário", () => {
  it.each(["2026-02-30", "2026-13-01", "2026-1-1", "", "23/11/2026"])(
    "diaDoCalendario recusa %j",
    (texto) => {
      expect(diaDoCalendario(texto)).toBeNull();
    },
  );

  it("somarDias e diasEntre", () => {
    expect(somarDias("2026-11-23", 10)).toBe("2026-12-03");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(diasEntre("2026-11-06", "2026-11-23")).toBe(17);
    expect(diasEntre("2026-11-23", "2026-11-06")).toBe(-17);
  });

  it("somarPercentuais", () => {
    expect(
      somarPercentuais([
        { percentual_bp: 3500 },
        { percentual_bp: 2500 },
        { percentual_bp: 4500 },
      ]),
    ).toBe(10_500);
  });
});

describe("fase da campanha (FASES_CAMPANHA)", () => {
  it.each([
    ["2026-11-22", "antes"],
    ["2026-11-23", "durante"],
    ["2026-12-16", "durante"],
    ["2026-12-17", "encerrada"],
  ] as const)("em %s: %s", (hoje, fase) => {
    expect(faseDaCampanha(hoje, "2026-11-23", "2026-12-16")).toBe(fase);
  });

  it("hoje é a data no fuso da campanha, não a do aparelho", () => {
    const instante = new Date("2026-11-23T02:30:00.000Z");
    expect(hojeNoFuso("America/Belem", instante)).toBe("2026-11-22");
    expect(hojeNoFuso("UTC", instante)).toBe("2026-11-23");
  });
});
