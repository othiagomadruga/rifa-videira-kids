// O corpo compacto da conferência (RIFA-012, ciclo 2) e o validador leve dele (sem zod item a item): o
// que o navegador monta passa; forma, tamanhos, tipos e chaves fora do contrato não passam, e os problemas
// nunca trazem o valor recebido.
import { describe, expect, it } from "vitest";
import {
  LIMITE_LINHAS_CSV_RECONCILIACAO,
  LIMITE_PEDIDOS_RECUPERAR,
  LIMITE_PROBLEMAS_DO_CORPO,
  validarCorpoConferencia,
  validarCorpoRecuperacao,
  type CorpoConferencia,
} from "./conferencia";

const COLUNAS = {
  pedido_id: "Pedido",
  status: "Status",
  qtd_bilhetes: "Quantidade",
  bilhetes: null,
  valor: "Valor",
  afiliado: "Afiliado",
  data: "Data",
};

function corpo(extra: Partial<CorpoConferencia> = {}): CorpoConferencia {
  return {
    colunas: COLUNAS,
    linhas: 3,
    arquivo_sha256: "0".repeat(64),
    vezes: [1, 2],
    pedido_id: ["R-1", "R-2"],
    status: ["aprovado", null],
    qtd_bilhetes: [1, 2],
    valor: [2000, null],
    afiliado: [1042, "lider.betel"],
    dia: ["2026-11-23", null],
    instante: [Date.parse("2026-11-23T15:00:00.000Z"), null],
    ...extra,
  };
}

const problemas = (valor: unknown) => {
  const resultado = validarCorpoConferencia(valor);
  return resultado.ok ? [] : resultado.problemas;
};

describe("validarCorpoConferencia", () => {
  it("o corpo bem formado passa (e o modo sem código também)", () => {
    expect(validarCorpoConferencia(corpo())).toEqual({
      ok: true,
      corpo: corpo(),
    });
    const semCodigo = corpo({ colunas: { ...COLUNAS, pedido_id: null } });
    delete semCodigo.pedido_id;
    expect(validarCorpoConferencia(semCodigo).ok).toBe(true);
  });

  it("forma: não objeto, sem colunas, linhas acima do limite, SHA-256 fora do formato", () => {
    expect(problemas([])).toEqual([
      { caminho: [], codigo: "invalid_type", mensagem: "Envie um objeto JSON" },
    ]);
    expect(problemas({ ...corpo(), colunas: undefined })).toContainEqual(
      expect.objectContaining({ caminho: ["colunas"] }),
    );
    expect(
      problemas({
        ...corpo(),
        linhas: LIMITE_LINHAS_CSV_RECONCILIACAO + 1,
      }),
    ).toContainEqual(expect.objectContaining({ caminho: ["linhas"] }));
    expect(problemas({ ...corpo(), arquivo_sha256: "xyz" })).toContainEqual(
      expect.objectContaining({ caminho: ["arquivo_sha256"] }),
    );
  });

  it("vezes: inteiros de 1 em diante, somando `linhas`", () => {
    expect(problemas(corpo({ vezes: [1, 1] }))).toEqual([
      expect.objectContaining({ caminho: ["vezes"], codigo: "custom" }),
    ]);
    expect(problemas(corpo({ vezes: [0, 3] }))).toContainEqual(
      expect.objectContaining({ caminho: ["vezes", 0] }),
    );
  });

  it("cada lista tem uma posição por item de vezes, e só existe com a coluna", () => {
    expect(problemas(corpo({ valor: [2000] }))).toEqual([
      expect.objectContaining({ caminho: ["valor"], codigo: "invalid_type" }),
    ]);
    expect(problemas(corpo({ numeros: [1, 1] }))).toEqual([
      expect.objectContaining({
        caminho: ["numeros"],
        codigo: "unrecognized_keys",
      }),
    ]);
    const semValor = corpo();
    delete semValor.valor;
    expect(problemas(semValor)).toEqual([
      expect.objectContaining({ caminho: ["valor"] }),
    ]);
  });

  it("o tipo de cada posição, sem trazer o valor recebido", () => {
    const ruins = problemas(
      corpo({
        pedido_id: ["=HYPERLINK(1)", "maria@example.com"],
        status: ["pago" as never, null],
        qtd_bilhetes: [-1, 2.5],
        valor: [1.5, null],
        afiliado: [0, "x".repeat(121)],
        dia: ["23/11/2026", null],
        instante: [Date.parse("2026-11-23T15:00:00.000Z"), 1],
      }),
    );
    expect(ruins.map((problema) => problema.caminho)).toEqual([
      ["pedido_id", 0],
      ["pedido_id", 1],
      ["status", 0],
      ["qtd_bilhetes", 0],
      ["qtd_bilhetes", 1],
      ["valor", 0],
      ["afiliado", 0],
      ["afiliado", 1],
      ["dia", 0],
      ["instante", 1],
      // E o instante da posição 1 (mesmo inválido) veio sem o dia.
      ["dia", 1],
    ]);
    expect(JSON.stringify(ruins)).not.toMatch(/HYPERLINK|example\.com|pago"/);
  });

  it("dia que não existe no calendário (31 de fevereiro, 29/02 fora do bissexto) não passa", () => {
    for (const dia of ["2026-02-31", "2026-02-29", "2026-04-31"])
      expect(
        problemas(corpo({ dia: [dia, null], instante: [null, null] })),
      ).toEqual([
        {
          caminho: ["dia", 0],
          codigo: "invalid_value",
          mensagem: "Use uma data que existe, no formato AAAA-MM-DD",
        },
      ]);
    expect(
      problemas(corpo({ dia: ["2028-02-29", null], instante: [null, null] })),
    ).toEqual([]);
  });

  it("instante sem o dia não passa", () => {
    expect(
      problemas(
        corpo({
          dia: [null, null],
          instante: [Date.parse("2026-11-23"), null],
        }),
      ),
    ).toEqual([expect.objectContaining({ caminho: ["dia", 0] })]);
  });

  it("chaves fora do contrato (também `pedidos` na análise) e campos desconhecidos em colunas", () => {
    expect(problemas({ ...corpo(), csv: "Pedido,Nome" })).toEqual([
      expect.objectContaining({
        caminho: ["csv"],
        codigo: "unrecognized_keys",
      }),
    ]);
    expect(problemas({ ...corpo(), pedidos: ["R-1"] })).toEqual([
      expect.objectContaining({ caminho: ["pedidos"] }),
    ]);
    expect(
      problemas(corpo({ colunas: { ...COLUNAS, nome: "Nome" } as never })),
    ).toEqual([expect.objectContaining({ caminho: ["colunas", "nome"] })]);
  });

  it("lista no máximo LIMITE_PROBLEMAS_DO_CORPO problemas e conta o resto", () => {
    const linhas = 100;
    const resultado = validarCorpoConferencia(
      corpo({
        linhas,
        vezes: Array.from({ length: linhas }, () => 1),
        pedido_id: Array.from({ length: linhas }, () => "=1"),
        status: Array.from({ length: linhas }, () => null),
        qtd_bilhetes: Array.from({ length: linhas }, () => null),
        valor: Array.from({ length: linhas }, () => null),
        afiliado: Array.from({ length: linhas }, () => null),
        dia: Array.from({ length: linhas }, () => null),
        instante: Array.from({ length: linhas }, () => null),
      }),
    );
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.problemas).toHaveLength(LIMITE_PROBLEMAS_DO_CORPO);
    expect(resultado.total).toBe(linhas);
  });
});

describe("validarCorpoRecuperacao", () => {
  it("o corpo da análise mais 1 a 500 códigos válidos; simular é false se faltar", () => {
    const resultado = validarCorpoRecuperacao({
      ...corpo(),
      pedidos: ["R-1"],
    });
    expect(resultado).toEqual({
      ok: true,
      corpo: { ...corpo(), pedidos: ["R-1"], simular: false },
    });
  });

  it("recusa sem a coluna do código, lista vazia ou grande demais, código inválido e simular que não é booleano", () => {
    const semCodigo = corpo({ colunas: { ...COLUNAS, pedido_id: null } });
    delete semCodigo.pedido_id;
    for (const [valor, caminho] of [
      [{ ...semCodigo, pedidos: ["R-1"] }, ["colunas", "pedido_id"]],
      [{ ...corpo(), pedidos: [] }, ["pedidos"]],
      [
        {
          ...corpo(),
          pedidos: Array.from(
            { length: LIMITE_PEDIDOS_RECUPERAR + 1 },
            (_, i) => `R-${i}`,
          ),
        },
        ["pedidos"],
      ],
      [{ ...corpo(), pedidos: ["maria@example.com"] }, ["pedidos", 0]],
      [{ ...corpo(), pedidos: ["R-1"], simular: "sim" }, ["simular"]],
    ] as const) {
      const resultado = validarCorpoRecuperacao(valor);
      expect(resultado.ok).toBe(false);
      if (!resultado.ok)
        expect(resultado.problemas).toContainEqual(
          expect.objectContaining({ caminho }),
        );
    }
  });
});
