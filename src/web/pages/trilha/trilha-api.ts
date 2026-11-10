// Chamada da tela Trilha (só admin): GET /api/admin/auditoria (docs/api.md), do mais novo para o mais antigo,
// por páginas com cursor (`limite` e `antes_de`; a rota não tem filtro por ação).
//
// Do contrato vêm só os TIPOS: os valores de src/shared/contracts poriam o zod no pacote do site (veja
// lib/api.ts). O caminho e o tamanho da página são cópias, conferidas pelo tipo e por trilha-contrato.test.ts.
import type { RespostaAuditoria } from "../../../shared/contracts";
import type { ROTAS } from "../../../shared/contracts/api";
import { ErroApi, api } from "../../lib/api";

export const CAMINHO_AUDITORIA: (typeof ROTAS)["auditoria"]["caminho"] =
  "/api/admin/auditoria";

/** PAGINA_AUDITORIA_PADRAO do contrato: registros por página. */
export const ITENS_POR_PAGINA = 50;

/** "/api/admin/auditoria?limite=50" e, da segunda página em diante, "&antes_de=<proximo>". */
export function caminhoDaPagina(antesDe: number | null): string {
  const consulta = new URLSearchParams({ limite: String(ITENS_POR_PAGINA) });
  if (antesDe !== null) consulta.set("antes_de", String(antesDe));
  return `${CAMINHO_AUDITORIA}?${consulta.toString()}`;
}

export function carregarPagina(
  antesDe: number | null,
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaAuditoria> {
  return api.get<RespostaAuditoria>(caminhoDaPagina(antesDe), opcoes);
}

/** 403: a sessão não tem o papel admin (ex.: o papel mudou com a tela aberta). */
export function ehSemPermissao(erro: unknown): boolean {
  return erro instanceof ErroApi && erro.status === 403;
}
