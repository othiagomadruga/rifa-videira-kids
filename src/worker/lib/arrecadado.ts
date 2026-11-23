/**
 * Quanto entrou (RIFA-087, adendo da D40): a soma dos pedidos pagos que a Rifei manda pelo webhook (D2, D32), do
 * banco. Nada é perguntado à Efí nem à Rifei. PURO (sem banco, sem relógio): a entrada é a da leitura do painel
 * (db/painel.ts), com os pedidos aprovados da campanha, sem os desconsiderados (D20), agrupados por célula e dia local.
 *
 * - `totaisDoDia`: um dia (no fuso da campanha), com as vendas sem célula. É a MESMA fonte de `vendas` do resumo do
 *   painel no escopo campanha, só filtrada pelo dia: o "No dia" do e-mail e o "Hoje" do cartão do admin.
 * - `montarArrecadado`: a resposta de GET /api/admin/arrecadado (o cartão "Arrecadado" da Visão geral): o total da
 *   campanha até agora (o `vendas` do resumo do painel, o mesmo número grande do e-mail) e o de hoje.
 */
import {
  montarResumoPainel,
  type EntradaCalculo,
  type RespostaArrecadado,
  type TotaisVendas,
} from "../../shared/contracts";

/** As vendas pagas de `data` (dia local), de todas as células e as sem célula. */
export function totaisDoDia(
  entrada: EntradaCalculo,
  data: string,
): TotaisVendas {
  const totais: TotaisVendas = {
    pedidos_aprovados: 0,
    bilhetes: 0,
    total_centavos: 0,
  };
  for (const venda of entrada.vendas) {
    if (venda.dia !== data) continue;
    totais.pedidos_aprovados += venda.pedidos;
    totais.bilhetes += venda.bilhetes;
    totais.total_centavos += venda.centavos;
  }
  for (const valor of Object.values(totais))
    if (!Number.isSafeInteger(valor))
      throw new RangeError("Soma do dia fora do limite seguro");
  return totais;
}

/** O cartão "Arrecadado": a campanha até agora e hoje (null fora das datas da campanha). */
export function montarArrecadado(
  entrada: EntradaCalculo,
  agora: Date,
): RespostaArrecadado {
  const { campanha } = entrada;
  const resumo = montarResumoPainel(
    entrada,
    {
      escopo: {
        tipo: "campanha",
        id: null,
        divisao: null,
        nome: campanha.nome,
      },
    },
    agora,
  );
  const hoje = resumo.referencia.data;
  return {
    data: hoje,
    campanha: { ...resumo.vendas },
    hoje:
      resumo.referencia.fase === "durante" ? totaisDoDia(entrada, hoje) : null,
    atualizado_em: agora.toISOString(),
  };
}
