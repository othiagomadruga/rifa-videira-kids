/**
 * Hash da senha de login do admin (RIFA-073; docs/decisions.md D33): PBKDF2-SHA256 do Web Crypto, com sal aleatório de
 * 16 bytes por senha e ITERACOES_SENHA iterações (100.000, o máximo que o Workers aceita no PBKDF2; acima disso o
 * deriveBits lança erro). O resultado tem 32 bytes; sal e hash vão para o D1 em hex minúsculo (migração 0015).
 *
 * - A senha é normalizada em NFC antes do hash: o mesmo texto digitado em outro teclado (acento composto ou não) dá o
 *   mesmo hash.
 * - A comparação é em tempo constante (crypto.subtle.timingSafeEqual sobre os 32 bytes).
 * - Custo: cada conferência gasta da ordem de dezenas de ms de CPU (o Worker exige o Workers Paid desde a D19). O
 *   limite de tentativas por IP (LIMITE_LOGIN) segura quantas o login aceita.
 */

export const ITERACOES_SENHA = 100_000;
export const BYTES_SAL_SENHA = 16;
const BITS_HASH_SENHA = 256;

const codificador = new TextEncoder();

function emHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function deHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Sal novo: BYTES_SAL_SENHA bytes aleatórios em hex (32 caracteres). */
export function gerarSalSenha(): string {
  return emHex(crypto.getRandomValues(new Uint8Array(BYTES_SAL_SENHA)));
}

async function derivar(
  senha: string,
  salHex: string,
  iteracoes: number,
): Promise<Uint8Array> {
  const chave = await crypto.subtle.importKey(
    "raw",
    codificador.encode(senha.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: deHex(salHex),
      iterations: iteracoes,
    },
    chave,
    BITS_HASH_SENHA,
  );
  return new Uint8Array(bits);
}

/** O hash da senha (hex, 64 caracteres) com o sal e as iterações dados. */
export async function hashDaSenha(
  senha: string,
  salHex: string,
  iteracoes: number = ITERACOES_SENHA,
): Promise<string> {
  return emHex(await derivar(senha, salHex, iteracoes));
}

/** O que fica gravado de uma senha. */
export interface SenhaGravada {
  sal: string;
  hash: string;
  iteracoes: number;
}

/** Sal novo e hash da senha, para gravar. */
export async function prepararSenha(senha: string): Promise<SenhaGravada> {
  const sal = gerarSalSenha();
  return {
    sal,
    hash: await hashDaSenha(senha, sal),
    iteracoes: ITERACOES_SENHA,
  };
}

/**
 * Comparada quando o usuário digitado não existe: o PBKDF2 roda do mesmo jeito (mesmas iterações), para o tempo da
 * resposta não dizer se o usuário existe. Nunca confere: o hash é de um texto que a senha digitada não reproduz com
 * este sal (nenhuma senha real foi usada para gerá-lo; é só um valor fixo).
 */
export const SENHA_ADMIN_QUE_NUNCA_CONFERE: SenhaGravada = {
  sal: "00000000000000000000000000000000",
  hash: "0".repeat(64),
  iteracoes: ITERACOES_SENHA,
};

/** A senha digitada confere com a gravada? Em tempo constante. */
export async function senhaConfere(
  senha: string,
  gravada: SenhaGravada,
): Promise<boolean> {
  const calculado = await derivar(senha, gravada.sal, gravada.iteracoes);
  const esperado = deHex(gravada.hash);
  if (esperado.length !== calculado.length) return false;
  return crypto.subtle.timingSafeEqual(calculado, esperado);
}
