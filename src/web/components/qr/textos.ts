// Dicas (RIFA-045) dos controles do link de vendas e do QR code (RIFA-046), que a /minha e a Adesão usam do mesmo
// jeito: para que serve e o que acontece, em 1 ou 2 frases curtas, sem repetir o rótulo. As da seção da Adesão (o
// modelo, a prévia, a busca e "Imprimir os QR codes") ficam em pages/adesao/textos.ts.

export const DICAS = {
  campoLink: "Toque para selecionar o link inteiro.",
  copiarLink: "Copia o link de vendas para colar onde quiser.",
  enviarWhatsApp: "Abre o WhatsApp com a mensagem e o link prontos.",
  /** Na Adesão, com o telefone do líder (sem ele, a pessoa escolhe o contato: a dica de cima). */
  enviarWhatsAppAoLider:
    "Abre o WhatsApp com a mensagem e o link prontos para o telefone do líder.",
  verQr: "Mostra o QR code deste link para a pessoa apontar a câmera.",
  baixarImagem: "Baixa o QR code como imagem (PNG) para mandar ou imprimir.",
  imprimir: "Imprime só o QR code, o nome da célula e o link.",
  /** O "Pronto" e o × do diálogo do "Ver QR". */
  fecharQr: "Fecha o QR code.",
} as const;
