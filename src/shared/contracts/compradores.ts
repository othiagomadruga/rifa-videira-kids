/**
 * Compradores, só para o admin (RIFA-076, D36): o nome e o telefone de quem reservou ou comprou, e a planilha
 * "Exportar compradores" (GET /api/admin/pedidos/compradores, em CSV com BOM e ";", que abre direto no Excel em
 * pt-BR). Regras puras, sem zod, para o Worker e o site.
 *
 * Uma linha por comprador: os pedidos da campanha ativa (sem os desconsiderados pelo admin, D20) juntados pelo
 * telefone; sem telefone, pelo nome (sem diferenciar maiúsculas, acentos e espaços); sem os dois, o pedido fica de
 * fora (não há quem agradecer).
 */
import {
  celulaCsv,
  formatarCentavosCsv,
  formatarInteiroCsv,
  BOM_UTF8,
  FIM_DE_LINHA_CSV_RELATORIO,
  PREFIXO_ARQUIVO_RELATORIO,
  SEPARADOR_CSV_RELATORIO,
  TIPO_CONTEUDO_CSV,
} from "./relatorio";

/** As colunas da planilha, na ordem. */
export const COLUNAS_COMPRADORES = [
  "Nome",
  "Telefone",
  "Célula(s)",
  "Qtd. de pedidos",
  "Qtd. de bilhetes",
  "Total pago (R$)",
  "Primeira compra",
  "Última compra",
  "Situação",
] as const;

/** Situação do comprador: pagou ao menos um pedido, ou só reservou (pendentes ou expirados). */
export const SITUACAO_COMPRADOR = {
  pagou: "Pagou",
  so_reservou: "Só reservou",
} as const;

/**
 * Telefone legível no Brasil: "+5511987654321" → "(11) 98765-4321"; "+559133334444" → "(91) 3333-4444". Fora do
 * Brasil (ou um número brasileiro fora do padrão), o E.164 como veio. null → "".
 */
export function formatarTelefoneBr(telefone: string | null): string {
  if (telefone === null) return "";
  const brasil = /^\+55([1-9]{2})(\d{4,5})(\d{4})$/.exec(telefone);
  return brasil ? `(${brasil[1]}) ${brasil[2]}-${brasil[3]}` : telefone;
}

/** O número para o link `https://wa.me/<numero>` (só algarismos, com o país); null sem telefone. */
export function numeroWhatsApp(telefone: string | null): string | null {
  if (telefone === null) return null;
  const digitos = telefone.replace(/\D/g, "");
  return digitos.length >= 8 ? digitos : null;
}

/** A chave do nome para juntar compradores sem telefone: sem acento, sem maiúsculas, espaços juntados. */
export function chaveDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Um pedido como a exportação o lê (a campanha ativa, sem desconsiderados). */
export interface PedidoDoComprador {
  nome: string | null;
  telefone: string | null;
  status: "in_process" | "approved" | "expired";
  qtd_bilhetes: number;
  total_centavos: number;
  celula_nome: string | null;
  /** Quando foi reservado (criado_em; sem ele, registrado_em), instante ISO UTC. */
  reservado_em: string;
}

export interface LinhaComprador {
  nome: string;
  telefone: string | null;
  celulas: string[];
  pedidos: number;
  bilhetes: number;
  /** Só os pedidos pagos (approved). */
  pago_centavos: number;
  primeira: string;
  ultima: string;
  pagou: boolean;
}

/**
 * Junta os pedidos por comprador: pelo telefone; sem telefone, pelo nome. O nome da linha é o do pedido mais recente
 * que tem nome. Quantidades e datas contam todos os pedidos (pagos, pendentes e expirados); o total pago, só os pagos.
 * Com `soPagou`, só quem pagou ao menos um pedido. Ordem: pelo nome (pt-BR), depois pelo telefone.
 */
export function agruparCompradores(
  pedidos: readonly PedidoDoComprador[],
  opcoes: { soPagou?: boolean } = {},
): LinhaComprador[] {
  const grupos = new Map<string, LinhaComprador & { nomeEm: string }>();
  for (const pedido of pedidos) {
    const chave =
      pedido.telefone !== null
        ? `t:${pedido.telefone}`
        : pedido.nome !== null && chaveDoNome(pedido.nome) !== ""
          ? `n:${chaveDoNome(pedido.nome)}`
          : null;
    if (chave === null) continue;
    const atual = grupos.get(chave);
    const pago = pedido.status === "approved";
    if (!atual) {
      grupos.set(chave, {
        nome: pedido.nome ?? "",
        nomeEm: pedido.nome === null ? "" : pedido.reservado_em,
        telefone: pedido.telefone,
        celulas: pedido.celula_nome === null ? [] : [pedido.celula_nome],
        pedidos: 1,
        bilhetes: pedido.qtd_bilhetes,
        pago_centavos: pago ? pedido.total_centavos : 0,
        primeira: pedido.reservado_em,
        ultima: pedido.reservado_em,
        pagou: pago,
      });
      continue;
    }
    if (pedido.nome !== null && pedido.reservado_em > atual.nomeEm) {
      atual.nome = pedido.nome;
      atual.nomeEm = pedido.reservado_em;
    }
    if (
      pedido.celula_nome !== null &&
      !atual.celulas.includes(pedido.celula_nome)
    )
      atual.celulas.push(pedido.celula_nome);
    atual.pedidos += 1;
    atual.bilhetes += pedido.qtd_bilhetes;
    if (pago) atual.pago_centavos += pedido.total_centavos;
    if (pedido.reservado_em < atual.primeira)
      atual.primeira = pedido.reservado_em;
    if (pedido.reservado_em > atual.ultima) atual.ultima = pedido.reservado_em;
    atual.pagou ||= pago;
  }
  const comparar = new Intl.Collator("pt-BR", { sensitivity: "base" });
  return [...grupos.values()]
    .filter((linha) => !opcoes.soPagou || linha.pagou)
    .map((linha): LinhaComprador => ({
      nome: linha.nome,
      telefone: linha.telefone,
      celulas: [...linha.celulas].sort(comparar.compare),
      pedidos: linha.pedidos,
      bilhetes: linha.bilhetes,
      pago_centavos: linha.pago_centavos,
      primeira: linha.primeira,
      ultima: linha.ultima,
      pagou: linha.pagou,
    }))
    .sort(
      (a, b) =>
        comparar.compare(a.nome, b.nome) ||
        (a.telefone ?? "").localeCompare(b.telefone ?? ""),
    );
}

/** "2026-11-23T13:05:00.000Z" → "23/11/2026 10:05" no fuso da campanha. */
export function formatarDataHoraCsv(instante: string, fuso: string): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: fuso,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instante))
      .map((parte) => [parte.type, parte.value]),
  );
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`;
}

/** A planilha inteira (BOM, cabeçalho, uma linha por comprador; cada célula por celulaCsv, contra fórmula). */
export function montarCsvCompradores(
  linhas: readonly LinhaComprador[],
  fuso: string,
): string {
  const texto = [
    [...COLUNAS_COMPRADORES],
    ...linhas.map((linha) => [
      linha.nome,
      formatarTelefoneBr(linha.telefone),
      linha.celulas.join(", "),
      formatarInteiroCsv(linha.pedidos),
      formatarInteiroCsv(linha.bilhetes),
      formatarCentavosCsv(linha.pago_centavos),
      formatarDataHoraCsv(linha.primeira, fuso),
      formatarDataHoraCsv(linha.ultima, fuso),
      linha.pagou ? SITUACAO_COMPRADOR.pagou : SITUACAO_COMPRADOR.so_reservou,
    ]),
  ].map(
    (celulas) =>
      celulas.map(celulaCsv).join(SEPARADOR_CSV_RELATORIO) +
      FIM_DE_LINHA_CSV_RELATORIO,
  );
  return BOM_UTF8 + texto.join("");
}

/** `rifa-videira-kids-compradores-<AAAA-MM-DD>.csv` (a data de hoje no fuso da campanha). */
export function nomeDoArquivoCompradores(data: string): string {
  return `${PREFIXO_ARQUIVO_RELATORIO}-compradores-${data}.csv`;
}

/** Os cabeçalhos da resposta 200: CSV, anexo e no-store (dado pessoal nunca fica em cache). */
export function cabecalhosDosCompradores(data: string): {
  "Content-Type": typeof TIPO_CONTEUDO_CSV;
  "Content-Disposition": string;
  "Cache-Control": "no-store";
} {
  return {
    "Content-Type": TIPO_CONTEUDO_CSV,
    "Content-Disposition": `attachment; filename="${nomeDoArquivoCompradores(data)}"`,
    "Cache-Control": "no-store",
  };
}
