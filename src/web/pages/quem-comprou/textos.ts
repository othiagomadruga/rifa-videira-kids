// Textos da tela "Quem comprou" do admin (RIFA-093). A ajuda dos títulos e do campo fica em ajuda.ts (vem sob demanda,
// com as das outras telas que carregam junto com o site).

export const COMPRADOR_SEM_NOME = "Comprador sem nome";

/** As dicas dos controles (a varredura de dicas confere que todo botão tem a dele). */
export const DICAS = {
  abrir:
    "Mostra quem comprou desta célula, da compra mais recente para a mais antiga.",
  fechar: "Fecha a lista de compras desta célula.",
  verMais: "Traz as próximas compras desta célula.",
  carregandoMais: "Trazendo as próximas compras…",
  whatsapp: "Abre uma conversa no WhatsApp com quem comprou, em outra aba.",
  limparBusca: "Apaga a busca e mostra todas as células de novo.",
} as const;

/** "1 bilhete", "12 bilhetes". */
export function bilhetes(numero: number): string {
  return `${numero.toLocaleString("pt-BR")} ${numero === 1 ? "bilhete" : "bilhetes"}`;
}

/** "1 compra", "3 compras". */
export function compras(numero: number): string {
  return `${numero.toLocaleString("pt-BR")} ${numero === 1 ? "compra" : "compras"}`;
}

/** Texto para comparar na busca: sem acentos, sem maiúsculas e sem espaços nas pontas. */
export function paraBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

const formatosDoFuso = new Map<string, Intl.DateTimeFormat>();

/** "23/11 às 14:03", no fuso da campanha. */
export function quandoComprou(instante: string, fuso: string): string {
  let formato = formatosDoFuso.get(fuso);
  if (!formato) {
    formato = new Intl.DateTimeFormat("pt-BR", {
      timeZone: fuso,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatosDoFuso.set(fuso, formato);
  }
  const partes = Object.fromEntries(
    formato
      .formatToParts(new Date(instante))
      .map((parte) => [parte.type, parte.value]),
  );
  return `${partes.day}/${partes.month} às ${partes.hour}:${partes.minute}`;
}
