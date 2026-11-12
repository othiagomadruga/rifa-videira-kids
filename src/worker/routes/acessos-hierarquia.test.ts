// RIFA-014, CA5: acessos da hierarquia (/api/admin/acessos-hierarquia), só admin. A lista traz TODOS os alvos do
// papel, com ou sem acesso; a geração em lote dá um link novo por alvo, na ordem de `ids`, tudo ou nada (404 e
// 409 com os ids), com `revogar_anteriores` derrubando as sessões antigas, uma linha na trilha de auditoria e a
// URL só na resposta da geração. Desativar, link avulso e revogar (admin-usuarios.ts) valem para esses usuários.
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ROTAS_ACESSO_HIERARQUIA,
  respostaAcessosHierarquiaSchema,
  respostaAuditoriaSchema,
  respostaGerarLinksHierarquiaSchema,
  respostaListaUsuariosSchema,
  respostaSessaoSchema,
  usuarioSchema,
  type CorpoGerarLinksHierarquia,
  type LinkGeradoHierarquia,
  type PapelHierarquia,
} from "../../shared/contracts";
import {
  ORIGEM,
  chamar,
  criarAppDeTeste,
  entrar,
  erro,
  sessaoDe,
  type AppDeTeste,
} from "../test/acesso-teste";
import { CELULAS, limparBanco, semearHierarquia } from "../test/painel-apoio";
import { auditoria, PREFIXO_AUDITORIA } from "./auditoria";

let app: AppDeTeste;
let admin: string;
let coordenacao: string;

beforeAll(async () => {
  app = criarAppDeTeste();
  // A trilha (só admin), para conferir o registro do lote.
  app.route(PREFIXO_AUDITORIA, auditoria);
  admin = (await sessaoDe(app, "admin")).sessao;
  coordenacao = (await sessaoDe(app, "coordenacao")).sessao;
});

/** Hierarquia do painel (ids fixos), com o telefone de dois líderes e o responsável de uma rede. */
async function semear(): Promise<void> {
  await limparBanco();
  await semearHierarquia();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE celulas SET lider_telefone = '(91) 98888-0001' WHERE id = 1",
    ),
    env.DB.prepare(
      "UPDATE celulas SET lider_telefone = '+55 91 97777-0003' WHERE id = 3",
    ),
    env.DB.prepare(
      "UPDATE redes SET responsavel_nome = 'Pastora Ficticia' WHERE id = 1",
    ),
  ]);
}

beforeEach(semear);

async function listar(papel: PapelHierarquia, sessao = admin) {
  const res = await chamar(
    app,
    "GET",
    `/api/admin/acessos-hierarquia?papel=${papel}`,
    { sessao },
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const texto = await res.text();
  const corpo: unknown = JSON.parse(texto);
  const lida = respostaAcessosHierarquiaSchema.parse(corpo);
  expect(lida).toEqual(corpo);
  return { texto, itens: lida.itens };
}

async function gerar(corpo: CorpoGerarLinksHierarquia, sessao = admin) {
  const res = await chamar(app, "POST", "/api/admin/acessos-hierarquia/links", {
    corpo,
    sessao,
  });
  expect(res.status).toBe(201);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const json: unknown = await res.json();
  const lido = respostaGerarLinksHierarquiaSchema.parse(json);
  expect(lido).toEqual(json);
  return lido.itens;
}

const tokenDe = (link: LinkGeradoHierarquia) =>
  link.link.url.slice(`${ORIGEM}/acesso/`.length);

async function contar(): Promise<number[]> {
  const resultados = await env.DB.batch<{ total: number }>(
    ["usuarios", "links_acesso", "sessoes", "auditoria"].map((tabela) =>
      env.DB.prepare(`SELECT count(*) AS total FROM ${tabela}`),
    ),
  );
  return resultados.map((resultado) => resultado.results[0].total);
}

/** Os registros dos lotes na trilha, do mais novo para o mais antigo, depois do registro `depoisDe`. */
async function trilhaDoLote(depoisDe = 0) {
  const res = await chamar(app, "GET", "/api/admin/auditoria", {
    sessao: admin,
  });
  return respostaAuditoriaSchema
    .parse(await res.json())
    .itens.filter(
      (item) =>
        item.acao === "acessos_hierarquia.gerar_links" && item.id > depoisDe,
    );
}

async function ultimoRegistro(): Promise<number> {
  const linha = await env.DB.prepare(
    "SELECT coalesce(max(id), 0) AS id FROM auditoria",
  ).first<{ id: number }>();
  return linha!.id;
}

describe("GET /api/admin/acessos-hierarquia: todos os alvos do papel", () => {
  it("líderes: todas as células pelo caminho na hierarquia, com o líder, o telefone e sem usuário antes do 1º link", async () => {
    const { itens } = await listar("lider");
    // Rede Adulta (Caleb: Dorcas, Éfeso) antes da Rede Jovem (Abel: Ágape, Betel; Boaz: Canaã).
    expect(itens.map((item) => item.alvo.id)).toEqual([4, 5, 1, 2, 3]);
    expect(itens.find((item) => item.alvo.id === 1)).toEqual({
      alvo: { tipo: "celula", id: 1, nome: "Célula Ágape", divisao: "jovens" },
      pessoa_nome: "Líder da Célula Ágape",
      telefone: "(91) 98888-0001",
      usuario: null,
    });
    expect(itens.find((item) => item.alvo.id === 4)?.telefone).toBeNull();
  });

  it("discipuladores e redes: quem recebe é o discipulador e o responsável (ou ninguém); telefone só do líder", async () => {
    const discipuladores = (await listar("discipulador")).itens;
    expect(
      discipuladores.map(({ alvo, pessoa_nome, telefone }) => [
        alvo.id,
        pessoa_nome,
        telefone,
      ]),
    ).toEqual([
      [30, "Discipulador Caleb", null],
      [40, "Discipulador Davi", null],
      [10, "Discipulador Abel", null],
      [20, "Discipulador Boaz", null],
    ]);
    const redes = (await listar("rede")).itens;
    expect(
      redes.map(({ alvo, pessoa_nome, telefone }) => [
        alvo.id,
        alvo.divisao,
        pessoa_nome,
        telefone,
      ]),
    ).toEqual([
      [2, "adultos", null, null],
      [1, "jovens", "Pastora Ficticia", null],
    ]);
  });

  it("depois de gerar: o usuário do alvo com os links (sem token nem URL) e as sessões abertas", async () => {
    const [gerado] = await gerar({ papel: "lider", ids: [1] });
    await entrar(app, tokenDe(gerado));
    const { texto, itens } = await listar("lider");
    const item = itens.find((linha) => linha.alvo.id === 1)!;
    expect(item.usuario).toEqual({
      id: gerado.usuario_id,
      nome: "Líder da Célula Ágape",
      ativo: true,
      sessoes_ativas: 1,
      links: [
        {
          id: gerado.link.id,
          criado_em: gerado.link.criado_em,
          expira_em: gerado.link.expira_em,
          revogado_em: null,
          ultimo_uso_em: expect.any(String),
          situacao: "valido",
          // RIFA-043: nenhum link da hierarquia abre a sessão do admin que pede a lista.
          desta_sessao: false,
        },
      ],
    });
    expect(texto).not.toContain(tokenDe(gerado));
    expect(texto).not.toContain("url");
    expect(itens.filter((linha) => linha.usuario !== null)).toHaveLength(1);
  });

  it("consulta sem papel ou com papel da coordenação: 400", async () => {
    for (const consulta of [
      "",
      "?papel=admin",
      "?papel=coordenacao",
      "?papel=x",
    ]) {
      const res = await chamar(
        app,
        "GET",
        `/api/admin/acessos-hierarquia${consulta}`,
        { sessao: admin },
      );
      expect({ consulta, status: res.status }).toEqual({
        consulta,
        status: 400,
      });
    }
  });
});

describe("POST /api/admin/acessos-hierarquia/links: um link novo por alvo", () => {
  it("um por alvo, na ordem de ids, com a URL; cria o usuário preso ao alvo e o link abre a sessão com o alvo", async () => {
    const itens = await gerar({ papel: "lider", ids: [3, 1, 5] });
    expect(itens.map((item) => item.alvo.id)).toEqual([3, 1, 5]);
    expect(itens[0]).toEqual({
      alvo: { tipo: "celula", id: 3, nome: "Célula Canaã", divisao: "jovens" },
      pessoa_nome: "Líder da Célula Canaã",
      telefone: "+55 91 97777-0003",
      usuario_id: expect.any(Number),
      link: {
        id: expect.any(Number),
        criado_em: expect.any(String),
        expira_em: expect.any(String),
        revogado_em: null,
        ultimo_uso_em: null,
        situacao: "valido",
        desta_sessao: false,
        url: expect.stringMatching(
          /^http:\/\/localhost\/acesso\/[A-Za-z0-9_-]{43}$/,
        ),
      },
    });
    expect(new Set(itens.map((item) => item.usuario_id)).size).toBe(3);
    expect(new Set(itens.map(tokenDe)).size).toBe(3);

    const { results } = await env.DB.prepare(
      "SELECT id, nome, papel, celula_id FROM usuarios WHERE celula_id IS NOT NULL ORDER BY celula_id",
    ).all();
    expect(results).toEqual(
      [1, 3, 5].map((celula) => ({
        id: itens.find((item) => item.alvo.id === celula)!.usuario_id,
        nome: `Líder da ${CELULAS.find((item) => item.id === celula)!.nome}`,
        papel: "lider",
        celula_id: celula,
      })),
    );

    const sessao = await entrar(app, tokenDe(itens[1]));
    const res = await chamar(app, "GET", "/api/sessao", { sessao });
    expect(respostaSessaoSchema.parse(await res.json())).toEqual({
      usuario: {
        id: itens[1].usuario_id,
        nome: "Líder da Célula Ágape",
        papel: "lider",
        alvo: {
          tipo: "celula",
          id: 1,
          nome: "Célula Ágape",
          divisao: "jovens",
        },
      },
    });
  });

  it("discipulador e rede: o usuário leva o nome de quem recebe (sem responsável, o nome da rede)", async () => {
    const [discipulador] = await gerar({ papel: "discipulador", ids: [40] });
    const redes = await gerar({ papel: "rede", ids: [1, 2] });
    const nomes = await env.DB.prepare(
      `SELECT papel, coalesce(discipulador_id, rede_id) AS alvo, nome FROM usuarios
       WHERE discipulador_id IS NOT NULL OR rede_id IS NOT NULL ORDER BY papel, alvo`,
    ).all();
    expect(nomes.results).toEqual([
      { papel: "discipulador", alvo: 40, nome: "Discipulador Davi" },
      { papel: "rede", alvo: 1, nome: "Pastora Ficticia" },
      { papel: "rede", alvo: 2, nome: "Rede Adulta Ficticia" },
    ]);
    expect(discipulador.alvo).toEqual({
      tipo: "discipulador",
      id: 40,
      nome: "Discipulador Davi",
      divisao: "adultos",
    });
    expect(redes.map((item) => [item.pessoa_nome, item.telefone])).toEqual([
      ["Pastora Ficticia", null],
      [null, null],
    ]);
  });

  it("de novo, sem revogar: o mesmo usuário (com o nome atual do líder), um link a mais, e os anteriores continuam valendo", async () => {
    const [primeiro] = await gerar({ papel: "lider", ids: [2] });
    const sessaoAntiga = await entrar(app, tokenDe(primeiro));
    // O líder da célula mudou na hierarquia.
    await env.DB.prepare(
      "UPDATE celulas SET lider_nome = 'Nova Lider Ficticia' WHERE id = 2",
    ).run();

    const [segundo] = await gerar({ papel: "lider", ids: [2] });
    expect(segundo.usuario_id).toBe(primeiro.usuario_id);
    expect(segundo.pessoa_nome).toBe("Nova Lider Ficticia");
    expect(segundo.link.id).not.toBe(primeiro.link.id);
    const usuario = await env.DB.prepare(
      "SELECT nome FROM usuarios WHERE id = ?1",
    )
      .bind(primeiro.usuario_id)
      .first();
    expect(usuario).toEqual({ nome: "Nova Lider Ficticia" });
    // As duas URLs entram, e a sessão antiga continua.
    expect(
      (await chamar(app, "GET", "/api/sessao", { sessao: sessaoAntiga }))
        .status,
    ).toBe(200);
    await entrar(app, tokenDe(primeiro));
    await entrar(app, tokenDe(segundo));
  });

  it("revogar_anteriores: os links válidos de antes são revogados e as sessões abertas por eles caem; o novo entra", async () => {
    const [primeiro] = await gerar({ papel: "lider", ids: [2, 4] });
    const sessaoAntiga = await entrar(app, tokenDe(primeiro));
    const sessaoDaOutra = await entrar(
      app,
      tokenDe((await gerar({ papel: "lider", ids: [5] }))[0]),
    );

    const [trocado] = await gerar({
      papel: "lider",
      ids: [2],
      revogar_anteriores: true,
    });
    expect(trocado.usuario_id).toBe(primeiro.usuario_id);
    const semSessao = await chamar(app, "GET", "/api/sessao", {
      sessao: sessaoAntiga,
    });
    expect(semSessao.status).toBe(401);
    expect(await semSessao.json()).toEqual(erro("nao_autenticado"));
    const login = await chamar(app, "POST", "/api/sessao", {
      corpo: { token: tokenDe(primeiro) },
    });
    expect(login.status).toBe(401);
    await entrar(app, tokenDe(trocado));
    // Só o alvo do lote: a sessão de outra célula continua.
    expect(
      (await chamar(app, "GET", "/api/sessao", { sessao: sessaoDaOutra }))
        .status,
    ).toBe(200);
    const { itens } = await listar("lider");
    const links = itens.find((item) => item.alvo.id === 2)!.usuario!.links;
    expect(links.map((link) => link.situacao)).toEqual(["valido", "revogado"]);
  });

  it("tudo ou nada: id que não é alvo do papel dá 404 com os ids (crescentes), e nada é gravado", async () => {
    const antes = await contar();
    for (const [papel, ids, recusados] of [
      ["lider", [1, 999, 998], [998, 999]],
      // O id 10 é de um discipulador, não de uma célula; e 1 é célula, não discipulador.
      ["lider", [10], [10]],
      ["discipulador", [10, 1], [1]],
      ["rede", [2, 30], [30]],
    ] as [PapelHierarquia, number[], number[]][]) {
      const res = await chamar(
        app,
        "POST",
        "/api/admin/acessos-hierarquia/links",
        {
          corpo: { papel, ids },
          sessao: admin,
        },
      );
      expect({
        papel,
        ids,
        status: res.status,
        corpo: await res.json(),
      }).toEqual({
        papel,
        ids,
        status: 404,
        corpo: {
          erro: {
            codigo: "nao_encontrado",
            mensagem: expect.any(String),
            detalhes: { ids: recusados },
          },
        },
      });
    }
    expect(await contar()).toEqual(antes);
  });

  it("tudo ou nada: alvo com o usuário desativado dá 409 com os ids, e nem os outros alvos ganham link", async () => {
    const [desativado, outro] = await gerar({ papel: "lider", ids: [3, 4] });
    const patch = await chamar(
      app,
      "PATCH",
      `/api/admin/usuarios/${desativado.usuario_id}`,
      {
        corpo: { ativo: false },
        sessao: admin,
      },
    );
    expect(patch.status).toBe(200);
    const antes = await contar();

    const res = await chamar(
      app,
      "POST",
      "/api/admin/acessos-hierarquia/links",
      {
        corpo: { papel: "lider", ids: [1, 4, 3], revogar_anteriores: true },
        sessao: admin,
      },
    );
    expect({ status: res.status, corpo: await res.json() }).toEqual({
      status: 409,
      corpo: {
        erro: {
          codigo: "em_uso",
          mensagem: expect.any(String),
          detalhes: { ids: [3] },
        },
      },
    });
    expect(await contar()).toEqual(antes);
    // Nada mudou: o link do outro alvo segue válido (o revogar_anteriores não rodou).
    await entrar(app, tokenDe(outro));
  });

  it("dois lotes ao mesmo tempo para o mesmo alvo novo: um usuário só, e cada lote com o link dele", async () => {
    const [a, b] = await Promise.all([
      gerar({ papel: "lider", ids: [1, 2] }),
      gerar({ papel: "lider", ids: [2, 1] }),
    ]);
    const { results } = await env.DB.prepare(
      "SELECT celula_id, count(*) AS total FROM usuarios WHERE celula_id IS NOT NULL GROUP BY celula_id",
    ).all();
    expect(results).toEqual([
      { celula_id: 1, total: 1 },
      { celula_id: 2, total: 1 },
    ]);
    expect(a[0].usuario_id).toBe(b[1].usuario_id);
    for (const link of [...a, ...b]) await entrar(app, tokenDe(link));
  });

  it("corpo fora do schema: 400 (ids repetidos, vazios, acima do limite, papel da coordenação, campo a mais)", async () => {
    const antes = await contar();
    for (const corpo of [
      { papel: "lider", ids: [1, 1] },
      { papel: "lider", ids: [] },
      { papel: "lider", ids: Array.from({ length: 201 }, (_, i) => i + 1) },
      { papel: "admin", ids: [1] },
      { papel: "lider", ids: [1], extra: true },
      { papel: "lider", ids: ["1"] },
      { ids: [1] },
    ]) {
      const res = await chamar(
        app,
        "POST",
        "/api/admin/acessos-hierarquia/links",
        {
          corpo,
          sessao: admin,
        },
      );
      expect({ corpo, status: res.status }).toEqual({ corpo, status: 400 });
    }
    expect(await contar()).toEqual(antes);
  });
});

describe("só admin, auditoria e a URL só na geração", () => {
  it("as duas rotas são só de admin no contrato", () => {
    expect(
      Object.values(ROTAS_ACESSO_HIERARQUIA).map((rota) => [
        `${rota.metodo} ${rota.caminho}`,
        rota.papeis,
      ]),
    ).toEqual([
      ["GET /api/admin/acessos-hierarquia", ["admin"]],
      ["POST /api/admin/acessos-hierarquia/links", ["admin"]],
    ]);
  });

  it("sem sessão: 401; coordenação e papéis da hierarquia: 403; nada é gravado", async () => {
    const [lider] = await gerar({ papel: "lider", ids: [1] });
    const sessaoDoLider = await entrar(app, tokenDe(lider));
    const antes = await contar();
    for (const [metodo, caminho, corpo] of [
      ["GET", "/api/admin/acessos-hierarquia?papel=lider", undefined],
      [
        "POST",
        "/api/admin/acessos-hierarquia/links",
        { papel: "lider", ids: [2] },
      ],
    ] as const) {
      const semSessao = await chamar(app, metodo, caminho, { corpo });
      expect(semSessao.status).toBe(401);
      expect(await semSessao.json()).toEqual(erro("nao_autenticado"));
      for (const sessao of [coordenacao, sessaoDoLider]) {
        const recusada = await chamar(app, metodo, caminho, { corpo, sessao });
        expect(recusada.status).toBe(403);
        expect(await recusada.json()).toEqual(erro("proibido"));
      }
    }
    expect(await contar()).toEqual(antes);
  });

  it("uma linha na trilha por lote, sem nomes nem telefones; o lote recusado não registra nada", async () => {
    const depoisDe = await ultimoRegistro();
    await gerar({ papel: "lider", ids: [1, 3] });
    await gerar({ papel: "lider", ids: [3, 5], revogar_anteriores: true });
    await chamar(app, "POST", "/api/admin/acessos-hierarquia/links", {
      corpo: { papel: "lider", ids: [999] },
      sessao: admin,
    });
    const registros = await trilhaDoLote(depoisDe);
    expect(registros.map(({ alvo, resumo }) => ({ alvo, resumo }))).toEqual([
      {
        alvo: "papel:lider",
        resumo:
          "Links novos para 2 células (1 acesso criado); links anteriores revogados e as sessões deles encerradas. Ids: 3, 5",
      },
      {
        alvo: "papel:lider",
        resumo:
          "Links novos para 2 células (2 acessos criados); links anteriores mantidos. Ids: 1, 3",
      },
    ]);
    const texto = JSON.stringify(registros);
    for (const pessoal of ["Líder", "Canaã", "Ágape", "98888", "97777"])
      expect(texto).not.toContain(pessoal);
  });

  it("a URL (o token) só aparece na resposta da geração: nem na lista, nem na administração, nem no banco", async () => {
    const itens = await gerar({ papel: "lider", ids: [1, 2, 3, 4, 5] });
    const tokens = itens.map(tokenDe);
    const lista = (await listar("lider")).texto;
    const usuarios = await (
      await chamar(app, "GET", "/api/admin/usuarios", { sessao: admin })
    ).text();
    const { results: tabelas } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
    ).all<{ name: string }>();
    const banco = (
      await Promise.all(
        tabelas.map(async ({ name }) =>
          JSON.stringify(
            (await env.DB.prepare(`SELECT * FROM "${name}"`).all()).results,
          ),
        ),
      )
    ).join("\n");
    for (const token of tokens) {
      expect(lista).not.toContain(token);
      expect(usuarios).not.toContain(token);
      expect(banco).not.toContain(token);
    }
  });
});

describe("desativar, link avulso e revogar valem para os usuários da hierarquia; a lista da administração é só da coordenação", () => {
  it("GET /api/admin/usuarios lista só admin e coordenacao", async () => {
    await gerar({ papel: "lider", ids: [1] });
    await gerar({ papel: "rede", ids: [2] });
    const res = await chamar(app, "GET", "/api/admin/usuarios", {
      sessao: admin,
    });
    const { itens } = respostaListaUsuariosSchema.parse(await res.json());
    expect(itens.length).toBeGreaterThanOrEqual(2);
    expect([...new Set(itens.map((item) => item.papel))].sort()).toEqual([
      "admin",
      "coordenacao",
    ]);
    expect(itens.every((item) => item.alvo === undefined)).toBe(true);
  });

  it("PATCH desativa o líder (com o alvo na resposta) e encerra as sessões; link avulso e revogar funcionam", async () => {
    const [lider] = await gerar({ papel: "lider", ids: [4] });
    const sessao = await entrar(app, tokenDe(lider));

    const desativado = await chamar(
      app,
      "PATCH",
      `/api/admin/usuarios/${lider.usuario_id}`,
      {
        corpo: { ativo: false },
        sessao: admin,
      },
    );
    expect(desativado.status).toBe(200);
    const usuario = usuarioSchema.parse(await desativado.json());
    expect(usuario).toMatchObject({
      id: lider.usuario_id,
      papel: "lider",
      ativo: false,
      sessoes_ativas: 0,
      alvo: {
        tipo: "celula",
        id: 4,
        nome: "Célula Dorcas",
        divisao: "adultos",
      },
    });
    expect((await chamar(app, "GET", "/api/sessao", { sessao })).status).toBe(
      401,
    );

    const reativado = await chamar(
      app,
      "PATCH",
      `/api/admin/usuarios/${lider.usuario_id}`,
      {
        corpo: { ativo: true },
        sessao: admin,
      },
    );
    expect(reativado.status).toBe(200);
    const avulso = await chamar(
      app,
      "POST",
      `/api/admin/usuarios/${lider.usuario_id}/links`,
      {
        sessao: admin,
      },
    );
    expect(avulso.status).toBe(201);
    const { link } = (await avulso.json()) as {
      link: { id: number; url: string };
    };
    const sessaoNova = await entrar(
      app,
      link.url.slice(`${ORIGEM}/acesso/`.length),
    );
    const revogado = await chamar(
      app,
      "DELETE",
      `/api/admin/links/${link.id}`,
      {
        sessao: admin,
      },
    );
    expect(revogado.status).toBe(204);
    expect(
      (await chamar(app, "GET", "/api/sessao", { sessao: sessaoNova })).status,
    ).toBe(401);
  });
});
