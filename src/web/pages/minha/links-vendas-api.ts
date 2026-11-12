// O link de vendas das células do alvo da sessão (RIFA-046, D24): só GET /api/minha/links-vendas. O alvo vem só da
// sessão (a rota não aceita id): o líder recebe a célula dele; o discipulador e a rede, as células deles. Nada de
// dinheiro: o link não é número nem valor.
//
// De api.ts, só TIPOS: o caminho abaixo é uma cópia, conferida por minha-contrato.test.ts (importar o catálogo
// ROTAS_LINK_VENDAS poria o zod no pacote do site).
import type {
  CelulaLinksVendas,
  ROTAS_LINK_VENDAS,
  RespostaMeusLinksVendas,
} from "../../../shared/contracts/api";
import { eLinkDeVendas } from "../../../shared/contracts/link-vendas";
import { api } from "../../lib/api";

export const CAMINHO_MEUS_LINKS_VENDAS: (typeof ROTAS_LINK_VENDAS)["meusLinksVendas"]["caminho"] =
  "/api/minha/links-vendas";

export function carregarMeusLinks(
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaMeusLinksVendas> {
  return api.get<RespostaMeusLinksVendas>(CAMINHO_MEUS_LINKS_VENDAS, opcoes);
}

/**
 * Os links da célula que a tela mostra: só os `https://rifei.com.br/...` (o schema da API já confere; aqui é a
 * segunda trava, para nenhum outro endereço virar link ou QR code na tela), na ordem da API (o vínculo mais
 * recente primeiro: é o que fica em destaque).
 */
export function linksDaCelula(
  celula: CelulaLinksVendas,
): CelulaLinksVendas["links"] {
  return celula.links.filter((link) => eLinkDeVendas(link.url));
}
