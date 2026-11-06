// Chamadas da tela de campanha: GET e PUT /api/admin/campanha (caminhos e tipos do contrato).
import { ROTAS, type Campanha } from "../../../shared/contracts";
import { ErroApi, api } from "../../lib/api";
import type { CorpoCampanha } from "./formulario";

/** A campanha ativa, ou null enquanto ela não foi configurada (404 nao_encontrado). */
export async function carregarCampanha(
  opcoes: { signal?: AbortSignal } = {},
): Promise<Campanha | null> {
  try {
    return await api.get<Campanha>(ROTAS.obterCampanha.caminho, opcoes);
  } catch (erro) {
    if (
      erro instanceof ErroApi &&
      erro.status === 404 &&
      erro.codigo === "nao_encontrado"
    ) {
      return null;
    }
    throw erro;
  }
}

/** Cria a campanha ativa (ativação) ou substitui a configuração dela. */
export function salvarCampanha(corpo: CorpoCampanha): Promise<Campanha> {
  return api.put<Campanha>(ROTAS.salvarCampanha.caminho, corpo);
}
