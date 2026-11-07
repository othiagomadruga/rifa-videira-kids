// Chamadas da tela Visão geral (RIFA-009): o resumo do painel (GET /api/painel/resumo) e as células com a
// hierarquia (GET /api/admin/celulas), que dão as opções do filtro (redes e discipuladores saem delas).
//
// Do contrato: regras e tipos de shared/contracts/calculos (módulo sem zod) e, de api.ts, só o TIPO de
// ROTAS (o catálogo e os schemas poriam o zod no pacote do site). Os caminhos e a lista de escopos são
// cópias, conferidas por visao-geral-contrato.test.ts.
import type { ROTAS } from "../../../shared/contracts/api";
import {
  ORDEM_DIVISOES,
  type CelulaCalculo,
  type Divisao,
  type EscopoPainel,
  type RespostaPainelResumo,
} from "../../../shared/contracts/calculos";
import { api } from "../../lib/api";

export const CAMINHO_RESUMO: (typeof ROTAS)["painelResumo"]["caminho"] =
  "/api/painel/resumo";
export const CAMINHO_CELULAS: (typeof ROTAS)["listarCelulas"]["caminho"] =
  "/api/admin/celulas";

type EscopoComId = Exclude<EscopoPainel, "campanha" | "divisao">;

/** Escopos que pedem `id` na consulta. */
const ESCOPOS_COM_ID = [
  "rede",
  "discipulador",
  "celula",
] as const satisfies readonly EscopoComId[];

/** ESCOPOS_PAINEL do contrato, na mesma ordem. */
export const ESCOPOS = [
  "campanha",
  "divisao",
  ...ESCOPOS_COM_ID,
] as const satisfies readonly EscopoPainel[];

/** O recorte do painel, como na consulta de GET /api/painel/resumo (sem `data`: é sempre hoje). */
export type Escopo =
  | { tipo: "campanha" }
  | { tipo: "divisao"; divisao: Divisao }
  | { tipo: EscopoComId; id: number };

export const ESCOPO_CAMPANHA: Escopo = { tipo: "campanha" };

/**
 * Parâmetros da consulta, que são também os da URL da tela (`?escopo=celula&id=3`,
 * `?escopo=divisao&divisao=jovens`). A campanha toda não leva nenhum (é o padrão da API).
 */
export function paramsDoEscopo(escopo: Escopo): URLSearchParams {
  switch (escopo.tipo) {
    case "campanha":
      return new URLSearchParams();
    case "divisao":
      return new URLSearchParams({
        escopo: "divisao",
        divisao: escopo.divisao,
      });
    default:
      return new URLSearchParams({
        escopo: escopo.tipo,
        id: String(escopo.id),
      });
  }
}

const ID_VALIDO = /^[1-9]\d{0,8}$/;

const ehDivisao = (valor: string | null): valor is Divisao =>
  (ORDEM_DIVISOES as readonly (string | null)[]).includes(valor);

const ehEscopoComId = (valor: string | null): valor is EscopoComId =>
  (ESCOPOS_COM_ID as readonly (string | null)[]).includes(valor);

/** O recorte pedido na URL. O que estiver fora do contrato (escopo, id ou divisão inválidos) vira a campanha toda. */
export function escopoDosParams(params: URLSearchParams): Escopo {
  const tipo = params.get("escopo");
  if (tipo === "divisao") {
    const divisao = params.get("divisao");
    return ehDivisao(divisao) ? { tipo, divisao } : ESCOPO_CAMPANHA;
  }
  if (ehEscopoComId(tipo)) {
    const id = params.get("id");
    return id !== null && ID_VALIDO.test(id)
      ? { tipo, id: Number(id) }
      : ESCOPO_CAMPANHA;
  }
  return ESCOPO_CAMPANHA;
}

/** O mesmo texto para o mesmo recorte (a consulta): "" na campanha, "escopo=celula&id=3"... */
export function chaveDoEscopo(escopo: Escopo): string {
  return paramsDoEscopo(escopo).toString();
}

type Opcoes = { signal?: AbortSignal };

export function carregarResumo(
  escopo: Escopo,
  opcoes: Opcoes = {},
): Promise<RespostaPainelResumo> {
  const consulta = chaveDoEscopo(escopo);
  return api.get<RespostaPainelResumo>(
    consulta ? `${CAMINHO_RESUMO}?${consulta}` : CAMINHO_RESUMO,
    opcoes,
  );
}

/** O que o filtro usa de cada célula (um item de GET /api/admin/celulas traz isso e mais). */
export type CelulaDoFiltro = Pick<
  CelulaCalculo,
  | "id"
  | "nome"
  | "discipulador_id"
  | "discipulador_nome"
  | "rede_id"
  | "rede_nome"
  | "divisao"
>;

export async function carregarCelulas(
  opcoes: Opcoes = {},
): Promise<CelulaDoFiltro[]> {
  const { itens } = await api.get<{ itens: CelulaDoFiltro[] }>(
    CAMINHO_CELULAS,
    opcoes,
  );
  return itens;
}
