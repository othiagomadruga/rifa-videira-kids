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
