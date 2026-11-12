// GET /api/painel/mapa-ddd (RIFA-015, D17; docs/api.md, "Mapa de vendas por DDD") com o D1 dos testes e o relógio
// fixo. Toda resposta 200 passa pelo respostaMapaDddSchema (estrito, com as invariantes de soma do contrato). O
// total é comparado com o painel e os rankings chamados sobre os MESMOS dados (CA1) e com uma conta à parte, feita
// aqui no JS pelo dia local de cada pedido, sem o SQL (CA4), também com o fuso da campanha fora de Belém (Katmandu e
// Nova York, com horário de verão). O login é provado no app real (CA5), como em protecao.test.ts. Orçamento do D1
// e plano: src/worker/db/mapa-ddd-desempenho.test.ts.
import { env, exports } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  PAPEIS_HIERARQUIA,
  UF_DO_DDD,
  campanhaEntradaSchema,
  diaLocalDoInstante,
  diasEntre,
  erroApiSchema,
  respostaMapaDddSchema,
  respostaPainelResumoSchema,
  respostaRankingSchema,
  type CodigoErro,
  type Divisao,
  type RespostaMapaDdd,
} from "../../shared/contracts";
import { comandoMapaDdd } from "../db/mapa-ddd";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
} from "../test/acesso-teste";
import {
  AFILIADOS,
  AGORA,
  CELULAS,
  DADOS_CAMPANHA,
  PEDIDOS,
  aprovado,
  camposDe,
  dia,
  limparBanco,
  semearCenario,
  textosDe,
  type PedidoTeste,
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

afterEach(() => {
  agora = AGORA;
});

async function chamar(caminho: string) {
  const res = await app.request(caminho, {}, env);
  return {
    status: res.status,
    corpo: (await res.json()) as unknown,
    cacheControl: res.headers.get("Cache-Control"),
  };
}

/** 200, sem cache e no schema do contrato (estrito, com as somas conferidas). */
async function mapa(consulta = ""): Promise<RespostaMapaDdd> {
  const resposta = await chamar(`/api/painel/mapa-ddd${consulta}`);
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status: 200,
  });
  expect(resposta.cacheControl).toBe("no-store");
  return respostaMapaDddSchema.parse(resposta.corpo);
}

async function resumo(consulta = "") {
  const resposta = await chamar(`/api/painel/resumo${consulta}`);
  expect(resposta.status).toBe(200);
  return respostaPainelResumoSchema.parse(resposta.corpo);
}

async function ranking(consulta = "") {
  const resposta = await chamar(`/api/painel/ranking${consulta}`);
  expect(resposta.status).toBe(200);
  return respostaRankingSchema.parse(resposta.corpo);
}

async function esperarErro(
  consulta: string,
  status: number,
  codigo: CodigoErro,
) {
  const resposta = await chamar(`/api/painel/mapa-ddd${consulta}`);
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status,
    corpo: { erro: { codigo } },
  });
  expect(resposta.cacheControl).toBe("no-store");
  return erroApiSchema.parse(resposta.corpo).erro;
}

type Totais = {
  pedidos_aprovados: number;
  bilhetes: number;
  total_centavos: number;
};
const ZERO: Totais = { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 };

/** Os três totais de um recorte, sem a parte (para comparar com o painel). */
const totais = ({
  pedidos_aprovados,
  bilhetes,
  total_centavos,
}: Totais): Totais => ({ pedidos_aprovados, bilhetes, total_centavos });

const somarTotais = (lista: readonly Totais[]): Totais =>
  lista.reduce(
    (soma, item) => ({
      pedidos_aprovados: soma.pedidos_aprovados + item.pedidos_aprovados,
      bilhetes: soma.bilhetes + item.bilhetes,
      total_centavos: soma.total_centavos + item.total_centavos,
    }),
    ZERO,
  );

const comTelefone = (
  pedido: PedidoTeste,
  pais: string | null,
  ddd: string | null = null,
): PedidoTeste => ({ ...pedido, pais, ddd });

/** Afiliados sem célula no cenário (sem afiliado ou não vinculado). */
const semCelula = (pedido: PedidoTeste) =>
  pedido.affiliate_id === null || pedido.affiliate_id === 900;

const TELEFONES: readonly [string | null, string | null][] = [
  ["55", "91"],
  ["55", "94"],
  ["55", "11"],
  ["55", "93"],
  [null, null],
  ["1", null],
  ["55", null],
  ["351", null],
  ["55", "23"],
];

/**
 * O cenário do painel (painel-apoio.ts) com o telefone de cada comprador: as vendas SEM CÉLULA são todas do DDD 61
 * (DF), e só elas; as demais (inclusive as que não contam) percorrem PA, SP, sem país, exterior, Brasil sem DDD e um
 * DDD fora da tabela.
 */
const PEDIDOS_COM_TELEFONE = PEDIDOS.map((pedido, indice) =>
  semCelula(pedido)
    ? comTelefone(pedido, "55", "61")
    : comTelefone(pedido, ...TELEFONES[indice % TELEFONES.length]),
);

// ---------------------------------------------------------------------------------------------------
// Conta à parte (sem o SQL): os pedidos que contam, pelo dia local de cada um
// ---------------------------------------------------------------------------------------------------

const CELULA_DO_AFILIADO = new Map<number, number | null>(
  AFILIADOS.map((afiliado) => [afiliado.affiliate_id, afiliado.celula_id]),
);

/**
 * Aprovados da campanha ativa com o dia local (no `fuso`; padrão: o do cenário) em [de, ate] e, com `divisao`, de uma
 * célula dela.
 */
function contam(
  pedidos: readonly PedidoTeste[],
  de: string,
  ate: string,
  divisao?: Divisao,
  fuso = "America/Belem",
): PedidoTeste[] {
  return pedidos.filter((pedido) => {
    if (pedido.status !== "approved" || pedido.campanha === "outra")
      return false;
    const dia = diaLocalDoInstante(pedido.aprovado_em!, fuso);
    if (diasEntre(de, dia) < 0 || diasEntre(dia, ate) < 0) return false;
    if (divisao === undefined) return true;
    const celulaId =
      pedido.affiliate_id === null
        ? null
        : (CELULA_DO_AFILIADO.get(pedido.affiliate_id) ?? null);
    return CELULAS.some(
      (celula) => celula.id === celulaId && celula.divisao === divisao,
    );
  });
}

const totaisDosPedidos = (pedidos: readonly PedidoTeste[]): Totais =>
  somarTotais(
    pedidos.map((pedido) => ({
      pedidos_aprovados: 1,
      bilhetes: pedido.qtd_bilhetes,
      total_centavos: pedido.total_centavos,
    })),
  );

/** O que o mapa deve trazer, sem a ordem e sem as partes: total, exterior, sem DDD e cada DDD. */
function esperado(pedidos: readonly PedidoTeste[]) {
  const doDdd = new Map<string, PedidoTeste[]>();
  const exterior: PedidoTeste[] = [];
  const semDdd: PedidoTeste[] = [];
  for (const pedido of pedidos) {
    const { pais = null, ddd = null } = pedido;
    if (pais !== null && pais !== "55") exterior.push(pedido);
    else if (pais === null || ddd === null || !(ddd in UF_DO_DDD))
      semDdd.push(pedido);
    else doDdd.set(ddd, [...(doDdd.get(ddd) ?? []), pedido]);
  }
  return {
    total: totaisDosPedidos(pedidos),
    exterior: totaisDosPedidos(exterior),
    sem_ddd: totaisDosPedidos(semDdd),
    ddds: Object.fromEntries(
      [...doDdd].map(([ddd, doGrupo]) => [
        ddd,
        { uf: UF_DO_DDD[ddd], ...totaisDosPedidos(doGrupo) },
      ]),
    ),
  };
}

/** O mapa no formato de `esperado`. */
const resumoDoMapa = (corpo: RespostaMapaDdd) => ({
  total: totais(corpo.total),
  exterior: totais(corpo.exterior),
  sem_ddd: totais(corpo.sem_ddd),
  ddds: Object.fromEntries(
    corpo.ddds.map((item) => [item.ddd, { uf: item.uf, ...totais(item) }]),
  ),
});

// ---------------------------------------------------------------------------------------------------
// CA1: o total é o das vendas do painel
// ---------------------------------------------------------------------------------------------------

/** Instantes do relógio: antes do início, na largada, no dia 9, no último dia e depois do fim. */
const RELOGIOS = [
  ["antes do início (dia da reunião de cadastro)", "2026-11-20T15:00:00.000Z"],
  ["na largada (03:00Z do dia 1)", "2026-11-23T03:00:00.000Z"],
  ["no dia 9 (o agora principal)", AGORA.toISOString()],
  ["na virada do dia 7 para o 8 (02:59:59.999Z)", "2026-11-30T02:59:59.999Z"],
  ["no último dia", "2026-12-13T15:00:00.000Z"],
  ["depois do fim", "2026-12-20T15:00:00.000Z"],
] as const;

describe("CA1: sem divisão, o total bate com as vendas da campanha no painel (mesmos dados, mesma janela)", () => {
  beforeAll(async () => {
    await semearCenario({ pedidos: PEDIDOS_COM_TELEFONE });
  });

  it.each(RELOGIOS)(
    "%s: total = vendas do resumo da campanha; janela = a do ranking",
    async (_quando, instante) => {
      agora = new Date(instante);
      const painel = await resumo();
      const doMapa = await mapa();

      expect(totais(doMapa.total)).toEqual(painel.vendas);
      expect(doMapa.janela).toEqual(
        (await ranking("?periodo=campanha")).janela,
      );
      expect(doMapa.divisao).toBeNull();
      expect(doMapa.atualizado_em).toBe(instante);
    },
  );

  it("as vendas sem célula entram no total: o DF (só delas) é exatamente vendas_sem_celula do painel", async () => {
    const painel = await resumo();
    const doMapa = await mapa();

    expect(painel.vendas_sem_celula!.pedidos_aprovados).toBeGreaterThan(0);
    const df = doMapa.ufs.find((item) => item.uf === "DF");
    expect(df && totais(df)).toEqual(painel.vendas_sem_celula);
    expect(doMapa.ddds.filter((item) => item.uf === "DF")).toEqual([
      { ...df, ddd: "61", uf: "DF" },
    ]);
  });

  it.each(RELOGIOS)(
    "%s: periodo=atual tem os bilhetes do período do resumo, e a janela do ranking atual",
    async (_quando, instante) => {
      agora = new Date(instante);
      const painel = await resumo();
      const doMapa = await mapa("?periodo=atual");

      expect(doMapa.janela).toEqual((await ranking("?periodo=atual")).janela);
      // O ritmo do período só existe durante a campanha (a meta é em bilhetes).
      if (painel.periodo !== null)
        expect(doMapa.total.bilhetes).toBe(painel.periodo.realizado);
      else expect(painel.referencia.fase).not.toBe("durante");
    },
  );

  it.each(["jovens", "adultos"] as const)(
    "divisão %s: total = vendas do resumo da divisão (campanha) e a soma do ranking de células da divisão (atual)",
    async (divisao) => {
      for (const [, instante] of RELOGIOS) {
        agora = new Date(instante);
        const daCampanha = await mapa(`?divisao=${divisao}`);
        expect({ instante, total: totais(daCampanha.total) }).toEqual({
          instante,
          total: (await resumo(`?escopo=divisao&divisao=${divisao}`)).vendas,
        });
        expect(daCampanha.divisao).toBe(divisao);

        const doPeriodo = await mapa(`?periodo=atual&divisao=${divisao}`);
        const celulas = await ranking(
          `?nivel=celula&periodo=atual&divisao=${divisao}`,
        );
        expect({ instante, total: totais(doPeriodo.total) }).toEqual({
          instante,
          total: somarTotais(celulas.itens.map((item) => item.vendas)),
        });
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------------
// CA2: o que não conta
// ---------------------------------------------------------------------------------------------------

describe("CA2: compra de teste antes do início, venda depois do fim, pedido não aprovado e de outra campanha não entram", () => {
  // Cada caso com um DDD só dele: o que não conta não pode aparecer em lugar nenhum.
  const PEDIDOS_DA_JANELA: PedidoTeste[] = [
    comTelefone(aprovado(101, "2026-11-20T15:00:00.000Z", 1), "55", "11"), // compra de teste na reunião
    comTelefone(aprovado(102, "2026-11-23T02:59:59.999Z", 2), "55", "12"), // 22/11 23:59:59.999 em Belém
    comTelefone(aprovado(103, "2026-11-23T03:00:00.000Z", 3), "55", "91"), // largada: conta
    comTelefone(aprovado(null, "2026-12-01T15:00:00.000Z", 6), "55", "61"), // sem célula: conta
    comTelefone(aprovado(104, "2026-12-14T02:59:59.999Z", 4), "55", "94"), // último milissegundo do dia 21: conta
    comTelefone(aprovado(105, "2026-12-14T03:00:00.000Z", 5), "55", "21"), // 14/12 00:00: depois do fim
    {
      id: "PT-MAPA-PROCESSO",
      affiliate_id: 101,
      status: "in_process",
      aprovado_em: null,
      qtd_bilhetes: 9,
      total_centavos: 18000,
      pais: "55",
      ddd: "31",
    },
    {
      id: "PT-MAPA-EXPIRADO",
      affiliate_id: 103,
      status: "expired",
      aprovado_em: null,
      qtd_bilhetes: 7,
      total_centavos: 14000,
      pais: "55",
      ddd: "41",
    },
    {
      ...comTelefone(aprovado(101, "2026-12-01T15:00:00.000Z", 50), "55", "51"),
      id: "PT-MAPA-OUTRA",
      campanha: "outra",
    },
  ];

  beforeAll(async () => {
    await semearCenario({ pedidos: PEDIDOS_DA_JANELA });
  });

  it("depois do fim, só a largada, a venda sem célula e o último milissegundo do dia 21 (resposta inteira)", async () => {
    agora = new Date("2026-12-20T15:00:00.000Z");

    expect(await mapa()).toEqual({
      janela: {
        tipo: "campanha",
        ordem: null,
        nome: "Campanha inteira",
        data_inicio: "2026-11-23",
        data_fim: "2026-12-13",
      },
      divisao: null,
      // 13 bilhetes no total: PA 7 (53,84%), DF 6 (46,15%), truncados.
      ufs: [
        {
          uf: "PA",
          pedidos_aprovados: 2,
          bilhetes: 7,
          total_centavos: 14000,
          parte_bilhetes_bp: 5384,
        },
        {
          uf: "DF",
          pedidos_aprovados: 1,
          bilhetes: 6,
          total_centavos: 12000,
          parte_bilhetes_bp: 4615,
        },
      ],
      ddds: [
        {
          ddd: "94",
          uf: "PA",
          pedidos_aprovados: 1,
          bilhetes: 4,
          total_centavos: 8000,
          parte_bilhetes_bp: 3076,
        },
        {
          ddd: "91",
          uf: "PA",
          pedidos_aprovados: 1,
          bilhetes: 3,
          total_centavos: 6000,
          parte_bilhetes_bp: 2307,
        },
        {
          ddd: "61",
          uf: "DF",
          pedidos_aprovados: 1,
          bilhetes: 6,
          total_centavos: 12000,
          parte_bilhetes_bp: 4615,
        },
      ],
      exterior: { ...ZERO, parte_bilhetes_bp: 0 },
      sem_ddd: { ...ZERO, parte_bilhetes_bp: 0 },
      total: {
        pedidos_aprovados: 3,
        bilhetes: 13,
        total_centavos: 26000,
        parte_bilhetes_bp: 10000,
      },
      atualizado_em: "2026-12-20T15:00:00.000Z",
    });
  });

  it("antes do início, nada conta (nem a compra de teste já aprovada): tudo zerado, sem UF nem DDD", async () => {
    agora = new Date("2026-11-22T15:00:00.000Z");
    const corpo = await mapa();

    expect(corpo).toMatchObject({
      ufs: [],
      ddds: [],
      exterior: { ...ZERO, parte_bilhetes_bp: 0 },
      sem_ddd: { ...ZERO, parte_bilhetes_bp: 0 },
      total: { ...ZERO, parte_bilhetes_bp: 0 },
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// CA3: agrupamento, ordem e partes
// ---------------------------------------------------------------------------------------------------

describe("CA3: UF pelo DDD, exterior, sem DDD, ordem, desempates e partes truncadas", () => {
  const DIA_2 = "2026-11-24T15:00:00.000Z";
  const AGRUPAMENTO: PedidoTeste[] = [
    comTelefone(aprovado(101, DIA_2, 5, 9000), "55", "11"), // SP: 5 (com desconto)
    comTelefone(aprovado(102, DIA_2, 3), "55", "61"), // DF: 3 + 2 = 5, empata com SP (DF antes, pela sigla)
    comTelefone(aprovado(null, DIA_2, 2), "55", "61"),
    comTelefone(aprovado(103, DIA_2, 6), "55", "93"), // PA: 6 + 4 + 4 = 14
    comTelefone(aprovado(104, DIA_2, 2), "55", "91"), // 91: dois pedidos, 4 bilhetes
    comTelefone(aprovado(105, DIA_2, 2), "55", "91"),
    comTelefone(aprovado(900, DIA_2, 4), "55", "94"), // 94: 4, empata com o 91 (91 antes, pelo DDD)
    comTelefone(aprovado(101, DIA_2, 1), null), // sem país (sem telefone ou fora do E.164)
    comTelefone(aprovado(102, DIA_2, 2), "55"), // Brasil sem DDD
    comTelefone(aprovado(103, DIA_2, 1), "55", "23"), // DDD fora da tabela da Anatel
    comTelefone(aprovado(104, DIA_2, 3), "1"), // Estados Unidos
    comTelefone(aprovado(105, DIA_2, 1), "351"), // Portugal
  ];

  beforeAll(async () => {
    await semearCenario({ pedidos: AGRUPAMENTO });
  });

  it("resposta inteira: 32 bilhetes, PA (91, 93, 94), DF (61) e SP (11), exterior e sem DDD", async () => {
    const corpo = await mapa();
    const recorte = (
      pedidos_aprovados: number,
      bilhetes: number,
      total_centavos: number,
      parte_bilhetes_bp: number,
    ) => ({ pedidos_aprovados, bilhetes, total_centavos, parte_bilhetes_bp });

    expect(corpo).toEqual({
      janela: {
        tipo: "campanha",
        ordem: null,
        nome: "Campanha inteira",
        data_inicio: "2026-11-23",
        data_fim: "2026-12-13",
      },
      divisao: null,
      // 14/32 = 43,75%; 5/32 = 15,625% → 1562 (truncado, não 1563).
      ufs: [
        { uf: "PA", ...recorte(4, 14, 28000, 4375) },
        { uf: "DF", ...recorte(2, 5, 10000, 1562) },
        { uf: "SP", ...recorte(1, 5, 9000, 1562) },
      ],
      ddds: [
        { ddd: "93", uf: "PA", ...recorte(1, 6, 12000, 1875) },
        { ddd: "91", uf: "PA", ...recorte(2, 4, 8000, 1250) },
        { ddd: "94", uf: "PA", ...recorte(1, 4, 8000, 1250) },
        { ddd: "61", uf: "DF", ...recorte(2, 5, 10000, 1562) },
        { ddd: "11", uf: "SP", ...recorte(1, 5, 9000, 1562) },
      ],
      exterior: recorte(2, 4, 8000, 1250),
      sem_ddd: recorte(3, 4, 8000, 1250),
      total: recorte(12, 32, 63000, 10000),
      atualizado_em: AGORA.toISOString(),
    });
    // As partes truncadas somam menos que 10000.
    const partes = [...corpo.ufs, corpo.exterior, corpo.sem_ddd].map(
      (item) => item.parte_bilhetes_bp,
    );
    expect(partes.reduce((soma, parte) => soma + parte, 0)).toBe(9999);
  });

  it('o banco não aceita o DDD "20" (CHECK [1-9][1-9]); um DDD fora da tabela que ele aceita, como o 23, vai para sem_ddd', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, aprovado_em, pais, ddd)
         VALUES ('PT-DDD-20', (SELECT id FROM campanhas WHERE ativa = 1), 'approved', 1, 2000,
           '2026-11-24T15:00:00.000Z', '55', '20')`,
      ).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect("23" in UF_DO_DDD).toBe(false);
    const corpo = await mapa();
    expect(corpo.ddds.map((item) => item.ddd)).not.toContain("23");
  });

  it("pais e ddd ficam sempre como texto: número ligado pelo JS (REAL no D1) o CHECK recusa; inteiro no SQL vira texto e conta no PA", async () => {
    const inserir = (id: string, valores: string, ...ligados: unknown[]) =>
      env.DB.prepare(
        `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, aprovado_em, pais, ddd)
         VALUES ('${id}', (SELECT id FROM campanhas WHERE ativa = 1), 'approved', 2, 4000,
           '2026-11-24T15:00:00.000Z', ${valores})`,
      )
        .bind(...ligados)
        .run();
    await expect(inserir("PT-PAIS-JS", "?1, NULL", 55)).rejects.toThrow(
      /CHECK constraint failed: pais/,
    );
    await inserir("PT-PAIS-SQL", "55, 91");
    expect(
      await env.DB.prepare(
        "SELECT typeof(pais) AS pais, typeof(ddd) AS ddd FROM pedidos WHERE id = 'PT-PAIS-SQL'",
      ).first(),
    ).toEqual({ pais: "text", ddd: "text" });
    const corpo = await mapa();

    // O 91 tinha 2 pedidos e 4 bilhetes; o exterior continua com os 2 de antes.
    expect(corpo.ddds.find((item) => item.ddd === "91")).toMatchObject({
      uf: "PA",
      pedidos_aprovados: 3,
      bilhetes: 6,
    });
    expect(corpo.exterior.pedidos_aprovados).toBe(2);
    await semearCenario({ pedidos: AGRUPAMENTO });
  });

  it("total sem bilhete: as partes ficam em 0", async () => {
    await semearCenario({
      pedidos: [comTelefone(aprovado(101, DIA_2, 0, 0), "55", "91")],
    });
    const corpo = await mapa();

    expect(corpo.ufs).toEqual([
      {
        uf: "PA",
        pedidos_aprovados: 1,
        bilhetes: 0,
        total_centavos: 0,
        parte_bilhetes_bp: 0,
      },
    ]);
    expect(corpo.total).toEqual({
      pedidos_aprovados: 1,
      bilhetes: 0,
      total_centavos: 0,
      parte_bilhetes_bp: 0,
    });
    await semearCenario({ pedidos: AGRUPAMENTO });
  });
});

// ---------------------------------------------------------------------------------------------------
// CA4: período atual pelo relógio e divisão
// ---------------------------------------------------------------------------------------------------

describe("CA4: periodo=atual é o período que contém hoje; divisao filtra pelas células e deixa as sem célula de fora", () => {
  beforeAll(async () => {
    await semearCenario({ pedidos: PEDIDOS_COM_TELEFONE });
  });

  it.each([
    [
      "dia 9: a Semana 2, até hoje",
      AGORA.toISOString(),
      {
        ordem: 2,
        nome: "Semana 2",
        data_inicio: "2026-11-30",
        data_fim: "2026-12-06",
      },
      "2026-12-01",
    ],
    [
      "02:59:59.999Z de 30/11: ainda o dia 7, na Semana 1",
      "2026-11-30T02:59:59.999Z",
      {
        ordem: 1,
        nome: "Semana 1",
        data_inicio: "2026-11-23",
        data_fim: "2026-11-29",
      },
      "2026-11-29",
    ],
    [
      "03:00Z de 30/11: o dia 8, na Semana 2 (o dia inteiro conta)",
      "2026-11-30T03:00:00.000Z",
      {
        ordem: 2,
        nome: "Semana 2",
        data_inicio: "2026-11-30",
        data_fim: "2026-12-06",
      },
      "2026-11-30",
    ],
    [
      "antes do início: a Semana 1, ainda sem nada",
      "2026-11-20T15:00:00.000Z",
      {
        ordem: 1,
        nome: "Semana 1",
        data_inicio: "2026-11-23",
        data_fim: "2026-11-29",
      },
      "2026-11-20",
    ],
    [
      "depois do fim: a Semana 3 inteira (sem a venda de 14/12)",
      "2026-12-20T15:00:00.000Z",
      {
        ordem: 3,
        nome: "Semana 3",
        data_inicio: "2026-12-07",
        data_fim: "2026-12-13",
      },
      "2026-12-13",
    ],
  ])("%s", async (_quando, instante, periodo, ultimoDia) => {
    agora = new Date(instante);
    const corpo = await mapa("?periodo=atual");

    expect(corpo.janela).toEqual({ tipo: "atual", ...periodo });
    expect(resumoDoMapa(corpo)).toEqual(
      esperado(contam(PEDIDOS_COM_TELEFONE, periodo.data_inicio, ultimoDia)),
    );
  });

  it("o relógio injetado vale também para a campanha inteira: no dia 9, só até 01/12", async () => {
    const corpo = await mapa("?periodo=campanha");

    expect(resumoDoMapa(corpo)).toEqual(
      esperado(contam(PEDIDOS_COM_TELEFONE, "2026-11-23", "2026-12-01")),
    );
    expect(corpo.total.pedidos_aprovados).toBeGreaterThan(0);
  });

  it.each(["jovens", "adultos"] as const)(
    "divisão %s: só as vendas das células dela; as sem célula (o DF) ficam de fora",
    async (divisao) => {
      agora = new Date("2026-12-20T15:00:00.000Z");
      for (const periodo of ["campanha", "atual"] as const) {
        const corpo = await mapa(`?periodo=${periodo}&divisao=${divisao}`);
        const de = periodo === "campanha" ? "2026-11-23" : "2026-12-07";

        expect(corpo.divisao).toBe(divisao);
        expect(resumoDoMapa(corpo)).toEqual(
          esperado(contam(PEDIDOS_COM_TELEFONE, de, "2026-12-13", divisao)),
        );
        expect(corpo.ufs.map((item) => item.uf)).not.toContain("DF");
      }
    },
  );

  it("jovens + adultos + as sem célula = o total sem divisão", async () => {
    agora = new Date("2026-12-20T15:00:00.000Z");
    const [todas, jovens, adultos] = await Promise.all([
      mapa(),
      mapa("?divisao=jovens"),
      mapa("?divisao=adultos"),
    ]);
    const df = todas.ufs.find((item) => item.uf === "DF")!;

    expect(jovens.total.pedidos_aprovados).toBeGreaterThan(0);
    expect(adultos.total.pedidos_aprovados).toBeGreaterThan(0);
    expect(somarTotais([jovens.total, adultos.total, df].map(totais))).toEqual(
      totais(todas.total),
    );
  });
});

// ---------------------------------------------------------------------------------------------------
// R6 com o fuso da campanha fora de Belém (revisão): o intervalo UTC sai do fuso dela, como o dia do painel
// ---------------------------------------------------------------------------------------------------

describe("R6 com outro fuso: o total bate com o painel e com a conta pelo dia local no fuso da campanha", () => {
  type Caso = {
    fuso: string;
    data_inicio: string;
    /** aprovado_em (UTC), país e DDD; os bilhetes vão de 1 em diante, um valor por pedido. */
    pedidos: [string, string | null, string | null][];
    relogios: string[];
  };
  const CASOS: [string, Caso][] = [
    [
      "Asia/Kathmandu (UTC+05:45, fixo)",
      {
        fuso: "Asia/Kathmandu",
        data_inicio: "2026-11-23",
        // 23/11 00:00 em Katmandu = 22/11 18:15Z; o dia 21 (13/12) termina em 13/12 18:15Z.
        pedidos: [
          ["2026-11-22T18:14:59.999Z", "55", "11"], // 22/11 23:59:59.999: antes do início
          ["2026-11-22T18:15:00.000Z", "55", "91"], // 23/11 00:00: dia 1
          ["2026-12-01T18:14:59.999Z", "55", "61"], // 01/12 23:59:59.999: dia 9
          ["2026-12-01T18:15:00.000Z", "1", null], // 02/12 00:00: dia 10
          ["2026-12-13T18:14:59.999Z", null, null], // 13/12 23:59:59.999: dia 21 (último)
          ["2026-12-13T18:15:00.000Z", "55", "21"], // 14/12 00:00: depois do fim
        ],
        relogios: [
          "2026-11-22T18:14:59.999Z", // ainda 22/11 lá: antes do início
          "2026-11-22T18:15:00.000Z", // a largada lá (em Belém, ainda 22/11)
          "2026-12-01T18:14:59.999Z", // fim do dia 9 lá: o 02/12 ainda não chegou
          "2026-12-01T18:15:00.000Z", // dia 10 lá
          "2026-12-20T15:00:00.000Z", // depois do fim
        ],
      },
    ],
    [
      "America/New_York (fim do horário de verão em 01/11/2026)",
      {
        fuso: "America/New_York",
        data_inicio: "2026-10-26",
        // 26/10 00:00 EDT (UTC−4) = 26/10 04:00Z; o dia 21 (15/11) termina em 16/11 05:00Z (EST, UTC−5).
        pedidos: [
          ["2026-10-26T03:59:59.999Z", "55", "11"], // 25/10 23:59:59.999 EDT: antes do início
          ["2026-10-26T04:00:00.000Z", "55", "91"], // 26/10 00:00 EDT: dia 1
          ["2026-11-02T04:30:00.000Z", "55", "61"], // 01/11 23:30 EST (com −4 fixo, seria 02/11)
          ["2026-11-02T05:00:00.000Z", "351", null], // 02/11 00:00 EST
          ["2026-11-16T04:59:59.999Z", "55", "94"], // 15/11 23:59:59.999 EST: dia 21 (último)
          ["2026-11-16T05:00:00.000Z", "55", "21"], // 16/11 00:00 EST: depois do fim
        ],
        relogios: [
          "2026-10-26T03:59:59.999Z", // ainda 25/10 lá: antes do início
          "2026-10-26T04:00:00.000Z", // a largada lá
          "2026-11-02T04:59:59.999Z", // 01/11 23:59:59.999 EST: o 02/11 ainda não chegou
          "2026-11-02T05:00:00.000Z", // 02/11 00:00 EST
          "2026-11-20T15:00:00.000Z", // depois do fim
        ],
      },
    ],
  ];
  const AFILIADOS_DOS_PEDIDOS = [101, null, 104, 900, 102, 105] as const;

  describe.each(CASOS)("%s", (_nome, caso) => {
    const pedidos = caso.pedidos.map(([instante, pais, ddd], indice) =>
      comTelefone(
        aprovado(
          AFILIADOS_DOS_PEDIDOS[indice % AFILIADOS_DOS_PEDIDOS.length],
          instante,
          indice + 1,
        ),
        pais,
        ddd,
      ),
    );
    const ultimoDia = dia(21, caso.data_inicio);

    beforeAll(async () => {
      await semearCenario({
        campanha: campanhaEntradaSchema.parse({
          ...DADOS_CAMPANHA,
          fuso_horario: caso.fuso,
          data_inicio: caso.data_inicio,
        }),
        pedidos,
      });
    });

    it.each(caso.relogios)("relógio em %s", async (instante) => {
      agora = new Date(instante);
      const hoje = diaLocalDoInstante(agora, caso.fuso);
      const ate = (fim: string) => (diasEntre(hoje, fim) > 0 ? hoje : fim);

      const daCampanha = await mapa();
      expect(totais(daCampanha.total)).toEqual((await resumo()).vendas);
      expect(resumoDoMapa(daCampanha)).toEqual(
        esperado(
          contam(
            pedidos,
            caso.data_inicio,
            ate(ultimoDia),
            undefined,
            caso.fuso,
          ),
        ),
      );

      const doPeriodo = await mapa("?periodo=atual");
      expect(doPeriodo.janela).toEqual(
        (await ranking("?periodo=atual")).janela,
      );
      expect(resumoDoMapa(doPeriodo)).toEqual(
        esperado(
          contam(
            pedidos,
            doPeriodo.janela.data_inicio,
            ate(doPeriodo.janela.data_fim),
            undefined,
            caso.fuso,
          ),
        ),
      );
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// CA5: erros e login
// ---------------------------------------------------------------------------------------------------

describe("CA5: 400 na consulta inválida, 404 sem campanha ativa, 401/403 por papel", () => {
  beforeAll(async () => {
    await semearCenario();
  });

  it.each([
    "?periodo=semana",
    "?periodo=",
    "?divisao=criancas",
    "?divisao=",
    "?periodo=atual&divisao=Jovens",
  ])("GET %s: 400 requisicao_invalida", async (consulta) => {
    const erro = await esperarErro(consulta, 400, "requisicao_invalida");
    expect(erro.detalhes).toEqual([
      expect.objectContaining({
        caminho: [consulta.includes("divisao") ? "divisao" : "periodo"],
      }),
    ]);
  });

  it("parâmetro desconhecido é ignorado (o schema da consulta descarta): responde a campanha inteira", async () => {
    const corpo = await mapa("?escopo=celula&id=1&data=2026-11-29");
    expect(corpo.janela.tipo).toBe("campanha");
    expect(corpo.divisao).toBeNull();
  });

  it("sem campanha ativa: 404 nao_encontrado (com e sem consulta)", async () => {
    await limparBanco();
    for (const consulta of ["", "?periodo=atual&divisao=jovens"])
      expect(await esperarErro(consulta, 404, "nao_encontrado")).toEqual({
        codigo: "nao_encontrado",
        mensagem: "A campanha ainda não foi configurada",
      });
    // Os outros testes deste bloco contam com o cenário (a ordem pode ser embaralhada).
    await semearCenario();
  });

  describe("no app real (index.ts)", () => {
    const pedir = (cabecalhos: Record<string, string> = {}) =>
      exports.default.fetch(`${ORIGEM}/api/painel/mapa-ddd?periodo=atual`, {
        headers: cabecalhos,
      });

    beforeAll(async () => {
      await semearCenario({ pedidos: PEDIDOS_COM_TELEFONE });
    });

    it("sem sessão: 401 nao_autenticado", async () => {
      const res = await pedir();
      expect({ status: res.status, corpo: await res.json() }).toMatchObject({
        status: 401,
        corpo: { erro: { codigo: "nao_autenticado" } },
      });
    });

    it.each(PAPEIS_HIERARQUIA)("sessão de %s: 403 proibido", async (papel) => {
      const alvo = { lider: 1, discipulador: 10, rede: 1 }[papel];
      const res = await pedir(
        await cabecalhosDeSessaoDaHierarquia(papel, alvo),
      );
      expect({ status: res.status, corpo: await res.json() }).toMatchObject({
        status: 403,
        corpo: { erro: { codigo: "proibido" } },
      });
    });

    it.each(["coordenacao", "admin"] as const)(
      "sessão de %s: 200 no contrato, sem cache",
      async (papel) => {
        const res = await pedir(await cabecalhosDeSessao(papel));
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        respostaMapaDddSchema.parse(await res.json());
      },
    );
  });
});

// ---------------------------------------------------------------------------------------------------
// CA7: nenhum dado pessoal
// ---------------------------------------------------------------------------------------------------

describe("CA7: nenhum dado pessoal na resposta nem na leitura", () => {
  const CAMPOS_DO_MAPA = new Set([
    "janela",
    "tipo",
    "ordem",
    "nome",
    "data_inicio",
    "data_fim",
    "divisao",
    "ufs",
    "ddds",
    "uf",
    "ddd",
    "exterior",
    "sem_ddd",
    "total",
    "pedidos_aprovados",
    "bilhetes",
    "total_centavos",
    "parte_bilhetes_bp",
    "atualizado_em",
  ]);

  beforeAll(async () => {
    await semearCenario({ pedidos: PEDIDOS_COM_TELEFONE });
  });

  it("só os campos do contrato, e nenhum nome da hierarquia, de afiliado ou de pedido nos textos", async () => {
    agora = new Date("2026-12-20T15:00:00.000Z");
    for (const consulta of ["", "?periodo=atual&divisao=jovens"]) {
      const corpo = await mapa(consulta);
      expect(
        [...camposDe(corpo)].filter((campo) => !CAMPOS_DO_MAPA.has(campo)),
      ).toEqual([]);
      // Textos: só a janela (nome e datas), a divisão, UFs, DDDs e o instante.
      for (const texto of textosDe(corpo))
        expect(texto).toMatch(
          /^(Campanha inteira|Semana \d|\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?|campanha|atual|jovens|[A-Z]{2}|\d{2})$/,
        );
    }
  });

  it("o SQL lê de pedidos só país, DDD, bilhetes e total (e da hierarquia, só ids e a divisão)", () => {
    for (const divisao of [undefined, "jovens"] as const) {
      const { sql } = comandoMapaDdd(
        1,
        { inicio: "2026-11-23T03:00:00.000Z", fim: "2026-12-14T03:00:00.000Z" },
        divisao,
      );
      expect(sql).toMatch(
        /^\s*SELECT pais, ddd, count\(\*\) AS pedidos, sum\(qtd_bilhetes\) AS bilhetes, sum\(total_centavos\) AS centavos\s+FROM pedidos\s/,
      );
      expect(sql).not.toMatch(
        /telefone|phone|nome|email|buyer|utm_|numeros|lider|cupom|metodo|notas?\b/i,
      );
      // Nenhuma coluna além destas (palavras do SQL fora): status, datas, ids, valores, país, DDD, divisão e a data
      // da desconsideração do admin (D20: o desconsiderado não conta no mapa).
      const identificadores = new Set(
        sql
          .replace(/'[^']*'/g, "")
          .match(/\b[a-z_]+\b/g)!
          .filter(
            (palavra) =>
              !/^(select|count|sum|as|from|where|and|in|join|on|group|by)$/.test(
                palavra,
              ),
          ),
      );
      expect([...identificadores].sort()).toEqual(
        (divisao === undefined
          ? [
              "aprovado_em",
              "bilhetes",
              "campanha_id",
              "centavos",
              "ddd",
              "desconsiderado_em",
              "pais",
              "pedidos",
              "qtd_bilhetes",
              "status",
              "total_centavos",
            ]
          : [
              "a",
              "affiliate_id",
              "afiliados",
              "aprovado_em",
              "bilhetes",
              "c",
              "campanha_id",
              "celula_id",
              "celulas",
              "centavos",
              "d",
              "ddd",
              "desconsiderado_em",
              "discipulador_id",
              "discipuladores",
              "divisao",
              "id",
              "pais",
              "pedidos",
              "qtd_bilhetes",
              "r",
              "rede_id",
              "redes",
              "status",
              "total_centavos",
            ]
        ).sort(),
      );
    }
  });
});
