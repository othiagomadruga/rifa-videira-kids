// A leitura do extrato escolhido ou colado (RIFA-059, D26), toda NO NAVEGADOR: o arquivo nunca vai para o servidor e
// nada é gravado (nem banco, nem localStorage, nem log). O formato é descoberto pelo conteúdo:
// - foto ou print (imagem; RIFA-074): a falha que pede o comprovante em PDF (OCR fica fora);
// - PDF (o começo "%PDF-", a extensão ou o tipo; RIFA-068): o texto de cada página, com as linhas montadas pela
//   posição (pdf.ts, num pacote à parte com o pdf.js, carregado pelo import() só quando a pessoa escolhe um PDF),
//   lido pelo leitor de texto colado; o comprovante de Pix (RIFA-074, D34), um Pix por arquivo, por comprovante.ts;
// - OFX (a tag <OFX> ou o cabeçalho OFXHEADER): ofx.ts;
// - CSV (a extensão .csv ou linhas com o mesmo separador), com o cabeçalho achado: csv.ts, com o mapeamento na tela;
// - o resto (e o CSV sem cabeçalho reconhecível): o leitor de texto colado, linha por linha (texto-colado.ts).
import { decodificar } from "../decodificar";
import {
  extratoDoComprovante,
  lerComprovante,
  pareceComprovante,
} from "./comprovante";
import { lerCsvDoExtrato, pareceCsv, type CsvDoExtrato } from "./csv";
import type {
  ContextoDeLeitura,
  ExtratoLido,
  FalhaDoExtrato,
} from "./lancamentos";
import { ehOfx, lerOfx } from "./ofx";
import { lerTextoColado, SEM_LANCAMENTOS_NO_TEXTO } from "./texto-colado";
import { FALHAS_DO_COMPROVANTE, FALHAS_DO_PDF } from "./textos";

/** O maior arquivo aceito (um ano de OFX movimentado tem bem menos). */
export const MAXIMO_BYTES_EXTRATO = 5_000_000;

export type EntradaDoExtrato =
  | { tipo: "arquivo"; nome: string; texto: string }
  /** O texto de um PDF, já em linhas (pdf.ts). */
  | { tipo: "pdf"; nome: string; texto: string }
  | { tipo: "texto"; texto: string };

export type LeituraDoExtrato =
  | FalhaDoExtrato
  | { ok: true; tipo: "lido"; extrato: ExtratoLido }
  | { ok: true; tipo: "csv"; csv: CsvDoExtrato };

const VAZIO: FalhaDoExtrato = {
  ok: false,
  titulo: "O extrato está vazio",
  mensagem: "Escolha o arquivo baixado do banco ou cole a tabela do extrato.",
};

/** O PDF pela extensão, pelo tipo ou pelo começo do arquivo ("%PDF-" no primeiro KB, como os leitores de PDF). */
function ehPdf(arquivo: File, bytes: ArrayBuffer): boolean {
  if (/\.pdf$/i.test(arquivo.name) || arquivo.type === "application/pdf")
    return true;
  const inicio = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 1024));
  return String.fromCharCode(...inicio).includes("%PDF-");
}

/** A foto ou o print (o comprovante fotografado): pelo tipo, pela extensão ou pela assinatura do arquivo. */
function ehImagem(arquivo: File, bytes: ArrayBuffer): boolean {
  if (arquivo.type.startsWith("image/")) return true;
  if (/\.(?:jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(arquivo.name))
    return true;
  const b = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const heic =
    String.fromCharCode(...b.slice(4, 8)) === "ftyp" &&
    /^(?:heic|heix|mif1|msf1|avif)$/.test(
      String.fromCharCode(...b.slice(8, 12)),
    );
  return jpeg || png || heic;
}

/** O texto do PDF pelo pdf.js, num pacote à parte (só agora o navegador o baixa). */
async function lerPdf(
  nome: string,
  bytes: ArrayBuffer,
): Promise<{ ok: true; entrada: EntradaDoExtrato } | FalhaDoExtrato> {
  // Sem internet (ou com o site publicado de novo, e o pacote antigo fora do ar), o import() falha.
  const leitor = await import("./pdf").catch(() => null);
  if (leitor === null) return FALHAS_DO_PDF.leitor;
  const lido = await leitor.lerTextoDoPdf(bytes);
  return lido.ok
    ? { ok: true, entrada: { tipo: "pdf", nome, texto: lido.texto } }
    : lido;
}

/** O arquivo pronto para ler: o texto (UTF-8 ou Windows-1252) ou, no PDF, o texto das páginas; ou a falha. */
export async function lerArquivoDoExtrato(
  arquivo: File,
): Promise<{ ok: true; entrada: EntradaDoExtrato } | FalhaDoExtrato> {
  if (arquivo.size > MAXIMO_BYTES_EXTRATO)
    return {
      ok: false,
      titulo: "O arquivo é grande demais",
      mensagem:
        "O limite é de 5 MB. Baixe do banco um período menor (por exemplo, a última semana).",
    };
  try {
    const bytes = await arquivo.arrayBuffer();
    if (ehImagem(arquivo, bytes)) return FALHAS_DO_COMPROVANTE.imagem;
    if (ehPdf(arquivo, bytes)) return await lerPdf(arquivo.name, bytes);
    return {
      ok: true,
      entrada: {
        tipo: "arquivo",
        nome: arquivo.name,
        texto: decodificar(bytes).texto,
      },
    };
  } catch {
    return {
      ok: false,
      titulo: "Não foi possível ler o arquivo",
      mensagem: "Escolha o arquivo de novo.",
    };
  }
}

/** Lê o extrato pelo formato que o conteúdo mostra. */
export function lerExtrato(
  entrada: EntradaDoExtrato,
  contexto: ContextoDeLeitura,
): LeituraDoExtrato {
  const texto = entrada.texto;
  if (texto.trim() === "") return VAZIO;
  const lido = (extrato: ExtratoLido | FalhaDoExtrato): LeituraDoExtrato =>
    extrato.ok ? { ok: true, tipo: "lido", extrato } : extrato;
  if (entrada.tipo === "pdf") {
    // O comprovante de Pix (RIFA-074): um Pix só, com o identificador e o ID da transação.
    if (pareceComprovante(texto)) {
      const comprovante = lerComprovante(texto, contexto);
      return "ok" in comprovante
        ? comprovante
        : lido(extratoDoComprovante(comprovante));
    }
    // As linhas do PDF são o texto que a pessoa colaria: o mesmo leitor, com as falhas ditas para o PDF.
    const extrato = lerTextoColado(texto, contexto);
    if (extrato.ok) return lido({ ...extrato, formato: "pdf" });
    return extrato === SEM_LANCAMENTOS_NO_TEXTO
      ? FALHAS_DO_PDF.semLancamentos
      : FALHAS_DO_PDF.grande;
  }
  if (ehOfx(texto)) return lido(lerOfx(texto, contexto));
  if (
    entrada.tipo === "arquivo" &&
    (/\.csv$/i.test(entrada.nome) || pareceCsv(texto))
  ) {
    const csv = lerCsvDoExtrato(texto);
    if (csv !== null) return "ok" in csv ? csv : { ok: true, tipo: "csv", csv };
  }
  return lido(lerTextoColado(texto, contexto));
}
