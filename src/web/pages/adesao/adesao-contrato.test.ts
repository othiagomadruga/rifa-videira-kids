// A tela Adesão usa cópias dos caminhos do contrato (importar os valores poria o zod no pacote do site; veja
// adesao-api.ts). Este teste confere as cópias e o link da busca na tela Pedidos (RIFA-031, D20).
import { describe, expect, it } from "vitest";
import {
  ROTAS,
  ROTAS_REGRAS_CAMPANHA,
  consultaPedidosSchema,
} from "../../../shared/contracts";
import { TELAS_COORDENACAO } from "../coordenacao/telas";
import {
  CAMINHO_AFILIADOS,
  CAMINHO_REMOVER_AFILIADO,
  CAMINHO_TELA_PEDIDOS,
  linkDoPedido,
} from "./adesao-api";

describe("cópias do contrato na tela Adesão", () => {
  it("o caminho dos afiliados e o de remover (DELETE, só admin)", () => {
    expect(ROTAS.listarAfiliados.caminho).toBe(CAMINHO_AFILIADOS);
    expect(ROTAS_REGRAS_CAMPANHA.removerAfiliado).toMatchObject({
      metodo: "DELETE",
      caminho: CAMINHO_REMOVER_AFILIADO,
      papeis: ["admin"],
    });
    expect(CAMINHO_REMOVER_AFILIADO).toBe(`${CAMINHO_AFILIADOS}/:affiliateId`);
  });

  it("o link do pedido que ainda conta abre a tela Pedidos com a busca exata pelo id", () => {
    expect(
      TELAS_COORDENACAO.some(
        ({ segmento }) => `/coordenacao/${segmento}` === CAMINHO_TELA_PEDIDOS,
      ),
    ).toBe(true);
    const url = new URL(linkDoPedido("PED 2/ç?&"), "https://site.example");
    expect(url.pathname).toBe(CAMINHO_TELA_PEDIDOS);
    expect(
      consultaPedidosSchema.parse(Object.fromEntries(url.searchParams)),
    ).toMatchObject({ id: "PED 2/ç?&" });
  });
});
