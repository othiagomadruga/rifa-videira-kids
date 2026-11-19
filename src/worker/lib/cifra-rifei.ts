/**
 * Cifra do token da Rifei guardado no D1 (RIFA-070, D32): AES-GCM de 256 bits. A chave é o SHA-256 do segredo do
 * Worker RIFEI_CHAVE_CIFRA (um texto aleatório de ao menos 32 caracteres, `openssl rand -base64 32`), então quem lê o
 * banco sem o segredo não abre o token. Formato gravado: "v1:<iv em base64>:<cifra em base64>" (iv de 12 bytes,
 * novo a cada gravação). O texto adicional "rifei_conexao" amarra a cifra a esta tabela.
 */
const VERSAO = "v1";
const DADO_ADICIONAL = new TextEncoder().encode("rifei_conexao");

function emBase64(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

function deBase64(texto: string): Uint8Array<ArrayBuffer> {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function chaveAes(segredo: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(segredo.trim()),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** O token cifrado, no formato da coluna `rifei_conexao.token_cifrado`. */
export async function cifrarTokenRifei(
  token: string,
  segredo: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifra = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: DADO_ADICIONAL },
    await chaveAes(segredo),
    new TextEncoder().encode(token),
  );
  return `${VERSAO}:${emBase64(iv)}:${emBase64(new Uint8Array(cifra))}`;
}

/** O token aberto, ou null se o formato não é o esperado ou a chave não abre (o segredo mudou ou sumiu). */
export async function decifrarTokenRifei(
  cifrado: string,
  segredo: string,
): Promise<string | null> {
  const [versao, iv, cifra, ...resto] = cifrado.split(":");
  if (versao !== VERSAO || !iv || !cifra || resto.length > 0) return null;
  try {
    const aberto = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: deBase64(iv), additionalData: DADO_ADICIONAL },
      await chaveAes(segredo),
      deBase64(cifra),
    );
    return new TextDecoder().decode(aberto);
  } catch {
    return null;
  }
}
