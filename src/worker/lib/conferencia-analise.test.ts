// Análise da conferência (RIFA-012, ciclo 2) sem o banco: como as posições do corpo compacto viram
// pedidos (inclusive "um bilhete por linha"), a regra do valor dos pedidos em várias linhas (por bilhete,
// repetido ou ambíguo, pelo preço e pelos pedidos que batem com o sistema), a trava do código que não bate,
// o modo agregado e o plano do "Recuperar". O corpo sai da mesma leitura do navegador (src/shared); os
// pedidos "gravados" são montados aqui.
import { describe, expect, it } from "vitest";
import {
  LIMITE_ITENS_POR_DIVERGENCIA,
  respostaAnalisePorPedidoSchema,
  type CorpoConferencia,
  type RespostaAnalisePorPedido,
} from "../../shared/contracts";
import {
  lerArquivoConferencia,
  montarCorpo,
} from "../../shared/conferencia/leitura";
import { montarCsv } from "../../shared/conferencia/teste-csv";
import {
  Calendario,
  agruparPedidos,
  analisarAgregado,
  analisarPorPedido,
  conferirCodigo,
  decidir,
  periodoDoArquivo,
  planejarRecuperacao,
  type AfiliadoGravado,
  type AusentesDoArquivo,
  type PedidoGravado,
  type SistemaAgregado,
  type SistemaPorPedido,
} from "./conferencia-analise";

const FUSO = "America/Belem";
const AGORA = new Date("2026-12-01T15:00:00.000Z");
const CAMPANHA = { id: 1, fuso: FUSO, preco: 2000 };

function corpoDe(linhas: string[][]): CorpoConferencia {
  const arquivo = lerArquivoConferencia(montarCsv(linhas, { separador: ";" }));
  if (!arquivo.ok) throw new Error(arquivo.motivo);
  const montagem = montarCorpo(arquivo, arquivo.mapeamentoDetectado, {
    fuso: FUSO,
    arquivoSha256: "0".repeat(64),
  });
  if (!montagem.ok) throw new Error(JSON.stringify(montagem.problemas));
  return montagem.corpo;
}

const AFILIADOS: AfiliadoGravado[] = [
  {
    affiliate_id: 101,
    rotulo: null,
    celula_id: 1,
    celula_nome: "Célula Ágape",
  },
  {
    affiliate_id: 102,
    rotulo: "Lider.Betel",
    celula_id: 2,
    celula_nome: "Célula Betel",
  },
  {
    affiliate_id: 103,
    rotulo: "repetido",
    celula_id: 3,
    celula_nome: "Célula Canaã",
  },
  { affiliate_id: 104, rotulo: "Repetido", celula_id: null, celula_nome: null },
];

function gravado(
  id: string,
  dados: Partial<PedidoGravado> = {},
): PedidoGravado {
  return {
    id,
    campanha_id: 1,
    status: "approved",
    qtd_bilhetes: 1,
    total_centavos: 2000,
    affiliate_id: 101,
    aprovado_ms: Date.parse("2026-11-25T15:00:00.000Z"),
    origem: "webhook",
    desconsiderado: null,
    ...dados,
  };
}

const somarPedidos = (lista: readonly PedidoGravado[]) => ({
  pedidos: lista.length,
  bilhetes: lista.reduce((soma, pedido) => soma + pedido.qtd_bilhetes, 0),
  centavos: lista.reduce((soma, pedido) => soma + pedido.total_centavos, 0),
});

/** O que o banco leria para o corpo (os encontrados são os gravados com códigos do arquivo). */
function sistemaDe(
  corpo: CorpoConferencia,
  gravados: PedidoGravado[],
): SistemaPorPedido & {
  aprovados: RespostaAnalisePorPedido["resumo"]["aprovados_no_sistema"];
  ausentes: AusentesDoArquivo;
} {
  const codigos = new Set(corpo.pedido_id ?? []);
  const periodo = periodoDoArquivo(corpo, FUSO);
  // Como PAGOS_DA_CAMPANHA: os pagos da campanha que contam (sem os desconsiderados, D20).
  const pagos = gravados.filter(
    (pedido) =>
      pedido.campanha_id === 1 &&
      pedido.status === "approved" &&
      pedido.desconsiderado === null,
  );
  const noPeriodo = (pedido: PedidoGravado) =>
    periodo === null ||
    (pedido.aprovado_ms !== null &&
      pedido.aprovado_ms >= periodo.ms.inicio &&
      pedido.aprovado_ms < periodo.ms.fim);
  const ausentes = pagos.filter((pedido) => !codigos.has(pedido.id));
  // Como o SQL: aprovado fora do período do arquivo (sem período ou sem aprovado_em, não).
  const foraDoPeriodo = (pedido: PedidoGravado) =>
    periodo !== null &&
    pedido.aprovado_ms !== null &&
    (pedido.aprovado_ms < periodo.ms.inicio ||
      pedido.aprovado_ms >= periodo.ms.fim);
  const somaPagos = somarPedidos(pagos);
  const somaAusentes = somarPedidos(ausentes);
  return {
    campanha: CAMPANHA,
    afiliados: AFILIADOS,
    encontrados: new Map(
      gravados
        .filter((pedido) => codigos.has(pedido.id))
        .map((pedido) => [pedido.id, pedido]),
    ),
    pagosNoPeriodo: pagos.filter(noPeriodo).length,
    aprovados: {
      pedidos_aprovados: somaPagos.pedidos,
      bilhetes: somaPagos.bilhetes,
      total_centavos: somaPagos.centavos,
    },
    ausentes: {
      quantidade: somaAusentes.pedidos,
      bilhetes: somaAusentes.bilhetes,
      total_centavos: somaAusentes.centavos,
      fora_do_periodo: ausentes.filter(foraDoPeriodo).length,
      itens: ausentes.map((pedido) => ({
        ...pedido,
        fora_do_periodo: foraDoPeriodo(pedido),
      })),
    },
  };
}

function analisar(linhas: string[][], gravados: PedidoGravado[] = []) {
  const corpo = corpoDe(linhas);
  return analisarPorPedido({
    corpo,
    agrupamento: agruparPedidos(corpo),
    sistema: sistemaDe(corpo, gravados),
    periodo: periodoDoArquivo(corpo, FUSO),
    calendario: new Calendario(FUSO, AGORA),
  });
}

function planejar(
  linhas: string[][],
  gravados: PedidoGravado[],
  codigos: string[],
) {
  const corpo = corpoDe(linhas);
  const agrupamento = agruparPedidos(corpo);
  const sistema = sistemaDe(corpo, gravados);
  const periodo = periodoDoArquivo(corpo, FUSO);
  const { convencao, codigo } = decidir(agrupamento, sistema, periodo);
  return {
    codigo,
    convencao,
    ...planejarRecuperacao(
      {
        corpo,
        agrupamento,
        sistema,
        convencao,
        calendario: new Calendario(FUSO, AGORA),
      },
      codigos,
    ),
  };
}

const grupo = (resposta: RespostaAnalisePorPedido, tipo: string) =>
  resposta.divergencias.find((item) => item.tipo === tipo)!;

const CABECALHO = [
  "Pedido",
  "Status",
  "Quantidade de bilhetes",
  "Bilhetes",
  "Valor",
  "Afiliado",
  "Data",
];

describe("posições → pedidos (um bilhete por linha)", () => {
  it('quantidade "1" por linha dá uma por linha; só a primeira linha com os dados conta uma vez; valores diferentes somam', () => {
    const { pedidos, repetidos } = agruparPedidos(
      corpoDe([
        CABECALHO,
        ["B", "Pago", "1", "21", "R$ 20,00", "102", "24/11/2026"],
        ["B", "Pago", "1", "22", "R$ 20,00", "102", "24/11/2026"],
        // Só a primeira linha tem os dados do pedido; a outra, só o bilhete.
        ["C", "Pago", "2", "31", "R$ 40,00", "103", "25/11/2026"],
        ["C", "", "", "32", "", "", ""],
        // Valores diferentes em cada linha: são de cada linha (somam).
        ["D", "Pago", "1", "41", "R$ 20,00", "101", "26/11/2026"],
        ["D", "Pago", "2", "42, 43", "R$ 35,00", "101", "26/11/2026"],
      ]),
    );
    expect(repetidos).toBe(true);
    expect(
      [...pedidos.values()].map((pedido) => [
        pedido.id,
        pedido.linhas,
        pedido.qtd,
        pedido.valor,
        pedido.inconsistente,
      ]),
    ).toEqual([
      ["B", 2, 2, { tipo: "repetido", centavos: 2000 }, false],
      ["C", 2, 2, { tipo: "unico", centavos: 4000, somado: false }, false],
      ["D", 2, 3, { tipo: "unico", centavos: 5500, somado: true }, false],
    ]);
  });

  it("linhas do mesmo pedido com status, afiliado ou dia diferentes: inconsistente (fora da comparação)", () => {
    const { pedidos } = agruparPedidos(
      corpoDe([
        CABECALHO,
        ["S", "Pago", "1", "", "20", "101", "23/11/2026"],
        ["S", "Pendente", "1", "", "20", "101", "23/11/2026"],
        ["F", "Pago", "1", "", "20", "101", "23/11/2026"],
        ["F", "Pago", "1", "", "20", "102", "23/11/2026"],
        ["D", "Pago", "1", "", "20", "101", "23/11/2026"],
        ["D", "Pago", "1", "", "20", "101", "24/11/2026"],
        ["OK", "Pago", "1", "", "20", "101", "23/11/2026 10:00"],
        ["OK", "Pago", "1", "", "20", "101", "23/11/2026 10:00"],
      ]),
    );
    expect(
      [...pedidos.values()].map((pedido) => [
        pedido.id,
        pedido.inconsistente,
        pedido.linhas,
      ]),
    ).toEqual([
      ["S", true, 2],
      ["F", true, 2],
      ["D", true, 2],
      // As duas linhas iguais chegaram numa posição só (vezes = 2).
      ["OK", false, 2],
    ]);
  });

  it("quantidade diferente da contagem dos números: vale a quantidade, com aviso", () => {
    const resposta = analisar(
      [CABECALHO, ["A", "Pago", "3", "1, 2", "60,00", "101", ""]],
      [gravado("A", { qtd_bilhetes: 3, total_centavos: 6000 })],
    );
    expect(resposta.resumo.conferem).toBe(1);
    expect(resposta.avisos).toContainEqual(
      expect.objectContaining({
        codigo: "quantidade_diferente_dos_numeros",
        quantidade: 1,
      }),
    );
  });
});

describe("regra do valor dos pedidos em várias linhas (B2 da revisão)", () => {
  it("3 linhas de R$ 20,00 (o preço do bilhete): R$ 60,00, e o Recuperar grava 6000", () => {
    const linhas = [
      CABECALHO,
      ["L-1", "Pago", "1", "7", "R$ 20,00", "101", "28/11/2026 10:00"],
      ["L-1", "Pago", "1", "8", "R$ 20,00", "101", "28/11/2026 10:00"],
      ["L-1", "Pago", "1", "9", "R$ 20,00", "101", "28/11/2026 10:00"],
    ];
    const resposta = analisar(linhas);
    expect(grupo(resposta, "venda_perdida").itens[0]).toMatchObject({
      pedido_id: "L-1",
      arquivo: { qtd_bilhetes: 3, total_centavos: 6000 },
      recuperavel: true,
    });
    expect(resposta.avisos).toContainEqual(
      expect.objectContaining({ codigo: "valor_por_bilhete", quantidade: 1 }),
    );
    expect(planejar(linhas, [], ["L-1"]).gravar).toMatchObject([
      { pedido_id: "L-1", qtd_bilhetes: 3, total_centavos: 6000 },
    ]);
  });

  it("promoção R$ 18 × 2 (desconto dentro da tolerância): R$ 36,00", () => {
    const plano = planejar(
      [
        CABECALHO,
        ["L-2", "Pago", "1", "1", "18,00", "101", "28/11/2026"],
        ["L-2", "Pago", "1", "2", "18,00", "101", "28/11/2026"],
      ],
      [],
      ["L-2"],
    );
    expect(plano.gravar).toMatchObject([
      { pedido_id: "L-2", qtd_bilhetes: 2, total_centavos: 3600 },
    ]);
  });

  it("o mesmo valor em todas as linhas, e não é o preço: ambíguo (sem valor comparado, não recupera, com aviso)", () => {
    const linhas = [
      CABECALHO,
      ["L-3", "Pago", "3", "1", "R$ 60,00", "101", "28/11/2026"],
      ["L-3", "Pago", "3", "2", "R$ 60,00", "101", "28/11/2026"],
      ["L-3", "Pago", "3", "3", "R$ 60,00", "101", "28/11/2026"],
      ["A", "Pago", "3", "4", "R$ 60,00", "101", "28/11/2026"],
      ["A", "Pago", "3", "5", "R$ 60,00", "101", "28/11/2026"],
      ["A", "Pago", "3", "6", "R$ 60,00", "101", "28/11/2026"],
    ];
    // "A" está no sistema com R$ 60: um pedido só não firma a convenção.
    const gravados = [gravado("A", { qtd_bilhetes: 3, total_centavos: 6000 })];
    const resposta = analisar(linhas, gravados);
    expect(grupo(resposta, "venda_perdida").itens[0]).toMatchObject({
      pedido_id: "L-3",
      arquivo: { total_centavos: null },
      recuperavel: false,
      observacoes: ["valor_ambiguo"],
    });
    // Sem valor decidido, o valor de "A" não é comparado (nada de valor_diferente).
    expect(grupo(resposta, "valor_diferente").quantidade).toBe(0);
    expect(resposta.avisos).toContainEqual(
      expect.objectContaining({
        codigo: "valor_ambiguo",
        quantidade: 2,
        mensagem: expect.stringContaining("R$ 20,00"),
      }),
    );
    expect(planejar(linhas, gravados, ["L-3"]).naoRecuperados).toEqual([
      { pedido_id: "L-3", motivo: "valor_ambiguo" },
    ]);
  });

  it("valor desconhecido (vazio ou ambíguo) não vira R$ 0 nos totais: conta em sem_valor", () => {
    const linhas = [
      CABECALHO,
      ["V-OK", "Pago", "1", "1", "R$ 20,00", "101", "28/11/2026"],
      ["V-VAZIO", "Pago", "1", "2", "", "101", "28/11/2026"],
      ["V-AMB", "Pago", "2", "3", "R$ 50,00", "101", "28/11/2026"],
      ["V-AMB", "Pago", "2", "4", "R$ 50,00", "101", "28/11/2026"],
      ["NO-SISTEMA", "Pago", "2", "5, 6", "R$ 40,00", "101", "28/11/2026"],
    ];
    const resposta = analisar(linhas, [
      gravado("NO-SISTEMA", { qtd_bilhetes: 2, total_centavos: 4000 }),
    ]);
    expect(resposta.resumo.aprovados_no_arquivo).toEqual({
      pedidos_aprovados: 4,
      bilhetes: 6,
      sem_quantidade: 0,
      total_centavos: 6000,
      sem_valor: 2,
    });
    expect(grupo(resposta, "venda_perdida")).toMatchObject({
      quantidade: 3,
      arquivo: { bilhetes: 4, total_centavos: 2000, sem_valor: 2 },
      sistema: { bilhetes: 0, total_centavos: 0 },
    });
    expect(grupo(resposta, "ausente_no_arquivo").arquivo).toEqual({
      bilhetes: 0,
      sem_quantidade: 0,
      total_centavos: 0,
      sem_valor: 0,
    });

    // Sem as colunas, o total do arquivo é null (desconhecido), e não 0.
    const semColunas = analisar(
      [
        ["Pedido", "Status"],
        ["S-1", "Pago"],
      ],
      [],
    );
    expect(semColunas.resumo.aprovados_no_arquivo).toEqual({
      pedidos_aprovados: 1,
      bilhetes: null,
      sem_quantidade: 0,
      total_centavos: null,
      sem_valor: 0,
    });
    expect(grupo(semColunas, "venda_perdida").arquivo).toEqual({
      bilhetes: null,
      sem_quantidade: 0,
      total_centavos: null,
      sem_valor: 0,
    });
  });

  it("quantidade vazia ou ilegível não vira 0 bilhete: conta em sem_quantidade e não é comparada", () => {
    const linhas = [
      CABECALHO,
      ["Q-OK", "Pago", "2", "1, 2", "R$ 40,00", "101", "28/11/2026"],
      ["Q-VAZIA", "Pago", "", "", "R$ 20,00", "101", "28/11/2026"],
      ["Q-ILEGIVEL", "Pago", "dois", "", "R$ 20,00", "101", "28/11/2026"],
      ["NO-SISTEMA", "Pago", "", "", "R$ 40,00", "101", "28/11/2026"],
    ];
    const resposta = analisar(linhas, [
      gravado("NO-SISTEMA", { qtd_bilhetes: 2, total_centavos: 4000 }),
    ]);
    expect(resposta.resumo.aprovados_no_arquivo).toEqual({
      pedidos_aprovados: 4,
      bilhetes: 2,
      sem_quantidade: 3,
      total_centavos: 12000,
      sem_valor: 0,
    });
    expect(grupo(resposta, "venda_perdida")).toMatchObject({
      quantidade: 3,
      arquivo: {
        bilhetes: 2,
        sem_quantidade: 2,
        total_centavos: 8000,
        sem_valor: 0,
      },
    });
    expect(
      grupo(resposta, "venda_perdida").itens.map((item) => [
        item.pedido_id,
        item.arquivo?.qtd_bilhetes,
        item.recuperavel,
        item.observacoes,
      ]),
    ).toEqual([
      ["Q-ILEGIVEL", null, false, ["sem_quantidade"]],
      ["Q-OK", 2, true, []],
      ["Q-VAZIA", null, false, ["sem_quantidade"]],
    ]);
    // Sem a quantidade no arquivo, a do sistema não é comparada: o pedido confere.
    expect(grupo(resposta, "quantidade_diferente").quantidade).toBe(0);
    expect(resposta.resumo.conferem).toBe(1);
  });

  it("a convenção pelos pedidos que batem com o sistema: cada linha repete o valor do pedido (avisa e usa)", () => {
    const linhas = [
      CABECALHO,
      ...["A", "B", "L-4"].flatMap((codigo) =>
        ["1", "2", "3"].map((numero) => [
          codigo,
          "Pago",
          "3",
          numero,
          "R$ 60,00",
          "101",
          "28/11/2026",
        ]),
      ),
    ];
    const gravados = ["A", "B"].map((codigo) =>
      gravado(codigo, { qtd_bilhetes: 3, total_centavos: 6000 }),
    );
    const resposta = analisar(linhas, gravados);
    expect(resposta.resumo.conferem).toBe(2);
    expect(grupo(resposta, "venda_perdida").itens[0]).toMatchObject({
      pedido_id: "L-4",
      arquivo: { qtd_bilhetes: 3, total_centavos: 6000 },
      recuperavel: true,
    });
    expect(resposta.avisos).toContainEqual(
      expect.objectContaining({
        codigo: "valor_do_pedido_repetido",
        quantidade: 3,
      }),
    );
    expect(planejar(linhas, gravados, ["L-4"])).toMatchObject({
      convencao: "repetido",
      gravar: [{ pedido_id: "L-4", qtd_bilhetes: 3, total_centavos: 6000 }],
    });
  });

  it("a convenção por bilhete vale até para um valor longe do preço", () => {
    const linhas = [
      CABECALHO,
      ...["A", "B"].flatMap((codigo) =>
        ["1", "2"].map((numero) => [
          codigo,
          "Pago",
          "1",
          numero,
          "R$ 20,00",
          "101",
          "28/11/2026",
        ]),
      ),
      ["L-5", "Pago", "1", "7", "R$ 30,00", "101", "28/11/2026"],
      ["L-5", "Pago", "1", "8", "R$ 30,00", "101", "28/11/2026"],
    ];
    const gravados = ["A", "B"].map((codigo) =>
      gravado(codigo, { qtd_bilhetes: 2, total_centavos: 4000 }),
    );
    expect(planejar(linhas, gravados, ["L-5"])).toMatchObject({
      convencao: "por_bilhete",
      gravar: [{ pedido_id: "L-5", qtd_bilhetes: 2, total_centavos: 6000 }],
    });
    expect(analisar(linhas, gravados).avisos).toContainEqual(
      expect.objectContaining({
        codigo: "valor_por_bilhete",
        mensagem: expect.stringContaining("já estão no sistema"),
      }),
    );
  });

  it("pedidos recuperados pela própria conferência não firmam a convenção (X1 e X2 não transformam Y em R$ 180)", () => {
    // X1 e X2: 3 linhas de R$ 20,00 (o preço), recuperados como R$ 60,00 pela regra do preço.
    const linhas = [
      CABECALHO,
      ...["X1", "X2"].flatMap((codigo) =>
        ["1", "2", "3"].map((numero) => [
          codigo,
          "Pago",
          "1",
          numero,
          "R$ 20,00",
          "101",
          "28/11/2026",
        ]),
      ),
      // Y: o mesmo valor (R$ 60,00, longe do preço) nas 3 linhas: ambíguo.
      ["Y", "Pago", "3", "7", "R$ 60,00", "101", "28/11/2026"],
      ["Y", "Pago", "3", "8", "R$ 60,00", "101", "28/11/2026"],
      ["Y", "Pago", "3", "9", "R$ 60,00", "101", "28/11/2026"],
    ];
    const recuperados = ["X1", "X2"].map((codigo) =>
      gravado(codigo, {
        qtd_bilhetes: 3,
        total_centavos: 6000,
        origem: "conferencia",
      }),
    );
    const plano = planejar(linhas, recuperados, ["Y"]);
    expect(plano.convencao).toBeNull();
    expect(plano.naoRecuperados).toEqual([
      { pedido_id: "Y", motivo: "valor_ambiguo" },
    ]);
    const resposta = analisar(linhas, recuperados);
    expect(grupo(resposta, "venda_perdida").itens).toMatchObject([
      {
        pedido_id: "Y",
        arquivo: { total_centavos: null },
        recuperavel: false,
        observacoes: ["valor_ambiguo"],
      },
    ]);
    // Com os mesmos pedidos vindos do webhook, a convenção vale (e Y seria R$ 180,00).
    const doWebhook = recuperados.map((pedido) => ({
      ...pedido,
      origem: "webhook" as const,
    }));
    expect(planejar(linhas, doWebhook, ["Y"])).toMatchObject({
      convencao: "por_bilhete",
      gravar: [{ pedido_id: "Y", total_centavos: 18000 }],
    });
  });

  it("o mesmo arquivo em um bilhete por linha (valor de cada bilhete) e em um pedido por linha dá as mesmas divergências", () => {
    const gravados = [
      gravado("A", { qtd_bilhetes: 3, total_centavos: 6000 }),
      gravado("B", {
        qtd_bilhetes: 1,
        total_centavos: 2000,
        affiliate_id: 102,
      }),
    ];
    const porPedido = analisar(
      [
        CABECALHO,
        ["A", "Pago", "3", "1, 2, 3", "60,00", "101", "23/11/2026 10:00"],
        ["B", "Pago", "2", "4, 5", "40,00", "102", "23/11/2026 11:00"],
        ["C", "Pago", "1", "6", "20,00", "101", "23/11/2026 12:00"],
      ],
      gravados,
    );
    const porBilhete = analisar(
      [
        CABECALHO,
        ["A", "Pago", "1", "1", "20,00", "101", "23/11/2026 10:00"],
        ["A", "Pago", "1", "2", "20,00", "101", "23/11/2026 10:00"],
        ["A", "Pago", "1", "3", "20,00", "101", "23/11/2026 10:00"],
        ["B", "Pago", "1", "4", "20,00", "102", "23/11/2026 11:00"],
        ["B", "Pago", "1", "5", "20,00", "102", "23/11/2026 11:00"],
        ["C", "Pago", "1", "6", "20,00", "101", "23/11/2026 12:00"],
      ],
      gravados,
    );
    expect(porBilhete.divergencias).toEqual(porPedido.divergencias);
    expect(porBilhete.resumo).toEqual(porPedido.resumo);
    expect(porBilhete.arquivo.um_bilhete_por_linha).toBe(true);
    expect(porPedido.arquivo.um_bilhete_por_linha).toBe(false);
    expect(
      Object.fromEntries(
        porPedido.divergencias.map((item) => [
          item.tipo,
          item.itens.map((divergencia) => divergencia.pedido_id),
        ]),
      ),
    ).toMatchObject({
      venda_perdida: ["C"],
      quantidade_diferente: ["B"],
      valor_diferente: ["B"],
    });
  });

  it("sem convenção, a faixa do preço tem as duas pontas: até o preço e até 50% abaixo dele (revisão do ciclo 2)", () => {
    // Preço R$ 20,00 (CAMPANHA). Duas linhas com o mesmo valor, nenhum pedido do arquivo no sistema.
    const duasLinhas = (codigo: string, valor: string) =>
      ["1", "2"].map((numero) => [
        codigo,
        "Pago",
        "1",
        numero,
        valor,
        "101",
        "28/11/2026",
      ]);
    const plano = planejar(
      [
        CABECALHO,
        // Exatamente a metade do preço (o limite da tolerância de desconto): por bilhete.
        ...duasLinhas("METADE", "10,00"),
        // Um centavo abaixo da metade: ambíguo.
        ...duasLinhas("ABAIXO", "9,99"),
        // Acima do preço (mas abaixo do dobro): ambíguo.
        ...duasLinhas("ACIMA", "30,00"),
      ],
      [],
      ["METADE", "ABAIXO", "ACIMA"],
    );
    expect(plano.convencao).toBeNull();
    expect(plano.gravar).toMatchObject([
      { pedido_id: "METADE", qtd_bilhetes: 2, total_centavos: 2000 },
    ]);
    expect(plano.naoRecuperados).toEqual([
      { pedido_id: "ABAIXO", motivo: "valor_ambiguo" },
      { pedido_id: "ACIMA", motivo: "valor_ambiguo" },
    ]);
  });
});

describe("trava do código que não bate (B3 da revisão)", () => {
  const pagos = (codigos: string[]) => [
    ["Pedido", "Status", "Quantidade", "Valor", "Data"],
    ...codigos.map((codigo) => [
      codigo,
      "Pago",
      "1",
      "20,00",
      "27/11/2026 10:00",
    ]),
  ];
  const doSistema = ["R-1", "R-2", "R-3", "R-4", "R-5", "R-6"].map((id) =>
    gravado(id, { aprovado_ms: Date.parse("2026-11-27T15:00:00.000Z") }),
  );
  const SETE = ["T-1", "T-2", "T-3", "T-4", "T-5", "T-6", "T-7"];

  it("7 de 7 pagos que não existem no sistema: a coluna não confere, nada é recuperável e o aviso explica", () => {
    const resposta = analisar(pagos(SETE), doSistema);
    expect(resposta.codigo).toEqual({
      confere: false,
      pagos_no_arquivo: 7,
      encontrados: 0,
    });
    const perdidas = grupo(resposta, "venda_perdida");
    expect(perdidas.quantidade).toBe(7);
    expect(perdidas.itens.every((item) => !item.recuperavel)).toBe(true);
    expect(perdidas.itens[0].observacoes).toEqual(["codigo_nao_confere"]);
    expect(resposta.avisos[0]).toMatchObject({
      codigo: "codigo_nao_confere",
      mensagem: expect.stringContaining(
        "A coluna escolhida como código do pedido (Pedido) não parece ser o código da Rifei",
      ),
    });
    expect(planejar(pagos(SETE), doSistema, ["T-1"]).codigo.confere).toBe(
      false,
    );
  });

  it("poucos pagos (abaixo de 5) não travam; metade ou mais encontrados também não", () => {
    expect(
      analisar(pagos(["T-1", "T-2", "T-3", "T-4"]), doSistema).codigo.confere,
    ).toBe(true);
    expect(
      analisar(pagos(["R-1", "R-2", "R-3", "T-1", "T-2", "T-3"]), doSistema)
        .codigo,
    ).toEqual({ confere: true, pagos_no_arquivo: 6, encontrados: 3 });
  });

  it("o webhook parou: poucos do arquivo no sistema, mas os pagos do sistema no período estão no arquivo (a coluna é a certa)", () => {
    const codigos = [
      ...doSistema.map((pedido) => pedido.id),
      ...Array.from({ length: 10 }, (_, i) => `PERDIDO-${i}`),
    ];
    const resposta = analisar(pagos(codigos), doSistema);
    expect(resposta.codigo).toEqual({
      confere: true,
      pagos_no_arquivo: 16,
      encontrados: 6,
    });
    expect(
      grupo(resposta, "venda_perdida").itens.every((item) => item.recuperavel),
    ).toBe(true);
  });

  it("as bordas da trava, sem a exceção do webhook parado: 5 pagos já travam; metade encontrada não trava (revisão do ciclo 2)", () => {
    // Nenhum pago do sistema no período do arquivo: a exceção não vale.
    expect(
      analisar(pagos(["T-1", "T-2", "T-3", "T-4", "T-5"]), []).codigo,
    ).toEqual({ confere: false, pagos_no_arquivo: 5, encontrados: 0 });
    // 3 de 6 encontrados (exatamente a metade) e só 3 pagos no sistema (menos que o mínimo da exceção).
    const tres = ["R-1", "R-2", "R-3"].map((id) =>
      gravado(id, { aprovado_ms: Date.parse("2026-11-27T15:00:00.000Z") }),
    );
    expect(
      analisar(pagos(["R-1", "R-2", "R-3", "T-1", "T-2", "T-3"]), tres).codigo,
    ).toEqual({ confere: true, pagos_no_arquivo: 6, encontrados: 3 });
  });

  it("a exceção do webhook parado conta só os pagos do sistema NO PERÍODO do arquivo (revisão do ciclo 2)", () => {
    // No período do arquivo (27/11), o sistema tem 6 pagos e nenhum está no arquivo. Os 6 do arquivo que
    // existem no sistema foram aprovados em outro dia: não confirmam a coluna.
    const noPeriodoForaDoArquivo = [
      "S-1",
      "S-2",
      "S-3",
      "S-4",
      "S-5",
      "S-6",
    ].map((id) =>
      gravado(id, { aprovado_ms: Date.parse("2026-11-27T15:00:00.000Z") }),
    );
    const noArquivoForaDoPeriodo = [
      "R-1",
      "R-2",
      "R-3",
      "R-4",
      "R-5",
      "R-6",
    ].map((id) =>
      gravado(id, { aprovado_ms: Date.parse("2026-11-20T15:00:00.000Z") }),
    );
    const codigos = [
      ...noArquivoForaDoPeriodo.map((pedido) => pedido.id),
      ...Array.from({ length: 14 }, (_, i) => `PERDIDO-${i}`),
    ];
    expect(
      analisar(pagos(codigos), [
        ...noPeriodoForaDoArquivo,
        ...noArquivoForaDoPeriodo,
      ]).codigo,
    ).toEqual({ confere: false, pagos_no_arquivo: 20, encontrados: 6 });
  });

  it("conferirCodigo direto: os que não estão pagos no arquivo não contam", () => {
    const corpo = corpoDe([
      ["Pedido", "Status"],
      ...Array.from({ length: 6 }, (_, i) => [`T-${i}`, "Pendente"]),
    ]);
    expect(
      conferirCodigo(agruparPedidos(corpo).pedidos.values(), () => undefined, {
        pagosNoPeriodo: 0,
        pagosNoPeriodoNoArquivo: 0,
      }),
    ).toEqual({ confere: true, pagos_no_arquivo: 0, encontrados: 0 });
  });

  it("código com alguma linha paga conta como pago mesmo inconsistente (a coluna errada junta pedidos diferentes)", () => {
    // Ex.: o afiliado escolhido como código: cada "código" junta uma linha paga e uma pendente.
    const linhas = [
      ["Pedido", "Status", "Quantidade", "Valor", "Data"],
      ...["T-1", "T-2", "T-3", "T-4", "T-5", "T-6", "T-7"].flatMap((codigo) => [
        [codigo, "Pago", "1", "20,00", "27/11/2026 10:00"],
        [codigo, "Pendente", "1", "20,00", "27/11/2026 11:00"],
      ]),
    ];
    const corpo = corpoDe(linhas);
    const { pedidos } = agruparPedidos(corpo);
    expect(
      [...pedidos.values()].every(
        (pedido) => pedido.inconsistente && pedido.algumaLinhaPaga,
      ),
    ).toBe(true);
    expect(
      conferirCodigo(pedidos.values(), () => undefined, {
        pagosNoPeriodo: 0,
        pagosNoPeriodoNoArquivo: 0,
      }),
    ).toEqual({ confere: false, pagos_no_arquivo: 7, encontrados: 0 });
    // Na análise: a trava vale e o aviso explica, mesmo sem nenhuma venda perdida listada.
    const resposta = analisar(linhas);
    expect(resposta.codigo).toEqual({
      confere: false,
      pagos_no_arquivo: 7,
      encontrados: 0,
    });
    expect(resposta.avisos.map((aviso) => aviso.codigo)).toEqual(
      expect.arrayContaining(["codigo_nao_confere", "pedido_inconsistente"]),
    );
  });
});

describe("RIFA-028 (D20): pedido do arquivo desconsiderado no sistema", () => {
  const DESCONSIDERACAO = {
    motivo: "estorno" as const,
    observacao: null,
    em: "2026-11-30T12:00:00.000Z",
  };
  const LINHAS = [
    CABECALHO,
    ["OK", "Pago", "1", "1", "20,00", "101", "25/11/2026"],
    // Pago nos dois lados, com valor e afiliado diferentes: seria valor_diferente e afiliado_diferente.
    ["D-PAGO", "Pago", "1", "2", "35,00", "102", "25/11/2026"],
    // Pendente no arquivo e pago no sistema: seria nao_pago_na_rifei (um estorno já resolvido).
    ["D-ESTORNO", "Cancelado", "1", "3", "20,00", "101", "25/11/2026"],
    // Pago no arquivo e em processo no sistema (um teste ainda não pago): seria pagamento_nao_registrado.
    ["D-TESTE", "Pago", "1", "4", "20,00", "101", "25/11/2026"],
    ["PERDIDO", "Pago", "1", "5", "20,00", "101", "25/11/2026"],
  ];
  const GRAVADOS = [
    gravado("OK"),
    gravado("D-PAGO", { desconsiderado: DESCONSIDERACAO }),
    gravado("D-ESTORNO", { desconsiderado: DESCONSIDERACAO }),
    gravado("D-TESTE", {
      status: "in_process",
      aprovado_ms: null,
      desconsiderado: { ...DESCONSIDERACAO, motivo: "teste" },
    }),
    // Desconsiderado e fora do arquivo: não aparece (não conta nem há o que conferir); não é ausente_no_arquivo.
    gravado("D-FORA", { desconsiderado: DESCONSIDERACAO }),
    // Pago, conta e está fora do arquivo: ausente_no_arquivo, como sempre.
    gravado("AUSENTE"),
  ];

  it("vai para o grupo à parte, nunca para uma divergência nem para o confere; os totais do sistema sem ele", () => {
    const resposta = analisar(LINHAS, GRAVADOS);
    const tipos = (id: string) =>
      resposta.divergencias
        .filter((grupoDe) =>
          grupoDe.itens.some((item) => item.pedido_id === id),
        )
        .map((grupoDe) => grupoDe.tipo);

    expect(resposta.desconsiderados).toEqual({
      quantidade: 3,
      itens: [
        {
          pedido_id: "D-ESTORNO",
          arquivo: expect.objectContaining({ status: "cancelado" }),
          sistema: expect.objectContaining({ status: "approved" }),
          desconsiderado: DESCONSIDERACAO,
        },
        {
          pedido_id: "D-PAGO",
          arquivo: expect.objectContaining({
            status: "aprovado",
            total_centavos: 3500,
            affiliate_id: 102,
          }),
          sistema: expect.objectContaining({
            total_centavos: 2000,
            affiliate_id: 101,
          }),
          desconsiderado: DESCONSIDERACAO,
        },
        {
          pedido_id: "D-TESTE",
          arquivo: expect.objectContaining({ status: "aprovado" }),
          sistema: expect.objectContaining({ status: "in_process" }),
          desconsiderado: { ...DESCONSIDERACAO, motivo: "teste" },
        },
      ],
      itens_omitidos: 0,
    });
    for (const id of ["D-PAGO", "D-ESTORNO", "D-TESTE", "D-FORA"])
      expect({ id, tipos: tipos(id) }).toEqual({ id, tipos: [] });
    expect(tipos("PERDIDO")).toEqual(["venda_perdida"]);
    expect(tipos("AUSENTE")).toEqual(["ausente_no_arquivo"]);
    expect(resposta.resumo).toMatchObject({
      // O lado do arquivo é o que o arquivo tem (os 4 pagos dele, inclusive os 2 desconsiderados no sistema).
      aprovados_no_arquivo: { pedidos_aprovados: 4 },
      // O do sistema conta só o que conta (OK e AUSENTE), como o painel.
      aprovados_no_sistema: {
        pedidos_aprovados: 2,
        bilhetes: 2,
        total_centavos: 4000,
      },
      conferem: 1,
      com_divergencia: 2,
    });
    respostaAnalisePorPedidoSchema.parse(resposta);
  });

  it("sem nenhum: o grupo vem sempre, com quantidade 0", () => {
    expect(
      analisar(LINHAS.slice(0, 2), [gravado("OK")]).desconsiderados,
    ).toEqual({ quantidade: 0, itens: [], itens_omitidos: 0 });
  });

  it("o Recuperar nunca grava de novo um desconsiderado (ja_existe)", () => {
    expect(
      planejar(LINHAS, GRAVADOS, ["D-PAGO", "D-TESTE", "PERDIDO"]),
    ).toMatchObject({
      gravar: [expect.objectContaining({ pedido_id: "PERDIDO" })],
      naoRecuperados: [
        { pedido_id: "D-PAGO", motivo: "ja_existe" },
        { pedido_id: "D-TESTE", motivo: "ja_existe" },
      ],
    });
  });

  it("a trava do código compara o mesmo conjunto dos dois lados: o desconsiderado não conta nos pagos do sistema no período nem nos do arquivo", () => {
    // O sistema tem 10 pagos que contam no período do arquivo (R-1 a R-10), 4 deles no arquivo, e 2
    // desconsiderados do período que também estão no arquivo (X-1 e X-2); o arquivo tem ainda 10 perdidos. Os
    // encontrados (6 de 16) travariam a coluna, e a exceção do webhook parado pede metade dos pagos do sistema no
    // arquivo: 4 de 10 não chega. Contando os desconsiderados só de um lado (6 de 10), chegaria.
    const noPeriodo = (id: string, desconsiderado: boolean) =>
      gravado(id, {
        aprovado_ms: Date.parse("2026-11-27T15:00:00.000Z"),
        desconsiderado: desconsiderado ? DESCONSIDERACAO : null,
      });
    const contam = Array.from({ length: 10 }, (_, i) =>
      noPeriodo(`R-${i + 1}`, false),
    );
    const desconsiderados = ["X-1", "X-2"].map((id) => noPeriodo(id, true));
    const pagos = [
      ["Pedido", "Status", "Quantidade", "Valor", "Data"],
      ...[
        "R-1",
        "R-2",
        "R-3",
        "R-4",
        "X-1",
        "X-2",
        ...Array.from({ length: 10 }, (_, i) => `PERDIDO-${i}`),
      ].map((codigo) => [codigo, "Pago", "1", "20,00", "27/11/2026 10:00"]),
    ];
    // sistemaDe conta os pagos no período como CONTAR_PAGOS_NO_PERIODO (sem os desconsiderados): 10.
    expect(analisar(pagos, [...contam, ...desconsiderados]).codigo).toEqual({
      confere: false,
      pagos_no_arquivo: 16,
      encontrados: 6,
    });
    // Os mesmos pedidos, contando: 6 dos 12 pagos do período estão no arquivo, e a exceção vale.
    expect(
      analisar(pagos, [
        ...contam,
        ...desconsiderados.map((pedido) => ({
          ...pedido,
          desconsiderado: null,
        })),
      ]).codigo.confere,
    ).toBe(true);
  });

  it("mais desconsiderados que o limite da lista: os primeiros em ordem de código e o resto em itens_omitidos", () => {
    const quantos = LIMITE_ITENS_POR_DIVERGENCIA + 2;
    const ids = Array.from(
      { length: quantos },
      (_, i) => `D-${String(i).padStart(4, "0")}`,
    );
    const resposta = analisar(
      [
        CABECALHO,
        ...ids.map((id) => [id, "Pago", "1", "", "20,00", "101", "25/11/2026"]),
      ],
      ids.map((id) => gravado(id, { desconsiderado: DESCONSIDERACAO })),
    );
    expect(resposta.desconsiderados?.quantidade).toBe(quantos);
    expect(resposta.desconsiderados?.itens_omitidos).toBe(2);
    expect(
      resposta.desconsiderados?.itens.map((item) => item.pedido_id),
    ).toEqual(ids.slice(0, LIMITE_ITENS_POR_DIVERGENCIA));
  });
});

describe("pagos no sistema que o arquivo não tem", () => {
  it("os de dias que o arquivo não cobre aparecem na lista, mas ficam à parte em com_divergencia", () => {
    const resposta = analisar(
      [
        ["Pedido", "Status", "Quantidade", "Valor", "Afiliado", "Data"],
        ["A", "Pago", "1", "20,00", "101", "27/11/2026 10:00"],
      ],
      [
        gravado("A", { aprovado_ms: Date.parse("2026-11-27T13:00:00.000Z") }),
        // No dia do arquivo: diferença deste arquivo.
        gravado("NO-DIA", {
          aprovado_ms: Date.parse("2026-11-27T20:00:00.000Z"),
        }),
        // Dias antes do arquivo: só informação.
        gravado("ANTES", {
          aprovado_ms: Date.parse("2026-11-20T15:00:00.000Z"),
        }),
      ],
    );
    expect(
      grupo(resposta, "ausente_no_arquivo").itens.map((item) => [
        item.pedido_id,
        item.observacoes,
      ]),
    ).toEqual([
      ["ANTES", ["fora_do_periodo_do_arquivo"]],
      ["NO-DIA", []],
    ]);
    expect(resposta.resumo).toMatchObject({
      conferem: 1,
      com_divergencia: 1,
      ausentes_fora_do_periodo: 1,
    });
  });
});

describe("afiliado do arquivo: número, rótulo cadastrado (sem acento e maiúsculas) ou não reconhecido", () => {
  it("rótulo igual dá o afiliado; rótulo repetido entre dois afiliados é ambíguo (não reconhecido)", () => {
    const resposta = analisar([
      ["Pedido", "Valor", "Afiliado"],
      ["A", "20", "@LIDER.BETEL"],
      ["B", "20", "repetido"],
      ["C", "20", "999"],
      ["D", "20", ""],
    ]);
    expect(
      grupo(resposta, "venda_perdida").itens.map((item) => [
        item.pedido_id,
        item.arquivo?.afiliado,
        item.arquivo?.affiliate_id,
        item.arquivo?.celula,
      ]),
    ).toEqual([
      ["A", "reconhecido", 102, { id: 2, nome: "Célula Betel" }],
      ["B", "nao_reconhecido", null, null],
      ["C", "reconhecido", 999, null],
      ["D", "vazio", null, null],
    ]);
  });
});

/** O que o banco somaria (pagos da campanha 1 no período, por afiliado e por dia em UTC−3). */
function agregadoDoSistema(
  corpo: CorpoConferencia,
  gravados: PedidoGravado[],
): SistemaAgregado {
  const periodo = periodoDoArquivo(corpo, FUSO);
  const pagos = gravados.filter(
    (pedido) =>
      pedido.campanha_id === 1 &&
      pedido.status === "approved" &&
      pedido.desconsiderado === null &&
      (periodo === null ||
        (pedido.aprovado_ms !== null &&
          pedido.aprovado_ms >= periodo.ms.inicio &&
          pedido.aprovado_ms < periodo.ms.fim)),
  );
  const agrupar = <K>(chave: (pedido: PedidoGravado) => K) => {
    const grupos = new Map<K, PedidoGravado[]>();
    for (const pedido of pagos)
      grupos.set(chave(pedido), [...(grupos.get(chave(pedido)) ?? []), pedido]);
    return [...grupos];
  };
  return {
    afiliados: AFILIADOS,
    total: somarPedidos(pagos),
    porAfiliado: agrupar((pedido) => pedido.affiliate_id).map(
      ([affiliate_id, lista]) => ({ affiliate_id, soma: somarPedidos(lista) }),
    ),
    porDia:
      corpo.colunas.data === null
        ? null
        : agrupar((pedido) =>
            new Date((pedido.aprovado_ms ?? 0) - 3 * 3_600_000)
              .toISOString()
              .slice(0, 10),
          ).map(([dia, lista]) => ({ dia, soma: somarPedidos(lista) })),
  };
}

function agregar(linhas: string[][], gravados: PedidoGravado[]) {
  const corpo = corpoDe(linhas);
  return analisarAgregado({
    corpo,
    sistema: agregadoDoSistema(corpo, gravados),
    periodo: periodoDoArquivo(corpo, FUSO),
    agora: AGORA,
  });
}

describe("modo agregado (sem o código do pedido)", () => {
  it("compara por afiliado e por dia, só nos dias do arquivo, com os diferentes primeiro", () => {
    const resposta = agregar(
      [
        ["Status", "Quantidade", "Valor", "Afiliado", "Data"],
        ["Pago", "1", "20,00", "101", "23/11/2026"],
        ["Pago", "3", "60,00", "102", "24/11/2026"],
        ["Pendente", "5", "100,00", "102", "24/11/2026"],
        ["Pago", "1", "20,00", "", "24/11/2026"],
      ],
      [
        gravado("X1", {
          affiliate_id: 101,
          aprovado_ms: Date.parse("2026-11-23T15:00:00.000Z"),
        }),
        gravado("X2", {
          affiliate_id: 102,
          aprovado_ms: Date.parse("2026-11-24T15:00:00.000Z"),
          qtd_bilhetes: 2,
          total_centavos: 4000,
        }),
        // Fora dos dias do arquivo, de outra campanha e não aprovado: não contam.
        gravado("X3", { aprovado_ms: Date.parse("2026-11-30T15:00:00.000Z") }),
        gravado("X4", { campanha_id: 2 }),
        gravado("X5", { status: "in_process", aprovado_ms: null }),
      ],
    );
    expect(resposta.recorte).toEqual({
      data_inicio: "2026-11-23",
      data_fim: "2026-11-24",
    });
    expect(resposta.total).toEqual({
      arquivo: {
        pedidos_aprovados: 3,
        bilhetes: 5,
        sem_quantidade: 0,
        total_centavos: 10000,
        sem_valor: 0,
      },
      sistema: { pedidos_aprovados: 2, bilhetes: 3, total_centavos: 6000 },
      confere: false,
    });
    expect(
      resposta.por_afiliado?.map((linha) => [
        linha.afiliado,
        linha.affiliate_id,
        linha.confere,
      ]),
    ).toEqual([
      ["afiliado", 102, false],
      ["sem_afiliado", null, false],
      ["afiliado", 101, true],
    ]);
    expect(resposta.por_afiliado?.[0]).toMatchObject({
      celula: { id: 2, nome: "Célula Betel" },
      arquivo: { pedidos_aprovados: 1, bilhetes: 3, total_centavos: 6000 },
      sistema: { pedidos_aprovados: 1, bilhetes: 2, total_centavos: 4000 },
    });
    expect(resposta.por_dia?.map((dia) => [dia.data, dia.confere])).toEqual([
      ["2026-11-23", true],
      ["2026-11-24", false],
    ]);
    expect(resposta.avisos.map((aviso) => aviso.codigo)).toEqual([
      "sem_coluna_pedido",
    ]);
  });

  it("sem o código e sem a quantidade: não conta pedidos (pode ser um bilhete por linha) e avisa", () => {
    const resposta = agregar(
      [
        ["Status", "Valor", "Afiliado"],
        ["Pago", "20,00", "101"],
        ["Pago", "20,00", "101"],
        ["Pago", "20,00", "101"],
      ],
      [gravado("A", { qtd_bilhetes: 3, total_centavos: 6000 })],
    );
    expect(resposta.total).toEqual({
      arquivo: {
        pedidos_aprovados: null,
        bilhetes: null,
        sem_quantidade: 0,
        total_centavos: 6000,
        sem_valor: 0,
      },
      sistema: { pedidos_aprovados: 1, bilhetes: 3, total_centavos: 6000 },
      confere: true,
    });
    expect(resposta.avisos.map((aviso) => aviso.codigo)).toContain(
      "sem_contagem_de_pedidos",
    );
  });

  it("um bilhete por linha sem o código: só os bilhetes são comparados (pedidos e valor ficam null)", () => {
    const resposta = agregar(
      [
        ["Status", "Quantidade de bilhetes", "Bilhetes", "Valor"],
        ["Pago", "2", "1", "40,00"],
        ["Pago", "2", "2", "40,00"],
        ["Pago", "1", "3", "20,00"],
      ],
      [gravado("A", { qtd_bilhetes: 2, total_centavos: 4000 }), gravado("B")],
    );
    expect(resposta.arquivo.um_bilhete_por_linha).toBe(true);
    expect(resposta.total).toEqual({
      arquivo: {
        pedidos_aprovados: null,
        bilhetes: 3,
        sem_quantidade: 0,
        total_centavos: null,
        sem_valor: 0,
      },
      sistema: { pedidos_aprovados: 2, bilhetes: 3, total_centavos: 6000 },
      confere: true,
    });
    expect(resposta.avisos.map((aviso) => aviso.codigo)).toEqual(
      expect.arrayContaining([
        "um_bilhete_por_linha_sem_id",
        "sem_coluna_afiliado",
        "sem_coluna_data",
      ]),
    );
  });

  it("sem a coluna de status, todas as linhas contam como pagas (aviso)", () => {
    const resposta = agregar(
      [
        ["Quantidade", "Valor"],
        ["1", "20,00"],
        ["1", "30,00"],
      ],
      [gravado("A"), gravado("B", { total_centavos: 3000 })],
    );
    expect(resposta.total.arquivo).toEqual({
      pedidos_aprovados: 2,
      bilhetes: 2,
      sem_quantidade: 0,
      total_centavos: 5000,
      sem_valor: 0,
    });
    expect(resposta.total.confere).toBe(true);
    expect(resposta.avisos.map((aviso) => aviso.codigo)).toContain(
      "sem_coluna_status",
    );
  });

  it("linha paga com o valor vazio não vira R$ 0: conta em sem_valor e o valor não confere", () => {
    // Sem a quantidade, só o valor é comparado: antes, R$ 20 + "vazio" = R$ 20 "conferia" com o sistema.
    const resposta = agregar(
      [
        ["Status", "Valor", "Afiliado", "Data"],
        ["Pago", "20,00", "101", "24/11/2026"],
        ["Pago", "", "101", "24/11/2026"],
        ["Pago", "30,00", "102", "25/11/2026"],
      ],
      [
        gravado("A", { aprovado_ms: Date.parse("2026-11-24T15:00:00.000Z") }),
        gravado("B", {
          affiliate_id: 102,
          total_centavos: 3000,
          aprovado_ms: Date.parse("2026-11-25T15:00:00.000Z"),
        }),
      ],
    );
    expect(resposta.total).toEqual({
      arquivo: {
        pedidos_aprovados: null,
        bilhetes: null,
        sem_quantidade: 0,
        total_centavos: 5000,
        sem_valor: 1,
      },
      sistema: { pedidos_aprovados: 2, bilhetes: 2, total_centavos: 5000 },
      confere: false,
    });
    expect(
      resposta.por_dia?.map((dia) => [
        dia.data,
        dia.arquivo.total_centavos,
        dia.arquivo.sem_valor,
        dia.confere,
      ]),
    ).toEqual([
      ["2026-11-24", 2000, 1, false],
      ["2026-11-25", 3000, 0, true],
    ]);
    expect(
      resposta.por_afiliado?.map((linha) => [
        linha.affiliate_id,
        linha.arquivo.sem_valor,
        linha.confere,
      ]),
    ).toEqual([
      [101, 1, false],
      [102, 0, true],
    ]);
  });

  it("linha paga sem quantidade não vira 0 bilhete: conta em sem_quantidade e os bilhetes não conferem", () => {
    // Antes, 3 + "vazio" = 3 bilhetes "conferiam" com os 2 + 1 do sistema (pedidos e valor iguais).
    const resposta = agregar(
      [
        ["Status", "Quantidade", "Valor", "Afiliado", "Data"],
        ["Pago", "3", "60,00", "101", "24/11/2026"],
        ["Pago", "", "20,00", "101", "24/11/2026"],
        ["Pago", "1", "30,00", "102", "25/11/2026"],
      ],
      [
        gravado("A", {
          qtd_bilhetes: 2,
          total_centavos: 6000,
          aprovado_ms: Date.parse("2026-11-24T15:00:00.000Z"),
        }),
        gravado("B", { aprovado_ms: Date.parse("2026-11-24T16:00:00.000Z") }),
        gravado("C", {
          affiliate_id: 102,
          total_centavos: 3000,
          aprovado_ms: Date.parse("2026-11-25T15:00:00.000Z"),
        }),
      ],
    );
    expect(resposta.total).toEqual({
      arquivo: {
        pedidos_aprovados: 3,
        bilhetes: 4,
        sem_quantidade: 1,
        total_centavos: 11000,
        sem_valor: 0,
      },
      sistema: { pedidos_aprovados: 3, bilhetes: 4, total_centavos: 11000 },
      confere: false,
    });
    expect(
      resposta.por_dia?.map((dia) => [
        dia.data,
        dia.arquivo.bilhetes,
        dia.arquivo.sem_quantidade,
        dia.confere,
      ]),
    ).toEqual([
      ["2026-11-24", 3, 1, false],
      ["2026-11-25", 1, 0, true],
    ]);
    expect(
      resposta.por_afiliado?.map((linha) => [
        linha.affiliate_id,
        linha.arquivo.sem_quantidade,
        linha.confere,
      ]),
    ).toEqual([
      [101, 1, false],
      [102, 0, true],
    ]);
  });
});

describe("plano do Recuperar", () => {
  const LINHAS = [
    CABECALHO,
    ["P-HORA", "Pago", "2", "1, 2", "40,00", "101", "28/11/2026 09:15"],
    ["P-DIA", "Pago", "1", "3", "20,00", "Lider.Betel", "29/11/2026"],
    ["P-HOJE", "Pago", "1", "4", "20,00", "", "01/12/2026"],
    ["P-SEMDATA", "Pago", "1", "5", "20,00", "777", ""],
    ["P-FUTURO", "Pago", "1", "6", "20,00", "101", "02/12/2026"],
    ["P-PENDENTE", "Pendente", "1", "7", "20,00", "101", "28/11/2026"],
    ["P-SEMVALOR", "Pago", "1", "8", "", "101", "28/11/2026"],
    ["P-SEMQTD", "Pago", "", "", "20,00", "101", "28/11/2026"],
    ["P-ZERO", "Pago", "0", "", "20,00", "101", "28/11/2026"],
    ["P-MISTO", "Pago", "1", "9", "20,00", "101", "28/11/2026"],
    ["P-MISTO", "Pendente", "1", "10", "20,00", "101", "28/11/2026"],
    ["P-EXISTE", "Pago", "1", "11", "20,00", "101", "28/11/2026"],
    ["P-ESTRANHO", "Pago", "1", "12", "20,00", "fulano", "28/11/2026"],
  ];
  const plano = (codigos: string[]) =>
    planejar(LINHAS, [gravado("P-EXISTE")], codigos);

  it("grava com o instante do arquivo, o meio-dia do dia (ou agora, se for hoje) ou o agora sem data", () => {
    const { gravar, naoRecuperados } = plano([
      "P-HORA",
      "P-DIA",
      "P-HOJE",
      "P-SEMDATA",
      "P-ESTRANHO",
    ]);
    expect(naoRecuperados).toEqual([]);
    expect(
      gravar.map((pedido) => [
        pedido.pedido_id,
        pedido.aprovado_em,
        pedido.origem_data,
        pedido.affiliate_id,
        pedido.afiliado,
      ]),
    ).toEqual([
      ["P-HORA", "2026-11-28T12:15:00.000Z", "arquivo", 101, "reconhecido"],
      [
        "P-DIA",
        "2026-11-29T15:00:00.000Z",
        "dia_do_arquivo",
        102,
        "reconhecido",
      ],
      // Meio-dia de hoje (15:00Z) ainda não passou às 12:00: vale o agora.
      ["P-HOJE", "2026-12-01T15:00:00.000Z", "dia_do_arquivo", null, "vazio"],
      [
        "P-SEMDATA",
        "2026-12-01T15:00:00.000Z",
        "recuperacao",
        777,
        "reconhecido",
      ],
      [
        "P-ESTRANHO",
        "2026-11-28T15:00:00.000Z",
        "dia_do_arquivo",
        null,
        "nao_reconhecido",
      ],
    ]);
    expect(gravar[0]).toMatchObject({ qtd_bilhetes: 2, total_centavos: 4000 });
  });

  it("não recupera o que não está pago, não está no arquivo, já existe, está inconsistente, sem dados ou no futuro", () => {
    const { gravar, naoRecuperados } = plano([
      "P-FUTURO",
      "P-PENDENTE",
      "P-SEMVALOR",
      "P-SEMQTD",
      "P-ZERO",
      "P-MISTO",
      "P-EXISTE",
      "P-NENHUM",
      "P-FUTURO",
    ]);
    expect(gravar).toEqual([]);
    // Sem repetição e na ordem pedida.
    expect(naoRecuperados).toEqual([
      { pedido_id: "P-FUTURO", motivo: "data_no_futuro" },
      { pedido_id: "P-PENDENTE", motivo: "nao_aprovado_no_arquivo" },
      { pedido_id: "P-SEMVALOR", motivo: "sem_valor" },
      { pedido_id: "P-SEMQTD", motivo: "sem_quantidade" },
      { pedido_id: "P-ZERO", motivo: "sem_quantidade" },
      { pedido_id: "P-MISTO", motivo: "inconsistente_no_arquivo" },
      { pedido_id: "P-EXISTE", motivo: "ja_existe" },
      { pedido_id: "P-NENHUM", motivo: "nao_esta_no_arquivo" },
    ]);
  });
});
