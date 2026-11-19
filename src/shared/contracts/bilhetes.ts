/**
 * Bilhetes pagos, reservados e livres (RIFA-075, D35): a tela "Bilhetes" da coordenação e `GET /api/painel/bilhetes`.
 *
 * - A rifa tem `quantidade` números (como na Rifei), numerados a partir de `numero_inicial` (0 ou 1). Os dois ficam
 *   na Campanha (grupo `bilhetes`, migração 0016). O número inicial pode ficar em branco (null = automático): vale 0
 *   se algum pedido já trouxe o número 0, e 1 se não (`numeroInicialEfetivo`). A compra de teste confirma.
 * - Situação de um número: **pago** se está num pedido pago; **reservado** se está num pedido aguardando pagamento
 *   ainda não vencido; **livre** no resto. Pago vence reservado. O pedido desconsiderado pelo admin (D20) não conta.
 * - A resposta é compacta: um mapa de bits em base64 por situação (bit i = número `numero_inicial + i`; byte i >> 3,
 *   bit i & 7, do menos significativo). 7.005 números = 876 bytes por mapa; 1.000.000 = 125 KB.
 *
 * Sem zod, como regras.ts e calculos.ts: o site importa daqui (constantes e a leitura dos mapas). Os schemas ficam em
 * dominio.ts (campanha) e api.ts (rotas).
 */

/** Quantidade de números da rifa que a Campanha aceita (o plano Premium da Rifei vai até 1.000.000). */
export const LIMITE_QUANTIDADE_NUMEROS = 1_000_000;

/** Como a Rifei numera: a partir de 0 ou de 1. */
export const NUMEROS_INICIAIS = [0, 1] as const;
export type NumeroInicial = (typeof NUMEROS_INICIAIS)[number];

/**
 * `bilhetes` da campanha: a rifa "projeto-kids-1" tem 7005 números (campo `numbers` da página pública da Rifei,
 * 19/11/2026). O número inicial começa automático (null): deduzido dos números que chegam nos pedidos.
 */
export const BILHETES_PADRAO = {
  quantidade: 7005,
  numero_inicial: null as NumeroInicial | null,
} as const;

/** De quanto em quanto tempo a tela Bilhetes busca de novo, enquanto aberta e visível. */
export const INTERVALO_ATUALIZACAO_BILHETES_MS = 30_000;

/** Situação de um número na grade. */
export const SITUACOES_BILHETE = ["pago", "reservado", "livre"] as const;
export type SituacaoBilhete = (typeof SITUACOES_BILHETE)[number];

/** Situação de um pedido na busca por número (`expirado` inclui o pendente já vencido, sem aviso da Rifei). */
export const SITUACOES_PEDIDO_BILHETE = [
  "pago",
  "reservado",
  "expirado",
] as const;
export type SituacaoPedidoBilhete = (typeof SITUACOES_PEDIDO_BILHETE)[number];

/** Na busca por número, no máximo estes pedidos (os mais recentes). */
export const LIMITE_PEDIDOS_POR_NUMERO = 20;

/**
 * O número inicial que vale: o configurado ou, em branco, 0 se algum pedido trouxe o número 0 e 1 se não.
 */
export function numeroInicialEfetivo(
  configurado: NumeroInicial | null,
  apareceuZero: boolean,
): NumeroInicial {
  return configurado ?? (apareceuZero ? 0 : 1);
}

/** Um mapa de bits vazio para `quantidade` números. */
export function criarMapaDeBits(quantidade: number): Uint8Array {
  return new Uint8Array(Math.ceil(quantidade / 8));
}

/** Liga o bit do índice (0 = o número inicial). */
export function ligarBit(mapa: Uint8Array, indice: number): void {
  const byte = indice >> 3;
  mapa[byte] = (mapa[byte] ?? 0) | (1 << (indice & 7));
}

/** O bit do índice está ligado? Fora do mapa: não. */
export function bitLigado(mapa: Uint8Array, indice: number): boolean {
  return (((mapa[indice >> 3] ?? 0) >> (indice & 7)) & 1) === 1;
}

/** Quantos bits ligados. */
export function contarBits(mapa: Uint8Array): number {
  let total = 0;
  for (const byte of mapa) {
    let b = byte;
    while (b) {
      b &= b - 1;
      total += 1;
    }
  }
  return total;
}

/** Bytes → base64 (btoa existe no Worker e no navegador). Em blocos, para não estourar a pilha. */
export function mapaParaBase64(mapa: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < mapa.length; i += 0x8000)
    binario += String.fromCharCode(...mapa.subarray(i, i + 0x8000));
  return btoa(binario);
}

/** base64 → bytes. */
export function mapaDeBase64(base64: string): Uint8Array {
  const binario = atob(base64);
  const mapa = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) mapa[i] = binario.charCodeAt(i);
  return mapa;
}

/** Situação do número no índice, pelos dois mapas (pago vence reservado). */
export function situacaoNoIndice(
  pagos: Uint8Array,
  reservados: Uint8Array,
  indice: number,
): SituacaoBilhete {
  if (bitLigado(pagos, indice)) return "pago";
  if (bitLigado(reservados, indice)) return "reservado";
  return "livre";
}
