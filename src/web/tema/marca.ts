// Nomes da marca mostrados nas telas. A marca visual é neutra até chegarem os
// arquivos oficiais da Videira Kids; como trocá-la está em docs/frontend.md.
export const MARCA = {
  nome: "Videira Kids",
  produto: "Rifa Videira Kids",
  simbolo: "VK",
} as const;

/** Título da aba do navegador para uma tela: "Pedidos · Rifa Videira Kids". */
export function tituloDaAba(tela: string): string {
  return `${tela} · ${MARCA.produto}`;
}
