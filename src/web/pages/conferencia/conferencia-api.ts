// Chamadas à API da conferência pelo CSV da Rifei (docs/api.md, RIFA-012): analisar o arquivo, recuperar
// as vendas perdidas (com a prévia em `simular`) e listar as recuperações feitas.
//
// Do contrato vêm só os TIPOS: importar ROTAS ou os schemas poria o zod no pacote do site (veja
// lib/api.ts). Os caminhos e os limites abaixo são cópias: o tipo confere os caminhos com ROTAS, e o
// conferencia-contrato.test.ts confere os limites e as listas.
import type {
  MapeamentoReconciliacao,
  ROTAS,
  Recuperacao,
  RespostaAnaliseReconciliacao,
  RespostaRecuperarReconciliacao,
} from "../../../shared/contracts";
import { api } from "../../lib/api";

export const CAMINHOS: {
  analisar: (typeof ROTAS)["analisarReconciliacao"]["caminho"];
  recuperar: (typeof ROTAS)["recuperarReconciliacao"]["caminho"];
  recuperacoes: (typeof ROTAS)["listarRecuperacoes"]["caminho"];
} = {
  analisar: "/api/admin/reconciliacao/analisar",
  recuperar: "/api/admin/reconciliacao/recuperar",
  recuperacoes: "/api/admin/reconciliacao/recuperacoes",
};

/** LIMITE_CARACTERES_CSV_RECONCILIACAO: caracteres do arquivo (cerca de 5 MB). */
export const LIMITE_CARACTERES_CSV = 5_000_000;
/** LIMITE_LINHAS_CSV_RECONCILIACAO: linhas de dados por arquivo. */
export const LIMITE_LINHAS_CSV = 50_000;
/** LIMITE_PEDIDOS_RECUPERAR: pedidos por "Recuperar". */
export const LIMITE_PEDIDOS_RECUPERAR = 500;

/** O arquivo pode ser grande e a rede do celular, lenta: mais tempo que o padrão do cliente. */
const TEMPO_LIMITE_MS = 60_000;

type Opcoes = { signal?: AbortSignal };

/** Compara o arquivo com o sistema. Sem `mapeamento`, a API detecta as colunas pelo cabeçalho. */
export function analisar(
  csv: string,
  mapeamento: MapeamentoReconciliacao | null,
  opcoes: Opcoes = {},
): Promise<RespostaAnaliseReconciliacao> {
  return api.post<RespostaAnaliseReconciliacao>(
    CAMINHOS.analisar,
    mapeamento ? { csv, mapeamento } : { csv },
    { tempoLimiteMs: TEMPO_LIMITE_MS, ...opcoes },
  );
}

/** `simular: true` é a prévia (nada é gravado); `false` grava (tudo ou nada, sem duplicar). */
export function recuperar(
  csv: string,
  mapeamento: MapeamentoReconciliacao,
  pedidos: readonly string[],
  simular: boolean,
  opcoes: Opcoes = {},
): Promise<RespostaRecuperarReconciliacao> {
  return api.post<RespostaRecuperarReconciliacao>(
    CAMINHOS.recuperar,
    { csv, mapeamento, pedidos, simular },
    { tempoLimiteMs: TEMPO_LIMITE_MS, ...opcoes },
  );
}

export async function listarRecuperacoes(
  opcoes: Opcoes = {},
): Promise<Recuperacao[]> {
  const resposta = await api.get<{ itens: Recuperacao[] }>(
    CAMINHOS.recuperacoes,
    opcoes,
  );
  return resposta.itens;
}
