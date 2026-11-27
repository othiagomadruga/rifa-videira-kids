/**
 * Web Push sem biblioteca (RIFA-095, docs/decisions.md D43), só com a Web Crypto do Worker:
 * - a criptografia do conteúdo `aes128gcm` da RFC 8291 (sobre a RFC 8188): ECDH P-256 com a chave do aparelho
 *   (`p256dh`), HKDF-SHA-256 com o segredo do aparelho (`auth`) e um sal novo, e AES-128-GCM num registro só;
 * - a identificação do servidor VAPID da RFC 8292: um JWT ES256 (`aud` = a origem do serviço de push, `exp` em até
 *   24 h, `sub` = o site) assinado com a chave privada VAPID, no cabeçalho `Authorization: vapid t=<jwt>, k=<pública>`.
 *
 * Por que sem biblioteca: as conhecidas (web-push) usam APIs do Node (crypto, https), e as feitas para Workers são
 * pequenas e pouco usadas; o que se precisa são ~150 linhas de Web Crypto, conferidas contra o exemplo da RFC 8291
 * (apêndice A) em web-push.test.ts. Nenhuma chave nem endpoint vai para log.
 */
import { FORMATO_CHAVE_P256 } from "../../shared/contracts";

type Bytes = Uint8Array<ArrayBuffer>;

const texto = new TextEncoder();

/** base64url (com ou sem `=`) → bytes. */
export function base64UrlParaBytes(valor: string): Bytes {
  const base64 = valor
    .replace(/=+$/, "")
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const binario = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** bytes → base64url sem `=`. */
export function bytesParaBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function juntar(...partes: Uint8Array[]): Bytes {
  const total = new Uint8Array(partes.reduce((soma, p) => soma + p.length, 0));
  let posicao = 0;
  for (const parte of partes) {
    total.set(parte, posicao);
    posicao += parte.length;
  }
  return total;
}

// ---------------------------------------------------------------------------------------------------
// As chaves VAPID
// ---------------------------------------------------------------------------------------------------

/** A chave privada VAPID: o `d` da P-256, 32 bytes em base64url (43 caracteres). */
export const FORMATO_CHAVE_PRIVADA_VAPID = /^[A-Za-z0-9_-]{43}$/;

/** O `sub` do VAPID quando o `vars` não traz um (o site do projeto; nunca um e-mail, D43). */
export const SUB_VAPID_PADRAO = "https://projetokidsbelem.com.br";

export interface ChavesVapid {
  /** A pública, sem compressão (65 bytes, 87 caracteres em base64url): vai no `k=` e no navegador. */
  publica: string;
  /** A privada (o `d`). */
  privada: string;
  sub: string;
}

/**
 * As chaves do ambiente, ou null (o recurso desligado): sem a pública (`vars` do wrangler.jsonc) ou sem a privada
 * (segredo do Worker), ou com uma delas vazia. Fora do formato também desliga, com um aviso no log (sem o valor).
 */
export function chavesVapidDoAmbiente(env: Cloudflare.Env): ChavesVapid | null {
  const publica = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privada = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (publica === "" || privada === "") return null;
  if (
    !FORMATO_CHAVE_P256.test(publica) ||
    !FORMATO_CHAVE_PRIVADA_VAPID.test(privada)
  ) {
    console.error({
      aviso: "vapid_fora_do_formato",
      mensagem:
        "Notificações de venda desligadas: VAPID_PUBLIC_KEY (87 caracteres) ou VAPID_PRIVATE_KEY (43) fora do formato",
    });
    return null;
  }
  const sub = env.VAPID_SUBJECT?.trim() || SUB_VAPID_PADRAO;
  return { publica, privada, sub };
}

/** x e y (base64url) de uma pública P-256 sem compressão. */
function coordenadas(publica: string): { x: string; y: string } {
  const bytes = base64UrlParaBytes(publica);
  if (bytes.length !== 65 || bytes[0] !== 4)
    throw new RangeError("Chave pública P-256 fora do formato");
  return {
    x: bytesParaBase64Url(bytes.subarray(1, 33)),
    y: bytesParaBase64Url(bytes.subarray(33, 65)),
  };
}

/** A chave privada P-256 (d, com o x e o y da pública) para ECDSA (VAPID) ou ECDH (o par do exemplo da RFC). */
export function importarChavePrivada(
  publica: string,
  privada: string,
  uso: "ECDSA" | "ECDH",
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: privada,
      ...coordenadas(publica),
      ext: false,
    },
    { name: uso, namedCurve: "P-256" },
    false,
    uso === "ECDSA" ? ["sign"] : ["deriveBits"],
  );
}

/** Validade do JWT do VAPID: 12 h (a RFC 8292 aceita até 24 h). */
export const VALIDADE_JWT_VAPID_SEGUNDOS = 12 * 60 * 60;

/**
 * O JWT ES256 do VAPID (RFC 8292): `{"typ":"JWT","alg":"ES256"}` e `{ aud, exp, sub }`. A assinatura da Web Crypto já
 * sai no formato do JWS (r || s, 64 bytes).
 */
export async function assinarJwtVapid(
  chavePrivada: CryptoKey,
  { aud, sub, agora }: { aud: string; sub: string; agora: Date },
): Promise<string> {
  const parte = (objeto: object) =>
    bytesParaBase64Url(texto.encode(JSON.stringify(objeto)));
  const exp = Math.floor(agora.getTime() / 1000) + VALIDADE_JWT_VAPID_SEGUNDOS;
  const assinado = `${parte({ typ: "JWT", alg: "ES256" })}.${parte({ aud, exp, sub })}`;
  const assinatura = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    chavePrivada,
    texto.encode(assinado),
  );
  return `${assinado}.${bytesParaBase64Url(new Uint8Array(assinatura))}`;
}

// ---------------------------------------------------------------------------------------------------
// aes128gcm (RFC 8291 e RFC 8188)
// ---------------------------------------------------------------------------------------------------

/** O tamanho do registro: o conteúdo inteiro cabe num só (o push tem no máximo 4 KiB). */
export const TAMANHO_REGISTRO = 4096;

async function hkdf(
  sal: Uint8Array,
  materia: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Bytes> {
  const chave = await crypto.subtle.importKey(
    "raw",
    juntar(materia),
    "HKDF",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: juntar(sal), info: juntar(info) },
      chave,
      bytes * 8,
    ),
  );
}

/** Para os testes (o exemplo da RFC): o par ECDH do servidor e o sal, que normalmente são novos a cada mensagem. */
export interface FixosDaCifra {
  par: CryptoKeyPair;
  sal: Bytes;
}

/**
 * O corpo do push: cabeçalho (sal, tamanho do registro, a pública efêmera do servidor) e o conteúdo cifrado, com o
 * delimitador 0x02 do último registro. `p256dh` e `auth` são as chaves do aparelho (base64url). Um par ECDH e um sal
 * novos a cada chamada (a não ser nos testes).
 */
export async function cifrarAes128gcm(
  conteudo: Uint8Array,
  p256dh: string,
  auth: string,
  fixos?: FixosDaCifra,
): Promise<Bytes> {
  const publicaDoAparelho = base64UrlParaBytes(p256dh);
  const segredo = base64UrlParaBytes(auth);
  if (conteudo.length + 1 + 16 > TAMANHO_REGISTRO)
    throw new RangeError("O conteúdo do push passa de um registro");
  const par =
    fixos?.par ??
    ((await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair);
  const sal = fixos?.sal ?? crypto.getRandomValues(new Uint8Array(16));
  const publicaDoServidor = new Uint8Array(
    (await crypto.subtle.exportKey("raw", par.publicKey)) as ArrayBuffer,
  );
  const chaveDoAparelho = await crypto.subtle.importKey(
    "raw",
    publicaDoAparelho,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const segredoEcdh = new Uint8Array(
    await crypto.subtle.deriveBits(
      // `public` é o nome do padrão (o workerd também usa); os tipos do Workers o chamam de `$public`.
      {
        name: "ECDH",
        public: chaveDoAparelho,
      } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      par.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(
    segredo,
    segredoEcdh,
    juntar(
      texto.encode("WebPush: info\0"),
      publicaDoAparelho,
      publicaDoServidor,
    ),
    32,
  );
  const cek = await hkdf(
    sal,
    ikm,
    texto.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdf(
    sal,
    ikm,
    texto.encode("Content-Encoding: nonce\0"),
    12,
  );
  const chaveAes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ]);
  const cifrado = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      chaveAes,
      juntar(conteudo, Uint8Array.of(2)),
    ),
  );
  const tamanho = new Uint8Array(4);
  new DataView(tamanho.buffer).setUint32(0, TAMANHO_REGISTRO);
  return juntar(
    sal,
    tamanho,
    Uint8Array.of(publicaDoServidor.length),
    publicaDoServidor,
    cifrado,
  );
}

// ---------------------------------------------------------------------------------------------------
// O envio
// ---------------------------------------------------------------------------------------------------

/** Uma inscrição como o envio precisa. */
export interface InscricaoPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** aceito (2xx), expirado (404 ou 410: a inscrição acabou) ou falhou (o resto, o tempo esgotado e a rede). */
export type ResultadoPush = "aceito" | "expirado" | "falhou";

export interface ContextoDoEnvio {
  chaves: ChavesVapid;
  /** A privada VAPID já importada (uma vez por disparo). */
  chaveVapid: CryptoKey;
  /** Os JWTs por `aud` (um por serviço de push no disparo). */
  jwts: Map<string, Promise<string>>;
  ttlSegundos: number;
  tempoLimiteMs: number;
  agora: Date;
  fetch: typeof fetch;
}

/** Um push para uma inscrição: cifra, assina (o JWT do serviço, reaproveitado no disparo) e manda o POST. */
export async function enviarPush(
  inscricao: InscricaoPush,
  conteudo: Uint8Array,
  contexto: ContextoDoEnvio,
): Promise<ResultadoPush> {
  try {
    const aud = new URL(inscricao.endpoint).origin;
    let jwt = contexto.jwts.get(aud);
    if (jwt === undefined) {
      jwt = assinarJwtVapid(contexto.chaveVapid, {
        aud,
        sub: contexto.chaves.sub,
        agora: contexto.agora,
      });
      contexto.jwts.set(aud, jwt);
    }
    const corpo = await cifrarAes128gcm(
      conteudo,
      inscricao.p256dh,
      inscricao.auth,
    );
    const resposta = await contexto.fetch(inscricao.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${await jwt}, k=${contexto.chaves.publica}`,
        TTL: String(contexto.ttlSegundos),
        Urgency: "normal",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
      },
      body: corpo,
      // Um serviço de push não redireciona: seguir um redirect levaria o POST para outro servidor (SSRF).
      redirect: "manual",
      signal: AbortSignal.timeout(contexto.tempoLimiteMs),
    });
    await resposta.body?.cancel();
    if (resposta.status >= 200 && resposta.status < 300) return "aceito";
    if (resposta.status === 404 || resposta.status === 410) return "expirado";
    return "falhou";
  } catch {
    // Tempo esgotado, rede ou chave do aparelho inválida: conta como falha (o erro pode citar o endpoint: não vai
    // para o log).
    return "falhou";
  }
}
