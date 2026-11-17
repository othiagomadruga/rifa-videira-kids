// "Marcar como pago na Rifei" (RIFA-070, D27; só o admin): os números dos pedidos de "Para marcar como pago na Rifei"
// vão ao sistema, que marca cada um na Rifei pela API do painel e devolve o resultado de cada pedido. Só os NÚMEROS
// dos pedidos saem da tela (nunca o extrato): o mesmo que o "Copiar os números dos pedidos" já entregava.
//
// Do contrato vêm os TIPOS (o catálogo poria o zod no pacote) e o limite de rifei-api.ts (módulo sem zod). O caminho
// é uma cópia, conferida pelo tipo e por marcar-na-rifei.test.tsx.
import type {
  ItemMarcarPagosRifei,
  ROTAS_RIFEI_API,
  RespostaMarcarPagosRifei,
} from "../../../../shared/contracts/api";
import { LIMITE_PEDIDOS_MARCAR_NA_RIFEI } from "../../../../shared/contracts/rifei-api";
import { api } from "../../../lib/api";

export type { ItemMarcarPagosRifei };

export const CAMINHO_MARCAR_PAGOS: (typeof ROTAS_RIFEI_API)["marcarPagosRifei"]["caminho"] =
  "/api/admin/rifei/marcar-pagos";

/** Cada lote espera a Rifei responder pedido a pedido: até 100 pedidos, perto de um minuto no pior caso. */
export const TEMPO_LIMITE_MARCAR_MS = 120_000;

/**
 * Marca os pedidos na Rifei em lotes de LIMITE_PEDIDOS_MARCAR_NA_RIFEI, um depois do outro, e junta os resultados na
 * ordem dos números. Um lote que falha inteiro (a Rifei recusou o token, sem configuração...) para tudo com o erro.
 */
export async function marcarPagosNaRifei(
  pedidos: readonly string[],
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaMarcarPagosRifei> {
  const resposta: RespostaMarcarPagosRifei = { itens: [], marcados: 0 };
  for (
    let inicio = 0;
    inicio < pedidos.length;
    inicio += LIMITE_PEDIDOS_MARCAR_NA_RIFEI
  ) {
    const lote = await api.post<RespostaMarcarPagosRifei>(
      CAMINHO_MARCAR_PAGOS,
      {
        pedidos: pedidos.slice(inicio, inicio + LIMITE_PEDIDOS_MARCAR_NA_RIFEI),
      },
      { ...opcoes, tempoLimiteMs: TEMPO_LIMITE_MARCAR_MS },
    );
    resposta.itens.push(...lote.itens);
    resposta.marcados += lote.marcados;
  }
  return resposta;
}
