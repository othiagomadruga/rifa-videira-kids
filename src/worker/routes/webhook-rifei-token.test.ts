// RIFA-039 (D21, OBRIGATÓRIO 2 e 3): a autenticação do POST /api/webhooks/rifei com o token gerado pela tela. O
// token da tela tem prioridade sobre o segredo do Worker; sem nenhum dos dois, 503; a leitura do token que falha dá
// 500 e nunca cai para o segredo; 1 linha lida por requisição, com a tabela vazia ou não; o token nunca vai para
// log. O D1 é deste arquivo: o beforeEach apaga a linha do token e as entregas (os testes do segredo começam sem
// token da tela). Os testes do segredo de antes (routes/webhook-rifei.test.ts) continuam valendo sem mudar.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import newOrderAfiliado from "../../../test/fixtures/rifei/new_order.afiliado.json";
import { respostaWebhookRifeiSchema } from "../../shared/contracts";
import { LER_HASH_TOKEN_WEBHOOK } from "../db/token-webhook";
import app from "../index";
import { gerarTokenWebhook, sha256Hex } from "../lib/cripto";
import {
  bancoQueRegistra,
  type ComandoMedido,
} from "../test/banco-que-registra";

const CAMINHO = "/api/webhooks/rifei";
const db = env.DB;
const SEGREDO = segredoDosTestes();

function segredoDosTestes(): string {
  const segredo = env.RIFEI_WEBHOOK_TOKEN;
  if (!segredo)
    throw new Error("RIFEI_WEBHOOK_TOKEN ausente no vitest.config.ts");
  return segredo;
}

// ---------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------

interface OpcoesEnvio {
  /** Header Authorization; null = sem o header. */
  autorizacao: string | null;
  /** Bindings trocados: a requisição vai direto ao app Hono com este env. */
  env?: Partial<Cloudflare.Env>;
}

/** Uma entrega da fixture new_order (sem campanha ativa neste arquivo: 200 ignorado_outra_campanha, gravada). */
async function enviar(opcoes: OpcoesEnvio): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opcoes.autorizacao !== null)
    headers.set("Authorization", opcoes.autorizacao);
  const init = {
    method: "POST",
    headers,
    body: JSON.stringify(newOrderAfiliado),
  };
  if (opcoes.env) return app.request(CAMINHO, init, { ...env, ...opcoes.env });
  return exports.default.fetch(`http://localhost${CAMINHO}`, init);
}

const bearer = (token: string) => `Bearer ${token}`;

/** Grava o token da tela como a rota grava (só o SHA-256) e devolve o token. */
async function gravarTokenDaTela(token = gerarTokenWebhook()): Promise<string> {
  await db
    .prepare(
      `INSERT INTO token_webhook (id, token_hash, gerado_em) VALUES (1, ?1, ?2)
       ON CONFLICT (id) DO UPDATE SET token_hash = excluded.token_hash, gerado_em = excluded.gerado_em`,
    )
    .bind(await sha256Hex(token), new Date().toISOString())
    .run();
  return token;
}

async function entregasGravadas(): Promise<number> {
  const linha = await db
    .prepare("SELECT count(*) AS total FROM webhook_eventos")
    .first<{ total: number }>();
  return linha?.total ?? 0;
}

async function esperarAceito(res: Response): Promise<void> {
  expect(res.status).toBe(200);
  expect(respostaWebhookRifeiSchema.parse(await res.json()).resultado).toBe(
    "ignorado_outra_campanha",
  );
}

async function esperar401(res: Response): Promise<void> {
  expect({
    status: res.status,
    autenticar: res.headers.get("WWW-Authenticate"),
    corpo: await res.json(),
  }).toEqual({
    status: 401,
    autenticar: "Bearer",
    corpo: {
      erro: {
        codigo: "nao_autenticado",
        mensagem: "Token do webhook ausente ou inválido",
      },
    },
  });
}

async function esperar503(res: Response): Promise<void> {
  expect({ status: res.status, corpo: await res.json() }).toEqual({
    status: 503,
    corpo: {
      erro: {
        codigo: "nao_configurado",
        mensagem: "O webhook da Rifei não está configurado no servidor",
      },
    },
  });
}

async function esperar500(res: Response): Promise<void> {
  expect({ status: res.status, corpo: await res.json() }).toEqual({
    status: 500,
    corpo: { erro: { codigo: "erro_interno", mensagem: "Erro interno" } },
  });
}

/** O D1 dos testes com a leitura do token que falha (o resto funciona): um erro do D1 na hora de ler a linha. */
function bancoComALeituraDoTokenQueFalha(): D1Database {
  const falhar = () =>
    Promise.reject(new Error("D1_ERROR: falha simulada ao ler token_webhook"));
  const comandoQueFalha = {
    bind: () => comandoQueFalha,
    first: falhar,
    all: falhar,
    run: falhar,
    raw: falhar,
  };
  return new Proxy(db, {
    get(alvo, nome) {
      if (nome === "prepare")
        return (sql: string) =>
          sql === LER_HASH_TOKEN_WEBHOOK
            ? (comandoQueFalha as unknown as D1PreparedStatement)
            : alvo.prepare(sql);
      const valor: unknown = Reflect.get(alvo, nome, alvo);
      return typeof valor === "function"
        ? (...args: unknown[]) => Reflect.apply(valor, alvo, args)
        : valor;
    },
  });
}

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM token_webhook"),
    db.prepare("DELETE FROM webhook_eventos"),
    db.prepare("DELETE FROM pedidos"),
    db.prepare("DELETE FROM afiliados"),
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Para os testes do segredo no mesmo arquivo (o D1 é um por arquivo; OBRIGATÓRIO 3).
  await db.prepare("DELETE FROM token_webhook").run();
});

// ---------------------------------------------------------------------------------------------------
// CA1: o token da tela tem prioridade
// ---------------------------------------------------------------------------------------------------

describe("CA1: prioridade do token da tela (D21)", () => {
  it("com o token da tela, só ele vale: o Bearer do segredo do Worker leva 401 e nada é gravado; o da tela é aceito", async () => {
    const token = await gravarTokenDaTela();

    await esperar401(await enviar({ autorizacao: bearer(SEGREDO) }));
    expect(await entregasGravadas()).toBe(0);

    await esperarAceito(await enviar({ autorizacao: bearer(token) }));
    expect(await entregasGravadas()).toBe(1);
  });

  it.each([
    ["esquema em minúsculas", (token: string) => `bearer ${token}`],
    ["espaços a mais", (token: string) => `BEARER   ${token}  `],
  ])(
    "o token da tela com o Bearer como a Rifei pode mandar (%s) é aceito",
    async (_caso, autorizacao) => {
      const token = await gravarTokenDaTela();
      await esperarAceito(await enviar({ autorizacao: autorizacao(token) }));
    },
  );

  it.each([
    ["sem o header Authorization", () => null],
    ["outro token no formato da tela", () => bearer(gerarTokenWebhook())],
    [
      "o token da tela em maiúsculas",
      (token: string) => bearer(token.toUpperCase()),
    ],
    [
      "o token da tela com um caractere a mais",
      (token: string) => bearer(`${token}0`),
    ],
    [
      "só o começo do token da tela",
      (token: string) => bearer(token.slice(0, -1)),
    ],
    ["o token da tela sem o esquema", (token: string) => token],
  ])(
    "com o token da tela, %s: 401 e nada é gravado",
    async (_caso, autorizacao) => {
      const token = await gravarTokenDaTela();
      await esperar401(await enviar({ autorizacao: autorizacao(token) }));
      expect(await entregasGravadas()).toBe(0);
    },
  );

  it("quem copiar o hash do banco não entra: o SHA-256 gravado como Bearer leva 401", async () => {
    const token = await gravarTokenDaTela();
    await esperar401(
      await enviar({ autorizacao: bearer(await sha256Hex(token)) }),
    );
  });

  it("sem o token da tela, vale o segredo do Worker (como antes); um token no formato da tela, não", async () => {
    await esperarAceito(await enviar({ autorizacao: bearer(SEGREDO) }));
    await esperar401(
      await enviar({ autorizacao: bearer(gerarTokenWebhook()) }),
    );
    expect(await entregasGravadas()).toBe(1);
  });

  it.each([
    ["ausente", undefined],
    ["vazio", ""],
    ["só com espaços", "   "],
  ])(
    "sem nenhum dos dois (segredo %s e nenhum token da tela): 503 nao_configurado e nada é gravado",
    async (_caso, segredo) => {
      await esperar503(
        await enviar({
          autorizacao: bearer(SEGREDO),
          env: { RIFEI_WEBHOOK_TOKEN: segredo },
        }),
      );
      await esperar503(
        await enviar({
          autorizacao: null,
          env: { RIFEI_WEBHOOK_TOKEN: segredo },
        }),
      );
      expect(await entregasGravadas()).toBe(0);
    },
  );

  it("com o token da tela e sem o segredo do Worker: o da tela é aceito e o resto leva 401 (não 503)", async () => {
    const token = await gravarTokenDaTela();
    const semSegredo = { RIFEI_WEBHOOK_TOKEN: undefined };

    await esperarAceito(
      await enviar({ autorizacao: bearer(token), env: semSegredo }),
    );
    await esperar401(
      await enviar({ autorizacao: bearer(SEGREDO), env: semSegredo }),
    );
    await esperar401(await enviar({ autorizacao: null, env: semSegredo }));
  });

  it("compara em tempo constante: o SHA-256 do Bearer contra o hash, com timingSafeEqual sobre dois resumos de 32 bytes", async () => {
    await gravarTokenDaTela();
    const comparar = vi.spyOn(crypto.subtle, "timingSafeEqual");

    await esperar401(await enviar({ autorizacao: bearer("x"), env: {} }));

    expect(comparar).toHaveBeenCalledOnce();
    const [recebido, esperado] = comparar.mock.calls[0];
    expect([recebido.byteLength, esperado.byteLength]).toEqual([32, 32]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA3: a leitura do token que falha dá 500, sem cair para o segredo
// ---------------------------------------------------------------------------------------------------

describe("CA3: falha fechada na leitura do token (D21)", () => {
  it("o D1 falha ao ler o token: 500 erro_interno mesmo com o Bearer certo do segredo (nunca cai para ele), e nada é gravado", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const falha = { DB: bancoComALeituraDoTokenQueFalha() };

    await esperar500(
      await enviar({ autorizacao: bearer(SEGREDO), env: falha }),
    );
    // Sem Bearer e sem segredo também: a leitura vem antes de tudo (não 401 nem 503).
    await esperar500(await enviar({ autorizacao: null, env: falha }));
    await esperar500(
      await enviar({
        autorizacao: bearer(SEGREDO),
        env: { ...falha, RIFEI_WEBHOOK_TOKEN: undefined },
      }),
    );

    expect(await entregasGravadas()).toBe(0);
    expect(log).toHaveBeenCalledTimes(3);
    const registrado = JSON.stringify(
      log.mock.calls,
      (_chave, valor: unknown) =>
        valor instanceof Error ? `${valor.message} ${valor.stack}` : valor,
    );
    expect(registrado).toContain("falha simulada ao ler token_webhook");
    expect(registrado).not.toContain(SEGREDO);
  });

  it("sem a tabela (um Time Travel do D1 para antes da 0009): 500 em toda entrega até as migrações rodarem de novo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await db
      .prepare("ALTER TABLE token_webhook RENAME TO token_webhook_fora")
      .run();
    try {
      await esperar500(await enviar({ autorizacao: bearer(SEGREDO) }));
      expect(await entregasGravadas()).toBe(0);
    } finally {
      await db
        .prepare("ALTER TABLE token_webhook_fora RENAME TO token_webhook")
        .run();
    }
    await esperarAceito(await enviar({ autorizacao: bearer(SEGREDO) }));
  });
});

// ---------------------------------------------------------------------------------------------------
// CA4: 1 linha lida por requisição, com a tabela vazia ou não, e nenhuma escrita a mais
// ---------------------------------------------------------------------------------------------------

describe("CA4: orçamento do D1 (D21: 1 linha lida por requisição)", () => {
  /** Envia pelo D1 que registra e devolve os comandos executados. */
  async function medir(opcoes: OpcoesEnvio) {
    const { db: registrado, comandos } = bancoQueRegistra();
    const res = await enviar({
      ...opcoes,
      env: { ...opcoes.env, DB: registrado },
    });
    return { res, comandos };
  }

  const LEITURA_DO_TOKEN = {
    sql: LER_HASH_TOKEN_WEBHOOK,
    lidas: 1,
    escritas: 0,
  };

  it("503, 401 sem token da tela e 401 com ele (com e sem Bearer): só a leitura do token, 1 linha, nenhuma escrita", async () => {
    const semNada = await medir({
      autorizacao: bearer(SEGREDO),
      env: { RIFEI_WEBHOOK_TOKEN: undefined },
    });
    await esperar503(semNada.res);
    expect(semNada.comandos).toEqual([LEITURA_DO_TOKEN]);

    for (const autorizacao of [bearer(gerarTokenWebhook()), null]) {
      const tabelaVazia = await medir({ autorizacao });
      await esperar401(tabelaVazia.res);
      expect(tabelaVazia.comandos).toEqual([LEITURA_DO_TOKEN]);
    }

    await gravarTokenDaTela();
    for (const autorizacao of [bearer(SEGREDO), null]) {
      const comToken = await medir({ autorizacao });
      await esperar401(comToken.res);
      expect(comToken.comandos).toEqual([LEITURA_DO_TOKEN]);
    }
  });

  it("autenticada: a leitura do token (1 linha) vem primeiro, só uma vez; o resto do fluxo custa o mesmo com o segredo e com o token da tela", async () => {
    const comSegredo = await medir({ autorizacao: bearer(SEGREDO) });
    await esperarAceito(comSegredo.res);

    const token = await gravarTokenDaTela();
    const comTela = await medir({ autorizacao: bearer(token) });
    await esperarAceito(comTela.res);

    for (const { comandos } of [comSegredo, comTela]) {
      expect(comandos[0]).toEqual(LEITURA_DO_TOKEN);
      // Nenhum outro comando toca na tabela do token (nem escreve nela): sem cache, sem gravar o último uso.
      expect(
        comandos
          .slice(1)
          .filter((comando) => /token_webhook/.test(comando.sql)),
      ).toEqual([]);
    }
    // O mesmo fluxo depois da autenticação (os mesmos comandos, as mesmas linhas lidas e escritas): o token da
    // tela não custa nada a mais que o segredo, e a única linha a mais de antes da D21 é a do token.
    expect(comTela.comandos.slice(1)).toEqual(comSegredo.comandos.slice(1));
    const soma = (comandos: ComandoMedido[], campo: "lidas" | "escritas") =>
      comandos.reduce((total, comando) => total + comando[campo], 0);
    expect(soma(comTela.comandos, "lidas")).toBe(
      soma(comSegredo.comandos, "lidas"),
    );
    expect(soma(comTela.comandos, "escritas")).toBe(
      soma(comSegredo.comandos, "escritas"),
    );
  });

  it("sem cache: a cada requisição o token é lido de novo (duas entregas, duas leituras)", async () => {
    const token = await gravarTokenDaTela();
    const { db: registrado, comandos } = bancoQueRegistra();
    for (let vez = 0; vez < 2; vez += 1)
      await esperarAceito(
        await enviar({ autorizacao: bearer(token), env: { DB: registrado } }),
      );
    expect(
      comandos.filter((comando) => comando.sql === LER_HASH_TOKEN_WEBHOOK),
    ).toEqual([LEITURA_DO_TOKEN, LEITURA_DO_TOKEN]);
  });
});

// ---------------------------------------------------------------------------------------------------
// O token nunca vai para log nem para a resposta
// ---------------------------------------------------------------------------------------------------

describe("o token da tela fora do log e das respostas (D21)", () => {
  it("aceito, 401, 503 e 500: nenhum console.* e nenhuma resposta traz o token, o hash ou o segredo", async () => {
    const chamadas = (["log", "info", "warn", "error", "debug"] as const).map(
      (metodo) => vi.spyOn(console, metodo).mockImplementation(() => {}),
    );
    const token = await gravarTokenDaTela();
    const hash = await sha256Hex(token);
    const respostas: string[] = [];
    const guardar = async (res: Response) => {
      respostas.push(await res.text());
    };

    await guardar(await enviar({ autorizacao: bearer(token) }));
    await guardar(await enviar({ autorizacao: bearer(`${token}0`) }));
    await guardar(await enviar({ autorizacao: bearer(SEGREDO) }));
    await guardar(
      await enviar({
        autorizacao: bearer(token),
        env: { DB: bancoComALeituraDoTokenQueFalha() },
      }),
    );
    await db.prepare("DELETE FROM token_webhook").run();
    await guardar(
      await enviar({
        autorizacao: bearer(token),
        env: { RIFEI_WEBHOOK_TOKEN: undefined },
      }),
    );

    expect(respostas).toHaveLength(5);
    // O JSON.stringify de um Error dá "{}": a mensagem e a pilha entram por extenso.
    const texto = JSON.stringify(
      [respostas, chamadas.map((chamada) => chamada.mock.calls)],
      (_chave, valor: unknown) =>
        valor instanceof Error
          ? { nome: valor.name, mensagem: valor.message, pilha: valor.stack }
          : valor,
    );
    for (const segredo of [token, hash, SEGREDO])
      expect(texto).not.toContain(segredo);
    // O 500 foi registrado (o erro do D1, sem o token).
    expect(texto).toContain("falha simulada ao ler token_webhook");
  });
});
