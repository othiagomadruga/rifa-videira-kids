// GET /api/publico/ranking e GET /api/publico/bumbo (docs/api.md, Sprint 3) com o D1 dos testes e o relógio
// fixo. Cada 200 é conferido no schema estrito e comparado com o montador sobre os mesmos dados; as
// respostas são varridas por campos de valor e por R$, centavos e bilhetes no texto.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  JANELAS_RANKING,
  NIVEIS_RANKING,
  campanhaEntradaSchema,
  erroApiSchema,
  montarBumbo,
  montarRankingPublico,
  respostaBumboSchema,
  respostaRankingPublicoSchema,
  type CodigoErro,
  type ConsultaRankingPublico,
} from "../../shared/contracts";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  AGORA,
  CAMPOS_PUBLICOS,
  CAMPO_DE_VALOR,
  DADOS_CAMPANHA,
  TEXTO_DE_VALOR,
  camposDe,
  entradaEsperada,
  limparBanco,
  semearCenario,
  textosDe,
} from "../test/painel-apoio";
import { CACHE_PUBLICO, PREFIXO_PUBLICO, criarPublico } from "./publico";

let agora = AGORA;

/** O sub-app como o index.ts monta (aberto, fora do login), com o relógio dos testes. */
function montarApp(montadores?: Parameters<typeof criarPublico>[1]) {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.route(
    PREFIXO_PUBLICO,
    criarPublico(() => agora, montadores),
  );
  app.notFound(rotaInexistente);
  app.onError(erroNaoTratado);
  return app;
}

const app = montarApp();

interface Resposta {
  status: number;
  corpo: unknown;
  texto: string;
  cacheControl: string | null;
}

async function chamar(caminho: string, aplicacao = app): Promise<Resposta> {
  const res = await aplicacao.request(caminho, {}, env);
  const texto = await res.text();
  return {
    status: res.status,
    corpo: JSON.parse(texto),
    texto,
    cacheControl: res.headers.get("Cache-Control"),
  };
}

/** Nenhum campo de valor, só campos da lista fechada e nenhum R$, centavo ou bilhete nos textos. */
function esperarSemValores(resposta: Resposta) {
  const campos = [...camposDe(resposta.corpo)];
  expect(campos.filter((campo) => CAMPO_DE_VALOR.test(campo))).toEqual([]);
  expect(campos.filter((campo) => !CAMPOS_PUBLICOS.has(campo))).toEqual([]);
  expect(
    textosDe(resposta.corpo).filter((texto) => TEXTO_DE_VALOR.test(texto)),
  ).toEqual([]);
  expect(resposta.texto).not.toContain("R$");
}

async function rankingPublico(consulta = "") {
  const resposta = await chamar(`/api/publico/ranking${consulta}`);
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status: 200,
  });
  expect(resposta.cacheControl).toBe(CACHE_PUBLICO);
  esperarSemValores(resposta);
  return respostaRankingPublicoSchema.parse(resposta.corpo);
}

async function bumbo(consulta = "") {
  const resposta = await chamar(`/api/publico/bumbo${consulta}`);
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status: 200,
  });
  expect(resposta.cacheControl).toBe(CACHE_PUBLICO);
  esperarSemValores(resposta);
  return respostaBumboSchema.parse(resposta.corpo);
}

function esperarErro(resposta: Resposta, status: number, codigo: CodigoErro) {
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status,
    corpo: { erro: { codigo } },
  });
  expect(resposta.cacheControl).toBe("no-store");
  return erroApiSchema.parse(resposta.corpo).erro;
}

const CONSULTAS: ConsultaRankingPublico[] = NIVEIS_RANKING.flatMap((nivel) =>
  JANELAS_RANKING.flatMap((periodo) =>
    [undefined, "jovens" as const, "adultos" as const].map((divisao) => ({
      nivel,
      periodo,
      ...(divisao ? { divisao } : {}),
    })),
  ),
);

const parametros = (consulta: ConsultaRankingPublico) =>
  `?${new URLSearchParams(consulta as Record<string, string>)}`;

afterEach(() => {
  agora = AGORA;
  vi.restoreAllMocks();
});

describe("GET /api/publico/ranking", () => {
  beforeAll(async () => {
    await semearCenario();
  });

  it.each(CONSULTAS)(
    "%o responde o mesmo que montarRankingPublico sobre os mesmos dados",
    async (consulta) => {
      expect(await rankingPublico(parametros(consulta))).toEqual(
        montarRankingPublico(entradaEsperada(), consulta, AGORA),
      );
    },
  );

  it("padrão: as posições da coordenação, só quem vendeu, até o 3º lugar com o empate (1, 2, 3, 3)", async () => {
    const corpo = await rankingPublico();

    expect(corpo.itens).toEqual([
      { posicao: 1, nome: "Célula Betel", divisao: "jovens" },
      { posicao: 2, nome: "Célula Dorcas", divisao: "adultos" },
      { posicao: 3, nome: "Célula Ágape", divisao: "jovens" },
      { posicao: 3, nome: "Célula Canaã", divisao: "jovens" },
    ]);
    expect(corpo.janela).toMatchObject({ tipo: "atual", nome: "Semana 2" });
    expect(corpo.atualizado_em).toBe(AGORA.toISOString());
  });

  it("um `data` na URL é ignorado: é sempre hoje", async () => {
    expect(await rankingPublico("?data=2026-11-25")).toEqual(
      await rankingPublico(),
    );
    expect(await rankingPublico("?data=2030-01-01")).toEqual(
      await rankingPublico(),
    );
  });

  it("com o % da meta ligado e sem limite: todos os que venderam, com o %, e ainda sem valor nenhum", async () => {
    const campanha = campanhaEntradaSchema.parse({
      ...DADOS_CAMPANHA,
      publico: { mostra_percentual_meta: true, limite_ranking: null },
    });
    await semearCenario({ campanha });

    for (const consulta of CONSULTAS)
      expect(await rankingPublico(parametros(consulta))).toEqual(
        montarRankingPublico(entradaEsperada(campanha), consulta, AGORA),
      );
    expect((await rankingPublico()).itens).toEqual([
      expect.objectContaining({
        nome: "Célula Betel",
        percentual_meta_bp: 4200,
      }),
      expect.objectContaining({
        nome: "Célula Dorcas",
        percentual_meta_bp: 2520,
      }),
      expect.objectContaining({
        nome: "Célula Ágape",
        percentual_meta_bp: 2100,
      }),
      expect.objectContaining({
        nome: "Célula Canaã",
        percentual_meta_bp: 2100,
      }),
    ]);
    await semearCenario();
  });

  it("antes da primeira venda da janela, a lista vem vazia (com a referência para contar os dias)", async () => {
    agora = new Date("2026-11-21T12:00:00.000Z");
    // Antes do início a janela "atual" é a Semana 1, ainda sem vendas.
    const corpo = await rankingPublico();

    expect(corpo.itens).toEqual([]);
    expect(corpo.referencia).toMatchObject({
      fase: "antes",
      dias_para_inicio: 2,
    });
  });

  it.each([
    ["nível desconhecido", "?nivel=divisao", "nivel"],
    ["janela desconhecida", "?periodo=semana", "periodo"],
    ["divisão desconhecida", "?divisao=criancas", "divisao"],
  ])(
    "%s: 400 requisicao_invalida, com no-store",
    async (_caso, consulta, campo) => {
      const erro = esperarErro(
        await chamar(`/api/publico/ranking${consulta}`),
        400,
        "requisicao_invalida",
      );

      expect(erro.detalhes).toEqual(
        expect.arrayContaining([expect.objectContaining({ caminho: [campo] })]),
      );
    },
  );
});

describe("GET /api/publico/bumbo", () => {
  beforeAll(async () => {
    await semearCenario();
  });

  it.each([
    ["hoje (dia 9, sobre o dia 8)", ""],
    ["data passada (dia 8, sobre o dia 7)", "?data=2026-11-30"],
    ["o dia da largada", "?data=2026-11-23"],
    ["antes do início", "?data=2026-11-20"],
  ])(
    "%s: o mesmo que montarBumbo, sem R$, centavos nem bilhetes",
    async (_caso, consulta) => {
      const data = new URLSearchParams(consulta).get("data") ?? undefined;

      expect(await bumbo(consulta)).toEqual(
        montarBumbo(entradaEsperada(), { data }, AGORA),
      );
    },
  );

  it("o texto do dia 9 fala do dia 8 e traz as posições por divisão", async () => {
    const { texto, data, referencia } = await bumbo();

    expect(data).toBe("2026-12-01");
    expect(referencia).toMatchObject({ dia_campanha: 9, fase: "durante" });
    expect(texto).toContain("*Rifa Videira Kids · Dia 9 de 21*");
    expect(texto).toContain("*Ontem (dia 8):*");
    expect(texto).toContain("_Jovens_");
    expect(texto).toContain("_Adultos_");
  });

  it.each([
    ["último dia", "2026-12-13T18:00:00.000Z"],
    ["dia seguinte ao fim", "2026-12-14T18:00:00.000Z"],
    ["campanha encerrada há dias", "2026-12-20T18:00:00.000Z"],
  ])("%s: o mesmo que montarBumbo", async (_caso, instante) => {
    agora = new Date(instante);

    expect(await bumbo()).toEqual(montarBumbo(entradaEsperada(), {}, agora));
  });

  it("data depois de hoje: 400 data_futura; data inválida: 400", async () => {
    const futura = esperarErro(
      await chamar("/api/publico/bumbo?data=2026-12-02"),
      400,
      "requisicao_invalida",
    );
    expect(futura.detalhes).toEqual([
      {
        caminho: ["data"],
        codigo: "data_futura",
        mensagem: "A data não pode ser depois de hoje",
      },
    ]);

    const invalida = esperarErro(
      await chamar("/api/publico/bumbo?data=ontem"),
      400,
      "requisicao_invalida",
    );
    expect(invalida.detalhes).toEqual([
      expect.objectContaining({ caminho: ["data"] }),
    ]);
  });
});

describe("defesa a mais: a resposta pública passa pelo schema estrito", () => {
  beforeAll(async () => {
    await semearCenario();
  });

  // Um montador que "vaza": o mesmo resultado do contrato com um campo de valor a mais.
  const comVazamento = montarApp({
    montarRankingPublico: (...argumentos) =>
      ({
        ...montarRankingPublico(...argumentos),
        total_centavos: 123456,
      }) as ReturnType<typeof montarRankingPublico>,
    montarBumbo: (...argumentos) => ({
      ...montarBumbo(...argumentos),
      texto: "x".repeat(4001),
    }),
  });

  it("um campo a mais vindo do montador vira 500 erro_interno, e o valor não sai", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const resposta = await chamar("/api/publico/ranking", comVazamento);

    esperarErro(resposta, 500, "erro_interno");
    expect(resposta.texto).not.toContain("123456");
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("o mesmo no bumbo: um texto que não cabe no contrato não sai", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const resposta = await chamar("/api/publico/bumbo", comVazamento);

    esperarErro(resposta, 500, "erro_interno");
    expect(resposta.texto).not.toContain("xxxx");
  });
});

describe("sem campanha ativa", () => {
  beforeAll(async () => {
    await limparBanco();
  });

  it.each(["/api/publico/ranking", "/api/publico/bumbo"])(
    "%s: 404 nao_encontrado, com no-store",
    async (caminho) => {
      const erro = esperarErro(await chamar(caminho), 404, "nao_encontrado");

      expect(erro.mensagem).toBe("A campanha ainda não foi configurada");
    },
  );
});
