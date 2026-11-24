// Leitura do painel (db/painel.ts) com o D1 dos testes: consultas agregadas (CA1), dia local no SQL igual ao
// do Intl, escopo, data futura, campanha ausente e o caminho de fuso com horário de verão. O banco é do
// arquivo de teste (compartilhado entre os testes dele).
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  agruparVendasPorDia,
  campanhaEntradaSchema,
  type VendasDoDia,
} from "../../shared/contracts";
import {
  AGORA,
  CAMPANHA,
  CELULAS,
  DADOS_CAMPANHA,
  PEDIDOS,
  aprovado,
  bancoQueConta,
  desconsiderado,
  entradaEsperada,
  limparBanco,
  ordenarVendas,
  semearCenario,
} from "../test/painel-apoio";
import {
  DESLOCAMENTO_DO_INDICE,
  SELECIONAR_VENDAS,
  SELECIONAR_VENDAS_POR_DIA,
  SELECIONAR_VENDAS_POR_DIA_UTC_MENOS_3,
  lerEntradaDoCalculo,
  type LeituraDoCalculo,
} from "./painel";

const relogio = () => AGORA;

async function ler(
  consulta: Parameters<typeof lerEntradaDoCalculo>[2] = {},
  db: D1Database = env.DB,
  agora = AGORA,
) {
  return lerEntradaDoCalculo(db, () => agora, consulta);
}

function lida(leitura: LeituraDoCalculo) {
  if (!leitura.ok) throw new Error(`leitura falhou: ${leitura.mensagem}`);
  return leitura;
}

const linha = (
  vendas: readonly VendasDoDia[],
  celula_id: number | null,
  dia: string,
) => vendas.find((item) => item.celula_id === celula_id && item.dia === dia);

describe("CA1: leitura agregada do cenário", () => {
  beforeAll(async () => {
    await semearCenario();
  });

  it("devolve a campanha ativa e TODAS as células com a hierarquia e qtd_pessoas", async () => {
    const { entrada } = lida(await ler());

    expect(entrada.celulas).toEqual(CELULAS);
    expect(entrada.campanha).toMatchObject(CAMPANHA);
  });

  it("agrupa as vendas por célula e dia local no SQL exatamente como o agruparVendasPorDia do contrato", async () => {
    const { entrada } = lida(await ler());

    expect(ordenarVendas(entrada.vendas)).toEqual(
      ordenarVendas(entradaEsperada().vendas),
    );
  });

  it("vira o dia às 03:00Z (Belém, UTC−3): 02:59:59.999Z fica no dia anterior", async () => {
    const { vendas } = lida(await ler()).entrada;

    // Véspera às 02:59:59.999Z (22/11) e largada às 03:00Z (23/11), ambas da Betel.
    expect(linha(vendas, 2, "2026-11-22")).toMatchObject({
      pedidos: 1,
      bilhetes: 2,
    });
    expect(linha(vendas, 2, "2026-11-23")).toMatchObject({
      pedidos: 1,
      bilhetes: 3,
    });
    // Dia 7 → 8: a Ágape às 02:59:59.999Z de 30/11 é do dia 29; a Canaã às 03:00Z, do dia 30.
    expect(linha(vendas, 1, "2026-11-29")).toMatchObject({ bilhetes: 6 });
    expect(linha(vendas, 3, "2026-11-30")).toMatchObject({ bilhetes: 6 });
    // Último dia (13/12) e o primeiro instante depois do fim (14/12).
    expect(linha(vendas, 5, "2026-12-13")).toMatchObject({ bilhetes: 3 });
    expect(linha(vendas, 4, "2026-12-14")).toMatchObject({ bilhetes: 4 });
  });

  it("traz as vendas de fora da janela e as sem célula (sem afiliado ou afiliado não vinculado) com celula_id null", async () => {
    const { vendas } = lida(await ler()).entrada;

    expect(linha(vendas, 1, "2026-11-20")).toMatchObject({ bilhetes: 1 });
    expect(linha(vendas, null, "2026-11-25")).toEqual({
      celula_id: null,
      dia: "2026-11-25",
      pedidos: 1,
      bilhetes: 4,
      centavos: 8000,
    });
    expect(linha(vendas, null, "2026-11-26")).toMatchObject({ bilhetes: 2 });
    expect(linha(vendas, null, "2026-12-01")).toMatchObject({ bilhetes: 1 });
  });

  it("só conta pedidos aprovados da campanha ativa (nem em processo, nem expirados, nem de outra campanha)", async () => {
    const { vendas } = lida(await ler()).entrada;
    const aprovadosDaAtiva = PEDIDOS.filter(
      (pedido) => pedido.status === "approved" && pedido.campanha !== "outra",
    );
    const somar = (campo: "pedidos" | "bilhetes" | "centavos") =>
      vendas.reduce((total, item) => total + item[campo], 0);

    expect(somar("pedidos")).toBe(aprovadosDaAtiva.length);
    expect(somar("bilhetes")).toBe(
      aprovadosDaAtiva.reduce(
        (total, pedido) => total + pedido.qtd_bilhetes,
        0,
      ),
    );
    expect(somar("centavos")).toBe(
      aprovadosDaAtiva.reduce(
        (total, pedido) => total + pedido.total_centavos,
        0,
      ),
    );
    // A Dorcas tem um pedido com desconto: arrecadação ≠ bilhetes × preço.
    expect(linha(vendas, 4, "2026-11-28")).toEqual({
      celula_id: 4,
      dia: "2026-11-28",
      pedidos: 2,
      bilhetes: 15,
      centavos: 7 * 2000 + 8 * 1800,
    });
  });

  it("duas idas ao banco, sem N+1: a campanha e um batch (células e vendas; no resumo de rede, +1 comando)", async () => {
    const semEscopo = bancoQueConta();
    lida(await ler({}, semEscopo.db));
    expect(semEscopo.contagem).toMatchObject({ idas: 2, comandos: 3 });

    const comEscopo = bancoQueConta();
    lida(await ler({ escopo: { escopo: "rede", id: 2 } }, comEscopo.db));
    expect(comEscopo.contagem).toMatchObject({ idas: 2, comandos: 4 });
  });

  it("chama o relógio uma vez e devolve esse mesmo instante", async () => {
    const relogioEspiao = vi.fn(relogio);

    const leitura = lida(
      await lerEntradaDoCalculo(env.DB, relogioEspiao, { data: "2026-11-29" }),
    );

    expect(relogioEspiao).toHaveBeenCalledOnce();
    expect(leitura.agora).toBe(AGORA);
  });

  it("em UTC−3 (Belém), as vendas saem do índice da migração 0003 já na ordem do GROUP BY, sem a view", async () => {
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN ${SELECIONAR_VENDAS_POR_DIA_UTC_MENOS_3}`,
    )
      .bind(1)
      .all<{ detail: string }>();
    const plano = results.map((linha) => linha.detail);

    expect(DESLOCAMENTO_DO_INDICE).toBe(-180);
    // O índice de cobertura dá os pedidos agrupados por afiliado e dia: a única B-tree temporária é a
    // do agrupamento final por célula, sobre as linhas já agrupadas. Nenhuma tabela da hierarquia.
    expect(plano).toContainEqual(
      expect.stringMatching(
        /^SEARCH pedidos USING COVERING INDEX pedidos_aprovados_por_afiliado_dia \(campanha_id=\?\)$/,
      ),
    );
    expect(plano.filter((passo) => passo.includes("TEMP B-TREE"))).toHaveLength(
      1,
    );
    expect(
      plano.filter((passo) => /\b(celulas|discipuladores|redes)\b/.test(passo)),
    ).toEqual([]);
  });
});

describe("CA2: escopo do resumo e data de referência", () => {
  beforeAll(async () => {
    await semearCenario();
  });

  it.each([
    [
      { escopo: "campanha" },
      {
        tipo: "campanha",
        id: null,
        divisao: null,
        nome: "Projeto Videira Kids",
      },
    ],
    [
      { escopo: "divisao", divisao: "adultos" },
      { tipo: "divisao", id: null, divisao: "adultos", nome: "Adultos" },
    ],
    [
      { escopo: "rede", id: 2 },
      {
        tipo: "rede",
        id: 2,
        divisao: "adultos",
        nome: "Rede Adulta Ficticia",
      },
    ],
    [
      { escopo: "discipulador", id: 40 },
      {
        tipo: "discipulador",
        id: 40,
        divisao: "adultos",
        nome: "Discipulador Davi",
      },
    ],
    [
      { escopo: "celula", id: 3 },
      { tipo: "celula", id: 3, divisao: "jovens", nome: "Célula Canaã" },
    ],
    // RIFA-092: o grupo da migração 0018 (mesmo sem células), sem divisão.
    [
      { escopo: "grupo", id: 1 },
      { tipo: "grupo", id: 1, divisao: null, nome: "Adultos da manhã" },
    ],
  ] as const)("resolve %o", async (pedido, esperado) => {
    expect(lida(await ler({ escopo: pedido })).escopo).toEqual(esperado);
  });

  it.each([
    ["grupo", "Grupo não encontrado"],
    ["rede", "Rede não encontrada"],
    ["discipulador", "Discipulador não encontrado"],
    ["celula", "Célula não encontrada"],
  ] as const)("%s inexistente: 404 nao_encontrado", async (tipo, mensagem) => {
    expect(await ler({ escopo: { escopo: tipo, id: 999 } })).toEqual({
      ok: false,
      codigo: "nao_encontrado",
      mensagem,
    });
  });

  it("RIFA-092: cada célula vem com o grupo efetivo (o próprio; senão, o do discipulador; senão, null), no mesmo lote", async () => {
    // Abel (10) em "Adultos da noite" (2), Caleb (30) em "Adultos da manhã" (1), Boaz (20) sem grupo; a Betel (2, do
    // Abel) com o grupo próprio "Adolescentes" (4) e a Éfeso (5, do Caleb) com o próprio igual ao do discipulador.
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE discipuladores SET grupo_id = CASE id WHEN 10 THEN 2 WHEN 30 THEN 1 END",
      ),
      env.DB.prepare(
        "UPDATE celulas SET grupo_id = CASE id WHEN 2 THEN 4 WHEN 5 THEN 1 END",
      ),
    ]);
    try {
      const banco = bancoQueConta();
      const { entrada } = lida(
        await ler({ escopo: { escopo: "grupo", id: 4 } }, banco.db),
      );

      expect(
        entrada.celulas.map((celula) => [celula.id, celula.grupo_efetivo_id]),
      ).toEqual([
        [1, 2],
        [2, 4],
        [3, null],
        [4, 1],
        [5, 1],
      ]);
      expect(banco.contagem).toMatchObject({ idas: 2, comandos: 4 });
    } finally {
      await env.DB.batch([
        env.DB.prepare("UPDATE discipuladores SET grupo_id = NULL"),
        env.DB.prepare("UPDATE celulas SET grupo_id = NULL"),
      ]);
    }
  });

  it("data futura no fuso da campanha: 400 com o detalhe data_futura; hoje e o passado passam", async () => {
    const futura = {
      ok: false,
      codigo: "requisicao_invalida",
      mensagem: "Consulta inválida",
      detalhes: [
        {
          caminho: ["data"],
          codigo: "data_futura",
          mensagem: "A data não pode ser depois de hoje",
        },
      ],
    };

    expect(await ler({ data: "2026-12-02" })).toEqual(futura);
    expect((await ler({ data: "2026-12-01" })).ok).toBe(true);
    expect((await ler({ data: "2026-11-20" })).ok).toBe(true);
    // Às 02:59:59.999Z de 02/12 ainda é 01/12 em Belém; às 03:00Z já é 02/12.
    expect(
      await ler(
        { data: "2026-12-02" },
        env.DB,
        new Date("2026-12-02T02:59:59.999Z"),
      ),
    ).toEqual(futura);
    expect(
      (
        await ler(
          { data: "2026-12-02" },
          env.DB,
          new Date("2026-12-02T03:00:00.000Z"),
        )
      ).ok,
    ).toBe(true);
  });
});

describe("dia local com outros fusos", () => {
  it("fuso fixo fora de Belém (Asia/Kathmandu, UTC+05:45): ainda no SQL, com o dia certo", async () => {
    const campanha = campanhaEntradaSchema.parse({
      ...DADOS_CAMPANHA,
      fuso_horario: "Asia/Kathmandu",
    });
    const pedidos = [
      aprovado(101, "2026-11-23T18:14:59.999Z", 2), // 23/11 23:59:59.999 em Katmandu
      aprovado(101, "2026-11-23T18:15:00.000Z", 3), // 24/11 00:00
    ];
    await semearCenario({ campanha, pedidos });
    const contagem = bancoQueConta();

    const { entrada } = lida(await ler({}, contagem.db));

    expect(ordenarVendas(entrada.vendas)).toEqual(
      ordenarVendas(entradaEsperada(campanha, pedidos).vendas),
    );
    expect(entrada.vendas.map((item) => item.dia).sort()).toEqual([
      "2026-11-23",
      "2026-11-24",
    ]);
    expect(contagem.contagem.idas).toBe(2);
  });

  it("fuso com horário de verão (America/New_York, fim do horário de verão em 01/11/2026): cai para as vendas uma a uma, com o dia certo", async () => {
    const campanha = campanhaEntradaSchema.parse({
      ...DADOS_CAMPANHA,
      fuso_horario: "America/New_York",
      data_inicio: "2026-10-26",
    });
    const pedidos = [
      aprovado(101, "2026-10-27T03:30:00.000Z", 1), // 26/10 23:30 EDT (UTC−4)
      aprovado(102, "2026-11-01T05:30:00.000Z", 2), // 01/11 01:30 EDT, antes da troca
      aprovado(103, "2026-11-01T06:30:00.000Z", 3), // 01/11 01:30 EST (UTC−5), depois da troca
      aprovado(104, "2026-11-02T04:30:00.000Z", 4), // 01/11 23:30 EST: com −4 fixo seria 02/11
    ];
    await semearCenario({ campanha, pedidos });
    const contagem = bancoQueConta();

    const { entrada } = lida(await ler({}, contagem.db));

    const esperadas = agruparVendasPorDia(
      pedidos.map((pedido, indice) => ({
        celula_id: indice + 1,
        aprovado_em: pedido.aprovado_em!,
        qtd_bilhetes: pedido.qtd_bilhetes,
        total_centavos: pedido.total_centavos,
      })),
      "America/New_York",
    );
    expect(ordenarVendas(entrada.vendas)).toEqual(ordenarVendas(esperadas));
    expect(linha(entrada.vendas, 4, "2026-11-01")).toMatchObject({
      bilhetes: 4,
    });
    // A campanha, o batch e a releitura das vendas uma a uma.
    expect(contagem.contagem.idas).toBe(3);
  });
});

describe("RIFA-028 (D20): o pedido desconsiderado não conta, nas três formas da leitura", () => {
  /** Plano de uma consulta (só o id da campanha, e o deslocamento na forma com parâmetro). */
  async function plano(sql: string, ...valores: unknown[]) {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...valores)
      .all<{ detail: string }>();
    return results.map((linha) => linha.detail);
  }
  const COBERTURA =
    "SEARCH pedidos USING COVERING INDEX pedidos_aprovados_por_afiliado_dia (campanha_id=?)";

  it.each([
    ["America/Belem (UTC−3: o literal igual ao do índice)", "America/Belem", 2],
    ["Asia/Kathmandu (o deslocamento por parâmetro)", "Asia/Kathmandu", 2],
    ["America/New_York (as vendas uma a uma)", "America/New_York", 3],
  ] as const)(
    "%s: o desconsiderado sai da soma (aprovado, em processo e sem afiliado)",
    async (_nome, fuso, idas) => {
      const campanha = campanhaEntradaSchema.parse({
        ...DADOS_CAMPANHA,
        fuso_horario: fuso,
        data_inicio: "2026-10-26",
      });
      const contam = [
        aprovado(101, "2026-11-01T05:30:00.000Z", 2),
        aprovado(102, "2026-11-01T06:30:00.000Z", 3),
        aprovado(null, "2026-11-02T15:00:00.000Z", 4),
      ];
      const fora = [
        desconsiderado(aprovado(101, "2026-11-01T05:40:00.000Z", 50)),
        desconsiderado(aprovado(null, "2026-11-02T15:10:00.000Z", 7), "fraude"),
        desconsiderado(aprovado(103, "2026-11-03T15:00:00.000Z", 9), "estorno"),
        // Um pedido de teste que ainda não foi pago (o status não importa).
        desconsiderado({
          ...aprovado(101, "2026-11-01T05:50:00.000Z", 1),
          status: "in_process",
          aprovado_em: null,
        }),
      ];
      await semearCenario({ campanha, pedidos: [...contam, ...fora] });
      const contagem = bancoQueConta();

      const { entrada } = lida(await ler({}, contagem.db));

      expect(ordenarVendas(entrada.vendas)).toEqual(
        ordenarVendas(entradaEsperada(campanha, contam).vendas),
      );
      expect(
        entrada.vendas.reduce((soma, venda) => soma + venda.bilhetes, 0),
      ).toBe(9);
      // A célula 3 (Canaã) só tinha o pedido desconsiderado: nenhuma venda dela.
      expect(entrada.vendas.filter((venda) => venda.celula_id === 3)).toEqual(
        [],
      );
      expect(contagem.contagem.idas).toBe(idas);
    },
  );

  it("os planos das três formas: o índice de cobertura recriado na 0008, sem voltar à tabela", async () => {
    // UTC−3: os pedidos já saem agrupados por afiliado e dia (a única B-tree é a do agrupamento por célula).
    expect(await plano(SELECIONAR_VENDAS_POR_DIA_UTC_MENOS_3, 1)).toEqual([
      "CO-ROUTINE v",
      COBERTURA,
      "SCAN v",
      "SEARCH a USING INDEX sqlite_autoindex_afiliados_1 (affiliate_id=?) LEFT-JOIN",
      "USE TEMP B-TREE FOR GROUP BY",
    ]);
    // Outro deslocamento: o mesmo índice de cobertura, com o agrupamento por dia numa B-tree temporária.
    const comParametro = await plano(
      SELECIONAR_VENDAS_POR_DIA,
      1,
      "+345 minutes",
    );
    expect(comParametro).toContain(COBERTURA);
    expect(comParametro.join("\n")).not.toMatch(
      /pedidos_por_campanha_registro|pedidos_por_status_aprovacao/,
    );
    // Uma a uma (fuso com horário de verão): o índice de cobertura e o afiliado de cada venda.
    expect(await plano(SELECIONAR_VENDAS, 1)).toEqual([
      "SEARCH p USING COVERING INDEX pedidos_aprovados_por_afiliado_dia (campanha_id=?)",
      "SEARCH a USING INDEX sqlite_autoindex_afiliados_1 (affiliate_id=?) LEFT-JOIN",
    ]);
  });

  it("sem o filtro do desconsiderado, o índice parcial não vale (por isso a consulta o repete)", async () => {
    // A armadilha da D20 (OBRIGATÓRIO 3): sem `desconsiderado_em IS NULL`, o planejador não pode usar o índice
    // parcial recriado e vai para o da 0007.
    const semFiltro = SELECIONAR_VENDAS_POR_DIA_UTC_MENOS_3.replace(
      " AND desconsiderado_em IS NULL",
      "",
    );
    expect(semFiltro).not.toBe(SELECIONAR_VENDAS_POR_DIA_UTC_MENOS_3);
    expect((await plano(semFiltro, 1)).join("\n")).not.toContain(COBERTURA);
  });
});

describe("sem campanha ativa", () => {
  it("404 nao_encontrado, sem ler células nem vendas", async () => {
    await limparBanco();
    const contagem = bancoQueConta();

    expect(await ler({}, contagem.db)).toEqual({
      ok: false,
      codigo: "nao_encontrado",
      mensagem: "A campanha ainda não foi configurada",
    });
    expect(contagem.contagem.idas).toBe(1);
  });
});
