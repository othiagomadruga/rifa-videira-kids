// RIFA-021 (D18 em docs/decisions.md): confere o build que vai para a publicação ANTES de o token da
// Cloudflare entrar. Roda no job "ci" (logo depois do build, antes de guardar o artefato) e no job
// "publicar" (depois de baixar o artefato, num passo sem o token): `node scripts/conferir-artefato.mjs`.
//
// O `wrangler deploy` segue o dist/rifa_videira_kids/wrangler.json que o @cloudflare/vite-plugin gera no
// build. Um build adulterado poderia pôr ali um `build.command` (o wrangler deploy o executa, com o token no
// ambiente), um binding para outro recurso da conta ou outra pasta de migrations. Por isso a configuração
// gerada tem de ser a do wrangler.jsonc do checkout, lida pelo próprio wrangler, com só as diferenças que o
// plugin introduz. O redirecionamento .wrangler/deploy/config.json não viaja no artefato (que só pode
// escrever dentro de dist/): este script o escreve, com o conteúdo fixo que o plugin grava.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { unstable_readConfig } from "wrangler";

/** Configuração que o plugin gera no build e que o `wrangler deploy` segue (pelo redirecionamento). */
export const CONFIG_GERADA = "dist/rifa_videira_kids/wrangler.json";

/** Redirecionamento do wrangler para a configuração gerada. */
export const REDIRECIONAMENTO = ".wrangler/deploy/config.json";

/** O que o plugin grava no redirecionamento (conferido no build da RIFA-021). */
export const CONTEUDO_DO_REDIRECIONAMENTO = {
  configPath: "../../dist/rifa_videira_kids/wrangler.json",
  auxiliaryWorkers: [],
};

/** Chaves que o wrangler troca pelo caminho real do arquivo ao lê-lo (o build grava o da máquina dele). */
const CHAVES_DE_CAMINHO = new Set(["configPath", "userConfigPath"]);

/** Segredo local (o plugin copia .dev.vars e .env para o dist, para o `vite preview`). */
const SEGREDO_LOCAL = /^\.(dev\.vars|env)(\.|$)/;

/**
 * A configuração que o build deve gerar a partir do wrangler.jsonc lido pelo wrangler: a mesma, com só o que
 * o plugin muda (conferido na RIFA-021 com o wrangler 4.156.1 e o plugin 1.67.0, que sobem juntos, D4): o
 * Worker já empacotado (index.js, no_bundle, a regra de módulos ES e os source maps), os assets em ../client
 * e as migrations com o caminho a partir de dist/rifa_videira_kids. `build`, `define` e `unsafe` (do
 * empacotamento do próprio wrangler) o plugin não grava. Se uma versão nova mudar isso, a conferência
 * falha aqui (no portão local da subida, antes da main, ou no job "ci"): ajuste esta função junto com a subida.
 */
export function configEsperada(lida, raiz = ".") {
  const {
    build: _build,
    define: _define,
    unsafe: _unsafe,
    ...resto
  } = JSON.parse(JSON.stringify(lida));
  const pastaDoWorker = join(raiz, dirname(CONFIG_GERADA));
  return {
    ...resto,
    main: "index.js",
    no_bundle: true,
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    upload_source_maps: true,
    assets: { ...resto.assets, directory: "../client" },
    d1_databases: (resto.d1_databases ?? []).map((banco) =>
      banco.migrations_dir === undefined
        ? banco
        : {
            ...banco,
            migrations_dir: relative(
              pastaDoWorker,
              join(raiz, banco.migrations_dir),
            ),
          },
    ),
  };
}

/** Chaves de primeiro nível em que a configuração gerada difere da esperada (as de caminho não contam). */
export function diferencas(gerada, esperada) {
  const chaves = new Set([...Object.keys(gerada), ...Object.keys(esperada)]);
  return [...chaves]
    .filter(
      (chave) =>
        !CHAVES_DE_CAMINHO.has(chave) &&
        !isDeepStrictEqual(gerada[chave], esperada[chave]),
    )
    .sort();
}

function lerJson(caminho) {
  try {
    return JSON.parse(readFileSync(caminho, "utf8"));
  } catch {
    return undefined;
  }
}

/** O wrangler.jsonc como o wrangler o lê (o mesmo leitor do `wrangler deploy`). */
function lerConfigDoWrangler(caminho) {
  return unstable_readConfig({ config: caminho });
}

/** Problemas do build em `raiz` (vazio: pode publicar). Não escreve nada. */
export function conferirArtefato(raiz, lerConfig = lerConfigDoWrangler) {
  const gerada = lerJson(join(raiz, CONFIG_GERADA));
  if (gerada === undefined)
    return [
      `${CONFIG_GERADA} não existe ou não é JSON: falta o build (npm run build) ou o artefato.`,
    ];
  if (typeof gerada !== "object" || gerada === null || Array.isArray(gerada))
    return [`${CONFIG_GERADA} não é um objeto.`];

  const problemas = diferencas(
    gerada,
    configEsperada(lerConfig(join(raiz, "wrangler.jsonc")), raiz),
  ).map(
    (chave) =>
      `${CONFIG_GERADA}: "${chave}" difere do que o wrangler.jsonc gera no build.`,
  );

  // No job "ci", o redirecionamento é o do plugin e tem de ser o conhecido; no "publicar" ele não vem.
  const redirecionamento = join(raiz, REDIRECIONAMENTO);
  if (
    existsSync(redirecionamento) &&
    !isDeepStrictEqual(lerJson(redirecionamento), CONTEUDO_DO_REDIRECIONAMENTO)
  )
    problemas.push(`${REDIRECIONAMENTO} difere do que o plugin grava.`);

  for (const arquivo of readdirSync(join(raiz, "dist"), { recursive: true }))
    if (SEGREDO_LOCAL.test(basename(String(arquivo))))
      problemas.push(`dist/${arquivo}: segredo local dentro do build.`);
  return problemas;
}

/** Confere o build e, se estiver certo, escreve o redirecionamento. Devolve o código de saída. */
export function principal(raiz = process.cwd(), lerConfig) {
  const problemas = conferirArtefato(raiz, lerConfig);
  if (problemas.length > 0) {
    for (const problema of problemas) console.error(`::error::${problema}`);
    return 1;
  }
  mkdirSync(join(raiz, dirname(REDIRECIONAMENTO)), { recursive: true });
  writeFileSync(
    join(raiz, REDIRECIONAMENTO),
    JSON.stringify(CONTEUDO_DO_REDIRECIONAMENTO),
  );
  console.log(
    `Build conferido: ${CONFIG_GERADA} segue o wrangler.jsonc; ${REDIRECIONAMENTO} escrito.`,
  );
  return 0;
}

/** true quando este arquivo é o programa principal (`node scripts/conferir-artefato.mjs`), e não um import. */
function executadoDiretamente() {
  const caminho = process.argv[1];
  if (!caminho) return false;
  try {
    return (
      realpathSync(caminho) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (executadoDiretamente()) process.exitCode = principal();
