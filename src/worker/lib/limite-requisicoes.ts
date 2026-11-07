/**
 * Limite de requisições por cliente (RIFA-013b; docs/decisions.md D11):
 * - POST /api/sessao: LIMITE_LOGIN (10 por minuto), toda tentativa conta;
 * - rotas abertas (/api/publico/* e /api/health): LIMITE_PUBLICO (60 por minuto), só as idas ao banco
 *   contam. A resposta que sai do cache (30 s) é barata e não conta: muita gente atrás do mesmo IP (o Wi-Fi
 *   da igreja, a operadora do celular) abre o ranking sem esbarrar no limite.
 * Acima do limite: 429 `muitas_requisicoes` no formato único (responderErro), com `Retry-After`.
 *
 * Chave: o IP do cliente, do `CF-Connecting-IP` (a Cloudflare põe o IP real e o cliente não consegue
 * trocar); IPv6 pelo prefixo /64, porque uma casa ou um celular recebe um /64 inteiro. Sem o cabeçalho
 * (só nos testes que chamam o Worker direto; o `npm run dev` põe o do navegador), não há limite.
 *
 * Contador: o binding de Rate Limiting do Workers (`ratelimits` no wrangler.jsonc; limite e período estão
 * lá e precisam bater com as regras daqui). Ele conta por data center da Cloudflare e é "permissivo"
 * (eventualmente consistente): serve contra abuso, não como conta exata. Se o binding faltar, vale uma
 * janela fixa na memória do isolate, que só enxerga as requisições daquele isolate. Uma falha do binding
 * vai para o log e deixa passar: o limite nunca derruba o site.
 */
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { responderErro } from "./respostas-erro";

/** Bindings de Rate Limiting declarados no wrangler.jsonc (e em worker-env.d.ts). */
export type NomeDoLimitador = "LIMITE_PUBLICO" | "LIMITE_LOGIN";

export interface RegraDeLimite {
  binding: NomeDoLimitador;
  /** Requisições por período, por IP. */
  limite: number;
  /** O binding só aceita 10 ou 60 segundos. */
  periodoSegundos: 10 | 60;
}

export const LIMITE_PUBLICO: RegraDeLimite = {
  binding: "LIMITE_PUBLICO",
  limite: 60,
  periodoSegundos: 60,
};

export const LIMITE_LOGIN: RegraDeLimite = {
  binding: "LIMITE_LOGIN",
  limite: 10,
  periodoSegundos: 60,
};

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** As 4 primeiras partes de 16 bits de um IPv6 (o /64), em minúsculas; null se não for um IPv6 válido. */
function prefixoIpv6(endereco: string): string | null {
  const semZona = endereco.split("%")[0].toLowerCase();
  const metades = semZona.split("::");
  if (metades.length > 2) return null;
  const partes = (texto: string) => (texto === "" ? [] : texto.split(":"));
  const inicio = partes(metades[0]);
  const fim = metades.length === 2 ? partes(metades[1]) : [];
  // Um IPv4 no fim ("::ffff:1.2.3.4") ocupa as 2 últimas partes: não muda o /64.
  const tamanhoFim = fim.reduce(
    (soma, parte) => soma + (parte.includes(".") ? 2 : 1),
    0,
  );
  const faltam = 8 - inicio.length - tamanhoFim;
  if (metades.length === 2 ? faltam < 1 : faltam !== 0) return null;
  const completas = [...inicio, ...Array<string>(faltam).fill("0"), ...fim];
  if (!completas.slice(0, 4).every((parte) => /^[0-9a-f]{1,4}$/.test(parte)))
    return null;
  return completas
    .slice(0, 4)
    .map((parte) => parte.replace(/^0+(?=.)/, ""))
    .join(":");
}

/**
 * Chave do cliente para o limite: o IPv4 inteiro ou o /64 do IPv6 (`ipv6:2001:db8:1:2::/64`), a partir do
 * `CF-Connecting-IP`. null sem o cabeçalho (sem limite) ou com um valor que não é IP (vira uma chave só,
 * "invalido", para não abrir uma porta sem limite).
 */
export function chaveDoCliente(requisicao: Request): string | null {
  const ip = requisicao.headers.get("CF-Connecting-IP")?.trim();
  if (ip === undefined || ip === "") return null;
  if (IPV4.test(ip)) return `ipv4:${ip}`;
  // IPv4 escrito como IPv6 ("::ffff:1.2.3.4"): é o IPv4 (o /64 juntaria todos eles numa chave só).
  const mapeado = /^::ffff:(.+)$/i.exec(ip)?.[1];
  if (mapeado !== undefined && IPV4.test(mapeado)) return `ipv4:${mapeado}`;
  if (ip.includes(":")) {
    const prefixo = prefixoIpv6(ip);
    if (prefixo !== null) return `ipv6:${prefixo}::/64`;
  }
  return "invalido";
}

interface Janela {
  numero: number;
  contagem: number;
}

/** Chaves guardadas na memória de cada isolate, no máximo (cada uma é um IP no período). */
export const MAXIMO_CHAVES_NA_MEMORIA = 10_000;

export interface LimitadorNaMemoria {
  /** true = dentro do limite (e conta esta requisição). */
  permitir(regra: RegraDeLimite, chave: string, agoraMs: number): boolean;
}

/**
 * Janela fixa por período, alinhada ao relógio (como o binding faz no Miniflare): conta por regra e chave
 * até o limite; na janela seguinte, recomeça. Para não crescer sem fim, ao passar de
 * MAXIMO_CHAVES_NA_MEMORIA apaga as janelas velhas e, se ainda não couber, recomeça do zero.
 */
export function criarLimitadorNaMemoria(): LimitadorNaMemoria {
  const janelas = new Map<string, Janela>();
  return {
    permitir(regra, chave, agoraMs) {
      const numero = Math.floor(agoraMs / (regra.periodoSegundos * 1000));
      const id = `${regra.binding}|${chave}`;
      const atual = janelas.get(id);
      const contagem = atual?.numero === numero ? atual.contagem : 0;
      if (contagem >= regra.limite) return false;
      if (atual === undefined && janelas.size >= MAXIMO_CHAVES_NA_MEMORIA) {
        for (const [outro, janela] of janelas)
          if (janela.numero !== numero) janelas.delete(outro);
        if (janelas.size >= MAXIMO_CHAVES_NA_MEMORIA) janelas.clear();
      }
      janelas.set(id, { numero, contagem: contagem + 1 });
      return true;
    },
  };
}

/** O do isolate: só é usado quando o binding não existe. */
const naMemoriaDoIsolate = criarLimitadorNaMemoria();

/**
 * true = a requisição pode seguir (e foi contada); false = passou do limite da regra para este cliente.
 * Sem chave do cliente, sempre true.
 */
export async function dentroDoLimite(
  env: Cloudflare.Env,
  requisicao: Request,
  regra: RegraDeLimite,
  memoria: LimitadorNaMemoria = naMemoriaDoIsolate,
): Promise<boolean> {
  const chave = chaveDoCliente(requisicao);
  if (chave === null) return true;
  const binding = env[regra.binding];
  if (binding === undefined) return memoria.permitir(regra, chave, Date.now());
  try {
    return (await binding.limit({ key: chave })).success;
  } catch (erro) {
    console.error(
      `Limite de requisições (${regra.binding}): falha no binding, a requisição segue`,
      erro,
    );
    return true;
  }
}

/**
 * 429 `muitas_requisicoes` (status do contrato, por responderErro), com `Retry-After` (o período da regra,
 * em segundos) e `no-store`: o cliente espera o período e tenta de novo.
 */
export function responderLimiteExcedido(
  c: Context,
  regra: RegraDeLimite,
): Response {
  const segundos = regra.periodoSegundos;
  c.header("Retry-After", String(segundos));
  c.header("Cache-Control", "no-store");
  const espera = segundos === 60 ? "um minuto" : `${segundos} segundos`;
  return responderErro(
    c,
    "muitas_requisicoes",
    `Muitas requisições em pouco tempo: espere ${espera} e tente de novo`,
  );
}

/** Middleware: conta a requisição na regra e responde 429 acima do limite. */
export function limitarRequisicoes(regra: RegraDeLimite) {
  return createMiddleware<{ Bindings: Cloudflare.Env }>(async (c, next) => {
    if (!(await dentroDoLimite(c.env, c.req.raw, regra)))
      return responderLimiteExcedido(c, regra);
    await next();
  });
}
