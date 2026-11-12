// O QR code do link de vendas de uma célula (RIFA-046, D24): carregado só com `lazy` (o `qr` fica fora do pacote
// inicial; qr-lazy.test.ts confere). Desenhado com elementos do React (um <svg> com um <path>, nada de innerHTML:
// o link nunca vira marcação), preto no branco fixos, com "Baixar imagem" (PNG de um <canvas>) e "Imprimir" (só o
// QR, o nome da célula e o link em texto embaixo, para quem quiser conferir que é a Rifei).
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { nomeDoArquivoQrLinkVendas } from "../../../shared/contracts/link-vendas";
import { LIBERAR_ARQUIVO_DEPOIS_MS } from "../../lib/api";
import { Button } from "../ui";
import {
  COR_CLARA_QR,
  COR_ESCURA_QR,
  PX_POR_MODULO_PNG,
  caminhoDosModulos,
  matrizDoQr,
  rasterizarQr,
  type MatrizQr,
} from "./qr-matriz";
import "./qr-codigo.css";

/** O nome do QR code para o leitor de tela (o `aria-label` do <svg>). */
export function rotuloDoQr(celulaNome: string): string {
  return `QR code do link de vendas da ${celulaNome}`;
}

/** O <svg> do QR code: `viewBox` em módulos, o fundo branco e um <path> com os módulos escuros. */
export function QrSvg({
  matriz,
  rotulo,
  className,
}: {
  matriz: MatrizQr;
  rotulo: string;
  className?: string;
}) {
  const lado = matriz.length;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${lado} ${lado}`}
      role="img"
      aria-label={rotulo}
      shapeRendering="crispEdges"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={lado} height={lado} fill={COR_CLARA_QR} />
      <path d={caminhoDosModulos(matriz)} fill={COR_ESCURA_QR} />
    </svg>
  );
}

/**
 * Gera o PNG num <canvas> (10 px por módulo, fundo branco, fora da página) e o entrega ao navegador por um link
 * temporário com `download` (como o relatório da D23): nunca um <img src="blob:">, que a CSP recusa. O endereço do
 * arquivo é liberado depois de LIBERAR_ARQUIVO_DEPOIS_MS. Nada vai para storage, URL ou histórico.
 */
export async function baixarPngDoQr(
  matriz: MatrizQr,
  nomeDoArquivo: string,
): Promise<void> {
  const pixels = rasterizarQr(matriz, PX_POR_MODULO_PNG);
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const contexto = canvas.getContext("2d");
  if (!contexto) throw new Error("Este navegador não desenha imagens.");
  const imagem = contexto.createImageData(pixels.width, pixels.height);
  imagem.data.set(pixels.data);
  contexto.putImageData(imagem, 0, 0);
  const png = await new Promise<Blob | null>((resolver) =>
    canvas.toBlob(resolver, "image/png"),
  );
  if (!png) throw new Error("Este navegador não gerou a imagem.");
  const endereco = URL.createObjectURL(png);
  const link = document.createElement("a");
  link.href = endereco;
  link.download = nomeDoArquivo;
  link.hidden = true;
  // No documento durante o clique: alguns navegadores só baixam por um link que está na página.
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(endereco), LIBERAR_ARQUIVO_DEPOIS_MS);
  }
}

/** Uma folha impressa: o QR code de uma célula, o nome dela e o link em texto. */
export type FolhaQr = { celulaNome: string; url: string };

/** Classe posta no <html> enquanto imprime: o @media print de qr-codigo.css mostra só as folhas. */
export const CLASSE_IMPRIMINDO = "qr-imprimindo";

/**
 * Impressão dos QR codes: `imprimir(folhas)` põe as folhas num portal no fim do <body> (escondido na tela), marca
 * o <html> e chama `window.print()`; o @media print mostra só as folhas, uma por página. No `afterprint` (ou ao
 * sair da tela), as folhas e a marca saem.
 */
export function useImpressaoQr() {
  const [folhas, setFolhas] = useState<readonly FolhaQr[] | null>(null);

  useEffect(() => {
    if (!folhas) return;
    const raiz = document.documentElement;
    raiz.classList.add(CLASSE_IMPRIMINDO);
    const terminar = () => {
      raiz.classList.remove(CLASSE_IMPRIMINDO);
      setFolhas(null);
    };
    window.addEventListener("afterprint", terminar);
    window.print();
    return () => {
      window.removeEventListener("afterprint", terminar);
      raiz.classList.remove(CLASSE_IMPRIMINDO);
    };
  }, [folhas]);

  return {
    imprimir: (novas: readonly FolhaQr[]) => setFolhas([...novas]),
    folhas:
      folhas &&
      createPortal(
        <div className="qr-folhas" aria-hidden="true">
          {folhas.map((folha, indice) => (
            <FolhaImpressa key={`${indice}-${folha.url}`} folha={folha} />
          ))}
        </div>,
        document.body,
      ),
  };
}

function FolhaImpressa({ folha }: { folha: FolhaQr }) {
  const matriz = useMemo(() => matrizDoQr(folha.url), [folha.url]);
  return (
    <section className="qr-folha">
      <h2 className="qr-folha__titulo">{folha.celulaNome}</h2>
      <p className="qr-folha__chamada">
        Aponte a câmera do celular para comprar seus bilhetes da rifa do Videira
        Kids.
      </p>
      <QrSvg
        matriz={matriz}
        rotulo={rotuloDoQr(folha.celulaNome)}
        className="qr-folha__imagem"
      />
      <p className="qr-folha__link">{folha.url}</p>
    </section>
  );
}

type Retorno =
  { tipo: "baixado"; nome: string } | { tipo: "falhou_baixar" } | null;

const TEXTO_RETORNO = {
  baixado: (nome: string) =>
    `✓ Imagem baixada: ${nome}. Fica na pasta de downloads do aparelho.`,
  falhou_baixar:
    "Não foi possível gerar a imagem neste aparelho. Use “Imprimir” ou tire um print da tela.",
};

function textoDoRetorno(retorno: Retorno): string {
  if (retorno === null) return "";
  return retorno.tipo === "baixado"
    ? TEXTO_RETORNO.baixado(retorno.nome)
    : TEXTO_RETORNO.falhou_baixar;
}

type Props = {
  /** O link de vendas (já conferido pelo schema da API: só `https://rifei.com.br/...`). */
  url: string;
  celulaNome: string;
};

/**
 * O QR code de um link de vendas, com "Baixar imagem" e "Imprimir". O nome da célula vai no `aria-label`, nos
 * botões (só para o leitor de tela), no nome do arquivo e na folha impressa.
 */
export function QrCodeLinkVendas({ url, celulaNome }: Props) {
  const matriz = useMemo(() => matrizDoQr(url), [url]);
  const [retorno, setRetorno] = useState<Retorno>(null);
  const { imprimir, folhas } = useImpressaoQr();

  async function baixar() {
    const nome = nomeDoArquivoQrLinkVendas(celulaNome);
    try {
      await baixarPngDoQr(matriz, nome);
      setRetorno({ tipo: "baixado", nome });
    } catch {
      setRetorno({ tipo: "falhou_baixar" });
    }
  }

  const texto = textoDoRetorno(retorno);
  return (
    <div className="qr-codigo">
      <div className="qr-codigo__moldura">
        <QrSvg
          matriz={matriz}
          rotulo={rotuloDoQr(celulaNome)}
          className="qr-codigo__imagem"
        />
      </div>
      <div className="qr-codigo__acoes">
        <Button variante="secundario" onClick={() => void baixar()}>
          Baixar imagem{" "}
          <span className="visualmente-oculto">do QR code da {celulaNome}</span>
        </Button>
        <Button
          variante="secundario"
          onClick={() => imprimir([{ celulaNome, url }])}
        >
          Imprimir{" "}
          <span className="visualmente-oculto">o QR code da {celulaNome}</span>
        </Button>
      </div>
      {/* Região viva fixa (anuncia o resultado de baixar) e o mesmo texto visível. */}
      <p className="visualmente-oculto" role="status">
        {texto}
      </p>
      {texto && (
        <p
          className="qr-codigo__retorno"
          data-tom={retorno?.tipo === "baixado" ? "sucesso" : "alerta"}
        >
          {texto}
        </p>
      )}
      {folhas}
    </div>
  );
}
