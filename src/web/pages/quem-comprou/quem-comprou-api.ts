// Chamadas da tela "Quem comprou" do admin (RIFA-093, adendo da D36): GET /api/admin/quem-comprou/celulas (todas as
// células com o que venderam) e GET /api/admin/celulas/:id/compradores (as compras pagas de uma célula, com o telefone
// do pedido, D36). Só admin: a coordenação leva 403, e a tela nem pede (TELAS_COORDENACAO, `papeis: ["admin"]`).
//
// Do contrato, só TIPOS (de api.ts): os caminhos e o tamanho da página abaixo são cópias, conferidas pelo tipo e por
// quem-comprou-contrato.test.ts (importar o catálogo poria o zod no pacote do site).
import type {
  ROTAS_QUEM_COMPROU_ADMIN,
  RespostaCelulasQuemComprou,
  RespostaCompradoresDaCelula,
} from "../../../shared/contracts/api";
import { ErroApi, api } from "../../lib/api";

export const CAMINHO_CELULAS: (typeof ROTAS_QUEM_COMPROU_ADMIN)["celulasQuemComprou"]["caminho"] =
  "/api/admin/quem-comprou/celulas";

export const CAMINHO_COMPRADORES_DA_CELULA: (typeof ROTAS_QUEM_COMPROU_ADMIN)["compradoresDaCelula"]["caminho"] =
  "/api/admin/celulas/:id/compradores";

/** PAGINA_QUEM_COMPROU_PADRAO do contrato: compras por página (o "Ver mais" traz a próxima). */
export const COMPRAS_POR_PAGINA = 20;

/** "/api/admin/celulas/3/compradores?limite=20" e, no "Ver mais", "&antes_de=<cursor>". */
export function caminhoDosCompradores(
  celulaId: number,
  antesDe: string | null,
): string {
  const consulta = new URLSearchParams({ limite: String(COMPRAS_POR_PAGINA) });
  if (antesDe !== null) consulta.set("antes_de", antesDe);
  return `${CAMINHO_COMPRADORES_DA_CELULA.replace(":id", String(celulaId))}?${consulta.toString()}`;
}

/** A tela Pedidos filtrada pela célula (o filtro "Célula" de lá, pela URL). */
export function caminhoDosPedidosDaCelula(celulaId: number): string {
  return `/coordenacao/pedidos?${new URLSearchParams({ celula_id: String(celulaId) }).toString()}`;
}

/** Esta tela com a célula já aberta: o destino do toque na célula em Rankings e na Hierarquia. */
export function caminhoDeQuemComprou(celulaId: number): string {
  return `/coordenacao/quem-comprou?${new URLSearchParams({ celula: String(celulaId) }).toString()}`;
}

export function carregarCelulas(
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaCelulasQuemComprou> {
  return api.get<RespostaCelulasQuemComprou>(CAMINHO_CELULAS, opcoes);
}

export function carregarCompradores(
  celulaId: number,
  antesDe: string | null,
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaCompradoresDaCelula> {
  return api.get<RespostaCompradoresDaCelula>(
    caminhoDosCompradores(celulaId, antesDe),
    opcoes,
  );
}

/** Sem campanha ativa (404 `nao_encontrado` na lista das células). */
export function ehSemCampanha(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 404 &&
    erro.codigo === "nao_encontrado"
  );
}
