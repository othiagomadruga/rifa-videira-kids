// Chamadas à API da conferência pelo CSV da Rifei (docs/api.md, RIFA-012): a campanha (o fuso das datas do
// arquivo), analisar o corpo compacto, recuperar as vendas perdidas (com a prévia em `simular`) e listar
// as recuperações feitas. O arquivo NÃO vai para a API: a tela o lê (src/shared/conferencia) e manda só as
// colunas mapeadas que não são de dado pessoal.
//
// Do contrato da API vêm só os TIPOS: importar ROTAS ou os schemas poria o zod no pacote do site (veja
// lib/api.ts). Os caminhos são cópias, e o tipo os confere com ROTAS.
import type {
  Campanha,
  CorpoConferencia,
  ROTAS,
  RespostaAnaliseReconciliacao,
  RespostaListaRecuperacoes,
  RespostaRecuperarReconciliacao,
} from "../../../shared/contracts";
import { ErroApi, api } from "../../lib/api";

export const CAMINHOS: {
  campanha: (typeof ROTAS)["obterCampanha"]["caminho"];
  analisar: (typeof ROTAS)["analisarReconciliacao"]["caminho"];
  recuperar: (typeof ROTAS)["recuperarReconciliacao"]["caminho"];
  recuperacoes: (typeof ROTAS)["listarRecuperacoes"]["caminho"];
} = {
  campanha: "/api/admin/campanha",
  analisar: "/api/admin/reconciliacao/analisar",
  recuperar: "/api/admin/reconciliacao/recuperar",
  recuperacoes: "/api/admin/reconciliacao/recuperacoes",
};

/** O corpo pode ter umas centenas de KB e a rede do celular é lenta: mais tempo que o padrão do cliente. */
const TEMPO_LIMITE_MS = 60_000;

type Opcoes = { signal?: AbortSignal };

/** O que a conferência usa da campanha ativa: o fuso das datas do arquivo. null sem campanha (404). */
export async function carregarFusoDaCampanha(
  opcoes: Opcoes = {},
): Promise<string | null> {
  try {
    const campanha = await api.get<Campanha>(CAMINHOS.campanha, opcoes);
    return campanha.fuso_horario;
  } catch (erro) {
    if (
      erro instanceof ErroApi &&
      erro.status === 404 &&
      erro.codigo === "nao_encontrado"
    )
      return null;
    throw erro;
  }
}

/** Compara o corpo (montado na tela) com o sistema. */
export function analisar(
  corpo: CorpoConferencia,
  opcoes: Opcoes = {},
): Promise<RespostaAnaliseReconciliacao> {
  return api.post<RespostaAnaliseReconciliacao>(CAMINHOS.analisar, corpo, {
    tempoLimiteMs: TEMPO_LIMITE_MS,
    ...opcoes,
  });
}

/** `simular: true` é a prévia (nada é gravado); `false` grava (tudo ou nada, sem duplicar). */
export function recuperar(
  corpo: CorpoConferencia,
  pedidos: readonly string[],
  simular: boolean,
  opcoes: Opcoes = {},
): Promise<RespostaRecuperarReconciliacao> {
  return api.post<RespostaRecuperarReconciliacao>(
    CAMINHOS.recuperar,
    { ...corpo, pedidos, simular },
    { tempoLimiteMs: TEMPO_LIMITE_MS, ...opcoes },
  );
}

/**
 * Uma página das recuperações da campanha ativa (50, a mais recente primeiro). `antesDe` é o `proximo`
 * da página anterior; null, a primeira página.
 */
export function listarRecuperacoes(
  antesDe: number | null = null,
  opcoes: Opcoes = {},
): Promise<RespostaListaRecuperacoes> {
  const consulta = antesDe === null ? "" : `?antes_de=${antesDe}`;
  return api.get<RespostaListaRecuperacoes>(
    `${CAMINHOS.recuperacoes}${consulta}`,
    opcoes,
  );
}
