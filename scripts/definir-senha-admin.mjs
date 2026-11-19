#!/usr/bin/env node
/**
 * Senha de login de um admin pela linha de comando (RIFA-073; docs/decisions.md D33 e docs/acesso.md, seção 11): define
 * ou troca o usuário e a senha de um admin QUE JÁ EXISTE, direto no D1, sem passar pela API (que exige o admin
 * conectado). É o caminho da coordenação para criar o login do PO logo depois da publicação; o admin também pode
 * fazer pela tela "Minha senha".
 *
 *   npm run acesso:senha -- --admin 1 --usuario pastor.joao
 *   npm run acesso:senha -- --admin "Fulano de Tal" --usuario pastor.joao --remote
 *
 * - A SENHA VEM DO STDIN, nunca de argumento (o argumento iria para o histórico do shell e para a lista de processos).
 *   Num terminal, ela é pedida duas vezes, sem aparecer na tela; num pipe, vale a primeira linha
 *   (`printf '%s\n' "$SENHA" | npm run acesso:senha -- ...`, com a variável lida de um lugar seguro).
 * - Sem --remote: D1 local de desenvolvimento (.wrangler/state). Com --remote: D1 de produção (precisa de
 *   `npx wrangler login` e de `npm run db:migrate:remote`).
 * - Grava só o PBKDF2-SHA256 da senha (sal aleatório, 100.000 iterações; o mesmo de src/worker/lib/senha.ts, um teste
 *   confere), zera o bloqueio por erros, encerra as sessões do admin abertas pela senha antiga (as do link continuam) e
 *   deixa a linha na trilha (`senha_admin.definir` ou `senha_admin.trocar`, autor = o próprio admin), sem a senha.
 * - Não imprime a senha nem o hash.
 *
 * Roda `wrangler d1 execute DB --local|--remote --json --command "<SQL>"` com o wrangler do projeto, sem shell. Os
 * valores que entram no SQL passam por listas de caracteres permitidos e as aspas simples são dobradas. As funções
 * exportadas são testadas em src/worker/test/definir-senha-admin.test.ts.
 */

// Iguais a src/shared/contracts/senha-admin.ts e src/worker/lib/senha.ts; um teste confere.
export const MINIMO_SENHA_ADMIN = 10;
export const MAXIMO_SENHA_ADMIN = 128;
export const FORMATO_USUARIO_ADMIN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
export const ITERACOES_SENHA = 100_000;
export const BYTES_SAL_SENHA = 16;

const NOME_PERMITIDO = /^\p{L}[\p{L}\p{M}\p{N} .'’-]*$/u;
const HEX = (tamanho) => new RegExp(`^[0-9a-f]{${tamanho}}$`);

export const USO = `Uso: npm run acesso:senha -- --admin <id|nome> --usuario <login> [--remote]

  --admin     o admin que já existe: o número (id) ou o nome exato, como aparece em Acessos
  --usuario   o usuário de login: de 3 a 40 caracteres, letras sem acento, números, ponto, hífen ou sublinhado
  --remote    grava no D1 de produção (sem esta opção, no D1 local de desenvolvimento)

A senha é lida do teclado (duas vezes, sem aparecer) ou da primeira linha da entrada padrão. Nunca a passe como
argumento. Mínimo de ${MINIMO_SENHA_ADMIN} caracteres, diferente do usuário.`;

/** Erro de uso da linha de comando: a mensagem vai para a pessoa, junto com o USO. */
export class ErroDeUso extends Error {}

/** O usuário de login como é gravado: sem espaços nas pontas, em minúsculas, no formato combinado. */
export function validarUsuario(usuario) {
  const limpo = typeof usuario === "string" ? usuario.trim().toLowerCase() : "";
  if (!FORMATO_USUARIO_ADMIN.test(limpo))
    throw new ErroDeUso(
      "--usuario deve ter de 3 a 40 caracteres: letras sem acento, números, ponto, hífen ou sublinhado, começando por letra ou número",
    );
  return limpo;
}

/** O admin pelo id (número) ou pelo nome exato. */
export function validarAdmin(admin) {
  const limpo =
    typeof admin === "string" ? admin.trim().replace(/\s+/g, " ") : "";
  if (/^[1-9][0-9]{0,9}$/.test(limpo)) return { id: Number(limpo) };
  if (limpo.length > 0 && limpo.length <= 120 && NOME_PERMITIDO.test(limpo))
    return { nome: limpo };
  throw new ErroDeUso(
    "--admin é o número do admin ou o nome dele (letras, números, espaço, ponto, hífen e apóstrofo)",
  );
}

/** O problema da senha (a mesma regra de problemaDaSenhaAdmin do contrato), ou null. */
export function problemaDaSenha(senha, usuario) {
  const tamanho = [...senha].length;
  if (tamanho < MINIMO_SENHA_ADMIN)
    return `a senha precisa ter pelo menos ${MINIMO_SENHA_ADMIN} caracteres`;
  if (tamanho > MAXIMO_SENHA_ADMIN)
    return `a senha pode ter no máximo ${MAXIMO_SENHA_ADMIN} caracteres`;
  if (senha.trim().toLowerCase() === usuario.trim().toLowerCase())
    return "a senha não pode ser igual ao usuário";
  return null;
}

/** Lê as opções. Senha como argumento é recusada (ela iria para o histórico do shell). */
export function lerArgumentos(argv) {
  const opcoes = { admin: undefined, usuario: undefined, remoto: false };
  const destinos = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const argumento = argv[i];
    const igual = argumento.startsWith("--") ? argumento.indexOf("=") : -1;
    const chave = igual === -1 ? argumento : argumento.slice(0, igual);
    const valor = () => {
      if (igual !== -1) return argumento.slice(igual + 1);
      const proximo = argv[i + 1];
      if (proximo === undefined || proximo.startsWith("--"))
        throw new ErroDeUso(`${chave} precisa de um valor`);
      i += 1;
      return proximo;
    };
    const semValor = () => {
      if (igual !== -1)
        throw new ErroDeUso(`${chave} não aceita valor: use só ${chave}`);
    };
    switch (chave) {
      case "--admin":
        opcoes.admin = valor();
        break;
      case "--usuario":
        opcoes.usuario = valor();
        break;
      case "--senha":
        throw new ErroDeUso(
          "a senha não vai como argumento (iria para o histórico do shell): ela é pedida depois, ou lida da entrada padrão",
        );
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
  if (opcoes.admin === undefined)
    throw new ErroDeUso("informe --admin <id|nome>");
  if (opcoes.usuario === undefined)
    throw new ErroDeUso("informe --usuario <login>");
  return {
    ajuda: false,
    admin: validarAdmin(opcoes.admin),
    usuario: validarUsuario(opcoes.usuario),
    remoto: opcoes.remoto,
  };
}

function emHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function deHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** PBKDF2-SHA256 da senha (NFC), em hex: igual a hashDaSenha de src/worker/lib/senha.ts. */
export async function hashDaSenha(senha, salHex, iteracoes = ITERACOES_SENHA) {
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(senha.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: deHex(salHex),
      iterations: iteracoes,
    },
    chave,
    256,
  );
  return emHex(new Uint8Array(bits));
}

/** Sal novo e hash, para gravar. */
export async function prepararSenha(senha) {
  const sal = emHex(crypto.getRandomValues(new Uint8Array(BYTES_SAL_SENHA)));
  return {
    sal,
    hash: await hashDaSenha(senha, sal),
    iteracoes: ITERACOES_SENHA,
  };
}

/** Literal de texto do SQLite: as aspas simples são dobradas. */
function textoSql(valor) {
  return `'${valor.replaceAll("'", "''")}'`;
}

/** A consulta do admin (pelo id ou pelo nome) e de quem já usa o login. Um comando por linha. */
export function montarConsulta({ admin, usuario }) {
  const alvo = validarAdmin("id" in admin ? String(admin.id) : admin.nome);
  const login = validarUsuario(usuario);
  const onde =
    "id" in alvo ? `u.id = ${alvo.id}` : `u.nome = ${textoSql(alvo.nome)}`;
  return [
    `SELECT u.id, u.nome, u.papel, u.ativo, (SELECT count(*) FROM senhas_admin WHERE usuario_id = u.id) AS tem_senha FROM usuarios AS u WHERE ${onde};`,
    `SELECT usuario_id FROM senhas_admin WHERE usuario = ${textoSql(login)};`,
  ];
}

/**
 * Os comandos da gravação, um por linha, para o admin `usuarioId` (conferido antes): grava (UPDATE ou INSERT), zera o
 * bloqueio, encerra as sessões abertas pela senha, registra na trilha e confirma com um SELECT (sem o hash).
 */
export function montarGravacao({ usuarioId, usuario, senha, trocar }) {
  if (!Number.isInteger(usuarioId) || usuarioId < 1)
    throw new Error("usuarioId deve ser um inteiro positivo");
  const login = validarUsuario(usuario);
  if (!HEX(32).test(senha.sal) || !HEX(64).test(senha.hash))
    throw new Error("sal e hash devem estar em hex");
  if (!Number.isInteger(senha.iteracoes) || senha.iteracoes < ITERACOES_SENHA)
    throw new Error("iterações abaixo do mínimo");
  const agora = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const ehAdmin = `EXISTS (SELECT 1 FROM usuarios WHERE id = ${usuarioId} AND papel = 'admin' AND ativo = 1)`;
  const valores = `${textoSql(login)}, ${textoSql(senha.sal)}, ${textoSql(senha.hash)}, ${senha.iteracoes}`;
  const resumo = trocar
    ? "Senha de login do administrador trocada pelo script acesso:senha; as sessões abertas pela senha foram encerradas"
    : "Senha de login do administrador definida pelo script acesso:senha";
  return [
    `UPDATE senhas_admin SET usuario = ${textoSql(login)}, sal = ${textoSql(senha.sal)}, hash = ${textoSql(senha.hash)}, iteracoes = ${senha.iteracoes}, atualizada_em = ${agora}, falhas = 0, bloqueada_ate = NULL WHERE usuario_id = ${usuarioId} AND ${ehAdmin};`,
    `INSERT INTO senhas_admin (usuario_id, usuario, sal, hash, iteracoes, criada_em, atualizada_em) SELECT ${usuarioId}, ${valores}, ${agora}, ${agora} WHERE ${ehAdmin} AND NOT EXISTS (SELECT 1 FROM senhas_admin WHERE usuario_id = ${usuarioId});`,
    `DELETE FROM sessoes WHERE usuario_id = ${usuarioId} AND link_id IS NULL;`,
    `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo) SELECT ${usuarioId}, ${agora}, ${textoSql(trocar ? "senha_admin.trocar" : "senha_admin.definir")}, 'usuario:${usuarioId}', ${textoSql(resumo)} WHERE EXISTS (SELECT 1 FROM senhas_admin WHERE usuario_id = ${usuarioId} AND hash = ${textoSql(senha.hash)});`,
    `SELECT usuario_id, usuario, atualizada_em FROM senhas_admin WHERE usuario_id = ${usuarioId} AND hash = ${textoSql(senha.hash)};`,
  ];
}

/** Os resultados de cada comando na saída `--json` do wrangler (null se ela não é o JSON esperado). */
export function lerResultados(saidaJson) {
  let resultados;
  try {
    resultados = JSON.parse(saidaJson);
  } catch {
    return null;
  }
  if (!Array.isArray(resultados)) return null;
  return resultados.map((item) =>
    Array.isArray(item?.results) ? item.results : [],
  );
}

/**
 * Lê a senha: num terminal, duas vezes e sem eco; fora dele, a primeira linha da entrada padrão. Devolve a senha, ou
 * lança ErroDeUso se as duas digitações não batem ou se não veio nada.
 */
async function lerSenhaDoStdin(escreverErro) {
  const { stdin } = process;
  if (!stdin.isTTY) {
    let texto = "";
    stdin.setEncoding("utf8");
    for await (const pedaco of stdin) {
      texto += pedaco;
      if (texto.includes("\n")) break;
    }
    const senha = texto.split(/\r?\n/)[0] ?? "";
    if (senha === "") throw new ErroDeUso("nenhuma senha na entrada padrão");
    return senha;
  }
  const perguntar = (pergunta) =>
    new Promise((resolver, rejeitar) => {
      process.stderr.write(pergunta);
      let digitado = "";
      stdin.setRawMode(true);
      stdin.setEncoding("utf8");
      stdin.resume();
      const aoTeclar = (tecla) => {
        for (const caractere of tecla) {
          if (caractere === "\r" || caractere === "\n") {
            terminar();
            resolver(digitado);
            return;
          }
          if (caractere === "\u0003") {
            terminar();
            rejeitar(new ErroDeUso("cancelado"));
            return;
          }
          if (caractere === "\u007f" || caractere === "\b")
            digitado = [...digitado].slice(0, -1).join("");
          else digitado += caractere;
        }
      };
      const terminar = () => {
        stdin.off("data", aoTeclar);
        stdin.setRawMode(false);
        stdin.pause();
        process.stderr.write("\n");
      };
      stdin.on("data", aoTeclar);
    });
  const senha = await perguntar("Senha nova (não aparece na tela): ");
  const confirmacao = await perguntar("Repita a senha: ");
  if (senha !== confirmacao) {
    escreverErro("As duas senhas não são iguais.");
    throw new ErroDeUso("as duas senhas digitadas não são iguais");
  }
  return senha;
}

/**
 * O programa: devolve o código de saída (0 = ok, 1 = falha ao ler ou gravar, 2 = uso errado). `executarWrangler`
 * recebe os argumentos do wrangler e devolve { status, stdout, stderr }; `lerSenha` devolve a senha. Os testes trocam
 * os dois.
 */
export async function principal({
  argv,
  executarWrangler,
  lerSenha,
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
  const destino = opcoes.remoto ? "--remote" : "--local";
  const onde = `D1 ${opcoes.remoto ? "remoto" : "local"}`;
  const executar = (comandos) =>
    executarWrangler([
      "d1",
      "execute",
      "DB",
      destino,
      "--json",
      "--command",
      comandos.join("\n"),
    ]);
  const falhaDoWrangler = (resultado) => {
    const migrar = opcoes.remoto
      ? "npm run db:migrate:remote"
      : "npm run db:migrate:local";
    escreverErro(
      [
        `Erro: não foi possível ler ou gravar no ${onde}.`,
        `Confira se as migrações foram aplicadas (${migrar})${opcoes.remoto ? " e se o wrangler está logado (npx wrangler login)" : ""}.`,
        "",
        "Saída do wrangler:",
        (resultado.stderr || resultado.stdout || "(vazia)").trim(),
      ].join("\n"),
    );
    return 1;
  };

  // 1. O admin e quem já usa o login, antes de pedir a senha.
  const consulta = await executar(montarConsulta(opcoes));
  const lidos = consulta.status === 0 ? lerResultados(consulta.stdout) : null;
  if (lidos === null || lidos.length < 2) return falhaDoWrangler(consulta);
  const [admins, donosDoLogin] = lidos;
  if (admins.length !== 1) {
    escreverErro(
      admins.length === 0
        ? `Erro: nenhum usuário com ${"id" in opcoes.admin ? `o id ${opcoes.admin.id}` : "esse nome"} no ${onde}.`
        : `Erro: mais de um usuário com esse nome no ${onde}: use --admin <id> (o número aparece em Acessos).`,
    );
    return 1;
  }
  const [admin] = admins;
  if (admin.papel !== "admin" || admin.ativo !== 1) {
    escreverErro(
      `Erro: o usuário ${admin.id} não é um admin ativo. Só o papel admin tem usuário e senha de login.`,
    );
    return 1;
  }
  if (donosDoLogin.some((linha) => linha.usuario_id !== admin.id)) {
    escreverErro(
      `Erro: o usuário de login "${opcoes.usuario}" já é de outro admin: escolha outro.`,
    );
    return 1;
  }

  // 2. A senha, só agora (nunca de argumento).
  let senha;
  try {
    senha = await lerSenha();
  } catch (erro) {
    escreverErro(
      `Erro: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
    return erro instanceof ErroDeUso ? 2 : 1;
  }
  const problema = problemaDaSenha(senha, opcoes.usuario);
  if (problema !== null) {
    escreverErro(`Erro: ${problema}. Nada foi gravado.`);
    return 2;
  }

  // 3. A gravação, só com o hash.
  const trocar = admin.tem_senha > 0;
  const gravacao = await executar(
    montarGravacao({
      usuarioId: admin.id,
      usuario: opcoes.usuario,
      senha: await prepararSenha(senha),
      trocar,
    }),
  );
  const gravados =
    gravacao.status === 0 ? lerResultados(gravacao.stdout) : null;
  const confirmacao = gravados?.at(-1)?.[0];
  if (
    confirmacao === undefined ||
    confirmacao.usuario_id !== admin.id ||
    confirmacao.usuario !== opcoes.usuario
  )
    return falhaDoWrangler(gravacao);

  escrever(
    [
      `Senha ${trocar ? "trocada" : "definida"} no ${onde}: admin ${admin.id} (${admin.nome}), usuário de login "${confirmacao.usuario}".`,
      "Para entrar: tela Entrar → Sou administrador → usuário e senha.",
      trocar
        ? "As sessões abertas pela senha antiga foram encerradas; o link pessoal continua valendo."
        : "O link pessoal continua valendo.",
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
    // O stdin do wrangler não é o nosso: a senha já foi lida e não passa para ele.
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (execucao.error) throw execucao.error;
  return {
    status: execucao.status ?? 1,
    stdout: execucao.stdout,
    stderr: execucao.stderr,
  };
}

/** true quando este arquivo é o programa principal, e não um import. */
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
      lerSenha: () => lerSenhaDoStdin(console.error),
    });
  } catch (erro) {
    console.error(
      `Erro: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
    process.exitCode = 1;
  }
}
