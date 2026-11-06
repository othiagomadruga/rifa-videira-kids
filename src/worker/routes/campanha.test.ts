// CA1: GET e PUT /api/admin/campanha (docs/api.md), com o D1 dos testes. O sub-app é montado como o
// index.ts vai montar (sob /api/admin); a autenticação da coordenação é de outra tarefa.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  campanhaSchema,
  detalheValidacaoSchema,
  erroApiSchema,
  type Campanha,
  type CampanhaEntrada,
  type CodigoErro,
} from "../../shared/contracts";
import { salvarCampanhaAtiva, type DadosCampanha } from "../db/campanha";
import { PREFIXO_CAMPANHA, campanha } from "./campanha";

const app = new Hono<{ Bindings: Cloudflare.Env }>().route(
  PREFIXO_CAMPANHA,
  campanha,
);

const CAMINHO = "/api/admin/campanha";

interface Resposta {
  status: number;
  corpo: unknown;
}

async function chamar(
  metodo: "GET" | "PUT",
  corpo?: unknown,
  opcoes: {
    db?: D1Database;
    /** Corpo enviado como está (sem JSON.stringify). */
    corpoBruto?: string;
    /** null = sem Content-Type. Padrão: application/json quando há corpo. */
    contentType?: string | null;
  } = {},
): Promise<Resposta> {
  const headers = new Headers();
  const temCorpo = corpo !== undefined || opcoes.corpoBruto !== undefined;
  const contentType =
    opcoes.contentType === undefined ? "application/json" : opcoes.contentType;
  if (temCorpo && contentType !== null)
    headers.set("Content-Type", contentType);
  const resposta = await app.request(
    CAMINHO,
    {
      method: metodo,
      headers,
      body:
        opcoes.corpoBruto ??
        (corpo === undefined ? undefined : JSON.stringify(corpo)),
    },
    { ...env, DB: opcoes.db ?? env.DB },
  );
  const texto = await resposta.text();
  return {
    status: resposta.status,
    corpo: texto === "" ? null : JSON.parse(texto),
  };
}

/** Confere o corpo com o contrato, sem campos a mais, e devolve a campanha tipada. */
function campanhaConforme(resposta: Resposta): Campanha {
  expect(resposta.status).toBe(200);
  const valor = campanhaSchema.parse(resposta.corpo);
  expect(resposta.corpo).toEqual(valor);
  return valor;
}

/** Confere status e código no formato único de erro e devolve o erro. */
function esperarErro(resposta: Resposta, status: number, codigo: CodigoErro) {
  expect(resposta.status).toBe(status);
  const { erro } = erroApiSchema.parse(resposta.corpo);
  expect(erro.codigo).toBe(codigo);
  expect(erro.mensagem.length).toBeGreaterThan(0);
  return erro;
}

/** Corpo válido com valores fictícios (o modelo de períodos de Santo André). */
function entradaValida(): CampanhaEntrada {
  return {
    nome: "Rifa de teste",
    slug_rifei: "videira-kids-teste",
    data_inicio: "2026-11-23",
    preco_bilhete_centavos: 2000,
    meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
    periodos: [
      { nome: "Período 1", dias: 10, percentual_bp: 3500 },
      { nome: "Período 2", dias: 7, percentual_bp: 2500 },
      { nome: "Período 3", dias: 7, percentual_bp: 4500 },
    ],
    ranking: { criterio: "percentual_meta" },
  };
}

async function contar(sql: string): Promise<number> {
  const linha = await env.DB.prepare(sql).first<{ n: number }>();
  return linha?.n ?? -1;
}

/** O que o webhook lê para decidir se a venda conta (D5): a campanha ativa e o slug dela. */
async function campanhaAtivaDoWebhook() {
  const { results } = await env.DB.prepare(
    "SELECT id, slug_rifei FROM campanhas WHERE ativa = 1",
  ).all<{ id: number; slug_rifei: string }>();
  return results;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM campanha_periodos"),
    env.DB.prepare("DELETE FROM campanhas"),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CA1: GET /api/admin/campanha", () => {
  it("404 nao_encontrado, no formato único, enquanto a campanha não foi configurada", async () => {
    const resposta = await chamar("GET");

    expect(resposta).toEqual({
      status: 404,
      corpo: {
        erro: {
          codigo: "nao_encontrado",
          mensagem: "A campanha ainda não foi configurada",
        },
      },
    });
  });

  it("devolve a campanha salva, igual à resposta do PUT", async () => {
    const salva = campanhaConforme(await chamar("PUT", entradaValida()));

    expect(campanhaConforme(await chamar("GET"))).toEqual(salva);
  });
});

describe("CA1: PUT /api/admin/campanha grava campanha e períodos", () => {
  it("cria a campanha ativa com datas, soma dos percentuais e padrões do contrato", async () => {
    const criada = campanhaConforme(await chamar("PUT", entradaValida()));

    expect(criada).toEqual({
      id: expect.any(Number),
      nome: "Rifa de teste",
      slug_rifei: "videira-kids-teste",
      fuso_horario: "America/Belem",
      data_inicio: "2026-11-23",
      data_fim: "2026-12-16",
      preco_bilhete_centavos: 2000,
      meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
      periodos: [
        {
          ordem: 1,
          nome: "Período 1",
          dias: 10,
          percentual_bp: 3500,
          data_inicio: "2026-11-23",
          data_fim: "2026-12-02",
        },
        {
          ordem: 2,
          nome: "Período 2",
          dias: 7,
          percentual_bp: 2500,
          data_inicio: "2026-12-03",
          data_fim: "2026-12-09",
        },
        {
          ordem: 3,
          nome: "Período 3",
          dias: 7,
          percentual_bp: 4500,
          data_inicio: "2026-12-10",
          data_fim: "2026-12-16",
        },
      ],
      // 35% + 25% + 45% = 105%: aceito como está; quem normaliza é o cálculo.
      soma_percentuais_bp: 10500,
      ranking: { criterio: "percentual_meta" },
      publico: { mostra_percentual_meta: false, limite_ranking: 3 },
      criado_em: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      ),
      atualizado_em: expect.any(String),
    });
    expect(criada.atualizado_em).toBe(criada.criado_em);
  });

  it("grava o que veio: fuso, público (limite null = todas), espaços tirados e datas que viram o ano", async () => {
    const criada = campanhaConforme(
      await chamar("PUT", {
        ...entradaValida(),
        nome: "  Rifa de teste  ",
        slug_rifei: "  outra-igreja-teste ",
        fuso_horario: "America/Sao_Paulo",
        data_inicio: "2026-12-28",
        meta: {
          unidade: "centavos",
          regra: "total_proporcional",
          valor: 900000,
        },
        periodos: [
          { nome: " Fim de ano ", dias: 5, percentual_bp: 6000 },
          { nome: "Janeiro", dias: 3, percentual_bp: 4000 },
        ],
        ranking: { criterio: "arrecadacao" },
        publico: { mostra_percentual_meta: true, limite_ranking: null },
      }),
    );

    expect(criada).toMatchObject({
      nome: "Rifa de teste",
      slug_rifei: "outra-igreja-teste",
      fuso_horario: "America/Sao_Paulo",
      data_inicio: "2026-12-28",
      data_fim: "2027-01-04",
      meta: { unidade: "centavos", regra: "total_proporcional", valor: 900000 },
      soma_percentuais_bp: 10000,
      ranking: { criterio: "arrecadacao" },
      publico: { mostra_percentual_meta: true, limite_ranking: null },
    });
    expect(criada.periodos).toEqual([
      {
        ordem: 1,
        nome: "Fim de ano",
        dias: 5,
        percentual_bp: 6000,
        data_inicio: "2026-12-28",
        data_fim: "2027-01-01",
      },
      {
        ordem: 2,
        nome: "Janeiro",
        dias: 3,
        percentual_bp: 4000,
        data_inicio: "2027-01-02",
        data_fim: "2027-01-04",
      },
    ]);
  });

  it("PUT seguinte substitui a configuração e os períodos inteiros, na mesma campanha", async () => {
    const primeira = campanhaConforme(await chamar("PUT", entradaValida()));

    const segunda = campanhaConforme(
      await chamar("PUT", {
        ...entradaValida(),
        nome: "Rifa renomeada",
        preco_bilhete_centavos: 2500,
        periodos: [
          { nome: "Única semana", dias: 7, percentual_bp: 10000 },
          { nome: "Prorrogação", dias: 2, percentual_bp: 0 },
        ],
      }),
    );

    expect(segunda).toMatchObject({
      id: primeira.id,
      nome: "Rifa renomeada",
      preco_bilhete_centavos: 2500,
      data_fim: "2026-12-01",
      soma_percentuais_bp: 10000,
      criado_em: primeira.criado_em,
    });
    expect(segunda.atualizado_em >= primeira.atualizado_em).toBe(true);
    expect(segunda.periodos.map((periodo) => periodo.nome)).toEqual([
      "Única semana",
      "Prorrogação",
    ]);
    expect(await contar("SELECT count(*) AS n FROM campanha_periodos")).toBe(2);
    expect(campanhaConforme(await chamar("GET"))).toEqual(segunda);
  });
});

describe("CA1: fases conforme o contrato (só existe a campanha ativa)", () => {
  it("o primeiro PUT ativa a campanha: só a partir dele o webhook acha o slug que conta", async () => {
    expect(await campanhaAtivaDoWebhook()).toEqual([]);

    const ativada = campanhaConforme(await chamar("PUT", entradaValida()));

    expect(await campanhaAtivaDoWebhook()).toEqual([
      { id: ativada.id, slug_rifei: "videira-kids-teste" },
    ]);
  });

  it("trocar o slug muda quais vendas contam, sem nunca criar uma segunda campanha ativa", async () => {
    const ativada = campanhaConforme(await chamar("PUT", entradaValida()));

    campanhaConforme(
      await chamar("PUT", {
        ...entradaValida(),
        slug_rifei: "slug-novo-teste",
      }),
    );
    campanhaConforme(await chamar("PUT", entradaValida()));
    campanhaConforme(
      await chamar("PUT", {
        ...entradaValida(),
        slug_rifei: "slug-novo-teste",
      }),
    );

    expect(await campanhaAtivaDoWebhook()).toEqual([
      { id: ativada.id, slug_rifei: "slug-novo-teste" },
    ]);
    expect(await contar("SELECT count(*) AS n FROM campanhas")).toBe(1);
  });

  it("slug que já é de uma campanha inativa: 409 nome_duplicado no campo, e a ativa não muda", async () => {
    const ativa = campanhaConforme(await chamar("PUT", entradaValida()));
    await env.DB.prepare(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
         meta_unidade, meta_regra, meta_valor, ranking_criterio)
       VALUES ('Campanha antiga', 'campanha-antiga-teste', 0, '2025-11-23', 1500,
         'bilhetes', 'por_pessoa', 5, 'bilhetes')`,
    ).run();

    const resposta = await chamar("PUT", {
      ...entradaValida(),
      nome: "Não deve gravar",
      slug_rifei: "campanha-antiga-teste",
    });

    const erro = esperarErro(resposta, 409, "nome_duplicado");
    expect(erro.detalhes).toEqual([
      {
        caminho: ["slug_rifei"],
        codigo: "slug_duplicado",
        mensagem: erro.mensagem,
      },
    ]);
    expect(campanhaConforme(await chamar("GET"))).toEqual(ativa);
  });
});

describe("CA1: PUT valida pelo contrato (400 no formato único)", () => {
  it("requisicao_invalida com cada problema em detalhes (caminho, código, mensagem; sem o valor)", async () => {
    const resposta = await chamar("PUT", {
      ...entradaValida(),
      nome: "   ",
      slug_rifei: undefined,
      data_inicio: "2026-02-30",
      preco_bilhete_centavos: 0,
      meta: { unidade: "bilhetes", regra: "por_celula", valor: 10 },
      periodos: [
        { nome: "Período 1", dias: 0, percentual_bp: 3500 },
        { nome: "Período 2", dias: 7, percentual_bp: 10001 },
        { nome: "", dias: 7.5, percentual_bp: 4500 },
      ],
      ranking: {},
      publico: { mostra_percentual_meta: false, limite_ranking: 0 },
    });

    const erro = esperarErro(resposta, 400, "requisicao_invalida");
    const detalhes = detalheValidacaoSchema
      .strict()
      .array()
      .parse(erro.detalhes);
    expect(
      detalhes.map(({ caminho, codigo }) => ({ caminho, codigo })),
    ).toEqual(
      expect.arrayContaining([
        { caminho: ["nome"], codigo: "too_small" },
        { caminho: ["slug_rifei"], codigo: "invalid_type" },
        { caminho: ["data_inicio"], codigo: "invalid_format" },
        { caminho: ["preco_bilhete_centavos"], codigo: "too_small" },
        { caminho: ["meta", "regra"], codigo: "invalid_value" },
        { caminho: ["periodos", 0, "dias"], codigo: "too_small" },
        { caminho: ["periodos", 1, "percentual_bp"], codigo: "too_big" },
        { caminho: ["periodos", 2, "nome"], codigo: "too_small" },
        { caminho: ["periodos", 2, "dias"], codigo: "invalid_type" },
        { caminho: ["ranking", "criterio"], codigo: "invalid_value" },
        { caminho: ["publico", "limite_ranking"], codigo: "too_small" },
      ]),
    );
    expect(detalhes).toHaveLength(11);
    expect(await chamar("GET")).toMatchObject({ status: 404 });
  });

  it("todos os percentuais zerados: a mensagem do contrato no caminho periodos", async () => {
    const resposta = await chamar("PUT", {
      ...entradaValida(),
      periodos: [
        { nome: "Período 1", dias: 10, percentual_bp: 0 },
        { nome: "Período 2", dias: 7, percentual_bp: 0 },
      ],
    });

    const erro = esperarErro(resposta, 400, "requisicao_invalida");
    expect(erro.detalhes).toEqual([
      {
        caminho: ["periodos"],
        codigo: "custom",
        mensagem: "Pelo menos um período precisa ter percentual maior que zero",
      },
    ]);
  });

  it("sem períodos e com fuso inválido", async () => {
    const resposta = await chamar("PUT", {
      ...entradaValida(),
      fuso_horario: "Belem/Brasil",
      periodos: [],
    });

    const erro = esperarErro(resposta, 400, "requisicao_invalida");
    expect(erro.detalhes).toEqual([
      {
        caminho: ["fuso_horario"],
        codigo: "custom",
        mensagem: "Fuso horário IANA inválido (ex.: America/Belem)",
      },
      {
        caminho: ["periodos"],
        codigo: "too_small",
        mensagem: expect.any(String),
      },
      {
        caminho: ["periodos"],
        codigo: "custom",
        mensagem: "Pelo menos um período precisa ter percentual maior que zero",
      },
    ]);
  });

  it.each([
    ["JSON malformado", { corpoBruto: '{"nome": "Rifa",' }],
    ["corpo vazio", { corpoBruto: "" }],
    ["sem Content-Type JSON", { corpoBruto: "{}", contentType: "text/plain" }],
    [
      "sem Content-Type (o fetch manda text/plain)",
      { corpoBruto: "{}", contentType: null },
    ],
  ])("%s: 400 json_invalido e nada gravado", async (_caso, opcoes) => {
    const erro = esperarErro(
      await chamar("PUT", undefined, opcoes),
      400,
      "json_invalido",
    );

    expect(erro.detalhes).toBeUndefined();
    expect(await contar("SELECT count(*) AS n FROM campanhas")).toBe(0);
  });
});

describe("CA1: gravação atômica", () => {
  // Dados que passariam pelo contrato só até o banco: o CHECK de dias (1–366) recusa o 2º período.
  function dadosComPeriodoQueOBancoRecusa(): DadosCampanha {
    return {
      ...entradaValida(),
      fuso_horario: "America/Belem",
      publico: { mostra_percentual_meta: false, limite_ranking: 3 },
      periodos: [
        { nome: "Período 1", dias: 10, percentual_bp: 5000 },
        { nome: "Período 2", dias: 0, percentual_bp: 5000 },
      ],
    } as DadosCampanha;
  }

  it("falha num período ao criar: nenhuma campanha nem período fica gravado", async () => {
    await expect(
      salvarCampanhaAtiva(env.DB, dadosComPeriodoQueOBancoRecusa()),
    ).rejects.toThrow(/CHECK constraint failed/);

    expect(await contar("SELECT count(*) AS n FROM campanhas")).toBe(0);
    expect(await contar("SELECT count(*) AS n FROM campanha_periodos")).toBe(0);
  });

  it("falha num período ao atualizar: a configuração anterior fica inteira", async () => {
    const anterior = campanhaConforme(await chamar("PUT", entradaValida()));

    await expect(
      salvarCampanhaAtiva(env.DB, {
        ...dadosComPeriodoQueOBancoRecusa(),
        nome: "Não deve gravar",
      }),
    ).rejects.toThrow(/CHECK constraint failed/);

    expect(campanhaConforme(await chamar("GET"))).toEqual(anterior);
  });

  it("falha do banco: 500 erro_interno no formato único, com o erro só no log", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const dbComFalha = {
      prepare: () => {
        throw new Error("D1 indisponível");
      },
      batch: () => Promise.reject(new Error("D1 indisponível")),
    } as unknown as D1Database;

    for (const [metodo, corpo] of [
      ["GET", undefined],
      ["PUT", entradaValida()],
    ] as const) {
      expect(await chamar(metodo, corpo, { db: dbComFalha })).toEqual({
        status: 500,
        corpo: { erro: { codigo: "erro_interno", mensagem: "Erro interno" } },
      });
    }
    expect(consoleError).toHaveBeenCalledTimes(2);
  });
});
