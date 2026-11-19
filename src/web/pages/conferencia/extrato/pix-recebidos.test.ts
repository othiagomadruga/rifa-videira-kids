// RIFA-077: o relatório "Pix recebidos" do Bradesco em PDF (blocos verticais: a data em duas linhas, o nome e o banco
// quebrados em várias linhas, o E2E, o horário e o valor na linha do meio), lido pelo pdf.js de verdade a partir de um
// PDF SINTÉTICO com o layout do PDF real (teste-apoio-pdf.ts; nomes e E2E fictícios).
import { beforeAll, describe, expect, it } from "vitest";
import { cruzar } from "./cruzamento";
import { pedidoDoCruzamento } from "./extrato-api";
import {
  criarRelogio,
  filtrarPix,
  PALAVRAS_PADRAO,
  palavrasDoPix,
  type ExtratoLido,
} from "./lancamentos";
import { lerArquivoDoExtrato, lerExtrato } from "./leitura";
import { lerTextoDoPdf } from "./pdf";
import {
  CABECALHO_PIX_RECEBIDOS,
  lerPixRecebidos,
  MARCA_PIX_RECEBIDOS,
  separarBanco,
} from "./pix-recebidos";
import { belem, CONTEXTO, itemPedido } from "./teste-apoio";
import {
  E2E_PIX_DOIS,
  E2E_PIX_TRES,
  E2E_PIX_UM,
  PAGADORES_PIX_RECEBIDOS,
  pdfDePixRecebidos,
  pdfDoBradesco,
  prepararPdfjsNosTestes,
} from "./teste-apoio-pdf";
import { FALHAS_DO_PDF } from "./textos";

beforeAll(prepararPdfjsNosTestes);

async function lerPdf(pdf: Uint8Array): Promise<ExtratoLido> {
  const arquivo = await lerArquivoDoExtrato(
    new File([pdf.slice()], "pix-recebidos.pdf"),
  );
  if (!arquivo.ok) throw new Error(arquivo.titulo);
  const lido = lerExtrato(arquivo.entrada, CONTEXTO);
  if (!lido.ok || lido.tipo !== "lido")
    throw new Error(`Não leu: ${JSON.stringify(lido)}`);
  return lido.extrato;
}

const instante = (data: string, hora: string) => Date.parse(belem(data, hora));

describe("o relatório Pix recebidos do Bradesco em PDF", () => {
  it("um lançamento por bloco: data (o ano pelo E2E), horário, valor, pagador sem o banco, banco e E2E", async () => {
    const extrato = await lerPdf(pdfDePixRecebidos());
    expect(extrato.formato).toBe("pdf");
    expect(extrato.ilegiveis).toBe(0);
    expect(extrato.semHora).toBe(false);
    expect(extrato.lancamentos).toEqual([
      {
        ordem: 1,
        dia: "2026-11-19",
        instante: Date.parse("2026-11-19T11:12:04-03:00"),
        centavos: 2500,
        descricao: `Pix recebido · ${PAGADORES_PIX_RECEBIDOS[0]}`,
        identificadores: [],
        pix: true,
        pagador: PAGADORES_PIX_RECEBIDOS[0],
        banco: "ITAÚ UNIBANCO S.A.",
        idDaTransacao: E2E_PIX_UM,
      },
      {
        ordem: 2,
        dia: "2026-11-18",
        instante: Date.parse("2026-11-18T14:41:43-03:00"),
        centavos: -286328,
        descricao: `Pix (saída) · ${PAGADORES_PIX_RECEBIDOS[1]}`,
        identificadores: [],
        pix: true,
        pagador: PAGADORES_PIX_RECEBIDOS[1],
        banco: "Banco Bradesco S.A.",
        idDaTransacao: E2E_PIX_DOIS,
      },
      {
        // Sem a data no bloco: a do lançamento de cima (o primeiro do dia).
        ordem: 3,
        dia: "2026-11-18",
        instante: Date.parse("2026-11-18T11:03:38-03:00"),
        centavos: 81326,
        descricao: `Pix recebido · ${PAGADORES_PIX_RECEBIDOS[2]}`,
        identificadores: [],
        pix: true,
        pagador: PAGADORES_PIX_RECEBIDOS[2],
        banco: "NU PAGAMENTOS - IP",
        idDaTransacao: E2E_PIX_TRES,
      },
    ]);
  });

  it("são Pix sem as palavras do Pix na linha; a saída fica de fora como débito", async () => {
    const extrato = await lerPdf(pdfDePixRecebidos());
    const { pix, ignorados } = filtrarPix(
      extrato,
      palavrasDoPix(PALAVRAS_PADRAO),
      criarRelogio(CONTEXTO),
    );
    expect(pix.map((item) => item.centavos)).toEqual([2500, 81326]);
    expect(ignorados).toEqual({
      debitos: 1,
      semPalavra: 0,
      saldos: 0,
      ilegiveis: 0,
    });
    // Mesmo com outras palavras configuradas.
    expect(
      filtrarPix(extrato, ["DEPOSITO"], criarRelogio(CONTEXTO)).pix,
    ).toHaveLength(2);
  });

  it("o Pix de R$ 25,00 às 11:12:04 casa com o pedido de R$ 25 reservado 1 minuto antes (Provável)", async () => {
    const extrato = await lerPdf(pdfDePixRecebidos());
    const { pix } = filtrarPix(
      extrato,
      palavrasDoPix(PALAVRAS_PADRAO),
      criarRelogio(CONTEXTO),
    );
    const pedidos = [
      itemPedido("PEDTESTE0777", {
        total_centavos: 2500,
        reserva: new Date(
          Date.parse("2026-11-19T11:11:04-03:00"),
        ).toISOString(),
      }),
      // Outro valor e reservado depois do Pix: não serve.
      itemPedido("PEDTESTE0778", {
        total_centavos: 2500,
        reserva: belem("2026-11-19", "12:30"),
      }),
    ].map(pedidoDoCruzamento);
    const resultado = cruzar(pix, pedidos, { janelaMs: 24 * 3_600_000 });
    expect(resultado.paraMarcar).toHaveLength(1);
    expect(resultado.paraMarcar[0]).toMatchObject({
      grau: "provavel",
      valorDiferente: false,
      pedido: { id: "PEDTESTE0777" },
      pix: { centavos: 2500, idDaTransacao: E2E_PIX_UM },
    });
    expect(resultado.paraMarcar[0].pix.instante).toBe(
      instante("2026-11-19", "11:12") + 4_000,
    );
    // O Pix de R$ 813,26 não tem pedido.
    expect(resultado.semPedido.map((item) => item.pix.centavos)).toEqual([
      81326,
    ]);
  });

  it("as linhas do PDF saem no texto canônico (o cabeçalho e uma linha por bloco)", async () => {
    const lido = await lerTextoDoPdf(pdfDePixRecebidos().slice().buffer);
    if (!lido.ok) throw new Error(lido.titulo);
    const linhas = lido.texto.split("\n");
    expect(linhas.slice(0, 2)).toEqual([
      MARCA_PIX_RECEBIDOS,
      CABECALHO_PIX_RECEBIDOS,
    ]);
    expect(linhas[2]).toBe(
      [
        "19/11/2026",
        "11:12:04",
        PAGADORES_PIX_RECEBIDOS[0],
        "ITAÚ UNIBANCO S.A.",
        E2E_PIX_UM,
        "25,00",
        "",
      ].join("\t"),
    );
    expect(linhas).toHaveLength(5);
  });

  it("o extrato do Bradesco (a tabela de sempre) continua no leitor de antes", async () => {
    const lido = await lerTextoDoPdf(pdfDoBradesco().slice().buffer);
    if (!lido.ok) throw new Error(lido.titulo);
    expect(lido.texto.startsWith(MARCA_PIX_RECEBIDOS)).toBe(false);
  });

  it("o relatório sem nenhum bloco é a falha do PDF sem lançamentos", async () => {
    const arquivo = await lerArquivoDoExtrato(
      new File([pdfDePixRecebidos([]).slice()], "vazio.pdf"),
    );
    if (!arquivo.ok) throw new Error(arquivo.titulo);
    expect(lerExtrato(arquivo.entrada, CONTEXTO)).toBe(
      FALHAS_DO_PDF.semLancamentos,
    );
  });

  it("sem o E2E, o ano é o corrente; a linha sem valor conta como ilegível", () => {
    const texto = [
      MARCA_PIX_RECEBIDOS,
      CABECALHO_PIX_RECEBIDOS,
      ["17/11", "09:30:00", "Fulano Ficticio", "", "", "10,00", ""].join("\t"),
      ["17/11", "09:31:00", "Fulano Ficticio", "", "", "", ""].join("\t"),
    ].join("\n");
    const lido = lerPixRecebidos(texto, CONTEXTO);
    if (!lido.ok) throw new Error(lido.titulo);
    expect(lido.ilegiveis).toBe(1);
    expect(lido.lancamentos).toHaveLength(1);
    expect(lido.lancamentos[0]).toMatchObject({
      dia: "2026-11-17",
      centavos: 1000,
      pagador: "Fulano Ficticio",
    });
    expect(lido.lancamentos[0].idDaTransacao).toBeUndefined();
    expect(lido.lancamentos[0].banco).toBeUndefined();
  });
});

describe("o nome e o banco da Referência", () => {
  const linhas = (...textos: [string, number][]) =>
    textos.map(([texto, y]) => ({ texto, y }));

  it("pela primeira linha que começa com o nome de um banco", () => {
    expect(
      separarBanco(
        linhas(["Fulana", 100], ["Ficticia", 86.2], ["Banco Inter", 71.3]),
      ),
    ).toEqual({ nome: "Fulana Ficticia", banco: "Banco Inter" });
  });

  it("um banco desconhecido: pelo vão maior (outro parágrafo) com a forma de empresa no fim", () => {
    expect(
      separarBanco(
        linhas(
          ["Fulana", 100],
          ["Ficticia", 86.2],
          ["Fintech Imaginaria", 71.3],
          ["S.A.", 57.9],
        ),
      ),
    ).toEqual({ nome: "Fulana Ficticia", banco: "Fintech Imaginaria S.A." });
  });

  it("sem banco: tudo é o nome", () => {
    expect(separarBanco(linhas(["Fulana", 100], ["Ficticia", 86.2]))).toEqual({
      nome: "Fulana Ficticia",
      banco: "",
    });
  });
});
