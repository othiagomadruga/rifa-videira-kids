// Análise da conferência (RIFA-012) sem o banco: como as linhas viram pedidos (inclusive "um bilhete por
// linha"), o modo agregado e o plano do "Recuperar". Os pedidos "gravados" são montados aqui.
import { describe, expect, it } from "vitest";
import { montarCsv } from "../test/conferencia-apoio";
import {
  agruparPedidos,
  analisarAgregado,
  analisarPorPedido,
  planejarRecuperacao,
  type AfiliadoGravado,
  type ArquivoLido,
  type DadosDoSistema,
  type PedidoGravado,
} from "./conferencia-analise";
import { lerArquivoReconciliacao } from "./conferencia-arquivo";

const FUSO = "America/Belem";
const AGORA = new Date("2026-12-01T15:00:00.000Z");

function ler(linhas: string[][]): ArquivoLido {
  const leitura = lerArquivoReconciliacao(
    montarCsv(linhas, { separador: ";" }),
    {
      fuso: FUSO,
    },
  );
  if (!leitura.ok) throw new Error(JSON.stringify(leitura));
  return leitura;
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
    aprovado_em: "2026-11-25T15:00:00.000Z",
    origem: "webhook",
    ...dados,
  };
}

function sistema(pedidos: PedidoGravado[] = []): DadosDoSistema {
  return { campanhaId: 1, fuso: FUSO, pedidos, afiliados: AFILIADOS };
}

const CABECALHO = [
  "Pedido",
  "Status",
  "Quantidade de bilhetes",
  "Bilhetes",
  "Valor",
  "Afiliado",
  "Data",
];

describe("CA5: um bilhete por linha (o mesmo pedido em várias linhas)", () => {
  it("valor e quantidade repetidos contam uma vez; os números se juntam; uma linha por bilhete dá pelo menos um por linha", () => {
    const { pedidos, repetidos } = agruparPedidos(
      ler([
        CABECALHO,
        // Total do pedido repetido em cada linha (3 bilhetes, R$ 60,00).
        ["A", "Pago", "3", "11", "R$ 60,00", "101", "23/11/2026 10:00"],
        ["A", "Pago", "3", "12", "R$ 60,00", "101", "23/11/2026 10:00"],
        ["A", "Pago", "3", "13", "R$ 60,00", "101", "23/11/2026 10:00"],
        // "1" em cada linha de bilhete: 2 bilhetes.
        ["B", "Pago", "1", "21", "R$ 40,00", "102", "24/11/2026"],
        ["B", "Pago", "1", "22", "R$ 40,00", "102", "24/11/2026"],
        // Só a primeira linha tem os dados do pedido; as outras, só o bilhete.
        ["C", "Pago", "2", "31", "R$ 40,00", "103", "25/11/2026"],
        ["C", "", "", "32", "", "", ""],
        // Valores diferentes em cada linha: são de cada linha (somam).
        ["D", "Pago", "1", "41", "R$ 20,00", "101", "26/11/2026"],
        ["D", "Pago", "2", "42, 43", "R$ 35,00", "101", "26/11/2026"],
      ]),
    );
    expect(repetidos).toBe(true);
    const resumo = [...pedidos.values()].map((pedido) => [
      pedido.id,
      pedido.linhas,
      pedido.qtd,
      pedido.centavos,
      pedido.numeros,
      pedido.inconsistente,
    ]);
    expect(resumo).toEqual([
      ["A", 3, 3, 6000, [11, 12, 13], false],
      ["B", 2, 2, 4000, [21, 22], false],
      ["C", 2, 2, 4000, [31, 32], false],
      ["D", 2, 3, 5500, [41, 42, 43], false],
    ]);
  });

  it("linhas do mesmo pedido com status, afiliado ou dia diferentes: inconsistente (fora da comparação)", () => {
    const { pedidos } = agruparPedidos(
      ler([
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
      [...pedidos.values()].map((pedido) => [pedido.id, pedido.inconsistente]),
    ).toEqual([
      ["S", true],
      ["F", true],
      ["D", true],
      ["OK", false],
    ]);
  });

  it("o mesmo arquivo em um bilhete por linha e em um pedido por linha dá as mesmas divergências", () => {
    const gravados = sistema([
      gravado("A", { qtd_bilhetes: 3, total_centavos: 6000 }),
      gravado("B", {
        qtd_bilhetes: 1,
        total_centavos: 2000,
        affiliate_id: 102,
      }),
    ]);
    const porPedido = analisarPorPedido(
      ler([
        CABECALHO,
        ["A", "Pago", "3", "1, 2, 3", "60,00", "101", "23/11/2026 10:00"],
        ["B", "Pago", "2", "4, 5", "40,00", "102", "23/11/2026 11:00"],
        ["C", "Pago", "1", "6", "20,00", "101", "23/11/2026 12:00"],
      ]),
      gravados,
      AGORA,
    );
    const porBilhete = analisarPorPedido(
      ler([
        CABECALHO,
        ["A", "Pago", "3", "1", "60,00", "101", "23/11/2026 10:00"],
        ["A", "Pago", "3", "2", "60,00", "101", "23/11/2026 10:00"],
        ["A", "Pago", "3", "3", "60,00", "101", "23/11/2026 10:00"],
        ["B", "Pago", "2", "4", "40,00", "102", "23/11/2026 11:00"],
        ["B", "Pago", "2", "5", "40,00", "102", "23/11/2026 11:00"],
        ["C", "Pago", "1", "6", "20,00", "101", "23/11/2026 12:00"],
      ]),
      gravados,
      AGORA,
    );
    expect(porBilhete.divergencias).toEqual(porPedido.divergencias);
    expect(porBilhete.resumo).toEqual(porPedido.resumo);
    expect(porBilhete.arquivo.um_bilhete_por_linha).toBe(true);
    expect(porPedido.arquivo.um_bilhete_por_linha).toBe(false);
    expect(porBilhete.avisos.map((aviso) => aviso.codigo)).toContain(
      "um_bilhete_por_linha",
    );
    const tipos = Object.fromEntries(
      porPedido.divergencias.map((grupo) => [
        grupo.tipo,
        grupo.itens.map((item) => item.pedido_id),
      ]),
    );
    expect(tipos).toMatchObject({
      venda_perdida: ["C"],
      quantidade_diferente: ["B"],
      valor_diferente: ["B"],
    });
  });

  it("quantidade diferente da lista de números: vale a quantidade, com aviso", () => {
    const resposta = analisarPorPedido(
      ler([CABECALHO, ["A", "Pago", "3", "1, 2", "60,00", "101", ""]]),
      sistema([gravado("A", { qtd_bilhetes: 3, total_centavos: 6000 })]),
      AGORA,
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

describe("afiliado do arquivo: número, rótulo cadastrado (sem acento e maiúsculas) ou não reconhecido", () => {
  it("rótulo igual dá o afiliado; rótulo repetido entre dois afiliados é ambíguo (não reconhecido)", () => {
    const resposta = analisarPorPedido(
      ler([
        ["Pedido", "Valor", "Afiliado"],
        ["A", "20", "@LIDER.BETEL"],
        ["B", "20", "repetido"],
        ["C", "20", "999"],
        ["D", "20", ""],
      ]),
      sistema(),
      AGORA,
    );
    const perdidas = resposta.divergencias.find(
      (grupo) => grupo.tipo === "venda_perdida",
    )!;
    expect(
      perdidas.itens.map((item) => [
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

describe("CA1: modo agregado (sem o código do pedido)", () => {
  it("compara por afiliado e por dia, só nos dias do arquivo, com os diferentes primeiro", () => {
    const gravados = sistema([
      gravado("X1", {
        affiliate_id: 101,
        aprovado_em: "2026-11-23T15:00:00.000Z",
      }),
      gravado("X2", {
        affiliate_id: 102,
        aprovado_em: "2026-11-24T15:00:00.000Z",
        qtd_bilhetes: 2,
        total_centavos: 4000,
      }),
      // Fora dos dias do arquivo, de outra campanha e não aprovado: não contam.
      gravado("X3", {
        affiliate_id: 101,
        aprovado_em: "2026-11-30T15:00:00.000Z",
      }),
      gravado("X4", { campanha_id: 2 }),
      gravado("X5", { status: "in_process", aprovado_em: null }),
    ]);
    const resposta = analisarAgregado(
      ler([
        ["Status", "Quantidade", "Valor", "Afiliado", "Data"],
        ["Pago", "1", "20,00", "101", "23/11/2026"],
        ["Pago", "3", "60,00", "102", "24/11/2026"],
        ["Pendente", "5", "100,00", "102", "24/11/2026"],
        ["Pago", "1", "20,00", "", "24/11/2026"],
      ]),
      gravados,
      AGORA,
    );
    expect(resposta.modo).toBe("agregado");
    expect(resposta.recorte).toEqual({
      data_inicio: "2026-11-23",
      data_fim: "2026-11-24",
    });
    expect(resposta.total).toEqual({
      arquivo: { pedidos_aprovados: 3, bilhetes: 5, total_centavos: 10000 },
      sistema: { pedidos_aprovados: 2, bilhetes: 3, total_centavos: 6000 },
      confere: false,
    });
    expect(resposta.por_afiliado).toEqual([
      {
        afiliado: "afiliado",
        affiliate_id: 102,
        celula: { id: 2, nome: "Célula Betel" },
        arquivo: { pedidos_aprovados: 1, bilhetes: 3, total_centavos: 6000 },
        sistema: { pedidos_aprovados: 1, bilhetes: 2, total_centavos: 4000 },
        confere: false,
      },
      {
        afiliado: "sem_afiliado",
        affiliate_id: null,
        celula: null,
        arquivo: { pedidos_aprovados: 1, bilhetes: 1, total_centavos: 2000 },
        sistema: { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 },
        confere: false,
      },
      {
        afiliado: "afiliado",
        affiliate_id: 101,
        celula: { id: 1, nome: "Célula Ágape" },
        arquivo: { pedidos_aprovados: 1, bilhetes: 1, total_centavos: 2000 },
        sistema: { pedidos_aprovados: 1, bilhetes: 1, total_centavos: 2000 },
        confere: true,
      },
    ]);
    expect(resposta.por_dia?.map((dia) => [dia.data, dia.confere])).toEqual([
      ["2026-11-23", true],
      ["2026-11-24", false],
    ]);
    expect(resposta.avisos.map((aviso) => aviso.codigo)).toEqual([
      "sem_coluna_pedido",
    ]);
  });

  it("um bilhete por linha sem o código: só os bilhetes são comparados (pedidos e valor ficam null)", () => {
    const resposta = analisarAgregado(
      ler([
        ["Status", "Quantidade de bilhetes", "Bilhetes", "Valor"],
        ["Pago", "2", "1", "40,00"],
        ["Pago", "2", "2", "40,00"],
        ["Pago", "1", "3", "20,00"],
      ]),
      sistema([
        gravado("A", { qtd_bilhetes: 2, total_centavos: 4000 }),
        gravado("B"),
      ]),
      AGORA,
    );
    expect(resposta.arquivo.um_bilhete_por_linha).toBe(true);
    expect(resposta.total).toEqual({
      arquivo: { pedidos_aprovados: null, bilhetes: 3, total_centavos: null },
      sistema: { pedidos_aprovados: 2, bilhetes: 3, total_centavos: 6000 },
      confere: true,
    });
    expect(resposta.por_afiliado).toBeNull();
    expect(resposta.por_dia).toBeNull();
    expect(resposta.avisos.map((aviso) => aviso.codigo)).toEqual(
      expect.arrayContaining([
        "um_bilhete_por_linha_sem_id",
        "sem_coluna_afiliado",
        "sem_coluna_data",
      ]),
    );
  });

  it("sem a coluna de status, todas as linhas contam como pagas (aviso)", () => {
    const resposta = analisarAgregado(
      ler([["Valor"], ["20,00"], ["30,00"]]),
      sistema([
        gravado("A", { total_centavos: 2000 }),
        gravado("B", { total_centavos: 3000 }),
      ]),
      AGORA,
    );
    expect(resposta.total.arquivo).toEqual({
      pedidos_aprovados: 2,
      bilhetes: null,
      total_centavos: 5000,
    });
    expect(resposta.total.confere).toBe(true);
    expect(resposta.avisos.map((aviso) => aviso.codigo)).toContain(
      "sem_coluna_status",
    );
  });
});

describe("CA2: plano do Recuperar", () => {
  const arquivo = () =>
    ler([
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
    ]);
  const plano = (codigos: string[]) =>
    planejarRecuperacao(
      arquivo(),
      { fuso: FUSO, afiliados: AFILIADOS, existentes: new Set(["P-EXISTE"]) },
      codigos,
      AGORA,
    );

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
    expect(gravar[0]).toMatchObject({
      qtd_bilhetes: 2,
      total_centavos: 4000,
      numeros: [1, 2],
    });
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
