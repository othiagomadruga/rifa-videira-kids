// Chamadas da tela Bilhetes (coordenação e admin; RIFA-075, D35): GET /api/painel/bilhetes (a grade em mapas de bits)
// e GET /api/painel/bilhetes/:numero (os pedidos de um número, sem dado do comprador). docs/api.md, "Bilhetes".
//
// Do contrato com zod vêm só os TIPOS (os valores poriam o zod no pacote do site; veja lib/api.ts). A leitura dos
// mapas vem de contracts/bilhetes.ts, sem zod.
import type {
  ROTAS,
  RespostaBilhete,
  RespostaBilhetes,
} from "../../../shared/contracts/api";
import { ErroApi, api } from "../../lib/api";

export const CAMINHO_BILHETES: (typeof ROTAS)["painelBilhetes"]["caminho"] =
  "/api/painel/bilhetes";

export function carregarBilhetes(
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaBilhetes> {
  return api.get<RespostaBilhetes>(CAMINHO_BILHETES, opcoes);
}

export function buscarBilhete(
  numero: number,
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaBilhete> {
  return api.get<RespostaBilhete>(`${CAMINHO_BILHETES}/${numero}`, opcoes);
}

/** 404 nao_encontrado: não há campanha ativa. */
export function ehSemCampanha(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 404 &&
    erro.codigo === "nao_encontrado"
  );
}
