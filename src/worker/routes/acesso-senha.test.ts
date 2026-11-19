// RIFA-064 (D29): POST /api/sessao/senha, o login da célula com o nome dela e a senha padrão ("@" + nome normalizado +
// "1234"), no app REAL (src/worker/index.ts, via exports.default.fetch) e no D1 dos testes. Cobre: a sessão aberta é a
// do papel líder da célula (como a do link); as recusas (senha errada, célula que não existe, nome ambíguo, usuário
// desativado, chave desligada) dão a MESMA resposta; a chave desligada derruba as sessões abertas por senha; CSRF;
// os erros do corpo; a trilha registra o login sem a senha, e a senha não fica em tabela nem em log.
import { env, exports } from "cloudflare:workers";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  NOME_COOKIE_SESSAO,
  ROTAS_ACESSO,
  ROTAS_LINK_VENDAS,
  VALIDADE_SESSAO_DIAS,
  respostaMeusLinksVendasSchema,
  respostaSessaoSchema,
  senhaPadraoDaCelula,
} from "../../shared/contracts";
import { definirAtivo } from "../db/acessos";
import { sha256Hex } from "../lib/cripto";
import {
  ORIGEM,
  cabecalhosDeSessaoDaHierarquia,
  cookieDaResposta,
  criarAcessoDaHierarquiaNoBanco,
} from "../test/acesso-teste";
import { CELULAS, semearCenario } from "../test/painel-apoio";

const CAMINHO = ROTAS_ACESSO.entrarComSenha.caminho;
const ORIGEM_MALICIOSA = "https://site-malicioso.example";

/** As células do cenário (painel-apoio): "Célula Ágape" (1), "Célula Betel" (2), "Célula Canaã" (3)... */
const AGAPE = CELULAS[0];
const BETEL = CELULAS[1];
const CANAA = CELULAS[2];
const DORCAS = CELULAS[3];
const EFESO = CELULAS[4];
const senha = (nome: string) => senhaPadraoDaCelula(nome)!;

function entrarComSenha(
  corpo: unknown,
  cabecalhos: Record<string, string> = { Origin: ORIGEM },
): Promise<Response> {
  return exports.default.fetch(`${ORIGEM}${CAMINHO}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

function pedir(
  caminho: string,
  cabecalhos: Record<string, string>,
  metodo = "GET",
): Promise<Response> {
  return exports.default.fetch(`${ORIGEM}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
  });
}

/** Entra com a senha da célula e devolve a resposta e os cabeçalhos de uma requisição com a sessão aberta. */
async function entrarComo(
  nome: string,
  cabecalhos: Record<string, string> = { Origin: ORIGEM },
) {
  const res = await entrarComSenha(
    { celula: nome, senha: senha(nome) },
    cabecalhos,
  );
  expect(res.status).toBe(200);
  const cookie = cookieDaResposta(res)!;
  return {
    res,
    cookie: cookie.valor,
    sessao: {
      Cookie: `${NOME_COOKIE_SESSAO}=${cookie.valor}`,
      Origin: ORIGEM,
    },
  };
}

async function contar(sql: string, ...valores: unknown[]): Promise<number> {
  const linha = await env.DB.prepare(sql)
    .bind(...valores)
    .first<{ total: number }>();
  return linha?.total ?? 0;
}

async function ligarChave(ligada: boolean): Promise<void> {
  await env.DB.prepare(
    "UPDATE campanhas SET acesso_celulas_senha = ?1 WHERE ativa = 1",
  )
    .bind(ligada ? 1 : 0)
    .run();
}

beforeAll(async () => {
  await semearCenario();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await ligarChave(true);
});

// A trilha segura (RESTRICT) o usuário que aparece como autor: sem apagar as linhas do login, o próximo arquivo que
// limpa a hierarquia (com a cascata até o usuário do líder) seria recusado. Cada arquivo tem o seu D1, mas fica limpo.
afterAll(async () => {
  await env.DB.prepare(
    "DELETE FROM auditoria WHERE acao = 'sessao.entrar_com_senha'",
  ).run();
});

describe("RIFA-064: login certo abre a sessão do líder da célula", () => {
  it("200 com o usuário líder da célula (o alvo dela), o cookie __Host-sessao com as flags e a sessão sem link, de 45 dias", async () => {
    const usuariosAntes = await contar(
      "SELECT count(*) AS total FROM usuarios WHERE celula_id = ?1",
      AGAPE.id,
    );
    expect(usuariosAntes).toBe(0);

    const res = await entrarComSenha({
      celula: AGAPE.nome,
      senha: "@celulaagape1234",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const corpo = respostaSessaoSchema.parse(await res.json());
    // A célula não tinha usuário (nenhum link gerado): ele nasce com o lider_nome da hierarquia (o da importação).
    expect(corpo.usuario).toEqual({
      id: expect.any(Number),
      nome: `Líder da ${AGAPE.nome}`,
      papel: "lider",
      alvo: {
        tipo: "celula",
        id: AGAPE.id,
        nome: AGAPE.nome,
        divisao: AGAPE.divisao,
      },
    });
    expect(
      await env.DB.prepare(
        "SELECT papel, celula_id, ativo FROM usuarios WHERE id = ?1",
      )
        .bind(corpo.usuario.id)
        .first(),
    ).toEqual({ papel: "lider", celula_id: AGAPE.id, ativo: 1 });

    // O cookie é o de toda sessão: __Host-, HttpOnly, Secure, SameSite=Lax, Path=/, sem Domain.
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-sessao=/);
    expect(res.headers.get("Set-Cookie")).not.toMatch(/domain=/i);
    const cookie = cookieDaResposta(res)!;
    expect(cookie.valor).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const gravada = await env.DB.prepare(
      "SELECT usuario_id, link_id, criado_em, expira_em FROM sessoes WHERE id_hash = ?1",
    )
      .bind(await sha256Hex(cookie.valor))
      .first<{
        usuario_id: number;
        link_id: number | null;
        criado_em: string;
        expira_em: string;
      }>();
    expect(gravada).toMatchObject({
      usuario_id: corpo.usuario.id,
      link_id: null,
    });
    const segundos = Math.floor(
      (Date.parse(gravada!.expira_em) - Date.parse(gravada!.criado_em)) / 1000,
    );
    expect(segundos).toBe(VALIDADE_SESSAO_DIAS * 24 * 60 * 60);
    expect(cookie.atributos.sort()).toEqual(
      [
        "HttpOnly",
        `Max-Age=${segundos}`,
        "Path=/",
        "SameSite=Lax",
        "Secure",
      ].sort(),
    );

    // GET /api/sessao diz o mesmo; a /minha da célula responde (a visão e o link de vendas dela).
    const sessao = {
      Cookie: `${NOME_COOKIE_SESSAO}=${cookie.valor}`,
      Origin: ORIGEM,
    };
    const atual = await pedir("/api/sessao", sessao);
    expect(atual.status).toBe(200);
    expect(await atual.json()).toEqual(corpo);
    expect((await pedir("/api/minha/visao", sessao)).status).toBe(200);
    const links = await pedir(
      ROTAS_LINK_VENDAS.meusLinksVendas.caminho,
      sessao,
    );
    expect(links.status).toBe(200);
    expect(
      respostaMeusLinksVendasSchema.parse(await links.json()).alvo,
    ).toMatchObject({ tipo: "celula", id: AGAPE.id });
  });

  it("o nome e a senha toleram maiúsculas, acentos, pontuação e espaços (a mesma normalização)", async () => {
    for (const [celula, digitada] of [
      ["  célula BETEL ", "@Célula Betel 1234"],
      ["CELULA-BETEL", "  @celulabetel1234  "],
      ["celulabetel", "@CELULABETEL1234"],
    ]) {
      const res = await entrarComSenha({ celula, senha: digitada });
      expect({ celula, digitada, status: res.status }).toEqual({
        celula,
        digitada,
        status: 200,
      });
      const { usuario } = respostaSessaoSchema.parse(await res.json());
      expect(usuario.alvo?.id).toBe(BETEL.id);
    }
    // Um usuário só por célula: os três logins abriram sessões do mesmo usuário.
    expect(
      await contar(
        "SELECT count(*) AS total FROM usuarios WHERE celula_id = ?1",
        BETEL.id,
      ),
    ).toBe(1);
  });

  it("a célula que já tem o usuário do link do líder entra com ele (o mesmo id), e o link continua valendo", async () => {
    const acesso = await criarAcessoDaHierarquiaNoBanco("lider", CANAA.id);
    const { res } = await entrarComo(CANAA.nome);
    const { usuario } = respostaSessaoSchema.parse(await res.json());
    expect(usuario.id).toBe(acesso.usuarioId);
    const pelo_link = await exports.default.fetch(`${ORIGEM}/api/sessao`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGEM },
      body: JSON.stringify({ token: acesso.token }),
    });
    expect(pelo_link.status).toBe(200);
  });

  it("o nome do usuário acompanha o líder da hierarquia (como no lote de links)", async () => {
    const primeiro = await entrarComo(DORCAS.nome);
    const { usuario } = respostaSessaoSchema.parse(await primeiro.res.json());
    expect(usuario.nome).toBe(`Líder da ${DORCAS.nome}`);
    await env.DB.prepare("UPDATE celulas SET lider_nome = ?1 WHERE id = ?2")
      .bind("Líder Novo Fictício", DORCAS.id)
      .run();
    const segundo = await entrarComo(DORCAS.nome);
    const depois = respostaSessaoSchema.parse(await segundo.res.json());
    expect(depois.usuario).toMatchObject({
      id: usuario.id,
      nome: "Líder Novo Fictício",
    });
  });

  it("entrar de novo no mesmo navegador encerra a sessão anterior dele", async () => {
    const primeira = await entrarComo(BETEL.nome);
    const segunda = await entrarComo(BETEL.nome, primeira.sessao);
    expect(segunda.cookie).not.toBe(primeira.cookie);
    expect((await pedir("/api/sessao", primeira.sessao)).status).toBe(401);
    expect((await pedir("/api/sessao", segunda.sessao)).status).toBe(200);
  });

  it("Sair encerra a sessão aberta pela senha, como as outras", async () => {
    const { sessao } = await entrarComo(BETEL.nome);
    const saida = await pedir("/api/sessao/sair", sessao, "POST");
    expect(saida.status).toBe(204);
    expect((await pedir("/api/sessao", sessao)).status).toBe(401);
  });
});

describe("RIFA-064: toda recusa é a MESMA resposta (não diz se a célula existe)", () => {
  /** Status, cabeçalhos e corpo que o cliente vê, para comparar as recusas entre si. */
  async function recusa(res: Response) {
    return {
      status: res.status,
      cookie: res.headers.get("Set-Cookie"),
      cacheControl: res.headers.get("Cache-Control"),
      corpo: await res.text(),
    };
  }

  it("senha errada, célula que não existe, campos vazios, sem o '@', nome ambíguo, usuário desativado e chave desligada", async () => {
    // Nome ambíguo: duas células que ficam iguais na normalização (a coordenação vê o aviso na Hierarquia).
    await env.DB.prepare(
      `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
       VALUES (60, 10, 'Pão Vivo', 8, 'Líder Fictício Pão'), (61, 20, 'Pao Vivo', 9, 'Líder Fictício Pao')`,
    ).run();
    // Usuário da célula desativado pelo admin (D12): nem o link nem a senha entram.
    const efeso = await criarAcessoDaHierarquiaNoBanco("lider", EFESO.id);
    expect(await definirAtivo(env.DB, efeso.usuarioId, false)).toBe("ok");

    const usuariosAntes = await contar(
      "SELECT count(*) AS total FROM usuarios",
    );
    const sessoesAntes = await contar("SELECT count(*) AS total FROM sessoes");
    const trilhaAntes = await contar("SELECT count(*) AS total FROM auditoria");

    const casos: [string, () => Promise<Response>][] = [
      [
        "senha errada",
        () => entrarComSenha({ celula: AGAPE.nome, senha: "@celulaagape4321" }),
      ],
      [
        "senha de outra célula",
        () => entrarComSenha({ celula: AGAPE.nome, senha: senha(BETEL.nome) }),
      ],
      [
        "sem o @",
        () => entrarComSenha({ celula: AGAPE.nome, senha: "celulaagape1234" }),
      ],
      [
        "célula que não existe",
        () =>
          entrarComSenha({
            celula: "Célula Inexistente",
            senha: "@celulainexistente1234",
          }),
      ],
      ["campos vazios", () => entrarComSenha({ celula: "", senha: "" })],
      [
        "nome só com pontuação",
        () => entrarComSenha({ celula: "!!!", senha: "@1234" }),
      ],
      [
        "nome ambíguo (Pão Vivo)",
        () => entrarComSenha({ celula: "Pão Vivo", senha: "@paovivo1234" }),
      ],
      [
        "nome ambíguo (Pao Vivo)",
        () => entrarComSenha({ celula: "Pao Vivo", senha: "@paovivo1234" }),
      ],
      [
        "usuário da célula desativado",
        () => entrarComSenha({ celula: EFESO.nome, senha: senha(EFESO.nome) }),
      ],
      [
        "chave desligada",
        async () => {
          await ligarChave(false);
          try {
            return await entrarComSenha({
              celula: AGAPE.nome,
              senha: senha(AGAPE.nome),
            });
          } finally {
            await ligarChave(true);
          }
        },
      ],
    ];

    const respostas = [];
    for (const [caso, fazer] of casos)
      respostas.push({ caso, ...(await recusa(await fazer())) });
    const primeira = respostas[0];
    expect(primeira).toMatchObject({
      status: 401,
      cookie: null,
      cacheControl: "no-store",
    });
    expect(JSON.parse(primeira.corpo)).toEqual({
      erro: {
        codigo: "nao_autenticado",
        mensagem: "Não foi possível entrar com esta célula e esta senha",
      },
    });
    for (const resposta of respostas)
      expect(resposta).toEqual({ ...primeira, caso: resposta.caso });

    // Nada nasceu: nem usuário, nem sessão, nem linha na trilha.
    expect(await contar("SELECT count(*) AS total FROM usuarios")).toBe(
      usuariosAntes,
    );
    expect(await contar("SELECT count(*) AS total FROM sessoes")).toBe(
      sessoesAntes,
    );
    expect(await contar("SELECT count(*) AS total FROM auditoria")).toBe(
      trilhaAntes,
    );
    // Com a chave religada, a mesma senha entra (a recusa era só a chave).
    expect(
      (
        await entrarComSenha({
          celula: AGAPE.nome,
          senha: senha(AGAPE.nome),
        })
      ).status,
    ).toBe(200);
  });

  it("corpo fora do contrato: 400 sem campo ou com campo longo; 413 acima de 4 KiB; JSON quebrado 400", async () => {
    for (const corpo of [
      {},
      { celula: AGAPE.nome },
      { senha: senha(AGAPE.nome) },
      { celula: 1, senha: "@x1234" },
      { celula: "x".repeat(201), senha: "@x1234" },
    ]) {
      const res = await entrarComSenha(corpo);
      expect({ corpo, status: res.status }).toEqual({ corpo, status: 400 });
      expect(cookieDaResposta(res)).toBeNull();
    }
    const quebrado = await entrarComSenha("{celula:");
    expect(quebrado.status).toBe(400);
    const grande = await entrarComSenha({
      celula: AGAPE.nome,
      senha: senha(AGAPE.nome),
      sobra: "x".repeat(5000),
    });
    expect(grande.status).toBe(413);
  });
});

describe("RIFA-064: a chave acesso.celulas_senha", () => {
  it("desligada, as sessões abertas por senha deixam de valer (401, cookie expirado) e a do link do líder continua; religada, entra de novo", async () => {
    const { sessao } = await entrarComo(AGAPE.nome);
    const peloLink = await cabecalhosDeSessaoDaHierarquia("lider", BETEL.id);
    expect((await pedir("/api/minha/visao", sessao)).status).toBe(200);

    await ligarChave(false);
    for (const caminho of ["/api/sessao", "/api/minha/visao"]) {
      const res = await pedir(caminho, sessao);
      expect({ caminho, status: res.status }).toEqual({ caminho, status: 401 });
      expect(cookieDaResposta(res)?.atributos).toContain("Max-Age=0");
    }
    expect((await pedir("/api/minha/visao", peloLink)).status).toBe(200);

    await ligarChave(true);
    await entrarComo(AGAPE.nome);
  });

  it("sem campanha ativa vale o padrão (ligada)", async () => {
    await env.DB.prepare(
      "UPDATE campanhas SET ativa = 0 WHERE ativa = 1",
    ).run();
    try {
      const { sessao } = await entrarComo(BETEL.nome);
      expect((await pedir("/api/sessao", sessao)).status).toBe(200);
    } finally {
      await env.DB.prepare(
        "UPDATE campanhas SET ativa = 1 WHERE id = (SELECT min(id) FROM campanhas WHERE slug_rifei = 'rifa-videira-kids-teste')",
      ).run();
    }
  });

  it("desativar o usuário da célula derruba a sessão aberta pela senha", async () => {
    const { res, sessao } = await entrarComo(DORCAS.nome);
    const { usuario } = respostaSessaoSchema.parse(await res.json());
    expect(await definirAtivo(env.DB, usuario.id, false)).toBe("ok");
    try {
      expect((await pedir("/api/sessao", sessao)).status).toBe(401);
    } finally {
      await definirAtivo(env.DB, usuario.id, true);
    }
  });
});

describe("RIFA-064: CSRF, como todo POST da sessão", () => {
  it("de outra origem ou sem Origin nem Sec-Fetch-Site: 403, sem sessão e sem usuário novo; Sec-Fetch-Site same-origin passa", async () => {
    const usuarios = await contar("SELECT count(*) AS total FROM usuarios");
    const corpo = { celula: AGAPE.nome, senha: senha(AGAPE.nome) };
    const cabecalhosRecusados: Record<string, string>[] = [
      { Origin: ORIGEM_MALICIOSA },
      {},
      { "Sec-Fetch-Site": "cross-site" },
      { Origin: ORIGEM_MALICIOSA, "Sec-Fetch-Site": "cross-site" },
    ];
    for (const cabecalhos of cabecalhosRecusados) {
      const res = await entrarComSenha(corpo, cabecalhos);
      expect({ cabecalhos, status: res.status }).toEqual({
        cabecalhos,
        status: 403,
      });
      expect((await res.json()) as unknown).toEqual({
        erro: { codigo: "proibido", mensagem: expect.any(String) },
      });
      expect(cookieDaResposta(res)).toBeNull();
    }
    expect(await contar("SELECT count(*) AS total FROM usuarios")).toBe(
      usuarios,
    );
    const mesmaOrigem = await entrarComSenha(corpo, {
      "Sec-Fetch-Site": "same-origin",
    });
    expect(mesmaOrigem.status).toBe(200);
  });
});

describe("RIFA-064: a trilha registra o login por senha, e a senha não fica em lugar nenhum", () => {
  it("uma linha por login, do usuário da célula, alvo celula:<id>, sem a senha; recusa não registra", async () => {
    const antes = await contar(
      "SELECT count(*) AS total FROM auditoria WHERE acao = 'sessao.entrar_com_senha'",
    );
    const { res } = await entrarComo(CANAA.nome);
    const { usuario } = respostaSessaoSchema.parse(await res.json());
    await entrarComSenha({ celula: CANAA.nome, senha: "@errada1234" });

    const { results } = await env.DB.prepare(
      `SELECT usuario_id, em, acao, alvo, resumo FROM auditoria
       WHERE acao = 'sessao.entrar_com_senha' ORDER BY id DESC`,
    ).all<{
      usuario_id: number;
      em: string;
      acao: string;
      alvo: string;
      resumo: string;
    }>();
    expect(results).toHaveLength(antes + 1);
    expect(results[0]).toEqual({
      usuario_id: usuario.id,
      em: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      ),
      acao: "sessao.entrar_com_senha",
      alvo: `celula:${CANAA.id}`,
      resumo: expect.any(String),
    });
    for (const texto of [senha(CANAA.nome), "1234", "celulacanaa"])
      expect(results[0].resumo).not.toContain(texto);
  });

  it("a senha (digitada e derivada) não está em nenhuma tabela nem em nenhum log", async () => {
    const digitada = "@Célula Éfeso Única 1234";
    // Uma célula só para este teste, com um nome que não aparece em nenhum outro lugar.
    await env.DB.prepare(
      `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
       VALUES (70, 30, 'Célula Éfeso Única', 7, 'Líder Fictício Único')`,
    ).run();
    const logs: string[] = [];
    for (const nivel of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, nivel).mockImplementation((...partes: unknown[]) => {
        logs.push(partes.map((parte) => String(parte)).join(" "));
      });

    const certo = await entrarComSenha({
      celula: "Célula Éfeso Única",
      senha: digitada,
    });
    expect(certo.status).toBe(200);
    const errado = await entrarComSenha({
      celula: "Célula Éfeso Única",
      senha: "@celulaefesounica9999",
    });
    expect(errado.status).toBe(401);

    const procuradas = [
      digitada,
      senhaPadraoDaCelula("Célula Éfeso Única")!,
      "@celulaefesounica9999",
      "celulaefesounica1234",
    ];
    const { results: tabelas } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    ).all<{ name: string }>();
    expect(tabelas.length).toBeGreaterThan(10);
    for (const { name } of tabelas) {
      const { results } = await env.DB.prepare(`SELECT * FROM "${name}"`).all();
      const conteudo = JSON.stringify(results);
      for (const procurada of procuradas)
        expect({ tabela: name, contem: conteudo.includes(procurada) }).toEqual({
          tabela: name,
          contem: false,
        });
    }
    for (const linha of logs)
      for (const procurada of procuradas)
        expect(linha.includes(procurada)).toBe(false);
  });
});

describe("RIFA-064: a sessão da célula fica só na /minha da própria célula", () => {
  it("403 na coordenação; a /minha não aceita outra célula (o alvo vem só da sessão)", async () => {
    const { sessao } = await entrarComo(AGAPE.nome);
    for (const [metodo, caminho] of [
      ["GET", "/api/admin/campanha"],
      ["GET", "/api/admin/celulas"],
      ["GET", "/api/admin/usuarios"],
      ["GET", "/api/admin/auditoria"],
      ["GET", "/api/painel/resumo"],
      ["PUT", "/api/admin/campanha"],
      ["POST", "/api/admin/acessos-hierarquia/links"],
    ] as const) {
      const res = await pedir(caminho, sessao, metodo);
      expect({ metodo, caminho, status: res.status }).toEqual({
        metodo,
        caminho,
        status: 403,
      });
    }
    const links = await pedir(
      `${ROTAS_LINK_VENDAS.meusLinksVendas.caminho}?celula_id=${BETEL.id}`,
      sessao,
    );
    expect(links.status).toBe(200);
    const corpo = respostaMeusLinksVendasSchema.parse(await links.json());
    expect(corpo.alvo).toMatchObject({ tipo: "celula", id: AGAPE.id });
    expect(JSON.stringify(corpo)).not.toContain(BETEL.nome);
  });
});
