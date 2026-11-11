import { describe, expect, it } from "vitest";
import { NOME_DA_UF, UFS, UF_DO_DDD } from "./ddd";
import { dddSchema } from "./rifei";

describe("RIFA-015 (D17): tabela DDD → UF", () => {
  it("tem os 67 DDDs em uso no Brasil, todos no formato gravado em pedidos.ddd", () => {
    const ddds = Object.keys(UF_DO_DDD);
    expect(ddds).toHaveLength(67);
    for (const ddd of ddds)
      expect({ ddd, ok: dddSchema.safeParse(ddd).success }).toEqual({
        ddd,
        ok: true,
      });
  });

  it("cobre as 27 UFs, cada uma com nome, e não aponta para UF fora da lista", () => {
    expect(UFS).toHaveLength(27);
    expect(new Set(Object.values(UF_DO_DDD))).toEqual(new Set(UFS));
    expect(Object.keys(NOME_DA_UF).sort()).toEqual([...UFS].sort());
  });

  it("é exatamente o plano de numeração da Anatel, UF a UF (pega troca de UF entre DDDs)", () => {
    // Escrita por UF, como a Anatel publica, e não por DDD: uma troca (ex.: 64 em TO) muda esta lista.
    const ANATEL: Record<string, [string, string]> = {
      AC: ["Acre", "68"],
      AL: ["Alagoas", "82"],
      AM: ["Amazonas", "92 97"],
      AP: ["Amapá", "96"],
      BA: ["Bahia", "71 73 74 75 77"],
      CE: ["Ceará", "85 88"],
      DF: ["Distrito Federal", "61"],
      ES: ["Espírito Santo", "27 28"],
      GO: ["Goiás", "62 64"],
      MA: ["Maranhão", "98 99"],
      MG: ["Minas Gerais", "31 32 33 34 35 37 38"],
      MS: ["Mato Grosso do Sul", "67"],
      MT: ["Mato Grosso", "65 66"],
      PA: ["Pará", "91 93 94"],
      PB: ["Paraíba", "83"],
      PE: ["Pernambuco", "81 87"],
      PI: ["Piauí", "86 89"],
      PR: ["Paraná", "41 42 43 44 45 46"],
      RJ: ["Rio de Janeiro", "21 22 24"],
      RN: ["Rio Grande do Norte", "84"],
      RO: ["Rondônia", "69"],
      RR: ["Roraima", "95"],
      RS: ["Rio Grande do Sul", "51 53 54 55"],
      SC: ["Santa Catarina", "47 48 49"],
      SE: ["Sergipe", "79"],
      SP: ["São Paulo", "11 12 13 14 15 16 17 18 19"],
      TO: ["Tocantins", "63"],
    };
    const porUf: Record<string, [string, string]> = {};
    for (const uf of UFS)
      porUf[uf] = [
        NOME_DA_UF[uf],
        Object.keys(UF_DO_DDD)
          .filter((ddd) => UF_DO_DDD[ddd] === uf)
          .sort()
          .join(" "),
      ];
    expect(porUf).toEqual(ANATEL);
  });

  it("confere DDDs conhecidos (inclusive os de Belém e região)", () => {
    expect(UF_DO_DDD["91"]).toBe("PA");
    expect(UF_DO_DDD["93"]).toBe("PA");
    expect(UF_DO_DDD["94"]).toBe("PA");
    expect(UF_DO_DDD["11"]).toBe("SP");
    expect(UF_DO_DDD["61"]).toBe("DF");
    expect(UF_DO_DDD["55"]).toBe("RS");
    for (const inexistente of [
      "10",
      "20",
      "23",
      "25",
      "26",
      "29",
      "30",
      "36",
      "39",
      "40",
      "50",
      "52",
      "56",
      "57",
      "58",
      "59",
      "60",
      "70",
      "72",
      "76",
      "78",
      "80",
      "90",
    ])
      expect({ inexistente, uf: UF_DO_DDD[inexistente] }).toEqual({
        inexistente,
        uf: undefined,
      });
  });
});
