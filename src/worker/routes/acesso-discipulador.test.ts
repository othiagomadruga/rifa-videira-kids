// RIFA-082 (D37): POST /api/sessao/discipulador, o login do discipulador com o nome dele e a senha padrão ("@" + nome
// normalizado + "1234", a regra da célula), no app REAL (src/worker/index.ts, via exports.default.fetch) e no D1 dos
// testes. Cobre: a sessão aberta é a do papel discipulador (como a do link), e a /minha mostra só as células dele; as
// recusas (senha errada, nome desconhecido, colisão, nome sem letra, usuário desativado, cada uma das duas chaves
// desligada) dão a MESMA resposta; desligar uma das chaves derruba a sessão aberta pela senha (e não a do link); CSRF;
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
  respostaVisaoIndividualSchema,
  senhaPadraoDoDiscipulador,
} from "../../shared/contracts";
import { definirAtivo } from "../db/acessos";
import { sha256Hex } from "../lib/cripto";
import {
  ORIGEM,
  cabecalhosDeSessaoDaHierarquia,
  cookieDaResposta,
  criarAcessoDaHierarquiaNoBanco,
} from "../test/acesso-teste";
import { CELULAS, DISCIPULADORES, semearCenario } from "../test/painel-apoio";

const CAMINHO = ROTAS_ACESSO.entrarComoDiscipulador.caminho;
const ORIGEM_MALICIOSA = "https://site-malicioso.example";

/** Os discipuladores do cenário (painel-apoio): Abel (células Ágape e Betel), Boaz (Canaã), Caleb (Dorcas e Éfeso). */
const ABEL = DISCIPULADORES[0];
const BOAZ = DISCIPULADORES[1];
const CALEB = DISCIPULADORES[2];
const DAVI = DISCIPULADORES[3];
const senha = (nome: string) => senhaPadraoDoDiscipulador(nome)!;
const celulasDe = (discipuladorId: number) =>
  CELULAS.filter((celula) => celula.discipulador_id === discipuladorId).map(
    (celula) => celula.id,
  );

function entrarComoDiscipulador(
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

/** Entra com a senha do discipulador e devolve a resposta e os cabeçalhos de uma requisição com a sessão aberta. */
async function entrarComo(
  nome: string,
  cabecalhos: Record<string, string> = { Origin: ORIGEM },
) {
  const res = await entrarComoDiscipulador(
    { discipulador: nome, senha: senha(nome) },
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

/** As duas chaves de que o login do discipulador depende (D37): o login com senha padrão e o acesso do papel. */
async function ligar(
  chave: "acesso_celulas_senha" | "acesso_discipuladores",
  ligada: boolean,
): Promise<void> {
  await env.DB.prepare(`UPDATE campanhas SET ${chave} = ?1 WHERE ativa = 1`)
    .bind(ligada ? 1 : 0)
    .run();
}

beforeAll(async () => {
  await semearCenario();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await ligar("acesso_celulas_senha", true);
  await ligar("acesso_discipuladores", true);
});

// A trilha segura (RESTRICT) o usuário que aparece como autor: sem apagar as linhas do login, o próximo arquivo que
// limpa a hierarquia (com a cascata até o usuário do discipulador) seria recusado.
afterAll(async () => {
  await env.DB.prepare(
    "DELETE FROM auditoria WHERE acao = 'sessao.entrar_com_senha_discipulador'",
  ).run();
});

describe("RIFA-082: login certo abre a sessão do discipulador", () => {
  it("200 com o usuário do discipulador (o alvo dele), o cookie __Host-sessao com as flags e a sessão sem link, de 45 dias; a /minha mostra só as células dele", async () => {
    expect(
      await contar(
        "SELECT count(*) AS total FROM usuarios WHERE discipulador_id = ?1",
        ABEL.id,
      ),
    ).toBe(0);

    const res = await entrarComoDiscipulador({
      discipulador: ABEL.nome,
      senha: "@discipuladorabel1234",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const corpo = respostaSessaoSchema.parse(await res.json());
    // O discipulador não tinha usuário (nenhum link gerado): ele nasce com o nome do discipulador (como o lote).
    expect(corpo.usuario).toEqual({
      id: expect.any(Number),
      nome: ABEL.nome,
      papel: "discipulador",
      alvo: {
        tipo: "discipulador",
        id: ABEL.id,
        nome: ABEL.nome,
        divisao: "jovens",
      },
    });
    expect(
      await env.DB.prepare(
        "SELECT papel, discipulador_id, celula_id, rede_id, ativo FROM usuarios WHERE id = ?1",
      )
        .bind(corpo.usuario.id)
        .first(),
    ).toEqual({
      papel: "discipulador",
      discipulador_id: ABEL.id,
      celula_id: null,
      rede_id: null,
      ativo: 1,
    });

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

    // GET /api/sessao diz o mesmo; a /minha é a do discipulador, com só as células dele.
    const sessao = {
      Cookie: `${NOME_COOKIE_SESSAO}=${cookie.valor}`,
      Origin: ORIGEM,
    };
    const atual = await pedir("/api/sessao", sessao);
    expect(atual.status).toBe(200);
    expect(await atual.json()).toEqual(corpo);
    const visao = await pedir("/api/minha/visao", sessao);
    expect(visao.status).toBe(200);
    const corpoVisao = respostaVisaoIndividualSchema.parse(await visao.json());
    expect(corpoVisao.alvo).toMatchObject({
      tipo: "discipulador",
      id: ABEL.id,
    });
    expect(
      corpoVisao.equipe
        .filter((item) => item.tipo === "celula")
        .map((item) => item.id)
        .sort(),
    ).toEqual(celulasDe(ABEL.id).sort());
    const links = await pedir(
      ROTAS_LINK_VENDAS.meusLinksVendas.caminho,
      sessao,
    );
    expect(links.status).toBe(200);
    const corpoLinks = respostaMeusLinksVendasSchema.parse(await links.json());
    expect(corpoLinks.alvo).toMatchObject({
      tipo: "discipulador",
      id: ABEL.id,
    });
    expect(corpoLinks.itens.map((item) => item.celula_id).sort()).toEqual(
      celulasDe(ABEL.id).sort(),
    );
  });

  it("o nome e a senha toleram maiúsculas, acentos, pontuação e espaços (a mesma normalização)", async () => {
    for (const [discipulador, digitada] of [
      ["  discípulador BOAZ ", "@Discípulador Boaz 1234"],
      ["DISCIPULADOR-BOAZ", "  @discipuladorboaz1234  "],
      ["discipuladorboaz", "@DISCIPULADORBOAZ1234"],
    ]) {
      const res = await entrarComoDiscipulador({
        discipulador,
        senha: digitada,
      });
      expect({ discipulador, digitada, status: res.status }).toEqual({
        discipulador,
        digitada,
        status: 200,
      });
      const { usuario } = respostaSessaoSchema.parse(await res.json());
      expect(usuario.alvo?.id).toBe(BOAZ.id);
    }
    // Um usuário só por discipulador: os três logins abriram sessões do mesmo usuário.
    expect(
      await contar(
        "SELECT count(*) AS total FROM usuarios WHERE discipulador_id = ?1",
        BOAZ.id,
      ),
    ).toBe(1);
  });

  it("o discipulador que já tem o usuário do link entra com ele (o mesmo id), e o link continua valendo", async () => {
    const acesso = await criarAcessoDaHierarquiaNoBanco(
      "discipulador",
      CALEB.id,
    );
    const { res } = await entrarComo(CALEB.nome);
    const { usuario } = respostaSessaoSchema.parse(await res.json());
    expect(usuario.id).toBe(acesso.usuarioId);
    const peloLink = await exports.default.fetch(`${ORIGEM}/api/sessao`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGEM },
      body: JSON.stringify({ token: acesso.token }),
    });
    expect(peloLink.status).toBe(200);
  });

  it("o nome do usuário acompanha o do discipulador na hierarquia (como no lote de links)", async () => {
    const primeiro = await entrarComo(DAVI.nome);
    const { usuario } = respostaSessaoSchema.parse(await primeiro.res.json());
    expect(usuario.nome).toBe(DAVI.nome);
    await env.DB.prepare("UPDATE discipuladores SET nome = ?1 WHERE id = ?2")
      .bind("Davi Renomeado Fictício", DAVI.id)
      .run();
    try {
      const segundo = await entrarComo("Davi Renomeado Fictício");
      const depois = respostaSessaoSchema.parse(await segundo.res.json());
      expect(depois.usuario).toMatchObject({
        id: usuario.id,
        nome: "Davi Renomeado Fictício",
      });
      // O nome antigo não entra mais (a senha sai do nome de agora).
      expect(
        (
          await entrarComoDiscipulador({
            discipulador: DAVI.nome,
            senha: senha(DAVI.nome),
          })
        ).status,
      ).toBe(401);
    } finally {
      await env.DB.prepare("UPDATE discipuladores SET nome = ?1 WHERE id = ?2")
        .bind(DAVI.nome, DAVI.id)
        .run();
    }
  });

  it("entrar de novo no mesmo navegador encerra a sessão anterior dele; Sair encerra a sessão da senha", async () => {
    const primeira = await entrarComo(ABEL.nome);
    const segunda = await entrarComo(ABEL.nome, primeira.sessao);
    expect(segunda.cookie).not.toBe(primeira.cookie);
    expect((await pedir("/api/sessao", primeira.sessao)).status).toBe(401);
    expect((await pedir("/api/sessao", segunda.sessao)).status).toBe(200);
    expect(
      (await pedir("/api/sessao/sair", segunda.sessao, "POST")).status,
    ).toBe(204);
    expect((await pedir("/api/sessao", segunda.sessao)).status).toBe(401);
  });
});

describe("RIFA-082: toda recusa é a MESMA resposta (não diz se o discipulador existe)", () => {
  /** Status, cabeçalhos e corpo que o cliente vê, para comparar as recusas entre si. */
  async function recusa(res: Response) {
    return {
      status: res.status,
      cookie: res.headers.get("Set-Cookie"),
      cacheControl: res.headers.get("Cache-Control"),
      corpo: await res.text(),
    };
  }

  it("senha errada, nome desconhecido, campos vazios, sem o '@', colisão, nome sem letra, usuário desativado e cada uma das duas chaves desligada", async () => {
    // Colisão: dois discipuladores que ficam iguais na normalização (a coordenação vê o aviso na Hierarquia); e um
    // nome sem letra nem dígito (não tem senha).
    await env.DB.prepare(
      `INSERT INTO discipuladores (id, rede_id, nome)
       VALUES (60, 1, 'Fábio Fictício'), (61, 2, 'Fabio Ficticio'), (62, 2, '...')`,
    ).run();
    // Usuário do discipulador desativado pelo admin (D12): nem o link nem a senha entram.
    const caleb = await criarAcessoDaHierarquiaNoBanco(
      "discipulador",
      CALEB.id,
    );
    expect(await definirAtivo(env.DB, caleb.usuarioId, false)).toBe("ok");

    const usuariosAntes = await contar(
      "SELECT count(*) AS total FROM usuarios",
    );
    const sessoesAntes = await contar("SELECT count(*) AS total FROM sessoes");
    const trilhaAntes = await contar("SELECT count(*) AS total FROM auditoria");

    const comAChave =
      (chave: "acesso_celulas_senha" | "acesso_discipuladores") => async () => {
        await ligar(chave, false);
        try {
          return await entrarComoDiscipulador({
            discipulador: ABEL.nome,
            senha: senha(ABEL.nome),
          });
        } finally {
          await ligar(chave, true);
        }
      };
    const casos: [string, () => Promise<Response>][] = [
      [
        "senha errada",
        () =>
          entrarComoDiscipulador({
            discipulador: ABEL.nome,
            senha: "@discipuladorabel4321",
          }),
      ],
      [
        "senha de outro discipulador",
        () =>
          entrarComoDiscipulador({
            discipulador: ABEL.nome,
            senha: senha(BOAZ.nome),
          }),
      ],
      [
        "sem o @",
        () =>
          entrarComoDiscipulador({
            discipulador: ABEL.nome,
            senha: "discipuladorabel1234",
          }),
      ],
      [
        "nome desconhecido",
        () =>
          entrarComoDiscipulador({
            discipulador: "Discipulador Inexistente",
            senha: "@discipuladorinexistente1234",
          }),
      ],
      [
        "nome de célula (não de discipulador)",
        () =>
          entrarComoDiscipulador({
            discipulador: CELULAS[0].nome,
            senha: "@celulaagape1234",
          }),
      ],
      [
        "campos vazios",
        () => entrarComoDiscipulador({ discipulador: "", senha: "" }),
      ],
      [
        "nome sem letra nem dígito",
        () => entrarComoDiscipulador({ discipulador: "...", senha: "@1234" }),
      ],
      [
        "colisão (Fábio Fictício)",
        () =>
          entrarComoDiscipulador({
            discipulador: "Fábio Fictício",
            senha: "@fabioficticio1234",
          }),
      ],
      [
        "colisão (Fabio Ficticio)",
        () =>
          entrarComoDiscipulador({
            discipulador: "Fabio Ficticio",
            senha: "@fabioficticio1234",
          }),
      ],
      [
        "usuário do discipulador desativado",
        () =>
          entrarComoDiscipulador({
            discipulador: CALEB.nome,
            senha: senha(CALEB.nome),
          }),
      ],
      [
        "login com senha padrão desligado (acesso.celulas_senha)",
        comAChave("acesso_celulas_senha"),
      ],
      [
        "acesso dos discipuladores desligado (acesso.discipuladores)",
        comAChave("acesso_discipuladores"),
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
        mensagem: "Não foi possível entrar com este discipulador e esta senha",
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
    // Com as chaves ligadas, a mesma senha entra (a recusa era só a chave).
    expect(
      (
        await entrarComoDiscipulador({
          discipulador: ABEL.nome,
          senha: senha(ABEL.nome),
        })
      ).status,
    ).toBe(200);

    await definirAtivo(env.DB, caleb.usuarioId, true);
    await env.DB.prepare(
      "DELETE FROM discipuladores WHERE id IN (60, 61, 62)",
    ).run();
  });

  it("corpo fora do contrato: 400 sem campo, com campo a mais ou com campo longo; 413 acima de 4 KiB; JSON quebrado 400", async () => {
    for (const corpo of [
      {},
      { discipulador: ABEL.nome },
      { senha: senha(ABEL.nome) },
      { discipulador: 1, senha: "@x1234" },
      { discipulador: "x".repeat(201), senha: "@x1234" },
      { discipulador: ABEL.nome, senha: senha(ABEL.nome), celula: "x" },
    ]) {
      const res = await entrarComoDiscipulador(corpo);
      expect({ corpo, status: res.status }).toEqual({ corpo, status: 400 });
      expect(cookieDaResposta(res)).toBeNull();
    }
    const quebrado = await entrarComoDiscipulador("{discipulador:");
    expect(quebrado.status).toBe(400);
    const grande = await entrarComoDiscipulador({
      discipulador: ABEL.nome,
      senha: senha(ABEL.nome),
      sobra: "x".repeat(5000),
    });
    expect(grande.status).toBe(413);
  });
});

describe("RIFA-082: as duas chaves (acesso.celulas_senha e acesso.discipuladores)", () => {
  it.each([
    ["acesso_celulas_senha", 200],
    ["acesso_discipuladores", 403],
  ] as const)(
    "%s desligada: a sessão do discipulador aberta pela senha cai (401, cookie expirado); a do link fica (/minha: %i); religada, a da senha volta",
    async (chave, statusDoLink) => {
      const { sessao } = await entrarComo(ABEL.nome);
      const peloLink = await cabecalhosDeSessaoDaHierarquia(
        "discipulador",
        BOAZ.id,
      );
      expect((await pedir("/api/minha/visao", sessao)).status).toBe(200);

      await ligar(chave, false);
      for (const caminho of [
        "/api/sessao",
        "/api/minha/visao",
        ROTAS_LINK_VENDAS.meusLinksVendas.caminho,
      ]) {
        const res = await pedir(caminho, sessao);
        expect({ caminho, status: res.status }).toEqual({
          caminho,
          status: 401,
        });
        expect(cookieDaResposta(res)?.atributos).toContain("Max-Age=0");
      }
      // A sessão do link não depende do login por senha: com o acesso dos discipuladores desligado, ela leva o 403
      // `acesso_desligado` da D20 (não é apagada); com só o login por senha desligado, nada muda para ela.
      expect((await pedir("/api/sessao", peloLink)).status).toBe(200);
      const peloLinkNaMinha = await pedir("/api/minha/visao", peloLink);
      expect(peloLinkNaMinha.status).toBe(statusDoLink);

      await ligar(chave, true);
      expect((await pedir("/api/minha/visao", sessao)).status).toBe(200);
    },
  );

  it("sem campanha ativa vale o padrão (as duas ligadas)", async () => {
    await env.DB.prepare(
      "UPDATE campanhas SET ativa = 0 WHERE ativa = 1",
    ).run();
    try {
      const { sessao } = await entrarComo(BOAZ.nome);
      expect((await pedir("/api/sessao", sessao)).status).toBe(200);
    } finally {
      await env.DB.prepare(
        "UPDATE campanhas SET ativa = 1 WHERE id = (SELECT min(id) FROM campanhas WHERE slug_rifei = 'rifa-videira-kids-teste')",
      ).run();
    }
  });

  it("desativar o usuário do discipulador derruba a sessão aberta pela senha", async () => {
    const { res, sessao } = await entrarComo(BOAZ.nome);
    const { usuario } = respostaSessaoSchema.parse(await res.json());
    expect(await definirAtivo(env.DB, usuario.id, false)).toBe("ok");
    try {
      expect((await pedir("/api/sessao", sessao)).status).toBe(401);
    } finally {
      await definirAtivo(env.DB, usuario.id, true);
    }
  });
});

describe("RIFA-082: CSRF, como todo POST da sessão", () => {
  it("de outra origem ou sem Origin nem Sec-Fetch-Site: 403, sem sessão e sem usuário novo; Sec-Fetch-Site same-origin passa", async () => {
    const usuarios = await contar("SELECT count(*) AS total FROM usuarios");
    const sessoes = await contar("SELECT count(*) AS total FROM sessoes");
    const corpo = { discipulador: ABEL.nome, senha: senha(ABEL.nome) };
    for (const cabecalhos of [
      { Origin: ORIGEM_MALICIOSA },
      {},
      { "Sec-Fetch-Site": "cross-site" },
      { Origin: ORIGEM_MALICIOSA, "Sec-Fetch-Site": "cross-site" },
    ] as Record<string, string>[]) {
      const res = await entrarComoDiscipulador(corpo, cabecalhos);
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
    expect(await contar("SELECT count(*) AS total FROM sessoes")).toBe(sessoes);
    const mesmaOrigem = await entrarComoDiscipulador(corpo, {
      "Sec-Fetch-Site": "same-origin",
    });
    expect(mesmaOrigem.status).toBe(200);
  });
});

describe("RIFA-082: a trilha registra o login por senha, e a senha não fica em lugar nenhum", () => {
  it("uma linha por login, do usuário do discipulador, alvo discipulador:<id>, sem a senha; recusa não registra", async () => {
    const antes = await contar(
      "SELECT count(*) AS total FROM auditoria WHERE acao = 'sessao.entrar_com_senha_discipulador'",
    );
    const { res } = await entrarComo(ABEL.nome);
    const { usuario } = respostaSessaoSchema.parse(await res.json());
    await entrarComoDiscipulador({
      discipulador: ABEL.nome,
      senha: "@errada1234",
    });

    const { results } = await env.DB.prepare(
      `SELECT usuario_id, em, acao, alvo, resumo FROM auditoria
       WHERE acao = 'sessao.entrar_com_senha_discipulador' ORDER BY id DESC`,
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
      acao: "sessao.entrar_com_senha_discipulador",
      alvo: `discipulador:${ABEL.id}`,
      resumo: expect.any(String),
    });
    for (const texto of [senha(ABEL.nome), "1234", "discipuladorabel"])
      expect(results[0].resumo).not.toContain(texto);
  });

  it("a senha (digitada e derivada) não está em nenhuma tabela nem em nenhum log", async () => {
    const digitada = "@Pr. Únicó Fictício 1234";
    // Um discipulador só para este teste, com um nome que não aparece em nenhum outro lugar.
    await env.DB.prepare(
      "INSERT INTO discipuladores (id, rede_id, nome) VALUES (70, 2, 'Pr. Únicó Fictício')",
    ).run();
    const logs: string[] = [];
    for (const nivel of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, nivel).mockImplementation((...partes: unknown[]) => {
        logs.push(partes.map((parte) => String(parte)).join(" "));
      });

    const certo = await entrarComoDiscipulador({
      discipulador: "Pr. Únicó Fictício",
      senha: digitada,
    });
    expect(certo.status).toBe(200);
    const errado = await entrarComoDiscipulador({
      discipulador: "Pr. Únicó Fictício",
      senha: "@prunicoficticio9999",
    });
    expect(errado.status).toBe(401);

    const procuradas = [
      digitada,
      senhaPadraoDoDiscipulador("Pr. Únicó Fictício")!,
      "@prunicoficticio9999",
      "prunicoficticio1234",
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

describe("RIFA-082: a sessão do discipulador fica só na /minha dele", () => {
  it("403 na coordenação; a /minha não aceita outra célula nem outro discipulador (o alvo vem só da sessão)", async () => {
    const { sessao } = await entrarComo(ABEL.nome);
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
    const daOutra = CELULAS.find(
      (celula) => celula.discipulador_id === CALEB.id,
    )!;
    const links = await pedir(
      `${ROTAS_LINK_VENDAS.meusLinksVendas.caminho}?celula_id=${daOutra.id}&discipulador_id=${CALEB.id}`,
      sessao,
    );
    expect(links.status).toBe(200);
    const corpo = respostaMeusLinksVendasSchema.parse(await links.json());
    expect(corpo.alvo).toMatchObject({ tipo: "discipulador", id: ABEL.id });
    expect(corpo.itens.map((item) => item.celula_id).sort()).toEqual(
      celulasDe(ABEL.id).sort(),
    );
    expect(JSON.stringify(corpo)).not.toContain(daOutra.nome);
  });
});
