// RIFA-093: as cópias do contrato no site (os caminhos e o tamanho da página de quem-comprou-api.ts) batem com o
// catálogo ROTAS_QUEM_COMPROU_ADMIN, e a consulta que a tela monta passa no schema da rota.
import { describe, expect, it } from "vitest";
import {
  PAGINA_QUEM_COMPROU_PADRAO,
  ROTAS_QUEM_COMPROU_ADMIN,
} from "../../../shared/contracts/api";
import {
  CAMINHO_CELULAS,
  CAMINHO_COMPRADORES_DA_CELULA,
  COMPRAS_POR_PAGINA,
  caminhoDeQuemComprou,
  caminhoDosCompradores,
  caminhoDosPedidosDaCelula,
} from "./quem-comprou-api";

describe("quem-comprou-api.ts e o contrato (RIFA-093)", () => {
  it("os caminhos e a página batem com o catálogo; as rotas são só do admin", () => {
    const { celulasQuemComprou, compradoresDaCelula } =
      ROTAS_QUEM_COMPROU_ADMIN;
    expect(CAMINHO_CELULAS).toBe(celulasQuemComprou.caminho);
    expect(CAMINHO_COMPRADORES_DA_CELULA).toBe(compradoresDaCelula.caminho);
    expect(celulasQuemComprou.papeis).toEqual(["admin"]);
    expect(compradoresDaCelula.papeis).toEqual(["admin"]);
    expect(COMPRAS_POR_PAGINA).toBe(PAGINA_QUEM_COMPROU_PADRAO);
  });

  it("a consulta das compras passa nos schemas da rota (id, limite e cursor)", () => {
    const rota = ROTAS_QUEM_COMPROU_ADMIN.compradoresDaCelula;
    for (const antesDe of [null, "abc_-1"]) {
      const url = new URL(
        caminhoDosCompradores(3, antesDe),
        "https://site.example",
      );
      expect(url.pathname).toBe("/api/admin/celulas/3/compradores");
      expect(rota.parametros.parse({ id: "3" })).toEqual({ id: 3 });
      expect(rota.consulta.parse(Object.fromEntries(url.searchParams))).toEqual(
        {
          limite: PAGINA_QUEM_COMPROU_PADRAO,
          ...(antesDe === null ? {} : { antes_de: antesDe }),
        },
      );
    }
  });

  it("os atalhos: Pedidos filtrado pela célula e Quem comprou com a célula aberta", () => {
    expect(caminhoDosPedidosDaCelula(3)).toBe(
      "/coordenacao/pedidos?celula_id=3",
    );
    expect(caminhoDeQuemComprou(3)).toBe("/coordenacao/quem-comprou?celula=3");
  });
});
