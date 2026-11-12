// Textos dos pedidos suspeitos: o motivo em português (um para cada código de MOTIVOS_PEDIDO_SUSPEITO, conferido
// por pedidos-suspeitos-contrato.test.ts) e o detalhe, com os números do próprio pedido. Área da coordenação:
// os valores em R$ podem aparecer.
import type {
  MotivoDesconsideracao,
  MotivoPedidoSuspeito,
  PedidoSuspeito,
} from "../../../shared/contracts";
import {
  formatarMoeda,
  formatarNumero,
  formatarPercentual,
} from "../../lib/formatadores";
import {
  TETO_BILHETES_POR_PEDIDO,
  TOLERANCIA_DESCONTO_BP,
} from "./pedidos-suspeitos-api";

export const ROTULO_MOTIVO: Record<MotivoPedidoSuspeito, string> = {
  quantidade_acima_do_teto: "Bilhetes acima do teto",
  total_acima_do_esperado: "Total acima do esperado",
  total_abaixo_do_esperado: "Total abaixo do esperado",
};

type Motivo = PedidoSuspeito["motivos"][number];

/** O motivo em português e o detalhe dele. Um código que o site ainda não conhece mostra a mensagem da API. */
export function textoDoMotivo(
  motivo: Motivo,
  pedido: PedidoSuspeito,
): { rotulo: string; detalhe: string } {
  const codigo: string = motivo.codigo;
  if (!Object.hasOwn(ROTULO_MOTIVO, codigo)) {
    return { rotulo: "Outro motivo", detalhe: motivo.mensagem };
  }
  const rotulo = ROTULO_MOTIVO[motivo.codigo];
  const total = formatarMoeda(pedido.total_centavos);
  const esperado = formatarMoeda(pedido.esperado_centavos);
  switch (motivo.codigo) {
    case "quantidade_acima_do_teto":
      return {
        rotulo,
        detalhe: `${formatarNumero(pedido.qtd_bilhetes)} bilhetes num pedido só; o teto é ${formatarNumero(TETO_BILHETES_POR_PEDIDO)} por pedido.`,
      };
    case "total_acima_do_esperado":
      return {
        rotulo,
        detalhe: `Pago ${total}, mais que bilhetes × preço do bilhete (${esperado}).`,
      };
    case "total_abaixo_do_esperado":
      return {
        rotulo,
        detalhe: `Pago ${total}: desconto de mais de ${formatarPercentual(TOLERANCIA_DESCONTO_BP)} sobre bilhetes × preço do bilhete (${esperado}).`,
      };
  }
}

/** A célula para a qual o pedido conta agora, ou por que não há uma. */
export function textoDaCelula(pedido: PedidoSuspeito): string {
  if (pedido.celula_nome !== null) return pedido.celula_nome;
  return pedido.affiliate_id === null
    ? "Sem afiliado"
    : `Afiliado ${pedido.affiliate_id}, sem célula vinculada`;
}

/** "1 pedido marcado" / "12 pedidos marcados". */
export function pedidosMarcados(quantidade: number): string {
  return quantidade === 1
    ? "1 pedido marcado"
    : `${formatarNumero(quantidade)} pedidos marcados`;
}

/** O motivo da desconsideração (D20), como no selo da tela Pedidos. */
export const ROTULO_MOTIVO_DESCONSIDERACAO: Record<
  MotivoDesconsideracao,
  string
> = {
  teste: "teste",
  fraude: "fraude",
  estorno: "estorno",
  outro: "outro",
};

/** O selo do pedido que o admin já desconsiderou: "Desconsiderado (fraude)". */
export function seloDesconsiderado(motivo: MotivoDesconsideracao): string {
  return `Desconsiderado (${ROTULO_MOTIVO_DESCONSIDERACAO[motivo]})`;
}
