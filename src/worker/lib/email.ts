/**
 * E-mail montado à mão (RIFA-086, D40), sem dependência nova: os destinatários do segredo e a mensagem MIME
 * `multipart/alternative` (texto puro e HTML, UTF-8) que o binding `send_email` da Cloudflare envia
 * (`new EmailMessage(de, para, mime)`, de "cloudflare:email").
 *
 * - Corpos em base64 (linhas de 76), então nenhuma linha passa do limite do SMTP e os acentos chegam inteiros.
 * - Assunto e nome do remetente com acento viram "encoded-words" do RFC 2047 (`=?UTF-8?B?...?=`), dobrados em
 *   linhas curtas sem cortar um caractere no meio.
 * - Fins de linha CRLF, linhas de até 78 caracteres (cabeçalhos longos dobrados); `Date`, `Message-ID` (o envio da
 *   Cloudflare o exige) e `Auto-Submitted: auto-generated`.
 * - O endereço é conferido antes (`lerDestinatarios`): nada de espaço, vírgula, `<`, `>` ou quebra de linha, então ele
 *   não injeta cabeçalho.
 */
import { LIMITE_DESTINATARIOS_RELATORIO_DIARIO } from "../../shared/contracts";

export const CRLF = "\r\n";

/** Um endereço simples: algo@dominio.tld, sem espaço, vírgula, ponto e vírgula, aspas, `<`, `>` nem controle. */
const ENDERECO =
  // eslint-disable-next-line no-control-regex -- os caracteres de controle são justamente o que se recusa
  /^[^\s@,;<>"()[\]\\\x00-\x1f\x7f]+@[^\s@,;<>"()[\]\\\x00-\x1f\x7f]+\.[a-z]{2,}$/i;

/**
 * Os destinatários do segredo `RELATORIO_EMAILS` (separados por vírgula ou ponto e vírgula): sem espaços nas pontas,
 * sem repetidos (sem diferenciar maiúsculas), só os válidos e até o limite. `ignorados`: os inválidos e os além do
 * limite (o envio avisa no log só a contagem, nunca o endereço).
 */
export function lerDestinatarios(texto: string | undefined): {
  validos: string[];
  ignorados: number;
} {
  const vistos = new Set<string>();
  const validos: string[] = [];
  let ignorados = 0;
  for (const parte of (texto ?? "").split(/[,;]/)) {
    const endereco = parte.trim();
    if (endereco === "") continue;
    const chave = endereco.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    if (
      ENDERECO.test(endereco) &&
      validos.length < LIMITE_DESTINATARIOS_RELATORIO_DIARIO
    )
      validos.push(endereco);
    else ignorados += 1;
  }
  return { validos, ignorados };
}

/** Base64 dos bytes. */
function base64(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

/** Base64 do texto em UTF-8, em linhas de 76 caracteres (RFC 2045). */
export function base64EmLinhas(texto: string): string {
  const codificado = base64(new TextEncoder().encode(texto));
  return codificado.match(/.{1,76}/g)?.join(CRLF) ?? "";
}

/**
 * Até 42 bytes por encoded-word: 56 caracteres de base64 e a palavra inteira com 68 (o teto é 75), então nem a 1ª
 * linha ("Subject: " + palavra) passa dos 78 caracteres recomendados.
 */
const BYTES_POR_PALAVRA = 42;

/**
 * Texto livre de cabeçalho (RFC 2047): ASCII imprimível fica como está; com acento, encoded-words em base64, uma por
 * linha dobrada, cada uma com caracteres inteiros (um caractere de vários bytes nunca é cortado).
 */
export function codificarCabecalho(texto: string): string {
  if (/^[\x20-\x7e]*$/.test(texto)) return texto;
  const codificador = new TextEncoder();
  const blocos: number[][] = [[]];
  for (const caractere of texto) {
    const bytes = codificador.encode(caractere);
    if (blocos[blocos.length - 1].length + bytes.length > BYTES_POR_PALAVRA)
      blocos.push([]);
    blocos[blocos.length - 1].push(...bytes);
  }
  return blocos
    .map((bloco) => `=?UTF-8?B?${base64(Uint8Array.from(bloco))}?=`)
    .join(`${CRLF} `);
}

/** O nome de exibição: entre aspas se é ASCII simples; senão, encoded-word. */
function nomeDeExibicao(nome: string): string {
  return /^[\x20-\x7e]*$/.test(nome) && !/["\\]/.test(nome)
    ? `"${nome}"`
    : codificarCabecalho(nome);
}

/** Data do RFC 5322: "Tue, 24 Nov 2026 10:00:00 +0000". */
export function dataDoCabecalho(instante: Date): string {
  return instante.toUTCString().replace(/ GMT$/, " +0000");
}

export interface MensagemEmail {
  remetente: { nome: string; email: string };
  para: string;
  assunto: string;
  texto: string;
  html: string;
  /** O instante do cabeçalho Date. */
  data: Date;
  /** Identificador único (o Message-ID fica `<id@domínio do remetente>`) e a fronteira das partes. */
  id: string;
}

/**
 * A mensagem MIME completa: cabeçalhos e as duas partes (texto puro primeiro, HTML depois: o leitor mostra a última
 * que entende). Lança se o remetente ou o destinatário não é um endereço simples (nunca deveria: vêm do código e de
 * `lerDestinatarios`).
 */
export function montarMime(mensagem: MensagemEmail): string {
  for (const endereco of [mensagem.remetente.email, mensagem.para])
    if (!ENDERECO.test(endereco))
      throw new RangeError("Endereço de e-mail inválido");
  if (!/^[\w.-]{1,100}$/.test(mensagem.id))
    throw new RangeError("Identificador da mensagem inválido");
  const dominio = mensagem.remetente.email.split("@")[1];
  const fronteira = `=_rvk_${mensagem.id}`;
  const linhas = [
    `From: ${nomeDeExibicao(mensagem.remetente.nome)} <${mensagem.remetente.email}>`,
    `To: <${mensagem.para}>`,
    `Subject: ${codificarCabecalho(mensagem.assunto)}`,
    `Date: ${dataDoCabecalho(mensagem.data)}`,
    `Message-ID: <${mensagem.id}@${dominio}>`,
    "Auto-Submitted: auto-generated",
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative;",
    ` boundary="${fronteira}"`,
    "",
    `--${fronteira}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64EmLinhas(mensagem.texto),
    `--${fronteira}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64EmLinhas(mensagem.html),
    `--${fronteira}--`,
    "",
  ];
  return linhas.join(CRLF);
}
