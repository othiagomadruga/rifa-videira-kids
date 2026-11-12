// CA1 (RIFA-046, D24 item 9): ida e volta do QR code. O link vira a matriz do `qr` (correção M, margem de 4
// módulos), a matriz vira pixels (a mesma função pura que alimenta o <canvas> do "Baixar imagem") e o decodificador
// do próprio pacote (`qr/decode.js`) lê de volta EXATAMENTE o link, em três tamanhos (curto, médio e longo). O <path>
// do <svg> desenha os mesmos módulos da matriz.
import { decodeQR } from "qr/decode.js";
import { describe, expect, it } from "vitest";
import {
  MARGEM_QR_LINK_VENDAS_MODULOS,
  eLinkDeVendas,
} from "../../../shared/contracts/link-vendas";
import {
  PX_POR_MODULO_PNG,
  caminhoDosModulos,
  matrizDoQr,
  rasterizarQr,
} from "./qr-matriz";
import { matrizDoCaminho } from "./teste-apoio";

const SLUG = "rifa-videira-kids-2026";
const CURTO = "https://rifei.com.br/videira-kids?afiliado=1042";
const MEDIO = `https://rifei.com.br/${SLUG}/afiliados/${"a".repeat(14)}?afiliado=1042&origem=celula-agape&campanha=${SLUG}&pagina=checkout`;
const LONGO = `https://rifei.com.br/${encodeURIComponent(`${"Célula Ágape — Videira Kids ".repeat(10)}`)}?afiliado=987654321`;

describe("CA1: ida e volta do QR code do link de vendas", () => {
  it("os três links são links de vendas válidos, com ~47, ~150 e ~600 caracteres", () => {
    for (const url of [CURTO, MEDIO, LONGO])
      expect(eLinkDeVendas(url)).toBe(true);
    expect(CURTO).toHaveLength(47);
    expect(MEDIO.length).toBeGreaterThanOrEqual(140);
    expect(MEDIO.length).toBeLessThanOrEqual(160);
    expect(LONGO.length).toBeGreaterThanOrEqual(590);
    expect(LONGO.length).toBeLessThanOrEqual(620);
  });

  it.each([
    ["curto", CURTO, 4],
    ["médio", MEDIO, 8],
    ["longo", LONGO, 19],
  ] as const)(
    "%s: gerar → rasterizar (4 px por módulo) → decodificar devolve exatamente o link",
    (_nome, url, versao) => {
      const matriz = matrizDoQr(url);
      // Quadrada, com a versão esperada (17 + 4 × versão módulos) e a margem de 4 módulos de cada lado.
      const lado = 17 + 4 * versao + 2 * MARGEM_QR_LINK_VENDAS_MODULOS;
      expect(matriz).toHaveLength(lado);
      for (const linha of matriz) expect(linha).toHaveLength(lado);

      const pixels = rasterizarQr(matriz, 4);
      expect(pixels.width).toBe(lado * 4);
      expect(pixels.data).toHaveLength(lado * 4 * lado * 4 * 4);
      expect(decodeQR(pixels)).toBe(url);
    },
  );

  it("a imagem para baixar (10 px por módulo) também volta exatamente ao link", () => {
    const pixels = rasterizarQr(matrizDoQr(MEDIO), PX_POR_MODULO_PNG);
    expect(pixels.width).toBe((17 + 4 * 8 + 8) * 10);
    expect(decodeQR(pixels)).toBe(MEDIO);
  });

  it("a margem branca (zona de silêncio) tem 4 módulos em volta, e o QR é só preto e branco opacos", () => {
    const matriz = matrizDoQr(CURTO);
    const lado = matriz.length;
    const m = MARGEM_QR_LINK_VENDAS_MODULOS;
    matriz.forEach((linha, y) =>
      linha.forEach((escuro, x) => {
        const naMargem = y < m || x < m || y >= lado - m || x >= lado - m;
        if (naMargem) expect(escuro, `${x},${y}`).toBe(false);
      }),
    );
    // O canto de cima à esquerda do padrão de posição é escuro.
    expect(matriz[m][m]).toBe(true);

    const { data } = rasterizarQr(matriz, 2);
    for (let i = 0; i < data.length; i += 4) {
      expect([0, 255]).toContain(data[i]);
      expect(data[i + 1]).toBe(data[i]);
      expect(data[i + 2]).toBe(data[i]);
      expect(data[i + 3]).toBe(255);
    }
  });

  it("o <path> do <svg> desenha exatamente os módulos escuros da matriz", () => {
    for (const url of [CURTO, MEDIO, LONGO]) {
      const matriz = matrizDoQr(url);
      expect(matrizDoCaminho(caminhoDosModulos(matriz), matriz.length)).toEqual(
        matriz,
      );
    }
  });

  it("o caminho e os pixels rasterizados pelo caminho dão o mesmo link (o que a tela desenha a câmera lê)", () => {
    const matriz = matrizDoQr(LONGO);
    const doSvg = matrizDoCaminho(caminhoDosModulos(matriz), matriz.length);
    expect(decodeQR(rasterizarQr(doSvg, 3))).toBe(LONGO);
  });

  it("pixels por módulo: só inteiros positivos", () => {
    const matriz = matrizDoQr(CURTO);
    expect(() => rasterizarQr(matriz, 0)).toThrow(RangeError);
    expect(() => rasterizarQr(matriz, 2.5)).toThrow(RangeError);
  });
});
