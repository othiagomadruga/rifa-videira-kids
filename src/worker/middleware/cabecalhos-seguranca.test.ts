/// <reference types="vite/client" />
// RIFA-007b: cabeçalhos de segurança em todas as respostas da API e no public/_headers do site.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import arquivoHeaders from "../../../public/_headers?raw";
import {
  chamar,
  cookieDaResposta,
  criarAcessoNoBanco,
  criarAppDeTeste,
} from "../test/acesso-teste";
import {
  CABECALHOS_SEGURANCA,
  cabecalhosSeguranca,
} from "./cabecalhos-seguranca";

function esperarCabecalhos(res: Response): void {
  expect({
    "Referrer-Policy": res.headers.get("Referrer-Policy"),
    "X-Content-Type-Options": res.headers.get("X-Content-Type-Options"),
    "X-Frame-Options": res.headers.get("X-Frame-Options"),
    "Content-Security-Policy": res.headers.get("Content-Security-Policy"),
  }).toEqual({
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
}

/** Diretivas da CSP: { "default-src": ["'self'"], ... }. */
function diretivasCsp(politica: string): Record<string, string[]> {
  return Object.fromEntries(
    politica
      .split(";")
      .map((parte) => parte.trim().split(/\s+/))
      .filter(([nome]) => nome !== "")
      .map(([nome, ...fontes]) => [nome.toLowerCase(), fontes]),
  );
}

/** Um app mínimo com o middleware primeiro, como no src/worker/index.ts. */
function appMinimo() {
  const app = new Hono();
  app.use("*", cabecalhosSeguranca);
  app.get("/api/json", (c) => c.json({ ok: true }));
  app.get("/api/resposta-pronta", () =>
    Response.json({ pronta: true }, { headers: { "X-Proprio": "1" } }),
  );
  app.get("/api/falha", () => {
    throw new Error("falha de teste");
  });
  app.notFound((c) => c.json({ erro: "nao_encontrado" }, 404));
  app.onError((_erro, c) => c.json({ erro: "erro_interno" }, 500));
  return app;
}

describe("middleware cabecalhosSeguranca", () => {
  it.each([
    ["200 de uma rota", "/api/json", 200],
    [
      "Response montada à mão (cabeçalhos imutáveis)",
      "/api/resposta-pronta",
      200,
    ],
    ["404 de rota inexistente", "/api/nao-existe", 404],
    ["500 do onError", "/api/falha", 500],
  ])("aplica os 4 cabeçalhos: %s", async (_caso, caminho, status) => {
    const res = await appMinimo().request(caminho);

    expect(res.status).toBe(status);
    esperarCabecalhos(res);
  });

  it("mantém o corpo e os cabeçalhos da rota", async () => {
    const res = await appMinimo().request("/api/resposta-pronta");

    expect(res.headers.get("X-Proprio")).toBe("1");
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toEqual({ pronta: true });
  });

  it("vale também nas respostas do acesso: 401, 403 e o login com Set-Cookie", async () => {
    const app = criarAppDeTeste();
    const acesso = await criarAcessoNoBanco("coordenacao");

    const semSessao = await chamar(app, "GET", "/api/admin/exemplo");
    const outraOrigem = await chamar(app, "POST", "/api/sessao", {
      corpo: { token: acesso.token },
      origem: "https://site-malicioso.example",
    });
    const login = await chamar(app, "POST", "/api/sessao", {
      corpo: { token: acesso.token },
    });

    expect([semSessao.status, outraOrigem.status, login.status]).toEqual([
      401, 403, 200,
    ]);
    for (const res of [semSessao, outraOrigem, login]) esperarCabecalhos(res);
    expect(cookieDaResposta(login)?.valor).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(login.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("Content-Security-Policy (RIFA-013)", () => {
  const csp = diretivasCsp(CABECALHOS_SEGURANCA["Content-Security-Policy"]);

  it("script, estilo, fonte e fetch só da própria origem: sem inline, sem eval e sem outro host", () => {
    // Sem script-src, style-src, font-src e connect-src próprios: valem as fontes do default-src.
    expect(csp["default-src"]).toEqual(["'self'"]);
    for (const diretiva of [
      "script-src",
      "script-src-elem",
      "script-src-attr",
      "style-src",
      "style-src-elem",
      "style-src-attr",
      "font-src",
      "connect-src",
    ])
      expect({ diretiva, fontes: csp[diretiva] }).toEqual({
        diretiva,
        fontes: undefined,
      });
    const todas = Object.values(csp).flat();
    for (const proibida of [
      "'unsafe-inline'",
      "'unsafe-eval'",
      "'unsafe-hashes'",
      "'wasm-unsafe-eval'",
      "*",
      "http:",
      "https:",
      "blob:",
    ])
      expect(todas).not.toContain(proibida);
  });

  it("imagens só da origem e em data: (a seta do <select> é um SVG em data: no CSS)", () => {
    expect(csp["img-src"]).toEqual(["'self'", "data:"]);
  });

  it("sem plugins, sem <base>, formulários só para a origem e nenhuma moldura (clickjacking)", () => {
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
  });
});

describe("public/_headers (site, aplicado pelo Workers Static Assets)", () => {
  /** Regras do arquivo no formato da Cloudflare: caminho na coluna 0, cabeçalhos indentados abaixo. */
  function regras(texto: string): Record<string, Record<string, string>> {
    const resultado: Record<string, Record<string, string>> = {};
    let atual: Record<string, string> | null = null;
    for (const linha of texto.split("\n")) {
      if (linha.trim() === "" || linha.trim().startsWith("#")) continue;
      if (!/^\s/.test(linha)) {
        atual = resultado[linha.trim()] = {};
        continue;
      }
      const separador = linha.indexOf(":");
      expect(atual).not.toBeNull();
      atual![linha.slice(0, separador).trim()] = linha
        .slice(separador + 1)
        .trim();
    }
    return resultado;
  }

  it("tem uma regra para todas as rotas com os mesmos cabeçalhos da API", () => {
    expect(regras(arquivoHeaders)).toEqual({
      "/*": { ...CABECALHOS_SEGURANCA },
    });
  });
});
