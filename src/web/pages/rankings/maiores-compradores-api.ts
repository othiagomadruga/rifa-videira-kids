// Chamada dos maiores compradores do admin (RIFA-083, D38): GET /api/admin/maiores-compradores, só admin (a
// coordenação leva 403, e a tela nem pede: o bloco aparece só para o admin). Telefone e R$ só aqui (D36).
//
// Do contrato, só TIPOS (de api.ts e calculos.ts): o caminho abaixo é uma cópia, conferida pelo tipo e por
// rankings-contrato.test.ts (importar o catálogo poria o zod no pacote do site).
import type {
  ROTAS_MAIORES_COMPRADORES,
  RespostaMaioresCompradores,
} from "../../../shared/contracts/api";
import type { JanelaRanking } from "../../../shared/contracts/calculos";
import { api } from "../../lib/api";

export const CAMINHO_MAIORES_COMPRADORES: (typeof ROTAS_MAIORES_COMPRADORES)["maioresCompradores"]["caminho"] =
  "/api/admin/maiores-compradores";

/** "/api/admin/maiores-compradores?janela=atual" (o limite fica no padrão da API: 10). */
export function caminhoDosMaioresCompradores(janela: JanelaRanking): string {
  return `${CAMINHO_MAIORES_COMPRADORES}?${new URLSearchParams({ janela }).toString()}`;
}

export function carregarMaioresCompradores(
  janela: JanelaRanking,
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaMaioresCompradores> {
  return api.get<RespostaMaioresCompradores>(
    caminhoDosMaioresCompradores(janela),
    opcoes,
  );
}
