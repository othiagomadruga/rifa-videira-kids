#!/usr/bin/env node
/**
 * Primeiro acesso (RIFA-007): cria um usuário com um link pessoal direto no D1, sem passar pela API (que
 * exige um admin conectado). Documentação: docs/acesso.md.
 *
 *   npm run acesso:criar -- --nome "Fulano de Tal" --papel admin
 *   npm run acesso:criar -- --nome "Fulano de Tal" --papel admin --remote --origem https://rifa.exemplo.org
 *
 * - Sem --remote: grava no D1 local de desenvolvimento (.wrangler/state; antes, `npm run db:migrate:local`)
 *   e o link usa http://localhost:5173, o endereço do `npm run dev` (troque com --origem).
 * - Com --remote: grava no D1 de produção (precisa de `npx wrangler login` e de `npm run db:migrate:remote`);
 *   --origem https://... é obrigatória.
 * - Grava só o SHA-256 do token e imprime o link uma vez: quem tiver o link entra como esse usuário.
 *
 * Roda `wrangler d1 execute DB --local|--remote --json --command "<SQL>"` com o wrangler do projeto (o mesmo
 * do `npx wrangler`), sem shell. O nome passa por uma lista de caracteres permitidos e as aspas simples são
 * dobradas no SQL. As funções exportadas são testadas em src/worker/test/criar-acesso.test.ts.
 */

export const PAPEIS = ["admin", "coordenacao"];
// Igual a VALIDADE_LINK_DIAS do contrato (src/shared/contracts/acesso.ts); um teste confere.
export const VALIDADE_LINK_DIAS = 45;
export const ORIGEM_LOCAL = "http://localhost:5173";
export const PREFIXO_LINK_ACESSO = "/acesso/";

/** Começa por letra; depois letras (com acento), números, espaço, ponto, hífen e apóstrofo. */
const NOME_PERMITIDO = /^\p{L}[\p{L}\p{M}\p{N} .'’-]*$/u;
const HASH_SHA256 = /^[0-9a-f]{64}$/;

export const USO = `Uso: npm run acesso:criar -- --nome "<nome>" --papel admin|coordenacao [--remote] [--origem https://...]

  --nome     nome da pessoa: letras, números, espaço, ponto, hífen e apóstrofo (até 120 caracteres)
  --papel    admin (também cria usuários e links) ou coordenacao
  --remote   grava no D1 de produção (sem esta opção, no D1 local de desenvolvimento)
  --origem   endereço do site que vai no link (padrão: ${ORIGEM_LOCAL}; obrigatória com --remote)`;

/** Erro de uso da linha de comando: a mensagem vai para a pessoa, junto com o USO. */
export class ErroDeUso extends Error {}

export function validarNome(nome) {
  const limpo =
    typeof nome === "string" ? nome.trim().replace(/\s+/g, " ") : "";
  if (limpo.length === 0 || limpo.length > 120 || !NOME_PERMITIDO.test(limpo)) {
    throw new ErroDeUso(
      "--nome aceita letras, números, espaço, ponto, hífen e apóstrofo (até 120 caracteres), começando por letra",
    );
  }
  return limpo;
}

export function validarPapel(papel) {
  if (!PAPEIS.includes(papel)) {
    throw new ErroDeUso(`--papel deve ser ${PAPEIS.join(" ou ")}`);
  }
  return papel;
}

/** A origem do site (`https://host[:porta]`), sem caminho. No D1 remoto, só https. */
export function normalizarOrigem(origem, remoto = false) {
  let url;
  try {
    url = new URL(origem);
  } catch {
    throw new ErroDeUso(
      "--origem deve ser uma URL, como https://rifa.exemplo.org",
    );
  }
  const protocolos = remoto ? ["https:"] : ["https:", "http:"];
  if (!protocolos.includes(url.protocol)) {
    throw new ErroDeUso(
      remoto
        ? "--origem do D1 remoto deve começar com https://"
        : "--origem deve começar com https:// ou http://",
    );
  }
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new ErroDeUso(
      "--origem é só o endereço do site, sem caminho (ex.: https://rifa.exemplo.org)",
    );
  }
  return url.origin;
}

/**
 * Lê as opções da linha de comando. Opção desconhecida, faltando ou com valor onde não cabe: ErroDeUso.
 * As flags (--remote, --local, --help) não aceitam valor: `--remote=false` é erro, e não liga o D1 remoto.
 */
export function lerArgumentos(argv) {
  const opcoes = {
    nome: undefined,
    papel: undefined,
    remoto: false,
    origem: undefined,
  };
  const destinos = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const argumento = argv[i];
    const igual = argumento.startsWith("--") ? argumento.indexOf("=") : -1;
    const chave = igual === -1 ? argumento : argumento.slice(0, igual);
    const valor = () => {
      if (igual !== -1) return argumento.slice(igual + 1);
      const proximo = argv[i + 1];
      if (proximo === undefined || proximo.startsWith("--")) {
        throw new ErroDeUso(`${chave} precisa de um valor`);
      }
      i += 1;
      return proximo;
    };
    const semValor = () => {
      if (igual !== -1) {
        throw new ErroDeUso(`${chave} não aceita valor: use só ${chave}`);
      }
    };
    switch (chave) {
      case "--nome":
        opcoes.nome = valor();
        break;
      case "--papel":
        opcoes.papel = valor();
        break;
      case "--origem":
        opcoes.origem = valor();
        break;
      case "--remote":
      case "--local":
        semValor();
        destinos.add(chave);
        opcoes.remoto = chave === "--remote";
        break;
      case "--help":
      case "-h":
        semValor();
        return { ajuda: true };
      default:
        throw new ErroDeUso(`opção desconhecida: ${chave}`);
    }
  }
  if (destinos.size > 1)
    throw new ErroDeUso("use --local ou --remote, não os dois");
  if (opcoes.nome === undefined) throw new ErroDeUso("informe --nome");
  if (opcoes.papel === undefined)
    throw new ErroDeUso("informe --papel admin ou --papel coordenacao");
  if (opcoes.remoto && opcoes.origem === undefined) {
    throw new ErroDeUso(
      "com --remote, informe --origem https://<endereço do site>",
    );
  }
  return {
    ajuda: false,
    nome: validarNome(opcoes.nome),
    papel: validarPapel(opcoes.papel),
    remoto: opcoes.remoto,
    origem: normalizarOrigem(opcoes.origem ?? ORIGEM_LOCAL, opcoes.remoto),
  };
}

/** Token do link: 32 bytes de crypto.getRandomValues em base64url sem "=" (igual a src/worker/lib/cripto.ts). */
export function gerarToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** SHA-256 em hex minúsculo (igual a src/worker/lib/cripto.ts): é o que vai para o banco. */
export async function sha256Hex(texto) {
  const resumo = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return Array.from(new Uint8Array(resumo), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Literal de texto do SQLite: as aspas simples são dobradas (o SQLite não tem outro escape). */
function textoSql(valor) {
  return `'${valor.replaceAll("'", "''")}'`;
}

/**
 * Os comandos SQL, um por linha: cria o usuário, cria o link (com o hash, nunca o token) e confirma a
 * gravação com um SELECT. Os valores são validados de novo aqui, porque entram no texto do SQL.
 */
export function montarComandos({
  nome,
  papel,
  tokenHash,
  diasValidade = VALIDADE_LINK_DIAS,
}) {
  const nomeSeguro = validarNome(nome);
  const papelSeguro = validarPapel(papel);
  if (!HASH_SHA256.test(tokenHash))
    throw new Error("tokenHash deve ser um SHA-256 em hex");
  if (
    !Number.isInteger(diasValidade) ||
    diasValidade < 1 ||
    diasValidade > 365
  ) {
    throw new Error("diasValidade deve ser um inteiro de 1 a 365");
  }
  const expiraEm = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${diasValidade} days')`;
  return [
    `INSERT INTO usuarios (nome, papel) VALUES (${textoSql(nomeSeguro)}, ${textoSql(papelSeguro)});`,
    `INSERT INTO links_acesso (usuario_id, token_hash, expira_em) VALUES (last_insert_rowid(), ${textoSql(tokenHash)}, ${expiraEm});`,
    `SELECT u.id AS usuario_id, u.nome, u.papel, l.id AS link_id, l.expira_em FROM links_acesso AS l JOIN usuarios AS u ON u.id = l.usuario_id WHERE l.token_hash = ${textoSql(tokenHash)};`,
  ];
}

/** Gera o token e monta o link e os comandos SQL. */
export async function prepararAcesso({
  nome,
  papel,
  origem,
  diasValidade = VALIDADE_LINK_DIAS,
}) {
  const token = gerarToken();
  const tokenHash = await sha256Hex(token);
  return {
    token,
    tokenHash,
    link: `${origem}${PREFIXO_LINK_ACESSO}${token}`,
    comandos: montarComandos({ nome, papel, tokenHash, diasValidade }),
  };
}

/** A linha do SELECT de confirmação na saída `--json` do wrangler (null se não veio exatamente uma). */
export function lerConfirmacao(saidaJson) {
  let resultados;
  try {
    resultados = JSON.parse(saidaJson);
  } catch {
    return null;
  }
  if (!Array.isArray(resultados) || resultados.length === 0) return null;
  const linhas = resultados[resultados.length - 1]?.results;
  return Array.isArray(linhas) && linhas.length === 1 ? linhas[0] : null;
}

/**
 * O programa: devolve o código de saída (0 = ok, 1 = falha ao gravar, 2 = uso errado). `executarWrangler`
 * recebe os argumentos do wrangler e devolve { status, stdout, stderr }; os testes trocam por um D1 de teste.
 */
export async function principal({
  argv,
  executarWrangler,
  escrever = console.log,
  escreverErro = console.error,
}) {
  let opcoes;
  try {
    opcoes = lerArgumentos(argv);
  } catch (erro) {
    if (!(erro instanceof ErroDeUso)) throw erro;
    escreverErro(`Erro: ${erro.message}\n\n${USO}`);
    return 2;
  }
  if (opcoes.ajuda) {
    escrever(USO);
    return 0;
  }

  const acesso = await prepararAcesso(opcoes);
  const destino = opcoes.remoto ? "--remote" : "--local";
  const resultado = await executarWrangler([
    "d1",
    "execute",
    "DB",
    destino,
    "--json",
    "--command",
    acesso.comandos.join("\n"),
  ]);
  const confirmacao =
    resultado.status === 0 ? lerConfirmacao(resultado.stdout) : null;
  if (
    confirmacao === null ||
    confirmacao.nome !== opcoes.nome ||
    confirmacao.papel !== opcoes.papel
  ) {
    const migrar = opcoes.remoto
      ? "npm run db:migrate:remote"
      : "npm run db:migrate:local";
    escreverErro(
      [
        `Erro: o acesso não foi gravado no D1 ${opcoes.remoto ? "remoto" : "local"}.`,
        `Confira se as migrações foram aplicadas (${migrar})${opcoes.remoto ? " e se o wrangler está logado (npx wrangler login)" : ""}.`,
        "",
        "Saída do wrangler:",
        (resultado.stderr || resultado.stdout || "(vazia)").trim(),
      ].join("\n"),
    );
    return 1;
  }

  escrever(
    [
      `Acesso criado no D1 ${opcoes.remoto ? "remoto" : "local"}: ${confirmacao.nome} (${confirmacao.papel}), usuário ${confirmacao.usuario_id}.`,
      "",
      `  ${acesso.link}`,
      "",
      `O link vale até ${confirmacao.expira_em} (UTC) e pode ser aberto mais de uma vez nesse prazo.`,
      "Ele não será mostrado de novo. Mande só para a própria pessoa: quem tiver o link entra como ela.",
    ].join("\n"),
  );
  return 0;
}

/** Roda o wrangler instalado no projeto (o mesmo do `npx wrangler`), na raiz do projeto e sem shell. */
async function executarWranglerDoProjeto(argumentos) {
  const { spawnSync } = await import("node:child_process");
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const exigir = createRequire(import.meta.url);
  const pacote = exigir("wrangler/package.json");
  const binario = join(
    dirname(exigir.resolve("wrangler/package.json")),
    pacote.bin.wrangler,
  );
  const execucao = spawnSync(process.execPath, [binario, ...argumentos], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (execucao.error) throw execucao.error;
  return {
    status: execucao.status ?? 1,
    stdout: execucao.stdout,
    stderr: execucao.stderr,
  };
}

/** true quando este arquivo é o programa principal (`node scripts/criar-acesso.mjs`), e não um import. */
async function executadoDiretamente() {
  const caminho = globalThis.process?.argv?.[1];
  if (!caminho) return false;
  const { realpathSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  try {
    return (
      realpathSync(caminho) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (await executadoDiretamente()) {
  try {
    process.exitCode = await principal({
      argv: process.argv.slice(2),
      executarWrangler: executarWranglerDoProjeto,
    });
  } catch (erro) {
    console.error(
      `Erro: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
    process.exitCode = 1;
  }
}
