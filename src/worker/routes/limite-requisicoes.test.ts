// RIFA-013b, item 7: limite de requisições por IP no app real, com o binding de Rate Limiting do
// wrangler.jsonc (simulado pelo Miniflare no workerd local: janela fixa alinhada ao relógio, por período).
// - POST /api/sessao: 60 por minuto por IP desde a D12 (eram 10), toda tentativa conta; 60 logins de verdade
//   do mesmo IP passam e o 61º leva 429 (RIFA-014, CA9: a reunião dos líderes atrás do Wi-Fi da igreja);
// - /api/publico/*: 60 idas ao banco por minuto por IP; resposta do cache não conta.
// Cada teste usa IPs próprios (aleatórios): os contadores do binding valem para o arquivo todo.
import { env, exports } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { STATUS_HTTP_DO_ERRO, erroApiSchema } from "../../shared/contracts";
import { SEM_CACHE } from "../lib/cache-publico";
import { LIMITE_LOGIN, LIMITE_PUBLICO } from "../lib/limite-requisicoes";
import { ORIGEM, criarAcessoNoBanco } from "../test/acesso-teste";
import { semearCampanha } from "../test/painel-apoio";
import { PREFIXO_PUBLICO, criarPublico } from "./publico";

/** Um IPv4 de documentação diferente a cada chamada. */
function ipNovo(): string {
  const n = crypto.getRandomValues(new Uint8Array(3));
  return `198.${n[0]}.${n[1]}.${n[2]}`;
}

/**
 * A janela do binding é fixa e alinhada ao relógio (Miniflare): se faltam menos de `folgaMs` para ela virar,
 * espera a próxima, para a sequência do teste caber inteira numa janela só.
 */
async function esperarJanelaInteira(
  periodoSegundos: number,
  folgaMs = 5000,
): Promise<void> {
  const periodoMs = periodoSegundos * 1000;
  const resta = periodoMs - (Date.now() % periodoMs);
  if (resta < folgaMs)
    await new Promise((resolve) => setTimeout(resolve, resta + 50));
}

// A espera pela janela (até a folga: 20 s no CA9) soma-se ao tempo de cada teste e, conforme o segundo do minuto em
// que ele começa, passaria do prazo padrão do Vitest (5 s): o arquivo inteiro tem prazo maior.
vi.setConfig({ testTimeout: 60_000 });

function entrar(ip: string | null, corpo = '{"token":"link-que-nao-existe"}') {
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: ORIGEM,
  });
  if (ip !== null) headers.set("CF-Connecting-IP", ip);
  return exports.default.fetch(`${ORIGEM}/api/sessao`, {
    method: "POST",
    headers,
    body: corpo,
  });
}

async function esperar429(res: Response): Promise<void> {
  // O código do catálogo (erros.ts) e o status dele no contrato.
  expect(res.status).toBe(429);
  expect(res.status).toBe(STATUS_HTTP_DO_ERRO.muitas_requisicoes);
  expect(res.headers.get("Retry-After")).toBe("60");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const corpo: unknown = await res.json();
  expect(erroApiSchema.parse(corpo)).toEqual({
    erro: { codigo: "muitas_requisicoes", mensagem: expect.any(String) },
  });
}

describe("binding de Rate Limiting no workerd local", () => {
  it("os dois limitadores do wrangler.jsonc existem e respondem", async () => {
    expect(env.LIMITE_LOGIN).toBeDefined();
    expect(env.LIMITE_PUBLICO).toBeDefined();
    await expect(
      env.LIMITE_LOGIN!.limit({ key: `sonda:${ipNovo()}` }),
    ).resolves.toEqual({ success: true });
  });
});

describe("POST /api/sessao: 60 tentativas por minuto por IP (D12; eram 10)", () => {
  it("CA9: 60 logins de verdade do mesmo IP passam (60 pessoas com o próprio link); o 61º leva 429", async () => {
    expect(LIMITE_LOGIN.limite).toBe(60);
    const tokens = [];
    for (let pessoa = 0; pessoa <= LIMITE_LOGIN.limite; pessoa++)
      tokens.push((await criarAcessoNoBanco("coordenacao")).token);
    // Os 61 logins cabem com folga numa janela (cada um leva poucos ms).
    await esperarJanelaInteira(LIMITE_LOGIN.periodoSegundos, 20_000);
    const ip = ipNovo();
    for (const [vez, token] of tokens.slice(0, LIMITE_LOGIN.limite).entries()) {
      const res = await entrar(ip, JSON.stringify({ token }));
      expect({ vez: vez + 1, status: res.status }).toEqual({
        vez: vez + 1,
        status: 200,
      });
      expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-sessao=/);
    }
    const sessentaEUm = await entrar(
      ip,
      JSON.stringify({ token: tokens[LIMITE_LOGIN.limite] }),
    );
    expect(sessentaEUm.headers.get("Set-Cookie")).toBeNull();
    await esperar429(sessentaEUm);
    // O link do 61º continua bom: de outro IP, entra.
    expect(
      (
        await entrar(
          ipNovo(),
          JSON.stringify({ token: tokens[LIMITE_LOGIN.limite] }),
        )
      ).status,
    ).toBe(200);
  });

  it("a 61ª tentativa do mesmo IP leva 429 no formato único; outro IP continua (401 do link inválido)", async () => {
    await esperarJanelaInteira(LIMITE_LOGIN.periodoSegundos);
    const ip = ipNovo();

    for (let vez = 1; vez <= LIMITE_LOGIN.limite; vez++) {
      const res = await entrar(ip);
      expect({ vez, status: res.status }).toEqual({ vez, status: 401 });
    }
    await esperar429(await entrar(ip));
    // O limite vem antes do corpo: nem o JSON é lido (um corpo inválido também dá 429).
    await esperar429(await entrar(ip, "{"));

    expect((await entrar(ipNovo())).status).toBe(401);
  });

  it("o IPv6 conta pelo /64: dois endereços do mesmo prefixo dividem o limite", async () => {
    await esperarJanelaInteira(LIMITE_LOGIN.periodoSegundos);
    const n = crypto.getRandomValues(new Uint16Array(2));
    const prefixo = `2001:db8:${n[0].toString(16)}:${n[1].toString(16)}`;

    for (let vez = 1; vez <= LIMITE_LOGIN.limite; vez++)
      expect((await entrar(`${prefixo}::${vez.toString(16)}`)).status).toBe(
        401,
      );
    await esperar429(await entrar(`${prefixo}:ffff:ffff:ffff:ffff`));
  });

  it("de outra origem, 403 antes de contar: a página de outro site não gasta o limite de ninguém", async () => {
    await esperarJanelaInteira(LIMITE_LOGIN.periodoSegundos);
    const ip = ipNovo();
    for (let vez = 0; vez < LIMITE_LOGIN.limite + 5; vez++) {
      const res = await exports.default.fetch(`${ORIGEM}/api/sessao`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://site-malicioso.example",
          "CF-Connecting-IP": ip,
        },
        body: "{}",
      });
      expect(res.status).toBe(403);
    }
    expect((await entrar(ip)).status).toBe(401);
  });

  it("sem CF-Connecting-IP (só nos testes; a Cloudflare sempre põe), não há limite", async () => {
    for (let vez = 0; vez < LIMITE_LOGIN.limite + 3; vez++)
      expect((await entrar(null)).status).toBe(401);
  });
});

describe("/api/publico/*: 60 idas ao banco por minuto por IP; o cache não conta", () => {
  beforeAll(async () => {
    await semearCampanha();
  });

  it("sem cache, a 61ª consulta do mesmo IP leva 429 sem ir ao banco; outro IP continua", async () => {
    await esperarJanelaInteira(LIMITE_PUBLICO.periodoSegundos);
    // O sub-app sem cache: toda consulta iria ao banco.
    const app = new Hono<{ Bindings: Cloudflare.Env }>().route(
      PREFIXO_PUBLICO,
      criarPublico({ cache: SEM_CACHE }),
    );
    const ip = ipNovo();
    const consultar = (cliente: string) =>
      app.request(
        "/api/publico/ranking",
        { headers: { "CF-Connecting-IP": cliente } },
        env,
      );

    for (let vez = 1; vez <= LIMITE_PUBLICO.limite; vez++) {
      const res = await consultar(ip);
      expect({ vez, status: res.status }).toEqual({ vez, status: 200 });
    }
    const prepare = vi.spyOn(env.DB, "prepare");
    await esperar429(await consultar(ip));
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();

    expect((await consultar(ipNovo())).status).toBe(200);
  });

  it("no app real, a resposta do cache sai sem contar: 150 consultas iguais do mesmo IP, nenhum 429", async () => {
    const ip = ipNovo();
    for (let vez = 1; vez <= 150; vez++) {
      const res = await exports.default.fetch(
        `${ORIGEM}/api/publico/ranking?nivel=rede`,
        { headers: { "CF-Connecting-IP": ip } },
      );
      expect({ vez, status: res.status }).toEqual({ vez, status: 200 });
    }
  });

  it("GET /api/health (aberto, lê o D1 toda vez) entra no mesmo limite: a 61ª do mesmo IP dá 429", async () => {
    await esperarJanelaInteira(LIMITE_PUBLICO.periodoSegundos);
    const ip = ipNovo();
    const saude = (cliente: string) =>
      exports.default.fetch(`${ORIGEM}/api/health`, {
        headers: { "CF-Connecting-IP": cliente },
      });

    for (let vez = 1; vez <= LIMITE_PUBLICO.limite; vez++)
      expect((await saude(ip)).status).toBe(200);
    await esperar429(await saude(ip));
    expect((await saude(ipNovo())).status).toBe(200);
  });
});
