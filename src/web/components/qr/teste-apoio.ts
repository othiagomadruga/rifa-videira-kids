// Apoio dos testes do QR code (só nos testes; nunca vai para o pacote do site): ler de volta o <svg> que a tela
// desenha e trocar o <canvas> e o window.print, que o jsdom não tem.
import { act } from "@testing-library/react";
import { vi } from "vitest";
import { dicaDe, focarPeloTeclado } from "../../test/dicas";
import { rasterizarQr, type MatrizQr, type PixelsQr } from "./qr-matriz";

/**
 * O texto da dica (RIFA-045) de um controle: foca pelo teclado (a dica abre na hora), lê e tira o foco. Para os
 * controles que a varredura `controlesSemDica` não pega (o link da prévia) e para conferir qual texto aparece.
 */
export function textoDaDica(controle: HTMLElement): string | null {
  focarPeloTeclado(controle);
  const texto = dicaDe(controle)?.textContent ?? null;
  act(() => controle.blur());
  return texto;
}

/** Os módulos escuros desenhados por um `d` de caminhoDosModulos ("M3 4h2v1h-2z..."); outro comando lança erro. */
export function matrizDoCaminho(d: string, lado: number): MatrizQr {
  const matriz = Array.from({ length: lado }, () =>
    Array<boolean>(lado).fill(false),
  );
  let lido = "";
  for (const [inteiro, x, y, n, volta] of d.matchAll(
    /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g,
  )) {
    if (volta !== n) throw new Error(`retângulo torto: ${inteiro}`);
    for (let i = 0; i < Number(n); i += 1)
      matriz[Number(y)][Number(x) + i] = true;
    lido += inteiro;
  }
  // Nada além dos retângulos: o caminho é só números e comandos.
  if (lido !== d) throw new Error("o caminho tem algo além dos módulos");
  return matriz;
}

/**
 * Os pixels do QR code de um <svg> da tela (4 px por módulo), lidos do próprio DOM: o `viewBox`, o fundo branco
 * e o <path> preto. É o que se passa ao `decodeQR`.
 */
export function pixelsDoSvg(svg: Element): PixelsQr {
  const [, , lado] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
  const fundo = svg.querySelector("rect");
  const caminho = svg.querySelector("path");
  if (!lado || !fundo || !caminho) throw new Error("não é o <svg> do QR");
  if (fundo.getAttribute("fill") !== "#ffffff") throw new Error("fundo");
  if (caminho.getAttribute("fill") !== "#000000") throw new Error("módulos");
  return rasterizarQr(
    matrizDoCaminho(caminho.getAttribute("d") ?? "", lado),
    4,
  );
}

/**
 * Troca o <canvas> do jsdom (sem desenho) por um que guarda os pixels postos no `putImageData` e entrega no
 * `toBlob` um PNG de mentira com esses pixels (o `pixelsDoPng`). No afterEach, `desfazer()`.
 */
export function simularCanvas() {
  const desenhados = new WeakMap<Blob, PixelsQr>();
  const tipos: (string | undefined)[] = [];
  /** Os canvas que geraram (ou tentaram gerar) um PNG. */
  const usados: HTMLCanvasElement[] = [];
  let falharToBlob = false;
  /** O contexto 2D de mentira de um canvas: guarda no próprio canvas os pixels do putImageData. */
  const contextoDe = (canvas: HTMLCanvasElement) =>
    ({
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (imagem: PixelsQr) => {
        (canvas as unknown as { pixels: PixelsQr }).pixels = {
          width: imagem.width,
          height: imagem.height,
          data: new Uint8ClampedArray(imagem.data),
        };
      },
    }) as unknown as CanvasRenderingContext2D;
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(function (this: HTMLCanvasElement) {
      return contextoDe(this);
    } as unknown as HTMLCanvasElement["getContext"]);
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      tipo?: string,
    ) {
      tipos.push(tipo);
      usados.push(this);
      if (falharToBlob) {
        callback(null);
        return;
      }
      const pixels = (this as unknown as { pixels?: PixelsQr }).pixels;
      const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
        type: tipo ?? "image/png",
      });
      if (pixels) desenhados.set(png, pixels);
      callback(png);
    });
  return {
    tipos,
    usados,
    /** Os pixels que o canvas tinha quando gerou este PNG. */
    pixelsDoPng: (png: Blob | undefined) =>
      png ? (desenhados.get(png) ?? null) : null,
    falharNoToBlob() {
      falharToBlob = true;
    },
    desfazer() {
      getContext.mockRestore();
      toBlob.mockRestore();
    },
  };
}
