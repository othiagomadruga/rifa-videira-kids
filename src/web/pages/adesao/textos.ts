// Dicas (RIFA-045) da tela Adesão. Por enquanto, só as da seção "Links de vendas" (RIFA-046): o resto da tela entra
// na fase 2 das dicas. Os botões do link e do QR code de cada célula (Copiar, WhatsApp, Ver QR, Baixar imagem,
// Imprimir) têm as dicas em components/qr/textos.ts, que a /minha também usa.

export const DICAS = {
  modelo: "O endereço do link de afiliado da Rifei, com {slug} e {afiliado}.",
  modeloSoLeitura: "Só o admin muda o modelo.",
  salvarModelo: "Grava o modelo; os links de todas as células mudam na hora.",
  salvarModeloSemMudanca: "Nada mudou desde o modelo gravado.",
  salvarModeloSalvando:
    "Indisponível enquanto o modelo é gravado. Espere um instante.",
  previa: "Abre o link de exemplo na Rifei para conferir.",
  buscar: "Filtra pelo nome da célula, do líder ou pelo código.",
  imprimirOsQrCodes: "Imprime uma página por célula com link.",
  imprimirOsQrCodesSemLink:
    "Indisponível: nenhuma célula tem link ainda. A célula ganha o link quando um afiliado é ligado a ela.",
} as const;
