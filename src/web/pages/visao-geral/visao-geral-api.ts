// Chamadas da tela Visão geral (RIFA-009): o resumo do painel (GET /api/painel/resumo) e as células com a
// hierarquia (GET /api/admin/celulas), que dão as opções do filtro (redes, discipuladores e, pelo grupo efetivo de cada
// célula, os grupos saem delas), com a ordem dos grupos (GET /api/admin/grupos, RIFA-092); o
// relatório da campanha para baixar (GET /api/painel/relatorio?tipo=..., RIFA-038, D23); e, só para o admin, quanto
// entrou (GET /api/admin/arrecadado, RIFA-087, adendo da D40).
//
// Do contrato: regras e tipos de shared/contracts/calculos e de shared/contracts/relatorio (módulos sem zod)
// e, de api.ts, só o TIPO dos catálogos (o catálogo e os schemas poriam o zod no pacote do site). Os caminhos
// e a lista de escopos são cópias, conferidas por visao-geral-contrato.test.ts.
import type {
  ROTAS,
  ROTAS_ARRECADADO,
  ROTAS_RELATORIO,
  RespostaArrecadado,
} from "../../../shared/contracts/api";
import type { Celula, Grupo } from "../../../shared/contracts/dominio";
import {
  ORDEM_DIVISOES,
  type CelulaCalculo,
  type Divisao,
  type EscopoPainel,
  type RespostaPainelResumo,
} from "../../../shared/contracts/calculos";
import {
  PREFIXO_ARQUIVO_RELATORIO,
  type TipoRelatorio,
} from "../../../shared/contracts/relatorio";
import { api, baixarArquivo } from "../../lib/api";

export const CAMINHO_RESUMO: (typeof ROTAS)["painelResumo"]["caminho"] =
  "/api/painel/resumo";
export const CAMINHO_CELULAS: (typeof ROTAS)["listarCelulas"]["caminho"] =
  "/api/admin/celulas";
export const CAMINHO_GRUPOS: (typeof ROTAS)["listarGrupos"]["caminho"] =
  "/api/admin/grupos";
export const CAMINHO_RELATORIO: (typeof ROTAS_RELATORIO)["baixarRelatorio"]["caminho"] =
  "/api/painel/relatorio";
export const CAMINHO_ARRECADADO: (typeof ROTAS_ARRECADADO)["arrecadado"]["caminho"] =
  "/api/admin/arrecadado";

type EscopoComId = Exclude<EscopoPainel, "campanha" | "divisao">;

/** Escopos que pedem `id` na consulta. */
const ESCOPOS_COM_ID = [
  "grupo",
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
 * Parâmetros da consulta, que são também os da URL da tela (`?escopo=celula&id=3`, `?escopo=grupo&id=1`,
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

/**
 * O que o filtro usa de cada célula (um item de GET /api/admin/celulas traz isso e mais). O grupo efetivo (RIFA-092: o
 * próprio da célula, senão o do discipulador) dá as opções do grupo; ausente ou null, a célula não está em nenhum.
 */
export type CelulaDoFiltro = Pick<
  CelulaCalculo,
  | "id"
  | "nome"
  | "discipulador_id"
  | "discipulador_nome"
  | "rede_id"
  | "rede_nome"
  | "divisao"
> &
  Partial<Pick<Celula, "grupo_efetivo_id" | "grupo_efetivo_nome">>;

/** Um grupo de GET /api/admin/grupos, que já vem na ordem da tela (`ordem`; empate, o nome). */
export type GrupoDoFiltro = Pick<Grupo, "id" | "nome">;

export async function carregarCelulas(
  opcoes: Opcoes = {},
): Promise<CelulaDoFiltro[]> {
  const { itens } = await api.get<{ itens: CelulaDoFiltro[] }>(
    CAMINHO_CELULAS,
    opcoes,
  );
  return itens;
}

/** Os grupos na ordem da tela (Adultos da manhã, Adultos da noite, Jovens, Adolescentes), para ordenar o filtro. */
export async function carregarGrupos(
  opcoes: Opcoes = {},
): Promise<GrupoDoFiltro[]> {
  const { itens } = await api.get<{ itens: GrupoDoFiltro[] }>(
    CAMINHO_GRUPOS,
    opcoes,
  );
  return itens;
}

/** Nome do arquivo quando a resposta não traz o `Content-Disposition` (D23): `rifa-videira-kids-<tipo>.csv`. */
export function nomeReservaDoRelatorio(tipo: TipoRelatorio): string {
  return `${PREFIXO_ARQUIVO_RELATORIO}-${tipo}.csv`;
}

/** A consulta do relatório: `tipo=celulas` (o tipo é obrigatório; sem `data`, é sempre o retrato de agora). */
export function consultaDoRelatorio(tipo: TipoRelatorio): URLSearchParams {
  return new URLSearchParams({ tipo });
}

/**
 * Baixa o relatório do tipo (o navegador salva o arquivo) e devolve o nome do arquivo: o da resposta
 * (`rifa-videira-kids-<tipo>-<data>.csv`) ou, sem ele, o de reserva.
 */
export function baixarRelatorio(
  tipo: TipoRelatorio,
  opcoes: Opcoes = {},
): Promise<string> {
  return baixarArquivo(`${CAMINHO_RELATORIO}?${consultaDoRelatorio(tipo)}`, {
    ...opcoes,
    nomeReserva: nomeReservaDoRelatorio(tipo),
  });
}

/** Quanto entrou: a campanha e hoje (só o admin: a coordenação leva 403, e a tela nem pede). */
export function carregarArrecadado(
  opcoes: Opcoes = {},
): Promise<RespostaArrecadado> {
  return api.get<RespostaArrecadado>(CAMINHO_ARRECADADO, opcoes);
}
