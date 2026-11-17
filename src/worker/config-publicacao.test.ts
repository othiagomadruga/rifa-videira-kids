// RIFA-013b, itens 2, 3 e 7, RIFA-019, RIFA-021 e RIFA-035: configuração de publicação conferida no texto dos
// arquivos.
// - wrangler.jsonc: sem preview URLs (versões antigas no ar com o D1 de produção) e os limitadores de
//   requisições com as mesmas regras de src/worker/lib/limite-requisicoes.ts;
// - .github/workflows/ci.yml: actions fixadas por SHA; o build roda no job "ci", sem segredo, e vai como
//   artefato do mesmo run para o job "publicar", que não roda npm ci com scripts nem o build, confere o
//   artefato sem o token e só no passo "Publicar" recebe o token (D18); checkouts sem credenciais. O disparo
//   manual (Run workflow) publica a main de novo sem commit (D22);
// - .github/workflows/voltar-versao.yml: a volta do site para a versão anterior pelo celular (D22), no mesmo
//   padrão do publicar (só da main, token só no passo da volta, npm ci sem scripts);
// - todos os workflows da pasta: actions por SHA, sem pull_request_target, permissão só de leitura, entradas e
//   segredos fora dos scripts. Um workflow novo falha aqui até ganhar as travas dele.
// (O wrangler lê o wrangler.jsonc no projeto web, em src/web/spa-config.test.ts; aqui, no workerd, os
// arquivos chegam como texto pelo Vite. O projeto não tem parser de YAML: os workflows são lidos por linhas.
// A conferência do artefato, scripts/conferir-artefato.mjs, e o script da volta, scripts/voltar-versao.mjs,
// têm os testes deles em scripts/.)
import { describe, expect, it } from "vitest";
import ci from "../../.github/workflows/ci.yml?raw";
import voltarVersao from "../../.github/workflows/voltar-versao.yml?raw";
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
      throw new Error(`workflow: forma que o teste não lê: ${original.trim()}`);
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

/** Linhas de um bloco do topo do workflow (ex.: "on"), sem comentários nem linhas em branco. */
function linhasDoTopo(texto: string, chave: string): string[] {
  const linhas = texto
    .split("\n")
    .filter((linha) => linha.trim() !== "" && !linha.trim().startsWith("#"));
  const inicio = linhas.indexOf(`${chave}:`);
  if (inicio === -1) return [];
  const fim = linhas.findIndex((linha, i) => i > inicio && /^\S/.test(linha));
  return linhas.slice(inicio, fim === -1 ? undefined : fim);
}

/** Chaves do topo do workflow (name, on, permissions...), na ordem. */
function chavesDoTopo(texto: string): string[] {
  return texto
    .split("\n")
    .filter((linha) => /^[\w-]+:/.test(linha))
    .map((linha) => linha.replace(/:.*$/, ""));
}

/** Nomes dos jobs de um workflow (as linhas "  <job>:" depois de "jobs:"). */
function jobsDo(texto: string): string[] {
  const linhas = texto.split("\n");
  return linhas
    .slice(linhas.indexOf("jobs:") + 1)
    .filter((linha) => /^ {2}[\w-]+:$/.test(linha))
    .map((linha) => linha.trim().slice(0, -1));
}

/** Texto de um job: da linha "  <job>:" até a próxima com 0 ou 2 espaços. */
function textoDoJobDe(texto: string, job: string): string {
  const linhas = texto.split("\n");
  const inicio = linhas.indexOf(`  ${job}:`);
  const fim = linhas.findIndex(
    (linha, i) => i > inicio && /^ {0,2}\S/.test(linha),
  );
  return linhas.slice(inicio, fim === -1 ? undefined : fim).join("\n");
}

/** Todos os arquivos de .github/workflows, pelo nome (o Vite os lê como texto). */
const WORKFLOWS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../.github/workflows/*", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([caminho, texto]) => [caminho.split("/").pop() ?? caminho, texto]),
);

describe(".github/workflows/ci.yml", () => {
  const linhas = ci.split("\n");
  const passos = lerPassos(ci);
  const doJob = (job: string) => passos.filter((passo) => passo.job === job);
  const build = doJob("ci");
  const publicar = doJob("publicar");
  const SEGREDO = "Conferir o segredo da Cloudflare";
  const CONFERIR_BUILD = "Conferir o build para a publicação";
  const GUARDAR = "Guardar o build para a publicação";
  const INSTALAR = "Instalar as dependências sem os scripts de instalação";
  const BAIXAR = "Baixar o build do job ci";
  const CONFERIR_BAIXADO = "Conferir o build baixado (sem o token)";
  const PUBLICAR =
    "Publicar (migrations no D1 remoto, deploy do que já foi construído)";
  const SAUDE = "Conferir /api/health em produção";
  const ARTEFATO = "build-producao";
  const CONFERENCIA = "node scripts/conferir-artefato.mjs";
  const SE_TEM_SEGREDO = "steps.segredo.outputs.ok == 'true'";
  const nomeDoPasso = (passo: Passo) =>
    passo.campos.name ?? passo.campos.uses?.replace(/@.*$/, "") ?? passo.run;
  const passo = (lista: Passo[], nome: string) =>
    lista.find((item) => item.campos.name === nome);
  const textoDoJob = (job: string) => textoDoJobDe(ci, job);

  it("toda action é fixada pelo SHA do commit, com a tag no comentário", () => {
    const usos = linhas.filter((linha) => /^\s*-?\s*uses:/.test(linha));
    expect(usos.length).toBeGreaterThanOrEqual(6);
    for (const linha of usos)
      expect(linha.trim()).toMatch(
        /^(- )?uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
      );
  });

  it("só dois jobs: o ci, que constrói sem segredo, e o publicar; permissão só de leitura", () => {
    expect(jobsDo(ci)).toEqual(["ci", "publicar"]);
    expect(new Set(passos.map((item) => item.job))).toEqual(
      new Set(["ci", "publicar"]),
    );
    expect(ci).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(linhas.filter((linha) => /^\s*permissions:/.test(linha))).toEqual([
      "permissions:",
    ]);
  });

  it("CA1: o token da Cloudflare só existe no env do passo Publicar do job publicar (nem no workflow, nem no job, nem em outro passo)", () => {
    const comToken = passos.filter(
      (item) => "CLOUDFLARE_API_TOKEN" in item.env,
    );
    expect(comToken.map((item) => [item.job, item.campos.name])).toEqual([
      ["publicar", PUBLICAR],
    ]);
    // Só o token e o id da conta: nada como NODE_OPTIONS, que faria o node do wrangler carregar um arquivo do
    // artefato com o token no ambiente (revisão da RIFA-021).
    expect(comToken[0]?.env).toEqual({
      CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
      CLOUDFLARE_ACCOUNT_ID: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
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
    expect(publicar[0]?.campos).toMatchObject({ name: SEGREDO, id: "segredo" });
    expect(publicar[0]?.env).toEqual({
      TEM_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN != '' }}",
    });
  });

  it("CA1: o job publicar não roda o npm ci com scripts, npm install, npx nem o build, e não restaura cache", () => {
    expect(publicar.map(nomeDoPasso)).toEqual([
      SEGREDO,
      "actions/checkout",
      "actions/setup-node",
      INSTALAR,
      BAIXAR,
      CONFERIR_BAIXADO,
      PUBLICAR,
      SAUDE,
    ]);
    expect(passo(publicar, INSTALAR)?.run).toBe("npm ci --ignore-scripts");
    for (const { run } of publicar) {
      const comandos = run.split(/\n|&&|;|\|\|/).map((parte) => parte.trim());
      for (const comando of comandos) {
        if (/^npm ci\b/.test(comando))
          expect(comando).toBe("npm ci --ignore-scripts");
        expect(comando).not.toMatch(
          /^(npm (install|i|add|rebuild|exec|x)|npx|yarn|pnpm)\b/,
        );
        expect(comando).not.toMatch(/\bvite\b|^npm run build\b/);
        // Todo `npm run` do job abre só em comandos do wrangler (com pre/post): nada do Vite nem dos plugins.
        const script = /^npm run ([\w:-]+)$/.exec(comando)?.[1];
        if (script)
          for (const aninhado of comandosDoScript(script))
            expect(aninhado).toMatch(/^wrangler /);
      }
    }
    // Só estas actions (nenhuma de cache) e o setup-node sem cache: nada salvo por outro job entra.
    expect(
      publicar.flatMap((item) =>
        item.campos.uses ? [item.campos.uses.replace(/@.*$/, "")] : [],
      ),
    ).toEqual([
      "actions/checkout",
      "actions/setup-node",
      "actions/download-artifact",
    ]);
    const setupNode = publicar.find((item) =>
      item.campos.uses?.startsWith("actions/setup-node@"),
    );
    expect(setupNode?.with).toEqual({ "node-version": "22" });
  });

  it("CA2: o build do job ci vai como artefato do mesmo run para o publicar, conferido antes do token; o Publicar só aplica as migrations e publica", () => {
    // No job ci: o build, a conferência e o artefato só com o dist/ (com os arquivos ocultos do build).
    expect(build.map(nomeDoPasso).slice(-3)).toEqual([
      "npm run build",
      CONFERIR_BUILD,
      GUARDAR,
    ]);
    expect(passo(build, CONFERIR_BUILD)?.run).toBe(CONFERENCIA);
    const guardar = passo(build, GUARDAR);
    expect(guardar?.campos.uses).toMatch(/^actions\/upload-artifact@/);
    expect(guardar?.with).toEqual({
      name: ARTEFATO,
      path: "dist/",
      "include-hidden-files": "true",
      "if-no-files-found": "error",
      "retention-days": "1",
      overwrite: "true",
    });

    // No publicar: baixa só dentro de dist/, deste run (sem github-token, run-id nem repository), e confere
    // num passo sem env antes do Publicar.
    const baixar = passo(publicar, BAIXAR);
    expect(baixar?.campos.uses).toMatch(/^actions\/download-artifact@/);
    expect(baixar?.with).toEqual({ name: ARTEFATO, path: "dist" });
    expect(baixar?.env).toEqual({});
    const conferir = passo(publicar, CONFERIR_BAIXADO);
    expect(conferir?.run).toBe(CONFERENCIA);
    expect(conferir?.env).toEqual({});
    expect(textoDoJob("publicar")).toContain("\n    needs: ci\n");

    // O Publicar não roda o Vite nem os plugins: toda a cadeia de npm run (com pre/post) é só wrangler. O
    // dry-run vem antes das migrations: sem o build (dist/ e .wrangler/deploy/config.json), ele falha em
    // segundos, sem rede, e o D1 remoto fica intocado (provado com --local na RIFA-019).
    expect(passo(publicar, PUBLICAR)?.run).toBe("npm run deploy:publicar");
    expect(comandosDoScript("deploy:publicar")).toEqual([
      "wrangler deploy --dry-run",
      "wrangler d1 migrations apply DB --remote",
      "wrangler deploy",
    ]);
    // Quem roda `npm run deploy` na própria máquina continua com build, conferência, migrations e deploy.
    expect(comandosDoScript("deploy")).toEqual([
      "vite build",
      "wrangler deploy --dry-run",
      "wrangler d1 migrations apply DB --remote",
      "wrangler deploy",
    ]);
  });

  it("CA3: sem o segredo, o publicar avisa e pula todos os outros passos, sem falhar", () => {
    const conferirSegredo = publicar[0];
    expect(conferirSegredo?.campos.if).toBeUndefined();
    expect(conferirSegredo?.run).toContain(
      "::notice::Segredo CLOUDFLARE_API_TOKEN não configurado",
    );
    expect(conferirSegredo?.run).toContain(
      'echo "ok=false" >> "$GITHUB_OUTPUT"',
    );
    expect(conferirSegredo?.run).not.toMatch(/\bexit\b/);
    // Todo passo depois do que confere o segredo depende dele (sem o segredo, nada roda).
    for (const item of publicar.slice(1))
      expect(item.campos.if).toBe(SE_TEM_SEGREDO);
  });

  it("nada no publicar muda o ambiente ou o diretório dos passos seguintes nem deixa uma conferência falhar em silêncio", () => {
    // Revisão da RIFA-021: um NODE_OPTIONS ou um PATH gravado no $GITHUB_ENV/$GITHUB_PATH por um passo anterior
    // chegaria ao "Publicar", com o token. O passo do segredo só escreve "ok" no $GITHUB_OUTPUT.
    expect(publicar[0]?.run).toBe(
      [
        'if [ "$TEM_TOKEN" != "true" ]; then',
        'echo "::notice::Segredo CLOUDFLARE_API_TOKEN não configurado no repositório: publicação pulada."',
        'echo "ok=false" >> "$GITHUB_OUTPUT"',
        "else",
        'echo "ok=true" >> "$GITHUB_OUTPUT"',
        "fi",
        "",
      ].join("\n"),
    );
    for (const { run } of publicar)
      expect(run).not.toMatch(/GITHUB_(ENV|PATH)\b/);
    // Nem no workflow, nem num job, nem num passo: outro shell ou outra pasta (por exemplo, rodar o wrangler de
    // dentro do dist/) e continue-on-error (a conferência falharia e o job seguiria).
    expect(ci).not.toMatch(
      /^\s*(defaults|shell|working-directory|continue-on-error):/m,
    );
  });

  it("os checkouts não gravam o GITHUB_TOKEN no .git/config (persist-credentials: false)", () => {
    const checkouts = passos.filter((item) =>
      item.campos.uses?.startsWith("actions/checkout@"),
    );
    expect(checkouts.map((item) => item.job)).toEqual(["ci", "publicar"]);
    for (const checkout of checkouts)
      expect(checkout.with["persist-credentials"]).toBe("false");
  });

  it("o publicar mantém a D11: só na main (push ou Run workflow) depois do ci, sem cancelar no meio, sem ambiente do GitHub, e confere /api/health", () => {
    const job = textoDoJob("publicar");
    // D22: o disparo manual (Run workflow) publica a main de novo sem commit; pull_request nunca publica.
    expect(job).toContain(
      "\n    if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'\n",
    );
    expect(linhasDoTopo(ci, "on")).toEqual([
      "on:",
      "  push:",
      "    branches: [main]",
      "  pull_request:",
      "  workflow_dispatch:",
    ]);
    expect(job).toMatch(
      /\n {4}concurrency:\n {6}group: deploy-producao\n {6}cancel-in-progress: false\n/,
    );
    // Sem `environment:` (D18, revisão da RIFA-021): repositório privado e plano do GitHub desconhecido; no Free,
    // ambientes não estão disponíveis em repositório privado. O segredo é o do repositório. Para ligar o ambiente
    // "producao" com o GitHub Pro, siga a D18 e troque esta conferência.
    expect(ci).not.toMatch(/^\s*environment:/m);
    expect(publicar.at(-1)?.campos.name).toBe(SAUDE);
    expect(publicar.at(-1)?.run).toContain(
      "curl -fsS https://rifa-videira-kids.madruga.workers.dev/api/health",
    );
  });
});

describe(".github/workflows: o que vale para todos os workflows", () => {
  const nomes = Object.keys(WORKFLOWS).sort();

  it("só o ci.yml e o voltar-versao.yml (um workflow novo entra nas travas deste arquivo antes da main)", () => {
    expect(nomes).toEqual(["ci.yml", "voltar-versao.yml"]);
    expect(WORKFLOWS["ci.yml"]).toBe(ci);
    expect(WORKFLOWS["voltar-versao.yml"]).toBe(voltarVersao);
  });

  it("toda action é fixada pelo SHA do commit, com a tag no comentário", () => {
    for (const nome of nomes) {
      const usos = WORKFLOWS[nome]
        .split("\n")
        .filter((linha) => /^\s*-?\s*uses:/.test(linha));
      expect({ nome, usos: usos.length > 0 }).toEqual({ nome, usos: true });
      for (const linha of usos)
        expect({ nome, linha: linha.trim() }).toEqual({
          nome,
          linha: expect.stringMatching(
            /^(- )?uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
          ),
        });
    }
  });

  it("nenhum pull_request_target nem workflow_run (o código de um fork ou de outro run nunca roda com os segredos)", () => {
    for (const nome of nomes)
      expect({ nome, texto: WORKFLOWS[nome] }).not.toEqual({
        nome,
        texto: expect.stringMatching(/pull_request_target|workflow_run/),
      });
  });

  it("permissão só de leitura, declarada uma vez no topo; sem env no topo nem no job, sem ambiente do GitHub", () => {
    for (const nome of nomes) {
      const texto = WORKFLOWS[nome];
      expect({ nome, permissoes: linhasDoTopo(texto, "permissions") }).toEqual({
        nome,
        permissoes: ["permissions:", "  contents: read"],
      });
      expect({
        nome,
        outras: texto.split("\n").filter((l) => /^\s+permissions:/.test(l)),
      }).toEqual({ nome, outras: [] });
      expect({ nome, envFora: /^( {4})?env:/m.test(texto) }).toEqual({
        nome,
        envFora: false,
      });
      expect({ nome, ambiente: /^\s*environment:/m.test(texto) }).toEqual({
        nome,
        ambiente: false,
      });
      expect({
        nome,
        outros:
          /^\s*(defaults|shell|working-directory|continue-on-error):/m.test(
            texto,
          ),
      }).toEqual({ nome, outros: false });
    }
  });

  it("nenhum script (run) tem expressão ${{ }}: entradas e segredos só pelo env do passo, nunca escritos no script", () => {
    for (const nome of nomes)
      for (const passo of lerPassos(WORKFLOWS[nome]))
        expect({ nome, run: passo.run }).not.toEqual({
          nome,
          run: expect.stringContaining("${{"),
        });
  });

  it("o token da Cloudflare só existe em dois passos: o Publicar do ci.yml e a volta do voltar-versao.yml", () => {
    const comToken = nomes.flatMap((nome) =>
      lerPassos(WORKFLOWS[nome])
        .filter((passo) => "CLOUDFLARE_API_TOKEN" in passo.env)
        .map((passo) => [nome, passo.job, passo.campos.name]),
    );
    expect(comToken).toEqual([
      [
        "ci.yml",
        "publicar",
        "Publicar (migrations no D1 remoto, deploy do que já foi construído)",
      ],
      [
        "voltar-versao.yml",
        "voltar",
        "Voltar a versão (wrangler versions deploy, sem confirmar segredos trocados)",
      ],
    ]);
  });

  it("os checkouts não gravam o GITHUB_TOKEN no .git/config, e nenhum passo escreve no $GITHUB_ENV ou no $GITHUB_PATH", () => {
    for (const nome of nomes)
      for (const passo of lerPassos(WORKFLOWS[nome])) {
        if (passo.campos.uses?.startsWith("actions/checkout@"))
          expect({ nome, with: passo.with["persist-credentials"] }).toEqual({
            nome,
            with: "false",
          });
        expect({ nome, run: passo.run }).not.toEqual({
          nome,
          run: expect.stringMatching(/GITHUB_(ENV|PATH)\b/),
        });
      }
  });
});

describe(".github/workflows/voltar-versao.yml (D22)", () => {
  const linhas = voltarVersao.split("\n");
  const passos = lerPassos(voltarVersao);
  const SEGREDO = "Conferir o segredo da Cloudflare";
  const INSTALAR = "Instalar as dependências sem os scripts de instalação";
  const VOLTAR =
    "Voltar a versão (wrangler versions deploy, sem confirmar segredos trocados)";
  const SAUDE = "Conferir /api/health em produção";
  const SE_TEM_SEGREDO = "steps.segredo.outputs.ok == 'true'";
  const nomeDoPasso = (passo: Passo) =>
    passo.campos.name ?? passo.campos.uses?.replace(/@.*$/, "") ?? passo.run;
  const passo = (nome: string) =>
    passos.find((item) => item.campos.name === nome);
  const idDaConta = () =>
    lerPassos(ci).find((item) => "CLOUDFLARE_API_TOKEN" in item.env)?.env
      .CLOUDFLARE_ACCOUNT_ID;

  it("só disparo manual, com o motivo obrigatório e a versão opcional (vazio: a anterior)", () => {
    expect(chavesDoTopo(voltarVersao)).toEqual([
      "name",
      "on",
      "permissions",
      "jobs",
    ]);
    expect(linhas[0]).toBe("name: Voltar o site para a versão anterior");
    expect(
      linhasDoTopo(voltarVersao, "on").filter(
        (linha) => !/^ {8}description: /.test(linha),
      ),
    ).toEqual([
      "on:",
      "  workflow_dispatch:",
      "    inputs:",
      "      motivo:",
      "        required: true",
      "        type: string",
      "      versao:",
      "        required: false",
      "        type: string",
      '        default: ""',
    ]);
  });

  it("um job só, que roda só a partir da main, na fila da publicação (sem cancelar no meio)", () => {
    expect(jobsDo(voltarVersao)).toEqual(["voltar"]);
    expect(new Set(passos.map((item) => item.job))).toEqual(
      new Set(["voltar"]),
    );
    const job = textoDoJobDe(voltarVersao, "voltar");
    expect(job).toContain("\n    if: github.ref == 'refs/heads/main'\n");
    // O mesmo grupo do publicar do ci.yml: uma volta e uma publicação nunca rodam juntas.
    expect(job).toMatch(
      /\n {4}concurrency:\n {6}group: deploy-producao\n {6}cancel-in-progress: false\n/,
    );
    expect(textoDoJobDe(ci, "publicar")).toMatch(
      /\n {4}concurrency:\n {6}group: deploy-producao\n {6}cancel-in-progress: false\n/,
    );
  });

  it("o token só existe no env do passo da volta, com o id da conta e as entradas; os segredos só nas duas linhas conhecidas", () => {
    expect(passos.map(nomeDoPasso)).toEqual([
      SEGREDO,
      "actions/checkout",
      "actions/setup-node",
      INSTALAR,
      VOLTAR,
      SAUDE,
    ]);
    expect(passo(VOLTAR)?.env).toEqual({
      CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
      CLOUDFLARE_ACCOUNT_ID: idDaConta(),
      MOTIVO: "${{ inputs.motivo }}",
      VERSAO: "${{ inputs.versao }}",
    });
    expect(idDaConta()).toMatch(/^[0-9a-f]{32}$/);
    const comSegredos = linhas
      .filter((linha) => !linha.trim().startsWith("#") || linha.includes("${{"))
      .filter((linha) => /\bsecrets\b/i.test(linha))
      .map((linha) => linha.trim());
    expect(comSegredos).toEqual([
      "TEM_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN != '' }}",
      "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    ]);
    // As entradas aparecem só no env da volta (nunca num script nem noutro passo).
    expect(
      linhas
        .filter((linha) => /\binputs\./.test(linha))
        .map((linha) => linha.trim()),
    ).toEqual(["MOTIVO: ${{ inputs.motivo }}", "VERSAO: ${{ inputs.versao }}"]);
    for (const item of passos.filter((p) => p.campos.name !== VOLTAR))
      expect({ passo: nomeDoPasso(item), env: Object.keys(item.env) }).toEqual({
        passo: nomeDoPasso(item),
        env: item.campos.name === SEGREDO ? ["TEM_TOKEN"] : [],
      });
  });

  it("a volta é o script (wrangler versions deploy), nunca o wrangler rollback, que no CI confirma sozinho os segredos trocados", () => {
    expect(passo(VOLTAR)?.run).toBe("node scripts/voltar-versao.mjs");
    for (const { run } of passos) expect(run).not.toMatch(/\brollback\b/);
  });

  it("npm ci sem os scripts de instalação; sem npm install, npx, build ou cache", () => {
    expect(passo(INSTALAR)?.run).toBe("npm ci --ignore-scripts");
    for (const { run } of passos)
      for (const comando of run.split(/\n|&&|;|\|\|/).map((p) => p.trim())) {
        if (/^npm ci\b/.test(comando))
          expect(comando).toBe("npm ci --ignore-scripts");
        expect(comando).not.toMatch(
          /^(npm (install|i|add|rebuild|exec|x|run)|npx|yarn|pnpm)\b/,
        );
        expect(comando).not.toMatch(/\bvite\b/);
      }
    expect(
      passos.flatMap((item) =>
        item.campos.uses ? [item.campos.uses.replace(/@.*$/, "")] : [],
      ),
    ).toEqual(["actions/checkout", "actions/setup-node"]);
    const setupNode = passos.find((item) =>
      item.campos.uses?.startsWith("actions/setup-node@"),
    );
    expect(setupNode?.with).toEqual({ "node-version": "22" });
  });

  it("sem o segredo, avisa e pula todos os outros passos, sem falhar", () => {
    expect(passos[0]?.campos).toMatchObject({ name: SEGREDO, id: "segredo" });
    expect(passos[0]?.campos.if).toBeUndefined();
    expect(passos[0]?.env).toEqual({
      TEM_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN != '' }}",
    });
    expect(passos[0]?.run).toBe(
      [
        'if [ "$TEM_TOKEN" != "true" ]; then',
        'echo "::notice::Segredo CLOUDFLARE_API_TOKEN não configurado no repositório: volta da versão pulada."',
        'echo "ok=false" >> "$GITHUB_OUTPUT"',
        "else",
        'echo "ok=true" >> "$GITHUB_OUTPUT"',
        "fi",
        "",
      ].join("\n"),
    );
    for (const item of passos.slice(1))
      expect(item.campos.if).toBe(SE_TEM_SEGREDO);
  });

  it("depois da volta, confere /api/health em produção (o último passo)", () => {
    expect(passos.at(-1)?.campos.name).toBe(SAUDE);
    expect(passos.at(-1)?.run).toContain(
      "curl -fsS https://rifa-videira-kids.madruga.workers.dev/api/health",
    );
    expect(passos.at(-1)?.run).toContain("exit 1");
  });
});
