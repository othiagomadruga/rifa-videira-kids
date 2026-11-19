// RIFA-074: o comprovante de Pix em PDF (um Pix por arquivo), lido pelo pdf.js de verdade com PDFs SINTÉTICOS
// (teste-apoio-pdf.ts): o do Bradesco, o de um banco digital e o de um banco com o valor na linha de baixo. Um teste
// por critério de aceite: o valor, a data e a hora, o nome e o identificador; o identificador igual ao número do
// pedido dá "Certo"; sem ele, o valor, a data e o nome; vários arquivos sem contar duas vezes o mesmo Pix; a foto pede
// o PDF; o Pix agendado é uma falha clara. Todos os dados são fictícios.
import { beforeAll, describe, expect, it } from "vitest";
import {
  extratoDoComprovante,
  lerComprovante,
  pareceComprovante,
} from "./comprovante";
import { cruzar, type PedidoDoCruzamento } from "./cruzamento";
import { pedidoDoCruzamento } from "./extrato-api";
import { juntarArquivos, mesmoPix } from "./juntar";
import {
  criarRelogio,
  filtrarPix,
  palavrasDoPix,
  PALAVRAS_PADRAO,
  type ExtratoLido,
} from "./lancamentos";
import {
  lerArquivoDoExtrato,
  lerExtrato,
  type LeituraDoExtrato,
} from "./leitura";
import {
  belem,
  CONTEXTO,
  PAGADORA_TRES,
  PAGADORA_UM,
  PAGADOR_DOIS,
  PEDIDOS_DO_CENARIO,
  TEXTO_LINHAS,
  TEXTO_TABELA,
} from "./teste-apoio";
import {
  COMPROVANTE_AGENDADO,
  COMPROVANTE_BRADESCO,
  COMPROVANTE_DIGITAL,
  COMPROVANTE_LINHA_DE_BAIXO,
  E2E_BRADESCO,
  E2E_ITAU,
  E2E_NUBANK,
  pdfDeComprovante,
  pdfDoBradesco,
  prepararPdfjsNosTestes,
  textoDoComprovante,
} from "./teste-apoio-pdf";
import { FALHAS_DO_COMPROVANTE } from "./textos";

beforeAll(prepararPdfjsNosTestes);

async function lerArquivo(
  conteudo: BlobPart,
  nome: string,
  tipo = "",
): Promise<LeituraDoExtrato> {
  const arquivo = await lerArquivoDoExtrato(
    new File([conteudo], nome, { type: tipo }),
  );
  if (!arquivo.ok) return arquivo;
  return lerExtrato(arquivo.entrada, CONTEXTO);
}

const lerPdf = (pdf: Uint8Array, nome = "comprovante.pdf") =>
  lerArquivo(pdf.slice(), nome);

function extratoDe(leitura: LeituraDoExtrato): ExtratoLido {
  if (!leitura.ok || leitura.tipo !== "lido")
    throw new Error(`Não leu: ${JSON.stringify(leitura)}`);
  return leitura.extrato;
}

const PEDIDOS = PEDIDOS_DO_CENARIO.map(pedidoDoCruzamento);

function cruzamento(
  extrato: ExtratoLido,
  pedidos: readonly PedidoDoCruzamento[] = PEDIDOS,
) {
  const { pix } = filtrarPix(
    extrato,
    palavrasDoPix(PALAVRAS_PADRAO),
    criarRelogio(CONTEXTO),
  );
  return cruzar(pix, pedidos, { janelaMs: 24 * 3_600_000 });
}

describe("o comprovante de Pix em PDF: o que sai dele", () => {
  it("Bradesco: valor, data e hora, quem pagou, o identificador e o ID da transação; a origem é o comprovante", async () => {
    const extrato = extratoDe(
      await lerPdf(pdfDeComprovante(COMPROVANTE_BRADESCO)),
    );
    expect(extrato.formato).toBe("comprovante");
    expect(extrato.lancamentos).toHaveLength(1);
    expect(extrato.lancamentos[0]).toMatchObject({
      centavos: 2000,
      dia: "2026-11-16",
      instante: Date.parse("2026-11-16T10:05:33-03:00"),
      origem: "comprovante",
      pagador: PAGADORA_UM,
      txid: "PEDTESTE0101",
      idDaTransacao: E2E_BRADESCO,
    });
    // O nome de quem recebeu (a igreja) não é o de quem pagou.
    expect(extrato.lancamentos[0].descricao).toBe(
      `Comprovante de Pix · ${PAGADORA_UM} · identificador PEDTESTE0101`,
    );
  });

  it("banco digital: a data no topo sem rótulo, Origem e Destino, sem identificador", async () => {
    const [lancamento] = extratoDe(
      await lerPdf(pdfDeComprovante(COMPROVANTE_DIGITAL)),
    ).lancamentos;
    expect(lancamento).toMatchObject({
      centavos: 4000,
      instante: Date.parse("2026-11-16T14:30:12-03:00"),
      pagador: PAGADOR_DOIS,
      idDaTransacao: E2E_NUBANK,
    });
    expect(lancamento.txid).toBeUndefined();
  });

  it("outro banco: o valor na linha de baixo do rótulo, “de” e “para”", async () => {
    const [lancamento] = extratoDe(
      await lerPdf(pdfDeComprovante(COMPROVANTE_LINHA_DE_BAIXO)),
    ).lancamentos;
    expect(lancamento).toMatchObject({
      centavos: 2000,
      instante: Date.parse("2026-11-16T16:45:00-03:00"),
      pagador: PAGADORA_TRES,
      txid: "PEDTESTE0105",
      idDaTransacao: E2E_ITAU,
    });
  });

  it("o extrato em PDF continua extrato (a tabela não é comprovante), e o comprovante não é extrato", () => {
    expect(pareceComprovante(TEXTO_TABELA)).toBe(false);
    expect(pareceComprovante(TEXTO_LINHAS)).toBe(false);
    expect(pareceComprovante(textoDoComprovante(COMPROVANTE_BRADESCO))).toBe(
      true,
    );
  });

  it("o Pix agendado é uma falha clara (ainda não foi pago)", async () => {
    expect(await lerPdf(pdfDeComprovante(COMPROVANTE_AGENDADO))).toEqual(
      FALHAS_DO_COMPROVANTE.agendado,
    );
  });

  it("sem o valor ou sem a data: diz o que faltou", () => {
    const semValor = COMPROVANTE_BRADESCO.filter(
      ([rotulo]) => rotulo !== "Valor",
    );
    expect(lerComprovante(textoDoComprovante(semValor), CONTEXTO)).toEqual(
      FALHAS_DO_COMPROVANTE.semValor,
    );
    const semData = COMPROVANTE_BRADESCO.filter(
      ([rotulo]) => rotulo !== "Data e hora" && rotulo !== "ID da transação",
    );
    expect(lerComprovante(textoDoComprovante(semData), CONTEXTO)).toEqual(
      FALHAS_DO_COMPROVANTE.semData,
    );
  });

  it("a foto ou o print do comprovante: pede o PDF (pelo tipo, pela extensão e pelo conteúdo)", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    expect(await lerArquivo(jpeg, "comprovante.jpg", "image/jpeg")).toEqual(
      FALHAS_DO_COMPROVANTE.imagem,
    );
    expect(await lerArquivo(jpeg, "Screenshot.PNG")).toEqual(
      FALHAS_DO_COMPROVANTE.imagem,
    );
    expect(await lerArquivo(jpeg, "sem-extensao")).toEqual(
      FALHAS_DO_COMPROVANTE.imagem,
    );
    expect(FALHAS_DO_COMPROVANTE.imagem.mensagem).toMatch(/PDF/);
  });
});

describe("o cruzamento do comprovante", () => {
  it("o identificador igual ao número do pedido: Certo", async () => {
    const resultado = cruzamento(
      extratoDe(await lerPdf(pdfDeComprovante(COMPROVANTE_BRADESCO))),
    );
    expect(resultado.paraMarcar).toHaveLength(1);
    expect(resultado.paraMarcar[0]).toMatchObject({
      grau: "certo",
      pedido: { id: "PEDTESTE0101" },
      valorDiferente: false,
    });
    expect(resultado.paraMarcar[0].pix.origem).toBe("comprovante");
  });

  it("o identificador vale inteiro, mesmo curto e só de algarismos (no extrato, precisaria de 8)", () => {
    const comprovante = lerComprovante(
      textoDoComprovante(
        COMPROVANTE_BRADESCO.map(([rotulo, valor]) =>
          rotulo === "Identificador" ? [rotulo, "12345"] : [rotulo, valor],
        ),
      ),
      CONTEXTO,
    );
    if ("ok" in comprovante) throw new Error(comprovante.titulo);
    const curto: PedidoDoCruzamento = {
      ...PEDIDOS[0],
      id: "12345",
      status: "in_process",
      total_centavos: 9900,
      reserva: Date.parse(belem("2026-11-01", "08:00")),
    };
    const resultado = cruzamento(extratoDoComprovante(comprovante), [curto]);
    expect(resultado.paraMarcar[0]).toMatchObject({
      grau: "certo",
      pedido: { id: "12345" },
      valorDiferente: true,
    });
  });

  it("sem o identificador: pelo valor, a data e a hora (Provável), como o extrato", async () => {
    const resultado = cruzamento(
      extratoDe(await lerPdf(pdfDeComprovante(COMPROVANTE_DIGITAL))),
    );
    expect(resultado.paraMarcar).toHaveLength(1);
    expect(resultado.paraMarcar[0]).toMatchObject({
      grau: "provavel",
      pedido: { id: "PEDTESTE0103" },
    });
  });

  it("o comprovante entra mesmo sem as palavras do Pix (ele é sempre um Pix)", async () => {
    const extrato = extratoDe(
      await lerPdf(pdfDeComprovante(COMPROVANTE_DIGITAL)),
    );
    const { pix } = filtrarPix(extrato, ["TED"], criarRelogio(CONTEXTO));
    expect(pix).toHaveLength(1);
  });
});

describe("vários arquivos de uma vez", () => {
  it("extrato e comprovantes misturados: o mesmo Pix conta uma vez, e o identificador do comprovante dá o Certo", async () => {
    const extrato = extratoDe(await lerPdf(pdfDoBradesco(), "extrato.pdf"));
    const bradesco = extratoDe(
      await lerPdf(pdfDeComprovante(COMPROVANTE_BRADESCO)),
    );
    const digital = extratoDe(
      await lerPdf(pdfDeComprovante(COMPROVANTE_DIGITAL)),
    );
    const juntado = juntarArquivos([
      { extrato },
      { extrato: bradesco },
      { extrato: digital },
    ]);
    // Os dois comprovantes estão no extrato (o de R$ 20,00 da Pagadora Um e o de R$ 40,00 do Pagador Dois).
    expect(juntado.repetidos).toEqual([0, 1, 1]);
    expect(juntado.extrato.formato).toBe("varios");
    expect(juntado.extrato.lancamentos).toHaveLength(
      extrato.lancamentos.length,
    );
    expect(juntado.extrato.lancamentos.map((item) => item.ordem)).toEqual(
      extrato.lancamentos.map((_, indice) => indice + 1),
    );
    // Sozinho, o extrato deixava o Pix da Pagadora Um ambíguo; com o comprovante, é Certo, e fica o lançamento do
    // extrato (o banco confirma: sem a marca de "só no comprovante").
    expect(cruzamento(extrato).ambiguos).toHaveLength(1);
    const resultado = cruzamento(juntado.extrato);
    expect(resultado.ambiguos).toEqual([]);
    const certo = resultado.paraMarcar.find(
      (casado) => casado.pedido.id === "PEDTESTE0101",
    );
    expect(certo).toMatchObject({ grau: "certo" });
    expect(certo?.pix.origem).toBeUndefined();
    expect(certo?.pix.descricao).toContain(`REM: ${PAGADORA_UM}`);
  });

  it("o mesmo comprovante duas vezes (ou com o mesmo ID da transação) conta uma vez", async () => {
    const bradesco = extratoDe(
      await lerPdf(pdfDeComprovante(COMPROVANTE_BRADESCO)),
    );
    const juntado = juntarArquivos([
      { extrato: bradesco },
      { extrato: bradesco },
    ]);
    expect(juntado.repetidos).toEqual([0, 1]);
    expect(juntado.extrato.lancamentos).toHaveLength(1);
    expect(cruzamento(juntado.extrato).paraMarcar).toHaveLength(1);
  });

  it("o mesmo valor, data e nome sem o ID: o mesmo Pix; outro nome, outro ID ou outra hora: outro Pix", () => {
    const [base] = extratoDoComprovante({
      centavos: 2000,
      dia: "2026-11-16",
      instante: Date.parse("2026-11-16T10:05:00-03:00"),
      pagador: PAGADORA_UM,
      idDaTransacao: null,
      txid: null,
      mensagens: [],
    }).lancamentos;
    expect(mesmoPix(base, { ...base, instante: base.instante! + 60_000 })).toBe(
      true,
    );
    expect(mesmoPix(base, { ...base, pagador: PAGADOR_DOIS })).toBe(false);
    expect(mesmoPix(base, { ...base, centavos: 2001 })).toBe(false);
    expect(
      mesmoPix(base, { ...base, instante: base.instante! + 10 * 60_000 }),
    ).toBe(false);
    expect(
      mesmoPix(
        { ...base, idDaTransacao: E2E_BRADESCO },
        { ...base, idDaTransacao: E2E_NUBANK },
      ),
    ).toBe(false);
    // Os Pix de um mesmo arquivo nunca se juntam: dois lançamentos iguais no extrato são dois Pix.
    const dobrado: ExtratoLido = {
      ok: true,
      formato: "texto",
      lancamentos: [
        { ...base, origem: undefined, ordem: 1, descricao: "PIX RECEBIDO" },
        { ...base, origem: undefined, ordem: 2, descricao: "PIX RECEBIDO" },
      ],
      ilegiveis: 0,
      semHora: false,
    };
    expect(
      juntarArquivos([{ extrato: dobrado }]).extrato.lancamentos,
    ).toHaveLength(2);
  });

  it("dois extratos com períodos que se cruzam: as linhas iguais contam uma vez", () => {
    const primeiro = extratoDe(
      lerExtrato({ tipo: "texto", texto: TEXTO_LINHAS }, CONTEXTO),
    );
    const juntado = juntarArquivos([
      { extrato: primeiro },
      { extrato: primeiro },
    ]);
    expect(juntado.extrato.lancamentos).toHaveLength(
      primeiro.lancamentos.length,
    );
    expect(juntado.repetidos[1]).toBe(primeiro.lancamentos.length);
  });
});
