// RIFA-007: POST /api/sessao (link → sessão), GET /api/sessao e POST /api/sessao/sair, no workerd com D1.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { respostaSessaoSchema } from "../../shared/contracts";
import { gerarSegredo, sha256Hex } from "../lib/cripto";
import {
  chamar,
  cookieDaResposta,
  criarAcessoNoBanco,
  criarAppDeTeste,
  entrar,
  erro,
  type AppDeTeste,
} from "../test/acesso-teste";

let app: AppDeTeste;
beforeAll(() => {
  app = criarAppDeTeste();
});

const NO_PASSADO = "2026-01-01T00:00:00.000Z";

async function sessoesNoBanco(idSessao: string): Promise<number> {
  const linha = await env.DB.prepare(
    "SELECT count(*) AS total FROM sessoes WHERE id_hash = ?",
  )
    .bind(await sha256Hex(idSessao))
    .first<{ total: number }>();
  return linha?.total ?? 0;
}

describe("CA1: link → sessão → cookie", () => {
  it("POST /api/sessao com o token responde 200 com o usuário e grava o cookie com as flags certas", async () => {
    const acesso = await criarAcessoNoBanco("admin");

    const res = await chamar(app, "POST", "/api/sessao", {
      corpo: { token: acesso.token },
    });

    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo).toEqual({
      usuario: { id: acesso.usuarioId, nome: acesso.nome, papel: "admin" },
    });
    expect(respostaSessaoSchema.safeParse(corpo).success).toBe(true);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const cookie = cookieDaResposta(res);
    expect(cookie?.valor).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.atributos.sort()).toEqual(
      [
        "HttpOnly",
        "Max-Age=2592000",
        "Path=/",
        "SameSite=Lax",
        "Secure",
      ].sort(),
    );
    // O id da sessão não é o token do link.
    expect(cookie?.valor).not.toBe(acesso.token);
  });

  it("GET /api/sessao com o cookie devolve o usuário da sessão", async () => {
    const acesso = await criarAcessoNoBanco("coordenacao");
    const sessao = await entrar(app, acesso.token);

    const res = await chamar(app, "GET", "/api/sessao", { sessao });

    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo).toEqual({
      usuario: {
        id: acesso.usuarioId,
        nome: acesso.nome,
        papel: "coordenacao",
      },
    });
    expect(respostaSessaoSchema.safeParse(corpo).success).toBe(true);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("GET /api/sessao sem cookie responde 401 no formato único", async () => {
    const res = await chamar(app, "GET", "/api/sessao");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(erro("nao_autenticado"));
  });

  it("abrir o link marca o último uso dele", async () => {
    const acesso = await criarAcessoNoBanco("coordenacao");
    const antes = new Date().toISOString();

    await entrar(app, acesso.token);

    const link = await env.DB.prepare(
      "SELECT ultimo_uso_em FROM links_acesso WHERE id = ?",
    )
      .bind(acesso.linkId)
      .first<{ ultimo_uso_em: string | null }>();
    expect(link?.ultimo_uso_em).not.toBeNull();
    expect(link!.ultimo_uso_em! >= antes).toBe(true);
  });
});

describe("CA2: links que não abrem sessão e reuso do link válido", () => {
  async function tentarEntrar(token: string) {
    const res = await chamar(app, "POST", "/api/sessao", { corpo: { token } });
    return {
      status: res.status,
      corpo: await res.json(),
      cookie: cookieDaResposta(res),
    };
  }

  it("o mesmo link válido funciona de novo: cada uso abre uma sessão independente", async () => {
    const acesso = await criarAcessoNoBanco("coordenacao");

    const primeira = await entrar(app, acesso.token);
    const segunda = await entrar(app, acesso.token); // outro aparelho, ou o mesmo link de novo

    expect(segunda).not.toBe(primeira);
    for (const sessao of [primeira, segunda]) {
      const res = await chamar(app, "GET", "/api/sessao", { sessao });
      expect(res.status).toBe(200);
    }
  });

  it("link expirado responde 401", async () => {
    const acesso = await criarAcessoNoBanco("admin");
    await env.DB.prepare("UPDATE links_acesso SET expira_em = ? WHERE id = ?")
      .bind(NO_PASSADO, acesso.linkId)
      .run();

    const tentativa = await tentarEntrar(acesso.token);

    expect(tentativa.status).toBe(401);
    expect(tentativa.corpo).toEqual(erro("nao_autenticado"));
    expect(tentativa.cookie).toBeNull();
  });

  it("link revogado responde 401", async () => {
    const acesso = await criarAcessoNoBanco("admin");
    await env.DB.prepare("UPDATE links_acesso SET revogado_em = ? WHERE id = ?")
      .bind(new Date().toISOString(), acesso.linkId)
      .run();

    const tentativa = await tentarEntrar(acesso.token);

    expect(tentativa.status).toBe(401);
    expect(tentativa.corpo).toEqual(erro("nao_autenticado"));
    expect(tentativa.cookie).toBeNull();
  });

  it("link de usuário inativo responde 401", async () => {
    const acesso = await criarAcessoNoBanco("coordenacao");
    await env.DB.prepare("UPDATE usuarios SET ativo = 0 WHERE id = ?")
      .bind(acesso.usuarioId)
      .run();

    const tentativa = await tentarEntrar(acesso.token);

    expect(tentativa.status).toBe(401);
    expect(tentativa.corpo).toEqual(erro("nao_autenticado"));
    expect(tentativa.cookie).toBeNull();
  });

  it.each([
    ["inexistente", gerarSegredo()],
    ["truncado (mensagem cortada)", gerarSegredo().slice(0, 30)],
    ["com caracteres fora do base64url", `${gerarSegredo().slice(0, 42)}=`],
    ["vazio", ""],
  ])("token %s responde 401", async (_caso, token) => {
    const tentativa = await tentarEntrar(token);

    expect(tentativa.status).toBe(401);
    expect(tentativa.corpo).toEqual(erro("nao_autenticado"));
    expect(tentativa.cookie).toBeNull();
  });

  it("corpo sem token responde 400 requisicao_invalida; JSON malformado, 400 json_invalido", async () => {
    const semToken = await chamar(app, "POST", "/api/sessao", { corpo: {} });
    expect(semToken.status).toBe(400);
    expect(await semToken.json()).toMatchObject({
      erro: {
        codigo: "requisicao_invalida",
        detalhes: [{ caminho: ["token"] }],
      },
    });

    const malformado = await chamar(app, "POST", "/api/sessao", {
      corpo: "{ token: ",
    });
    expect(malformado.status).toBe(400);
    expect(await malformado.json()).toEqual(erro("json_invalido"));
  });

  it("entrar de novo no mesmo navegador encerra a sessão anterior dele", async () => {
    const acesso = await criarAcessoNoBanco("coordenacao");
    const anterior = await entrar(app, acesso.token);

    const res = await chamar(app, "POST", "/api/sessao", {
      corpo: { token: acesso.token },
      sessao: anterior,
    });

    expect(res.status).toBe(200);
    const nova = cookieDaResposta(res)?.valor;
    expect(nova).toBeDefined();
    expect(nova).not.toBe(anterior);
    expect(await sessoesNoBanco(anterior)).toBe(0);
    const comAnterior = await chamar(app, "GET", "/api/sessao", {
      sessao: anterior,
    });
    expect(comAnterior.status).toBe(401);
  });

  it("POST /api/sessao de outra origem responde 403 e não abre sessão", async () => {
    const acesso = await criarAcessoNoBanco("admin");

    const res = await chamar(app, "POST", "/api/sessao", {
      corpo: { token: acesso.token },
      origem: "https://site-malicioso.example",
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(erro("proibido"));
    expect(cookieDaResposta(res)).toBeNull();
  });
});

describe("POST /api/sessao/sair", () => {
  it("apaga a sessão e expira o cookie", async () => {
    const acesso = await criarAcessoNoBanco("coordenacao");
    const sessao = await entrar(app, acesso.token);
    expect(await sessoesNoBanco(sessao)).toBe(1);

    const res = await chamar(app, "POST", "/api/sessao/sair", { sessao });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const cookie = cookieDaResposta(res);
    expect(cookie?.valor).toBe("");
    expect(cookie?.atributos).toContain("Max-Age=0");
    expect(await sessoesNoBanco(sessao)).toBe(0);
    const depois = await chamar(app, "GET", "/api/sessao", { sessao });
    expect(depois.status).toBe(401);
  });

  it("sem sessão também responde 204 e expira o cookie", async () => {
    const res = await chamar(app, "POST", "/api/sessao/sair");

    expect(res.status).toBe(204);
    expect(cookieDaResposta(res)?.atributos).toContain("Max-Age=0");
  });

  it("de outra origem responde 403 e a sessão continua valendo", async () => {
    const acesso = await criarAcessoNoBanco("coordenacao");
    const sessao = await entrar(app, acesso.token);

    const res = await chamar(app, "POST", "/api/sessao/sair", {
      sessao,
      origem: "https://site-malicioso.example",
    });

    expect(res.status).toBe(403);
    expect(await sessoesNoBanco(sessao)).toBe(1);
  });
});
