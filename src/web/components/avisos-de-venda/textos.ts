// Os textos dos avisos de venda (RIFA-094, D42) e do botão do som. Sem a palavra "rede" (a /minha do discipulador
// não a mostra, D30), sem "@" nem "1234" (nada de senha numa tela aberta) e sem valores em dinheiro.
import { formatarNumero } from "../../lib/formatadores";
import { MARCA } from "../../tema/marca";

/** "1 bilhete", "3 bilhetes", "1.200 bilhetes". */
export function textoDosBilhetes(bilhetes: number): string {
  return bilhetes === 1 ? "1 bilhete" : `${formatarNumero(bilhetes)} bilhetes`;
}

/**
 * Como a célula entra na frase: "A célula" e o nome; o nome que já começa com "Célula" (ex.: "Célula Betel") vai só
 * com o "A", para não repetir a palavra.
 */
export function inicioDaFrase(celula: string): string {
  return /^c[ée]lula\b/i.test(celula.trim()) ? "A" : "A célula";
}

/** A linha menor de cada aviso. */
export const LINHA_DO_AVISO = `agora mesmo · ${MARCA.produto}`;

export const ROTULO_SOM = "Som das vendas";

/** As dicas do botão do som (RIFA-045: todo botão tem dica). */
export const DICAS_SOM = {
  ligado:
    "O som está ligado: cada venda nova toca um plim. Clique para desligar.",
  desligado:
    "O som está desligado: as vendas aparecem em silêncio. Clique para ligar.",
} as const;
