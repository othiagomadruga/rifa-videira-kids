// Os pacotes do site vistos pelos imports (RIFA-046 e RIFA-068): segue os imports ESTÁTICOS a partir de um arquivo (os
// `import()` dinâmicos são os pontos de corte do pacote, como o Vite faz) e diz quais arquivos do site e quais pacotes
// do npm entram junto. Usado pelos testes de que uma dependência pesada só chega por `lazy` ou `import()`
// (components/qr/qr-lazy.test.ts e pages/conferencia/extrato/pdf-lazy.test.ts). O tamanho de verdade se confere no
// `npm run build` (relatório da tarefa).

export const RAIZ = "/src/web/";

/** O código do site (sem os testes e o apoio deles), pelo caminho a partir da raiz do projeto ("/src/web/..."). */
export const FONTES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(
      [
        "../**/*.{ts,tsx}",
        "!../**/*.test.{ts,tsx}",
        "!../test/**",
        "!../**/teste-apoio*.ts",
      ],
      { query: "?raw", import: "default", eager: true },
    ),
  ).map(([arquivo, fonte]) => [
    new URL(arquivo, `file://${RAIZ}test/`).pathname,
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
export function importsEstaticos(fonte: string): string[] {
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

/** Tudo o que o arquivo carrega sem `import()`: os arquivos do site e os pacotes do npm (pelo nome). */
export function pacoteDe(inicio: string): {
  arquivos: Set<string>;
  pacotes: Set<string>;
} {
  const arquivos = new Set<string>();
  const pacotes = new Set<string>();
  const fila = [inicio];
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

/** O pacote inicial do site: tudo o que main.tsx carrega sem `import()`. */
export const pacoteInicial = () => pacoteDe(`${RAIZ}main.tsx`);
