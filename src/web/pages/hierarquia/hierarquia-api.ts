// Chamadas à API da hierarquia (docs/api.md: CRUD de redes, discipuladores e células e a importação
// da planilha). Do contrato vêm só os TIPOS: importar valores de src/shared/contracts poria o zod no
// pacote do site (+29 kB gzip). Por isso os caminhos e limites abaixo são cópias, e o
// hierarquia-contrato.test.ts confere que continuam iguais aos do contrato.
import type {
  Celula,
  CelulaEntrada,
  Discipulador,
  DiscipuladorEntrada,
  Grupo,
  Rede,
  RedeEntrada,
  RespostaImportarHierarquia,
} from "../../../shared/contracts";
import { api } from "../../lib/api";

/** ROTAS.listarRedes / listarDiscipuladores / listarCelulas / listarGrupos / importarHierarquia (.caminho). */
export const CAMINHOS = {
  redes: "/api/admin/redes",
  discipuladores: "/api/admin/discipuladores",
  celulas: "/api/admin/celulas",
  // RIFA-084 (D39): os grupos do discipulador (para o seletor "Grupo").
  grupos: "/api/admin/grupos",
  importar: "/api/admin/hierarquia/importar",
} as const;

/** Tamanho máximo do texto do CSV (corpoImportarHierarquiaSchema: `csv` até 1.000.000 caracteres). */
export const LIMITE_CARACTERES_CSV = 1_000_000;
/** LIMITE_LINHAS_CSV_HIERARQUIA: linhas de dados por arquivo. */
export const LIMITE_LINHAS_CSV = 2000;

/** Modelo da planilha (public/modelos): cabeçalho COLUNAS_CSV_HIERARQUIA, ";", BOM UTF-8 e CRLF. */
export const CAMINHO_MODELO_CSV = "/modelos/hierarquia-modelo.csv";

export type Hierarquia = {
  redes: Rede[];
  discipuladores: Discipulador[];
  celulas: Celula[];
  /** RIFA-084 (D39): os grupos do discipulador, na ordem da API (a dos blocos do ranking por grupo). */
  grupos: Grupo[];
};

/** O que se edita e exclui na tela (os grupos vêm prontos da migração, sem CRUD). */
export type Recurso = "redes" | "discipuladores" | "celulas";

type Lista<T> = { itens: T[] };
type Opcoes = { signal?: AbortSignal };

/** As listas de uma vez (são pequenas: 36 células e 4 grupos). */
export async function carregarHierarquia(
  opcoes: Opcoes = {},
): Promise<Hierarquia> {
  const [redes, discipuladores, celulas, grupos] = await Promise.all([
    api.get<Lista<Rede>>(CAMINHOS.redes, opcoes),
    api.get<Lista<Discipulador>>(CAMINHOS.discipuladores, opcoes),
    api.get<Lista<Celula>>(CAMINHOS.celulas, opcoes),
    api.get<Lista<Grupo>>(CAMINHOS.grupos, opcoes),
  ]);
  return {
    redes: redes.itens,
    discipuladores: discipuladores.itens,
    celulas: celulas.itens,
    grupos: grupos.itens,
  };
}

/** PUT substitui o registro inteiro. */
export function salvarRede(id: number, dados: RedeEntrada) {
  return api.put<Rede>(`${CAMINHOS.redes}/${id}`, dados);
}

export function salvarDiscipulador(id: number, dados: DiscipuladorEntrada) {
  return api.put<Discipulador>(`${CAMINHOS.discipuladores}/${id}`, dados);
}

export function salvarCelula(id: number, dados: CelulaEntrada) {
  return api.put<Celula>(`${CAMINHOS.celulas}/${id}`, dados);
}

/** DELETE sem cascata: 409 `em_uso` quando há vínculo (docs/api.md). */
export async function excluir(recurso: Recurso, id: number): Promise<void> {
  await api.delete(`${CAMINHOS[recurso]}/${id}`);
}

/** `simular: true` só confere e conta; `false` grava (tudo ou nada). */
export function importarPlanilha(
  csv: string,
  simular: boolean,
  opcoes: Opcoes = {},
) {
  return api.post<RespostaImportarHierarquia>(
    CAMINHOS.importar,
    { csv, simular },
    { ...opcoes, tempoLimiteMs: 30_000 },
  );
}
