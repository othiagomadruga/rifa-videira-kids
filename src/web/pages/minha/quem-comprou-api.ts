// Chamada de "Quem comprou" do líder da célula (RIFA-089, adendo da D38): só GET /api/minha/compradores. A célula vem só
// da sessão (a tela não manda id de nada); a resposta traz só o nome, a data e a hora e os bilhetes de cada venda paga
// da célula, nunca telefone, números dos bilhetes nem dinheiro (schema estrito do contrato).
//
// Do contrato, só TIPOS (de api.ts): o caminho e o tamanho da página abaixo são cópias, conferidas pelo tipo e por
// minha-contrato.test.ts (importar o catálogo poria o zod no pacote do site).
import type {
  ROTAS_QUEM_COMPROU,
  RespostaQuemComprou,
} from "../../../shared/contracts/api";
import { api } from "../../lib/api";

export const CAMINHO_QUEM_COMPROU: (typeof ROTAS_QUEM_COMPROU)["quemComprou"]["caminho"] =
  "/api/minha/compradores";

/** PAGINA_QUEM_COMPROU_PADRAO do contrato: vendas por página (o "Ver mais" traz a próxima). */
export const VENDAS_POR_PAGINA = 20;

/** "/api/minha/compradores?limite=20" e, no "Ver mais", "&antes_de=<cursor>". */
export function caminhoDeQuemComprou(antesDe: string | null): string {
  const consulta = new URLSearchParams({ limite: String(VENDAS_POR_PAGINA) });
  if (antesDe !== null) consulta.set("antes_de", antesDe);
  return `${CAMINHO_QUEM_COMPROU}?${consulta.toString()}`;
}

export function carregarQuemComprou(
  antesDe: string | null,
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaQuemComprou> {
  return api.get<RespostaQuemComprou>(caminhoDeQuemComprou(antesDe), opcoes);
}
