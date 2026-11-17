// RIFA-068: o pdf.js (`pdfjs-dist`) só chega quando a pessoa escolhe um PDF. Seguindo os imports ESTÁTICOS (os
// `import()` são os pontos de corte do pacote; test/pacotes.ts), nem o pacote inicial do site nem o pacote da seção do
// extrato levam o pdf.js ou o leitor de PDF: ele vem pelo `import("./pdf")` de leitura.ts. E o worker do pdf.js é um
// arquivo do próprio site (a URL resolvida pelo Vite, `?url`), para a CSP de produção (`default-src 'self'`) deixar.
// O tamanho de verdade se confere no `npm run build` (relatório da tarefa).
import { describe, expect, it } from "vitest";
import {
  FONTES,
  RAIZ,
  importsEstaticos,
  pacoteDe,
  pacoteInicial,
} from "../../../test/pacotes";

const PASTA = `${RAIZ}pages/conferencia/extrato/`;
const ehPdfjs = (nome: string) => /^pdfjs-dist(\/|$)/.test(nome);

describe("o pdf.js só sob demanda", () => {
  it("o seguidor enxerga a seção do extrato (pela ConferenciaPeloCsv) e o leitor de PDF", () => {
    expect(FONTES).toHaveProperty([`${PASTA}pdf.ts`]);
    const { arquivos } = pacoteDe(`${PASTA}ExtratoDoBanco.tsx`);
    for (const arquivo of [
      `${PASTA}leitura.ts`,
      `${PASTA}texto-colado.ts`,
      `${PASTA}textos.ts`,
    ])
      expect(arquivos, arquivo).toContain(arquivo);
  });

  it("nem o pacote inicial nem o da seção do extrato levam o pdf.js ou o leitor de PDF", () => {
    for (const pacote of [
      pacoteInicial(),
      pacoteDe(`${PASTA}ExtratoDoBanco.tsx`),
    ]) {
      expect([...pacote.pacotes].filter(ehPdfjs)).toEqual([]);
      for (const arquivo of [`${PASTA}pdf.ts`, `${PASTA}pdf-linhas.ts`])
        expect(pacote.arquivos, arquivo).not.toContain(arquivo);
    }
    // O pacote inicial não leva nem a seção do extrato (ela vem pelo lazy da Conferência, RIFA-059).
    expect(pacoteInicial().arquivos).not.toContain(
      `${PASTA}ExtratoDoBanco.tsx`,
    );
  });

  it("o `pdfjs-dist` é importado só por extrato/pdf.ts, que chega pelo import() de leitura.ts", () => {
    const quem = Object.entries(FONTES)
      .filter(([, fonte]) => importsEstaticos(fonte).some(ehPdfjs))
      .map(([arquivo]) => arquivo);
    expect(quem).toEqual([`${PASTA}pdf.ts`]);
    const quemImportaOLeitor = Object.entries(FONTES)
      .filter(([, fonte]) =>
        importsEstaticos(fonte).some((nome) => /^\.\/pdf$/.test(nome)),
      )
      .map(([arquivo]) => arquivo);
    expect(quemImportaOLeitor).toEqual([]);
    expect(FONTES[`${PASTA}leitura.ts`]).toMatch(/await import\("\.\/pdf"\)/);
  });

  it("o worker do pdf.js vem do próprio site (o arquivo no build, a URL pelo Vite) e sem WebAssembly", () => {
    const leitor = FONTES[`${PASTA}pdf.ts`];
    expect(leitor).toMatch(
      /import enderecoDoWorker from "pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs\?url";/,
    );
    expect(leitor).toMatch(
      /GlobalWorkerOptions\.workerSrc = enderecoDoWorker;/,
    );
    expect(leitor).toMatch(/useWasm: false/);
    expect(leitor).toMatch(/disableWorkerRendering: true/);
    // Nenhum endereço de fora (fontes, cMaps, WebAssembly): nada é buscado pela rede.
    expect(leitor).not.toMatch(/cMapUrl|standardFontDataUrl|wasmUrl|https?:/);
  });
});
