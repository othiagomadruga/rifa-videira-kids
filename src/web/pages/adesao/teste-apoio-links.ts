// Apoio dos testes do link de vendas na Adesão (RIFA-046; só nos testes): a resposta de GET /api/admin/links-vendas
// (e do PUT do modelo) montada a partir das células do painel, como a API faria, e passada pelo schema do contrato
// (`respostaLinksVendasSchema`: `configurado` coerente com o modelo e só links `https://rifei.com.br/...`).
import {
  respostaLinksVendasSchema,
  type RespostaLinksVendas,
} from "../../../shared/contracts";
import {
  modeloLinkVendasValido,
  montarLinkDeVendas,
} from "../../../shared/contracts/link-vendas";
import type { CelulaAdesao } from "./adesao-api";

/** O exemplo da D24 (o formato real ainda não foi confirmado com a Rifei). */
export const MODELO_DE_TESTE =
  "https://rifei.com.br/{slug}?afiliado={afiliado}";
/** O `slug_rifei` da campanha fictícia. */
export const SLUG_DE_TESTE = "videira-kids";

/** O link de um afiliado com o modelo e o slug de teste. */
export function urlDeTeste(affiliateId: number): string {
  return `https://rifei.com.br/${SLUG_DE_TESTE}?afiliado=${affiliateId}`;
}

/**
 * A lista de todas as células com os links de cada afiliado vinculado (o de id maior como o vínculo mais recente),
 * montados pelo `montarLinkDeVendas` do contrato; sem modelo válido, `configurado: false` e nenhum link.
 */
export function respostaLinksDe(
  celulas: readonly CelulaAdesao[],
  modelo: string | null,
  slug: string = SLUG_DE_TESTE,
): RespostaLinksVendas {
  const configurado = modeloLinkVendasValido(modelo);
  return respostaLinksVendasSchema.parse({
    modelo,
    configurado,
    itens: celulas.map((celula) => ({
      celula_id: celula.celula_id,
      celula_nome: celula.celula_nome,
      lider_nome: celula.lider_nome,
      discipulador_id: celula.discipulador_id,
      discipulador_nome: celula.discipulador_nome,
      rede_id: celula.rede_id,
      rede_nome: celula.rede_nome,
      divisao: celula.divisao,
      links: configurado
        ? [...celula.afiliados]
            .sort((a, b) => b - a)
            .map((affiliateId) => ({
              affiliate_id: affiliateId,
              url: montarLinkDeVendas(modelo, { slug, affiliateId }),
            }))
        : [],
    })),
  });
}
