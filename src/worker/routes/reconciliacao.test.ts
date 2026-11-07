// POST /api/admin/reconciliacao/analisar, POST /api/admin/reconciliacao/recuperar e
// GET /api/admin/reconciliacao/recuperacoes (RIFA-012; docs/api.md), com o D1 dos testes e o relógio fixo.
// O banco é do arquivo de teste: o beforeEach grava o cenário de novo (conferencia-apoio.ts). O login fica
// de fora daqui (é do index.ts; protecao.test.ts confere no app real). Os corpos são os que o NAVEGADOR
// manda (corpoDe: a mesma leitura do CSV da tela, src/shared/conferencia). Todo CSV e todo dado pessoal são
// fictícios; os corpos enviados, as respostas, o banco e o log são varridos atrás deles.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import paidOrderAfiliado from "../../../test/fixtures/rifei/paid_order.afiliado.json";
import {
  LIMITE_CORPO_CONFERENCIA_BYTES,
  LIMITE_PEDIDOS_RECUPERAR,
  TIPOS_DIVERGENCIA,
  erroApiSchema,
  respostaAnaliseReconciliacaoSchema,
  respostaListaRecuperacoesSchema,
  respostaPainelResumoSchema,
  respostaRankingSchema,
  respostaRecuperarReconciliacaoSchema,
  type CodigoErro,
  type ColunasDoCorpo,
  type CorpoConferencia,
  type MapeamentoReconciliacao,
  type PedidoRecuperado,
  type RespostaAnaliseAgregada,
  type RespostaAnalisePorPedido,
  type UsuarioSessao,
} from "../../shared/contracts";
import { juntarAvisos } from "../../shared/conferencia/avisos";
import { gravarRecuperacao } from "../db/reconciliacao";
import { sha256Hex } from "../lib/cripto";
import app from "../index";
import { cabecalhosDeSessao } from "../test/acesso-teste";
import {
  AGORA_CONFERENCIA,
  DADOS_PESSOAIS,
  LINHAS_DO_CENARIO,
  MAPEAMENTO_DO_CENARIO,
  corpoDe,
  criarAppDaConferencia,
  criarPessoaDaCoordenacao,
  csvDoCenario,
  montarCsv,
  obter,
  postar,
  semearConferencia,
  textosPessoaisEm,
  type LinhaRifei,
  type RespostaDeTeste,
} from "../test/conferencia-apoio";
import { DADOS_CAMPANHA } from "../test/painel-apoio";
import { webhookRifei } from "./webhook-rifei";

const ANALISAR = "/api/admin/reconciliacao/analisar";
const RECUPERAR = "/api/admin/reconciliacao/recuperar";
const RECUPERACOES = "/api/admin/reconciliacao/recuperacoes";
const RECUPERAVEIS = ["R-0101", "R-0102", "R-0105"];

let pessoa: UsuarioSessao;
const conferencia = criarAppDaConferencia(() => pessoa);

beforeAll(async () => {
  pessoa = await criarPessoaDaCoordenacao();
});

beforeEach(async () => {
  await semearConferencia();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const CSV = csvDoCenario();

/** O corpo que o navegador mandaria para o CSV (com o mapeamento detectado ou o dado). */
async function corpo(
  csv = CSV,
  mapeamento?: MapeamentoReconciliacao,
): Promise<CorpoConferencia> {
  return (await corpoDe(csv, mapeamento)).corpo;
}

async function porPedido(
  corpoEnviado: object,
): Promise<RespostaAnalisePorPedido> {
  const resposta = await postar(conferencia, ANALISAR, corpoEnviado);
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status: 200,
  });
  const analise = respostaAnaliseReconciliacaoSchema.parse(resposta.corpo);
  if (analise.modo !== "por_pedido")
    throw new Error("esperava o modo por pedido");
  return analise;
}

async function agregado(
  corpoEnviado: object,
): Promise<RespostaAnaliseAgregada> {
  const resposta = await postar(conferencia, ANALISAR, corpoEnviado);
  expect(resposta.status).toBe(200);
  const analise = respostaAnaliseReconciliacaoSchema.parse(resposta.corpo);
  if (analise.modo !== "agregado") throw new Error("esperava o modo agregado");
  return analise;
}

async function recuperar(corpoEnviado: object) {
  const resposta = await postar(conferencia, RECUPERAR, corpoEnviado);
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status: 200,
  });
  return respostaRecuperarReconciliacaoSchema.parse(resposta.corpo);
}

function esperarErro(
  resposta: RespostaDeTeste,
  status: number,
  codigo: CodigoErro,
) {
  expect({
    status: resposta.status,
    codigo: erroApiSchema.parse(resposta.corpo).erro.codigo,
  }).toEqual({
    status,
    codigo,
  });
  return erroApiSchema.parse(resposta.corpo).erro;
}

/** Os códigos de cada tipo de divergência, na ordem da resposta. */
function codigosPorTipo(analise: RespostaAnalisePorPedido) {
  return Object.fromEntries(
    analise.divergencias.map((grupo) => [
      grupo.tipo,
      grupo.itens.map((item) => item.pedido_id),
    ]),
  );
}

async function contar(tabela: string, onde = "1 = 1"): Promise<number> {
  const linha = await env.DB.prepare(
    `SELECT count(*) AS total FROM ${tabela} WHERE ${onde}`,
  ).first<{
    total: number;
  }>();
  return linha?.total ?? -1;
}

const COLUNAS_VAZIAS: ColunasDoCorpo = {
  pedido_id: null,
  status: null,
  qtd_bilhetes: null,
  bilhetes: null,
  valor: null,
  afiliado: null,
  data: null,
};

describe("CA1: análise pedido a pedido (o arquivo tem o código do pedido)", () => {
  it("separa os sete tipos de divergência, com contagens e totais (colunas detectadas pelo nome no navegador)", async () => {
    const { corpo: enviado, avisos: daLeitura, arquivo } = await corpoDe(CSV);
    expect(arquivo.mapeamentoDetectado).toEqual(MAPEAMENTO_DO_CENARIO);
    const analise = await porPedido(enviado);

    expect(analise.divergencias.map((grupo) => grupo.tipo)).toEqual([
      ...TIPOS_DIVERGENCIA,
    ]);
    expect(codigosPorTipo(analise)).toEqual({
      venda_perdida: ["R-0101", "R-0102", "R-0103", "R-0105", "R-0106"],
      pagamento_nao_registrado: ["R-0005"],
      nao_pago_na_rifei: ["R-0006"],
      ausente_no_arquivo: ["R-0007", "R-0008"],
      valor_diferente: ["R-0002"],
      quantidade_diferente: ["R-0003"],
      afiliado_diferente: ["R-0004"],
    });

    const perdidas = analise.divergencias[0];
    expect(perdidas).toMatchObject({
      quantidade: 5,
      arquivo: { bilhetes: 9, total_centavos: 16000 },
      sistema: { bilhetes: 0, total_centavos: 0 },
      itens_omitidos: 0,
    });
    expect(
      perdidas.itens.map((item) => [
        item.pedido_id,
        item.recuperavel,
        item.observacoes,
      ]),
    ).toEqual([
      ["R-0101", true, []],
      ["R-0102", true, []],
      ["R-0103", false, ["sem_valor"]],
      ["R-0105", true, []],
      ["R-0106", false, ["data_no_futuro"]],
    ]);
    // O afiliado pelo rótulo cadastrado ("@Lider.Betel" = "lider.betel") e o não reconhecido.
    expect(perdidas.itens[1].arquivo).toMatchObject({
      afiliado: "reconhecido",
      affiliate_id: 102,
      celula: { id: 2, nome: "Célula Betel" },
      data: "2026-11-28",
    });
    expect(perdidas.itens[3].arquivo).toMatchObject({
      afiliado: "nao_reconhecido",
      affiliate_id: null,
    });

    const grupo = (tipo: string) =>
      analise.divergencias.find((item) => item.tipo === tipo)!;
    expect(grupo("ausente_no_arquivo")).toMatchObject({
      quantidade: 2,
      sistema: { bilhetes: 3, total_centavos: 6000 },
      itens_omitidos: 0,
    });
    expect(
      grupo("ausente_no_arquivo").itens.map((item) => [
        item.pedido_id,
        item.observacoes,
        item.sistema?.aprovado_em,
      ]),
    ).toEqual([
      ["R-0007", ["fora_do_periodo_do_arquivo"], "2026-11-20T15:00:00.000Z"],
      ["R-0008", [], "2026-11-26T15:00:00.000Z"],
    ]);
    expect(grupo("valor_diferente").itens[0]).toMatchObject({
      arquivo: { total_centavos: 5000 },
      sistema: {
        total_centavos: 4000,
        origem: "webhook",
        aprovado_em: "2026-11-25T15:00:00.000Z",
      },
    });
    expect(grupo("afiliado_diferente").itens[0]).toMatchObject({
      arquivo: { affiliate_id: 105, celula: { nome: "Célula Éfeso" } },
      sistema: { affiliate_id: 104, celula: { nome: "Célula Dorcas" } },
    });
    expect(grupo("pagamento_nao_registrado").itens[0].sistema).toMatchObject({
      status: "in_process",
      aprovado_em: null,
    });
    expect(grupo("nao_pago_na_rifei").itens[0].arquivo).toMatchObject({
      status: "cancelado",
    });

    expect(analise.codigo).toEqual({
      confere: true,
      pagos_no_arquivo: 11,
      encontrados: 6,
    });
    expect(analise.resumo).toEqual({
      pedidos_no_arquivo: 15,
      aprovados_no_arquivo: {
        pedidos_aprovados: 10,
        bilhetes: 22,
        total_centavos: 41000,
      },
      aprovados_no_sistema: {
        pedidos_aprovados: 7,
        bilhetes: 15,
        total_centavos: 30000,
      },
      conferem: 1,
      com_divergencia: 12,
    });
    expect(analise.arquivo).toEqual({
      linhas: 17,
      linhas_ignoradas: 2,
      um_bilhete_por_linha: false,
      data_inicio: "2026-11-24",
      data_fim: "2026-12-05",
    });
    // A tela junta os avisos da leitura (navegador) com os da comparação (API).
    expect(
      analise.avisos.map((aviso) => [aviso.codigo, aviso.quantidade]),
    ).toEqual([
      ["status_desconhecido", 1],
      ["afiliado_nao_reconhecido", 1],
      ["pedido_de_outra_campanha", 1],
    ]);
    expect(
      juntarAvisos(daLeitura, analise.avisos).map((aviso) => [
        aviso.codigo,
        aviso.quantidade,
      ]),
    ).toEqual([
      ["colunas_pessoais_ignoradas", null],
      ["sem_id", 1],
      ["id_invalido", 1],
      ["status_desconhecido", 1],
      ["afiliado_nao_reconhecido", 1],
      ["formula_ignorada", 1],
      ["pedido_de_outra_campanha", 1],
    ]);
    expect(analise.conferido_em).toBe(AGORA_CONFERENCIA.toISOString());
  });

  it("a coordenação ajusta o mapeamento: sem afiliado e sem data, esses campos não são comparados", async () => {
    const analise = await porPedido(
      await corpo(CSV, {
        ...MAPEAMENTO_DO_CENARIO,
        afiliado: null,
        data: null,
      }),
    );

    const tipos = codigosPorTipo(analise);
    expect(tipos.afiliado_diferente).toEqual([]);
    expect(tipos.venda_perdida).toEqual([
      "R-0101",
      "R-0102",
      "R-0103",
      "R-0105",
      "R-0106",
    ]);
    // Sem a data, a R-0106 deixa de estar "no futuro" (entraria agora) e nada fica fora do período.
    const perdidas = analise.divergencias[0].itens;
    expect(perdidas.map((item) => item.recuperavel)).toEqual([
      true,
      true,
      false,
      true,
      true,
    ]);
    expect(
      analise.divergencias[3].itens.every(
        (item) => item.observacoes.length === 0,
      ),
    ).toBe(true);
    expect(analise.avisos.map((aviso) => aviso.codigo)).toEqual(
      expect.arrayContaining(["sem_coluna_afiliado", "sem_coluna_data"]),
    );
    expect(analise.arquivo.data_inicio).toBeNull();
  });

  it("corpo fora do formato: 400 requisicao_invalida apontando campo e posição, sem ecoar valores", async () => {
    const base = await corpo();
    const casos: [object, (string | number)[]][] = [
      [{ ...base, valor: base.valor?.slice(1) }, ["valor"]],
      [
        {
          ...base,
          pedido_id: [
            "maria.ficticia@example.com",
            ...base.pedido_id!.slice(1),
          ],
        },
        ["pedido_id", 0],
      ],
      [{ ...base, csv: CSV }, ["csv"]],
      [{ ...base, linhas: base.linhas + 1 }, ["vezes"]],
      [
        { ...base, colunas: { ...base.colunas, nome: "Nome" } },
        ["colunas", "nome"],
      ],
    ];
    for (const [enviado, caminho] of casos) {
      const resposta = await postar(conferencia, ANALISAR, enviado);
      const erro = esperarErro(resposta, 400, "requisicao_invalida");
      expect(erro.detalhes).toContainEqual(
        expect.objectContaining({ caminho }),
      );
      expect(textosPessoaisEm(resposta.texto)).toEqual([]);
    }
  });

  it("D1: coluna com nome de dado pessoal mapeada (sem passar pela tela): 400 coluna_pessoal", async () => {
    const base = await corpo();
    for (const [campo, nome] of [
      ["afiliado", "Telefone do afiliado"],
      ["pedido_id", "CPF"],
      ["valor", "E-mail"],
    ] as const) {
      const erro = esperarErro(
        await postar(conferencia, ANALISAR, {
          ...base,
          colunas: { ...base.colunas, [campo]: nome },
        }),
        400,
        "requisicao_invalida",
      );
      expect(erro.detalhes).toEqual([
        {
          caminho: ["colunas", campo],
          codigo: "coluna_pessoal",
          mensagem: `A coluna "${nome}" tem dados pessoais e não pode ser usada`,
        },
      ]);
    }
  });

  it("sem campanha ativa: 404 nao_encontrado", async () => {
    await env.DB.prepare("UPDATE campanhas SET ativa = 0").run();
    const enviado = await corpo();
    esperarErro(
      await postar(conferencia, ANALISAR, enviado),
      404,
      "nao_encontrado",
    );
    esperarErro(
      await postar(conferencia, RECUPERAR, {
        ...enviado,
        pedidos: ["R-0101"],
      }),
      404,
      "nao_encontrado",
    );
  });
});

describe("CA1: modo agregado (o arquivo não tem o código do pedido)", () => {
  const semCodigo = montarCsv(
    [
      [
        "Afiliado",
        "Status",
        "Quantidade de bilhetes",
        "Valor pago",
        "Pago em",
        "Nome",
        "WhatsApp",
      ],
      ...LINHAS_DO_CENARIO.filter((linha) => /^R-0\d/.test(linha.pedido)).map(
        (linha, indice) => [
          linha.afiliado,
          linha.status,
          linha.quantidade,
          linha.valor,
          linha.data,
          `Maria Ficticia Souza ${indice}`,
          "+5591988880001",
        ],
      ),
    ],
    { separador: ";", bom: true },
  );

  it("compara os totais pagos por afiliado e por dia, só nos dias do arquivo", async () => {
    const { corpo: enviado, avisos: daLeitura } = await corpoDe(semCodigo);
    expect(enviado.colunas).toMatchObject({
      pedido_id: null,
      afiliado: "Afiliado",
      data: "Pago em",
    });
    const analise = await agregado(enviado);

    expect(analise.recorte).toEqual({
      data_inicio: "2026-11-24",
      data_fim: "2026-12-05",
    });
    expect(analise.total).toEqual({
      arquivo: { pedidos_aprovados: 10, bilhetes: 22, total_centavos: 41000 },
      // A compra de teste de 20/11 (antes do arquivo) fica fora do recorte.
      sistema: { pedidos_aprovados: 6, bilhetes: 14, total_centavos: 28000 },
      confere: false,
    });
    const linha = (id: number | null) =>
      analise.por_afiliado!.find(
        (item) => item.affiliate_id === id && item.afiliado === "afiliado",
      );
    expect(linha(101)).toEqual({
      afiliado: "afiliado",
      affiliate_id: 101,
      celula: { id: 1, nome: "Célula Ágape" },
      arquivo: { pedidos_aprovados: 3, bilhetes: 8, total_centavos: 16000 },
      sistema: { pedidos_aprovados: 2, bilhetes: 5, total_centavos: 10000 },
      confere: false,
    });
    expect(
      analise.por_afiliado!.find((item) => item.afiliado === "nao_reconhecido"),
    ).toMatchObject({
      arquivo: { pedidos_aprovados: 1 },
      sistema: { pedidos_aprovados: 0 },
    });
    // Os diferentes vêm primeiro.
    const situacoes = analise.por_afiliado!.map((item) => item.confere);
    expect(situacoes).toEqual(
      [...situacoes].sort((a, b) => Number(a) - Number(b)),
    );
    expect(
      analise.por_dia!.find((dia) => dia.data === "2026-11-24"),
    ).toMatchObject({ confere: true });
    expect(
      analise.por_dia!.find((dia) => dia.data === "2026-11-28"),
    ).toMatchObject({
      arquivo: { pedidos_aprovados: 2 },
      sistema: { pedidos_aprovados: 0 },
      confere: false,
    });
    expect(analise.avisos.map((aviso) => aviso.codigo)).toEqual([
      "sem_coluna_pedido",
      "status_desconhecido",
      "afiliado_nao_reconhecido",
    ]);
    expect(daLeitura.map((aviso) => aviso.codigo)).toEqual([
      "colunas_pessoais_ignoradas",
    ]);
    expect(textosPessoaisEm(JSON.stringify(analise))).toEqual([]);
  });

  it("sem o código e sem a quantidade: a quantidade de pedidos não é comparada (aviso)", async () => {
    const analise = await agregado(
      await corpo(
        montarCsv([
          ["Status", "Valor", "Afiliado"],
          ["Pago", "R$ 20,00", "101"],
          ["Pago", "R$ 20,00", "101"],
          ["Pago", "R$ 20,00", "101"],
        ]),
      ),
    );
    expect(analise.total.arquivo).toEqual({
      pedidos_aprovados: null,
      bilhetes: null,
      total_centavos: 6000,
    });
    expect(analise.avisos.map((aviso) => aviso.codigo)).toContain(
      "sem_contagem_de_pedidos",
    );
  });

  it("no modo agregado não dá para recuperar: o Recuperar exige a coluna do código (400)", async () => {
    const erro = esperarErro(
      await postar(conferencia, RECUPERAR, {
        ...(await corpo(semCodigo)),
        pedidos: ["R-0101"],
      }),
      400,
      "requisicao_invalida",
    );
    expect(erro.detalhes).toEqual([
      expect.objectContaining({ caminho: ["colunas", "pedido_id"] }),
    ]);
  });
});

describe("CA2: Recuperar (pré-visualização, gravação atômica e idempotente, auditoria)", () => {
  const pedidoGravado = (id: string) =>
    env.DB.prepare(
      `SELECT id, status, affiliate_id, qtd_bilhetes, numeros, total_centavos, aprovado_em, origem,
         recuperacao_id, ddd, pais, criado_em
       FROM pedidos WHERE id = ?1`,
    )
      .bind(id)
      .first();

  it("simular mostra o que seria gravado e não grava nada", async () => {
    const antes = await contar("pedidos");
    const previa = await recuperar({
      ...(await corpo()),
      pedidos: [
        ...RECUPERAVEIS,
        "R-0103",
        "R-0106",
        "R-0001",
        "R-0104",
        "R-SUMIU",
      ],
      simular: true,
    });

    expect(previa).toMatchObject({
      simulado: true,
      aplicado: false,
      recuperacao_id: null,
    });
    expect(previa.recuperados).toEqual([
      {
        pedido_id: "R-0101",
        qtd_bilhetes: 3,
        total_centavos: 6000,
        afiliado: "reconhecido",
        affiliate_id: 101,
        celula: { id: 1, nome: "Célula Ágape" },
        aprovado_em: "2026-11-27T13:00:00.000Z",
        origem_data: "arquivo",
      },
      {
        pedido_id: "R-0102",
        qtd_bilhetes: 2,
        total_centavos: 4000,
        afiliado: "reconhecido",
        affiliate_id: 102,
        celula: { id: 2, nome: "Célula Betel" },
        aprovado_em: "2026-11-28T15:00:00.000Z",
        origem_data: "dia_do_arquivo",
      },
      {
        pedido_id: "R-0105",
        qtd_bilhetes: 1,
        total_centavos: 2000,
        afiliado: "nao_reconhecido",
        affiliate_id: null,
        celula: null,
        aprovado_em: "2026-11-29T18:45:00.000Z",
        origem_data: "arquivo",
      },
    ]);
    expect(previa.nao_recuperados).toEqual([
      { pedido_id: "R-0103", motivo: "sem_valor" },
      { pedido_id: "R-0106", motivo: "data_no_futuro" },
      { pedido_id: "R-0001", motivo: "ja_existe" },
      { pedido_id: "R-0104", motivo: "nao_aprovado_no_arquivo" },
      { pedido_id: "R-SUMIU", motivo: "nao_esta_no_arquivo" },
    ]);
    expect(previa.totais).toEqual({
      pedidos_aprovados: 3,
      bilhetes: 6,
      total_centavos: 12000,
    });
    expect(previa.avisos.map((aviso) => aviso.codigo)).toEqual([
      "afiliado_nao_reconhecido",
    ]);
    expect(await contar("pedidos")).toBe(antes);
    expect(await contar("recuperacoes")).toBe(0);
  });

  it("grava de uma vez, como aprovados com origem 'conferencia', e registra quem, quando e quantos", async () => {
    const resultado = await recuperar({
      ...(await corpo()),
      pedidos: RECUPERAVEIS,
    });

    expect(resultado).toMatchObject({
      simulado: false,
      aplicado: true,
      recuperacao_id: expect.any(Number),
      nao_recuperados: [],
      totais: { pedidos_aprovados: 3, bilhetes: 6, total_centavos: 12000 },
    });
    expect(await pedidoGravado("R-0101")).toEqual({
      id: "R-0101",
      status: "approved",
      affiliate_id: 101,
      qtd_bilhetes: 3,
      // Os números dos bilhetes não saem do navegador (só a contagem).
      numeros: null,
      total_centavos: 6000,
      aprovado_em: "2026-11-27T13:00:00.000Z",
      origem: "conferencia",
      recuperacao_id: resultado.recuperacao_id,
      // D1: nada do comprador (o DDD do telefone nem é derivado: a conferência não lê o telefone).
      ddd: null,
      pais: null,
      criado_em: null,
    });
    expect(await pedidoGravado("R-0105")).toMatchObject({
      affiliate_id: null,
      origem: "conferencia",
    });

    const recuperacao = await env.DB.prepare(
      "SELECT * FROM recuperacoes",
    ).first();
    expect(recuperacao).toEqual({
      id: resultado.recuperacao_id,
      campanha_id: expect.any(Number),
      usuario_id: pessoa.id,
      executado_em: AGORA_CONFERENCIA.toISOString(),
      pedidos_solicitados: 3,
      pedidos_recuperados: 3,
      bilhetes: 6,
      total_centavos: 12000,
      linhas_arquivo: 17,
      // O SHA-256 que o navegador calculou do texto do arquivo.
      arquivo_sha256: await sha256Hex(CSV),
      mapeamento: JSON.stringify({
        pedido_id: "Pedido",
        status: "Status",
        qtd_bilhetes: "Quantidade de bilhetes",
        bilhetes: "Bilhetes",
        valor: "Valor",
        afiliado: "Afiliado",
        data: "Data do pagamento",
      }),
    });

    const lista = await obter(conferencia, RECUPERACOES);
    expect(lista.status).toBe(200);
    expect(respostaListaRecuperacoesSchema.parse(lista.corpo).itens).toEqual([
      expect.objectContaining({
        id: resultado.recuperacao_id,
        usuario: { id: pessoa.id, nome: pessoa.nome },
        pedidos_recuperados: 3,
        pedidos: RECUPERAVEIS,
        colunas: expect.objectContaining({
          pedido_id: "Pedido",
          data: "Data do pagamento",
        }),
      }),
    ]);
  });

  it("aplicar duas vezes não duplica nada: a segunda vez não grava e não cria outra auditoria", async () => {
    const enviado = { ...(await corpo()), pedidos: RECUPERAVEIS };
    await recuperar(enviado);
    const pedidos = await contar("pedidos");

    const segunda = await recuperar(enviado);

    expect(segunda).toMatchObject({
      aplicado: false,
      recuperacao_id: null,
      recuperados: [],
    });
    expect(segunda.nao_recuperados).toEqual(
      RECUPERAVEIS.map((pedido_id) => ({ pedido_id, motivo: "ja_existe" })),
    );
    expect(await contar("pedidos")).toBe(pedidos);
    expect(await contar("recuperacoes")).toBe(1);
    // A análise de novo: as três deixam de ser venda perdida.
    const analise = await porPedido(await corpo());
    expect(codigosPorTipo(analise).venda_perdida).toEqual(["R-0103", "R-0106"]);
  });

  it("nunca sobrescreve um pedido que já existe (nem o pendente que está pago na Rifei)", async () => {
    const antes = await Promise.all(["R-0001", "R-0005"].map(pedidoGravado));
    const resultado = await recuperar({
      ...(await corpo()),
      pedidos: ["R-0001", "R-0005"],
    });

    expect(resultado.recuperados).toEqual([]);
    expect(resultado.nao_recuperados.map((item) => item.motivo)).toEqual([
      "ja_existe",
      "ja_existe",
    ]);
    expect(await Promise.all(["R-0001", "R-0005"].map(pedidoGravado))).toEqual(
      antes,
    );
  });

  it("o pedido recuperado passa a contar no painel e no ranking", async () => {
    const resumo = async () =>
      respostaPainelResumoSchema.parse(
        (await obter(conferencia, "/api/painel/resumo")).corpo,
      );
    const vendasDaCelula = async (id: number) =>
      respostaRankingSchema
        .parse(
          (await obter(conferencia, "/api/painel/ranking?periodo=campanha"))
            .corpo,
        )
        .itens.find((item) => item.id === id)!.vendas;

    const antes = await resumo();
    expect(antes.vendas).toEqual({
      pedidos_aprovados: 6,
      bilhetes: 14,
      total_centavos: 28000,
    });
    expect(antes.vendas_sem_celula).toEqual({
      pedidos_aprovados: 0,
      bilhetes: 0,
      total_centavos: 0,
    });
    expect(await vendasDaCelula(1)).toEqual({
      pedidos_aprovados: 2,
      bilhetes: 5,
      total_centavos: 10000,
    });
    expect(await vendasDaCelula(2)).toEqual({
      pedidos_aprovados: 1,
      bilhetes: 2,
      total_centavos: 4000,
    });

    await recuperar({ ...(await corpo()), pedidos: RECUPERAVEIS });

    const depois = await resumo();
    expect(depois.vendas).toEqual({
      pedidos_aprovados: 9,
      bilhetes: 20,
      total_centavos: 40000,
    });
    // A R-0105 (afiliado não reconhecido) entra sem afiliado: conta na campanha, fora das células.
    expect(depois.vendas_sem_celula).toEqual({
      pedidos_aprovados: 1,
      bilhetes: 1,
      total_centavos: 2000,
    });
    expect(await vendasDaCelula(1)).toEqual({
      pedidos_aprovados: 3,
      bilhetes: 8,
      total_centavos: 16000,
    });
    expect(await vendasDaCelula(2)).toEqual({
      pedidos_aprovados: 2,
      bilhetes: 4,
      total_centavos: 8000,
    });
  });

  it("afiliado novo do arquivo entra na fila de órfãos (sem célula), como os do webhook", async () => {
    const linhas: LinhaRifei[] = [
      {
        pedido: "R-0200",
        status: "Pago",
        quantidade: "2",
        bilhetes: "",
        valor: "R$ 40,00",
        afiliado: "7777",
        data: "29/11/2026 10:00",
      },
    ];
    const resultado = await recuperar({
      ...(await corpo(csvDoCenario(linhas))),
      pedidos: ["R-0200"],
    });
    expect(resultado.recuperados[0]).toMatchObject({
      affiliate_id: 7777,
      celula: null,
    });
    expect(
      await env.DB.prepare(
        "SELECT affiliate_id, celula_id, origem FROM afiliados WHERE affiliate_id = 7777",
      ).first(),
    ).toEqual({ affiliate_id: 7777, celula_id: null, origem: "webhook" });
  });

  it("corrida: pedido que entrou depois da prévia não é sobrescrito e não conta na auditoria", async () => {
    await env.DB.prepare(
      `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em)
       SELECT 'R-CORRIDA', id, 101, 'approved', 9, 9999, '2026-11-30T15:00:00.000Z' FROM campanhas WHERE ativa = 1`,
    ).run();
    const campanha = await env.DB.prepare(
      "SELECT id FROM campanhas WHERE ativa = 1",
    ).first<{ id: number }>();
    const pedido = (id: string): PedidoRecuperado => ({
      pedido_id: id,
      qtd_bilhetes: 1,
      total_centavos: 2000,
      afiliado: "reconhecido",
      affiliate_id: 101,
      celula: null,
      aprovado_em: "2026-11-30T12:00:00.000Z",
      origem_data: "arquivo",
    });

    const resultado = await gravarRecuperacao(env.DB, {
      campanhaId: campanha!.id,
      usuarioId: pessoa.id,
      executadoEm: AGORA_CONFERENCIA.toISOString(),
      pedidosSolicitados: 2,
      linhasArquivo: 2,
      arquivoSha256: "0".repeat(64),
      colunas: { ...COLUNAS_VAZIAS, pedido_id: "Pedido" },
      pedidos: [pedido("R-CORRIDA"), pedido("R-NOVO")],
    });

    expect([...resultado.gravados]).toEqual(["R-NOVO"]);
    expect(
      await env.DB.prepare(
        "SELECT qtd_bilhetes, total_centavos, origem, recuperacao_id FROM pedidos WHERE id = 'R-CORRIDA'",
      ).first(),
    ).toEqual({
      qtd_bilhetes: 9,
      total_centavos: 9999,
      origem: "webhook",
      recuperacao_id: null,
    });
    expect(
      await env.DB.prepare(
        "SELECT pedidos_recuperados, bilhetes, total_centavos FROM recuperacoes",
      ).first(),
    ).toEqual({ pedidos_recuperados: 1, bilhetes: 1, total_centavos: 2000 });

    // Só pedidos que já existem: o lote não deixa auditoria nenhuma.
    const nada = await gravarRecuperacao(env.DB, {
      campanhaId: campanha!.id,
      usuarioId: pessoa.id,
      executadoEm: AGORA_CONFERENCIA.toISOString(),
      pedidosSolicitados: 1,
      linhasArquivo: 1,
      arquivoSha256: "0".repeat(64),
      colunas: COLUNAS_VAZIAS,
      pedidos: [pedido("R-CORRIDA")],
    });
    expect(nada).toEqual({ recuperacaoId: null, gravados: new Set() });
    expect(await contar("recuperacoes")).toBe(1);
  });

  it("atômico: se um comando do lote falha, nada fica gravado (nem a auditoria, nem o afiliado novo)", async () => {
    const campanha = await env.DB.prepare(
      "SELECT id FROM campanhas WHERE ativa = 1",
    ).first<{ id: number }>();
    const base = {
      qtd_bilhetes: 1,
      total_centavos: 2000,
      afiliado: "reconhecido" as const,
      celula: null,
      origem_data: "arquivo" as const,
    };
    await expect(
      gravarRecuperacao(env.DB, {
        campanhaId: campanha!.id,
        usuarioId: pessoa.id,
        executadoEm: AGORA_CONFERENCIA.toISOString(),
        pedidosSolicitados: 2,
        linhasArquivo: 2,
        arquivoSha256: "0".repeat(64),
        colunas: COLUNAS_VAZIAS,
        pedidos: [
          {
            ...base,
            pedido_id: "R-OK",
            affiliate_id: 8888,
            aprovado_em: "2026-11-30T12:00:00.000Z",
          },
          // aprovado_em fora do formato: o CHECK da tabela recusa e o lote inteiro volta.
          {
            ...base,
            pedido_id: "R-RUIM",
            affiliate_id: 8888,
            aprovado_em: "30/11/2026",
          },
        ],
      }),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(await contar("recuperacoes")).toBe(0);
    expect(await contar("pedidos", "id IN ('R-OK', 'R-RUIM')")).toBe(0);
    expect(await contar("afiliados", "affiliate_id = 8888")).toBe(0);
  });

  it("um paid_order do webhook depois da recuperação é duplicado e não muda o pedido recuperado", async () => {
    await recuperar({ ...(await corpo()), pedidos: ["R-0101"] });
    const antes = await pedidoGravado("R-0101");
    const webhook = new Hono<{ Bindings: Cloudflare.Env }>();
    webhook.route("/", webhookRifei);

    const res = await webhook.request(
      "/api/webhooks/rifei",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RIFEI_WEBHOOK_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...paidOrderAfiliado,
          id: "R-0101",
          slug: DADOS_CAMPANHA.slug_rifei,
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resultado: "duplicado" });
    expect(await pedidoGravado("R-0101")).toEqual(antes);
  });

  it("corpo fora do formato: lista vazia, mais de 500 pedidos ou código inválido (400)", async () => {
    const enviado = await corpo();
    for (const pedidos of [
      [],
      Array.from({ length: LIMITE_PEDIDOS_RECUPERAR + 1 }, (_, i) => `R-${i}`),
      ["=HYPERLINK(1)"],
      ["maria.ficticia@example.com"],
    ]) {
      const erro = esperarErro(
        await postar(conferencia, RECUPERAR, { ...enviado, pedidos }),
        400,
        "requisicao_invalida",
      );
      expect(JSON.stringify(erro)).not.toContain("example.com");
    }
    expect(await contar("recuperacoes")).toBe(0);
  });
});

describe("CA2: regra do valor dos pedidos em várias linhas (um bilhete por linha)", () => {
  const linha = (
    pedido: string,
    valor: string,
    extra: Partial<LinhaRifei> = {},
  ): LinhaRifei => ({
    pedido,
    status: "Pago",
    quantidade: "1",
    bilhetes: "",
    valor,
    afiliado: "101",
    data: "29/11/2026 10:00",
    ...extra,
  });

  it("3 linhas de R$ 20,00 viram um pedido de R$ 60,00 (o Recuperar grava 6000); R$ 18 × 2 vira R$ 36,00", async () => {
    const csv = csvDoCenario([
      linha("R-0300", "R$ 20,00"),
      linha("R-0300", "R$ 20,00"),
      linha("R-0300", "R$ 20,00"),
      linha("R-0301", "R$ 18,00"),
      linha("R-0301", "R$ 18,00"),
    ]);
    const enviado = await corpo(csv);
    // As linhas iguais (só os dados pessoais mudam) vão numa posição só.
    expect(enviado.vezes).toEqual([3, 2]);
    const analise = await porPedido(enviado);
    expect(
      analise.divergencias[0].itens.map((item) => [
        item.pedido_id,
        item.arquivo?.qtd_bilhetes,
        item.arquivo?.total_centavos,
        item.recuperavel,
      ]),
    ).toEqual([
      ["R-0300", 3, 6000, true],
      ["R-0301", 2, 3600, true],
    ]);
    expect(analise.avisos.map((aviso) => aviso.codigo)).toEqual(
      expect.arrayContaining(["um_bilhete_por_linha", "valor_por_bilhete"]),
    );

    const gravado = await recuperar({
      ...enviado,
      pedidos: ["R-0300", "R-0301"],
    });
    expect(
      gravado.recuperados.map((pedido) => [
        pedido.pedido_id,
        pedido.qtd_bilhetes,
        pedido.total_centavos,
      ]),
    ).toEqual([
      ["R-0300", 3, 6000],
      ["R-0301", 2, 3600],
    ]);
    expect(
      await env.DB.prepare(
        "SELECT total_centavos FROM pedidos WHERE id = 'R-0300'",
      ).first(),
    ).toEqual({ total_centavos: 6000 });
  });

  it("o mesmo valor em todas as linhas e longe do preço: ambíguo, explicado e fora do Recuperar", async () => {
    const enviado = await corpo(
      csvDoCenario([
        linha("R-0302", "R$ 60,00", { quantidade: "3" }),
        linha("R-0302", "R$ 60,00", { quantidade: "3" }),
        linha("R-0302", "R$ 60,00", { quantidade: "3" }),
      ]),
    );
    const analise = await porPedido(enviado);
    expect(analise.divergencias[0].itens[0]).toMatchObject({
      pedido_id: "R-0302",
      arquivo: { qtd_bilhetes: 3, total_centavos: null },
      recuperavel: false,
      observacoes: ["valor_ambiguo"],
    });
    expect(analise.avisos).toContainEqual(
      expect.objectContaining({ codigo: "valor_ambiguo", quantidade: 1 }),
    );
    const previa = await recuperar({
      ...enviado,
      pedidos: ["R-0302"],
      simular: true,
    });
    expect(previa.nao_recuperados).toEqual([
      { pedido_id: "R-0302", motivo: "valor_ambiguo" },
    ]);
  });
});

describe("CA2: trava do código que não bate (a coluna escolhida não é o código da Rifei)", () => {
  // O "código" é o número do bilhete: nenhum dos 7 pagos existe no sistema.
  const csv = montarCsv([
    ["Número", "Status", "Quantidade", "Valor", "Data do pagamento"],
    ...["7001", "7002", "7003", "7004", "7005", "7006", "7007"].map(
      (numero) => [numero, "Pago", "1", "R$ 20,00", "26/11/2026 10:00"],
    ),
  ]);
  const mapeamento: MapeamentoReconciliacao = {
    pedido_id: 0,
    status: 1,
    qtd_bilhetes: 2,
    bilhetes: null,
    valor: 3,
    afiliado: null,
    data: 4,
  };

  it("7 de 7 que não batem: aviso claro, nada marcado para recuperar e o Recuperar recusa (400) sem gravar", async () => {
    const enviado = await corpo(csv, mapeamento);
    const analise = await porPedido(enviado);
    expect(analise.codigo).toEqual({
      confere: false,
      pagos_no_arquivo: 7,
      encontrados: 0,
    });
    expect(analise.avisos[0]).toMatchObject({
      codigo: "codigo_nao_confere",
      mensagem: expect.stringContaining(
        "não parece ser o código da Rifei: só 0 de 7 pedidos pagos do arquivo existem no sistema",
      ),
    });
    const perdidas = analise.divergencias[0];
    expect(perdidas.quantidade).toBe(7);
    expect(perdidas.itens.some((item) => item.recuperavel)).toBe(false);
    expect(perdidas.itens[0].observacoes).toContain("codigo_nao_confere");

    for (const simular of [true, false]) {
      const erro = esperarErro(
        await postar(conferencia, RECUPERAR, {
          ...enviado,
          pedidos: ["7001"],
          simular,
        }),
        400,
        "requisicao_invalida",
      );
      expect(erro.detalhes).toEqual([
        expect.objectContaining({
          caminho: ["colunas", "pedido_id"],
          codigo: "codigo_nao_confere",
        }),
      ]);
    }
    expect(await contar("pedidos", "id LIKE '700%'")).toBe(0);
    expect(await contar("recuperacoes")).toBe(0);
  });

  it("trocando para a coluna certa, a análise volta a conferir", async () => {
    const analise = await porPedido(await corpo());
    expect(analise.codigo.confere).toBe(true);
  });
});

describe("CA3: segurança, limites e privacidade", () => {
  it("corpo acima do teto (1 MiB): 413 sem ler o resto, com e sem Content-Length", async () => {
    const enorme = `{"colunas":${"x".repeat(LIMITE_CORPO_CONFERENCIA_BYTES)}}`;
    const comTamanho = await postar(conferencia, ANALISAR, enorme);
    expect(esperarErro(comTamanho, 413, "corpo_muito_grande").mensagem).toBe(
      "O corpo passa do limite de 1 MiB",
    );
    // Sem o Content-Length (envio em partes), a leitura para logo depois do limite.
    const pedacos = { puxados: 0 };
    const bytes = new TextEncoder().encode("x".repeat(64 * 1024));
    const fluxo = new ReadableStream<Uint8Array>(
      {
        pull(controle) {
          if (pedacos.puxados === 40) {
            controle.close();
            return;
          }
          pedacos.puxados++;
          controle.enqueue(bytes);
        },
      },
      { highWaterMark: 0 },
    );
    const res = await conferencia.request(
      ANALISAR,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: fluxo,
        duplex: "half",
      } as RequestInit,
      env,
    );
    expect(res.status).toBe(413);
    expect(pedacos.puxados).toBeLessThan(40);
  });

  it("no app real: o teto geral deixa a conferência de fora e o dela vale (413 acima de 1 MiB; dentro, a rota responde)", async () => {
    const cabecalhos = await cabecalhosDeSessao("coordenacao");
    const enviar = (texto: string) =>
      app.request(
        ANALISAR,
        {
          method: "POST",
          headers: {
            ...cabecalhos,
            "Content-Type": "application/json",
            "Content-Length": String(new TextEncoder().encode(texto).length),
          },
          body: texto,
        },
        env,
      );
    expect(
      (await enviar("x".repeat(LIMITE_CORPO_CONFERENCIA_BYTES + 1))).status,
    ).toBe(413);
    const certo = await enviar(JSON.stringify(await corpo()));
    expect(certo.status).toBe(200);
  });

  it("corpo que não é JSON ou sem Content-Type JSON: 400 json_invalido com mensagem fixa", async () => {
    const quebrado = await postar(
      conferencia,
      ANALISAR,
      '{"colunas": {"pedido_id": "Pedido", Maria Ficticia Souza',
    );
    expect(esperarErro(quebrado, 400, "json_invalido").mensagem).toBe(
      "O corpo não é um JSON válido",
    );
    expect(textosPessoaisEm(quebrado.texto)).toEqual([]);
    esperarErro(
      await postar(conferencia, ANALISAR, JSON.stringify(await corpo()), {
        "Content-Type": "text/csv",
      }),
      400,
      "json_invalido",
    );
  });

  it("o CSV não é mais aceito: um corpo com `csv` é recusado (o arquivo fica no navegador)", async () => {
    const erro = esperarErro(
      await postar(conferencia, ANALISAR, { csv: CSV }),
      400,
      "requisicao_invalida",
    );
    expect(erro.detalhes).toContainEqual(
      expect.objectContaining({
        caminho: ["csv"],
        codigo: "unrecognized_keys",
      }),
    );
  });

  it("CSV malicioso (fórmulas e células gigantes): o corpo sai sem nada disso, e a análise responde 200", async () => {
    const linhas: LinhaRifei[] = [
      ...LINHAS_DO_CENARIO.slice(0, 2),
      {
        pedido: "R-0300",
        status: "=1+1",
        quantidade: "=2*2",
        bilhetes: "=A1",
        valor: '=HYPERLINK("http://x.example","R$ 9")',
        afiliado: "=cmd|' /C calc'!A0",
        data: "+HOJE()",
      },
      {
        pedido: "R-0301",
        status: "Pago",
        quantidade: "1",
        bilhetes: "1, ".repeat(80_000),
        valor: "R$ 20,00",
        afiliado: "101",
        data: "29/11/2026",
      },
    ];
    const csv = csvDoCenario(linhas).replace(
      "Maria Ficticia Souza",
      `Maria Ficticia Souza ${"x".repeat(1_000_000)}`,
    );
    const { corpo: enviado, avisos } = await corpoDe(csv);
    const json = JSON.stringify(enviado);
    expect(json).not.toMatch(/HYPERLINK|cmd\||=1\+1|xxxxxxxxxx/);
    expect(textosPessoaisEm(json)).toEqual([]);
    expect(avisos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: "formula_ignorada", quantidade: 6 }),
        expect.objectContaining({ codigo: "valor_invalido", quantidade: 1 }),
      ]),
    );
    const resposta = await postar(conferencia, ANALISAR, enviado);
    expect(resposta.status).toBe(200);
    const analise = respostaAnaliseReconciliacaoSchema.parse(resposta.corpo);
    expect(analise.avisos).toContainEqual(
      expect.objectContaining({ codigo: "status_desconhecido", quantidade: 1 }),
    );
    expect(textosPessoaisEm(resposta.texto)).toEqual([]);
  });

  it("nada vai para o log: nem nas chamadas normais, nem nos erros, nem na falha de banco", async () => {
    const espioes = (["log", "info", "warn", "error", "debug"] as const).map(
      (metodo) => vi.spyOn(console, metodo).mockImplementation(() => {}),
    );
    const enviado = await corpo();

    await porPedido(enviado);
    await recuperar({ ...enviado, pedidos: RECUPERAVEIS });
    await postar(conferencia, ANALISAR, '{"colunas": "Joao Ficticio Lima');
    // Falha inesperada com dado pessoal na mensagem: o log leva só o nome do erro.
    const dbQueFalha = new Proxy(env.DB, {
      get(alvo, nome) {
        if (nome === "batch")
          return () =>
            Promise.reject(
              new Error("falha lendo Maria Ficticia Souza +5591988880001"),
            );
        const valor: unknown = Reflect.get(alvo, nome, alvo);
        return typeof valor === "function" ? valor.bind(alvo) : valor;
      },
    });
    const falha = await conferencia.request(
      ANALISAR,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enviado),
      },
      { ...env, DB: dbQueFalha },
    );
    expect(falha.status).toBe(500);
    expect(await falha.json()).toEqual({
      erro: { codigo: "erro_interno", mensagem: "Erro interno" },
    });

    const chamadas = espioes.flatMap((espiao) => espiao.mock.calls);
    expect(chamadas.length).toBeGreaterThanOrEqual(2);
    const registrado =
      JSON.stringify(
        chamadas.map((args) => args.map(String)),
        null,
        0,
      ) + JSON.stringify(chamadas);
    expect(textosPessoaisEm(registrado)).toEqual([]);
    expect(registrado).not.toContain("R-0101");
  });

  it("D1: varredura dos corpos enviados, das respostas e do banco depois de analisar e recuperar: nenhum dado pessoal", async () => {
    const porCodigo = await corpo();
    const semCodigo = await corpo(CSV, {
      ...MAPEAMENTO_DO_CENARIO,
      pedido_id: null,
    });
    const corpos = [
      porCodigo,
      semCodigo,
      { ...porCodigo, pedidos: RECUPERAVEIS, simular: true },
      { ...porCodigo, pedidos: RECUPERAVEIS },
    ];
    // O que sai do navegador: só as colunas mapeadas que não são pessoais.
    for (const enviado of corpos)
      expect(textosPessoaisEm(JSON.stringify(enviado))).toEqual([]);
    const respostas = [
      await postar(conferencia, ANALISAR, corpos[0]),
      await postar(conferencia, ANALISAR, corpos[1]),
      await postar(conferencia, RECUPERAR, corpos[2]),
      await postar(conferencia, RECUPERAR, corpos[3]),
      await obter(conferencia, RECUPERACOES),
    ];
    for (const resposta of respostas) {
      expect(resposta.status).toBe(200);
      expect(textosPessoaisEm(resposta.texto)).toEqual([]);
    }
    for (const tabela of [
      "pedidos",
      "recuperacoes",
      "afiliados",
      "webhook_eventos",
    ]) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${tabela}`).all();
      expect({
        tabela,
        pessoais: textosPessoaisEm(JSON.stringify(results)),
      }).toEqual({ tabela, pessoais: [] });
    }
  });

  it("D1: coluna de contato com nome que confunde a detecção (“Contato do pedido”, “Telefone do afiliado”) não vira código nem afiliado", async () => {
    // Telefone só com dígitos e CPF passam pelo formato do código e do affiliate_id: a detecção não pode
    // escolher essas colunas, nem a primeira de duas com "pedido" no nome (revisão da RIFA-012).
    const telefone = DADOS_PESSOAIS.telefones[0].slice(3);
    const cpf = DADOS_PESSOAIS.cpfs[0];
    const csv = montarCsv([
      [
        "Contato do pedido",
        "Pedido",
        "Status",
        "Quantidade",
        "Valor",
        "Telefone do afiliado",
        "Data do pagamento",
      ],
      [telefone, "R-0101", "Pago", "3", "R$ 60,00", telefone, "27/11/2026"],
      [cpf, "R-0102", "Pago", "2", "R$ 40,00", cpf, "28/11/2026"],
    ]);

    const { corpo: enviado, arquivo } = await corpoDe(csv);
    expect(arquivo.mapeamentoDetectado).toEqual({
      pedido_id: 1,
      status: 2,
      qtd_bilhetes: 3,
      bilhetes: null,
      valor: 4,
      afiliado: null,
      data: 6,
    });
    expect(
      arquivo.colunas
        .filter((coluna) => coluna.dado_pessoal)
        .map((coluna) => coluna.nome),
    ).toEqual(["Contato do pedido", "Telefone do afiliado"]);
    expect(textosPessoaisEm(JSON.stringify(enviado))).toEqual([]);
    const analise = await porPedido(enviado);
    const gravacao = await postar(conferencia, RECUPERAR, {
      ...enviado,
      pedidos: ["R-0101", "R-0102"],
    });
    expect(gravacao.status).toBe(200);
    expect(textosPessoaisEm(JSON.stringify(analise) + gravacao.texto)).toEqual(
      [],
    );
    for (const tabela of ["pedidos", "recuperacoes", "afiliados"]) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${tabela}`).all();
      expect({
        tabela,
        pessoais: textosPessoaisEm(JSON.stringify(results)),
      }).toEqual({ tabela, pessoais: [] });
    }
  });
});

describe("CA5: CSVs em várias formas pela API", () => {
  /** O que importa da análise (sem o instante e sem os avisos da forma do arquivo). */
  const essencia = (analise: RespostaAnalisePorPedido) => ({
    divergencias: analise.divergencias,
    resumo: analise.resumo,
    codigo: analise.codigo,
  });

  it("vírgula, ponto e vírgula, com BOM e com LF: a mesma análise", async () => {
    const base = essencia(await porPedido(await corpo()));
    for (const opcoes of [
      { separador: ";" as const },
      { separador: ";" as const, bom: true },
      { bom: true, fimDeLinha: "\n" as const },
    ])
      expect(
        essencia(await porPedido(await corpo(csvDoCenario(undefined, opcoes)))),
      ).toEqual(base);
  });

  it("um bilhete por linha (com o código, o valor do pedido em cada linha): o mesmo resultado, pela convenção dos que batem", async () => {
    const porBilhete = LINHAS_DO_CENARIO.flatMap((linha) => {
      const numeros = linha.bilhetes === "" ? [] : linha.bilhetes.split(", ");
      return numeros.length <= 1
        ? [linha]
        : numeros.map((numero) => ({ ...linha, bilhetes: numero }));
    });
    expect(porBilhete.length).toBeGreaterThan(LINHAS_DO_CENARIO.length);

    const analise = await porPedido(await corpo(csvDoCenario(porBilhete)));

    expect(essencia(analise)).toEqual(essencia(await porPedido(await corpo())));
    expect(analise.arquivo.um_bilhete_por_linha).toBe(true);
    expect(analise.avisos.map((aviso) => aviso.codigo)).toEqual(
      expect.arrayContaining([
        "um_bilhete_por_linha",
        "valor_do_pedido_repetido",
      ]),
    );
  });

  it("colunas em outra ordem, com nomes variados e colunas extras: a mesma comparação", async () => {
    const csv = montarCsv(
      [
        [
          "Situação do pedido",
          "Cliente",
          "Total pago",
          "Código do pedido",
          "Nº de bilhetes",
          "Cupom",
          "ID do afiliado",
          "Pago em",
          "Números",
        ],
        ...LINHAS_DO_CENARIO.map((linha, indice) => [
          linha.status,
          `Clara Exemplo Dias ${indice}`,
          linha.valor,
          linha.pedido,
          linha.quantidade,
          "PROMO10",
          linha.afiliado,
          linha.data,
          linha.bilhetes,
        ]),
      ],
      { separador: ";" },
    );
    const { corpo: enviado, arquivo } = await corpoDe(csv);
    expect(arquivo.mapeamentoDetectado).toEqual({
      pedido_id: 3,
      status: 0,
      qtd_bilhetes: 4,
      bilhetes: 8,
      valor: 2,
      afiliado: 6,
      data: 7,
    });
    const analise = await porPedido(enviado);
    const base = await porPedido(await corpo());
    expect(analise.divergencias).toEqual(base.divergencias);
    expect(textosPessoaisEm(JSON.stringify(analise))).toEqual([]);
  });
});
