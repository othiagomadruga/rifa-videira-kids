// Nomes e arquivos da marca mostrados nas telas (RIFA-020). Os arquivos vêm dos PNG do PO: o logo da Videira
// sem o fundo branco (WebP, com PNG de reserva) e o logo do Kids em 128 px. Regras de uso em docs/frontend.md.
import seloKids from "./marca/kids-selo.png";
import logoVideiraPng from "./marca/videira-logo.png";
import logoVideiraWebp from "./marca/videira-logo.webp";

export const MARCA = {
  nome: "Videira Kids",
  produto: "Rifa Videira Kids",
  /** Logo da Videira (a igreja): no cabeçalho de todas as telas. Em fundo escuro, vai sobre um selo claro. */
  logo: {
    webp: logoVideiraWebp,
    png: logoVideiraPng,
    alt: "Videira Igreja em Células",
    largura: 272,
    altura: 105,
  },
  /** Logo do Kids: discreto, no rodapé das telas abertas e num selo pequeno no telão. */
  kids: {
    src: seloKids,
    alt: "Videira Kids",
    largura: 128,
    altura: 128,
    frase: "Campanha em prol do espaço Videira Kids",
  },
  /** Crédito de quem desenvolveu o sistema (pedido do PO, RIFA-067): no canto direito do rodapé das telas abertas. */
  credito: "Sistema desenvolvido por GODy Tech",
} as const;

/** Título da aba do navegador para uma tela: "Pedidos · Rifa Videira Kids". */
export function tituloDaAba(tela: string): string {
  return `${tela} · ${MARCA.produto}`;
}
