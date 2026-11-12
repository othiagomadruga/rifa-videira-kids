/**
 * Segredos do acesso (RIFA-007): o token do link pessoal e o id da sessão (valor do cookie). E o token do webhook
 * da Rifei gerado pela tela (RIFA-039, D21).
 *
 * - Cada segredo tem 32 bytes de crypto.getRandomValues (256 bits), em base64url sem "=" (43 caracteres); o token
 *   do webhook, os mesmos 32 bytes em hex minúsculo (64 caracteres, só letras e números, para o formulário da Rifei).
 * - O banco guarda só o SHA-256 em hex minúsculo, e a busca é pelo hash: quem lê o banco não consegue
 *   montar um link nem um cookie válido. O token do webhook não é buscado pelo hash: o webhook lê a linha pela
 *   chave e compara em tempo constante (lib/tempo-constante.ts).
 * - scripts/criar-acesso.mjs repete gerarSegredo e sha256Hex (ele roda no Node, fora do build) e um teste confere
 *   que as duas versões dão o mesmo resultado.
 */
import { BYTES_TOKEN_WEBHOOK } from "../../shared/contracts";

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

/** Os bytes em hex minúsculo, dois caracteres por byte. */
function emHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** SHA-256 do texto (UTF-8), em hex minúsculo: é o que vai para o banco. */
export async function sha256Hex(texto: string): Promise<string> {
  const resumo = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return emHex(new Uint8Array(resumo));
}

/**
 * Token novo do webhook da Rifei (RIFA-039, D21): BYTES_TOKEN_WEBHOOK (32) bytes de crypto.getRandomValues em hex
 * minúsculo (FORMATO_TOKEN_WEBHOOK, 64 caracteres), como o `openssl rand -hex 32` do roteiro. Só a resposta que o
 * gera o leva; o banco guarda o sha256Hex dele.
 */
export function gerarTokenWebhook(): string {
  return emHex(crypto.getRandomValues(new Uint8Array(BYTES_TOKEN_WEBHOOK)));
}
