// CA5 (RIFA-046, D24 item 7): o gerador de QR code (`qr`) só entra em pedaços carregados com `lazy`. Este teste
// segue os imports ESTÁTICOS do site a partir de main.tsx (os `import()` dinâmicos são os pontos de corte do
// pacote) e confere que nem o `qr` nem o módulo que o usa ficam no pacote inicial. O tamanho de verdade se confere
// no `npm run build` (relatório da tarefa).
import { describe, expect, it } from "vitest";

const RAIZ = "/src/web/";

/** O código do site (sem os testes e o apoio deles), pelo caminho a partir de src/web. */
const FONTES = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(
      [
        "../../**/*.{ts,tsx}",
        "!../../**/*.test.{ts,tsx}",
        "!../../test/**",
        "!../../**/teste-apoio*.ts",
      ],
      { query: "?raw", import: "default", eager: true },
    ),
  ).map(([arquivo, fonte]) => [
    new URL(arquivo, `file://${RAIZ}components/qr/`).pathname,
    fonte,
  ]),
);

/** O arquivo de um import relativo (com a extensão ou o index que o Vite acharia). */
function resolver(base: string, especificador: string): string | null {
  const caminho = new URL(especificador, `file://${base}`).pathname;
  for (const candidato of [
    caminho,
    `${caminho}.ts`,
    `${caminho}.tsx`,
    `${caminho}/index.ts`,
    `${caminho}/index.tsx`,
  ])
    if (candidato in FONTES) return candidato;
  return null;
}

/** Os imports estáticos que levam código (sem `import type`, sem CSS e sem os `import()` dinâmicos). */
function importsEstaticos(fonte: string): string[] {
  const achados: string[] = [];
  for (const [trecho, especificador] of fonte.matchAll(
    /^\s*(?:import|export)\b(?!\s+type\b)[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  ))
    if (!/^\s*export\s+type\b/.test(trecho)) achados.push(especificador);
  for (const [, especificador] of fonte.matchAll(
    /^\s*import\s*["']([^"']+)["']/gm,
  ))
    achados.push(especificador);
  return achados.filter((especificador) => !especificador.endsWith(".css"));
}

/** Tudo o que main.tsx carrega sem `import()`: o pacote inicial (do site; os pacotes do npm pelo nome). */
function pacoteInicial(): { arquivos: Set<string>; pacotes: Set<string> } {
  const arquivos = new Set<string>();
  const pacotes = new Set<string>();
  const fila = [`${RAIZ}main.tsx`];
  while (fila.length > 0) {
    const arquivo = fila.pop() as string;
    if (arquivos.has(arquivo)) continue;
    arquivos.add(arquivo);
    for (const especificador of importsEstaticos(FONTES[arquivo] ?? "")) {
      if (!especificador.startsWith(".")) {
        pacotes.add(especificador);
        continue;
      }
      const destino = resolver(arquivo, especificador);
      if (destino?.startsWith(RAIZ)) fila.push(destino);
    }
  }
  return { arquivos, pacotes };
}

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
