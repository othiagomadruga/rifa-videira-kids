/// <reference types="vite/types/importMeta.d.ts" />
// POST /api/webhooks/rifei no workerd, com o D1 local e as migrações aplicadas (RIFA-003, CA1 a CA6).
// O banco é do arquivo de teste (compartilhado entre os testes dele): o beforeEach limpa as tabelas.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import expiredOrder from "../../../test/fixtures/rifei/expired_order.json";
import malformado from "../../../test/fixtures/rifei/malformado.json";
import newOrderAfiliado from "../../../test/fixtures/rifei/new_order.afiliado.json";
import newOrderMinimo from "../../../test/fixtures/rifei/new_order.minimo.json";
import paidOrderAfiliado from "../../../test/fixtures/rifei/paid_order.afiliado.json";
import paidOrderAposExpirado from "../../../test/fixtures/rifei/paid_order.apos_expirado.json";
import paidOrderOficial from "../../../test/fixtures/rifei/paid_order.oficial.json";
import paidOrderOutraCampanha from "../../../test/fixtures/rifei/paid_order.outra_campanha.json";
import {
  derivarTelefone,
  detalhesErroWebhookSchema,
  erroApiSchema,
  eventoWebhookSchema,
  payloadRifeiSchema,
  pedidoSchema,
  redigirPayloadRifei,
  respostaWebhookRifeiSchema,
  type EventoRifei,
  type StatusPedido,
} from "../../shared/contracts";
import app from "../index";

/** Todas as fixtures da pasta (fixture nova entra sozinha no teste de privacidade). */
const TODAS_AS_FIXTURES = import.meta.glob<unknown>(
  "../../../test/fixtures/rifei/*.json",
  { eager: true, import: "default" },
);

const CAMINHO = "/api/webhooks/rifei";
const SLUG = "videira-kids-teste";
const TOKEN = tokenDosTestes();
const db = env.DB;

function tokenDosTestes(): string {
  const token = env.RIFEI_WEBHOOK_TOKEN;
  if (!token)
    throw new Error("RIFEI_WEBHOOK_TOKEN ausente no vitest.config.ts");
  return token;
}

// ---------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------

interface OpcoesEnvio {
  /** Header Authorization; null = sem o header. Padrão: Bearer com o token certo. */
  autorizacao?: string | null;
  /** Corpo cru, no lugar do JSON do payload. */
  corpoCru?: string;
  /** Bindings trocados: a requisição vai direto ao app Hono com este env. */
  env?: Partial<Cloudflare.Env>;
}

async function enviar(
  payload: unknown,
  opcoes: OpcoesEnvio = {},
): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json" });
  const autorizacao =
    opcoes.autorizacao === undefined ? `Bearer ${TOKEN}` : opcoes.autorizacao;
  if (autorizacao !== null) headers.set("Authorization", autorizacao);
  const init = {
    method: "POST",
    headers,
    body: opcoes.corpoCru ?? JSON.stringify(payload),
  };
  if (opcoes.env) return app.request(CAMINHO, init, { ...env, ...opcoes.env });
  return exports.default.fetch(`http://localhost${CAMINHO}`, init);
}

/** Envia e exige 200 com o corpo do contrato. */
async function processar(payload: unknown) {
  const res = await enviar(payload);
  expect(res.status).toBe(200);
  return respostaWebhookRifeiSchema.parse(await res.json());
}

function redigido(fixture: unknown) {
  return redigirPayloadRifei(payloadRifeiSchema.parse(fixture));
}

async function limparBanco(): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM webhook_eventos"),
    db.prepare("DELETE FROM pedidos"),
    db.prepare("DELETE FROM afiliados"),
    db.prepare("DELETE FROM celulas"),
    db.prepare("DELETE FROM discipuladores"),
    db.prepare("DELETE FROM redes"),
    db.prepare("DELETE FROM campanhas"),
  ]);
}

/** Deixa ativa só a campanha deste slug (cria se precisar) e devolve o id dela. */
async function ativarCampanha(slug: string): Promise<number> {
  const [, campanha] = await db.batch<{ id: number }>([
    db.prepare("UPDATE campanhas SET ativa = 0 WHERE ativa = 1"),
    db
      .prepare(
        `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
           meta_unidade, meta_regra, meta_valor, ranking_criterio)
         VALUES ('Campanha de teste', ?1, 1, '2026-11-23', 2000, 'bilhetes', 'por_pessoa', 10,
           'percentual_meta')
         ON CONFLICT (slug_rifei) DO UPDATE SET ativa = 1
         RETURNING id`,
      )
      .bind(slug),
  ]);
  return campanha.results[0].id;
}

async function criarCelula(): Promise<number> {
  const [, , celula] = await db.batch<{ id: number }>([
    db.prepare(
      "INSERT INTO redes (nome, divisao) VALUES ('Rede Ficticia', 'jovens')",
    ),
    db.prepare(
      `INSERT INTO discipuladores (rede_id, nome)
       SELECT id, 'Discipulador Ficticio' FROM redes WHERE nome = 'Rede Ficticia'`,
    ),
    db.prepare(
      `INSERT INTO celulas (discipulador_id, nome, qtd_pessoas, lider_nome)
       SELECT id, 'Célula Ficticia', 12, 'Lider Ficticio' FROM discipuladores
       WHERE nome = 'Discipulador Ficticio'
       RETURNING id`,
    ),
  ]);
  return celula.results[0].id;
}

/** Eventos gravados, em ordem, conferidos contra o schema do contrato (eventoWebhookSchema). */
async function lerEventos() {
  const { results } = await db
    .prepare("SELECT * FROM webhook_eventos ORDER BY id")
    .all<{ payload_redigido: string | null; erro: string | null }>();
  return results.map((linha) =>
    eventoWebhookSchema.parse({
      ...linha,
      payload_redigido:
        linha.payload_redigido === null
          ? null
          : JSON.parse(linha.payload_redigido),
      erro: linha.erro === null ? null : JSON.parse(linha.erro),
    }),
  );
}

type LinhaPedido = Record<string, unknown> & {
  numeros: string | null;
  rifinha: number;
};

/** O pedido como está no banco; também confere que ele se converte no `Pedido` do contrato. */
async function lerPedido(id: string): Promise<LinhaPedido | null> {
  const linha = await db
    .prepare("SELECT * FROM pedidos WHERE id = ?1")
    .bind(id)
    .first<LinhaPedido>();
  if (linha !== null) {
    pedidoSchema.parse({
      ...linha,
      numeros: linha.numeros === null ? null : JSON.parse(linha.numeros),
      rifinha: linha.rifinha === 1,
      utm: {
        source: linha.utm_source,
        campaign: linha.utm_campaign,
        medium: linha.utm_medium,
        content: linha.utm_content,
        term: linha.utm_term,
      },
    });
  }
  return linha;
}

async function lerAfiliados() {
  const { results } = await db
    .prepare("SELECT * FROM afiliados ORDER BY affiliate_id")
    .all();
  return results;
}

async function contar(
  tabela: "webhook_eventos" | "pedidos" | "afiliados",
): Promise<number> {
  const linha = await db
    .prepare(`SELECT count(*) AS total FROM ${tabela}`)
    .first<{ total: number }>();
  return linha?.total ?? 0;
}

/**
 * Textos pessoais de uma fixture: tudo o que há em `buyer` (nome, telefone, e-mail, documento,
 * nascimento, endereço), `observation`, `fbp` e `fbc`, mais o telefone sem "+", sem o país e sem o DDD.
 * Só os de 5+ caracteres, para a busca não acusar coincidências como "SP" ou "123".
 */
function valoresPessoais(fixture: unknown): string[] {
  const { buyer, observation, fbp, fbc } = fixture as Record<string, unknown>;
  const textos: string[] = [];
  const coletar = (valor: unknown): void => {
    if (typeof valor === "string") textos.push(valor);
    else if (typeof valor === "object" && valor !== null)
      Object.values(valor).forEach(coletar);
  };
  [buyer, observation, fbp, fbc].forEach(coletar);
  const telefone = (buyer as Record<string, unknown> | undefined)?.["phone"];
  if (typeof telefone === "string") {
    const digitos = telefone.replace(/\D/g, "");
    const { pais } = derivarTelefone(telefone);
    textos.push(digitos);
    if (pais !== null) {
      const nacional = digitos.slice(pais.length);
      textos.push(nacional, nacional.slice(2));
    }
  }
  return [...new Set(textos)].filter((texto) => texto.length >= 5);
}

/** Procura cada texto em todas as colunas de todas as tabelas; devolve onde cada um aparece. */
async function varrerBanco(textos: readonly string[]) {
  const { results } = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'
       ORDER BY name`,
    )
    .all<{ name: string }>();
  const tabelas = results.map((tabela) => tabela.name);
  const ocorrencias = new Map<string, string[]>(
    textos.map((texto) => [texto, []]),
  );
  for (const tabela of tabelas) {
    const { results: linhas } = await db
      .prepare(`SELECT * FROM "${tabela}"`)
      .all<Record<string, unknown>>();
    for (const linha of linhas) {
      for (const [coluna, valor] of Object.entries(linha)) {
        if (valor === null) continue;
        const celula =
          typeof valor === "string" ? valor : JSON.stringify(valor);
        for (const texto of textos) {
          if (celula.includes(texto))
            ocorrencias.get(texto)?.push(`${tabela}.${coluna}`);
        }
      }
    }
  }
  return { tabelas, ocorrencias };
}

let campanhaId: number;

beforeEach(async () => {
  await limparBanco();
  campanhaId = await ativarCampanha(SLUG);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** new_order.afiliado.json como deve ficar em `pedidos` (sem os instantes nossos). */
function pedidoNovoDoAfiliado() {
  return {
    id: "PEDTESTE0001",
    campanha_id: campanhaId,
    affiliate_id: 1042,
    status: "in_process",
    status_rifei: "in_process",
    status_detail_rifei: "pending",
    qtd_bilhetes: 3,
    numeros: "[101,202,303]",
    subtotal_centavos: 6000,
    total_centavos: 6000,
    desconto_promocao_centavos: null,
    desconto_cupom_centavos: null,
    cupom_id: null,
    metodo_pagamento: "pix",
    rifinha: 0,
    ddd: "91",
    pais: "55",
    utm_source: "whatsapp",
    utm_campaign: "videira-kids",
    utm_medium: "afiliado",
    utm_content: null,
    utm_term: null,
    criado_em: "2026-12-01T12:15:00.000Z",
    expira_em: "2026-12-01T12:45:00.000Z",
    aprovado_em: null,
    expirado_em: null,
  };
}

/** expired_order.json como deve ficar em `pedidos` (sem os instantes nossos). */
function pedidoExpirado() {
  return {
    id: "PEDTESTE0002",
    campanha_id: campanhaId,
    affiliate_id: 1043,
    status: "expired",
    status_rifei: "expired",
    status_detail_rifei: "expired",
    qtd_bilhetes: 2,
    numeros: "[404,505]",
    subtotal_centavos: 4000,
    total_centavos: 3600,
    desconto_promocao_centavos: null,
    desconto_cupom_centavos: 400,
    cupom_id: 77,
    metodo_pagamento: "pix",
    rifinha: 0,
    ddd: null,
    pais: "351",
    utm_source: null,
    utm_campaign: null,
    utm_medium: null,
    utm_content: null,
    utm_term: null,
    criado_em: "2026-12-01T13:00:00.000Z",
    expira_em: "2026-12-01T13:30:00.000Z",
    aprovado_em: null,
    expirado_em: "2026-12-01T13:30:02.104Z",
  };
}

// ---------------------------------------------------------------------------------------------------
// CA1: autenticação (D6)
// ---------------------------------------------------------------------------------------------------

describe("CA1: autenticação do webhook (D6)", () => {
  it.each([
    ["ausente", undefined],
    ["vazio", ""],
    ["só com espaços", "   "],
  ])(
    "segredo %s no Worker: 503 nao_configurado e nada é gravado",
    async (_caso, segredo) => {
      const res = await enviar(newOrderAfiliado, {
        env: { RIFEI_WEBHOOK_TOKEN: segredo },
      });

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        erro: {
          codigo: "nao_configurado",
          mensagem: "O webhook da Rifei não está configurado no servidor",
        },
      });
      expect(await contar("webhook_eventos")).toBe(0);
      expect(await contar("pedidos")).toBe(0);
    },
  );

  it.each([
    ["sem o header Authorization", null],
    ["token errado", "Bearer token-errado"],
    ["token certo com um caractere a mais", `Bearer ${TOKEN}x`],
    ["só o começo do token certo", `Bearer ${TOKEN.slice(0, -1)}`],
    ["token certo sem o esquema", TOKEN],
    ["token certo em outro esquema", `Basic ${TOKEN}`],
    ["esquema sem token", "Bearer "],
  ])("%s: 401 nao_autenticado e nada é gravado", async (_caso, autorizacao) => {
    const res = await enviar(newOrderAfiliado, { autorizacao });

    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(await res.json()).toEqual({
      erro: {
        codigo: "nao_autenticado",
        mensagem: "Token do webhook ausente ou inválido",
      },
    });
    expect(await contar("webhook_eventos")).toBe(0);
    expect(await contar("pedidos")).toBe(0);
    expect(await contar("afiliados")).toBe(0);
  });

  it("segredo e token vêm antes do corpo: corpo inválido sem autenticação não é lido nem gravado", async () => {
    const semSegredo = await enviar(null, {
      corpoCru: "isto não é json",
      env: { RIFEI_WEBHOOK_TOKEN: undefined },
    });
    const semToken = await enviar(null, {
      corpoCru: "isto não é json",
      autorizacao: "Bearer token-errado",
    });

    expect(semSegredo.status).toBe(503);
    expect(semToken.status).toBe(401);
    expect(await contar("webhook_eventos")).toBe(0);
  });

  it.each([
    ["como a Rifei manda", `Bearer ${TOKEN}`],
    ["esquema em minúsculas", `bearer ${TOKEN}`],
    ["espaços a mais", `BEARER   ${TOKEN}`],
  ])("token certo (%s) é aceito", async (_caso, autorizacao) => {
    const res = await enviar(newOrderAfiliado, { autorizacao });

    expect(res.status).toBe(200);
    expect(respostaWebhookRifeiSchema.parse(await res.json()).resultado).toBe(
      "processado",
    );
  });

  it("compara o token em tempo constante: timingSafeEqual sobre dois resumos de 32 bytes", async () => {
    const comparar = vi.spyOn(crypto.subtle, "timingSafeEqual");

    const res = await enviar(newOrderAfiliado, {
      autorizacao: "Bearer x",
      env: {},
    });

    expect(res.status).toBe(401);
    expect(comparar).toHaveBeenCalledOnce();
    const [resumoRecebido, resumoEsperado] = comparar.mock.calls[0];
    expect([resumoRecebido.byteLength, resumoEsperado.byteLength]).toEqual([
      32, 32,
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA2: validação (D9)
// ---------------------------------------------------------------------------------------------------

describe("CA2: payload malformado (D9)", () => {
  it("malformado.json: 400 payload_invalido com os problemas, evento erro_validacao sem dado pessoal", async () => {
    const res = await enviar(malformado);

    expect(res.status).toBe(400);
    const texto = await res.text();
    const { erro } = erroApiSchema.parse(JSON.parse(texto));
    expect(erro.codigo).toBe("payload_invalido");
    expect(erro.mensagem).toBe(
      "O corpo não segue o formato do webhook da Rifei",
    );
    const detalhes = detalhesErroWebhookSchema.parse(erro.detalhes);
    expect(
      detalhes.problemas.map((problema) => problema.caminho.join(".")),
    ).toEqual(
      expect.arrayContaining([
        "event",
        "id",
        "is_rifinha",
        "numbers_count",
        "subtotal",
        "total",
        "affiliate_id",
        "created_at",
      ]),
    );

    expect(await lerEventos()).toEqual([
      {
        id: detalhes.evento_id,
        recebido_em: expect.any(String),
        evento: "order_refunded",
        pedido_id: null,
        slug: SLUG,
        resultado: "erro_validacao",
        status_anterior: null,
        status_resultante: null,
        payload_redigido: null,
        erro: detalhes.problemas,
      },
    ]);
    expect(await contar("pedidos")).toBe(0);
    expect(await contar("afiliados")).toBe(0);

    const linhaGravada = JSON.stringify(
      await db.prepare("SELECT * FROM webhook_eventos").all(),
    );
    const pessoais = valoresPessoais(malformado);
    expect(pessoais).toEqual(
      expect.arrayContaining([
        "Comprador Ficticio Malformado",
        "malformado@example.com",
        "00000000000",
        "31/12/1999",
        "+5591900000009",
      ]),
    );
    for (const valor of pessoais) {
      expect(texto).not.toContain(valor);
      expect(linhaGravada).not.toContain(valor);
    }
  });

  it.each([
    ["JSON truncado", JSON.stringify(newOrderAfiliado).slice(0, -20)],
    ["corpo vazio", ""],
  ])(
    "%s: 400 json_invalido, evento erro_validacao sem identificação e sem trecho do corpo",
    async (_caso, corpoCru) => {
      const res = await enviar(null, { corpoCru });

      expect(res.status).toBe(400);
      const texto = await res.text();
      const { erro } = erroApiSchema.parse(JSON.parse(texto));
      expect(erro.codigo).toBe("json_invalido");
      const detalhes = detalhesErroWebhookSchema.parse(erro.detalhes);
      expect(detalhes.problemas).toEqual([
        {
          caminho: [],
          codigo: "json_invalido",
          mensagem: "O corpo da requisição não é um JSON válido",
        },
      ]);
      expect(await lerEventos()).toEqual([
        {
          id: detalhes.evento_id,
          recebido_em: expect.any(String),
          evento: null,
          pedido_id: null,
          slug: null,
          resultado: "erro_validacao",
          status_anterior: null,
          status_resultante: null,
          payload_redigido: null,
          erro: detalhes.problemas,
        },
      ]);
      for (const valor of valoresPessoais(newOrderAfiliado)) {
        expect(texto).not.toContain(valor);
      }
    },
  );

  it.each([
    ["uma lista", [newOrderAfiliado]],
    ["um texto", "pedido"],
    ["null", null],
  ])(
    "JSON que não é objeto (%s): 400 payload_invalido",
    async (_caso, corpo) => {
      const res = await enviar(corpo);

      expect(res.status).toBe(400);
      const { erro } = erroApiSchema.parse(await res.json());
      expect(erro.codigo).toBe("payload_invalido");
      const [evento] = await lerEventos();
      expect(evento).toMatchObject({
        id: detalhesErroWebhookSchema.parse(erro.detalhes).evento_id,
        resultado: "erro_validacao",
        evento: null,
        pedido_id: null,
        slug: null,
        payload_redigido: null,
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------------
// CA3: só a campanha ativa (D5)
// ---------------------------------------------------------------------------------------------------

describe("CA3: filtro pela campanha ativa (D5)", () => {
  it("slug de outra campanha da conta: 200 ignorado_outra_campanha, evento com o payload redigido e nada mais", async () => {
    const outraComAfiliado = { ...paidOrderOutraCampanha, affiliate_id: 5555 };

    const resposta = await processar(outraComAfiliado);

    expect(resposta).toEqual({
      resultado: "ignorado_outra_campanha",
      evento_id: expect.any(Number),
    });
    expect(await lerEventos()).toEqual([
      {
        id: resposta.evento_id,
        recebido_em: expect.any(String),
        evento: "paid_order",
        pedido_id: "PEDOUTRA0001",
        slug: "outra-campanha-da-conta",
        resultado: "ignorado_outra_campanha",
        status_anterior: null,
        status_resultante: null,
        payload_redigido: redigido(outraComAfiliado),
        erro: null,
      },
    ]);
    expect(await contar("pedidos")).toBe(0);
    expect(await contar("afiliados")).toBe(0);
  });

  it("sem campanha ativa, todo evento é ignorado_outra_campanha e fica guardado (redigido) para reprocessar", async () => {
    await db.prepare("UPDATE campanhas SET ativa = 0").run();

    const resposta = await processar(newOrderAfiliado);

    expect(resposta.resultado).toBe("ignorado_outra_campanha");
    const [evento] = await lerEventos();
    expect(evento.payload_redigido).toEqual(redigido(newOrderAfiliado));
    expect(await contar("pedidos")).toBe(0);
    expect(await contar("afiliados")).toBe(0);
  });

  it("campanha com o mesmo slug, mas inativa, não conta; depois de ativada, o evento é processado", async () => {
    const outraId = await ativarCampanha("outra-campanha-da-conta");
    await ativarCampanha(SLUG);

    const inativa = await processar(paidOrderOutraCampanha);
    await ativarCampanha("outra-campanha-da-conta");
    const ativa = await processar(paidOrderOutraCampanha);

    expect(inativa.resultado).toBe("ignorado_outra_campanha");
    expect(ativa.resultado).toBe("processado");
    expect(await lerPedido("PEDOUTRA0001")).toMatchObject({
      campanha_id: outraId,
      status: "approved",
    });
  });

  it("o slug é comparado exatamente (maiúsculas contam)", async () => {
    const resposta = await processar({
      ...newOrderAfiliado,
      slug: SLUG.toUpperCase(),
    });

    expect(resposta.resultado).toBe("ignorado_outra_campanha");
    expect(await contar("pedidos")).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA4: gravação do pedido (D2, D7, D8)
// ---------------------------------------------------------------------------------------------------

describe("CA4: gravação do pedido", () => {
  it("new_order cria o pedido in_process: centavos, UTC, DDD e país do telefone, utm", async () => {
    const antes = Date.now();
    const resposta = await processar(newOrderAfiliado);
    const depois = Date.now();

    expect(resposta).toEqual({
      resultado: "processado",
      evento_id: expect.any(Number),
    });
    const [evento] = await lerEventos();
    expect(Date.parse(evento.recebido_em)).toBeGreaterThanOrEqual(antes);
    expect(Date.parse(evento.recebido_em)).toBeLessThanOrEqual(depois);
    expect(evento).toEqual({
      id: resposta.evento_id,
      recebido_em: evento.recebido_em,
      evento: "new_order",
      pedido_id: "PEDTESTE0001",
      slug: SLUG,
      resultado: "processado",
      status_anterior: null,
      status_resultante: "in_process",
      payload_redigido: redigido(newOrderAfiliado),
      erro: null,
    });
    expect(await lerPedido("PEDTESTE0001")).toEqual({
      ...pedidoNovoDoAfiliado(),
      registrado_em: evento.recebido_em,
      atualizado_em: evento.recebido_em,
    });
  });

  it("affiliate_id desconhecido cria o afiliado não vinculado (fila de órfãos) e a venda fica sem célula", async () => {
    await processar(newOrderAfiliado);
    await processar(paidOrderAfiliado);

    const [primeiro] = await lerEventos();
    expect(await lerAfiliados()).toEqual([
      {
        affiliate_id: 1042,
        celula_id: null,
        rotulo: null,
        origem: "webhook",
        criado_em: primeiro.recebido_em,
        vinculado_em: null,
        atualizado_em: primeiro.recebido_em,
      },
    ]);
    const { results } = await db
      .prepare(
        "SELECT pedido_id, affiliate_id, celula_id FROM vendas_aprovadas",
      )
      .all();
    expect(results).toEqual([
      { pedido_id: "PEDTESTE0001", affiliate_id: 1042, celula_id: null },
    ]);
  });

  it("afiliado já vinculado pela coordenação não muda, e a venda aprovada é atribuída à célula dele (D7)", async () => {
    const celulaId = await criarCelula();
    await db
      .prepare(
        `INSERT INTO afiliados (affiliate_id, celula_id, rotulo, origem, vinculado_em)
         VALUES (1042, ?1, 'usuario do lider', 'manual', '2026-11-10T22:00:00.000Z')`,
      )
      .bind(celulaId)
      .run();
    const afiliadosAntes = await lerAfiliados();

    await processar(newOrderAfiliado);
    await processar(paidOrderAfiliado);

    expect(await lerAfiliados()).toEqual(afiliadosAntes);
    const { results } = await db
      .prepare(
        `SELECT pedido_id, affiliate_id, celula_id, qtd_bilhetes, total_centavos, aprovado_em, ddd, pais
         FROM vendas_aprovadas`,
      )
      .all();
    expect(results).toEqual([
      {
        pedido_id: "PEDTESTE0001",
        affiliate_id: 1042,
        celula_id: celulaId,
        qtd_bilhetes: 3,
        total_centavos: 6000,
        aprovado_em: "2026-12-01T12:20:31.512Z",
        ddd: "91",
        pais: "55",
      },
    ]);
  });

  it("paid_order aprova o pedido com os dados do evento; registrado_em não muda", async () => {
    await processar(newOrderAfiliado);
    const resposta = await processar(paidOrderAfiliado);

    const [novo, pago] = await lerEventos();
    expect(pago).toMatchObject({
      id: resposta.evento_id,
      evento: "paid_order",
      resultado: "processado",
      status_anterior: "in_process",
      status_resultante: "approved",
    });
    expect(await lerPedido("PEDTESTE0001")).toEqual({
      ...pedidoNovoDoAfiliado(),
      status: "approved",
      status_rifei: "approved",
      status_detail_rifei: "accredited",
      aprovado_em: "2026-12-01T12:20:31.512Z",
      registrado_em: novo.recebido_em,
      atualizado_em: pago.recebido_em,
    });
  });

  it("expired_order expira o pedido (telefone de Portugal: só o país; cupom em centavos)", async () => {
    const resposta = await processar(expiredOrder);

    const [evento] = await lerEventos();
    expect(evento).toMatchObject({
      id: resposta.evento_id,
      resultado: "processado",
      status_anterior: null,
      status_resultante: "expired",
    });
    expect(await lerPedido("PEDTESTE0002")).toEqual({
      ...pedidoExpirado(),
      registrado_em: evento.recebido_em,
      atualizado_em: evento.recebido_em,
    });
  });

  it("pedido sem affiliate_id fica sem afiliado e os campos ausentes viram null", async () => {
    await processar(newOrderMinimo);
    await processar({
      ...newOrderMinimo,
      id: "PEDTESTE0004",
      is_rifinha: true,
    });

    const [evento] = await lerEventos();
    expect(await lerPedido("PEDTESTE0003")).toEqual({
      id: "PEDTESTE0003",
      campanha_id: campanhaId,
      affiliate_id: null,
      status: "in_process",
      status_rifei: "in_process",
      status_detail_rifei: "pending",
      qtd_bilhetes: 1,
      numeros: null,
      subtotal_centavos: 2000,
      total_centavos: 2000,
      desconto_promocao_centavos: null,
      desconto_cupom_centavos: null,
      cupom_id: null,
      metodo_pagamento: "pix",
      rifinha: 0,
      ddd: "91",
      pais: "55",
      utm_source: null,
      utm_campaign: null,
      utm_medium: null,
      utm_content: null,
      utm_term: null,
      criado_em: "2026-12-03T22:00:00.000Z",
      expira_em: "2026-12-03T22:30:00.000Z",
      aprovado_em: null,
      expirado_em: null,
      registrado_em: evento.recebido_em,
      atualizado_em: evento.recebido_em,
    });
    expect(await lerPedido("PEDTESTE0004")).toMatchObject({ rifinha: 1 });
    expect(await contar("afiliados")).toBe(0);
  });

  it("exemplo oficial da Rifei: reais com centavos viram centavos inteiros e o utm completo é guardado", async () => {
    const demonstracao = await ativarCampanha("demonstracao");

    await processar(paidOrderOficial);

    const [evento] = await lerEventos();
    expect(await lerPedido("XXXXXXXXXXX")).toEqual({
      id: "XXXXXXXXXXX",
      campanha_id: demonstracao,
      affiliate_id: null,
      status: "approved",
      status_rifei: "approved",
      status_detail_rifei: "changed_by_admin",
      qtd_bilhetes: 5,
      numeros: "[5172,56653,78399,37669,14891]",
      subtotal_centavos: 250,
      total_centavos: 125,
      desconto_promocao_centavos: 125,
      desconto_cupom_centavos: null,
      cupom_id: null,
      metodo_pagamento: "pix",
      rifinha: 0,
      ddd: "99",
      pais: "55",
      utm_source: "facebook",
      utm_campaign: "demonstracao",
      utm_medium: "cpc",
      utm_content: "link1",
      utm_term: "term1",
      criado_em: "2024-08-23T14:28:45.035Z",
      expira_em: "2024-08-23T15:27:44.892Z",
      aprovado_em: "2024-08-23T15:09:29.243Z",
      expirado_em: null,
      registrado_em: evento.recebido_em,
      atualizado_em: evento.recebido_em,
    });
  });

  it("pedido aprovado sem approved_at recebe o instante do recebimento em aprovado_em", async () => {
    await processar({ ...paidOrderAfiliado, approved_at: null });

    const [evento] = await lerEventos();
    expect(await lerPedido("PEDTESTE0001")).toMatchObject({
      status: "approved",
      aprovado_em: evento.recebido_em,
    });
  });
});

describe("CA4: afiliado ao atualizar um pedido que já existe (D7)", () => {
  const pagoSemAffiliateId: Record<string, unknown> = { ...paidOrderAfiliado };
  delete pagoSemAffiliateId["affiliate_id"];

  it.each<[string, unknown]>([
    ["null", { ...paidOrderAfiliado, affiliate_id: null }],
    ["ausente", pagoSemAffiliateId],
    ["igual ao gravado", paidOrderAfiliado],
  ])(
    "evento posterior com affiliate_id %s mantém o afiliado gravado e não gera aviso",
    async (_caso, pago) => {
      const consoleWarn = vi.spyOn(console, "warn");
      await processar(newOrderAfiliado);

      const resposta = await processar(pago);

      expect(resposta.resultado).toBe("processado");
      expect(await lerPedido("PEDTESTE0001")).toMatchObject({
        status: "approved",
        affiliate_id: 1042,
      });
      const { results } = await db
        .prepare("SELECT pedido_id, affiliate_id FROM vendas_aprovadas")
        .all();
      expect(results).toEqual([
        { pedido_id: "PEDTESTE0001", affiliate_id: 1042 },
      ]);
      expect(consoleWarn).not.toHaveBeenCalled();
    },
  );

  it.each<[string, number | null]>([
    ["outro afiliado", 1042],
    ["pedido sem afiliado", null],
  ])(
    "evento posterior com outro affiliate_id (%s): vale o do evento, e a troca vai para o log sem dado pessoal",
    async (_caso, anterior) => {
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      await processar({ ...newOrderAfiliado, affiliate_id: anterior });

      const resposta = await processar({
        ...paidOrderAfiliado,
        affiliate_id: 1043,
      });

      expect(resposta.resultado).toBe("processado");
      expect(await lerPedido("PEDTESTE0001")).toMatchObject({
        status: "approved",
        affiliate_id: 1043,
      });
      expect(
        (await lerAfiliados()).map((afiliado) => afiliado["affiliate_id"]),
      ).toEqual(anterior === null ? [1043] : [1042, 1043]);
      expect(consoleWarn).toHaveBeenCalledOnce();
      expect(consoleWarn).toHaveBeenCalledWith({
        aviso: "afiliado_alterado",
        mensagem:
          "webhook Rifei: o evento trouxe um affiliate_id diferente do gravado no pedido; vale o do evento",
        evento_id: resposta.evento_id,
        pedido_id: "PEDTESTE0001",
        affiliate_id_anterior: anterior,
        affiliate_id_novo: 1043,
      });
      const log = JSON.stringify(consoleWarn.mock.calls);
      for (const valor of valoresPessoais(paidOrderAfiliado)) {
        expect(log).not.toContain(valor);
      }
      // No banco, cada evento guarda o affiliate_id que trouxe (o anterior está no evento de antes).
      expect(
        (await lerEventos()).map(
          (evento) => evento.payload_redigido?.affiliate_id,
        ),
      ).toEqual([anterior, 1043]);
    },
  );
});

// ---------------------------------------------------------------------------------------------------
// CA5: idempotência e ordem (D3, D4)
// ---------------------------------------------------------------------------------------------------

describe("CA5: idempotência e ordem dos eventos (D3, D4)", () => {
  it.each([
    ["new_order", newOrderAfiliado, "PEDTESTE0001", "in_process"],
    ["paid_order", paidOrderAfiliado, "PEDTESTE0001", "approved"],
    ["expired_order", expiredOrder, "PEDTESTE0002", "expired"],
  ])(
    "%s entregue duas vezes: um pedido só, sem mudança, e a 2ª entrega fica como duplicado",
    async (_evento, fixture, pedidoId, status) => {
      const primeira = await processar(fixture);
      const pedidoDepoisDaPrimeira = await lerPedido(pedidoId);
      const segunda = await processar(fixture);

      expect(primeira.resultado).toBe("processado");
      expect(segunda).toEqual({
        resultado: "duplicado",
        evento_id: expect.any(Number),
      });
      expect(segunda.evento_id).not.toBe(primeira.evento_id);
      expect(await lerPedido(pedidoId)).toEqual(pedidoDepoisDaPrimeira);
      expect(await contar("pedidos")).toBe(1);
      expect(
        (await lerEventos()).map((evento) => [
          evento.resultado,
          evento.status_anterior,
          evento.status_resultante,
        ]),
      ).toEqual([
        ["processado", null, status],
        ["duplicado", status, status],
      ]);
    },
  );

  it("paid_order antes do new_order cria o pedido já aprovado; o new_order atrasado é ignorado_transicao", async () => {
    const pago = await processar(paidOrderAfiliado);
    const pedidoAprovado = await lerPedido("PEDTESTE0001");
    const novo = await processar(newOrderAfiliado);

    expect(pago.resultado).toBe("processado");
    expect(pedidoAprovado).toMatchObject({
      status: "approved",
      aprovado_em: "2026-12-01T12:20:31.512Z",
    });
    expect(novo.resultado).toBe("ignorado_transicao");
    expect(await lerPedido("PEDTESTE0001")).toEqual(pedidoAprovado);
    expect(
      (await lerEventos()).map((evento) => [
        evento.evento,
        evento.resultado,
        evento.status_anterior,
        evento.status_resultante,
      ]),
    ).toEqual([
      ["paid_order", "processado", null, "approved"],
      ["new_order", "ignorado_transicao", "approved", "approved"],
    ]);
  });

  it("expired_order depois de approved é ignorado_transicao e não desaprova", async () => {
    await processar(paidOrderAposExpirado);
    const pedidoAprovado = await lerPedido("PEDTESTE0002");

    const expirado = await processar(expiredOrder);

    expect(pedidoAprovado).toMatchObject({ status: "approved" });
    expect(expirado.resultado).toBe("ignorado_transicao");
    expect(await lerPedido("PEDTESTE0002")).toEqual(pedidoAprovado);
    const [, evento] = await lerEventos();
    expect(evento).toMatchObject({
      evento: "expired_order",
      resultado: "ignorado_transicao",
      status_anterior: "approved",
      status_resultante: "approved",
    });
  });

  it("paid_order depois de expired_order aprova (pago depois de expirar)", async () => {
    await processar(expiredOrder);
    const resposta = await processar(paidOrderAposExpirado);

    expect(resposta.resultado).toBe("processado");
    const [expirou, pagou] = await lerEventos();
    expect(pagou).toMatchObject({
      status_anterior: "expired",
      status_resultante: "approved",
    });
    expect(await lerPedido("PEDTESTE0002")).toEqual({
      ...pedidoExpirado(),
      status: "approved",
      status_rifei: "approved",
      status_detail_rifei: "accredited",
      aprovado_em: "2026-12-01T13:41:09.877Z",
      registrado_em: expirou.recebido_em,
      atualizado_em: pagou.recebido_em,
    });
  });

  const EVENTO_QUE_LEVA_A: Record<StatusPedido, EventoRifei> = {
    in_process: "new_order",
    approved: "paid_order",
    expired: "expired_order",
  };

  // Tabela da máquina de estados (docs/integracao-rifei.md, seção 5), escrita aqui de forma independente.
  it.each<[StatusPedido | null, EventoRifei, string, StatusPedido]>([
    [null, "new_order", "processado", "in_process"],
    [null, "paid_order", "processado", "approved"],
    [null, "expired_order", "processado", "expired"],
    ["in_process", "new_order", "duplicado", "in_process"],
    ["in_process", "paid_order", "processado", "approved"],
    ["in_process", "expired_order", "processado", "expired"],
    ["expired", "new_order", "ignorado_transicao", "expired"],
    ["expired", "paid_order", "processado", "approved"],
    ["expired", "expired_order", "duplicado", "expired"],
    ["approved", "new_order", "ignorado_transicao", "approved"],
    ["approved", "paid_order", "duplicado", "approved"],
    ["approved", "expired_order", "ignorado_transicao", "approved"],
  ])(
    "pedido %s + %s → %s, status final %s",
    async (inicial, evento, resultado, final) => {
      if (inicial !== null) {
        await processar({
          ...newOrderAfiliado,
          event: EVENTO_QUE_LEVA_A[inicial],
        });
      }

      const resposta = await processar({ ...newOrderAfiliado, event: evento });

      expect(resposta.resultado).toBe(resultado);
      expect((await lerPedido("PEDTESTE0001"))?.["status"]).toBe(final);
      const ultimo = (await lerEventos()).at(-1);
      expect([ultimo?.status_anterior, ultimo?.status_resultante]).toEqual([
        inicial,
        final,
      ]);
    },
  );

  /** D1 em que, antes da primeira gravação (db.batch), outra entrega acontece inteira. */
  function dbComEntregaNoMeio(payloadDaOutra: unknown) {
    const estado: { outra?: Response } = {};
    const dbComCorrida = new Proxy(db, {
      get(alvo, propriedade) {
        if (propriedade === "batch") {
          return async (comandos: D1PreparedStatement[]) => {
            estado.outra ??= await enviar(payloadDaOutra);
            return alvo.batch(comandos);
          };
        }
        const valor: unknown = Reflect.get(alvo, propriedade, alvo);
        return typeof valor === "function" ? valor.bind(alvo) : valor;
      },
    });
    return { db: dbComCorrida, estado };
  }

  it("duas entregas simultâneas do mesmo evento: uma fica processado e a outra duplicado", async () => {
    const corrida = dbComEntregaNoMeio(newOrderAfiliado);

    const res = await enviar(newOrderAfiliado, { env: { DB: corrida.db } });

    const outra = respostaWebhookRifeiSchema.parse(
      await corrida.estado.outra?.json(),
    );
    expect(outra.resultado).toBe("processado");
    expect(await res.json()).toEqual({
      resultado: "duplicado",
      evento_id: expect.any(Number),
    });
    expect(await contar("pedidos")).toBe(1);
    expect(
      (await lerEventos()).map((evento) => [
        evento.resultado,
        evento.status_anterior,
        evento.status_resultante,
      ]),
    ).toEqual([
      ["processado", null, "in_process"],
      ["duplicado", "in_process", "in_process"],
    ]);
  });

  it("várias entregas simultâneas do mesmo evento: exatamente uma fica processado", async () => {
    const respostas = await Promise.all(
      Array.from({ length: 5 }, () => enviar(paidOrderAfiliado, { env: {} })),
    );

    const resultados = await Promise.all(
      respostas.map(
        async (res) =>
          respostaWebhookRifeiSchema.parse(await res.json()).resultado,
      ),
    );
    expect(resultados.sort()).toEqual([
      "duplicado",
      "duplicado",
      "duplicado",
      "duplicado",
      "processado",
    ]);
    expect(await contar("pedidos")).toBe(1);
    expect(await contar("webhook_eventos")).toBe(5);
  });

  it("entrega simultânea de outro evento do mesmo pedido: o status mudou entre a leitura e a gravação, e a decisão é refeita", async () => {
    const corrida = dbComEntregaNoMeio(paidOrderAfiliado);

    const res = await enviar(newOrderAfiliado, { env: { DB: corrida.db } });

    expect(corrida.estado.outra?.status).toBe(200);
    expect(await res.json()).toEqual({
      resultado: "ignorado_transicao",
      evento_id: expect.any(Number),
    });
    expect(await lerPedido("PEDTESTE0001")).toMatchObject({
      status: "approved",
      aprovado_em: "2026-12-01T12:20:31.512Z",
    });
    expect(
      (await lerEventos()).map((evento) => [
        evento.evento,
        evento.resultado,
        evento.status_anterior,
        evento.status_resultante,
      ]),
    ).toEqual([
      ["paid_order", "processado", null, "approved"],
      ["new_order", "ignorado_transicao", "approved", "approved"],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA6: privacidade (D1)
// ---------------------------------------------------------------------------------------------------

describe("CA6: nenhum dado pessoal de comprador no banco (D1)", () => {
  it("depois de todas as fixtures (processadas, ignoradas e rejeitadas), nenhuma coluna de nenhuma tabela tem dado pessoal", async () => {
    const fixtures = Object.values(TODAS_AS_FIXTURES);
    expect(fixtures.length).toBeGreaterThanOrEqual(8);

    for (const fixture of fixtures) {
      // 1) Campanha do slug da fixture ativa: processamento completo (afiliado, pedido e evento).
      const { slug } = fixture as Record<string, unknown>;
      if (typeof slug === "string") await ativarCampanha(slug);
      await enviar(fixture);
      // 2) Outra campanha ativa: ignorado_outra_campanha, com o payload redigido guardado.
      await ativarCampanha("campanha-de-controle");
      await enviar(fixture);
      // 3) Os mesmos dados num corpo truncado (JSON inválido).
      await enviar(null, { corpoCru: JSON.stringify(fixture).slice(0, -20) });
    }

    expect(await contar("webhook_eventos")).toBe(fixtures.length * 3);
    const resultados = new Set((await lerEventos()).map((e) => e.resultado));
    expect(resultados).toEqual(
      new Set(["processado", "ignorado_outra_campanha", "erro_validacao"]),
    );

    const pessoais = [...new Set(fixtures.flatMap(valoresPessoais))];
    expect(pessoais).toEqual(
      expect.arrayContaining([
        "Fulano de Tal",
        "+5599999999999",
        "12345678909",
        "20/01/2000",
        "Rua de exemplo",
        "01001000",
        "Comprador Ficticio Um",
        "comprador.um@example.com",
        "01/01/1990",
        "91900000001",
        "Rua Ficticia",
        "Bairro Ficticio",
        "Texto livre ficticio do checkout",
      ]),
    );
    // Controle: dados não pessoais que precisam estar gravados (a varredura enxerga cada tabela).
    const controles = {
      PEDTESTE0001: "pedidos.id",
      whatsapp: "pedidos.utm_source",
      "1042": "afiliados.affiliate_id",
      '"comprador":{"ddd":"91","pais":"55"}':
        "webhook_eventos.payload_redigido",
    };

    const { tabelas, ocorrencias } = await varrerBanco([
      ...pessoais,
      ...Object.keys(controles),
    ]);

    expect(tabelas).toEqual(
      expect.arrayContaining([
        "afiliados",
        "campanhas",
        "pedidos",
        "webhook_eventos",
      ]),
    );
    const vazamentos = pessoais.flatMap((valor) =>
      (ocorrencias.get(valor) ?? []).map((lugar) => `${lugar}: ${valor}`),
    );
    expect(vazamentos).toEqual([]);
    for (const [controle, lugar] of Object.entries(controles)) {
      expect(ocorrencias.get(controle)).toContain(lugar);
    }
  });
});
