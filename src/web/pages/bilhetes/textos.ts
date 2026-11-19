// Textos da tela Bilhetes (RIFA-075, D35).
import type {
  SituacaoBilhete,
  SituacaoPedidoBilhete,
} from "../../../shared/contracts/bilhetes";
import type { TomBadge } from "../../components/ui";
import { formatarNumero } from "../../lib/formatadores";

export type FiltroGrade = "todos" | SituacaoBilhete;

export const FILTROS: readonly { valor: FiltroGrade; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "pago", rotulo: "Só pagos" },
  { valor: "reservado", rotulo: "Só reservados" },
  { valor: "livre", rotulo: "Só livres" },
];

export const NOME_SITUACAO: Record<SituacaoBilhete, string> = {
  pago: "Pago",
  reservado: "Reservado",
  livre: "Livre",
};

export const TOM_SITUACAO: Record<SituacaoBilhete, TomBadge> = {
  pago: "sucesso",
  reservado: "alerta",
  livre: "neutro",
};

export const NOME_SITUACAO_PEDIDO: Record<SituacaoPedidoBilhete, string> = {
  pago: "Pago",
  reservado: "Aguardando pagamento",
  expirado: "Expirado",
};

export const TOM_SITUACAO_PEDIDO: Record<SituacaoPedidoBilhete, TomBadge> = {
  pago: "sucesso",
  reservado: "alerta",
  expirado: "neutro",
};

export const DESCRICAO_TELA =
  "Quais números da rifa já estão pagos, quais estão reservados (aguardando o pagamento) e quais estão livres.";

export const DICAS = {
  atualizar:
    "Busca de novo agora. A tela também se atualiza sozinha a cada 30 segundos enquanto está aberta.",
  filtro: "Destaca na grade só os números da situação escolhida.",
  busca:
    "Digite o número do bilhete para ver o pedido dele: a célula, a situação e a data. Também dá para tocar num quadrado da grade.",
} as const;

export const plural = (n: number, um: string, varios: string) =>
  `${formatarNumero(n)} ${n === 1 ? um : varios}`;
