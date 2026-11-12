// O QR code do link de vendas (RIFA-046, D24), sem React: a matriz do `qr` 0.7.2 (gerada no navegador, sem rede nem
// serviço de terceiros), o caminho do <svg> e os pixels da imagem para baixar. Este é o ÚNICO módulo do site que
// importa o `qr`, e ele só entra em pedaços carregados com `lazy` (qr-lazy.test.ts confere).
//
// Correção M (NIVEL_CORRECAO_QR_LINK_VENDAS) e margem branca de 4 módulos (MARGEM_QR_LINK_VENDAS_MODULOS): a matriz
// `raw` já sai com a margem (o `qr` 0.7.2 recusa `border: 0`), e a tela pinta só os módulos escuros sobre o branco.
// Sempre preto no branco, também no tema escuro e no telão: muitos leitores não leem o QR invertido (a exceção aos
// tokens do tema que a D24 documenta; as duas cores ficam só aqui).
import encodeQR, { type ErrorCorrection } from "qr";
import {
  MARGEM_QR_LINK_VENDAS_MODULOS,
  NIVEL_CORRECAO_QR_LINK_VENDAS,
} from "../../../shared/contracts/link-vendas";

/** Módulo escuro do QR code (fixo: nunca uma cor do tema). */
export const COR_ESCURA_QR = "#000000";
/** Fundo e margem do QR code (fixo: nunca uma cor do tema). */
export const COR_CLARA_QR = "#ffffff";

/** Pixels por módulo na imagem para baixar (D24): um QR de 41 módulos vira um PNG de 410 × 410 px. */
export const PX_POR_MODULO_PNG = 10;

/** O nível de correção do contrato (letra da norma) no nome que o `qr` usa. */
const CORRECAO: Record<"L" | "M" | "Q" | "H", ErrorCorrection> = {
  L: "low",
  M: "medium",
  Q: "quartile",
  H: "high",
};

/** A matriz do QR code (true = módulo escuro), quadrada e já com a margem branca de 4 módulos. */
export type MatrizQr = boolean[][];

export function matrizDoQr(texto: string): MatrizQr {
  return encodeQR(texto, "raw", {
    ecc: CORRECAO[NIVEL_CORRECAO_QR_LINK_VENDAS],
    border: MARGEM_QR_LINK_VENDAS_MODULOS,
  });
}

/** Trechos seguidos de módulos escuros de cada linha: [linha, coluna inicial, comprimento]. */
function trechosEscuros(matriz: MatrizQr): [number, number, number][] {
  const trechos: [number, number, number][] = [];
  matriz.forEach((linha, y) => {
    let inicio = -1;
    for (let x = 0; x <= linha.length; x += 1) {
      const escuro = x < linha.length && linha[x];
      if (escuro && inicio < 0) inicio = x;
      if (!escuro && inicio >= 0) {
        trechos.push([y, inicio, x - inicio]);
        inicio = -1;
      }
    }
  });
  return trechos;
}

/**
 * O `d` do <path> com os módulos escuros, em unidades de módulo (o <svg> usa `viewBox="0 0 n n"`): um retângulo
 * por trecho seguido da linha ("M3 4h2v1h-2z"), o que deixa o caminho curto. Só números: o link nunca vira
 * marcação.
 */
export function caminhoDosModulos(matriz: MatrizQr): string {
  return trechosEscuros(matriz)
    .map(([y, x, n]) => `M${x} ${y}h${n}v1h-${n}z`)
    .join("");
}

/** Uma imagem RGBA, como a do `ImageData` do <canvas> (e a que o `decodeQR` lê). */
export type PixelsQr = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

/**
 * Os pixels do QR code, com `pxPorModulo` pixels por módulo: preto (0) e branco (255), opacos. É o que o <canvas>
 * do "Baixar imagem" recebe e o que os testes decodificam (função pura).
 */
export function rasterizarQr(matriz: MatrizQr, pxPorModulo: number): PixelsQr {
  if (!Number.isInteger(pxPorModulo) || pxPorModulo < 1)
    throw new RangeError("pxPorModulo precisa ser um inteiro positivo");
  const lado = matriz.length * pxPorModulo;
  const data = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (const [y, x, n] of trechosEscuros(matriz)) {
    for (
      let linha = y * pxPorModulo;
      linha < (y + 1) * pxPorModulo;
      linha += 1
    ) {
      const inicio = (linha * lado + x * pxPorModulo) * 4;
      const fim = inicio + n * pxPorModulo * 4;
      for (let i = inicio; i < fim; i += 4) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
    }
  }
  return { width: lado, height: lado, data };
}
