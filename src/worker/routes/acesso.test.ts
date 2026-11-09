// RIFA-007: POST /api/sessao (link → sessão), GET /api/sessao e POST /api/sessao/sair, no workerd com D1.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  NOME_COOKIE_SESSAO,
  VALIDADE_SESSAO_DIAS,
  respostaSessaoSchema,
} from "../../shared/contracts";
import { gerarSegredo, sha256Hex } from "../lib/cripto";
import {
  chamar,
  cookieDaResposta,
  criarAcessoDaHierarquiaNoBanco,
  criarAcessoNoBanco,
  criarAppDeTeste,
  entrar,
  erro,
  type AppDeTeste,
} from "../test/acesso-teste";
import { limparBanco, semearHierarquia } from "../test/painel-apoio";

let app: AppDeTeste;
beforeAll(() => {
  app = criarAppDeTeste();
});

const NO_PASSADO = "2026-01-01T00:00:00.000Z";

const DIA_MS = 24 * 60 * 60 * 1000;

async function sessaoGravada(idSessao: string) {
  return env.DB.prepare(
    "SELECT criado_em, expira_em FROM sessoes WHERE id_hash = ?",
  )
    .bind(await sha256Hex(idSessao))
    .first<{ criado_em: string; expira_em: string }>();
}

async function expiraEmDoLink(linkId: number): Promise<string> {
  const linha = await env.DB.prepare(
    "SELECT expira_em FROM links_acesso WHERE id = ?",
  )
    .bind(linkId)
    .first<{ expira_em: string }>();
  return linha!.expira_em;
}

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

    // Cookie __Host-: Secure, Path=/ e sem Domain (o navegador recusa o prefixo sem isso).
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-sessao=/);
    expect(res.headers.get("Set-Cookie")).not.toMatch(/domain=/i);
    const cookie = cookieDaResposta(res);
    expect(cookie?.valor).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // O id da sessão não é o token do link.
    expect(cookie?.valor).not.toBe(acesso.token);
    // O Max-Age é o que falta para a sessão vencer no servidor (link recém-criado: vence com o link).
    const gravada = await sessaoGravada(cookie!.valor);
    const maxAge = Math.floor(
      (Date.parse(gravada!.expira_em) - Date.parse(gravada!.criado_em)) / 1000,
    );
    expect(cookie?.atributos.sort()).toEqual(
      [
        "HttpOnly",
        `Max-Age=${maxAge}`,
        "Path=/",
        "SameSite=Lax",
        "Secure",
      ].sort(),
    );
    expect(gravada!.expira_em).toBe(await expiraEmDoLink(acesso.linkId));
    expect(maxAge).toBeLessThanOrEqual(VALIDADE_SESSAO_DIAS * 24 * 60 * 60);
    expect(maxAge).toBeGreaterThan((VALIDADE_SESSAO_DIAS - 1) * 24 * 60 * 60);
  });

  it("o cookie sem o prefixo __Host- não vale, e um cookie plantado com outro nome não atrapalha", async () => {
    const acesso = await criarAcessoNoBanco("coordenacao");
    const sessao = await entrar(app, acesso.token);

    const semPrefixo = await chamar(app, "GET", "/api/sessao", {
      cabecalhos: { Cookie: `sessao=${sessao}` },
    });
    const comPlantado = await chamar(app, "GET", "/api/sessao", {
      cabecalhos: {
        Cookie: `sessao=${gerarSegredo()}; ${NOME_COOKIE_SESSAO}=${sessao}; tema=escuro`,
      },
    });

    expect(semPrefixo.status).toBe(401);
    expect(comPlantado.status).toBe(200);
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

describe("a sessão não dura mais que o link que a abriu", () => {
  it("link que vence em 2 dias: a sessão e o cookie vencem junto com o link", async () => {
    const acesso = await criarAcessoNoBanco("coordenacao");
    const fimDoLink = new Date(Date.now() + 2 * DIA_MS).toISOString();
    await env.DB.prepare("UPDATE links_acesso SET expira_em = ? WHERE id = ?")
      .bind(fimDoLink, acesso.linkId)
      .run();

    const res = await chamar(app, "POST", "/api/sessao", {
      corpo: { token: acesso.token },
    });

    expect(res.status).toBe(200);
    const cookie = cookieDaResposta(res)!;
    const gravada = await sessaoGravada(cookie.valor);
    expect(gravada?.expira_em).toBe(fimDoLink);
    const maxAge = Number(
      cookie.atributos
        .find((atributo) => atributo.startsWith("Max-Age="))!
        .slice(8),
    );
    expect(maxAge).toBe(
      Math.floor(
        (Date.parse(fimDoLink) - Date.parse(gravada!.criado_em)) / 1000,
      ),
    );
    expect(maxAge).toBeLessThanOrEqual(2 * 24 * 60 * 60);
  });

  it("quando o link vence, a sessão aberta por ele para de valer (relógio adiantado)", async () => {
    const acesso = await criarAcessoNoBanco("admin");
    const fimDoLink = new Date(Date.now() + DIA_MS).toISOString();
    await env.DB.prepare("UPDATE links_acesso SET expira_em = ? WHERE id = ?")
      .bind(fimDoLink, acesso.linkId)
      .run();
    const sessao = await entrar(app, acesso.token);

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.parse(fimDoLink) - 60_000);
      expect((await chamar(app, "GET", "/api/sessao", { sessao })).status).toBe(
        200,
      );
      vi.setSystemTime(Date.parse(fimDoLink) + 1);
      expect((await chamar(app, "GET", "/api/sessao", { sessao })).status).toBe(
        401,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("link antigo (aberto há 40 dias) só dá sessão até o fim dele, não por mais 45 dias", async () => {
    const acesso = await criarAcessoNoBanco("coordenacao");
    const criado = new Date(Date.now() - 40 * DIA_MS);
    const fimDoLink = new Date(criado.getTime() + 45 * DIA_MS).toISOString();
    await env.DB.prepare(
      "UPDATE links_acesso SET criado_em = ?, expira_em = ? WHERE id = ?",
    )
      .bind(criado.toISOString(), fimDoLink, acesso.linkId)
      .run();

    const sessao = await entrar(app, acesso.token);

    const gravada = await sessaoGravada(sessao);
    expect(gravada?.expira_em).toBe(fimDoLink);
    expect(
      Date.parse(gravada!.expira_em) - Date.parse(gravada!.criado_em),
    ).toBeLessThanOrEqual(5 * DIA_MS);
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

describe("RIFA-014: papéis da hierarquia na sessão", () => {
  beforeAll(async () => {
    await limparBanco();
    await semearHierarquia();
  });

  it("POST e GET /api/sessao devolvem o alvo do líder, do discipulador e da rede, lido da hierarquia na hora", async () => {
    for (const [papel, id, alvo] of [
      [
        "lider",
        2,
        { tipo: "celula", id: 2, nome: "Célula Betel", divisao: "jovens" },
      ],
      [
        "discipulador",
        30,
        {
          tipo: "discipulador",
          id: 30,
          nome: "Discipulador Caleb",
          divisao: "adultos",
        },
      ],
      [
        "rede",
        1,
        {
          tipo: "rede",
          id: 1,
          nome: "Rede Jovem Ficticia",
          divisao: "jovens",
        },
      ],
    ] as const) {
      const acesso = await criarAcessoDaHierarquiaNoBanco(papel, id);
      const login = await chamar(app, "POST", "/api/sessao", {
        corpo: { token: acesso.token },
      });
      expect(login.status).toBe(200);
      const entrou = respostaSessaoSchema.parse(await login.json());
      expect(entrou.usuario).toMatchObject({
        id: acesso.usuarioId,
        papel,
        alvo,
      });
      const sessao = cookieDaResposta(login)!.valor;
      const quem = await chamar(app, "GET", "/api/sessao", { sessao });
      expect(respostaSessaoSchema.parse(await quem.json())).toEqual(entrou);
    }

    // A célula 2 muda de nome e de discipulador (vai para a rede adulta): a sessão já aberta vê o alvo novo.
    const acesso = await criarAcessoDaHierarquiaNoBanco("lider", 2);
    const sessao = await entrar(app, acesso.token);
    await env.DB.prepare(
      "UPDATE celulas SET nome = 'Célula Betel Nova', discipulador_id = 30 WHERE id = 2",
    ).run();
    const depois = await chamar(app, "GET", "/api/sessao", { sessao });
    expect(
      respostaSessaoSchema.parse(await depois.json()).usuario.alvo,
    ).toEqual({
      tipo: "celula",
      id: 2,
      nome: "Célula Betel Nova",
      divisao: "adultos",
    });
  });

  it("na coordenação, a sessão continua sem o campo alvo", async () => {
    for (const papel of ["admin", "coordenacao"] as const) {
      const acesso = await criarAcessoNoBanco(papel);
      const login = await chamar(app, "POST", "/api/sessao", {
        corpo: { token: acesso.token },
      });
      expect(await login.json()).toEqual({
        usuario: { id: acesso.usuarioId, nome: acesso.nome, papel },
      });
    }
  });

  it("apagar o alvo apaga o acesso: o link para de entrar e a sessão aberta cai (401)", async () => {
    const acesso = await criarAcessoDaHierarquiaNoBanco("discipulador", 40);
    const sessao = await entrar(app, acesso.token);
    await env.DB.prepare("DELETE FROM discipuladores WHERE id = 40").run();
    expect((await chamar(app, "GET", "/api/sessao", { sessao })).status).toBe(
      401,
    );
    const login = await chamar(app, "POST", "/api/sessao", {
      corpo: { token: acesso.token },
    });
    expect(login.status).toBe(401);
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
