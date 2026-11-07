// Como cada lado da conferência aparece na tela: "Pago · 3 bilhetes · R$ 60,00 · 27/11/2026". Só com os
// formatadores do site (centavos, pontos de milhar e datas no fuso de Belém).
import type {
  PedidoNoArquivo,
  PedidoNoSistema,
  SituacaoAfiliadoArquivo,
  TotaisArquivo,
  TotaisVendas,
} from "../../../shared/contracts";
import {
  formatarData,
  formatarDataHora,
  formatarMoeda,
} from "../../lib/formatadores";
import { STATUS_DO_ARQUIVO, STATUS_DO_SISTEMA, plural } from "./textos";

type Celula = { id: number; nome: string } | null;

/** "3 bilhetes"; null (o arquivo não tem a coluna ou o valor é ilegível) vira "sem quantidade". */
function bilhetes(qtd: number | null): string {
  return qtd === null ? "sem quantidade" : plural(qtd, "bilhete", "bilhetes");
}

function valor(centavos: number | null): string {
  return centavos === null ? "sem valor" : formatarMoeda(centavos);
}

/** "sem afiliado" → "Sem afiliado" (para o começo de um título). */
export function comMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** A célula do afiliado, ou o que se sabe dele. */
export function textoDoAfiliado(
  situacao: SituacaoAfiliadoArquivo | "gravado",
  affiliateId: number | null,
  celula: Celula,
): string {
  if (situacao === "sem_coluna") return "afiliado: sem a coluna";
  if (situacao === "nao_reconhecido") return "afiliado não reconhecido";
  if (affiliateId === null) return "sem afiliado";
  return celula
    ? `${celula.nome} (afiliado ${affiliateId})`
    : `afiliado ${affiliateId}, sem célula`;
}

export function textoDoArquivo(lado: PedidoNoArquivo): string {
  return [
    STATUS_DO_ARQUIVO[lado.status],
    bilhetes(lado.qtd_bilhetes),
    valor(lado.total_centavos),
    textoDoAfiliado(lado.afiliado, lado.affiliate_id, lado.celula),
    lado.data === null ? null : formatarData(lado.data),
  ]
    .filter((parte) => parte !== null)
    .join(" · ");
}

export function textoDoSistema(lado: PedidoNoSistema): string {
  return [
    STATUS_DO_SISTEMA[lado.status],
    bilhetes(lado.qtd_bilhetes),
    valor(lado.total_centavos),
    textoDoAfiliado("gravado", lado.affiliate_id, lado.celula),
    lado.aprovado_em === null ? null : formatarDataHora(lado.aprovado_em),
    lado.origem === "conferencia" ? "recuperado na conferência" : null,
  ]
    .filter((parte) => parte !== null)
    .join(" · ");
}

/** "10 pedidos · 22 bilhetes · R$ 410,00" (o que o arquivo não permite contar fica de fora). */
export function textoDosTotais(totais: TotaisArquivo | TotaisVendas): string {
  const partes = [
    totais.pedidos_aprovados === null
      ? null
      : plural(totais.pedidos_aprovados, "pedido", "pedidos"),
    totais.bilhetes === null
      ? null
      : plural(totais.bilhetes, "bilhete", "bilhetes"),
    totais.total_centavos === null
      ? null
      : formatarMoeda(totais.total_centavos),
  ].filter((parte) => parte !== null);
  return partes.length === 0 ? "sem totais" : partes.join(" · ");
}
