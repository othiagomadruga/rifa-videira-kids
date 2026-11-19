/**
 * Montagem das respostas do link de vendas (RIFA-046, docs/decisions.md D24), pura (sem banco): recebe o que
 * db/links-vendas.ts leu e devolve o corpo das rotas, que ainda passa pelo schema estrito do contrato antes de sair.
 *
 * - O link de cada afiliado sai SÓ de `montarLinkDeVendas` (contrato): nunca se junta texto à mão. Null (modelo vazio
 *   ou com problema, slug que não forma um link, id fora do formato) nunca vira erro: o afiliado fica sem link e, sem
 *   modelo que sirva, `configurado` é false e nenhuma célula tem link.
 * - Ordem das células: pelo caminho na hierarquia, como a lista dos acessos (rede, discipulador e célula, em ordem de
 *   português; empate, pelo id; lib/ordem-hierarquia.ts).
 * - Ordem dos links de uma célula: do vínculo mais recente para o mais antigo (`vinculado_em` decrescente; empate,
 *   `affiliate_id` decrescente). O primeiro é o que a tela destaca; todos contam para a célula.
 * - Cada célula é montada campo a campo (nunca o espalhamento da linha): um campo novo na consulta não chega à
 *   resposta, e o schema estrito ainda recusaria.
 */
import {
  modeloLinkVendasValido,
  montarLinkDeVendas,
  type Alvo,
  type CelulaLinksVendas,
  type LinkVendasAfiliado,
  type RespostaLinksVendas,
  type RespostaMeusLinksVendas,
} from "../../shared/contracts";
import type {
  AfiliadoDoEscopo,
  CelulaDoEscopo,
  LeituraLinksVendas,
} from "../db/links-vendas";
import { compararNivel } from "./ordem-hierarquia";

/** Pelo caminho na hierarquia: rede, discipulador e célula (nome em português; empate, pelo id). */
export function pelaHierarquia(a: CelulaDoEscopo, b: CelulaDoEscopo): number {
  return (
    compararNivel(a.rede_nome, a.rede_id, b.rede_nome, b.rede_id) ||
    compararNivel(
      a.discipulador_nome,
      a.discipulador_id,
      b.discipulador_nome,
      b.discipulador_id,
    ) ||
    compararNivel(a.celula_nome, a.celula_id, b.celula_nome, b.celula_id)
  );
}

/** Do vínculo mais recente para o mais antigo; empate (mesmo instante), o maior `affiliate_id` primeiro. */
export function doVinculoMaisRecente(
  a: AfiliadoDoEscopo,
  b: AfiliadoDoEscopo,
): number {
  if (a.vinculado_em !== b.vinculado_em)
    return a.vinculado_em < b.vinculado_em ? 1 : -1;
  return b.affiliate_id - a.affiliate_id;
}

/** `configurado` e as células com os links: o miolo das duas respostas. */
export function montarItensLinksVendas({
  campanha,
  celulas,
  afiliados,
}: LeituraLinksVendas): {
  configurado: boolean;
  itens: CelulaLinksVendas[];
} {
  const modelo = campanha.link_vendas_modelo;
  const configurado = modeloLinkVendasValido(modelo);
  const linksPorCelula = new Map<number, LinkVendasAfiliado[]>();
  if (configurado)
    for (const afiliado of [...afiliados].sort(doVinculoMaisRecente)) {
      const url = montarLinkDeVendas(modelo, {
        slug: campanha.slug_rifei,
        affiliateId: afiliado.affiliate_id,
        codigo: afiliado.codigo_rifei,
      });
      // Sem link (o slug não forma um endereço, o id fora do formato): o afiliado fica de fora, sem erro.
      if (url === null) continue;
      const links = linksPorCelula.get(afiliado.celula_id) ?? [];
      links.push({ affiliate_id: afiliado.affiliate_id, url });
      linksPorCelula.set(afiliado.celula_id, links);
    }
  return {
    configurado,
    itens: [...celulas].sort(pelaHierarquia).map((celula) => ({
      celula_id: celula.celula_id,
      celula_nome: celula.celula_nome,
      lider_nome: celula.lider_nome,
      discipulador_id: celula.discipulador_id,
      discipulador_nome: celula.discipulador_nome,
      rede_id: celula.rede_id,
      rede_nome: celula.rede_nome,
      divisao: celula.divisao,
      links: linksPorCelula.get(celula.celula_id) ?? [],
    })),
  };
}

/** GET /api/admin/links-vendas e a resposta do PUT do modelo: o modelo como está gravado e todas as células. */
export function montarRespostaLinksVendas(
  leitura: LeituraLinksVendas,
): RespostaLinksVendas {
  return {
    modelo: leitura.campanha.link_vendas_modelo,
    ...montarItensLinksVendas(leitura),
  };
}

/** GET /api/minha/links-vendas: o alvo da sessão (campo a campo) e as células dele, sem o modelo. */
export function montarRespostaMeusLinksVendas(
  leitura: LeituraLinksVendas,
  { tipo, id, nome, divisao }: Alvo,
): RespostaMeusLinksVendas {
  return {
    alvo: { tipo, id, nome, divisao },
    ...montarItensLinksVendas(leitura),
  };
}
