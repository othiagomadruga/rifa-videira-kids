// CA5 (RIFA-046, D24 item 7): o gerador de QR code (`qr`) só entra em pedaços carregados com `lazy`. Este teste
// segue os imports ESTÁTICOS do site a partir de main.tsx (os `import()` dinâmicos são os pontos de corte do
// pacote; o seguidor está em test/pacotes.ts, dividido com o teste do PDF da RIFA-068) e confere que nem o `qr` nem o
// módulo que o usa ficam no pacote inicial. O tamanho de verdade se confere no `npm run build` (relatório da tarefa).
import { describe, expect, it } from "vitest";
import {
  FONTES,
  RAIZ,
  importsEstaticos,
  pacoteInicial,
} from "../../test/pacotes";

describe("CA5: o `qr` só em pedaços lazy", () => {
  it("o pacote inicial é seguido até as telas (o teste enxerga os imports)", () => {
    const { arquivos, pacotes } = pacoteInicial();
    expect(arquivos.size).toBeGreaterThan(80);
    for (const arquivo of [
      `${RAIZ}rotas.tsx`,
      `${RAIZ}pages/adesao/AdesaoPage.tsx`,
      `${RAIZ}pages/minha/MinhaPage.tsx`,
      `${RAIZ}components/ui/index.ts`,
    ])
      expect(arquivos, arquivo).toContain(arquivo);
    expect(pacotes).toContain("react");
  });

  it("nem o `qr` nem os módulos do QR code entram no pacote inicial", () => {
    const { arquivos, pacotes } = pacoteInicial();
    expect([...pacotes].filter((nome) => /^qr(\/|$)/.test(nome))).toEqual([]);
    for (const arquivo of [
      `${RAIZ}components/qr/qr-matriz.ts`,
      `${RAIZ}components/qr/QrCodeLinkVendas.tsx`,
      `${RAIZ}pages/adesao/LinksDeVendas.tsx`,
      `${RAIZ}pages/minha/LinksDeVendas.tsx`,
    ])
      expect(arquivos, arquivo).not.toContain(arquivo);
  });

  it("o `qr` é importado só por components/qr/qr-matriz.ts", () => {
    const quem = Object.entries(FONTES)
      .filter(([, fonte]) =>
        importsEstaticos(fonte).some((nome) => /^qr(\/|$)/.test(nome)),
      )
      .map(([arquivo]) => arquivo);
    expect(quem).toEqual([`${RAIZ}components/qr/qr-matriz.ts`]);
  });

  it("o QR code chega pelos `import()` da Adesão e do QrCodeLazy (usado na /minha e no Ver QR)", () => {
    expect(FONTES[`${RAIZ}pages/adesao/AdesaoPage.tsx`]).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/LinksDeVendas"\)/,
    );
    expect(FONTES[`${RAIZ}components/qr/QrCodeLazy.tsx`]).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/QrCodeLinkVendas"\)/,
    );
  });

  it("nenhum módulo do link de vendas escreve HTML cru (o link nunca vira marcação)", () => {
    const doLinkDeVendas = Object.entries(FONTES).filter(([arquivo]) =>
      /components\/qr\/|LinksDeVendas|ModeloLinkVendas|links-vendas/.test(
        arquivo,
      ),
    );
    expect(doLinkDeVendas.length).toBeGreaterThanOrEqual(10);
    for (const [arquivo, fonte] of doLinkDeVendas)
      expect(fonte, arquivo).not.toMatch(
        /dangerouslySetInnerHTML|\.innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
      );
  });
});
