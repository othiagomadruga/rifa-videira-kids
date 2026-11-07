// GET /api/painel/resumo e GET /api/painel/ranking (docs/api.md, Sprint 3) com o D1 dos testes e o relógio
// fixo. Cada resposta 200 é conferida no schema estrito do contrato e comparada com o montador chamado
// sobre os mesmos dados (a entrada esperada é montada no JS, sem o SQL). O login fica de fora daqui
// (é do index.ts; protecao.test.ts confere no app real).
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  JANELAS_RANKING,
  NIVEIS_RANKING,
  campanhaEntradaSchema,
  erroApiSchema,
  montarRankingPainel,
  montarResumoPainel,
  respostaPainelResumoSchema,
  respostaRankingSchema,
  type CodigoErro,
  type ConsultaRanking,
  type EscopoResolvido,
} from "../../shared/contracts";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  AGORA,
  DADOS_CAMPANHA,
  entradaEsperada,
  limparBanco,
  semearCenario,
} from "../test/painel-apoio";
import { PREFIXO_PAINEL, criarPainel } from "./painel";

let agora = AGORA;

// O sub-app como o index.ts monta (sem o login, que vem antes dele), com o relógio dos testes.
const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.route(
  PREFIXO_PAINEL,
  criarPainel(() => agora),
);
app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

interface Resposta {
  status: number;
  corpo: unknown;
  cacheControl: string | null;
}

async function chamar(
  caminho: string,
  db: D1Database = env.DB,
): Promise<Resposta> {
  const res = await app.request(caminho, {}, { ...env, DB: db });
  return {
    status: res.status,
    corpo: await res.json(),
    cacheControl: res.headers.get("Cache-Control"),
  };
}

/** 200 no schema ESTRITO (um campo a mais reprova) e o corpo tipado. */
async function resumo(consulta = "") {
  const resposta = await chamar(`/api/painel/resumo${consulta}`);
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status: 200,
  });
  expect(resposta.cacheControl).toBe("no-store");
  return respostaPainelResumoSchema.parse(resposta.corpo);
}

async function ranking(consulta = "") {
  const resposta = await chamar(`/api/painel/ranking${consulta}`);
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status: 200,
  });
  expect(resposta.cacheControl).toBe("no-store");
  return respostaRankingSchema.parse(resposta.corpo);
}

function esperarErro(resposta: Resposta, status: number, codigo: CodigoErro) {
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status,
    corpo: { erro: { codigo } },
  });
  expect(resposta.cacheControl).toBe("no-store");
  return erroApiSchema.parse(resposta.corpo).erro;
}

const ESCOPO_CAMPANHA: EscopoResolvido = {
  tipo: "campanha",
  id: null,
  divisao: null,
  nome: "Rifa Videira Kids",
};

afterEach(() => {
  agora = AGORA;
  vi.restoreAllMocks();
});

describe("GET /api/painel/resumo", () => {
  beforeAll(async () => {
    await semearCenario();
  });

  it.each<[string, EscopoResolvido]>([
    ["", ESCOPO_CAMPANHA],
    ["?escopo=campanha", ESCOPO_CAMPANHA],
    [
      "?escopo=divisao&divisao=jovens",
      { tipo: "divisao", id: null, divisao: "jovens", nome: "Jovens" },
    ],
    [
      "?escopo=divisao&divisao=adultos",
      { tipo: "divisao", id: null, divisao: "adultos", nome: "Adultos" },
    ],
    [
      "?escopo=rede&id=1",
      { tipo: "rede", id: 1, divisao: "jovens", nome: "Rede Jovem Ficticia" },
    ],
    [
      "?escopo=rede&id=2",
      {
        tipo: "rede",
        id: 2,
        divisao: "adultos",
        nome: "Rede Adulta Ficticia",
      },
    ],
    [
      "?escopo=discipulador&id=10",
      {
        tipo: "discipulador",
        id: 10,
        divisao: "jovens",
        nome: "Discipulador Abel",
      },
    ],
    [
      "?escopo=discipulador&id=40",
      {
        tipo: "discipulador",
        id: 40,
        divisao: "adultos",
        nome: "Discipulador Davi",
      },
    ],
    ...[1, 2, 3, 4, 5].map((id): [string, EscopoResolvido] => {
      const celula = entradaEsperada().celulas.find((item) => item.id === id)!;
      return [
        `?escopo=celula&id=${id}`,
        { tipo: "celula", id, divisao: celula.divisao, nome: celula.nome },
      ];
    }),
  ])(
    "%s responde o mesmo que montarResumoPainel sobre os mesmos dados",
    async (consulta, escopo) => {
      expect(await resumo(consulta)).toEqual(
        montarResumoPainel(entradaEsperada(), { escopo }, AGORA),
      );
    },
  );

  it("escopo campanha no dia 9: vendas sem célula e de fora da janela aparecem à parte", async () => {
    const corpo = await resumo();

    expect(corpo.referencia).toMatchObject({
      data: "2026-12-01",
      fase: "durante",
      dia_campanha: 9,
      duracao_dias: 21,
    });
    // Sem afiliado (dias 3 e 9) e afiliado não vinculado (dia 4).
    expect(corpo.vendas_sem_celula).toEqual({
      pedidos_aprovados: 3,
      bilhetes: 7,
      total_centavos: 14000,
    });
    // Reunião de cadastro (20/11) e a véspera às 02:59:59.999Z; a venda depois do fim é de 14/12.
    expect(corpo.vendas_fora_da_janela).toEqual({
      antes_do_inicio: {
        pedidos_aprovados: 2,
        bilhetes: 3,
        total_centavos: 6000,
      },
      depois_do_fim: { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 },
    });
    expect(corpo.atualizado_em).toBe(AGORA.toISOString());
  });

  it("discipulador sem células: sem meta, mas responde", async () => {
    const corpo = await resumo("?escopo=discipulador&id=40");

    expect(corpo.campanha).toMatchObject({ meta: 0, situacao: "sem_meta" });
  });

  it("data passada: o retrato do fim daquele dia (a venda das 02:59:59.999Z de 30/11 ainda é do dia 7)", async () => {
    const consulta = "?escopo=celula&id=1&data=2026-11-29";
    const corpo = await resumo(consulta);

    expect(corpo).toEqual(
      montarResumoPainel(
        entradaEsperada(),
        {
          escopo: {
            tipo: "celula",
            id: 1,
            divisao: "jovens",
            nome: "Célula Ágape",
          },
          data: "2026-11-29",
        },
        AGORA,
      ),
    );
    expect(corpo.referencia).toMatchObject({
      data: "2026-11-29",
      dia_campanha: 7,
    });
    expect(corpo.curva[6]).toMatchObject({
      dia: 7,
      realizado: 42,
      realizado_no_dia: 6,
    });
    expect(corpo.curva[7]).toMatchObject({ dia: 8, realizado: null });
  });

  it("o dia de hoje vira às 03:00Z: às 02:59:59.999Z de 30/11 ainda é o dia 7", async () => {
    agora = new Date("2026-11-30T02:59:59.999Z");
    expect((await resumo()).referencia.dia_campanha).toBe(7);

    agora = new Date("2026-11-30T03:00:00.000Z");
    expect((await resumo()).referencia.dia_campanha).toBe(8);
  });

  it.each([
    ["antes do início", "2026-11-20T18:00:00.000Z", "antes"],
    ["último dia", "2026-12-13T18:00:00.000Z", "durante"],
    ["depois do fim", "2026-12-20T18:00:00.000Z", "encerrada"],
  ] as const)("%s: igual ao montador", async (_caso, instante, fase) => {
    agora = new Date(instante);

    const corpo = await resumo();

    expect(corpo).toEqual(
      montarResumoPainel(entradaEsperada(), { escopo: ESCOPO_CAMPANHA }, agora),
    );
    expect(corpo.referencia.fase).toBe(fase);
  });

  it("depois do fim, a venda do 1º instante de 14/12 aparece em depois_do_fim", async () => {
    agora = new Date("2026-12-20T18:00:00.000Z");

    expect((await resumo()).vendas_fora_da_janela?.depois_do_fim).toEqual({
      pedidos_aprovados: 1,
      bilhetes: 4,
      total_centavos: 8000,
    });
  });

  it.each([
    ["escopo desconhecido", "?escopo=igreja", "escopo"],
    ["rede sem id", "?escopo=rede", "id"],
    ["divisão sem a divisão", "?escopo=divisao", "divisao"],
    ["divisão desconhecida", "?escopo=divisao&divisao=criancas", "divisao"],
    ["id que não é número", "?escopo=celula&id=abc", "id"],
    ["id zero", "?escopo=celula&id=0", "id"],
    ["data impossível", "?data=2026-02-30", "data"],
    ["data em outro formato", "?data=01/12/2026", "data"],
    ["escopo repetido", "?escopo=rede&escopo=celula&id=1", "escopo"],
  ])(
    "%s: 400 requisicao_invalida no formato único",
    async (_caso, consulta, campo) => {
      const erro = esperarErro(
        await chamar(`/api/painel/resumo${consulta}`),
        400,
        "requisicao_invalida",
      );

      expect(erro.detalhes).toEqual(
        expect.arrayContaining([expect.objectContaining({ caminho: [campo] })]),
      );
    },
  );

  it("data depois de hoje: 400 com o detalhe data_futura", async () => {
    const erro = esperarErro(
      await chamar("/api/painel/resumo?data=2026-12-02"),
      400,
      "requisicao_invalida",
    );

    expect(erro.detalhes).toEqual([
      {
        caminho: ["data"],
        codigo: "data_futura",
        mensagem: "A data não pode ser depois de hoje",
      },
    ]);
  });

  it.each([
    ["rede", "Rede não encontrada"],
    ["discipulador", "Discipulador não encontrado"],
    ["celula", "Célula não encontrada"],
  ])("%s inexistente: 404 nao_encontrado", async (escopo, mensagem) => {
    const erro = esperarErro(
      await chamar(`/api/painel/resumo?escopo=${escopo}&id=999`),
      404,
      "nao_encontrado",
    );

    expect(erro.mensagem).toBe(mensagem);
  });
});

describe("GET /api/painel/ranking", () => {
  beforeAll(async () => {
    await semearCenario();
  });

  const CONSULTAS: ConsultaRanking[] = NIVEIS_RANKING.flatMap((nivel) =>
    JANELAS_RANKING.flatMap((periodo) =>
      [undefined, "jovens" as const, "adultos" as const].map((divisao) => ({
        nivel,
        periodo,
        ...(divisao ? { divisao } : {}),
      })),
    ),
  );

  it.each(CONSULTAS)(
    "%o responde o mesmo que montarRankingPainel sobre os mesmos dados",
    async (consulta) => {
      const parametros = new URLSearchParams(
        consulta as Record<string, string>,
      );

      expect(await ranking(`?${parametros}`)).toEqual(
        montarRankingPainel(entradaEsperada(), consulta, AGORA),
      );
    },
  );

  it("padrão: nível célula na janela atual (Semana 2), com o empate dividindo a posição", async () => {
    const corpo = await ranking();

    expect(corpo).toMatchObject({
      nivel: "celula",
      divisao: null,
      janela: { tipo: "atual", ordem: 2, nome: "Semana 2" },
      criterio: "percentual_meta",
      unidade: "bilhetes",
    });
    expect(
      corpo.itens.map((item) => [
        item.posicao,
        item.nome,
        item.percentual_meta_bp,
      ]),
    ).toEqual([
      [1, "Célula Betel", 4200],
      [2, "Célula Dorcas", 2520],
      [3, "Célula Ágape", 2100],
      [3, "Célula Canaã", 2100],
      [5, "Célula Éfeso", 0],
    ]);
    // Empatados não são vizinhos: os dois 3º lugares têm a Dorcas acima e a Éfeso abaixo.
    for (const nome of ["Célula Ágape", "Célula Canaã"]) {
      const item = corpo.itens.find((linha) => linha.nome === nome)!;
      expect(item.acima).toEqual({
        id: 4,
        nome: "Célula Dorcas",
        posicao: 2,
        diferenca: 420,
      });
      expect(item.abaixo).toEqual({
        id: 5,
        nome: "Célula Éfeso",
        posicao: 5,
        diferenca: 2100,
      });
    }
  });

  it("data passada: a Semana 1 fechada", async () => {
    const corpo = await ranking("?periodo=atual&data=2026-11-29");

    expect(corpo).toEqual(
      montarRankingPainel(
        entradaEsperada(),
        { nivel: "celula", periodo: "atual", data: "2026-11-29" },
        AGORA,
      ),
    );
    expect(corpo.janela).toMatchObject({ ordem: 1, nome: "Semana 1" });
  });

  it("outros critérios da campanha (bilhetes e arrecadação): igual ao montador", async () => {
    for (const criterio of ["bilhetes", "arrecadacao"] as const) {
      const campanha = campanhaEntradaSchema.parse({
        ...DADOS_CAMPANHA,
        ranking: { criterio },
      });
      await semearCenario({ campanha });

      expect(await ranking("?periodo=campanha")).toEqual(
        montarRankingPainel(
          entradaEsperada(campanha),
          { nivel: "celula", periodo: "campanha" },
          AGORA,
        ),
      );
    }
    await semearCenario();
  });

  it.each([
    ["nível desconhecido", "?nivel=divisao", "nivel"],
    ["janela desconhecida", "?periodo=semana", "periodo"],
    ["divisão desconhecida", "?divisao=criancas", "divisao"],
    ["data impossível", "?data=2026-11-31", "data"],
  ])("%s: 400 requisicao_invalida", async (_caso, consulta, campo) => {
    const erro = esperarErro(
      await chamar(`/api/painel/ranking${consulta}`),
      400,
      "requisicao_invalida",
    );

    expect(erro.detalhes).toEqual(
      expect.arrayContaining([expect.objectContaining({ caminho: [campo] })]),
    );
  });

  it("data depois de hoje: 400 data_futura", async () => {
    const erro = esperarErro(
      await chamar("/api/painel/ranking?data=2026-12-02"),
      400,
      "requisicao_invalida",
    );

    expect(erro.detalhes).toEqual([
      expect.objectContaining({ caminho: ["data"], codigo: "data_futura" }),
    ]);
  });
});

describe("sem campanha ativa e falha do banco", () => {
  beforeAll(async () => {
    await limparBanco();
  });

  it.each(["/api/painel/resumo", "/api/painel/ranking"])(
    "%s: 404 nao_encontrado",
    async (caminho) => {
      const erro = esperarErro(await chamar(caminho), 404, "nao_encontrado");

      expect(erro.mensagem).toBe("A campanha ainda não foi configurada");
    },
  );

  it("falha do banco: 500 erro_interno, sem detalhes, com no-store", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dbComFalha = {
      prepare: () => {
        throw new Error("D1 indisponível");
      },
    } as unknown as D1Database;

    const resposta = await chamar("/api/painel/resumo", dbComFalha);

    expect(resposta.corpo).toEqual({
      erro: { codigo: "erro_interno", mensagem: "Erro interno" },
    });
    esperarErro(resposta, 500, "erro_interno");
  });
});
