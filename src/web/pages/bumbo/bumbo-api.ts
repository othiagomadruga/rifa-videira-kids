// Chamada da tela do bumbo (coordenação): GET /api/publico/bumbo, a rota aberta da mensagem do dia para o
// grupo de WhatsApp dos líderes. O texto já vem pronto da API e nunca traz valores em dinheiro nem
// quantidade de bilhetes (docs/regras-de-calculo.md, R9 e R10): a tela o mostra como chegou.
//
// Do contrato vêm os tipos de calculos.ts (módulo sem zod) e, de api.ts, só o TIPO do catálogo ROTAS, que
// confere o caminho copiado aqui. DIAS_DEPOIS_DO_FIM é cópia de DIAS_DO_BUMBO_DEPOIS_DO_FIM (api.ts),
// conferida em bumbo-contrato.test.ts: importar o valor poria o zod no pacote do site.
import type { ROTAS } from "../../../shared/contracts/api";
import type { RespostaBumbo } from "../../../shared/contracts/calculos";
import { ErroApi, api } from "../../lib/api";

export const CAMINHO_BUMBO: (typeof ROTAS)["bumbo"]["caminho"] =
  "/api/publico/bumbo";

/** A janela do `data` vai do 1º dia da campanha até este número de dias depois do último. */
export const DIAS_DEPOIS_DO_FIM = 1;

/** "/api/publico/bumbo" (a mensagem de hoje) ou "/api/publico/bumbo?data=2026-11-30". */
export function caminhoDoBumbo(data: string | null): string {
  return data === null
    ? CAMINHO_BUMBO
    : `${CAMINHO_BUMBO}?${new URLSearchParams({ data }).toString()}`;
}

/**
 * A mensagem do dia `data` (null = hoje: a consulta vai sem `data`, que vale em qualquer fase da
 * campanha e divide o cache com quem também pede a de hoje).
 */
export function carregarBumbo(
  data: string | null,
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaBumbo> {
  return api.get<RespostaBumbo>(caminhoDoBumbo(data), opcoes);
}

/** 404 nao_encontrado: ainda não há campanha ativa. */
export function ehSemCampanha(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 404 &&
    erro.codigo === "nao_encontrado"
  );
}
