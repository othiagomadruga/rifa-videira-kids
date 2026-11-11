// RIFA-039 (docs/decisions.md D21): o token do webhook da Rifei gerado pela tela da coordenação. Um teste por
// critério do contrato; o banco (migração 0009), as rotas, o webhook e a tela são das tarefas -db, -api e -web.
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { ROTAS_ACESSO, ROTAS_ACESSO_HIERARQUIA } from "./acesso";
import {
  ACOES_AUDITORIA,
  CAMINHOS_WEBHOOK_RIFEI,
  LIMITE_ALVO_AUDITORIA,
  ROTAS,
  ROTAS_REGRAS_CAMPANHA,
  ROTAS_TOKEN_WEBHOOK,
  corpoGerarTokenWebhookSchema,
  detalhesTokenWebhookEmUsoSchema,
  estadoTokenWebhookSchema,
  registroAuditoriaSchema,
  respostaGerarTokenWebhookSchema,
  type EstadoTokenWebhook,
  type RespostaGerarTokenWebhook,
} from "./api";
import { STATUS_HTTP_DO_ERRO } from "./erros";
import * as contrato from "./index";
import { SEGREDO_WEBHOOK_RIFEI } from "./rifei";
import {
  ALVO_AUDITORIA_TOKEN_WEBHOOK,
  BYTES_TOKEN_WEBHOOK,
  CREDENCIAIS_WEBHOOK,
  FORMATO_TOKEN_WEBHOOK,
  credencialVigenteDoWebhook,
  segredoDoWorkerConfigurado,
  ultimoUsoDoWebhook,
} from "./token-webhook";

const GERADO_EM = "2026-11-12T10:00:00.000Z";
const ANTES = "2026-11-12T09:59:59.999Z";
const DEPOIS = "2026-11-12T10:05:00.000Z";
const URL_WEBHOOK = "https://rifa.example/api/webhooks/rifei";
const TOKEN_FICTICIO = "0123456789abcdef".repeat(4);

const aceita = (schema: z.ZodType, valor: unknown) =>
  schema.safeParse(valor).success;

/** O token como a -api o gera: 32 bytes de crypto.getRandomValues em hex minúsculo. */
function gerarComoAApi(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BYTES_TOKEN_WEBHOOK));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Todas as chaves de um valor JSON, em qualquer nível. */
function chavesDe(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(chavesDe);
  if (valor !== null && typeof valor === "object")
    return Object.entries(valor).flatMap(([chave, filho]) => [
      chave,
      ...chavesDe(filho),
    ]);
  return [];
}

const estadoTela: EstadoTokenWebhook = {
  vigente: "tela",
  gerado_em: GERADO_EM,
  ultimo_uso_em: DEPOIS,
  segredo_configurado: true,
  url: URL_WEBHOOK,
};
const estadoSegredo: EstadoTokenWebhook = {
  vigente: "segredo",
  gerado_em: null,
  ultimo_uso_em: ANTES,
  segredo_configurado: true,
  url: URL_WEBHOOK,
};
const estadoNenhum: EstadoTokenWebhook = {
  vigente: null,
  gerado_em: null,
  ultimo_uso_em: null,
  segredo_configurado: false,
  url: "http://localhost:5173/api/webhooks/rifei",
};

describe("D21: o token gerado pela tela", () => {
  it("32 bytes em hex minúsculo: 64 caracteres, só letras e números", () => {
    expect(BYTES_TOKEN_WEBHOOK * 2).toBe(64);
    for (let i = 0; i < 20; i++)
      expect(gerarComoAApi()).toMatch(FORMATO_TOKEN_WEBHOOK);
    expect(TOKEN_FICTICIO).toMatch(FORMATO_TOKEN_WEBHOOK);
    for (const errado of [
      TOKEN_FICTICIO.toUpperCase(),
      TOKEN_FICTICIO.slice(1),
      `${TOKEN_FICTICIO}0`,
      // base64url (o formato dos links de acesso): tem `-` e `_`.
      "TokenFicticioDeTeste_0123456789-abcdefghijk",
      `Bearer ${TOKEN_FICTICIO}`,
      ` ${TOKEN_FICTICIO}`,
      "",
    ])
      expect({ errado, ok: FORMATO_TOKEN_WEBHOOK.test(errado) }).toEqual({
        errado,
        ok: false,
      });
  });

  it("o segredo do Worker continua com o mesmo nome (compatibilidade)", () => {
    expect(SEGREDO_WEBHOOK_RIFEI).toBe("RIFEI_WEBHOOK_TOKEN");
  });
});

describe("D21: a regra quando existem os dois (o token da tela tem prioridade)", () => {
  it("segredo do Worker configurado: existe e não é só espaço (vazio no .dev.vars dá 503, como antes)", () => {
    expect(segredoDoWorkerConfigurado(undefined)).toBe(false);
    expect(segredoDoWorkerConfigurado("")).toBe(false);
    expect(segredoDoWorkerConfigurado("   ")).toBe(false);
    expect(segredoDoWorkerConfigurado("\t\n")).toBe(false);
    expect(segredoDoWorkerConfigurado("token-ficticio")).toBe(true);
  });

  it.each([
    [true, true, "tela"],
    [true, false, "tela"],
    [false, true, "segredo"],
    [false, false, null],
  ] as const)(
    "token da tela %s, segredo %s: vale %s",
    (tokenDaTela, segredoConfigurado, vigente) => {
      expect(
        credencialVigenteDoWebhook({ tokenDaTela, segredoConfigurado }),
      ).toBe(vigente);
    },
  );

  it("as credenciais possíveis", () => {
    expect(CREDENCIAIS_WEBHOOK).toEqual(["tela", "segredo"]);
  });

  it("sem nenhum dos dois, o webhook continua respondendo 503 nao_configurado; token errado, 401", () => {
    expect(STATUS_HTTP_DO_ERRO.nao_configurado).toBe(503);
    expect(STATUS_HTTP_DO_ERRO.nao_autenticado).toBe(401);
  });
});

describe("D21: o último uso, calculado na leitura (o webhook não escreve nada a mais)", () => {
  it("token da tela: só a entrega recebida em ou depois de gerado_em", () => {
    expect(ultimoUsoDoWebhook("tela", GERADO_EM, DEPOIS)).toBe(DEPOIS);
    expect(ultimoUsoDoWebhook("tela", GERADO_EM, GERADO_EM)).toBe(GERADO_EM);
    expect(ultimoUsoDoWebhook("tela", GERADO_EM, ANTES)).toBeNull();
    expect(ultimoUsoDoWebhook("tela", GERADO_EM, null)).toBeNull();
    expect(ultimoUsoDoWebhook("tela", null, DEPOIS)).toBeNull();
  });

  it("segredo do Worker: a última entrega; sem credencial: nada", () => {
    expect(ultimoUsoDoWebhook("segredo", null, ANTES)).toBe(ANTES);
    expect(ultimoUsoDoWebhook("segredo", null, null)).toBeNull();
    expect(ultimoUsoDoWebhook(null, null, DEPOIS)).toBeNull();
  });
});

describe("D21: GET /api/admin/webhook/token (o estado, nunca o token)", () => {
  it("os três estados possíveis", () => {
    for (const estado of [estadoTela, estadoSegredo, estadoNenhum])
      expect(estadoTokenWebhookSchema.parse(estado)).toEqual(estado);
    expect(
      estadoTokenWebhookSchema.parse({
        ...estadoTela,
        segredo_configurado: false,
        ultimo_uso_em: null,
      }),
    ).toEqual({
      ...estadoTela,
      segredo_configurado: false,
      ultimo_uso_em: null,
    });
  });

  it("estrito e sem segredo: só os 5 campos; token, hash ou qualquer outro campo invalida", () => {
    expect(Object.keys(estadoTokenWebhookSchema.shape).sort()).toEqual(
      [
        "gerado_em",
        "segredo_configurado",
        "ultimo_uso_em",
        "url",
        "vigente",
      ].sort(),
    );
    for (const extra of ["token", "token_hash", "hash", "segredo"])
      expect({
        extra,
        ok: aceita(estadoTokenWebhookSchema, {
          ...estadoTela,
          [extra]: TOKEN_FICTICIO,
        }),
      }).toEqual({ extra, ok: false });
  });

  it("a credencial vigente combina com gerado_em e segredo_configurado (o token da tela tem prioridade)", () => {
    for (const errado of [
      // tela sem gerado_em
      { ...estadoTela, gerado_em: null },
      // há token da tela, mas diz que vale o segredo
      { ...estadoSegredo, gerado_em: GERADO_EM, ultimo_uso_em: DEPOIS },
      // segredo sem o segredo configurado
      { ...estadoSegredo, segredo_configurado: false },
      // segredo configurado e nenhuma credencial
      { ...estadoNenhum, segredo_configurado: true },
      // gerado_em sem a credencial da tela
      { ...estadoNenhum, gerado_em: GERADO_EM },
    ])
      expect(aceita(estadoTokenWebhookSchema, errado)).toBe(false);
  });

  it("último uso: nunca sem credencial nem antes de o token da tela ser gerado", () => {
    expect(
      aceita(estadoTokenWebhookSchema, {
        ...estadoNenhum,
        ultimo_uso_em: DEPOIS,
      }),
    ).toBe(false);
    expect(
      aceita(estadoTokenWebhookSchema, { ...estadoTela, ultimo_uso_em: ANTES }),
    ).toBe(false);
    expect(
      aceita(estadoTokenWebhookSchema, {
        ...estadoTela,
        ultimo_uso_em: GERADO_EM,
      }),
    ).toBe(true);
  });

  it("a URL para colar na Rifei é a do webhook (sem barra no fim), em qualquer origem", () => {
    expect(new URL(URL_WEBHOOK).pathname).toBe(CAMINHOS_WEBHOOK_RIFEI[0]);
    for (const errada of [
      "https://rifa.example/api/webhooks/rifei/",
      "https://rifa.example/api/admin/webhook/token",
      "https://rifa.example/",
      "/api/webhooks/rifei",
      "rifa.example/api/webhooks/rifei",
      "ftp://rifa.example/api/webhooks/rifei",
      "https://rifa.example/api/webhooks/rifei?token=x",
      "https://rifa.example/api/webhooks/rifei#x",
      "https://usuario:senha@rifa.example/api/webhooks/rifei",
    ])
      expect({
        errada,
        ok: aceita(estadoTokenWebhookSchema, { ...estadoTela, url: errada }),
      }).toEqual({ errada, ok: false });
  });

  it("instantes no formato único da API", () => {
    expect(
      aceita(estadoTokenWebhookSchema, {
        ...estadoTela,
        gerado_em: "2026-11-12T10:00:00Z",
      }),
    ).toBe(false);
  });
});

describe("D21: POST /api/admin/webhook/token (o token aparece uma vez)", () => {
  it("corpo: substituir é opcional (padrão false) e nada mais é aceito", () => {
    expect(corpoGerarTokenWebhookSchema.parse({})).toEqual({
      substituir: false,
    });
    expect(corpoGerarTokenWebhookSchema.parse({ substituir: true })).toEqual({
      substituir: true,
    });
    for (const errado of [
      { substituir: "sim" },
      { substituir: 1 },
      { substituir: null },
      { substituir: true, token: TOKEN_FICTICIO },
      null,
    ])
      expect(aceita(corpoGerarTokenWebhookSchema, errado)).toBe(false);
  });

  it("201: o token e o estado novo (o da tela, ainda sem uso)", () => {
    const resposta = {
      token: TOKEN_FICTICIO,
      estado: { ...estadoTela, ultimo_uso_em: null },
    };
    expect(respostaGerarTokenWebhookSchema.parse(resposta)).toEqual(resposta);
    for (const errado of [
      { ...resposta, token: TOKEN_FICTICIO.toUpperCase() },
      { ...resposta, token: "curto" },
      { ...resposta, estado: { ...estadoTela, ultimo_uso_em: DEPOIS } },
      { ...resposta, estado: estadoSegredo },
      { ...resposta, estado: estadoNenhum },
      { ...resposta, token_hash: TOKEN_FICTICIO },
      { estado: resposta.estado },
    ])
      expect(aceita(respostaGerarTokenWebhookSchema, errado)).toBe(false);
  });

  it("o token só existe na resposta do POST: o GET não tem a chave em nenhum nível", () => {
    const resposta = respostaGerarTokenWebhookSchema.parse({
      token: TOKEN_FICTICIO,
      estado: { ...estadoTela, ultimo_uso_em: null },
    });
    expect(chavesDe(resposta)).toContain("token");
    for (const estado of [estadoTela, estadoSegredo, estadoNenhum]) {
      const lido = estadoTokenWebhookSchema.parse(estado);
      expect(chavesDe(lido)).not.toContain("token");
      expect(JSON.stringify(lido)).not.toContain(TOKEN_FICTICIO);
    }
    expectTypeOf<RespostaGerarTokenWebhook["token"]>().toEqualTypeOf<string>();
    expectTypeOf<EstadoTokenWebhook>().not.toHaveProperty("token");
  });

  it("409 em_uso diz a credencial que deixaria de valer", () => {
    expect(STATUS_HTTP_DO_ERRO.em_uso).toBe(409);
    for (const vigente of CREDENCIAIS_WEBHOOK)
      expect(detalhesTokenWebhookEmUsoSchema.parse({ vigente })).toEqual({
        vigente,
      });
    for (const errado of [
      { vigente: null },
      { vigente: "worker" },
      {},
      { vigente: "tela", gerado_em: GERADO_EM },
    ])
      expect(aceita(detalhesTokenWebhookEmUsoSchema, errado)).toBe(false);
  });
});

describe("D21: o catálogo das rotas novas", () => {
  const definicoes = Object.values(ROTAS_TOKEN_WEBHOOK);

  it("GET e POST /api/admin/webhook/token: só admin, no grupo da coordenação", () => {
    expect(definicoes.map((rota) => `${rota.metodo} ${rota.caminho}`)).toEqual([
      "GET /api/admin/webhook/token",
      "POST /api/admin/webhook/token",
    ]);
    for (const rota of definicoes) {
      expect(rota.papeis).toEqual(["admin"]);
      expect(rota.grupo).toBe("coordenacao");
      expect(rota.situacao).toBe("detalhada");
      expect(rota.caminho.startsWith("/api/admin/")).toBe(true);
    }
    expect(ROTAS_TOKEN_WEBHOOK.obterTokenWebhook.sucesso).toEqual({
      status: 200,
      corpo: estadoTokenWebhookSchema,
    });
    expect("corpo" in ROTAS_TOKEN_WEBHOOK.obterTokenWebhook).toBe(false);
    expect(ROTAS_TOKEN_WEBHOOK.gerarTokenWebhook.corpo).toBe(
      corpoGerarTokenWebhookSchema,
    );
    expect(ROTAS_TOKEN_WEBHOOK.gerarTokenWebhook.sucesso).toEqual({
      status: 201,
      corpo: respostaGerarTokenWebhookSchema,
    });
  });

  it("não repete rota de nenhum outro catálogo; as entregas e o estado do webhook continuam da coordenação", () => {
    const existentes = new Set(
      [
        ...Object.values(ROTAS),
        ...Object.values(ROTAS_ACESSO),
        ...Object.values(ROTAS_ACESSO_HIERARQUIA),
        ...Object.values(ROTAS_REGRAS_CAMPANHA),
      ].map((rota) => `${rota.metodo} ${rota.caminho}`),
    );
    for (const rota of definicoes)
      expect(existentes.has(`${rota.metodo} ${rota.caminho}`)).toBe(false);
    for (const rota of [ROTAS.entregasWebhook, ROTAS.estadoWebhook]) {
      expect(rota.caminho.startsWith("/api/admin/webhook/")).toBe(true);
      expect("papeis" in rota).toBe(false);
    }
    // O webhook em si continua aberto ao Bearer, fora da sessão.
    expect(ROTAS.webhookRifei.grupo).toBe("rifei_bearer");
  });

  it("o index exporta o catálogo, os schemas e as regras", () => {
    expect(contrato.ROTAS_TOKEN_WEBHOOK).toBe(ROTAS_TOKEN_WEBHOOK);
    expect(contrato.estadoTokenWebhookSchema).toBe(estadoTokenWebhookSchema);
    expect(contrato.credencialVigenteDoWebhook).toBe(
      credencialVigenteDoWebhook,
    );
    expect(contrato.ultimoUsoDoWebhook).toBe(ultimoUsoDoWebhook);
    expect(contrato.FORMATO_TOKEN_WEBHOOK).toBe(FORMATO_TOKEN_WEBHOOK);
  });
});

describe("D21: trilha", () => {
  it("webhook.gerar_token com o alvo `webhook`, nos limites da tabela auditoria", () => {
    expect(ACOES_AUDITORIA).toContain("webhook.gerar_token");
    expect("webhook.gerar_token").toMatch(/^[a-z_.]{3,64}$/);
    expect(ALVO_AUDITORIA_TOKEN_WEBHOOK).toBe("webhook");
    expect(ALVO_AUDITORIA_TOKEN_WEBHOOK.length).toBeLessThanOrEqual(
      LIMITE_ALVO_AUDITORIA,
    );
    const registro = {
      id: 7,
      em: GERADO_EM,
      usuario_id: 1,
      usuario_nome: "Admin Ficticio",
      acao: "webhook.gerar_token",
      alvo: ALVO_AUDITORIA_TOKEN_WEBHOOK,
      resumo:
        "Token do webhook gerado; o anterior, de 2026-11-11T10:00:00.000Z, deixou de valer",
    };
    expect(registroAuditoriaSchema.parse(registro)).toEqual(registro);
  });
});
