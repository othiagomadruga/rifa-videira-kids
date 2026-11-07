/**
 * Plausibilidade de um pedido aprovado pelo webhook (RIFA-013b). Quem tem o token do webhook consegue
 * mandar um `paid_order` inventado; a Rifei não reenvia, então o webhook nunca recusa por isso. O pedido
 * implausível é GRAVADO e CONTA nas vendas, mas fica marcado (webhook_eventos.avisos e pedidos_suspeitos)
 * para a coordenação revisar em GET /api/admin/pedidos/suspeitos. Tirar um pedido das vendas é decisão
 * do PO.
 *
 * Regras (constantes no contrato, api.ts):
 * - mais de TETO_BILHETES_POR_PEDIDO bilhetes num pedido só;
 * - total maior que bilhetes × preço do bilhete da campanha (o desconto só baixa o total);
 * - total abaixo de bilhetes × preço menos TOLERANCIA_DESCONTO_BP (cupom e promoção cabem na folga).
 * As mensagens são fixas: nunca trazem o valor recebido (formato DetalheResumido, como os avisos).
 */
import {
  TETO_BILHETES_POR_PEDIDO,
  TOLERANCIA_DESCONTO_BP,
  type MotivoPedidoSuspeito,
} from "../../shared/contracts";

/** Um motivo no formato DetalheResumido, com o código do contrato. */
export interface MotivoSuspeita {
  caminho: string[];
  codigo: MotivoPedidoSuspeito;
  mensagem: string;
  ocorrencias: number;
}

export interface PedidoParaAvaliar {
  qtdBilhetes: number;
  totalCentavos: number;
  /** Preço do bilhete da campanha ativa. */
  precoBilheteCentavos: number;
}

export interface Suspeita {
  motivos: MotivoSuspeita[];
  /** qtdBilhetes × preço (limitado ao maior inteiro seguro, para caber no contrato). */
  esperadoCentavos: number;
}

const PERCENTUAL_TOLERANCIA = TOLERANCIA_DESCONTO_BP / 100;

const MENSAGENS: Record<MotivoPedidoSuspeito, string> = {
  quantidade_acima_do_teto: `Mais de ${TETO_BILHETES_POR_PEDIDO} bilhetes num pedido só: confira na Rifei (o pedido continua contando)`,
  total_acima_do_esperado:
    "Total maior que bilhetes × preço do bilhete da campanha: confira na Rifei (o pedido continua contando)",
  total_abaixo_do_esperado: `Total abaixo de bilhetes × preço do bilhete da campanha com mais de ${PERCENTUAL_TOLERANCIA}% de desconto: confira na Rifei (o pedido continua contando)`,
};

function motivo(
  codigo: MotivoPedidoSuspeito,
  campo: "numbers_count" | "total",
): MotivoSuspeita {
  return {
    caminho: [campo],
    codigo,
    mensagem: MENSAGENS[codigo],
    ocorrencias: 1,
  };
}

/**
 * Os motivos para marcar o pedido, ou null se ele é plausível. A conta é feita com BigInt: bilhetes ×
 * preço × pontos-base pode passar do maior inteiro seguro do JavaScript.
 */
export function avaliarPlausibilidade({
  qtdBilhetes,
  totalCentavos,
  precoBilheteCentavos,
}: PedidoParaAvaliar): Suspeita | null {
  const esperado = BigInt(qtdBilhetes) * BigInt(precoBilheteCentavos);
  const total = BigInt(totalCentavos);
  const motivos: MotivoSuspeita[] = [];
  if (qtdBilhetes > TETO_BILHETES_POR_PEDIDO)
    motivos.push(motivo("quantidade_acima_do_teto", "numbers_count"));
  if (total > esperado) {
    motivos.push(motivo("total_acima_do_esperado", "total"));
  } else if (
    total * 10_000n <
    esperado * BigInt(10_000 - TOLERANCIA_DESCONTO_BP)
  ) {
    motivos.push(motivo("total_abaixo_do_esperado", "total"));
  }
  if (motivos.length === 0) return null;
  const maximo = BigInt(Number.MAX_SAFE_INTEGER);
  return {
    motivos,
    esperadoCentavos: Number(esperado < maximo ? esperado : maximo),
  };
}
