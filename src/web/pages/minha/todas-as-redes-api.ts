// Chamada do ranking geral (RIFA-090, adendo da D12): só GET /api/minha/todas-as-redes, do discipulador e da rede. O
// alvo vem só da sessão (a tela não manda id de nada); a resposta traz só a posição, o nome, o % da meta, os bilhetes e
// o "eu" de cada discipulador e de cada célula, nunca dinheiro nem comprador (schema estrito do contrato).
//
// Do contrato, só TIPOS (de todas-as-redes.ts e calculos.ts): o caminho abaixo é uma cópia, conferida pelo tipo e por
// minha-contrato.test.ts (importar o catálogo poria o zod no pacote do site).
import type { JanelaRanking } from "../../../shared/contracts/calculos";
import type {
  ROTAS_TODAS_AS_REDES,
  RespostaTodasAsRedes,
} from "../../../shared/contracts/todas-as-redes";
import { api } from "../../lib/api";

export const CAMINHO_TODAS_AS_REDES: (typeof ROTAS_TODAS_AS_REDES)["todasAsRedes"]["caminho"] =
  "/api/minha/todas-as-redes";

/** "/api/minha/todas-as-redes?janela=atual". */
export function caminhoDeTodasAsRedes(janela: JanelaRanking): string {
  return `${CAMINHO_TODAS_AS_REDES}?${new URLSearchParams({ janela }).toString()}`;
}

export function carregarTodasAsRedes(
  janela: JanelaRanking,
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaTodasAsRedes> {
  return api.get<RespostaTodasAsRedes>(caminhoDeTodasAsRedes(janela), opcoes);
}
