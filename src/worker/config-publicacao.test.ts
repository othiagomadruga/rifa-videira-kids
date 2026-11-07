// RIFA-013b, itens 2, 3 e 7: configuração de publicação conferida no texto dos arquivos.
// - wrangler.jsonc: sem preview URLs (versões antigas no ar com o D1 de produção) e os limitadores de
//   requisições com as mesmas regras de src/worker/lib/limite-requisicoes.ts;
// - .github/workflows/ci.yml: o token da Cloudflare só no passo "Publicar" e as actions fixadas por SHA.
// (O wrangler lê o wrangler.jsonc no projeto web, em src/web/spa-config.test.ts; aqui, no workerd, o
// arquivo chega como texto pelo Vite.)
import { describe, expect, it } from "vitest";
import ci from "../../.github/workflows/ci.yml?raw";
import wranglerJsonc from "../../wrangler.jsonc?raw";
import { LIMITE_LOGIN, LIMITE_PUBLICO } from "./lib/limite-requisicoes";

/** JSONC → JSON: tira comentários (fora de strings) e vírgulas antes de } ou ]. */
function lerJsonc(texto: string): unknown {
  let saida = "";
  let emTexto = false;
  for (let i = 0; i < texto.length; i++) {
    const caractere = texto[i];
    if (emTexto) {
      saida += caractere;
      if (caractere === "\\") saida += texto[++i];
      else if (caractere === '"') emTexto = false;
    } else if (caractere === '"') {
      emTexto = true;
      saida += caractere;
    } else if (caractere === "/" && texto[i + 1] === "/") {
      while (i < texto.length && texto[i] !== "\n") i++;
      saida += "\n";
    } else if (caractere === "/" && texto[i + 1] === "*") {
      i = texto.indexOf("*/", i + 2) + 1;
    } else {
      saida += caractere;
    }
  }
  return JSON.parse(saida.replace(/,(\s*[}\]])/g, "$1"));
}

interface ConfigWrangler {
  preview_urls?: boolean;
  workers_dev?: boolean;
  routes?: unknown[];
  ratelimits?: {
    name: string;
    namespace_id: string;
    simple: { limit: number; period: number };
  }[];
}

const config = lerJsonc(wranglerJsonc) as ConfigWrangler;

describe("wrangler.jsonc", () => {
  it("preview URLs desligadas; o site continua no workers.dev (sem rotas, workers_dev é o padrão)", () => {
    expect(config.preview_urls).toBe(false);
    expect(config.workers_dev ?? true).toBe(true);
    expect(config.routes).toBeUndefined();
  });

  it("os limitadores de requisições têm as regras do código (limite e período) e namespaces distintos", () => {
    const porNome = Object.fromEntries(
      (config.ratelimits ?? []).map((limitador) => [limitador.name, limitador]),
    );
    for (const regra of [LIMITE_PUBLICO, LIMITE_LOGIN])
      expect(porNome[regra.binding]?.simple).toEqual({
        limit: regra.limite,
        period: regra.periodoSegundos,
      });
    const namespaces = (config.ratelimits ?? []).map(
      (limitador) => limitador.namespace_id,
    );
    expect(namespaces).toHaveLength(2);
    expect(new Set(namespaces).size).toBe(2);
    for (const id of namespaces) expect(id).toMatch(/^[1-9]\d*$/);
  });
});

describe(".github/workflows/ci.yml", () => {
  const linhas = ci.split("\n");

  it("toda action é fixada pelo SHA do commit, com a tag no comentário", () => {
    const usos = linhas.filter((linha) => /^\s*-?\s*uses:/.test(linha));
    expect(usos.length).toBeGreaterThanOrEqual(4);
    for (const linha of usos)
      expect(linha.trim()).toMatch(
        /^(- )?uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
      );
  });

  it("o token da Cloudflare só existe no env do passo Publicar (nem no job, nem no passo que confere o segredo)", () => {
    const segredo = "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}";
    const onde = linhas.flatMap((linha, i) =>
      linha.includes(segredo) ? [i] : [],
    );
    expect(onde).toHaveLength(1);

    // O passo dono da linha: o "- name:" mais próximo acima, com indentação de passo.
    const passo = linhas
      .slice(0, onde[0])
      .reverse()
      .find((linha) => /^\s{6}- (name|uses|run):/.test(linha));
    expect(passo?.trim()).toBe(
      "- name: Publicar (build, migrations no D1 remoto, deploy)",
    );
    // Nenhum env no nível do job (4 espaços) carrega o token.
    expect(ci).not.toMatch(
      /\n {4}env:\n(?: {6}.*\n)*? {6}CLOUDFLARE_API_TOKEN/,
    );
    // O passo que confere o segredo só recebe "true"/"false".
    expect(ci).toContain(
      "TEM_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN != '' }}",
    );
  });
});
