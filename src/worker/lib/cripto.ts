/**
 * Segredos do acesso (RIFA-007): o token do link pessoal e o id da sessão (valor do cookie).
 *
 * - Cada segredo tem 32 bytes de crypto.getRandomValues (256 bits), em base64url sem "=" (43 caracteres).
 * - O banco guarda só o SHA-256 em hex minúsculo, e a busca é pelo hash: quem lê o banco não consegue
 *   montar um link nem um cookie válido.
 * - scripts/criar-acesso.mjs repete estas funções (ele roda no Node, fora do build) e um teste confere que
 *   as duas versões dão o mesmo resultado.
 */

export const BYTES_SEGREDO = 32;

/** Formato de um segredo gerado por gerarSegredo(). */
export const FORMATO_SEGREDO = /^[A-Za-z0-9_-]{43}$/;

/** Novo segredo aleatório (token de link ou id de sessão). */
export function gerarSegredo(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BYTES_SEGREDO));
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** SHA-256 do texto (UTF-8), em hex minúsculo: é o que vai para o banco. */
export async function sha256Hex(texto: string): Promise<string> {
  const resumo = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return Array.from(new Uint8Array(resumo), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
