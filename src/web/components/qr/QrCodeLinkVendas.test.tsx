// CA1 na tela e CA4 (RIFA-046, D24 item 8): o QR code desenhado pelo React (um <svg> com o <path> dos módulos, sem
// innerHTML) volta exatamente ao link quando decodificado; "Baixar imagem" gera um PNG num <canvas> (10 px por
// módulo, o mesmo QR) com o nome `nomeDoArquivoQrLinkVendas` e libera o endereço depois, sem nada em storage, na URL
// ou no histórico; "Imprimir" mostra só o QR, o nome da célula e o link em texto.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { decodeQR } from "qr/decode.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIBERAR_ARQUIVO_DEPOIS_MS } from "../../lib/api";
import { espiarDownloads } from "../../test/download";
import { CLASSE_IMPRIMINDO, QrCodeLinkVendas } from "./QrCodeLinkVendas";
import { matrizDoQr } from "./qr-matriz";
import { pixelsDoSvg, simularCanvas } from "./teste-apoio";

const URL_AGAPE = "https://rifei.com.br/videira-kids?afiliado=1042";

let downloads: ReturnType<typeof espiarDownloads>;
let canvas: ReturnType<typeof simularCanvas>;
const imprimir = vi.fn();

beforeEach(() => {
  downloads = espiarDownloads();
  canvas = simularCanvas();
  imprimir.mockClear();
  vi.stubGlobal("print", imprimir);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  downloads.desfazer();
  canvas.desfazer();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove(CLASSE_IMPRIMINDO);
});

function abrir(celulaNome = "Célula Ágape", url = URL_AGAPE) {
  return render(<QrCodeLinkVendas url={url} celulaNome={celulaNome} />);
}

describe("o QR code na tela", () => {
  it("é um <svg> do React, preto no branco, com o nome da célula, e a câmera leria o link exato", () => {
    abrir();
    const svg = screen.getByRole("img", {
      name: "QR code do link de vendas da Célula Ágape",
    });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg).toHaveAttribute("shape-rendering", "crispEdges");
    const lado = matrizDoQr(URL_AGAPE).length;
    expect(svg).toHaveAttribute("viewBox", `0 0 ${lado} ${lado}`);
    // Só o fundo e os módulos: o link não aparece como texto nem como atributo do desenho.
    expect(svg.children).toHaveLength(2);
    expect(svg.innerHTML).not.toContain("rifei");
    expect(decodeQR(pixelsDoSvg(svg))).toBe(URL_AGAPE);
  });

  it("um link com caracteres especiais também volta exato (o QR não é marcação)", () => {
    const url = `https://rifei.com.br/${encodeURIComponent('<script>"&')}?afiliado=7`;
    abrir("Célula <b>Teste</b>", url);
    const svg = screen.getByRole("img", {
      name: "QR code do link de vendas da Célula <b>Teste</b>",
    });
    expect(document.querySelector("b")).toBeNull();
    expect(decodeQR(pixelsDoSvg(svg))).toBe(url);
  });
});

describe("CA4: Baixar imagem", () => {
  it("gera um PNG do mesmo QR (10 px por módulo) com o nome certo, libera o endereço depois e não guarda nada", async () => {
    vi.useFakeTimers();
    const historico = window.history.length;
    const endereco = window.location.href;
    abrir();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Baixar imagem do QR code da Célula Ágape",
      }),
    );

    await vi.waitFor(() => expect(downloads.cliques).toHaveLength(1));
    const [clique] = downloads.cliques;
    expect(clique.nome).toBe("link-de-vendas-celula-agape.png");
    expect(clique.naPagina).toBe(true);
    expect(canvas.tipos).toEqual(["image/png"]);
    const png = downloads.arquivos.get(clique.endereco);
    expect(png?.type).toBe("image/png");
    const pixels = canvas.pixelsDoPng(png);
    expect(pixels?.width).toBe(matrizDoQr(URL_AGAPE).length * 10);
    expect(pixels && decodeQR(pixels)).toBe(URL_AGAPE);
    // O link temporário saiu da página; o <canvas> nunca entrou nela; nenhum <img src="blob:">.
    expect(document.querySelector("a[download]")).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
    expect(document.querySelector('img[src^="blob:"]')).toBeNull();

    expect(
      screen.getByText(
        "✓ Imagem baixada: link-de-vendas-celula-agape.png. Fica na pasta de downloads do aparelho.",
        { selector: "p:not([role])" },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Imagem baixada: link-de-vendas-celula-agape.png.",
    );

    // O endereço do arquivo é liberado depois de 60 s (o navegador lê o arquivo depois do clique).
    expect(downloads.liberados).toEqual([]);
    act(() => vi.advanceTimersByTime(LIBERAR_ARQUIVO_DEPOIS_MS));
    expect(downloads.liberados).toEqual([clique.endereco]);

    // Nada em storage, na URL ou no histórico.
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    expect(window.location.href).toBe(endereco);
    expect(window.history.length).toBe(historico);
  });

  it("o nome do arquivo segue o nome da célula, sem acento nem espaço", async () => {
    abrir("Célula São João & Ágape 2");
    fireEvent.click(screen.getByRole("button", { name: /^Baixar imagem/ }));
    await waitFor(() => expect(downloads.cliques).toHaveLength(1));
    expect(downloads.cliques[0].nome).toBe(
      "link-de-vendas-celula-sao-joao-agape-2.png",
    );
  });

  it("sem imagem do navegador: avisa e sugere Imprimir, sem baixar nada", async () => {
    canvas.falharNoToBlob();
    abrir();
    fireEvent.click(screen.getByRole("button", { name: /^Baixar imagem/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Não foi possível gerar a imagem neste aparelho. Use “Imprimir” ou tire um print da tela.",
    );
    expect(downloads.cliques).toEqual([]);
    expect(downloads.criar).not.toHaveBeenCalled();
  });
});

describe("Imprimir", () => {
  it("imprime só o QR, o nome da célula e o link em texto; depois da impressão, a folha sai", async () => {
    abrir();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Imprimir o QR code da Célula Ágape",
      }),
    );

    await waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
    expect(document.documentElement).toHaveClass(CLASSE_IMPRIMINDO);
    const folhas = document.querySelector("body > .qr-folhas");
    expect(folhas).not.toBeNull();
    const folha = folhas?.querySelector(".qr-folha");
    expect(folha?.querySelector("h2")).toHaveTextContent("Célula Ágape");
    expect(folha?.querySelector(".qr-folha__link")).toHaveTextContent(
      URL_AGAPE,
    );
    const svg = folha?.querySelector("svg");
    expect(svg && decodeQR(pixelsDoSvg(svg))).toBe(URL_AGAPE);

    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(document.documentElement).not.toHaveClass(CLASSE_IMPRIMINDO);
    expect(document.querySelector(".qr-folhas")).toBeNull();
  });

  it("ao sair da tela no meio da impressão, a marca do <html> e a folha também saem", async () => {
    const { unmount } = abrir();
    fireEvent.click(screen.getByRole("button", { name: /^Imprimir/ }));
    await waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
    unmount();
    expect(document.documentElement).not.toHaveClass(CLASSE_IMPRIMINDO);
    expect(document.querySelector(".qr-folhas")).toBeNull();
  });
});
