// RIFA-095 (D43): o disparo das notificações de venda, no workerd, com o D1 local e um serviço de push falso no lugar
// do fetch (nenhuma requisição sai do teste). Pelo webhook real (app.fetch com um contexto de execução que guarda o
// waitUntil) e direto (notificarVendaAprovada, para o teto e as falhas).
import { env } from "cloudflare:workers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import paidOrderAfiliado from "../../../test/fixtures/rifei/paid_order.afiliado.json";
import { buscarCampanhaAtiva, type CampanhaAtiva } from "../db/campanha";
import app from "../index";
import { DADOS_CAMPANHA, semearCenario } from "../test/painel-apoio";
import {
  ambienteComVapid,
  criarAparelho,
  inscreverNoBanco,
  servicoDePushFalso,
  type AparelhoFalso,
} from "../test/push-apoio";
import {
  FALHAS_PARA_APAGAR,
  LIMITE_ENVIOS_POR_VENDA,
  TTL_NOTIFICACAO_SEGUNDOS,
  notificarVendaAprovada,
} from "./notificacoes-venda";

const db = env.DB;
const TOKEN = env.RIFEI_WEBHOOK_TOKEN!;
/** Dentro da campanha do cenário (23/11 a 13/12/2026), às 10:00 em Belém. */
const APROVADO_EM = "2026-11-27T10:00:00.000-03:00";

let ambiente: Cloudflare.Env;
let sequencia = 0;
let espiaoDoLog: MockInstance<typeof console.log>;
let espiaoDoAviso: MockInstance<typeof console.warn>;

/** Um evento da campanha ativa do cenário: o afiliado 101 é da Célula Ágape; o 900 não tem célula. */
function evento(
  mudancas: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  sequencia += 1;
  return {
    ...paidOrderAfiliado,
    id: `PUSH-${String(sequencia).padStart(4, "0")}`,
    slug: DADOS_CAMPANHA.slug_rifei,
    affiliate_id: 101,
    numbers: [1, 2, 3],
    numbers_count: 3,
    subtotal: 60,
    total: 60,
    created_at: "2026-11-27T09:55:00.000-03:00",
    expires_at: "2026-11-27T10:25:00.000-03:00",
    approved_at: APROVADO_EM,
    ...mudancas,
  };
}

/** O webhook real, com o contexto de execução que guarda o que foi para o waitUntil. */
async function webhook(payload: unknown, comEnv: Cloudflare.Env = ambiente) {
  const pendentes: Promise<unknown>[] = [];
  const contexto = {
    waitUntil: (promessa: Promise<unknown>) => pendentes.push(promessa),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const resposta = await app.fetch(
    new Request("http://localhost/api/webhooks/rifei", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
    comEnv,
    contexto,
  );
  return { resposta, pendentes };
}

/** O webhook e o disparo inteiro (espera o waitUntil). */
async function webhookEDisparo(payload: unknown, comEnv?: Cloudflare.Env) {
  const { resposta, pendentes } = await webhook(payload, comEnv);
  expect(resposta.status).toBe(200);
  await Promise.all(pendentes);
  return { resposta, pendentes };
}

async function inscricoes() {
  return (
    await db
      .prepare(
        "SELECT id, endpoint, falhas, ultimo_envio_em FROM push_inscricoes ORDER BY id",
      )
      .all<{
        id: number;
        endpoint: string;
        falhas: number;
        ultimo_envio_em: string | null;
      }>()
  ).results;
}

async function aparelhosInscritos(quantos: number): Promise<AparelhoFalso[]> {
  const aparelhos: AparelhoFalso[] = [];
  for (let i = 0; i < quantos; i++) {
    const aparelho = await criarAparelho();
    await inscreverNoBanco(db, aparelho);
    aparelhos.push(aparelho);
  }
  return aparelhos;
}

async function campanhaAtiva(): Promise<CampanhaAtiva> {
  return (await buscarCampanhaAtiva(db))!;
}

beforeEach(async () => {
  await semearCenario({ pedidos: [] });
  await db.prepare("DELETE FROM push_inscricoes").run();
  ambiente = await ambienteComVapid(env);
  espiaoDoLog = vi.spyOn(console, "log").mockImplementation(() => {});
  espiaoDoAviso = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pelo webhook da Rifei", () => {
  it("o pedido pago com célula vai para todas as inscrições, e cada aparelho lê a notificação do PO", async () => {
    const aparelhos = await aparelhosInscritos(3);
    const servico = servicoDePushFalso();
    vi.spyOn(globalThis, "fetch").mockImplementation(servico.buscar);

    await webhookEDisparo(evento());

    expect(servico.recebidos.map((r) => r.endpoint).sort()).toEqual(
      aparelhos.map((a) => a.endpoint).sort(),
    );
    for (const aparelho of aparelhos) {
      const recebido = servico.recebidos.find(
        (r) => r.endpoint === aparelho.endpoint,
      )!;
      expect(JSON.parse(await aparelho.ler(recebido.corpo))).toEqual({
        titulo: "Projeto Videira Kids",
        corpo: "🎟️ A Célula Ágape vendeu 3 bilhetes!",
        url: "/",
      });
      expect(recebido.cabecalhos.get("TTL")).toBe(
        String(TTL_NOTIFICACAO_SEGUNDOS),
      );
      expect(TTL_NOTIFICACAO_SEGUNDOS).toBe(3600);
      expect(recebido.cabecalhos.get("Urgency")).toBe("normal");
    }
    // Os aceitos ficam com o envio de agora e sem falhas.
    for (const linha of await inscricoes()) {
      expect(linha.falhas).toBe(0);
      expect(linha.ultimo_envio_em).toMatch(/^\d{4}-\d\d-\d\dT/);
    }
    // O log só com contagens: nenhum endpoint, chave ou comprador.
    const log = JSON.stringify(espiaoDoLog.mock.calls);
    expect(log).toContain("notificacoes_de_venda");
    for (const aparelho of aparelhos) {
      expect(log).not.toContain(aparelho.endpoint);
      expect(log).not.toContain(aparelho.p256dh);
    }
    expect(log).not.toContain(paidOrderAfiliado.buyer.name);
  });

  it("o webhook responde sem esperar os envios (eles ficam no waitUntil)", async () => {
    await aparelhosInscritos(2);
    let liberar!: () => void;
    const segurando = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    const servico = servicoDePushFalso(async () => {
      await segurando;
      return new Response(null, { status: 201 });
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(servico.buscar);

    const { resposta, pendentes } = await webhook(evento());
    // A resposta já saiu, com o resultado de sempre, e o disparo continua no waitUntil.
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      resultado: "processado",
      evento_id: expect.any(Number),
    });
    expect(pendentes).toHaveLength(1);
    await vi.waitFor(() => expect(servico.recebidos).toHaveLength(2));
    expect((await inscricoes()).every((l) => l.ultimo_envio_em === null)).toBe(
      true,
    );
    liberar();
    await Promise.all(pendentes);
    expect((await inscricoes()).every((l) => l.ultimo_envio_em !== null)).toBe(
      true,
    );
  });

  it("a reentrega do mesmo pedido pago (duplicado) não notifica de novo", async () => {
    await aparelhosInscritos(2);
    const servico = servicoDePushFalso();
    vi.spyOn(globalThis, "fetch").mockImplementation(servico.buscar);
    const pago = evento();

    await webhookEDisparo(pago);
    const { resposta, pendentes } = await webhookEDisparo(pago);
    expect(await resposta.json()).toMatchObject({ resultado: "duplicado" });
    expect(pendentes).toHaveLength(0);
    expect(servico.recebidos).toHaveLength(2);
  });

  it("a reserva (new_order) e a expiração não notificam; o pagamento depois da reserva, sim (uma vez)", async () => {
    await aparelhosInscritos(1);
    const servico = servicoDePushFalso();
    vi.spyOn(globalThis, "fetch").mockImplementation(servico.buscar);
    const pago = evento();
    const reserva = {
      ...pago,
      event: "new_order",
      status: "pending",
      approved_at: null,
    };
    expect((await webhookEDisparo(reserva)).pendentes).toHaveLength(0);
    expect(
      (
        await webhookEDisparo({
          ...reserva,
          event: "expired_order",
          status: "expired",
          expired_at: "2026-11-27T10:25:00.000-03:00",
        })
      ).pendentes,
    ).toHaveLength(0);
    expect(servico.recebidos).toHaveLength(0);
    // expired → approved (o pagamento que chega depois da expiração) conta e notifica.
    await webhookEDisparo(pago);
    expect(servico.recebidos).toHaveLength(1);
  });

  it("a venda sem célula (afiliado sem vínculo ou sem afiliado) não notifica", async () => {
    await aparelhosInscritos(2);
    const servico = servicoDePushFalso();
    vi.spyOn(globalThis, "fetch").mockImplementation(servico.buscar);

    await webhookEDisparo(evento({ affiliate_id: 900 }));
    await webhookEDisparo(evento({ affiliate_id: null }));
    expect(servico.recebidos).toHaveLength(0);
    expect((await inscricoes()).every((l) => l.ultimo_envio_em === null)).toBe(
      true,
    );
  });

  it("a reserva atribuída à mão a uma célula (D41) notifica com essa célula quando é paga", async () => {
    const [aparelho] = await aparelhosInscritos(1);
    const servico = servicoDePushFalso();
    vi.spyOn(globalThis, "fetch").mockImplementation(servico.buscar);
    const pago = evento({
      affiliate_id: null,
      numbers_count: 1,
      numbers: [7],
      subtotal: 20,
      total: 20,
    });
    await webhookEDisparo({
      ...pago,
      event: "new_order",
      status: "pending",
      approved_at: null,
    });
    await db
      .prepare(
        `UPDATE pedidos SET celula_atribuida_id = 2, celula_atribuida_em = '2026-11-27T13:00:00.000Z',
           celula_atribuida_por = 1 WHERE id = ?1`,
      )
      .bind(pago.id)
      .run();
    await webhookEDisparo(pago);
    expect(servico.recebidos).toHaveLength(1);
    expect(
      JSON.parse(await aparelho.ler(servico.recebidos[0].corpo)),
    ).toMatchObject({
      corpo: "🎟️ A Célula Betel vendeu 1 bilhete!",
    });
  });

  it("o pedido desconsiderado antes de ser pago e o aprovado fora das datas da campanha não notificam", async () => {
    await aparelhosInscritos(1);
    const servico = servicoDePushFalso();
    vi.spyOn(globalThis, "fetch").mockImplementation(servico.buscar);
    const pago = evento();
    await webhookEDisparo({
      ...pago,
      event: "new_order",
      status: "pending",
      approved_at: null,
    });
    await db
      .prepare(
        `UPDATE pedidos SET desconsiderado_em = '2026-11-27T12:00:00.000Z', desconsiderado_motivo = 'teste'
         WHERE id = ?1`,
      )
      .bind(pago.id)
      .run();
    await webhookEDisparo(pago);
    // A compra de teste antes do 1º dia (20/11).
    await webhookEDisparo(
      evento({ approved_at: "2026-11-20T10:00:00.000-03:00" }),
    );
    expect(servico.recebidos).toHaveLength(0);
  });

  it("com a opção da campanha desligada, ou sem as chaves VAPID, nada vai para o waitUntil", async () => {
    await aparelhosInscritos(1);
    const servico = servicoDePushFalso();
    vi.spyOn(globalThis, "fetch").mockImplementation(servico.buscar);

    // Sem as chaves (o env dos testes: a pública vazia, sem o segredo).
    expect((await webhookEDisparo(evento(), env)).pendentes).toHaveLength(0);
    await db
      .prepare("UPDATE campanhas SET notificacoes_vendas = 0 WHERE ativa = 1")
      .run();
    expect((await webhookEDisparo(evento())).pendentes).toHaveLength(0);
    expect(servico.recebidos).toHaveLength(0);
  });
});

describe("o resultado de cada envio", () => {
  it("404 e 410 apagam a inscrição; outra falha soma; o aceito zera as falhas", async () => {
    const [aceito, sumiu, expirou, falhou, voltou] =
      await aparelhosInscritos(5);
    await db
      .prepare("UPDATE push_inscricoes SET falhas = 3 WHERE endpoint = ?1")
      .bind(voltou.endpoint)
      .run();
    const status = new Map([
      [aceito.endpoint, 201],
      [sumiu.endpoint, 404],
      [expirou.endpoint, 410],
      [falhou.endpoint, 500],
      [voltou.endpoint, 201],
    ]);
    const servico = servicoDePushFalso(
      (endpoint) => new Response(null, { status: status.get(endpoint) }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(servico.buscar);

    await webhookEDisparo(evento());

    const linhas = await inscricoes();
    expect(linhas.map((l) => [l.endpoint, l.falhas])).toEqual([
      [aceito.endpoint, 0],
      [falhou.endpoint, 1],
      [voltou.endpoint, 0],
    ]);
    expect(
      linhas.find((l) => l.endpoint === falhou.endpoint)?.ultimo_envio_em,
    ).toBeNull();
  });

  it(`${FALHAS_PARA_APAGAR} falhas seguidas apagam a inscrição`, async () => {
    const [aparelho] = await aparelhosInscritos(1);
    const servico = servicoDePushFalso(
      () => new Response(null, { status: 503 }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(servico.buscar);
    const campanha = await campanhaAtiva();
    const pago = evento();
    await webhookEDisparo(pago);
    expect((await inscricoes())[0].falhas).toBe(1);
    // As vendas seguintes (o mesmo pedido, direto no disparo: só o resultado importa aqui).
    for (let falhas = 2; falhas < FALHAS_PARA_APAGAR; falhas++) {
      await notificarVendaAprovada(ambiente, campanha, String(pago.id));
      expect((await inscricoes())[0]?.falhas).toBe(falhas);
    }
    await notificarVendaAprovada(ambiente, campanha, String(pago.id));
    expect(await inscricoes()).toEqual([]);
    expect(
      servico.recebidos.every((r) => r.endpoint === aparelho.endpoint),
    ).toBe(true);
    expect(servico.recebidos).toHaveLength(FALHAS_PARA_APAGAR);
  });

  it("o tempo esgotado e a rede contam como falha, e não seguram os outros envios", async () => {
    const [lento, rapido] = await aparelhosInscritos(2);
    const servico = servicoDePushFalso((endpoint) =>
      endpoint === lento.endpoint
        ? Promise.reject(new DOMException("tempo", "TimeoutError"))
        : new Response(null, { status: 201 }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(servico.buscar);
    await webhookEDisparo(evento());
    const linhas = await inscricoes();
    expect(linhas.find((l) => l.endpoint === lento.endpoint)?.falhas).toBe(1);
    expect(
      linhas.find((l) => l.endpoint === rapido.endpoint)?.ultimo_envio_em,
    ).not.toBeNull();
  });
});

describe("o teto de envios por venda", () => {
  it(`é ${LIMITE_ENVIOS_POR_VENDA}; acima dele, avisa no log e a próxima venda começa por quem ficou de fora`, async () => {
    expect(LIMITE_ENVIOS_POR_VENDA).toBe(800);
    const aparelhos = await aparelhosInscritos(5);
    const servico = servicoDePushFalso();
    const pago = evento();
    await webhookEDisparo(
      { ...pago, event: "new_order", status: "pending", approved_at: null },
      env,
    );
    await webhookEDisparo(pago, env);
    const campanha = await campanhaAtiva();
    const opcoes = {
      fetch: servico.buscar,
      limite: 3,
      agora: () => new Date("2026-11-27T13:00:00.000Z"),
    };

    const primeira = await notificarVendaAprovada(
      ambiente,
      campanha,
      String(pago.id),
      opcoes,
    );
    expect(primeira).toEqual({
      situacao: "enviado",
      aceitas: 3,
      expiradas: 0,
      falharam: 0,
      puladas: 2,
    });
    expect(servico.recebidos.map((r) => r.endpoint)).toEqual(
      aparelhos.slice(0, 3).map((a) => a.endpoint),
    );
    const aviso = JSON.stringify(espiaoDoAviso.mock.calls);
    expect(aviso).toContain("notificacoes_acima_do_teto");
    expect(aviso).toContain("Cloudflare Queues");
    for (const aparelho of aparelhos)
      expect(aviso).not.toContain(aparelho.endpoint);

    // A venda seguinte: primeiro os dois que nunca receberam, depois o que recebeu há mais tempo.
    servico.recebidos.length = 0;
    await notificarVendaAprovada(ambiente, campanha, String(pago.id), {
      ...opcoes,
      agora: () => new Date("2026-11-27T13:05:00.000Z"),
    });
    expect(servico.recebidos.map((r) => r.endpoint)).toEqual([
      aparelhos[3].endpoint,
      aparelhos[4].endpoint,
      aparelhos[0].endpoint,
    ]);
  });

  it("sem inscrições, nenhum envio e nenhuma gravação", async () => {
    const servico = servicoDePushFalso();
    const pago = evento();
    await webhookEDisparo(pago, env);
    expect(
      await notificarVendaAprovada(
        ambiente,
        await campanhaAtiva(),
        String(pago.id),
        {
          fetch: servico.buscar,
        },
      ),
    ).toMatchObject({ situacao: "sem_inscricoes" });
    expect(servico.recebidos).toHaveLength(0);
  });
});
