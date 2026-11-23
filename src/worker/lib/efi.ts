/**
 * Saldo da conta Efí pela API Pix (RIFA-086, D40). Só leitura: o token OAuth e o GET /v2/gn/saldo.
 *
 * - A Efí exige o certificado do cliente (mTLS) em TODA chamada: as duas vão pelo binding `EFI_CERT`
 *   (`mtls_certificates` no wrangler.jsonc), nunca pelo `fetch` global. Sem o binding ou sem os segredos
 *   `EFI_CLIENT_ID` e `EFI_CLIENT_SECRET`, a Efí não está configurada: `configurado: false`, sem chamada nenhuma.
 * - Token: POST /oauth/token com Basic base64("client_id:client_secret") e `{"grant_type":"client_credentials"}`;
 *   guardado na memória do isolate até `expires_in` menos uma folga, por credencial (trocar o segredo troca a chave).
 *   A Efí recusou o token na consulta (401/403): o token guardado é descartado.
 * - Saldo: `{"saldo":"100.00"}` (texto com ponto) → centavos por texto, sem ponto flutuante (D2).
 * - Cada chamada tem um tempo curto (TEMPO_LIMITE_EFI_MS); a resposta (saldo ou falha) vale CACHE_SALDO_EFI_MS na
 *   memória do isolate, então a tela e o e-mail vão à Efí no máximo uma vez por minuto em cada servidor.
 * - Nada de segredo, token ou corpo da Efí nos logs nem na resposta: só o passo e o status HTTP (ou o nome do erro).
 */
import {
  CACHE_SALDO_EFI_MS,
  type ErroSaldoEfi,
  type RespostaSaldoEfi,
} from "../../shared/contracts";

export const URL_TOKEN_EFI = "https://pix.api.efipay.com.br/oauth/token";
export const URL_SALDO_EFI = "https://pix.api.efipay.com.br/v2/gn/saldo";

/** Tempo de cada chamada à Efí (o token e o saldo). */
export const TEMPO_LIMITE_EFI_MS = 5_000;

/** O token é renovado este tempo antes de vencer (a Efí dá 3600 s). */
export const FOLGA_TOKEN_EFI_MS = 60_000;

/** O que a Efí precisa do ambiente do Worker. */
export type AmbienteEfi = Pick<
  Cloudflare.Env,
  "EFI_CERT" | "EFI_CLIENT_ID" | "EFI_CLIENT_SECRET"
>;

/** Para os testes: o relógio (ms) e onde vão os avisos. */
export interface OpcoesEfi {
  agora?: () => number;
  avisar?: (mensagem: string, detalhes: Record<string, unknown>) => void;
}

interface ConfiguracaoEfi {
  cert: Fetcher;
  clientId: string;
  clientSecret: string;
}

/** O binding e os dois segredos, ou null (Efí não configurada). Segredo vazio conta como ausente. */
export function configuracaoEfi(env: AmbienteEfi): ConfiguracaoEfi | null {
  const clientId = env.EFI_CLIENT_ID?.trim();
  const clientSecret = env.EFI_CLIENT_SECRET?.trim();
  if (!env.EFI_CERT || !clientId || !clientSecret) return null;
  return { cert: env.EFI_CERT, clientId, clientSecret };
}

/** "100.00" → 10000; "0.5" → 50; "-3.10" → −310. Fora do formato: null. Sem ponto flutuante. */
export function saldoEmCentavos(saldo: unknown): number | null {
  if (typeof saldo !== "string") return null;
  const partes = /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/.exec(saldo.trim());
  if (!partes) return null;
  const centavos =
    Number(partes[2]) * 100 + Number((partes[3] ?? "0").padEnd(2, "0"));
  return partes[1] === "-" && centavos !== 0 ? -centavos : centavos;
}

/** Base64 do texto em UTF-8 (o `btoa` sozinho só aceita Latin-1). */
function base64Utf8(texto: string): string {
  let binario = "";
  for (const byte of new TextEncoder().encode(texto))
    binario += String.fromCharCode(byte);
  return btoa(binario);
}

/** SHA-256 da credencial, só para a chave do token guardado (o segredo em si não fica na memória como chave). */
async function chaveDaCredencial(config: ConfiguracaoEfi): Promise<string> {
  const resumo = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${config.clientId}:${config.clientSecret}`),
  );
  return [...new Uint8Array(resumo)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

let tokenGuardado: { chave: string; valor: string; venceEm: number } | null =
  null;
let saldoGuardado: { resposta: RespostaSaldoEfi; em: number } | null = null;

/** Esquece o token e o saldo guardados (testes; e a troca de credencial também os descarta). */
export function esquecerEfi(): void {
  tokenGuardado = null;
  saldoGuardado = null;
}

/** Uma falha da Efí, com o código da resposta e o que vai para o log (sem segredo). */
class FalhaEfi extends Error {
  readonly codigo: ErroSaldoEfi;
  readonly passo: "token" | "saldo";
  readonly status: number | null;

  constructor(
    codigo: ErroSaldoEfi,
    passo: "token" | "saldo",
    status: number | null,
  ) {
    super(`Efí: falha no ${passo}`);
    this.codigo = codigo;
    this.passo = passo;
    this.status = status;
  }
}

/** Uma chamada pelo binding mTLS, com o tempo curto. Tempo esgotado e conexão caída viram FalhaEfi. */
async function chamar(
  config: ConfiguracaoEfi,
  passo: "token" | "saldo",
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await config.cert.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TEMPO_LIMITE_EFI_MS),
    });
  } catch (erro) {
    const nome = erro instanceof Error ? erro.name : "";
    throw new FalhaEfi(
      nome === "TimeoutError" || nome === "AbortError"
        ? "tempo_esgotado"
        : passo === "token"
          ? "autenticacao"
          : "consulta",
      passo,
      null,
    );
  }
}

async function lerJson(resposta: Response): Promise<unknown> {
  try {
    return await resposta.json();
  } catch {
    return null;
  }
}

async function obterToken(
  config: ConfiguracaoEfi,
  agora: number,
): Promise<{ chave: string; valor: string }> {
  const chave = await chaveDaCredencial(config);
  if (
    tokenGuardado !== null &&
    tokenGuardado.chave === chave &&
    tokenGuardado.venceEm > agora
  )
    return tokenGuardado;
  tokenGuardado = null;
  const resposta = await chamar(config, "token", URL_TOKEN_EFI, {
    method: "POST",
    headers: {
      Authorization: `Basic ${base64Utf8(`${config.clientId}:${config.clientSecret}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  if (!resposta.ok)
    throw new FalhaEfi("autenticacao", "token", resposta.status);
  const corpo = (await lerJson(resposta)) as {
    access_token?: unknown;
    expires_in?: unknown;
  } | null;
  const valor = corpo?.access_token;
  const segundos = corpo?.expires_in;
  if (
    typeof valor !== "string" ||
    valor === "" ||
    typeof segundos !== "number" ||
    !Number.isFinite(segundos) ||
    segundos <= 0
  )
    throw new FalhaEfi("resposta_invalida", "token", resposta.status);
  tokenGuardado = {
    chave,
    valor,
    venceEm: agora + Math.max(0, segundos * 1000 - FOLGA_TOKEN_EFI_MS),
  };
  return tokenGuardado;
}

async function lerSaldo(
  config: ConfiguracaoEfi,
  agora: number,
): Promise<number> {
  const token = await obterToken(config, agora);
  const resposta = await chamar(config, "saldo", URL_SALDO_EFI, {
    headers: { Authorization: `Bearer ${token.valor}` },
  });
  if (resposta.status === 401 || resposta.status === 403) {
    if (tokenGuardado?.chave === token.chave) tokenGuardado = null;
    throw new FalhaEfi("autenticacao", "saldo", resposta.status);
  }
  if (!resposta.ok) throw new FalhaEfi("consulta", "saldo", resposta.status);
  const corpo = (await lerJson(resposta)) as { saldo?: unknown } | null;
  const centavos = saldoEmCentavos(corpo?.saldo);
  if (centavos === null)
    throw new FalhaEfi("resposta_invalida", "saldo", resposta.status);
  return centavos;
}

/**
 * O saldo da Efí, no formato da rota (`respostaSaldoEfiSchema`). Nunca lança: falha vira `erro` (e um aviso no log,
 * sem segredo). Sem configuração, responde na hora, sem guardar nada.
 */
export async function consultarSaldoEfi(
  env: AmbienteEfi,
  opcoes: OpcoesEfi = {},
): Promise<RespostaSaldoEfi> {
  const agora = (opcoes.agora ?? Date.now)();
  const config = configuracaoEfi(env);
  if (config === null)
    return {
      configurado: false,
      saldo_centavos: null,
      consultado_em: new Date(agora).toISOString(),
    };
  if (saldoGuardado !== null && agora - saldoGuardado.em < CACHE_SALDO_EFI_MS)
    return saldoGuardado.resposta;

  const consultadoEm = new Date(agora).toISOString();
  let resposta: RespostaSaldoEfi;
  try {
    resposta = {
      configurado: true,
      saldo_centavos: await lerSaldo(config, agora),
      consultado_em: consultadoEm,
    };
  } catch (erro) {
    const falha =
      erro instanceof FalhaEfi ? erro : new FalhaEfi("consulta", "saldo", null);
    (opcoes.avisar ?? console.warn)("Efí: saldo indisponível", {
      passo: falha.passo,
      erro: falha.codigo,
      status: falha.status,
    });
    resposta = {
      configurado: true,
      saldo_centavos: null,
      consultado_em: consultadoEm,
      erro: falha.codigo,
    };
  }
  saldoGuardado = { resposta, em: agora };
  return resposta;
}
