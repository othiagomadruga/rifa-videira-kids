// RIFA-039 (D21, OBRIGATÓRIO 4 a 7): GET e POST /api/admin/webhook/token no app real, com o D1 local. Só admin (403
// da coordenação antes do corpo, da hierarquia; 401 sem sessão); o 409 `em_uso` sem `substituir`; a trilha (quem e
// quando, sem o token); o anterior recusado logo depois de gerar outro; e a varredura: o token não fica em nenhuma
// tabela. O D1 é deste arquivo: o beforeEach apaga a linha do token, a trilha e as entregas.
import { env, exports } from "cloudflare:workers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import newOrderAfiliado from "../../../test/fixtures/rifei/new_order.afiliado.json";
import {
  BYTES_TOKEN_WEBHOOK,
  FORMATO_TOKEN_WEBHOOK,
  NOME_COOKIE_SESSAO,
  ROTAS_TOKEN_WEBHOOK,
  detalhesTokenWebhookEmUsoSchema,
  erroApiSchema,
  estadoTokenWebhookSchema,
  respostaAuditoriaSchema,
  respostaGerarTokenWebhookSchema,
  type PapelHierarquia,
} from "../../shared/contracts";
import { criarSessao } from "../db/acessos";
import {
  LER_GERADO_EM_TOKEN_WEBHOOK,
  LER_HASH_TOKEN_WEBHOOK,
} from "../db/token-webhook";
import app from "../index";
import { gerarSegredo, sha256Hex } from "../lib/cripto";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
  criarAcessoNoBanco,
} from "../test/acesso-teste";
import { bancoQueRegistra } from "../test/banco-que-registra";

const db = env.DB;
const CAMINHO = ROTAS_TOKEN_WEBHOOK.obterTokenWebhook.caminho;
const SEGREDO = env.RIFEI_WEBHOOK_TOKEN ?? "";
const URL_DO_WEBHOOK = `${ORIGEM}/api/webhooks/rifei`;
const HEX_64 = /[0-9a-f]{64}/;

// ---------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------

interface OpcoesRequisicao {
  cabecalhos?: Record<string, string>;
  /** Corpo do POST (objeto vira JSON; texto vai cru). Padrão: {}. */
  corpo?: unknown;
  /** Bindings trocados: a requisição vai direto ao app Hono com este env. */
  env?: Partial<Cloudflare.Env>;
  /** Origem da URL (o Origin do cabeçalho vem da sessão). */
  origem?: string;
}

function requisitar(
  metodo: "GET" | "POST",
  caminho: string,
  opcoes: OpcoesRequisicao = {},
): Promise<Response> {
  const headers = new Headers(opcoes.cabecalhos);
  let body: string | undefined;
  if (metodo === "POST") {
    headers.set("Content-Type", "application/json");
    const corpo = opcoes.corpo ?? {};
    body = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  }
  const url = `${opcoes.origem ?? ORIGEM}${caminho}`;
  const init = { method: metodo, headers, body };
  if (opcoes.env)
    return Promise.resolve(app.request(url, init, { ...env, ...opcoes.env }));
  return exports.default.fetch(url, init);
}

const obter = (opcoes?: OpcoesRequisicao) => requisitar("GET", CAMINHO, opcoes);
const gerar = (opcoes?: OpcoesRequisicao) =>
  requisitar("POST", CAMINHO, opcoes);

/** Uma entrega da fixture (sem campanha ativa neste arquivo: 200 ignorado_outra_campanha, gravada). */
function entregar(token: string): Promise<Response> {
  return exports.default.fetch(`${ORIGEM}/api/webhooks/rifei`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(newOrderAfiliado),
  });
}

async function linhaDoToken() {
  return (
    await db
      .prepare("SELECT id, token_hash, gerado_em FROM token_webhook")
      .all<{ id: number; token_hash: string; gerado_em: string }>()
  ).results;
}

async function trilha() {
  return (
    await db
      .prepare(
        "SELECT usuario_id, em, acao, alvo, resumo FROM auditoria WHERE acao = 'webhook.gerar_token' ORDER BY id",
      )
      .all<{
        usuario_id: number;
        em: string;
        acao: string;
        alvo: string;
        resumo: string;
      }>()
  ).results;
}

async function esperarErro(res: Response, status: number, codigo: string) {
  expect({ status: res.status, corpo: await res.json() }).toEqual({
    status,
    corpo: { erro: { codigo, mensagem: expect.any(String) } },
  });
}

/** 201 no contrato, com `no-store`: devolve o token e o estado. */
async function esperarGerado(res: Response) {
  expect(res.status).toBe(201);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const corpo = respostaGerarTokenWebhookSchema.parse(await res.json());
  expect(corpo.token).toMatch(FORMATO_TOKEN_WEBHOOK);
  return corpo;
}

/** 409 em_uso no contrato: devolve o `vigente` do detalhe. */
async function esperarEmUso(res: Response) {
  expect(res.status).toBe(409);
  const corpo = erroApiSchema.parse(await res.json());
  expect(corpo.erro.codigo).toBe("em_uso");
  return detalhesTokenWebhookEmUsoSchema.parse(corpo.erro.detalhes).vigente;
}

let admin: Record<string, string>;
let adminId: number;
let coordenacao: Record<string, string>;
const hierarquia = {} as Record<PapelHierarquia, Record<string, string>>;

beforeAll(async () => {
  // O admin com o id conhecido, para conferir o autor na trilha.
  const acessoAdmin = await criarAcessoNoBanco("admin");
  adminId = acessoAdmin.usuarioId;
  admin = await cabecalhosDoLink(acessoAdmin.linkId);
  coordenacao = await cabecalhosDeSessao("coordenacao");
  // Uma rede, um discipulador e uma célula para as sessões da hierarquia.
  await db.batch([
    db.prepare(
      "INSERT INTO redes (id, nome, divisao) VALUES (1, 'Rede do Token', 'jovens')",
    ),
    db.prepare(
      "INSERT INTO discipuladores (id, rede_id, nome) VALUES (10, 1, 'Discipulador do Token')",
    ),
    db.prepare(
      `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
       VALUES (100, 10, 'Celula do Token', 8, 'Lider do Token')`,
    ),
  ]);
  hierarquia.lider = await cabecalhosDeSessaoDaHierarquia("lider", 100);
  hierarquia.discipulador = await cabecalhosDeSessaoDaHierarquia(
    "discipulador",
    10,
  );
  hierarquia.rede = await cabecalhosDeSessaoDaHierarquia("rede", 1);
});

/** Uma sessão aberta direto no banco para o link dado (como cabecalhosDeSessao, com o usuário conhecido). */
async function cabecalhosDoLink(linkId: number) {
  const idSessao = gerarSegredo();
  const agora = Date.now();
  await criarSessao(db, {
    idHash: await sha256Hex(idSessao),
    linkId,
    criadoEm: new Date(agora).toISOString(),
    expiraEm: new Date(agora + 24 * 60 * 60 * 1000).toISOString(),
    idHashAnterior: null,
  });
  return { Cookie: `${NOME_COOKIE_SESSAO}=${idSessao}`, Origin: ORIGEM };
}

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM token_webhook"),
    db.prepare("DELETE FROM auditoria"),
    db.prepare("DELETE FROM webhook_eventos"),
    db.prepare("DELETE FROM pedidos"),
    db.prepare("DELETE FROM afiliados"),
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.prepare("DELETE FROM token_webhook").run();
});

// ---------------------------------------------------------------------------------------------------
// CA5: só admin
// ---------------------------------------------------------------------------------------------------

describe("CA5: só admin (D21, OBRIGATÓRIO 4)", () => {
  it("sem sessão: 401 no GET e no POST", async () => {
    await esperarErro(await obter(), 401, "nao_autenticado");
    await esperarErro(
      await gerar({ cabecalhos: { Origin: ORIGEM } }),
      401,
      "nao_autenticado",
    );
    expect(await linhaDoToken()).toEqual([]);
  });

  it("coordenação: 403 no GET e no POST, ANTES do corpo (corpo inválido, JSON quebrado, com e sem substituir, com credencial vigente), e nada muda", async () => {
    await esperarErro(
      await obter({ cabecalhos: coordenacao }),
      403,
      "proibido",
    );
    for (const corpo of [
      {},
      { substituir: true },
      { substituir: "sim" },
      { outro: 1 },
      "isto não é json",
    ])
      await esperarErro(
        await gerar({ cabecalhos: coordenacao, corpo }),
        403,
        "proibido",
      );
    // Sem credencial vigente também (sem o segredo do Worker, o POST do admin geraria).
    await esperarErro(
      await gerar({
        cabecalhos: coordenacao,
        env: { RIFEI_WEBHOOK_TOKEN: undefined },
      }),
      403,
      "proibido",
    );
    expect(await linhaDoToken()).toEqual([]);
    expect(await trilha()).toEqual([]);
  });

  it.each(["lider", "discipulador", "rede"] as const)(
    "%s: 403 no GET e no POST, e nada muda",
    async (papel) => {
      await esperarErro(
        await obter({ cabecalhos: hierarquia[papel] }),
        403,
        "proibido",
      );
      await esperarErro(
        await gerar({
          cabecalhos: hierarquia[papel],
          corpo: { substituir: true },
        }),
        403,
        "proibido",
      );
      expect(await linhaDoToken()).toEqual([]);
    },
  );

  it("o 'só admin' é só destas duas: as entregas e o estado do webhook continuam da coordenação", async () => {
    for (const caminho of [
      "/api/admin/webhook/entregas",
      "/api/admin/webhook/estado",
    ]) {
      const res = await requisitar("GET", caminho, { cabecalhos: coordenacao });
      expect({ caminho, status: res.status }).toEqual({ caminho, status: 200 });
    }
  });

  it("admin: o GET no schema estrito, com no-store, nunca traz o token nem o hash", async () => {
    const { token } = await esperarGerado(
      await gerar({ cabecalhos: admin, corpo: { substituir: true } }),
    );
    const hash = await sha256Hex(token);

    const res = await obter({ cabecalhos: admin });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const texto = await res.text();
    const estado = estadoTokenWebhookSchema.parse(JSON.parse(texto));
    expect(Object.keys(estado).sort()).toEqual([
      "gerado_em",
      "segredo_configurado",
      "ultimo_uso_em",
      "url",
      "vigente",
    ]);
    expect(texto).not.toContain(token);
    expect(texto).not.toContain(hash);
    expect(texto).not.toMatch(HEX_64);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA6: 409 em_uso sem substituir; a trilha com quem e quando, sem o token
// ---------------------------------------------------------------------------------------------------

describe("CA6: 409 em_uso e a trilha (D21, OBRIGATÓRIO 5)", () => {
  it("com o segredo do Worker vigente e sem substituir: 409 em_uso { vigente: 'segredo' }, nada muda e a trilha não registra", async () => {
    for (const corpo of [{}, { substituir: false }])
      expect(
        await esperarEmUso(await gerar({ cabecalhos: admin, corpo })),
      ).toBe("segredo");
    expect(await linhaDoToken()).toEqual([]);
    expect(await trilha()).toEqual([]);
  });

  it("com substituir: 201 { token, estado }, a linha e a trilha (o admin, o instante do gerado_em, o segredo que deixou de valer), sem o token", async () => {
    const antes = new Date().toISOString();
    const { token, estado } = await esperarGerado(
      await gerar({ cabecalhos: admin, corpo: { substituir: true } }),
    );

    expect(estado).toEqual({
      vigente: "tela",
      gerado_em: expect.any(String),
      ultimo_uso_em: null,
      segredo_configurado: true,
      url: URL_DO_WEBHOOK,
    });
    expect(estado.gerado_em! >= antes).toBe(true);
    expect(await linhaDoToken()).toEqual([
      {
        id: 1,
        token_hash: await sha256Hex(token),
        gerado_em: estado.gerado_em,
      },
    ]);
    expect(await trilha()).toEqual([
      {
        usuario_id: adminId,
        em: estado.gerado_em,
        acao: "webhook.gerar_token",
        alvo: "webhook",
        resumo:
          "Token do webhook gerado pela tela; o segredo do Worker deixou de valer",
      },
    ]);
  });

  it("com o token da tela vigente e sem substituir: 409 em_uso { vigente: 'tela' }, o token continua e a trilha não registra; com substituir, a trilha diz o gerado_em do anterior", async () => {
    const primeiro = await esperarGerado(
      await gerar({ cabecalhos: admin, corpo: { substituir: true } }),
    );

    expect(await esperarEmUso(await gerar({ cabecalhos: admin }))).toBe("tela");
    expect(await linhaDoToken()).toEqual([
      {
        id: 1,
        token_hash: await sha256Hex(primeiro.token),
        gerado_em: primeiro.estado.gerado_em,
      },
    ]);
    expect(await trilha()).toHaveLength(1);

    const segundo = await esperarGerado(
      await gerar({ cabecalhos: admin, corpo: { substituir: true } }),
    );
    expect(segundo.token).not.toBe(primeiro.token);
    expect((await trilha()).map((linha) => linha.resumo)).toEqual([
      "Token do webhook gerado pela tela; o segredo do Worker deixou de valer",
      `Token do webhook gerado pela tela; o token anterior, gerado em ${primeiro.estado.gerado_em}, deixou de valer`,
    ]);
  });

  it("sem nenhuma credencial: gera sem substituir (201, 'não havia credencial'); substituir não importa", async () => {
    const semSegredo = { RIFEI_WEBHOOK_TOKEN: undefined };
    const { estado } = await esperarGerado(
      await gerar({ cabecalhos: admin, env: semSegredo }),
    );
    expect(estado).toMatchObject({
      vigente: "tela",
      ultimo_uso_em: null,
      segredo_configurado: false,
    });
    await db.prepare("DELETE FROM token_webhook").run();
    await esperarGerado(
      await gerar({
        cabecalhos: admin,
        corpo: { substituir: true },
        env: semSegredo,
      }),
    );
    expect((await trilha()).map((linha) => linha.resumo)).toEqual([
      "Token do webhook gerado pela tela; não havia credencial",
      "Token do webhook gerado pela tela; não havia credencial",
    ]);
  });

  it("outra aba gerou entre a leitura e o lote (sem substituir): 409 em_uso { vigente: 'tela' }, o token dela continua e a trilha não registra", async () => {
    const daOutraAba = await esperarGerado(
      await gerar({ cabecalhos: admin, corpo: { substituir: true } }),
    );
    // A leitura da rota ainda não vê a linha (como se a outra aba gravasse logo depois dela).
    const atrasado = new Proxy(db, {
      get(alvo, nome) {
        if (nome === "prepare")
          return (sql: string) =>
            sql === LER_GERADO_EM_TOKEN_WEBHOOK
              ? alvo.prepare(
                  "SELECT gerado_em FROM token_webhook WHERE id = 1 AND 0",
                )
              : alvo.prepare(sql);
        const valor: unknown = Reflect.get(alvo, nome, alvo);
        return typeof valor === "function"
          ? (...args: unknown[]) => Reflect.apply(valor, alvo, args)
          : valor;
      },
    });

    expect(
      await esperarEmUso(
        await gerar({
          cabecalhos: admin,
          env: { DB: atrasado, RIFEI_WEBHOOK_TOKEN: undefined },
        }),
      ),
    ).toBe("tela");
    expect(await linhaDoToken()).toEqual([
      {
        id: 1,
        token_hash: await sha256Hex(daOutraAba.token),
        gerado_em: daOutraAba.estado.gerado_em,
      },
    ]);
    expect(await trilha()).toHaveLength(1);
  });

  it("corpo inválido do admin: 400 e nada muda", async () => {
    for (const corpo of [{ substituir: "sim" }, { outro: 1 }, []]) {
      const res = await gerar({ cabecalhos: admin, corpo });
      expect({
        status: res.status,
        codigo: erroApiSchema.parse(await res.json()).erro.codigo,
      }).toEqual({ status: 400, codigo: "requisicao_invalida" });
    }
    await esperarErro(
      await gerar({ cabecalhos: admin, corpo: "isto não é json" }),
      400,
      "json_invalido",
    );
    expect(await linhaDoToken()).toEqual([]);
    expect(await trilha()).toEqual([]);
  });

  it("o POST lê a linha do token 1 vez (sem o hash) e grava a trilha e o token num lote; o GET lê a linha (sem o hash) e a última entrega", async () => {
    const { db: registrado, comandos } = bancoQueRegistra();
    await esperarGerado(
      await gerar({
        cabecalhos: admin,
        corpo: { substituir: true },
        env: { DB: registrado },
      }),
    );
    const doToken = comandos.filter((comando) =>
      /token_webhook/.test(comando.sql),
    );
    expect(
      doToken.map((comando) => comando.sql.split(/\s+/).slice(0, 3).join(" ")),
    ).toEqual([
      "SELECT gerado_em FROM",
      "INSERT INTO auditoria",
      "INSERT INTO token_webhook",
    ]);
    expect(doToken[0].lidas).toBe(1);
    expect(
      comandos.some((comando) => comando.sql === LER_HASH_TOKEN_WEBHOOK),
    ).toBe(false);

    comandos.length = 0;
    expect(
      (await obter({ cabecalhos: admin, env: { DB: registrado } })).status,
    ).toBe(200);
    const leituraDoToken = comandos.filter((comando) =>
      /token_webhook/.test(comando.sql),
    );
    expect(leituraDoToken).toEqual([
      { sql: LER_GERADO_EM_TOKEN_WEBHOOK, lidas: 1, escritas: 0 },
    ]);
    expect(comandos.some((comando) => /token_hash/.test(comando.sql))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------------------------------
// CA2: o anterior é recusado logo depois de gerar outro (sem cache)
// ---------------------------------------------------------------------------------------------------

describe("CA2: gerar de novo invalida o anterior na hora (D21)", () => {
  it("o token gerado vale; depois de gerar outro com substituir, o anterior leva 401 e só o novo vale (o segredo também não)", async () => {
    const primeiro = await esperarGerado(
      await gerar({ cabecalhos: admin, corpo: { substituir: true } }),
    );
    expect((await entregar(primeiro.token)).status).toBe(200);
    expect((await entregar(SEGREDO)).status).toBe(401);

    const segundo = await esperarGerado(
      await gerar({ cabecalhos: admin, corpo: { substituir: true } }),
    );

    expect((await entregar(primeiro.token)).status).toBe(401);
    expect((await entregar(segundo.token)).status).toBe(200);
    expect((await entregar(SEGREDO)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------------
// GET: o estado e o último uso
// ---------------------------------------------------------------------------------------------------

describe("GET: o estado do token (ultimoUsoDoWebhook)", () => {
  const recebidas = async () =>
    (
      await db
        .prepare("SELECT recebido_em FROM webhook_eventos ORDER BY id")
        .all<{ recebido_em: string }>()
    ).results.map((linha) => linha.recebido_em);

  it("sem nenhuma credencial: vigente null e sem último uso; com o segredo: a última entrega", async () => {
    const semNada = estadoTokenWebhookSchema.parse(
      await (
        await obter({
          cabecalhos: admin,
          env: { RIFEI_WEBHOOK_TOKEN: undefined },
        })
      ).json(),
    );
    expect(semNada).toEqual({
      vigente: null,
      gerado_em: null,
      ultimo_uso_em: null,
      segredo_configurado: false,
      url: URL_DO_WEBHOOK,
    });

    expect(
      estadoTokenWebhookSchema.parse(
        await (await obter({ cabecalhos: admin })).json(),
      ),
    ).toMatchObject({ vigente: "segredo", ultimo_uso_em: null });
    expect((await entregar(SEGREDO)).status).toBe(200);
    expect(
      estadoTokenWebhookSchema.parse(
        await (await obter({ cabecalhos: admin })).json(),
      ),
    ).toEqual({
      vigente: "segredo",
      gerado_em: null,
      ultimo_uso_em: (await recebidas()).at(-1),
      segredo_configurado: true,
      url: URL_DO_WEBHOOK,
    });
  });

  it("com o token da tela: 'ainda não usado' até a primeira entrega com ele (as do segredo, antes, não contam)", async () => {
    expect((await entregar(SEGREDO)).status).toBe(200);
    const { token, estado: gerado } = await esperarGerado(
      await gerar({ cabecalhos: admin, corpo: { substituir: true } }),
    );

    const antesDeUsar = estadoTokenWebhookSchema.parse(
      await (await obter({ cabecalhos: admin })).json(),
    );
    expect(antesDeUsar).toEqual(gerado);

    expect((await entregar(token)).status).toBe(200);
    const depois = estadoTokenWebhookSchema.parse(
      await (await obter({ cabecalhos: admin })).json(),
    );
    expect(depois).toEqual({
      ...gerado,
      ultimo_uso_em: (await recebidas()).at(-1),
    });
  });

  it("a url sai da origem da requisição", async () => {
    const res = await obter({
      cabecalhos: admin,
      origem: "https://rifa.example",
    });
    expect(estadoTokenWebhookSchema.parse(await res.json()).url).toBe(
      "https://rifa.example/api/webhooks/rifei",
    );
  });
});

// ---------------------------------------------------------------------------------------------------
// O token fora do log; a gravação que falha descarta o token sem mostrá-lo (D21, Segurança)
// ---------------------------------------------------------------------------------------------------

describe("o token gerado fora do log e de qualquer resposta que não seja a 201 (D21)", () => {
  /** Os tokens que a rota gerou: cada crypto.getRandomValues de BYTES_TOKEN_WEBHOOK bytes, em hex. */
  function capturarTokensGerados(): string[] {
    const gerados: string[] = [];
    const original = crypto.getRandomValues.bind(crypto);
    vi.spyOn(crypto, "getRandomValues").mockImplementation((destino) => {
      const bytes = original(destino);
      if (bytes instanceof Uint8Array && bytes.length === BYTES_TOKEN_WEBHOOK)
        gerados.push(
          Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
            "",
          ),
        );
      return bytes;
    });
    return gerados;
  }

  const espionarConsole = () =>
    (["log", "info", "warn", "error", "debug"] as const).map((metodo) =>
      vi.spyOn(console, metodo).mockImplementation(() => {}),
    );

  /** O que foi para o console, com a mensagem e a pilha dos Error por extenso (o JSON.stringify de um Error dá "{}"). */
  const textoDoConsole = (chamadas: ReturnType<typeof espionarConsole>) =>
    JSON.stringify(
      chamadas.map((chamada) => chamada.mock.calls),
      (_chave, valor: unknown) =>
        valor instanceof Error ? `${valor.message} ${valor.stack}` : valor,
    );

  it("201: nada do token nem do hash no console", async () => {
    const gerados = capturarTokensGerados();
    const chamadas = espionarConsole();

    const { token } = await esperarGerado(
      await gerar({ cabecalhos: admin, corpo: { substituir: true }, env: {} }),
    );

    expect(gerados).toEqual([token]);
    const texto = textoDoConsole(chamadas);
    for (const segredo of [token, await sha256Hex(token)])
      expect(texto).not.toContain(segredo);
  });

  it("a gravação falha depois de gerar o token: 500 erro_interno, nada muda (nem a trilha), e o token não sai na resposta nem no log", async () => {
    const semSegredo = { RIFEI_WEBHOOK_TOKEN: undefined };
    const gerados = capturarTokensGerados();
    const chamadas = espionarConsole();
    const anterior = await esperarGerado(
      await gerar({ cabecalhos: admin, env: semSegredo }),
    );
    const linhaAnterior = await linhaDoToken();
    // Um erro do D1 dentro do lote, depois de o token ser gerado: no UPSERT sobre o anterior e no INSERT sem linha.
    const falhar = (evento: string) =>
      db.prepare(
        `CREATE TRIGGER falha_token_${evento.toLowerCase()} BEFORE ${evento} ON token_webhook
         BEGIN SELECT RAISE(ABORT, 'falha simulada ao gravar token_webhook'); END`,
      );
    await db.batch([falhar("INSERT"), falhar("UPDATE")]);
    const respostas: string[] = [];
    const esperarFalha = async (res: Response) => {
      const texto = await res.text();
      respostas.push(texto);
      expect({ status: res.status, corpo: JSON.parse(texto) }).toEqual({
        status: 500,
        corpo: { erro: { codigo: "erro_interno", mensagem: "Erro interno" } },
      });
    };
    try {
      // Com o anterior e `substituir`: o anterior continua valendo, e só ele.
      await esperarFalha(
        await gerar({
          cabecalhos: admin,
          corpo: { substituir: true },
          env: semSegredo,
        }),
      );
      expect(await linhaDoToken()).toEqual(linhaAnterior);
      // Sem credencial (a linha apagada): continua sem linha.
      await db.prepare("DELETE FROM token_webhook").run();
      await esperarFalha(await gerar({ cabecalhos: admin, env: semSegredo }));
      expect(await linhaDoToken()).toEqual([]);
    } finally {
      await db.batch([
        db.prepare("DROP TRIGGER falha_token_insert"),
        db.prepare("DROP TRIGGER falha_token_update"),
      ]);
    }

    // Os tokens das duas falhas foram gerados (a falha veio depois) e descartados; a trilha só tem a 1ª geração.
    expect(gerados).toHaveLength(3);
    expect(gerados[0]).toBe(anterior.token);
    expect(await trilha()).toHaveLength(1);
    const texto = JSON.stringify([respostas, textoDoConsole(chamadas)]);
    expect(texto).toContain("falha simulada ao gravar token_webhook");
    for (const token of gerados.slice(1))
      for (const segredo of [token, await sha256Hex(token)])
        expect(texto).not.toContain(segredo);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA7: a varredura
// ---------------------------------------------------------------------------------------------------

describe("CA7: o token não fica em nenhuma tabela (D21, OBRIGATÓRIO 7)", () => {
  /** Todas as tabelas do banco (menos as internas do SQLite e do D1, que não podem ser lidas). */
  async function tabelas(): Promise<string[]> {
    const { results } = await db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'
         ORDER BY name`,
      )
      .all<{ name: string }>();
    return results.map((linha) => linha.name);
  }

  /** Cada célula de cada tabela que contém algum dos textos, como "tabela.coluna". */
  async function ondeAparece(textos: string[]): Promise<string[]> {
    const achados: string[] = [];
    for (const tabela of await tabelas()) {
      const { results } = await db
        .prepare(`SELECT * FROM "${tabela}"`)
        .all<Record<string, unknown>>();
      for (const linha of results)
        for (const [coluna, valor] of Object.entries(linha))
          if (textos.some((texto) => String(valor).includes(texto)))
            achados.push(`${tabela}.${coluna}`);
    }
    return achados;
  }

  it("depois de gerar três tokens (com o segredo, sem e com o anterior) e usar o último: nenhuma coluna tem um token; só o hash do vigente, só em token_webhook; a trilha, o GET e a lista da trilha sem token nem hash", async () => {
    const tokens: string[] = [];
    for (let vez = 0; vez < 3; vez += 1) {
      const res = await gerar({
        cabecalhos: admin,
        corpo: { substituir: true },
      });
      const texto = await res.text();
      const { token } = respostaGerarTokenWebhookSchema.parse(
        JSON.parse(texto),
      );
      tokens.push(token);
      // A resposta 201 traz o token (é a única vez), e só no campo `token`.
      expect(texto.split(token)).toHaveLength(2);
    }
    expect(new Set(tokens).size).toBe(3);
    expect((await entregar(tokens[2])).status).toBe(200);
    const hashes = await Promise.all(tokens.map((token) => sha256Hex(token)));

    const nomes = await tabelas();
    expect(nomes).toEqual(
      expect.arrayContaining(["token_webhook", "auditoria", "webhook_eventos"]),
    );
    // Nenhum token em nenhuma célula de nenhuma tabela.
    expect(await ondeAparece(tokens)).toEqual([]);
    // O hash do vigente só na linha do token; os dos anteriores sumiram com o UPSERT.
    expect(await ondeAparece([hashes[2]])).toEqual([
      "token_webhook.token_hash",
    ]);
    expect(await ondeAparece(hashes.slice(0, 2))).toEqual([]);

    // A trilha tem as três gerações, sem token e sem hash.
    const registros = await trilha();
    expect(registros).toHaveLength(3);
    expect(registros.every((registro) => registro.usuario_id === adminId)).toBe(
      true,
    );
    expect(JSON.stringify(registros)).not.toMatch(HEX_64);

    // O GET do estado e a lista da trilha (GET /api/admin/auditoria) também não trazem nenhum dos dois.
    for (const caminho of [CAMINHO, "/api/admin/auditoria"]) {
      const res = await requisitar("GET", caminho, { cabecalhos: admin });
      expect(res.status).toBe(200);
      const texto = await res.text();
      if (caminho !== CAMINHO)
        expect(
          respostaAuditoriaSchema
            .parse(JSON.parse(texto))
            .itens.filter((item) => item.acao === "webhook.gerar_token"),
        ).toHaveLength(3);
      for (const segredo of [...tokens, ...hashes])
        expect({ caminho, vazou: texto.includes(segredo) }).toEqual({
          caminho,
          vazou: false,
        });
      expect(texto).not.toMatch(HEX_64);
    }
  });
});
