// RIFA-022: as referências por número às regras do docs/frontend.md (ex.: "a regra 4 do `docs/frontend.md`")
// apontam para uma regra que existe e, quando o assunto é conhecido, para a regra certa. As regras são uma lista
// numerada: uma regra nova no meio muda o número das seguintes, e a referência em outro arquivo fica velha sem
// ninguém ver (a do docs/acesso.md §4 ficou dizendo "regra 3" depois que a regra de CDN virou a 4).
import { describe, expect, it } from "vitest";

type ModuloFs = {
  readFileSync(caminho: string, codificacao: "utf8"): string;
  readdirSync(caminho: string, opcoes: { recursive: true }): string[];
};
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
const fs = process.getBuiltinModule("node:fs");
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const RAIZ = "../../";
const caminhoNaRaiz = (relativo: string) =>
  decodeURIComponent(new URL(RAIZ + relativo, import.meta.url).pathname);
const ler = (relativo: string) =>
  fs.readFileSync(caminhoNaRaiz(relativo), "utf8");

/** Arquivos onde uma referência pode aparecer: documentação, CLAUDE.md e o código (com o CSS). */
function arquivosVarridos(): string[] {
  const daPasta = (pasta: string, extensoes: RegExp) =>
    fs
      .readdirSync(caminhoNaRaiz(pasta), { recursive: true })
      .filter((nome) => extensoes.test(nome))
      .map((nome) => `${pasta}/${nome}`);
  return [
    "CLAUDE.md",
    ...daPasta("docs", /\.md$/),
    ...daPasta("src", /\.(ts|tsx|css|mjs)$/),
    ...daPasta("scripts", /\.(mjs|ts)$/),
  ];
}

/**
 * Regras numeradas da seção "## Regras" do docs/frontend.md, na ordem do arquivo: [número, texto]. Uma lista (e
 * não um Map) para um número repetido aparecer: o Markdown renumera a lista e a referência ficaria velha.
 */
function regrasDoFrontend(): [number, string][] {
  const texto = ler("docs/frontend.md");
  const inicio = texto.indexOf("\n## Regras\n");
  if (inicio < 0) throw new Error("seção ## Regras não encontrada");
  const fim = texto.indexOf("\n## ", inicio + 1);
  const secao = texto.slice(inicio, fim < 0 ? undefined : fim);
  return [...secao.matchAll(/^(\d+)\. (.+)$/gm)].map((regra) => [
    Number(regra[1]),
    regra[2],
  ]);
}

type Referencia = {
  arquivo: string;
  numeros: number[];
  trecho: string;
  /** O texto logo depois da referência, para saber do que ela fala. */
  depois: string;
};

// "regra 4 do `docs/frontend.md`", "regras 1 e 2 de [frontend.md](frontend.md)", "docs/frontend.md, regra 4"...
const ANTES =
  /\bregras? (\d+(?:(?:, | e | a )\d+)*)\b[^\n]{0,40}?frontend\.md/gi;
const DEPOIS =
  /frontend\.md[`)\]]*,? \(?regras? (\d+(?:(?:, | e | a )\d+)*)\b/gi;

function referencias(): Referencia[] {
  const achadas: Referencia[] = [];
  for (const arquivo of arquivosVarridos()) {
    if (arquivo.endsWith("referencias-ao-frontend.test.ts")) continue;
    const texto = ler(arquivo);
    for (const padrao of [ANTES, DEPOIS]) {
      for (const achado of texto.matchAll(padrao)) {
        achadas.push({
          arquivo,
          numeros: achado[1].split(/, | e | a /).map(Number),
          trecho: achado[0],
          depois: texto.slice(
            achado.index + achado[0].length,
            achado.index + achado[0].length + 60,
          ),
        });
      }
    }
  }
  return achadas;
}

describe("referências às regras do docs/frontend.md", () => {
  const lista = regrasDoFrontend();
  const regras = new Map(lista);
  const achadas = referencias();

  it("a seção de regras está numerada de 1 em diante, sem buraco nem número repetido", () => {
    expect(lista.length).toBeGreaterThanOrEqual(7);
    expect(lista.map(([numero]) => numero)).toEqual(
      Array.from({ length: lista.length }, (_, i) => i + 1),
    );
  });

  it("toda referência por número aponta para uma regra que existe", () => {
    expect(achadas.length).toBeGreaterThan(0);
    const quebradas = achadas.filter((referencia) =>
      referencia.numeros.some((numero) => !regras.has(numero)),
    );
    expect(quebradas).toEqual([]);
  });

  it("docs/acesso.md §4 (CSP) aponta para a regra que proíbe CDN e fonte externa", () => {
    // A referência da CSP é a que segue com "já proíbe CDN": outras referências no mesmo arquivo não atrapalham.
    const daCsp = achadas.filter(
      (referencia) =>
        referencia.arquivo === "docs/acesso.md" &&
        /\bCDN\b/.test(referencia.depois),
    );
    expect(daCsp).toHaveLength(1);
    const [numero] = daCsp[0].numeros;
    expect(regras.get(numero)).toMatch(/\bCDN\b/);
  });
});
