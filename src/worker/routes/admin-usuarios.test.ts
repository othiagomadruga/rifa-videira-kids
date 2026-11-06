// RIFA-007: administração dos acessos (/api/admin/usuarios e /api/admin/links), só para admin.
import { beforeAll, describe, expect, it } from "vitest";
import {
  ROTAS_ACESSO,
  respostaCriarLinkSchema,
  respostaCriarUsuarioSchema,
  respostaListaUsuariosSchema,
  usuarioSchema,
  type Papel,
  type Usuario,
} from "../../shared/contracts";
import {
  ORIGEM,
  chamar,
  criarAcessoNoBanco,
  criarAppDeTeste,
  entrar,
  erro,
  sessaoDe,
  type AppDeTeste,
} from "../test/acesso-teste";

let app: AppDeTeste;
let admin: string;
beforeAll(async () => {
  app = criarAppDeTeste();
  admin = (await sessaoDe(app, "admin")).sessao;
});

/** O token que vem no fim da URL do link. */
function tokenDaUrl(url: string): string {
  const prefixo = `${ORIGEM}/acesso/`;
  expect(url.startsWith(prefixo)).toBe(true);
  return url.slice(prefixo.length);
}

async function criarUsuario(corpo: Record<string, unknown>) {
  const res = await chamar(app, "POST", "/api/admin/usuarios", {
    corpo,
    sessao: admin,
  });
  expect(res.status).toBe(201);
  return respostaCriarUsuarioSchema.parse(await res.json());
}

async function listarUsuarios(): Promise<{ texto: string; itens: Usuario[] }> {
  const res = await chamar(app, "GET", "/api/admin/usuarios", {
    sessao: admin,
  });
  expect(res.status).toBe(200);
  const texto = await res.text();
  return {
    texto,
    itens: respostaListaUsuariosSchema.parse(JSON.parse(texto)).itens,
  };
}

async function usuarioNaLista(id: number): Promise<Usuario> {
  const usuario = (await listarUsuarios()).itens.find((item) => item.id === id);
  expect(usuario).toBeDefined();
  return usuario!;
}

async function sessaoValida(sessao: string): Promise<boolean> {
  const res = await chamar(app, "GET", "/api/sessao", { sessao });
  return res.status === 200;
}

async function statusDoLogin(token: string): Promise<number> {
  return (await chamar(app, "POST", "/api/sessao", { corpo: { token } }))
    .status;
}

describe("CA4: só admin administra os acessos", () => {
  const rotasAdmin = Object.values(ROTAS_ACESSO).filter((rota) => {
    const papeis: readonly Papel[] | null = rota.papeis;
    return papeis !== null && !papeis.includes("coordenacao");
  });

  it("as rotas só de admin são as 5 de usuários e links", () => {
    expect(
      rotasAdmin.map((rota) => `${rota.metodo} ${rota.caminho}`).sort(),
    ).toEqual(
      [
        "POST /api/admin/usuarios",
        "GET /api/admin/usuarios",
        "PATCH /api/admin/usuarios/:id",
        "POST /api/admin/usuarios/:id/links",
        "DELETE /api/admin/links/:id",
      ].sort(),
    );
  });

  it.each(
    rotasAdmin.map((rota) => [`${rota.metodo} ${rota.caminho}`, rota] as const),
  )("%s: 401 sem sessão e 403 para coordenacao", async (_nome, rota) => {
    const alvo = await criarAcessoNoBanco("coordenacao");
    const caminho = rota.caminho.startsWith("/api/admin/links/")
      ? rota.caminho.replace(":id", String(alvo.linkId))
      : rota.caminho.replace(":id", String(alvo.usuarioId));
    const nomeRecusado = `Não deve ser criado ${crypto.randomUUID()}`;
    const corpo =
      rota.metodo === "POST" && rota.caminho === "/api/admin/usuarios"
        ? { nome: nomeRecusado, papel: "admin" }
        : rota.metodo === "PATCH"
          ? { ativo: false }
          : undefined;
    const coordenacao = (await sessaoDe(app, "coordenacao")).sessao;

    const semSessao = await chamar(app, rota.metodo, caminho, { corpo });
    const comCoordenacao = await chamar(app, rota.metodo, caminho, {
      corpo,
      sessao: coordenacao,
    });

    expect(semSessao.status).toBe(401);
    expect(await semSessao.json()).toEqual(erro("nao_autenticado"));
    expect(comCoordenacao.status).toBe(403);
    expect(await comCoordenacao.json()).toEqual(erro("proibido"));
    // Nada mudou: o alvo continua ativo, com o link válido, e ninguém foi criado.
    expect(await statusDoLogin(alvo.token)).toBe(200);
    const { itens } = await listarUsuarios();
    expect(itens.some((usuario) => usuario.nome === nomeRecusado)).toBe(false);
    expect(
      itens.find((usuario) => usuario.id === alvo.usuarioId)?.links,
    ).toHaveLength(1);
  });
});

describe("CA4: criação de usuário e de link", () => {
  it("admin cria um usuário: 201 com o usuário e o primeiro link, que abre sessão com o papel pedido", async () => {
    const criado = await criarUsuario({
      nome: "  Coordenadora Ficticia  ",
      email: "coordenadora@example.com",
      papel: "coordenacao",
    });

    expect(criado.usuario).toMatchObject({
      nome: "Coordenadora Ficticia",
      email: "coordenadora@example.com",
      papel: "coordenacao",
      ativo: true,
      sessoes_ativas: 0,
    });
    expect(criado.link).toMatchObject({
      situacao: "valido",
      revogado_em: null,
    });
    expect(criado.usuario.links).toEqual([
      {
        id: criado.link.id,
        criado_em: criado.link.criado_em,
        expira_em: criado.link.expira_em,
        revogado_em: null,
        ultimo_uso_em: null,
        situacao: "valido",
      },
    ]);
    // Validade padrão: 30 dias.
    expect(
      Date.parse(criado.link.expira_em) - Date.parse(criado.link.criado_em),
    ).toBe(30 * 24 * 60 * 60 * 1000);

    const token = tokenDaUrl(criado.link.url);
    const res = await chamar(app, "POST", "/api/sessao", { corpo: { token } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      usuario: {
        id: criado.usuario.id,
        nome: "Coordenadora Ficticia",
        papel: "coordenacao",
      },
    });
  });

  it("o link aparece só na resposta de criação: a listagem não traz URL, token nem hash", async () => {
    const criado = await criarUsuario({
      nome: "Gestor do Bumbo Ficticio",
      papel: "admin",
    });
    const token = tokenDaUrl(criado.link.url);
    const novo = await chamar(
      app,
      "POST",
      `/api/admin/usuarios/${criado.usuario.id}/links`,
      {
        sessao: admin,
      },
    );
    const tokenNovo = tokenDaUrl(
      respostaCriarLinkSchema.parse(await novo.json()).link.url,
    );

    const { texto } = await listarUsuarios();
    const usuario = await usuarioNaLista(criado.usuario.id);

    expect(texto).not.toContain(token);
    expect(texto).not.toContain(tokenNovo);
    expect(texto).not.toMatch(/"(url|token|token_hash|id_hash)"/);
    expect(texto).not.toMatch(/[0-9a-f]{64}/);
    expect(usuario.email).toBeNull();
    expect(usuario.links).toHaveLength(2);
    for (const link of usuario.links) {
      expect(Object.keys(link).sort()).toEqual(
        [
          "criado_em",
          "expira_em",
          "id",
          "revogado_em",
          "situacao",
          "ultimo_uso_em",
        ].sort(),
      );
    }
  });

  it("admin gera um link novo: 201, o novo funciona e o anterior continua valendo", async () => {
    const criado = await criarUsuario({
      nome: "Pastor Ficticio",
      papel: "coordenacao",
    });

    const res = await chamar(
      app,
      "POST",
      `/api/admin/usuarios/${criado.usuario.id}/links`,
      {
        sessao: admin,
      },
    );

    expect(res.status).toBe(201);
    const { link } = respostaCriarLinkSchema.parse(await res.json());
    expect(link.id).not.toBe(criado.link.id);
    expect(await statusDoLogin(tokenDaUrl(link.url))).toBe(200);
    expect(await statusDoLogin(tokenDaUrl(criado.link.url))).toBe(200);
    const usuario = await usuarioNaLista(criado.usuario.id);
    expect(usuario.links.map((item) => item.id)).toEqual([
      link.id,
      criado.link.id,
    ]);
    expect(usuario.sessoes_ativas).toBe(2);
  });

  it("valida o corpo e os parâmetros no formato único", async () => {
    const papelDesconhecido = await chamar(app, "POST", "/api/admin/usuarios", {
      corpo: { nome: "Fulano", papel: "pastor" },
      sessao: admin,
    });
    expect(papelDesconhecido.status).toBe(400);
    expect(await papelDesconhecido.json()).toMatchObject({
      erro: {
        codigo: "requisicao_invalida",
        detalhes: [{ caminho: ["papel"] }],
      },
    });

    const malformado = await chamar(app, "POST", "/api/admin/usuarios", {
      corpo: "{nome:",
      sessao: admin,
    });
    expect(malformado.status).toBe(400);
    expect(await malformado.json()).toEqual(erro("json_invalido"));

    const idInvalido = await chamar(
      app,
      "POST",
      "/api/admin/usuarios/abc/links",
      {
        sessao: admin,
      },
    );
    expect(idInvalido.status).toBe(400);
    expect(await idInvalido.json()).toMatchObject({
      erro: { codigo: "requisicao_invalida" },
    });

    const inexistente = await chamar(
      app,
      "POST",
      "/api/admin/usuarios/999999999/links",
      {
        sessao: admin,
      },
    );
    expect(inexistente.status).toBe(404);
    expect(await inexistente.json()).toEqual(erro("nao_encontrado"));
  });
});

describe("CA4: revogar link", () => {
  it("DELETE /api/admin/links/:id: o link para de abrir sessão e as sessões abertas por ele caem", async () => {
    const criado = await criarUsuario({
      nome: "Fabio Ficticio",
      papel: "coordenacao",
    });
    const tokenA = tokenDaUrl(criado.link.url);
    const resB = await chamar(
      app,
      "POST",
      `/api/admin/usuarios/${criado.usuario.id}/links`,
      {
        sessao: admin,
      },
    );
    const linkB = respostaCriarLinkSchema.parse(await resB.json()).link;
    const sessaoA = await entrar(app, tokenA);
    const sessaoB = await entrar(app, tokenDaUrl(linkB.url));

    const res = await chamar(
      app,
      "DELETE",
      `/api/admin/links/${criado.link.id}`,
      {
        sessao: admin,
      },
    );

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await statusDoLogin(tokenA)).toBe(401);
    expect(await sessaoValida(sessaoA)).toBe(false);
    // O outro link e a sessão aberta por ele continuam.
    expect(await sessaoValida(sessaoB)).toBe(true);
    expect(await statusDoLogin(tokenDaUrl(linkB.url))).toBe(200);

    const usuario = await usuarioNaLista(criado.usuario.id);
    const revogado = usuario.links.find((link) => link.id === criado.link.id);
    expect(revogado?.situacao).toBe("revogado");
    expect(revogado?.revogado_em).not.toBeNull();

    // Revogar de novo não muda a data da revogação.
    const deNovo = await chamar(
      app,
      "DELETE",
      `/api/admin/links/${criado.link.id}`,
      {
        sessao: admin,
      },
    );
    expect(deNovo.status).toBe(204);
    const depois = (await usuarioNaLista(criado.usuario.id)).links.find(
      (link) => link.id === criado.link.id,
    );
    expect(depois?.revogado_em).toBe(revogado?.revogado_em);
  });

  it("link inexistente responde 404", async () => {
    const res = await chamar(app, "DELETE", "/api/admin/links/999999999", {
      sessao: admin,
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(erro("nao_encontrado"));
  });
});

describe("CA4: desativar usuário", () => {
  it("PATCH { ativo: false } derruba as sessões e o link para de funcionar; reativar devolve o acesso", async () => {
    const criado = await criarUsuario({
      nome: "Felipe Ficticio",
      papel: "coordenacao",
    });
    const token = tokenDaUrl(criado.link.url);
    const celular = await entrar(app, token);
    const computador = await entrar(app, token);

    const res = await chamar(
      app,
      "PATCH",
      `/api/admin/usuarios/${criado.usuario.id}`,
      {
        corpo: { ativo: false },
        sessao: admin,
      },
    );

    expect(res.status).toBe(200);
    const desativado = usuarioSchema.parse(await res.json());
    expect(desativado).toMatchObject({
      id: criado.usuario.id,
      ativo: false,
      sessoes_ativas: 0,
    });
    expect(await sessaoValida(celular)).toBe(false);
    expect(await sessaoValida(computador)).toBe(false);
    expect(await statusDoLogin(token)).toBe(401);

    const reativado = await chamar(
      app,
      "PATCH",
      `/api/admin/usuarios/${criado.usuario.id}`,
      {
        corpo: { ativo: true },
        sessao: admin,
      },
    );
    expect(reativado.status).toBe(200);
    expect(await reativado.json()).toMatchObject({ ativo: true });
    // As sessões antigas não voltam; o link (ainda válido) abre uma nova.
    expect(await sessaoValida(celular)).toBe(false);
    expect(await statusDoLogin(token)).toBe(200);
  });

  it("aceita só { ativo }: outro campo responde 400; usuário inexistente, 404", async () => {
    const alvo = await criarAcessoNoBanco("coordenacao");

    const comPapel = await chamar(
      app,
      "PATCH",
      `/api/admin/usuarios/${alvo.usuarioId}`,
      {
        corpo: { ativo: true, papel: "admin" },
        sessao: admin,
      },
    );
    expect(comPapel.status).toBe(400);
    expect(await comPapel.json()).toMatchObject({
      erro: { codigo: "requisicao_invalida" },
    });

    const inexistente = await chamar(
      app,
      "PATCH",
      "/api/admin/usuarios/999999999",
      {
        corpo: { ativo: false },
        sessao: admin,
      },
    );
    expect(inexistente.status).toBe(404);
    expect(await inexistente.json()).toEqual(erro("nao_encontrado"));
  });
});
