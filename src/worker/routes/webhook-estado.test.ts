// CA3 (RIFA-025, D16): GET /api/admin/webhook/estado com o relógio injetado (criarWebhookCoordenacao), sobre o D1
// dos testes. Cada situação e a prioridade (erros_recentes > sem_entregas_recentes > nunca_recebeu > ok), com os
// limites exatos da janela (HORA_INICIO_ALERTA ≤ hora local < HORA_FIM_ALERTA, "mais de" HORAS_SEM_ENTREGA_ALERTA
// horas), o fuso da campanha, o trim do slug do erro e as contagens. Campanha em America/Belem (UTC−3, sem horário
// de verão): de 2026-11-23 a 2026-12-16 (10 + 7 + 7 dias). Toda resposta passa pelo schema ESTRITO do contrato.
import { env, exports } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import paidOrderOutraCampanha from "../../../test/fixtures/rifei/paid_order.outra_campanha.json";
import {
  HORAS_SEM_ENTREGA_ALERTA,
  HORA_FIM_ALERTA,
  HORA_INICIO_ALERTA,
  ROTAS,
  respostaEstadoWebhookSchema,
  type RespostaEstadoWebhook,
  type ResultadoEventoWebhook,
} from "../../shared/contracts";
import { ESPACOS_DO_TRIM } from "../db/estado-webhook";
import { ORIGEM } from "../test/acesso-teste";
import {
  PREFIXO_WEBHOOK_COORDENACAO,
  criarWebhookCoordenacao,
} from "./webhook-coordenacao";

const db = env.DB;
const SLUG = "videira-kids-estado";

let agora = new Date(0);
const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.route(
  PREFIXO_WEBHOOK_COORDENACAO,
  criarWebhookCoordenacao(() => agora),
);

/** Instante UTC de uma data e hora locais de Belém (UTC−3): "2026-11-25T08:10" → "2026-11-25T11:10:00.000Z". */
const belem = (dataHora: string) =>
  new Date(
    `${dataHora}${dataHora.length === 16 ? ":00" : ""}-03:00`,
  ).toISOString();

async function estado(instante: string): Promise<RespostaEstadoWebhook> {
  agora = new Date(instante);
  const res = await app.request(ROTAS.estadoWebhook.caminho, {}, env);
  expect(res.status).toBe(200);
  return respostaEstadoWebhookSchema.parse(await res.json());
}

const situacao = async (instante: string) => (await estado(instante)).situacao;

async function criarCampanha(
  opcoes: {
    slug?: string;
    fuso?: string;
    inicio?: string;
    ativa?: boolean;
  } = {},
): Promise<number> {
  const campanha = await db
    .prepare(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, fuso_horario, data_inicio, preco_bilhete_centavos,
         meta_unidade, meta_regra, meta_valor, ranking_criterio)
       VALUES ('Campanha do estado', ?1, ?2, ?3, ?4, 2000, 'bilhetes', 'por_pessoa', 10, 'percentual_meta')
       RETURNING id`,
    )
    .bind(
      opcoes.slug ?? SLUG,
      opcoes.ativa === false ? 0 : 1,
      opcoes.fuso ?? "America/Belem",
      opcoes.inicio ?? "2026-11-23",
    )
    .first<{ id: number }>();
  await db
    .prepare(
      `INSERT INTO campanha_periodos (campanha_id, ordem, nome, dias, percentual_bp)
       VALUES (?1, 1, 'Semana 1', 10, 3500), (?1, 2, 'Semana 2', 7, 2500), (?1, 3, 'Semana 3', 7, 4000)`,
    )
    .bind(campanha!.id)
    .run();
  return campanha!.id;
}

/** Uma entrega gravada como o webhook grava (o CHECK de cada resultado). */
async function entrega(
  recebidoEm: string,
  resultado: ResultadoEventoWebhook,
  slug: string | null = SLUG,
): Promise<void> {
  const aceito = resultado !== "erro_validacao";
  const comStatus = ["processado", "duplicado", "ignorado_transicao"].includes(
    resultado,
  );
  await db
    .prepare(
      `INSERT INTO webhook_eventos (recebido_em, evento, pedido_id, slug, resultado, status_anterior,
         status_resultante, payload_redigido, erro, avisos)
       VALUES (?1, 'paid_order', 'PED-ESTADO', ?2, ?3, NULL, ?4, ?5, ?6, NULL)`,
    )
    .bind(
      recebidoEm,
      slug,
      resultado,
      comStatus ? "approved" : null,
      aceito ? "{}" : null,
      aceito
        ? null
        : '[{"caminho":["total"],"codigo":"invalid_type","mensagem":"x","ocorrencias":1}]',
    )
    .run();
}

beforeEach(async () => {
  await db.batch(
    [
      "pedidos_suspeitos",
      "webhook_eventos",
      "pedidos",
      "afiliados",
      "campanha_periodos",
      "campanhas",
    ].map((tabela) => db.prepare(`DELETE FROM ${tabela}`)),
  );
});

it("as constantes da janela são as da D16 (os casos abaixo usam 8h, 22h e 4 h)", () => {
  expect([
    HORA_INICIO_ALERTA,
    HORA_FIM_ALERTA,
    HORAS_SEM_ENTREGA_ALERTA,
  ]).toEqual([8, 22, 4]);
});

describe("sem_entregas_recentes: de dia, num dia da campanha, mais de 4 h sem entrega da campanha", () => {
  beforeEach(async () => {
    await criarCampanha();
  });

  it("manhã sem falso alarme: última venda às 21h30 de ontem e agora 08h10 → ok", async () => {
    await entrega(belem("2026-11-25T21:30"), "processado");
    expect(await situacao(belem("2026-11-26T08:10"))).toBe("ok");
    // A contagem começa às 8h de hoje: só passa de 4 h depois do meio-dia (o limite é "mais de").
    expect(await situacao(belem("2026-11-26T11:59"))).toBe("ok");
    expect(await situacao(belem("2026-11-26T12:00:00.000"))).toBe("ok");
    expect(await situacao(belem("2026-11-26T12:00:00.001"))).toBe(
      "sem_entregas_recentes",
    );
  });

  it("12h do 1º dia sem nenhuma entrega → sem_entregas_recentes (antes disso, nunca_recebeu)", async () => {
    expect(await situacao(belem("2026-11-23T07:59"))).toBe("nunca_recebeu");
    expect(await situacao(belem("2026-11-23T11:59"))).toBe("nunca_recebeu");
    expect(await situacao(belem("2026-11-23T12:00:00.000"))).toBe(
      "nunca_recebeu",
    );
    expect(await situacao(belem("2026-11-23T12:01"))).toBe(
      "sem_entregas_recentes",
    );
  });

  it("de dia: 4 h depois da última entrega da campanha acende; uma entrega nova apaga", async () => {
    await entrega(belem("2026-11-26T13:00"), "processado");
    expect(await situacao(belem("2026-11-26T17:00:00.000"))).toBe("ok");
    expect(await situacao(belem("2026-11-26T17:00:00.001"))).toBe(
      "sem_entregas_recentes",
    );
    // duplicado e ignorado_transicao também são entregas da campanha.
    await entrega(belem("2026-11-26T17:30"), "duplicado");
    expect(await situacao(belem("2026-11-26T21:00"))).toBe("ok");
    await entrega(belem("2026-11-26T21:10"), "ignorado_transicao");
    expect(await situacao(belem("2026-11-27T12:30"))).toBe(
      "sem_entregas_recentes",
    );
  });

  it("noite → não acende: a janela vai de 8h (inclusive) a 22h (exclusive), na hora local", async () => {
    await entrega(belem("2026-11-26T15:00"), "processado");
    expect(await situacao(belem("2026-11-26T21:59:59.999"))).toBe(
      "sem_entregas_recentes",
    );
    expect(await situacao(belem("2026-11-26T22:00"))).toBe("ok");
    expect(await situacao(belem("2026-11-26T23:30"))).toBe("ok");
    expect(await situacao(belem("2026-11-27T03:00"))).toBe("ok");
    expect(await situacao(belem("2026-11-27T07:59:59.999"))).toBe("ok");
    expect(await situacao(belem("2026-11-27T08:00"))).toBe("ok");
  });

  it("só nos dias da campanha (do primeiro ao último, inclusive)", async () => {
    // Antes do início: nunca_recebeu, mesmo de dia.
    expect(await situacao(belem("2026-11-22T15:00"))).toBe("nunca_recebeu");
    await entrega(belem("2026-12-15T20:00"), "processado");
    // Último dia (2026-12-16): ainda acende.
    expect(await situacao(belem("2026-12-16T12:01"))).toBe(
      "sem_entregas_recentes",
    );
    // Depois do fim: não.
    expect(await situacao(belem("2026-12-17T15:00"))).toBe("ok");
  });

  it("slug errado conta como ignorado_outra_campanha: não é entrega da campanha nem apaga o alerta", async () => {
    await entrega(belem("2026-11-26T08:30"), "processado");
    await entrega(
      belem("2026-11-26T14:00"),
      "ignorado_outra_campanha",
      "videira-kids-estadoo",
    );
    // processado com outro slug (ex.: o slug antigo, antes de trocar): também não conta.
    await entrega(belem("2026-11-26T14:10"), "processado", "slug-antigo");
    const resposta = await estado(belem("2026-11-26T14:00:00.000"));
    expect(resposta).toEqual({
      situacao: "sem_entregas_recentes",
      ultima_entrega_em: belem("2026-11-26T14:10"),
      ultima_processada_em: belem("2026-11-26T08:30"),
      ultimo_aprovado_em: null,
      ultimas_24h: {
        processado: 2,
        duplicado: 0,
        ignorado_outra_campanha: 1,
        ignorado_transicao: 0,
        erro_validacao: 0,
      },
      verificado_em: belem("2026-11-26T14:00"),
    });
  });

  it("o fuso é o da campanha (Asia/Kathmandu, UTC+05:45): 12h01 lá acende, à mesma hora que em Belém seria madrugada", async () => {
    await db.prepare("DELETE FROM campanha_periodos").run();
    await db.prepare("DELETE FROM campanhas").run();
    await criarCampanha({ fuso: "Asia/Kathmandu" });
    // 2026-11-25 12:01 em Kathmandu = 06:16Z (03:16 em Belém).
    expect(await situacao("2026-11-25T06:16:00.000Z")).toBe(
      "sem_entregas_recentes",
    );
    expect(await situacao("2026-11-25T06:14:00.000Z")).toBe("nunca_recebeu");
    // 22h em Kathmandu = 16:15Z (13:15 em Belém, que estaria na janela).
    expect(await situacao("2026-11-25T16:15:00.000Z")).toBe("nunca_recebeu");
  });
});

it("ESPACOS_DO_TRIM é exatamente o que o trim() do JavaScript (o do zod) tira das pontas, em todo o plano básico", () => {
  const doTrim: string[] = [];
  for (let codigo = 0; codigo <= 0xffff; codigo++) {
    const letra = String.fromCharCode(codigo);
    if (`${letra}x${letra}`.trim() === "x") doTrim.push(letra);
  }
  expect(doTrim.join("")).toBe(ESPACOS_DO_TRIM);
});

describe("erros_recentes: erro_validacao nas últimas 24 h com slug ausente ou o da campanha", () => {
  beforeEach(async () => {
    await criarCampanha();
    await entrega(belem("2026-11-26T10:00"), "processado");
  });

  it.each([
    ["sem slug", null],
    ["com o slug da campanha", SLUG],
    ["com espaços nas pontas (trim)", `  ${SLUG}\t\n`],
    [
      "com espaço não separável nas pontas (o trim do zod)",
      `\u00a0${SLUG}\u3000`,
    ],
    ["só com espaços (vale como ausente)", "   "],
  ])("%s → erros_recentes", async (_caso, slug) => {
    await entrega(belem("2026-11-26T09:00"), "erro_validacao", slug);
    expect(await situacao(belem("2026-11-26T11:00"))).toBe("erros_recentes");
  });

  it("erro de outra campanha (ou slug só parecido) não acende", async () => {
    await entrega(
      belem("2026-11-26T09:00"),
      "erro_validacao",
      "outra-campanha",
    );
    await entrega(belem("2026-11-26T09:01"), "erro_validacao", `${SLUG}-2`);
    await entrega(
      belem("2026-11-26T09:02"),
      "erro_validacao",
      SLUG.toUpperCase(),
    );
    const resposta = await estado(belem("2026-11-26T11:00"));
    expect(resposta.situacao).toBe("ok");
    expect(resposta.ultimas_24h.erro_validacao).toBe(3);
  });

  it("janela de 24 h: o erro de exatamente 24 h atrás conta; 1 ms antes, não", async () => {
    await entrega(belem("2026-11-25T11:00"), "erro_validacao", null);
    expect(await situacao(belem("2026-11-26T11:00:00.000"))).toBe(
      "erros_recentes",
    );
    expect(await situacao(belem("2026-11-26T11:00:00.001"))).toBe("ok");
  });

  it("prioridade: erros_recentes vence sem_entregas_recentes (e este vence nunca_recebeu)", async () => {
    await db.prepare("DELETE FROM webhook_eventos").run();
    expect(await situacao(belem("2026-11-26T12:01"))).toBe(
      "sem_entregas_recentes",
    );
    await entrega(belem("2026-11-26T12:00"), "erro_validacao", null);
    expect(await situacao(belem("2026-11-26T12:01"))).toBe("erros_recentes");
    // À noite, sem entrega nenhuma da campanha: o erro ainda vence nunca_recebeu.
    expect(await situacao(belem("2026-11-26T23:00"))).toBe("erros_recentes");
    expect(await situacao(belem("2026-11-28T23:00"))).toBe("nunca_recebeu");
  });
});

describe("nunca_recebeu e ok", () => {
  it("sem campanha ativa → nunca_recebeu, mesmo com entregas; o erro sem slug ainda acende", async () => {
    await criarCampanha({ ativa: false });
    await entrega(belem("2026-11-26T10:00"), "processado");
    await entrega(belem("2026-11-26T10:05"), "erro_validacao", SLUG);
    const resposta = await estado(belem("2026-11-26T15:00"));
    expect(resposta).toEqual({
      situacao: "nunca_recebeu",
      ultima_entrega_em: belem("2026-11-26T10:05"),
      ultima_processada_em: null,
      ultimo_aprovado_em: null,
      ultimas_24h: {
        processado: 1,
        duplicado: 0,
        ignorado_outra_campanha: 0,
        ignorado_transicao: 0,
        erro_validacao: 1,
      },
      verificado_em: belem("2026-11-26T15:00"),
    });
    await entrega(belem("2026-11-26T10:06"), "erro_validacao", null);
    expect(await situacao(belem("2026-11-26T15:00"))).toBe("erros_recentes");
  });

  it("banco vazio, sem campanha: nunca_recebeu e tudo nulo ou zero", async () => {
    expect(await estado(belem("2026-11-26T15:00"))).toEqual({
      situacao: "nunca_recebeu",
      ultima_entrega_em: null,
      ultima_processada_em: null,
      ultimo_aprovado_em: null,
      ultimas_24h: {
        processado: 0,
        duplicado: 0,
        ignorado_outra_campanha: 0,
        ignorado_transicao: 0,
        erro_validacao: 0,
      },
      verificado_em: belem("2026-11-26T15:00"),
    });
  });

  it("ok: a última aprovação é a dos pedidos da campanha ativa; as 24 h contam qualquer slug", async () => {
    const campanha = await criarCampanha();
    const outra = await criarCampanha({
      slug: "outra-edicao",
      ativa: false,
      inicio: "2025-11-23",
    });
    await db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, aprovado_em) VALUES
           ('A-1', ?1, 'approved', 1, 2000, '2026-11-26T13:00:00.000Z'),
           ('A-2', ?1, 'approved', 1, 2000, '2026-11-26T14:00:00.000Z'),
           ('A-3', ?1, 'in_process', 1, 2000, NULL),
           ('O-1', ?2, 'approved', 1, 2000, '2026-11-26T17:00:00.000Z')`,
      )
      .bind(campanha, outra)
      .run();
    await entrega(belem("2026-11-25T10:00"), "processado"); // mais de 24 h antes: fora da contagem
    await entrega(belem("2026-11-26T10:00"), "processado");
    await entrega(belem("2026-11-26T11:00"), "duplicado");
    await entrega(belem("2026-11-26T11:30"), "ignorado_transicao");
    await entrega(
      belem("2026-11-26T12:00"),
      "ignorado_outra_campanha",
      "outra-edicao",
    );
    await entrega(belem("2026-11-26T12:30"), "erro_validacao", "outra-edicao");
    expect(await estado(belem("2026-11-26T14:00"))).toEqual({
      situacao: "ok",
      ultima_entrega_em: belem("2026-11-26T12:30"),
      ultima_processada_em: belem("2026-11-26T11:30"),
      ultimo_aprovado_em: "2026-11-26T14:00:00.000Z",
      ultimas_24h: {
        processado: 1,
        duplicado: 1,
        ignorado_outra_campanha: 1,
        ignorado_transicao: 1,
        erro_validacao: 1,
      },
      verificado_em: belem("2026-11-26T14:00"),
    });
  });
});

describe("pelo webhook de verdade", () => {
  it("entrega com o slug errado vira ignorado_outra_campanha e não conta como entrega da campanha", async () => {
    // Campanha no futuro: a situação não depende do dia em que o teste roda.
    await criarCampanha({ slug: "videira-kids-teste", inicio: "2099-01-01" });
    const res = await exports.default.fetch(`${ORIGEM}/api/webhooks/rifei`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RIFEI_WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify(paidOrderOutraCampanha),
    });
    expect(await res.json()).toMatchObject({
      resultado: "ignorado_outra_campanha",
    });
    const resposta = await estado(new Date().toISOString());
    expect(resposta.situacao).toBe("nunca_recebeu");
    expect(resposta.ultima_processada_em).toBeNull();
    expect(resposta.ultima_entrega_em).not.toBeNull();
    expect(resposta.ultimas_24h).toEqual({
      processado: 0,
      duplicado: 0,
      ignorado_outra_campanha: 1,
      ignorado_transicao: 0,
      erro_validacao: 0,
    });
  });
});
