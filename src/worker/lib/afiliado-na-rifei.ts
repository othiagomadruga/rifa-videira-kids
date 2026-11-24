/**
 * RIFA-091 (adendo da D41): depois de atribuir à mão a célula de um pedido (PUT /api/admin/pedidos/:id/celula), liga a
 * venda ao afiliado da célula também na Rifei, para o líder (afiliado) ver a venda no painel dele de lá.
 *
 * Só com `celula_id` (não um "desfazer"), num pedido SEM afiliado no sistema e com a célula de exatamente um afiliado
 * vinculado: `GET raffles/<slug>` (o id da campanha na Rifei) e `PUT raffles/<raffleId>/orders/<pedido>/link-affiliate`.
 * Se a Rifei aceitar, o sistema grava o `affiliate_id` no pedido por conta própria (a Rifei não manda webhook nessa
 * troca). Em qualquer outro caso a atribuição no sistema vale do mesmo jeito: a Rifei nunca faz a rota falhar.
 * Cada chamada à Rifei entra na trilha (`pedido.vincular_afiliado_rifei`); o token nunca sai de lib/rifei-conexao.ts.
 */
import {
  MENSAGEM_FALHA_RIFEI,
  type ItemPedido,
  type RifeiNaAtribuicao,
} from "../../shared/contracts";
import type { Autoria } from "../db/auditoria";
import { buscarCampanhaAtiva } from "../db/campanha";
import {
  afiliadosDaCelula,
  gravarAfiliadoDaRifei,
  registrarTentativaNaRifei,
  type TentativaNaRifei,
} from "../db/celula-atribuida";
import { FalhaRifei, type VinculoAfiliadoNaRifei } from "./rifei-api";
import { abrirConexaoRifei, registrarUsoDaConexao } from "./rifei-conexao";

export interface AtribuicaoNaRifei {
  /** O pedido como a lista mostra: com `vinculado`, lido de novo (com o `affiliate_id` gravado). */
  item: ItemPedido;
  rifei: RifeiNaAtribuicao;
}

/** O resultado da chamada à Rifei, já sem exceção. */
type Chamada =
  VinculoAfiliadoNaRifei | { tipo: "falha"; motivo: FalhaRifei["motivo"] };

/**
 * Liga na Rifei a venda que acabou de ser atribuída (ou reatribuída à mesma célula) à célula `celulaId`. `item` é o
 * pedido como a atribuição devolveu.
 */
export async function ligarAfiliadoNaRifei(
  env: Cloudflare.Env,
  item: ItemPedido,
  celulaId: number | null,
  autoria: Autoria,
): Promise<AtribuicaoNaRifei> {
  const db = env.DB;
  const com = (rifei: RifeiNaAtribuicao): AtribuicaoNaRifei => ({
    item,
    rifei,
  });
  if (celulaId === null || item.affiliate_id !== null)
    return com({ situacao: "nao_se_aplica" });

  const afiliados = await afiliadosDaCelula(db, celulaId);
  if (afiliados.length === 0) return com({ situacao: "celula_sem_afiliado" });
  if (afiliados.length > 1) return com({ situacao: "varios_afiliados" });
  const conexao = await abrirConexaoRifei(env);
  if (typeof conexao === "string") return com({ situacao: "sem_conexao" });
  const campanha = await buscarCampanhaAtiva(db);
  // A atribuição acabou de conferir a campanha ativa: sem ela aqui, foi trocada no meio (não chama a Rifei).
  if (!campanha) return com({ situacao: "nao_se_aplica" });

  const tentativa: TentativaNaRifei = {
    pedidoId: item.id,
    affiliateId: afiliados[0],
    celulaId,
  };
  let chamada: Chamada;
  try {
    const campanhaRifei = await conexao.api.buscarCampanha(campanha.slug_rifei);
    chamada = await conexao.api.vincularAfiliadoAoPedido(
      campanhaRifei.id,
      tentativa.pedidoId,
      tentativa.affiliateId,
    );
  } catch (erro) {
    // O cliente converte rede, tempo e respostas da Rifei em FalhaRifei; outro erro aqui também não derruba a rota.
    chamada = {
      tipo: "falha",
      motivo: erro instanceof FalhaRifei ? erro.motivo : "resposta_inesperada",
    };
  } finally {
    await registrarUsoDaConexao(db, conexao);
  }

  if (chamada.tipo === "vinculado") {
    const lido = await gravarAfiliadoDaRifei(db, tentativa, autoria);
    return { item: lido ?? item, rifei: { situacao: "vinculado" } };
  }
  if (chamada.tipo === "recusado") {
    await registrarTentativaNaRifei(db, tentativa, "recusado", autoria);
    return com(
      chamada.mensagem === null
        ? { situacao: "recusado" }
        : { situacao: "recusado", mensagem: chamada.mensagem },
    );
  }
  const situacao =
    chamada.motivo === "indisponivel" ? "indisponivel" : "falhou";
  await registrarTentativaNaRifei(
    db,
    tentativa,
    situacao === "falhou" ? `falhou (${chamada.motivo})` : situacao,
    autoria,
  );
  return com({ situacao, mensagem: MENSAGEM_FALHA_RIFEI[chamada.motivo] });
}
