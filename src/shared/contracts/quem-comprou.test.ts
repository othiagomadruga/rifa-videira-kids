// RIFA-089 (adendo da D38): o contrato de "Quem comprou", a lista das vendas pagas da célula para o líder.
import { describe, expect, it } from "vitest";
import {
  PAGINA_QUEM_COMPROU_MAXIMA,
  PAGINA_QUEM_COMPROU_PADRAO,
  ROTAS_QUEM_COMPROU,
  consultaQuemComprouSchema,
  respostaQuemComprouSchema,
} from "./api";
import * as contrato from "./index";

const aceita = (
  schema: { safeParse: (v: unknown) => { success: boolean } },
  valor: unknown,
) => schema.safeParse(valor).success;

describe("RIFA-089: quem comprou (só o líder da célula)", () => {
  it("a rota: GET /api/minha/compradores, do grupo hierarquia, só do líder, no index", () => {
    expect(ROTAS_QUEM_COMPROU.quemComprou).toMatchObject({
      metodo: "GET",
      caminho: "/api/minha/compradores",
      grupo: "hierarquia",
      papeis: ["lider"],
      sucesso: { status: 200, corpo: respostaQuemComprouSchema },
    });
    expect(contrato.ROTAS_QUEM_COMPROU).toBe(ROTAS_QUEM_COMPROU);
  });

  it("a consulta: limite de 1 a 50 (padrão 20) e o cursor; nenhum id de célula", () => {
    expect(consultaQuemComprouSchema.parse({})).toEqual({
      limite: PAGINA_QUEM_COMPROU_PADRAO,
    });
    expect(PAGINA_QUEM_COMPROU_MAXIMA).toBe(50);
    expect(
      consultaQuemComprouSchema.parse({ limite: "5", antes_de: "abc" }),
    ).toEqual({
      limite: 5,
      antes_de: "abc",
    });
    for (const limite of ["0", "51", "1.5"])
      expect(aceita(consultaQuemComprouSchema, { limite })).toBe(false);
    // Um `celula_id` na consulta é descartado: a célula vem só da sessão.
    expect(
      consultaQuemComprouSchema.parse({ celula_id: "9" }),
    ).not.toHaveProperty("celula_id");
  });

  it("a resposta é estrita: nome (ou null), quando e bilhetes; sem telefone, sem números e sem R$", () => {
    const resposta = {
      fuso_horario: "America/Belem",
      itens: [
        {
          nome: "Comprador Ficticio",
          aprovado_em: "2026-11-23T17:03:00.000Z",
          bilhetes: 2,
        },
        { nome: null, aprovado_em: "2026-11-23T16:00:00.000Z", bilhetes: 1 },
      ],
      proximo: null,
      atualizado_em: "2026-11-23T18:00:00.000Z",
    };
    expect(aceita(respostaQuemComprouSchema, resposta)).toBe(true);
    for (const extra of [
      { telefone: "+5591900000001" },
      { total_centavos: 4000 },
      { numeros: [1, 2] },
      { celula: "Célula Ficticia" },
    ])
      expect(
        aceita(respostaQuemComprouSchema, {
          ...resposta,
          itens: [{ ...resposta.itens[0], ...extra }],
        }),
      ).toBe(false);
  });
});
