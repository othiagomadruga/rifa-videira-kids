// Apoio dos testes das notificações de venda (RIFA-095, D43): chaves VAPID e aparelhos fictícios gerados na hora (nada
// real), a decifração do lado do aparelho (RFC 8291, o caminho de volta) e um serviço de push falso no lugar do fetch.
import { base64UrlParaBytes, bytesParaBase64Url } from "../lib/web-push";

type Bytes = Uint8Array<ArrayBuffer>;

/** Um par VAPID novo, no formato do `vars` (pública, 87 caracteres) e do segredo (privada, 43). */
export async function gerarChavesVapid(): Promise<{
  publica: string;
  privada: string;
}> {
  const par = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publica = new Uint8Array(
    (await crypto.subtle.exportKey("raw", par.publicKey)) as ArrayBuffer,
  );
  const jwk = (await crypto.subtle.exportKey(
    "jwk",
    par.privateKey,
  )) as JsonWebKey;
  return { publica: bytesParaBase64Url(publica), privada: jwk.d! };
}

/** O env com as chaves VAPID (e o `sub`). */
export async function ambienteComVapid(
  env: Cloudflare.Env,
): Promise<Cloudflare.Env> {
  const { publica, privada } = await gerarChavesVapid();
  return {
    ...env,
    VAPID_PUBLIC_KEY: publica,
    VAPID_PRIVATE_KEY: privada,
    VAPID_SUBJECT: "https://projetokidsbelem.com.br",
  };
}

async function hkdf(
  sal: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Bytes> {
  const chave = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(ikm),
    "HKDF",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(sal),
        info: new Uint8Array(info),
      },
      chave,
      bytes * 8,
    ),
  );
}

/**
 * Decifra um corpo `aes128gcm` com a chave privada do aparelho (como o navegador faz), conferindo o cabeçalho (rs,
 * idlen) e o delimitador 0x02. Devolve o texto.
 */
export async function decifrarAes128gcm(
  corpo: Uint8Array,
  privadaDoAparelho: CryptoKey,
  publicaDoAparelho: Uint8Array,
  auth: Uint8Array,
): Promise<string> {
  const sal = corpo.subarray(0, 16);
  const rs = new DataView(corpo.buffer, corpo.byteOffset + 16, 4).getUint32(0);
  const idlen = corpo[20];
  if (rs !== 4096 || idlen !== 65) throw new Error("Cabeçalho inesperado");
  const publicaDoServidor = corpo.subarray(21, 21 + idlen);
  const cifrado = corpo.subarray(21 + idlen);
  const chaveDoServidor = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(publicaDoServidor),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const segredo = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "ECDH",
        public: chaveDoServidor,
      } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      privadaDoAparelho,
      256,
    ),
  );
  const texto = new TextEncoder();
  const junto = (...partes: Uint8Array[]) => {
    const total = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
    let i = 0;
    for (const parte of partes) {
      total.set(parte, i);
      i += parte.length;
    }
    return total;
  };
  const ikm = await hkdf(
    auth,
    segredo,
    junto(
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
  const chave = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "decrypt",
  ]);
  const aberto = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      chave,
      new Uint8Array(cifrado),
    ),
  );
  if (aberto[aberto.length - 1] !== 2) throw new Error("Sem o delimitador");
  return new TextDecoder().decode(aberto.subarray(0, -1));
}

export interface AparelhoFalso {
  endpoint: string;
  p256dh: string;
  auth: string;
  /** O texto que o aparelho leria neste corpo. */
  ler(corpo: Uint8Array): Promise<string>;
}

let contador = 0;

/** Um aparelho inscrito: chaves P-256 novas e um endpoint fictício do FCM (ou do serviço pedido). */
export async function criarAparelho(
  servidor = "fcm.googleapis.com",
): Promise<AparelhoFalso> {
  const par = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const publica = new Uint8Array(
    (await crypto.subtle.exportKey("raw", par.publicKey)) as ArrayBuffer,
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  contador += 1;
  return {
    endpoint: `https://${servidor}/fcm/send/aparelho-ficticio-${contador}-${bytesParaBase64Url(crypto.getRandomValues(new Uint8Array(6)))}`,
    p256dh: bytesParaBase64Url(publica),
    auth: bytesParaBase64Url(auth),
    ler: (corpo) => decifrarAes128gcm(corpo, par.privateKey, publica, auth),
  };
}

/** Um POST recebido pelo serviço de push falso. */
export interface PushRecebido {
  endpoint: string;
  cabecalhos: Headers;
  corpo: Uint8Array;
}

/**
 * O fetch de um serviço de push falso: guarda cada POST e responde com `responder(endpoint)` (padrão: 201). Nenhuma
 * requisição sai do teste.
 */
export function servicoDePushFalso(
  responder: (endpoint: string) => Response | Promise<Response> = () =>
    new Response(null, { status: 201 }),
) {
  const recebidos: PushRecebido[] = [];
  const buscar = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const endpoint = String(entrada);
    recebidos.push({
      endpoint,
      cabecalhos: new Headers(init?.headers),
      corpo: new Uint8Array(init?.body as Uint8Array),
    });
    return responder(endpoint);
  }) as typeof fetch;
  return { buscar, recebidos };
}

/** Grava um aparelho direto na tabela (com as falhas e o último envio pedidos). */
export async function inscreverNoBanco(
  db: D1Database,
  aparelho: Pick<AparelhoFalso, "endpoint" | "p256dh" | "auth">,
  extra: { falhas?: number; ultimoEnvioEm?: string | null } = {},
): Promise<number> {
  const linha = await db
    .prepare(
      `INSERT INTO push_inscricoes (endpoint, p256dh, auth, origem, criado_em, ultimo_envio_em, falhas)
       VALUES (?1, ?2, ?3, 'publico', '2026-11-27T12:00:00.000Z', ?4, ?5) RETURNING id`,
    )
    .bind(
      aparelho.endpoint,
      aparelho.p256dh,
      aparelho.auth,
      extra.ultimoEnvioEm ?? null,
      extra.falhas ?? 0,
    )
    .first<{ id: number }>();
  return linha!.id;
}

export { base64UrlParaBytes, bytesParaBase64Url };
