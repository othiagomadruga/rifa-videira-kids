// RIFA-068: o extrato em PDF lido pelo pdf.js de verdade (nos testes, o worker roda na mesma linha de execução), com
// PDFs SINTÉTICOS (teste-apoio-pdf.ts): o do Bradesco dá o mesmo resultado que a tabela colada, o PDF sem tabela dá o
// mesmo que as linhas coladas, e o PDF-imagem, o PDF com senha, o arquivo quebrado e o PDF sem lançamentos dão falhas
// claras. Também o caminho de leitura.ts (o import() do leitor e a descoberta do PDF pelo conteúdo).
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
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
import {
  lerArquivoDoExtrato,
  lerExtrato,
  type LeituraDoExtrato,
} from "./leitura";
import { lerTextoDoPdf } from "./pdf";
import {
  CONTEXTO,
  PAGADORA_TRES,
  PAGADORA_UM,
  PEDIDOS_DO_CENARIO,
  TEXTO_LINHAS,
} from "./teste-apoio";
import {
  BRADESCO_PAGINA_1,
  CABECALHO_DO_BRADESCO,
  criarPdfDeImagem,
  pdfComSenha,
  pdfDeLinhas,
  pdfDoBradesco,
  pdfSemLancamentos,
  prepararPdfjsNosTestes,
  SENHA_DO_PDF,
  TEXTO_DO_BRADESCO,
} from "./teste-apoio-pdf";
import { FALHAS_DO_PDF } from "./textos";

beforeAll(prepararPdfjsNosTestes);

const bytes = (pdf: Uint8Array) => pdf.slice().buffer;

/** O PDF escolhido, pelo mesmo caminho da tela: lerArquivoDoExtrato e lerExtrato. */
async function lerPdf(
  pdf: Uint8Array,
  nome = "extrato.pdf",
): Promise<LeituraDoExtrato> {
  const arquivo = await lerArquivoDoExtrato(new File([pdf.slice()], nome));
  if (!arquivo.ok) return arquivo;
  return lerExtrato(arquivo.entrada, CONTEXTO);
}

function extratoDe(leitura: LeituraDoExtrato): ExtratoLido {
  if (!leitura.ok || leitura.tipo !== "lido")
    throw new Error(`Não leu: ${JSON.stringify(leitura)}`);
  return leitura.extrato;
}

/** O cruzamento do extrato com os pedidos do cenário (a janela padrão). */
function cruzamento(extrato: ExtratoLido) {
  const filtrado = filtrarPix(
    extrato,
    palavrasDoPix(PALAVRAS_PADRAO),
    criarRelogio(CONTEXTO),
  );
  return {
    ignorados: filtrado.ignorados,
    resultado: cruzar(
      filtrado.pix,
      PEDIDOS_DO_CENARIO.map(pedidoDoCruzamento),
      { janelaMs: 24 * 3_600_000 },
    ),
  };
}

describe("o extrato do Bradesco em PDF", () => {
  it("as linhas: o cabeçalho e cada linha nas colunas dele (as vazias no lugar), o título e o rodapé fora", async () => {
    const lido = await lerTextoDoPdf(bytes(pdfDoBradesco()));
    if (!lido.ok) throw new Error(lido.titulo);
    const linhas = lido.texto.split("\n");
    // Cada linha da tabela sai como a tabela copiada da tela (tabulações), nas duas páginas.
    for (const linha of TEXTO_DO_BRADESCO.split("\n"))
      expect(linhas).toContain(linha);
    expect(
      linhas.filter((linha) => linha === CABECALHO_DO_BRADESCO.join("\t")),
    ).toHaveLength(2);
    // O título vem antes do cabeçalho, como texto; o débito sem sinal fica na coluna Débito.
    expect(linhas[0]).toBe("Bradesco Net Empresa");
    expect(linhas).toContain("Período: 16/11/2026 a 17/11/2026");
    expect(linhas).toContain(
      "\tTRANSF CC PARA CC PJ\t0000123\t\t100,00\t945,00",
    );
    // O rodapé, longe da tabela, vem depois de uma linha em branco (não entra na descrição do último lançamento).
    const rodape = linhas.findIndex((linha) =>
      linha.includes("Os dados acima"),
    );
    expect(linhas[rodape - 1]).toBe("");
  });

  it("lido e cruzado: o mesmo resultado da tabela colada (lançamentos, o que ficou de fora e os grupos)", async () => {
    const doPdf = extratoDe(await lerPdf(pdfDoBradesco()));
    const colado = extratoDe(
      lerExtrato({ tipo: "texto", texto: TEXTO_DO_BRADESCO }, CONTEXTO),
    );
    expect(doPdf.formato).toBe("pdf");
    expect(colado.formato).toBe("texto");
    expect(doPdf.lancamentos).toEqual(colado.lancamentos);
    expect(doPdf.ilegiveis).toBe(colado.ilegiveis);
    expect(doPdf.semHora).toBe(true);
    expect(cruzamento(doPdf)).toEqual(cruzamento(colado));

    // O que o cruzamento diz (o extrato do Bradesco não traz a hora: a comparação é pelo dia).
    const { ignorados, resultado } = cruzamento(doPdf);
    expect(ignorados).toMatchObject({ debitos: 3, semPalavra: 0 });
    expect(resultado.paraMarcar.map((casado) => casado.pedido.id)).toEqual([
      "PEDTESTE0103",
    ]);
    expect(resultado.paraMarcar[0].pix.descricao).toBe(
      "TRANSFERENCIA PIX 1400202 · REM: Pagador Ficticio Dois 16/11",
    );
    expect(resultado.ambiguos).toHaveLength(1);
    expect(resultado.ambiguos[0].pix.descricao).toContain(PAGADORA_UM);
    expect(resultado.jaContados.map((casado) => casado.pix.descricao)).toEqual([
      `TRANSFERENCIA PIX 1400300 · REM: ${PAGADORA_TRES} 17/11`,
    ]);
    expect(resultado.semPedido).toEqual([]);
  });

  it("os débitos sem sinal ficam de fora pela coluna (a transferência sem DES: não vira Pix)", async () => {
    const doPdf = extratoDe(await lerPdf(pdfDoBradesco()));
    expect(
      doPdf.lancamentos
        .filter((lancamento) => lancamento.centavos < 0)
        .map((lancamento) => lancamento.centavos),
    ).toEqual([-1500, -10000, -5000]);
    // A data da primeira linha do dia (a do saldo anterior, sem valor) vale para as de baixo.
    expect(
      new Set(
        doPdf.lancamentos
          .filter((lancamento) => lancamento.ordem <= 5)
          .map((lancamento) => lancamento.dia),
      ),
    ).toEqual(new Set(["2026-11-16"]));
    expect(doPdf.lancamentos).toHaveLength(
      BRADESCO_PAGINA_1.filter((linha) => linha[3] || linha[4]).length + 1,
    );
  });

  it("o PDF sem tabela (uma linha por lançamento): o mesmo das linhas coladas", async () => {
    const doPdf = extratoDe(await lerPdf(pdfDeLinhas()));
    const colado = extratoDe(
      lerExtrato({ tipo: "texto", texto: TEXTO_LINHAS }, CONTEXTO),
    );
    expect(doPdf.lancamentos).toEqual(colado.lancamentos);
    expect(cruzamento(doPdf)).toEqual(cruzamento(colado));
    expect(doPdf.semHora).toBe(false);
  });

  it("o PDF é reconhecido pelo conteúdo, mesmo sem a extensão", async () => {
    const doPdf = extratoDe(await lerPdf(pdfDoBradesco(), "extrato"));
    expect(doPdf.formato).toBe("pdf");
  });
});

describe("as falhas do PDF", () => {
  it("o PDF só com imagem (escaneado): diz que é uma imagem e o outro jeito", async () => {
    expect(await lerTextoDoPdf(bytes(criarPdfDeImagem()))).toEqual(
      FALHAS_DO_PDF.imagem,
    );
    expect(await lerPdf(criarPdfDeImagem())).toEqual(FALHAS_DO_PDF.imagem);
    expect(FALHAS_DO_PDF.imagem.mensagem).toMatch(
      /baixe o extrato em OFX ou copie a tabela/,
    );
  });

  it("o PDF com senha: diz que tem senha (e a fixture é um PDF cifrado de verdade)", async () => {
    expect(await lerPdf(pdfComSenha())).toEqual(FALHAS_DO_PDF.senha);
    // Com a senha, o pdf.js lê a linha fictícia: o arquivo é cifrado, não só marcado.
    const tarefa = getDocument({
      data: pdfComSenha(),
      password: SENHA_DO_PDF,
      useWasm: false,
      useSystemFonts: true,
    });
    const documento = await tarefa.promise;
    const pagina = await documento.getPage(1);
    const texto = (await pagina.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    expect(texto).toContain(`REM: ${PAGADORA_UM}`);
    await tarefa.destroy();
  });

  it("o arquivo quebrado e o PDF sem lançamentos", async () => {
    const quebrado = new TextEncoder().encode("%PDF-1.4\nnada aqui\n%%EOF\n");
    expect(await lerPdf(quebrado)).toEqual(FALHAS_DO_PDF.invalido);
    expect(await lerPdf(pdfSemLancamentos())).toEqual(
      FALHAS_DO_PDF.semLancamentos,
    );
  });
});
