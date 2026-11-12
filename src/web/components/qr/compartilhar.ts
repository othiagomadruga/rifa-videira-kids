// Mandar o link de vendas (RIFA-046, D24): a mensagem fixa do WhatsApp, o endereço do wa.me e o "Copiar link".
// Sem o `qr` (este módulo vai junto com as listas de links, mesmo antes de o QR code carregar).

/**
 * A mensagem do "Enviar no WhatsApp", fixa no site (D24, suposição 8; não é editável como as mensagens da D20):
 * "Compre seus bilhetes da rifa do Videira Kids pelo link da Célula Ágape: https://rifei.com.br/...".
 */
export function mensagemWhatsAppLinkVendas(
  celulaNome: string,
  url: string,
): string {
  return `Compre seus bilhetes da rifa do Videira Kids pelo link da ${celulaNome}: ${url}`;
}

/**
 * O endereço que abre o WhatsApp com a mensagem pronta: `https://wa.me/?text=...` (a pessoa escolhe o contato) ou,
 * com o telefone do líder já no formato do wa.me (só dígitos, com o 55), `https://wa.me/<telefone>?text=...`.
 */
export function linkWhatsAppLinkVendas({
  celulaNome,
  url,
  telefone = null,
}: {
  celulaNome: string;
  url: string;
  telefone?: string | null;
}): string {
  const numero = telefone !== null && /^\d+$/.test(telefone) ? telefone : "";
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagemWhatsAppLinkVendas(celulaNome, url))}`;
}

export type ResultadoCopia = "copiado" | "selecionado";

/**
 * Copia o texto para a área de transferência. Sem ela (navegador antigo, página sem HTTPS ou permissão negada), o
 * texto fica selecionado no campo, para a pessoa copiar pelo menu do celular.
 */
export async function copiarTexto(
  texto: string,
  campo: HTMLInputElement | HTMLTextAreaElement | null,
): Promise<ResultadoCopia> {
  try {
    if (!navigator.clipboard)
      throw new Error("Área de transferência indisponível");
    await navigator.clipboard.writeText(texto);
    return "copiado";
  } catch {
    campo?.focus();
    campo?.select();
    return "selecionado";
  }
}

/** O que a tela diz depois de "Copiar link". */
export const TEXTO_COPIA: Record<ResultadoCopia, string> = {
  copiado: "Link copiado.",
  selecionado:
    "Não deu para copiar sozinho: o link ficou selecionado no campo. Copie pelo menu do celular.",
};
