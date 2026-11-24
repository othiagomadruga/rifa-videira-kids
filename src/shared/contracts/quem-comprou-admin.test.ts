// RIFA-093 (adendo da D36): o contrato de "Quem comprou" do admin, a lista das células com os totais e as vendas
// pagas de uma célula com o telefone do pedido.
import { describe, expect, it } from "vitest";
import {
  PAGINA_QUEM_COMPROU_PADRAO,
  ROTAS_QUEM_COMPROU_ADMIN,
  consultaQuemComprouSchema,
  respostaCelulasQuemComprouSchema,
  respostaCompradoresDaCelulaSchema,
} from "./api";
import * as contrato from "./index";

const aceita = (
  schema: { safeParse: (v: unknown) => { success: boolean } },
  valor: unknown,
) => schema.safeParse(valor).success;

describe("RIFA-093: quem comprou por célula (só admin)", () => {
  it("as rotas: só admin, do grupo coordenacao, no index", () => {
    expect(ROTAS_QUEM_COMPROU_ADMIN.celulasQuemComprou).toMatchObject({
      metodo: "GET",
      caminho: "/api/admin/quem-comprou/celulas",
      grupo: "coordenacao",
      papeis: ["admin"],
      sucesso: { status: 200, corpo: respostaCelulasQuemComprouSchema },
    });
    expect(ROTAS_QUEM_COMPROU_ADMIN.compradoresDaCelula).toMatchObject({
      metodo: "GET",
      caminho: "/api/admin/celulas/:id/compradores",
      grupo: "coordenacao",
      papeis: ["admin"],
      consulta: consultaQuemComprouSchema,
      sucesso: { status: 200, corpo: respostaCompradoresDaCelulaSchema },
    });
    expect(contrato.ROTAS_QUEM_COMPROU_ADMIN).toBe(ROTAS_QUEM_COMPROU_ADMIN);
    expect(
      ROTAS_QUEM_COMPROU_ADMIN.compradoresDaCelula.parametros.parse({
        id: "7",
      }),
    ).toEqual({ id: 7 });
    expect(consultaQuemComprouSchema.parse({ limite: undefined }).limite).toBe(
      PAGINA_QUEM_COMPROU_PADRAO,
    );
  });

  it("a lista das células é estrita: id, nome, discipulador, pedidos e bilhetes; sem R$ e sem líder", () => {
    const resposta = {
      celulas: [
        {
          id: 3,
          nome: "Célula Ficticia",
          discipulador: "Discipulador Ficticio",
          pedidos: 2,
          bilhetes: 5,
        },
        {
          id: 4,
          nome: "Célula Sem Venda",
          discipulador: "Discipulador Ficticio",
          pedidos: 0,
          bilhetes: 0,
        },
      ],
      atualizado_em: "2026-11-24T18:00:00.000Z",
    };
    expect(aceita(respostaCelulasQuemComprouSchema, resposta)).toBe(true);
    for (const extra of [
      { total_centavos: 4000 },
      { lider_telefone: "+5591900000001" },
      { meta: 10 },
    ])
      expect(
        aceita(respostaCelulasQuemComprouSchema, {
          ...resposta,
          celulas: [{ ...resposta.celulas[0], ...extra }],
        }),
      ).toBe(false);
  });

  it("as vendas da célula: com telefone E.164 (ou null), o id do pedido e a origem da célula; sem R$, sem DDD e sem números", () => {
    const resposta = {
      celula: { id: 3, nome: "Célula Ficticia" },
      fuso_horario: "America/Belem",
      totais: { pedidos: 2, bilhetes: 5 },
      itens: [
        {
          pedido_id: "PED-1",
          nome: "Comprador Ficticio",
          telefone: "+5591900000001",
          aprovado_em: "2026-11-23T17:03:00.000Z",
          bilhetes: 2,
          origem_celula: "afiliado",
        },
        {
          pedido_id: "PED-2",
          nome: null,
          telefone: null,
          aprovado_em: "2026-11-23T16:00:00.000Z",
          bilhetes: 3,
          origem_celula: "manual",
        },
      ],
      proximo: null,
      atualizado_em: "2026-11-23T18:00:00.000Z",
    };
    expect(aceita(respostaCompradoresDaCelulaSchema, resposta)).toBe(true);
    // O telefone é o E.164 do pedido (a tela formata); outro formato não passa.
    expect(
      aceita(respostaCompradoresDaCelulaSchema, {
        ...resposta,
        itens: [{ ...resposta.itens[0], telefone: "(91) 90000-0001" }],
      }),
    ).toBe(false);
    expect(
      aceita(respostaCompradoresDaCelulaSchema, {
        ...resposta,
        itens: [{ ...resposta.itens[0], origem_celula: null }],
      }),
    ).toBe(false);
    for (const extra of [
      { total_centavos: 4000 },
      { numeros: [1, 2] },
      { ddd: 91 },
    ])
      expect(
        aceita(respostaCompradoresDaCelulaSchema, {
          ...resposta,
          itens: [{ ...resposta.itens[0], ...extra }],
        }),
      ).toBe(false);
  });
});
