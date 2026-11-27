// A chamada dos avisos de venda (RIFA-094, D42): só GET /api/publico/vendas-recentes, a rota aberta (sem sessão), a
// mesma no ranking aberto e na /minha. Do contrato, só TIPOS (o zod não vai para o pacote do site); o caminho é uma
// cópia conferida pelo tipo do catálogo ROTAS e por avisos-de-venda.test.tsx.
import type {
  ROTAS,
  RespostaVendasRecentes,
} from "../../../shared/contracts/api";
import { api } from "../../lib/api";

export const CAMINHO_VENDAS_RECENTES: (typeof ROTAS)["vendasRecentes"]["caminho"] =
  "/api/publico/vendas-recentes";

export function carregarVendasRecentes(
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaVendasRecentes> {
  return api.get<RespostaVendasRecentes>(CAMINHO_VENDAS_RECENTES, opcoes);
}
