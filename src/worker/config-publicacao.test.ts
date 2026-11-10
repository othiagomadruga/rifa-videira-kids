// RIFA-013b, itens 2, 3 e 7, e RIFA-019: configuração de publicação conferida no texto dos arquivos.
// - wrangler.jsonc: sem preview URLs (versões antigas no ar com o D1 de produção) e os limitadores de
//   requisições com as mesmas regras de src/worker/lib/limite-requisicoes.ts;
// - .github/workflows/ci.yml: actions fixadas por SHA; o token da Cloudflare só no passo "Publicar", que só
//   aplica as migrations e publica o que o passo de build (sem o token) gerou; checkout sem credenciais.
// (O wrangler lê o wrangler.jsonc no projeto web, em src/web/spa-config.test.ts; aqui, no workerd, os
// arquivos chegam como texto pelo Vite. O projeto não tem parser de YAML: o ci.yml é lido por linhas.)
import { describe, expect, it } from "vitest";
import ci from "../../.github/workflows/ci.yml?raw";
import packageJson from "../../package.json?raw";
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

/** Um passo de um job do workflow. */
interface Passo {
  job: string;
  /** Chaves do passo com valor na própria linha (name, id, uses, if...), sem o comentário do fim. */
  campos: Record<string, string | undefined>;
  env: Record<string, string>;
  with: Record<string, string>;
  /** `run:` de uma linha ou o corpo do `run: |`. */
  run: string;
}

const chaveValor = /^\s*([\w-]+):\s*(.*?)(?:\s+#.*)?$/;

/** Valores que este leitor não entende: âncora, alias, tag, mapa/lista em fluxo e bloco que não seja `run: |`. */
const formaNaoSuportada = /^[&*!{[>|]/;

/**
 * Passos dos jobs de um workflow no formato deste repositório, que o Prettier mantém: job com 2 espaços,
 * passos em "      - " e as chaves de cada passo com 8 (as de env/with e o corpo do run, com 10).
 * Comentários e linhas em branco ficam de fora. Conferido contra um parser de YAML na RIFA-019.
 * Fora do corpo de um `run: |`, uma linha em outra forma (um `env: *x` copiaria o env de outro passo, por
 * exemplo) faz o leitor recusar o ci.yml em vez de lê-lo errado.
 */
function lerPassos(texto: string): Passo[] {
  const passos: Passo[] = [];
  let secao = "";
  let job = "";
  let passo: Passo | undefined;
  let bloco: "env" | "with" | "run" | undefined;
  for (const original of texto.split("\n")) {
    if (original.trim() === "" || original.trim().startsWith("#")) continue;
    const recuo = original.length - original.trimStart().length;
    if (recuo === 0) secao = original.replace(/:.*$/, "");
    if (recuo <= 2) {
      if (secao === "jobs" && recuo === 2) job = original.trim().slice(0, -1);
      passo = undefined;
      continue;
    }
    if (secao !== "jobs") continue;
    let linha = original;
    if (/^ {6}- /.test(linha)) {
      passo = { job, campos: {}, env: {}, with: {}, run: "" };
      passos.push(passo);
      linha = " ".repeat(8) + linha.slice(8);
    } else if (recuo < 8) passo = undefined;

    const [, chave = "", valor = ""] = chaveValor.exec(linha) ?? [];
    const naChaveDoPasso = linha.length - linha.trimStart().length === 8;
    const noCorpoDoRun = passo && !naChaveDoPasso && bloco === "run";
    if (
      !noCorpoDoRun &&
      (chave === "" ||
        (formaNaoSuportada.test(valor) && !(chave === "run" && valor === "|")))
    )
      throw new Error(`ci.yml: forma que o teste não lê: ${original.trim()}`);
    if (!passo) continue;

    if (naChaveDoPasso) {
      bloco = undefined;
      if (chave === "env" || chave === "with") bloco = chave;
      else if (chave === "run" && valor === "|") bloco = "run";
      else if (chave === "run") passo.run = valor;
      else passo.campos[chave] = valor;
    } else if (bloco === "run") passo.run += `${linha.trim()}\n`;
    else if (bloco) passo[bloco][chave] = valor;
  }
  return passos;
}

const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> })
  .scripts;

/** Comandos que `npm run <nome>` executa, abrindo os `npm run` aninhados e os scripts pre/post. */
function comandosDoScript(nome: string): string[] {
  const corpo = scripts[nome];
  if (corpo === undefined) throw new Error(`script inexistente: ${nome}`);
  const proprios = corpo.split("&&").flatMap((comando) => {
    const aninhado = /^npm run ([\w:-]+)$/.exec(comando.trim());
    return aninhado?.[1] ? comandosDoScript(aninhado[1]) : [comando.trim()];
  });
  const gancho = (prefixo: string) =>
    scripts[prefixo + nome] === undefined
      ? []
      : comandosDoScript(prefixo + nome);
  return [...gancho("pre"), ...proprios, ...gancho("post")];
}

describe(".github/workflows/ci.yml", () => {
  const linhas = ci.split("\n");
  const passos = lerPassos(ci);
  const deploy = passos.filter((passo) => passo.job === "deploy");
  const PUBLICAR =
    "Publicar (migrations no D1 remoto, deploy do que já foi construído)";
  const BUILD = "Construir o site e o Worker (sem o token)";
  const SAUDE = "Conferir /api/health em produção";
  const nomeDoPasso = (passo: Passo) =>
    passo.campos.name ?? passo.campos.uses?.replace(/@.*$/, "") ?? passo.run;

  it("toda action é fixada pelo SHA do commit, com a tag no comentário", () => {
    const usos = linhas.filter((linha) => /^\s*-?\s*uses:/.test(linha));
    expect(usos.length).toBeGreaterThanOrEqual(4);
    for (const linha of usos)
      expect(linha.trim()).toMatch(
        /^(- )?uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
      );
  });

  it("o token da Cloudflare só existe no env do passo Publicar (nem no workflow, nem no job, nem em outro passo)", () => {
    const comToken = passos.filter(
      (passo) => "CLOUDFLARE_API_TOKEN" in passo.env,
    );
    expect(comToken.map((passo) => [passo.job, passo.campos.name])).toEqual([
      ["deploy", PUBLICAR],
    ]);
    expect(comToken[0]?.env.CLOUDFLARE_API_TOKEN).toBe(
      "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    );
    // Nenhum env no nível do workflow (0 espaços) nem do job (4 espaços).
    expect(ci).not.toMatch(/^( {4})?env:/m);
    // Fora dos comentários, os segredos aparecem em duas linhas só: a do Publicar e a do passo que confere se
    // o segredo existe, que recebe só "true"/"false". Nada de secrets em with:, GITHUB_ENV ou outro passo.
    // Linha com "#" e "${{" também conta: no corpo de um run: | ela é script, e o GitHub troca a expressão.
    const comSegredos = linhas
      .filter((linha) => !linha.trim().startsWith("#") || linha.includes("${{"))
      .filter((linha) => /\bsecrets\b/i.test(linha))
      .map((linha) => linha.trim());
    expect(comSegredos).toEqual([
      "TEM_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN != '' }}",
      "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    ]);
    expect(deploy[0]?.campos).toMatchObject({
      name: "Conferir o segredo da Cloudflare",
      id: "segredo",
    });
    expect(deploy[0]?.env).toEqual({
      TEM_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN != '' }}",
    });
  });

  it("no deploy, o build roda antes do Publicar, num passo sem o token; o Publicar só aplica as migrations e publica", () => {
    expect(deploy.map(nomeDoPasso)).toEqual([
      "Conferir o segredo da Cloudflare",
      "actions/checkout",
      "actions/setup-node",
      "npm ci",
      BUILD,
      PUBLICAR,
      SAUDE,
    ]);
    const build = deploy.find((passo) => passo.campos.name === BUILD);
    expect(build?.run).toBe("npm run build");
    expect(build?.env).toEqual({});
    expect(build?.with).toEqual({});

    // O Publicar não roda o Vite nem os plugins: toda a cadeia de npm run (com pre/post) é só wrangler.
    const publicar = deploy.find((passo) => passo.campos.name === PUBLICAR);
    expect(publicar?.run).toBe("npm run deploy:publicar");
    expect(comandosDoScript("deploy:publicar")).toEqual([
      "wrangler d1 migrations apply DB --remote",
      "wrangler deploy",
    ]);
    // Quem roda `npm run deploy` na própria máquina continua com build, migrations e deploy, nessa ordem.
    expect(comandosDoScript("deploy")).toEqual([
      "vite build",
      "wrangler d1 migrations apply DB --remote",
      "wrangler deploy",
    ]);
  });

  it("os checkouts não gravam o GITHUB_TOKEN no .git/config (persist-credentials: false)", () => {
    const checkouts = passos.filter((passo) =>
      passo.campos.uses?.startsWith("actions/checkout@"),
    );
    expect(checkouts.map((passo) => passo.job)).toEqual(["ci", "deploy"]);
    for (const checkout of checkouts)
      expect(checkout.with["persist-credentials"]).toBe("false");
  });

  it("o deploy mantém a D11: só nos pushes da main depois do ci, sem cancelar no meio, e confere /api/health", () => {
    const inicio = linhas.indexOf("  deploy:");
    const fim = linhas.findIndex(
      (linha, i) => i > inicio && /^ {0,2}\S/.test(linha),
    );
    const job = linhas.slice(inicio, fim === -1 ? undefined : fim).join("\n");
    expect(job).toContain("\n    needs: ci\n");
    expect(job).toContain(
      "\n    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n",
    );
    expect(job).toMatch(
      /\n {4}concurrency:\n {6}group: deploy-producao\n {6}cancel-in-progress: false\n/,
    );
    // Todo passo depois do que confere o segredo depende dele (sem o segredo, nada roda).
    for (const passo of deploy.slice(1))
      expect(passo.campos.if).toBe("steps.segredo.outputs.ok == 'true'");
    expect(deploy.at(-1)?.campos.name).toBe(SAUDE);
    expect(deploy.at(-1)?.run).toContain(
      "curl -fsS https://rifa-videira-kids.madruga.workers.dev/api/health",
    );
  });
});
