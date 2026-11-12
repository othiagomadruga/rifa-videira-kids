// O link de vendas de cada célula na Adesão (RIFA-046, D24): a lista (GET /api/admin/links-vendas, admin e
// coordenação), o modelo (PUT /api/admin/links-vendas/modelo, só admin) e o slug da campanha para a prévia do
// modelo (GET /api/admin/campanha, só quando o admin edita).
//
// Do contrato vêm os tipos e as regras puras de link-vendas.ts (módulo sem zod); de api.ts, só TIPOS: os caminhos
// abaixo são cópias, conferidas por adesao-contrato.test.ts (importar o catálogo poria o zod no pacote).
import type { Campanha } from "../../../shared/contracts";
import type {
  CorpoSalvarModeloLinkVendas,
  ROTAS,
  ROTAS_LINK_VENDAS,
  RespostaLinksVendas,
} from "../../../shared/contracts/api";
import { ErroApi, api } from "../../lib/api";

export type { RespostaLinksVendas };

export const CAMINHO_LINKS_VENDAS: (typeof ROTAS_LINK_VENDAS)["linksVendas"]["caminho"] =
  "/api/admin/links-vendas";
export const CAMINHO_MODELO_LINK_VENDAS: (typeof ROTAS_LINK_VENDAS)["salvarModeloLinkVendas"]["caminho"] =
  "/api/admin/links-vendas/modelo";
export const CAMINHO_CAMPANHA: (typeof ROTAS)["obterCampanha"]["caminho"] =
  "/api/admin/campanha";

type Opcoes = { signal?: AbortSignal };

export function carregarLinks(
  opcoes: Opcoes = {},
): Promise<RespostaLinksVendas> {
  return api.get<RespostaLinksVendas>(CAMINHO_LINKS_VENDAS, opcoes);
}

/** Grava o modelo (ou null, que apaga) e devolve a lista já montada com ele. */
export function salvarModelo(
  modelo: string | null,
): Promise<RespostaLinksVendas> {
  const corpo: CorpoSalvarModeloLinkVendas = { modelo };
  return api.put<RespostaLinksVendas>(CAMINHO_MODELO_LINK_VENDAS, corpo);
}

/** O slug da campanha ativa (o `{slug}` da prévia); sem campanha (404), null. */
export async function carregarSlug(
  opcoes: Opcoes = {},
): Promise<string | null> {
  try {
    const campanha = await api.get<Partial<Campanha>>(CAMINHO_CAMPANHA, opcoes);
    return typeof campanha.slug_rifei === "string" ? campanha.slug_rifei : null;
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 404) return null;
    throw erro;
  }
}

/** Os problemas do modelo que a API mandou nos `detalhes` do 400 `requisicao_invalida` (em português). */
export function problemasDoErro(erro: unknown): string[] {
  if (
    !(erro instanceof ErroApi) ||
    erro.status !== 400 ||
    erro.codigo !== "requisicao_invalida" ||
    !Array.isArray(erro.detalhes)
  )
    return [];
  const problemas: string[] = [];
  for (const detalhe of erro.detalhes as unknown[]) {
    if (typeof detalhe !== "object" || detalhe === null) continue;
    const { caminho, mensagem } = detalhe as {
      caminho?: unknown;
      mensagem?: unknown;
    };
    if (
      Array.isArray(caminho) &&
      caminho[0] === "modelo" &&
      typeof mensagem === "string" &&
      !problemas.includes(mensagem)
    )
      problemas.push(mensagem);
  }
  return problemas;
}
