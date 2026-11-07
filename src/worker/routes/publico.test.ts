// GET /api/publico/ranking e GET /api/publico/bumbo (docs/api.md, Sprint 3) com o D1 dos testes e o relógio
// fixo. Cada 200 é conferido no schema estrito e comparado com o montador sobre os mesmos dados; as
// respostas são varridas por campos de valor e por R$, centavos e bilhetes no texto. O `data` do bumbo fica
// na janela da campanha (RIFA-011). No fim, o cache das respostas 200 (lib/cache-publico.ts): prazo, chave
// normalizada e erros fora do cache.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DIAS_DO_BUMBO_DEPOIS_DO_FIM,
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
import {
  SEM_CACHE,
  TTL_CACHE_PUBLICO_MS,
  criarCacheDeRespostas,
  type CacheDeRespostas,
} from "../lib/cache-publico";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  AGORA,
  CAMPOS_PUBLICOS,
  CAMPO_DE_VALOR,
  DADOS_CAMPANHA,
  TEXTO_DE_VALOR,
  bancoQueConta,
  camposDe,
  entradaEsperada,
  limparBanco,
  semearCenario,
  textosDe,
} from "../test/painel-apoio";
import {
  CACHE_PUBLICO,
  CODIGO_FORA_DA_CAMPANHA,
  PREFIXO_PUBLICO,
  criarPublico,
  type OpcoesPublico,
} from "./publico";

let agora = AGORA;

/**
 * O sub-app como o index.ts monta (aberto, fora do login), com o relógio dos testes. Sem cache por
 * padrão: aqui o banco e o relógio mudam entre as chamadas (o cache tem testes próprios, no fim).
 */
function montarApp(opcoes: OpcoesPublico = {}) {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.route(
    PREFIXO_PUBLICO,
    criarPublico({ relogio: () => agora, cache: SEM_CACHE, ...opcoes }),
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

/** Montadores que "vazam": o mesmo resultado do contrato com um campo de valor (ou um texto) a mais. */
const MONTADORES_COM_VAZAMENTO: OpcoesPublico["montadores"] = {
  montarRankingPublico: (...argumentos) =>
    ({
      ...montarRankingPublico(...argumentos),
      total_centavos: 123456,
    }) as ReturnType<typeof montarRankingPublico>,
  montarBumbo: (...argumentos) => ({
    ...montarBumbo(...argumentos),
    texto: "x".repeat(4001),
  }),
};

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
    ["hoje dito na URL", "?data=2026-12-01"],
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
    ["antes do início", "2026-11-20T15:00:00.000Z"],
    ["último dia", "2026-12-13T18:00:00.000Z"],
    ["dia seguinte ao fim", "2026-12-14T18:00:00.000Z"],
    ["campanha encerrada há dias", "2026-12-20T18:00:00.000Z"],
  ])("sem data, %s: o mesmo que montarBumbo", async (_caso, instante) => {
    agora = new Date(instante);

    expect(await bumbo()).toEqual(montarBumbo(entradaEsperada(), {}, agora));
  });

  it("sem data, hoje vale em qualquer fase: antes do início, é a contagem regressiva", async () => {
    agora = new Date("2026-11-20T15:00:00.000Z");

    const { data, referencia, texto } = await bumbo();

    expect(data).toBe("2026-11-20");
    expect(referencia).toMatchObject({ fase: "antes", dias_para_inicio: 3 });
    expect(texto).toContain("Faltam 3 dias para começar");
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

describe("GET /api/publico/bumbo: a data fica na janela da campanha (do 1º dia ao dia seguinte ao último)", () => {
  // Campanha do cenário: 23/11/2026 a 13/12/2026 (21 dias); a janela do `data` vai até 14/12/2026.
  const MENSAGEM_DA_JANELA =
    "A data precisa estar entre 23/11/2026 e 14/12/2026 (do 1º dia da campanha ao dia seguinte ao último)";

  beforeAll(async () => {
    await semearCenario();
  });

  it("a janela vem do contrato: um dia depois do último", () => {
    expect(DIAS_DO_BUMBO_DEPOIS_DO_FIM).toBe(1);
    expect(CODIGO_FORA_DA_CAMPANHA).toBe("fora_da_campanha");
  });

  it.each([
    ["o 1º dia", "2026-11-23"],
    ["o último dia", "2026-12-13"],
    ["o dia seguinte ao último", "2026-12-14"],
  ])(
    "campanha encerrada há dias, %s: 200, o mesmo que montarBumbo",
    async (_caso, data) => {
      agora = new Date("2026-12-20T18:00:00.000Z");

      expect(await bumbo(`?data=${data}`)).toEqual(
        montarBumbo(entradaEsperada(), { data }, agora),
      );
    },
  );

  it.each([
    ["a véspera do 1º dia", "2026-11-22"],
    ["dois dias depois do último", "2026-12-15"],
    ["uma data antiga qualquer", "1900-01-01"],
    [
      "uma data distante no futuro (a janela vem antes do data_futura)",
      "2999-12-31",
    ],
  ])(
    "%s: 400 requisicao_invalida com o detalhe fora_da_campanha e a mensagem da janela",
    async (_caso, data) => {
      agora = new Date("2026-12-20T18:00:00.000Z");

      const erro = esperarErro(
        await chamar(`/api/publico/bumbo?data=${data}`),
        400,
        "requisicao_invalida",
      );

      expect(erro).toEqual({
        codigo: "requisicao_invalida",
        mensagem: MENSAGEM_DA_JANELA,
        detalhes: [
          {
            caminho: ["data"],
            codigo: "fora_da_campanha",
            mensagem: MENSAGEM_DA_JANELA,
          },
        ],
      });
    },
  );

  it("antes do início, só sem data: hoje com data é fora da janela, e o 1º dia ainda é futuro", async () => {
    agora = new Date("2026-11-20T15:00:00.000Z");

    expect(
      esperarErro(
        await chamar("/api/publico/bumbo?data=2026-11-20"),
        400,
        "requisicao_invalida",
      ).detalhes,
    ).toEqual([expect.objectContaining({ codigo: "fora_da_campanha" })]);
    expect(
      esperarErro(
        await chamar("/api/publico/bumbo?data=2026-11-23"),
        400,
        "requisicao_invalida",
      ).detalhes,
    ).toEqual([expect.objectContaining({ codigo: "data_futura" })]);
    expect((await bumbo()).referencia.fase).toBe("antes");
  });

  it("durante a campanha, um dia da janela depois de hoje continua data_futura", async () => {
    // AGORA é o dia 9 (01/12): 14/12 está na janela, mas ainda não chegou.
    expect(
      esperarErro(
        await chamar("/api/publico/bumbo?data=2026-12-14"),
        400,
        "requisicao_invalida",
      ).detalhes,
    ).toEqual([expect.objectContaining({ codigo: "data_futura" })]);
  });

  it("fora da janela, o 400 lê só a campanha (nunca as vendas) e não entra no cache", async () => {
    const cache = criarCacheDeRespostas({ memoria: true, cacheApi: null });
    const { db, contagem } = bancoQueConta();
    const aplicacao = montarApp({ cache });
    const pedir = async (caminho: string) =>
      (await aplicacao.request(caminho, {}, { ...env, DB: db })).status;

    for (let vez = 1; vez <= 3; vez++) {
      expect(await pedir("/api/publico/bumbo?data=2020-01-01")).toBe(400);
      // Um comando por vez (a campanha) e nenhum batch: o erro não fica guardado e não lê os pedidos.
      expect(contagem).toMatchObject({
        idas: vez,
        comandos: vez,
        linhasLidas: 0,
      });
    }

    // Na janela: a campanha (janela), a campanha e o batch; dentro do prazo, vem do cache.
    expect(await pedir("/api/publico/bumbo?data=2026-11-30")).toBe(200);
    expect(contagem.idas).toBe(3 + 3);
    expect(contagem.linhasLidas).toBeGreaterThan(0);
    expect(await pedir("/api/publico/bumbo?data=2026-11-30")).toBe(200);
    expect(contagem.idas).toBe(3 + 3);
  });
});

describe("defesa a mais: a resposta pública passa pelo schema estrito", () => {
  beforeAll(async () => {
    await semearCenario();
  });

  const comVazamento = montarApp({ montadores: MONTADORES_COM_VAZAMENTO });

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

  it.each([
    "/api/publico/ranking",
    "/api/publico/bumbo",
    "/api/publico/bumbo?data=2026-11-30",
  ])("%s: 404 nao_encontrado, com no-store", async (caminho) => {
    const erro = esperarErro(await chamar(caminho), 404, "nao_encontrado");

    expect(erro.mensagem).toBe("A campanha ainda não foi configurada");
  });
});

describe("cache das respostas 200 por 30 s (lib/cache-publico.ts)", () => {
  beforeAll(async () => {
    await semearCenario();
  });

  /** O sub-app com o cache dado, num D1 que conta as idas ao banco. */
  function comCache(cache: CacheDeRespostas, opcoes: OpcoesPublico = {}) {
    const { db, contagem } = bancoQueConta();
    const aplicacao = montarApp({ ...opcoes, cache });
    async function pedir(caminho: string, cabecalhos: HeadersInit = {}) {
      const res = await aplicacao.request(
        caminho,
        { headers: cabecalhos },
        { ...env, DB: db },
      );
      return {
        status: res.status,
        texto: await res.text(),
        cabecalhos: [...res.headers],
      };
    }
    return { pedir, contagem };
  }

  /** Um cache nomeado novo da Cache API para cada teste: nada fica de um teste para o outro. */
  async function cacheApiNova(): Promise<() => Cache> {
    const aberto = await caches.open(`publico-teste-${crypto.randomUUID()}`);
    return () => aberto;
  }

  const NIVEIS: [string, () => Promise<CacheDeRespostas>][] = [
    [
      "memória do isolate",
      () =>
        Promise.resolve(
          criarCacheDeRespostas({ memoria: true, cacheApi: null }),
        ),
    ],
    [
      "Cache API",
      async () =>
        criarCacheDeRespostas({
          memoria: false,
          cacheApi: await cacheApiNova(),
        }),
    ],
    [
      "memória e Cache API (produção)",
      async () =>
        criarCacheDeRespostas({
          memoria: true,
          cacheApi: await cacheApiNova(),
        }),
    ],
  ];

  it.each(NIVEIS)(
    "%s: dentro do prazo a 2ª chamada não vai ao D1 e a resposta é idêntica; no fim do prazo, vai de novo",
    async (_nivel, criar) => {
      const { pedir, contagem } = comCache(await criar());

      for (const caminho of [
        "/api/publico/ranking",
        "/api/publico/ranking?nivel=rede&periodo=campanha&divisao=adultos",
        "/api/publico/bumbo",
        "/api/publico/bumbo?data=2026-11-30",
      ]) {
        agora = AGORA;
        const antes = contagem.idas;
        // A campanha e o batch; com `data` no bumbo, antes deles a campanha da janela do `data`.
        const idas = caminho.includes("data=") ? 3 : 2;
        const primeira = await pedir(caminho);
        expect({ caminho, status: primeira.status }).toEqual({
          caminho,
          status: 200,
        });
        expect(contagem.idas).toBe(antes + idas);

        agora = new Date(AGORA.getTime() + TTL_CACHE_PUBLICO_MS - 1);
        expect(await pedir(caminho)).toEqual(primeira);
        expect(contagem.idas).toBe(antes + idas);

        agora = new Date(AGORA.getTime() + TTL_CACHE_PUBLICO_MS);
        const depoisDoPrazo = await pedir(caminho);
        expect(depoisDoPrazo.status).toBe(200);
        expect(depoisDoPrazo.texto).not.toBe(primeira.texto); // novo instante
        expect(contagem.idas).toBe(antes + 2 * idas);
      }
    },
  );

  it("a chave é a URL normalizada: cookies, cabeçalhos, ordem e parâmetros fora do schema não contam; outra consulta é outra chave", async () => {
    const { pedir, contagem } = comCache(
      criarCacheDeRespostas({ memoria: false, cacheApi: await cacheApiNova() }),
    );
    const primeira = await pedir("/api/publico/ranking");
    expect(primeira.status).toBe(200);

    for (const [caminho, cabecalhos] of [
      ["/api/publico/ranking?periodo=atual&nivel=celula", {}],
      ["/api/publico/ranking?nivel=celula&x=1&data=2026-11-25", {}],
      [
        "/api/publico/ranking",
        {
          Cookie: "__Host-sessao=qualquer",
          Authorization: "Bearer qualquer",
          "Accept-Language": "en-US",
        },
      ],
    ] as const)
      expect({ caminho, ...(await pedir(caminho, cabecalhos)) }).toEqual({
        caminho,
        ...primeira,
      });
    expect(contagem.idas).toBe(2);

    // Outro nível, outra divisão ou outra data: outra chave, outra ida ao banco.
    for (const caminho of [
      "/api/publico/ranking?nivel=rede",
      "/api/publico/ranking?divisao=jovens",
      "/api/publico/bumbo",
      "/api/publico/bumbo?data=2026-11-30",
    ])
      expect((await pedir(caminho)).status).toBe(200);
    // 2 + 2 + 2 + 2 + 3 (com `data`, o bumbo lê também a campanha da janela).
    expect(contagem.idas).toBe(11);
  });

  it("erros não entram no cache: 400 nem chega ao banco, 404 e 500 vão ao banco toda vez", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cache = criarCacheDeRespostas({
      memoria: true,
      cacheApi: await cacheApiNova(),
    });

    // 400: a validação vem antes do cache e do banco.
    const invalida = comCache(cache);
    for (let vez = 0; vez < 2; vez++)
      expect(
        (await invalida.pedir("/api/publico/ranking?nivel=igreja")).status,
      ).toBe(400);
    expect(invalida.contagem.idas).toBe(0);

    // 500 (resposta fora do schema estrito): não fica guardado, e a próxima tenta de novo.
    const vazando = comCache(cache, { montadores: MONTADORES_COM_VAZAMENTO });
    for (let vez = 0; vez < 2; vez++)
      expect((await vazando.pedir("/api/publico/ranking")).status).toBe(500);
    expect(vazando.contagem.idas).toBe(4);

    // 404 (sem campanha): também não; quando a campanha existe, a 200 sai na hora.
    await limparBanco();
    const semCampanha = comCache(cache);
    for (let vez = 0; vez < 2; vez++)
      expect((await semCampanha.pedir("/api/publico/bumbo")).status).toBe(404);
    expect(semCampanha.contagem.idas).toBe(2);
    await semearCenario();
    expect((await semCampanha.pedir("/api/publico/bumbo")).status).toBe(200);
  });

  it("uma falha da Cache API não derruba a resposta: vai para o log e a requisição segue sem cache", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const quebrada = {
      match: () => Promise.reject(new Error("Cache API fora do ar")),
      put: () => Promise.reject(new Error("Cache API fora do ar")),
    } as unknown as Cache;
    const { pedir, contagem } = comCache(
      criarCacheDeRespostas({ memoria: false, cacheApi: () => quebrada }),
    );

    expect((await pedir("/api/publico/ranking")).status).toBe(200);
    expect((await pedir("/api/publico/ranking")).status).toBe(200);
    expect(contagem.idas).toBe(4);
    // Duas leituras e duas gravações que falharam.
    expect(consoleError).toHaveBeenCalledTimes(4);
  });
});
