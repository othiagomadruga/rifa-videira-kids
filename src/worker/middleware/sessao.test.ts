// RIFA-007: middleware exigirSessao (401, 403 por papel, CSRF em escritas) no app montado como o index.ts.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { gerarSegredo, sha256Hex } from "../lib/cripto";
import { sessao as rotasSessao } from "../routes/acesso";
import { adminUsuarios } from "../routes/admin-usuarios";
import {
  ORIGEM,
  cabecalhosDeSessao,
  chamar,
  cookieDaResposta,
  criarAppDeTeste,
  erro,
  sessaoDe,
  type AppDeTeste,
} from "../test/acesso-teste";

let app: AppDeTeste;
beforeAll(() => {
  app = criarAppDeTeste();
});

const ESCRITAS = ["POST", "PUT", "PATCH", "DELETE"] as const;
const AREAS = ["/api/admin/exemplo", "/api/painel/exemplo"] as const;

describe("CA3: sem sessão válida → 401", () => {
  it.each([...AREAS, "/api/admin/usuarios", "/api/sessao"])(
    "GET %s sem cookie responde 401",
    async (caminho) => {
      const res = await chamar(app, "GET", caminho);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(erro("nao_autenticado"));
    },
  );

  it("cookie com sessão desconhecida responde 401 e o cookie é expirado", async () => {
    const res = await chamar(app, "GET", "/api/admin/exemplo", {
      sessao: gerarSegredo(),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(erro("nao_autenticado"));
    expect(cookieDaResposta(res)?.atributos).toContain("Max-Age=0");
  });

  it("sessão expirada responde 401 (e a mesma sessão valia antes de expirar)", async () => {
    const { sessao } = await sessaoDe(app, "admin");
    const antes = await chamar(app, "GET", "/api/painel/exemplo", { sessao });
    expect(antes.status).toBe(200);

    await env.DB.prepare("UPDATE sessoes SET expira_em = ? WHERE id_hash = ?")
      .bind(new Date(Date.now() - 1000).toISOString(), await sha256Hex(sessao))
      .run();

    const depois = await chamar(app, "GET", "/api/painel/exemplo", { sessao });
    expect(depois.status).toBe(401);
    expect(await depois.json()).toEqual(erro("nao_autenticado"));
    expect(cookieDaResposta(depois)?.atributos).toContain("Max-Age=0");
  });
});

describe("CA3: papel", () => {
  it.each(AREAS)(
    "admin e coordenacao entram em %s e o handler recebe c.var.usuario",
    async (caminho) => {
      for (const papel of ["admin", "coordenacao"] as const) {
        const acesso = await sessaoDe(app, papel);

        const res = await chamar(app, "GET", caminho, {
          sessao: acesso.sessao,
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          metodo: "GET",
          usuario: { id: acesso.usuarioId, nome: acesso.nome, papel },
        });
        expect(res.headers.get("Cache-Control")).toBe("no-store");
      }
    },
  );

  it("papel errado responde 403: coordenacao não entra nas rotas só de admin", async () => {
    const { sessao } = await sessaoDe(app, "coordenacao");

    const res = await chamar(app, "GET", "/api/admin/usuarios", { sessao });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(erro("proibido"));
  });

  it("as rotas de usuários e links exigem admin mesmo montadas sem o middleware geral", async () => {
    const semMiddlewareGeral = new Hono<{ Bindings: Cloudflare.Env }>();
    semMiddlewareGeral.route("/api/sessao", rotasSessao);
    semMiddlewareGeral.route("/api/admin", adminUsuarios);
    const { sessao } = await sessaoDe(app, "coordenacao");

    const semSessao = await semMiddlewareGeral.request(
      "/api/admin/usuarios",
      {},
      env,
    );
    const comCoordenacao = await semMiddlewareGeral.request(
      "/api/admin/links/1",
      {
        method: "DELETE",
        headers: { Cookie: `sessao=${sessao}`, Origin: ORIGEM },
      },
      env,
    );

    expect(semSessao.status).toBe(401);
    expect(comCoordenacao.status).toBe(403);
  });
});

describe("CA3: CSRF nas escritas", () => {
  it.each(ESCRITAS)(
    "%s de outra origem responde 403, mesmo com sessão válida",
    async (metodo) => {
      const { sessao } = await sessaoDe(app, "admin");

      const res = await chamar(app, metodo, "/api/admin/exemplo", {
        sessao,
        origem: "https://site-malicioso.example",
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(erro("proibido"));
    },
  );

  it.each(ESCRITAS)(
    "%s da mesma origem passa (Origin igual ou Sec-Fetch-Site: same-origin)",
    async (metodo) => {
      const { sessao } = await sessaoDe(app, "coordenacao");

      const porOrigin = await chamar(app, metodo, "/api/painel/exemplo", {
        sessao,
      });
      const porSecFetchSite = await chamar(app, metodo, "/api/painel/exemplo", {
        sessao,
        origem: null,
        cabecalhos: { "Sec-Fetch-Site": "same-origin" },
      });

      for (const res of [porOrigin, porSecFetchSite]) {
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ metodo });
      }
    },
  );

  it.each([
    ["sem Origin nem Sec-Fetch-Site", null, {}],
    [
      "subdomínio (same-site)",
      "http://outro.localhost",
      { "Sec-Fetch-Site": "same-site" },
    ],
    ["Origin null", "null", { "Sec-Fetch-Site": "cross-site" }],
    ["outra porta", "http://localhost:8080", {}],
  ] as const)("escrita %s responde 403", async (_caso, origem, cabecalhos) => {
    const { sessao } = await sessaoDe(app, "admin");

    const res = await chamar(app, "PUT", "/api/admin/exemplo", {
      sessao,
      origem,
      cabecalhos,
    });

    expect(res.status).toBe(403);
  });

  it("a origem é conferida antes da sessão: escrita de outra origem sem cookie também é 403", async () => {
    const res = await chamar(app, "DELETE", "/api/painel/exemplo", {
      origem: "https://site-malicioso.example",
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(erro("proibido"));
  });

  it("leitura (GET) não passa pelo filtro de origem", async () => {
    const { sessao } = await sessaoDe(app, "coordenacao");

    const res = await chamar(app, "GET", "/api/admin/exemplo", {
      sessao,
      cabecalhos: {
        Origin: "https://site-malicioso.example",
        "Sec-Fetch-Site": "cross-site",
      },
    });

    expect(res.status).toBe(200);
  });
});

describe("uso da sessão", () => {
  it("regrava ultimo_uso_em quando passou mais de um minuto, e não a cada requisição", async () => {
    const { sessao } = await sessaoDe(app, "coordenacao");
    const idHash = await sha256Hex(sessao);
    const ultimoUso = async () =>
      (
        await env.DB.prepare(
          "SELECT ultimo_uso_em FROM sessoes WHERE id_hash = ?",
        )
          .bind(idHash)
          .first<{ ultimo_uso_em: string }>()
      )?.ultimo_uso_em;
    const haDoisMinutos = new Date(Date.now() - 120_000).toISOString();
    await env.DB.prepare(
      "UPDATE sessoes SET ultimo_uso_em = ? WHERE id_hash = ?",
    )
      .bind(haDoisMinutos, idHash)
      .run();

    await chamar(app, "GET", "/api/sessao", { sessao });
    const tocado = await ultimoUso();
    expect(tocado! > haDoisMinutos).toBe(true);

    const haTrintaSegundos = new Date(Date.now() - 30_000).toISOString();
    await env.DB.prepare(
      "UPDATE sessoes SET ultimo_uso_em = ? WHERE id_hash = ?",
    )
      .bind(haTrintaSegundos, idHash)
      .run();
    await chamar(app, "GET", "/api/sessao", { sessao });
    expect(await ultimoUso()).toBe(haTrintaSegundos);
  });
});

describe("auxiliar para os testes das outras rotas da coordenação", () => {
  it("cabecalhosDeSessao abre uma sessão direto no banco que passa pelo middleware, inclusive nas escritas", async () => {
    const cabecalhos = await cabecalhosDeSessao("coordenacao");

    const leitura = await app.request(
      "/api/painel/exemplo",
      { headers: cabecalhos },
      env,
    );
    const escrita = await app.request(
      "/api/admin/exemplo",
      { method: "PUT", headers: cabecalhos },
      env,
    );
    const soAdmin = await app.request(
      "/api/admin/usuarios",
      { headers: cabecalhos },
      env,
    );

    expect(leitura.status).toBe(200);
    expect(await leitura.json()).toMatchObject({
      usuario: { papel: "coordenacao" },
    });
    expect(escrita.status).toBe(200);
    expect(soAdmin.status).toBe(403);
  });
});
