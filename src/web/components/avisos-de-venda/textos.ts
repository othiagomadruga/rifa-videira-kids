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

/**
 * Há quanto tempo foi a venda (RIFA-096), pela `em` dela e pelo `agora` do servidor na mesma resposta (o relógio do
 * aparelho, adiantado ou atrasado, não entra): menos de 1 minuto, "agora mesmo"; senão "há N min" (1 a 10, a janela
 * da rota). Instante inválido ou depois do `agora` também é "agora mesmo".
 */
export function textoDoQuando(em: string, agora: string): string {
  const minutos = Math.floor((Date.parse(agora) - Date.parse(em)) / 60_000);
  return minutos >= 1 ? `há ${minutos} min` : "agora mesmo";
}

/** A linha menor de cada aviso: "há 3 min · Projeto Videira Kids". */
export function linhaDoAviso(em: string, agora: string): string {
  return `${textoDoQuando(em, agora)} · ${MARCA.produto}`;
}

export const ROTULO_SOM = "Som das vendas";

/** As dicas do botão do som (RIFA-045: todo botão tem dica). */
export const DICAS_SOM = {
  ligado:
    "O som está ligado: cada venda nova toca um plim. Clique para desligar.",
  desligado:
    "O som está desligado: as vendas aparecem em silêncio. Clique para ligar.",
} as const;
