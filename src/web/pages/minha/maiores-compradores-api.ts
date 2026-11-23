// Chamada dos maiores compradores do discipulador (RIFA-083, D38): só GET /api/minha/maiores-compradores. O alvo vem só
// da sessão (a tela não manda id de nada); a resposta traz só a posição, o nome, os bilhetes e a célula de cada
// comprador das células dele, nunca telefone nem dinheiro (schema estrito do contrato).
//
// Do contrato, só TIPOS (de api.ts e calculos.ts): o caminho abaixo é uma cópia, conferida pelo tipo e por
// minha-contrato.test.ts (importar o catálogo poria o zod no pacote do site).
import type {
  ROTAS_MAIORES_COMPRADORES,
  RespostaMeusMaioresCompradores,
} from "../../../shared/contracts/api";
import type { JanelaRanking } from "../../../shared/contracts/calculos";
import { api } from "../../lib/api";

export const CAMINHO_MEUS_MAIORES_COMPRADORES: (typeof ROTAS_MAIORES_COMPRADORES)["meusMaioresCompradores"]["caminho"] =
  "/api/minha/maiores-compradores";

/** "/api/minha/maiores-compradores?janela=atual" (o limite fica no padrão da API: 10). */
export function caminhoDosMeusMaioresCompradores(
  janela: JanelaRanking,
): string {
  return `${CAMINHO_MEUS_MAIORES_COMPRADORES}?${new URLSearchParams({ janela }).toString()}`;
}

export function carregarMeusMaioresCompradores(
  janela: JanelaRanking,
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaMeusMaioresCompradores> {
  return api.get<RespostaMeusMaioresCompradores>(
    caminhoDosMeusMaioresCompradores(janela),
    opcoes,
  );
}
