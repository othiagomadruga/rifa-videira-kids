// RIFA-095 (D43): as rotas abertas das notificações de venda, no workerd, com o D1 local. O estado (GET) num sub-app
// sem cache (e um caso com o cache), a inscrição e o cancelamento pelo app real (index.ts, com as chaves VAPID no env
// passado). Nenhum serviço de push é chamado aqui: só se grava e se apaga a inscrição.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ROTAS_NOTIFICACOES,
  erroApiSchema,
  respostaEstadoNotificacoesSchema,
} from "../../shared/contracts";
import app from "../index";
import {
  CACHE_PUBLICO,
  SEM_CACHE,
  criarCacheDeRespostas,
} from "../lib/cache-publico";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import { ORIGEM } from "../test/acesso-teste";
import { semearCenario } from "../test/painel-apoio";
import {
  ambienteComVapid,
  criarAparelho,
  type AparelhoFalso,
} from "../test/push-apoio";
import {
  LIMITE_CORPO_NOTIFICACOES_BYTES,
  PREFIXO_NOTIFICACOES,
  criarNotificacoes,
} from "./notificacoes";

const db = env.DB;
const ESTADO = ROTAS_NOTIFICACOES.estadoNotificacoes.caminho;
const INSCREVER = ROTAS_NOTIFICACOES.inscreverNotificacoes.caminho;
const CANCELAR = ROTAS_NOTIFICACOES.cancelarNotificacoes.caminho;

let ambiente: Cloudflare.Env;

/** O sub-app sozinho (com o formato único de erro), para o GET sem o cache de produção. */
function subApp(opcoes: Parameters<typeof criarNotificacoes>[0] = {}) {
  const teste = new Hono<{ Bindings: Cloudflare.Env }>();
  teste.route(
    PREFIXO_NOTIFICACOES,
    criarNotificacoes({ cache: SEM_CACHE, ...opcoes }),
  );
  teste.notFound(rotaInexistente);
  teste.onError(erroNaoTratado);
  return teste;
}

async function estado(comEnv: Cloudflare.Env, teste = subApp()) {
  const res = await teste.request(ESTADO, {}, comEnv);
  return { res, corpo: (await res.json()) as unknown };
}

let ip = 0;
/** Um IP novo por chamada (o limitador do wrangler.jsonc guarda a contagem entre os testes). */
const ipNovo = () => `198.51.100.${(ip = (ip % 250) + 1)}`;

function postar(
  caminho: string,
  corpo: unknown,
  {
    comEnv = ambiente,
    cabecalhos = {},
  }: { comEnv?: Cloudflare.Env; cabecalhos?: Record<string, string> } = {},
) {
  return app.request(
    caminho,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGEM,
        "CF-Connecting-IP": ipNovo(),
        ...cabecalhos,
      },
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    },
    comEnv,
  );
}

const corpoDe = (aparelho: AparelhoFalso, origem = "publico") => ({
  endpoint: aparelho.endpoint,
  chaves: { p256dh: aparelho.p256dh, auth: aparelho.auth },
  origem,
});

async function linhas() {
  return (
    await db
      .prepare(
        "SELECT endpoint, p256dh, auth, origem, falhas, ultimo_envio_em FROM push_inscricoes ORDER BY id",
      )
      .all<Record<string, unknown>>()
  ).results;
}

async function esperarErro(res: Response, status: number, codigo: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const corpo = erroApiSchema.parse(await res.json());
  expect(corpo.erro.codigo).toBe(codigo);
  return corpo;
}

beforeEach(async () => {
  await semearCenario({ pedidos: [] });
  await db.prepare("DELETE FROM push_inscricoes").run();
  ambiente = await ambienteComVapid(env);
});

describe("GET /api/publico/notificacoes (o estado do botão)", () => {
  it("com as chaves, a campanha ativa e a opção ligada: ligadas, com a chave pública; cache curto das rotas abertas", async () => {
    const { res, corpo } = await estado(ambiente);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_PUBLICO);
    expect(respostaEstadoNotificacoesSchema.parse(corpo)).toEqual({
      ligadas: true,
      chave_publica: ambiente.VAPID_PUBLIC_KEY,
    });
  });

  it("sem as chaves (o env dos testes), com a opção desligada ou sem campanha ativa: desligadas, sem chave", async () => {
    const desligadas = { ligadas: false, chave_publica: null };
    expect((await estado(env)).corpo).toEqual(desligadas);
    await db
      .prepare("UPDATE campanhas SET notificacoes_vendas = 0 WHERE ativa = 1")
      .run();
    expect((await estado(ambiente)).corpo).toEqual(desligadas);
    await db.prepare("UPDATE campanhas SET ativa = 0").run();
    expect((await estado(ambiente)).corpo).toEqual(desligadas);
  });

  it("no app real, aberto (sem sessão) e com os cabeçalhos de segurança", async () => {
    const res = await app.request(ESTADO, {}, ambiente);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(
      respostaEstadoNotificacoesSchema.parse(await res.json()).ligadas,
    ).toBe(true);
  });

  it("com o cache, a segunda leitura não vai ao banco (nem conta no limite) dentro dos 30 s", async () => {
    const agora = new Date("2026-11-27T15:00:00.000Z");
    const teste = subApp({
      cache: criarCacheDeRespostas({ memoria: true, cacheApi: null }),
      relogio: () => agora,
    });
    expect((await estado(ambiente, teste)).corpo).toMatchObject({
      ligadas: true,
    });
    await db
      .prepare("UPDATE campanhas SET notificacoes_vendas = 0 WHERE ativa = 1")
      .run();
    expect((await estado(ambiente, teste)).corpo).toMatchObject({
      ligadas: true,
    });
  });
});

describe("POST /api/publico/notificacoes/inscrever", () => {
  it("grava a inscrição (204, no-store) e, com o mesmo endpoint, troca as chaves e zera as falhas", async () => {
    const aparelho = await criarAparelho();
    const res = await postar(INSCREVER, corpoDe(aparelho));
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("");
    expect(await linhas()).toEqual([
      {
        endpoint: aparelho.endpoint,
        p256dh: aparelho.p256dh,
        auth: aparelho.auth,
        origem: "publico",
        falhas: 0,
        ultimo_envio_em: null,
      },
    ]);

    await db.prepare("UPDATE push_inscricoes SET falhas = 3").run();
    const outro = await criarAparelho();
    const mesmoEndpoint = { ...outro, endpoint: aparelho.endpoint };
    expect(
      (await postar(INSCREVER, corpoDe(mesmoEndpoint, "minha"))).status,
    ).toBe(204);
    expect(await linhas()).toEqual([
      {
        endpoint: aparelho.endpoint,
        p256dh: outro.p256dh,
        auth: outro.auth,
        origem: "minha",
        falhas: 0,
        ultimo_envio_em: null,
      },
    ]);
  });

  it("aceita os serviços de push dos navegadores (FCM, Mozilla, Apple e Microsoft)", async () => {
    for (const servidor of [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
      "wns2-par02p.notify.windows.com",
    ]) {
      const aparelho = await criarAparelho(servidor);
      expect((await postar(INSCREVER, corpoDe(aparelho))).status).toBe(204);
    }
    expect(await linhas()).toHaveLength(4);
  });

  it("SSRF: o endpoint de fora da lista é 400, sem ecoar o valor e sem gravar", async () => {
    const aparelho = await criarAparelho();
    for (const endpoint of [
      "https://interno.exemplo/segredo-do-endpoint",
      "http://fcm.googleapis.com/fcm/send/x",
      "https://169.254.169.254/latest/meta-data",
      "https://fcm.googleapis.com.exemplo.com/x",
    ]) {
      const res = await postar(INSCREVER, { ...corpoDe(aparelho), endpoint });
      const corpo = await esperarErro(res, 400, "requisicao_invalida");
      expect(JSON.stringify(corpo)).not.toContain(endpoint);
      expect(corpo.erro.detalhes).toEqual([
        expect.objectContaining({ caminho: ["endpoint"] }),
      ]);
    }
    expect(await linhas()).toEqual([]);
  });

  it("a chave do aparelho no formato certo mas fora da curva P-256: 400 `chave_invalida`", async () => {
    const aparelho = await criarAparelho();
    const corpo = await esperarErro(
      await postar(INSCREVER, {
        ...corpoDe(aparelho),
        chaves: { p256dh: `B${"A".repeat(86)}`, auth: aparelho.auth },
      }),
      400,
      "requisicao_invalida",
    );
    expect(corpo.erro.detalhes).toEqual([
      expect.objectContaining({
        caminho: ["chaves", "p256dh"],
        codigo: "chave_invalida",
      }),
    ]);
    expect(await linhas()).toEqual([]);
  });

  it("corpo fora do schema, JSON inválido e corpo grande demais", async () => {
    const aparelho = await criarAparelho();
    await esperarErro(
      await postar(INSCREVER, { ...corpoDe(aparelho), origem: "telao" }),
      400,
      "requisicao_invalida",
    );
    await esperarErro(
      await postar(INSCREVER, "{nao json"),
      400,
      "json_invalido",
    );
    await esperarErro(
      await postar(INSCREVER, {
        ...corpoDe(aparelho),
        extra: "x".repeat(LIMITE_CORPO_NOTIFICACOES_BYTES),
      }),
      413,
      "corpo_muito_grande",
    );
    expect(await linhas()).toEqual([]);
  });

  it("sem as chaves VAPID no servidor: 503 `nao_configurado`, antes de ler o corpo", async () => {
    await esperarErro(
      await postar(INSCREVER, "{nao json", { comEnv: env }),
      503,
      "nao_configurado",
    );
    const aparelho = await criarAparelho();
    await esperarErro(
      await postar(INSCREVER, corpoDe(aparelho), { comEnv: env }),
      503,
      "nao_configurado",
    );
    expect(await linhas()).toEqual([]);
  });

  it("com a opção da campanha desligada ou sem campanha ativa: 409 `acao_desligada`", async () => {
    const aparelho = await criarAparelho();
    await db
      .prepare("UPDATE campanhas SET notificacoes_vendas = 0 WHERE ativa = 1")
      .run();
    await esperarErro(
      await postar(INSCREVER, corpoDe(aparelho)),
      409,
      "acao_desligada",
    );
    await db.prepare("UPDATE campanhas SET ativa = 0").run();
    await esperarErro(
      await postar(INSCREVER, corpoDe(aparelho)),
      409,
      "acao_desligada",
    );
    expect(await linhas()).toEqual([]);
  });

  it("só da mesma origem (CSRF): outra origem ou sem Origin é 403", async () => {
    const aparelho = await criarAparelho();
    await esperarErro(
      await postar(INSCREVER, corpoDe(aparelho), {
        cabecalhos: { Origin: "https://site-malicioso.example" },
      }),
      403,
      "proibido",
    );
    const semOrigem = await app.request(
      INSCREVER,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpoDe(aparelho)),
      },
      ambiente,
    );
    await esperarErro(semOrigem, 403, "proibido");
    expect(await linhas()).toEqual([]);
  });

  it("limite por IP das rotas abertas: a 61ª tentativa no minuto é 429", async () => {
    const aparelho = await criarAparelho();
    const mesmoIp = "203.0.113.95";
    const tentar = () =>
      postar(INSCREVER, corpoDe(aparelho), {
        cabecalhos: { "CF-Connecting-IP": mesmoIp },
      });
    for (let i = 0; i < 60; i++) expect((await tentar()).status).toBe(204);
    const res = await tentar();
    await esperarErro(res, 429, "muitas_requisicoes");
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});

describe("POST /api/publico/notificacoes/cancelar", () => {
  it("apaga a inscrição do endpoint (204); o que não existe também é 204; vale sem as chaves", async () => {
    const [um, outro] = [await criarAparelho(), await criarAparelho()];
    for (const aparelho of [um, outro])
      expect((await postar(INSCREVER, corpoDe(aparelho))).status).toBe(204);
    const res = await postar(
      CANCELAR,
      { endpoint: um.endpoint },
      { comEnv: env },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await linhas()).map((linha) => linha.endpoint)).toEqual([
      outro.endpoint,
    ]);
    expect((await postar(CANCELAR, { endpoint: um.endpoint })).status).toBe(
      204,
    );
  });

  it("só da mesma origem, e o corpo do schema", async () => {
    const aparelho = await criarAparelho();
    expect((await postar(INSCREVER, corpoDe(aparelho))).status).toBe(204);
    await esperarErro(
      await postar(
        CANCELAR,
        { endpoint: aparelho.endpoint },
        { cabecalhos: { Origin: "https://site-malicioso.example" } },
      ),
      403,
      "proibido",
    );
    await esperarErro(await postar(CANCELAR, {}), 400, "requisicao_invalida");
    expect(await linhas()).toHaveLength(1);
  });
});
