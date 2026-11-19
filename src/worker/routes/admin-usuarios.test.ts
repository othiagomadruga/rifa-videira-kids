// RIFA-007: administração dos acessos (/api/admin/usuarios e /api/admin/links), só para admin.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ROTAS_ACESSO,
  ROTAS_ACESSO_HIERARQUIA,
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
  criarAcessoDaHierarquiaNoBanco,
  criarAcessoNoBanco,
  criarAppDeTeste,
  entrar,
  erro,
  sessaoDe,
  type AppDeTeste,
} from "../test/acesso-teste";
import { semearCenario } from "../test/painel-apoio";

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
  // A resposta traz o link com o token: nenhum cache pode guardá-la.
  expect(res.headers.get("Cache-Control")).toBe("no-store");
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
  // Os dois catálogos juntos: usuários e links (RIFA-007) e os acessos da hierarquia (RIFA-014).
  const rotasAdmin = [
    ...Object.values(ROTAS_ACESSO),
    ...Object.values(ROTAS_ACESSO_HIERARQUIA),
  ].filter((rota) => {
    const papeis: readonly Papel[] | null = rota.papeis;
    return papeis !== null && !papeis.includes("coordenacao");
  });

  it("as rotas só de admin são as 5 de usuários e links, as 2 dos acessos da hierarquia e as 3 da senha do próprio admin (RIFA-073)", () => {
    expect(
      rotasAdmin.map((rota) => `${rota.metodo} ${rota.caminho}`).sort(),
    ).toEqual(
      [
        "POST /api/admin/usuarios",
        "GET /api/admin/usuarios",
        "PATCH /api/admin/usuarios/:id",
        "POST /api/admin/usuarios/:id/links",
        "DELETE /api/admin/links/:id",
        "GET /api/admin/acessos-hierarquia",
        "POST /api/admin/acessos-hierarquia/links",
        "GET /api/admin/minha-senha",
        "PUT /api/admin/minha-senha",
        "DELETE /api/admin/minha-senha",
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
          : rota.caminho === "/api/admin/acessos-hierarquia/links"
            ? { papel: "lider", ids: [1] }
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
        // RIFA-043: o link recém-criado não abriu a sessão de quem criou.
        desta_sessao: false,
      },
    ]);
    // Validade padrão: 45 dias.
    expect(
      Date.parse(criado.link.expira_em) - Date.parse(criado.link.criado_em),
    ).toBe(45 * 24 * 60 * 60 * 1000);

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
          "desta_sessao",
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

  it("RIFA-014: criar usuário continua só da coordenação; os papéis da hierarquia dão 400 e nada é gravado", async () => {
    for (const papel of ["lider", "discipulador", "rede"]) {
      const nome = `Hierarquia pela rota errada ${papel}`;
      const res = await chamar(app, "POST", "/api/admin/usuarios", {
        corpo: { nome, papel },
        sessao: admin,
      });
      expect({ papel, status: res.status }).toEqual({ papel, status: 400 });
      expect(await res.json()).toMatchObject({
        erro: {
          codigo: "requisicao_invalida",
          detalhes: [{ caminho: ["papel"] }],
        },
      });
      expect(
        await env.DB.prepare("SELECT 1 FROM usuarios WHERE nome = ?1")
          .bind(nome)
          .first(),
      ).toBeNull();
    }
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

// RIFA-043 (ensaio geral): no primeiro acesso (lançamento 3.1), o admin gera um link novo, entra por ele e revoga o
// primeiro. A lista mostra o mais novo primeiro, e no ensaio o link errado foi revogado: a API passa a dizer qual link
// abriu a sessão de quem pede (`desta_sessao`, calculado de `sessoes.link_id`).
describe('RIFA-043: o link desta sessão ("este aparelho")', () => {
  /** Os links do usuário `id` na lista, como a sessão `sessao` os vê. */
  async function linksVistosPor(sessao: string, id: number) {
    const res = await chamar(app, "GET", "/api/admin/usuarios", { sessao });
    expect(res.status).toBe(200);
    const usuario = respostaListaUsuariosSchema
      .parse(await res.json())
      .itens.find((item) => item.id === id);
    expect(usuario).toBeDefined();
    return usuario!.links.map(({ id: linkId, desta_sessao }) => ({
      id: linkId,
      desta_sessao,
    }));
  }

  it("a lista marca só o link que abriu a sessão de quem pede; cada aparelho vê o seu", async () => {
    // O primeiro admin (o link do SM, lançamento 3.1) entra; gera um link novo e entra por ele noutra aba.
    const primeiro = await sessaoDe(app, "admin");
    const resNovo = await chamar(
      app,
      "POST",
      `/api/admin/usuarios/${primeiro.usuarioId}/links`,
      { sessao: primeiro.sessao },
    );
    expect(resNovo.status).toBe(201);
    const novo = respostaCriarLinkSchema.parse(await resNovo.json()).link;
    // O link recém-criado ainda não abriu sessão nenhuma.
    expect(novo.desta_sessao).toBe(false);
    const sessaoNova = await entrar(app, tokenDaUrl(novo.url));

    // Do mais novo para o mais antigo, como a tela mostra.
    expect(await linksVistosPor(sessaoNova, primeiro.usuarioId)).toEqual([
      { id: novo.id, desta_sessao: true },
      { id: primeiro.linkId, desta_sessao: false },
    ]);
    expect(await linksVistosPor(primeiro.sessao, primeiro.usuarioId)).toEqual([
      { id: novo.id, desta_sessao: false },
      { id: primeiro.linkId, desta_sessao: true },
    ]);
    // Outro admin vê os mesmos links sem nenhuma marca (não entrou por eles).
    expect(await linksVistosPor(admin, primeiro.usuarioId)).toEqual([
      { id: novo.id, desta_sessao: false },
      { id: primeiro.linkId, desta_sessao: false },
    ]);
    // Na lista inteira, só um link é o desta sessão.
    const tudo = respostaListaUsuariosSchema.parse(
      await (
        await chamar(app, "GET", "/api/admin/usuarios", {
          sessao: sessaoNova,
        })
      ).json(),
    );
    expect(
      tudo.itens
        .flatMap((usuario) => usuario.links)
        .filter((link) => link.desta_sessao)
        .map((link) => link.id),
    ).toEqual([novo.id]);
  });

  it("o PATCH devolve o usuário com a mesma marca; a lista da hierarquia nunca marca", async () => {
    const eu = await sessaoDe(app, "admin");

    const res = await chamar(
      app,
      "PATCH",
      `/api/admin/usuarios/${eu.usuarioId}`,
      {
        corpo: { ativo: true },
        sessao: eu.sessao,
      },
    );

    expect(res.status).toBe(200);
    const usuario = usuarioSchema.parse(await res.json());
    expect(usuario.links).toEqual([
      expect.objectContaining({ id: eu.linkId, desta_sessao: true }),
    ]);

    await semearCenario();
    await criarAcessoDaHierarquiaNoBanco("lider", 1);
    const hierarquia = await chamar(
      app,
      "GET",
      `${ROTAS_ACESSO_HIERARQUIA.listarAcessosHierarquia.caminho}?papel=lider`,
      { sessao: eu.sessao },
    );
    expect(hierarquia.status).toBe(200);
    const links = (
      (await hierarquia.json()) as {
        itens: { usuario: { links: { desta_sessao: boolean }[] } | null }[];
      }
    ).itens.flatMap((item) => item.usuario?.links ?? []);
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => link.desta_sessao === false)).toBe(true);
  });

  it("revogar o link desta sessão derruba a própria sessão (o que a tela avisa); a do outro link continua", async () => {
    const primeiro = await sessaoDe(app, "admin");
    const novo = respostaCriarLinkSchema.parse(
      await (
        await chamar(
          app,
          "POST",
          `/api/admin/usuarios/${primeiro.usuarioId}/links`,
          { sessao: primeiro.sessao },
        )
      ).json(),
    ).link;
    const sessaoNova = await entrar(app, tokenDaUrl(novo.url));

    const res = await chamar(app, "DELETE", `/api/admin/links/${novo.id}`, {
      sessao: sessaoNova,
    });

    expect(res.status).toBe(204);
    expect(await sessaoValida(sessaoNova)).toBe(false);
    expect(await sessaoValida(primeiro.sessao)).toBe(true);
    expect(await linksVistosPor(primeiro.sessao, primeiro.usuarioId)).toEqual([
      { id: novo.id, desta_sessao: false },
      { id: primeiro.linkId, desta_sessao: true },
    ]);
  });
});

describe("CA4: o último link válido de admin não é revogado", () => {
  it("revogar o único link válido de admin ativo: 409 em_uso e nada muda; com um link novo, a revogação passa", async () => {
    const a = await sessaoDe(app, "admin");
    // Durante o teste, A é o único admin ativo (os outros voltam no fim, com as sessões).
    const { results: outros } = await env.DB.prepare(
      "UPDATE usuarios SET ativo = 0 WHERE papel = 'admin' AND ativo = 1 AND id <> ?1 RETURNING id",
    )
      .bind(a.usuarioId)
      .all<{ id: number }>();
    try {
      const recusada = await chamar(
        app,
        "DELETE",
        `/api/admin/links/${a.linkId}`,
        {
          sessao: a.sessao,
        },
      );

      expect(recusada.status).toBe(409);
      const corpo = (await recusada.json()) as { erro: { mensagem: string } };
      expect(corpo).toEqual(erro("em_uso"));
      expect(corpo.erro.mensagem).toMatch(
        /último link válido.*gere um link novo/,
      );
      // Nada mudou: o link ainda abre sessão e a sessão aberta por ele continua.
      expect(await sessaoValida(a.sessao)).toBe(true);
      expect(await statusDoLogin(a.token)).toBe(200);

      // Com um link novo para A, o antigo pode ser revogado (e a sessão aberta por ele cai).
      const novo = await chamar(
        app,
        "POST",
        `/api/admin/usuarios/${a.usuarioId}/links`,
        {
          sessao: a.sessao,
        },
      );
      const linkNovo = respostaCriarLinkSchema.parse(await novo.json()).link;
      const revogada = await chamar(
        app,
        "DELETE",
        `/api/admin/links/${a.linkId}`,
        {
          sessao: a.sessao,
        },
      );
      expect(revogada.status).toBe(204);
      expect(await sessaoValida(a.sessao)).toBe(false);

      // Agora o link novo é o último: também fica protegido.
      const sessaoNova = await entrar(app, tokenDaUrl(linkNovo.url));
      const deNovo = await chamar(
        app,
        "DELETE",
        `/api/admin/links/${linkNovo.id}`,
        {
          sessao: sessaoNova,
        },
      );
      expect(deNovo.status).toBe(409);
      expect(await sessaoValida(sessaoNova)).toBe(true);
    } finally {
      await env.DB.prepare(
        "UPDATE usuarios SET ativo = 1 WHERE id IN (SELECT value FROM json_each(?1))",
      )
        .bind(JSON.stringify(outros.map((linha) => linha.id)))
        .run();
    }
  });

  it("com outro admin ativo com link válido, o link de um admin é revogado normalmente", async () => {
    const outroAdmin = await sessaoDe(app, "admin");

    const res = await chamar(
      app,
      "DELETE",
      `/api/admin/links/${outroAdmin.linkId}`,
      {
        sessao: admin,
      },
    );

    expect(res.status).toBe(204);
    expect(await statusDoLogin(outroAdmin.token)).toBe(401);
    expect(await sessaoValida(outroAdmin.sessao)).toBe(false);
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

  it("admin não desativa o próprio acesso: 409 em_uso, e continua ativo e conectado", async () => {
    const proprio = await sessaoDe(app, "admin");
    const caminho = `/api/admin/usuarios/${proprio.usuarioId}`;

    const res = await chamar(app, "PATCH", caminho, {
      corpo: { ativo: false },
      sessao: proprio.sessao,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(erro("em_uso"));
    expect(await sessaoValida(proprio.sessao)).toBe(true);
    expect((await usuarioNaLista(proprio.usuarioId)).ativo).toBe(true);
    // Outro admin pode desativá-lo; "reativar" a si mesmo (nada muda) continua aceito.
    const reativar = await chamar(app, "PATCH", caminho, {
      corpo: { ativo: true },
      sessao: proprio.sessao,
    });
    expect(reativar.status).toBe(200);
    const porOutro = await chamar(app, "PATCH", caminho, {
      corpo: { ativo: false },
      sessao: admin,
    });
    expect(porOutro.status).toBe(200);
    expect(await sessaoValida(proprio.sessao)).toBe(false);
  });

  it("dois admins desativando um ao outro ao mesmo tempo: um consegue, o outro recebe 409 e sobra um admin", async () => {
    const a = await sessaoDe(app, "admin");
    const b = await sessaoDe(app, "admin");
    // Durante o teste, A e B são os únicos admins ativos (os outros voltam no fim, com as sessões).
    const { results: outros } = await env.DB.prepare(
      "UPDATE usuarios SET ativo = 0 WHERE papel = 'admin' AND ativo = 1 AND id NOT IN (?1, ?2) RETURNING id",
    )
      .bind(a.usuarioId, b.usuarioId)
      .all<{ id: number }>();
    try {
      // As duas requisições passam pelo middleware antes de qualquer UPDATE.
      const [aDesativaB, bDesativaA] = await Promise.all([
        chamar(app, "PATCH", `/api/admin/usuarios/${b.usuarioId}`, {
          corpo: { ativo: false },
          sessao: a.sessao,
        }),
        chamar(app, "PATCH", `/api/admin/usuarios/${a.usuarioId}`, {
          corpo: { ativo: false },
          sessao: b.sessao,
        }),
      ]);

      expect([aDesativaB.status, bDesativaA.status].sort()).toEqual([200, 409]);
      // Quem fica ativo é o alvo da requisição recusada.
      const [recusada, quemFica] =
        aDesativaB.status === 409 ? [aDesativaB, b] : [bDesativaA, a];
      expect(await recusada.json()).toEqual(erro("em_uso"));
      expect(await sessaoValida(quemFica.sessao)).toBe(true);
      const ativos = await env.DB.prepare(
        "SELECT count(*) AS total FROM usuarios WHERE papel = 'admin' AND ativo = 1",
      ).first<{ total: number }>();
      expect(ativos?.total).toBe(1);
    } finally {
      await env.DB.prepare(
        "UPDATE usuarios SET ativo = 1 WHERE id IN (SELECT value FROM json_each(?1))",
      )
        .bind(JSON.stringify(outros.map((linha) => linha.id)))
        .run();
    }
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

describe("RIFA-029 (D20, CA4): link avulso de discipulador ou rede com o acesso desligado na campanha", () => {
  const chaves = (discipuladores: 0 | 1, redes: 0 | 1) =>
    env.DB.prepare(
      "UPDATE campanhas SET acesso_discipuladores = ?1, acesso_redes = ?2 WHERE ativa = 1",
    )
      .bind(discipuladores, redes)
      .run();
  const gerar = (id: number) =>
    chamar(app, "POST", `/api/admin/usuarios/${id}/links`, { sessao: admin });

  it("409 acao_desligada com a chave do papel (depois do 404); o líder e a coordenação geram; religada, gera", async () => {
    await semearCenario();
    const usuarios = {
      lider: (await criarAcessoDaHierarquiaNoBanco("lider", 1)).usuarioId,
      discipulador: (await criarAcessoDaHierarquiaNoBanco("discipulador", 10))
        .usuarioId,
      rede: (await criarAcessoDaHierarquiaNoBanco("rede", 1)).usuarioId,
    };
    const coordenacao = (await criarAcessoNoBanco("coordenacao")).usuarioId;
    await chaves(0, 0);
    try {
      for (const papel of ["discipulador", "rede"] as const) {
        const res = await gerar(usuarios[papel]);
        expect({ papel, status: res.status, corpo: await res.json() }).toEqual({
          papel,
          status: 409,
          corpo: {
            erro: {
              codigo: "acao_desligada",
              mensagem: expect.any(String),
              detalhes: {
                chave:
                  papel === "discipulador"
                    ? "acesso.discipuladores"
                    : "acesso.redes",
              },
            },
          },
        });
      }
      // Nenhum link novo foi gravado para eles.
      const links = await env.DB.prepare(
        "SELECT count(*) AS n FROM links_acesso WHERE usuario_id IN (?1, ?2)",
      )
        .bind(usuarios.discipulador, usuarios.rede)
        .first<{ n: number }>();
      expect(links?.n).toBe(2);
      // O 404 do usuário vem antes do 409.
      expect((await gerar(999_999_999)).status).toBe(404);
      for (const id of [usuarios.lider, coordenacao])
        expect((await gerar(id)).status).toBe(201);
    } finally {
      await chaves(1, 1);
    }
    for (const papel of ["discipulador", "rede"] as const)
      expect((await gerar(usuarios[papel])).status).toBe(201);
  });
});
