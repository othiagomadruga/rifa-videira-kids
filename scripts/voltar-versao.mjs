// RIFA-035 (D22 em docs/decisions.md): volta o código do site (o Worker na Cloudflare) para uma versão anterior.
// Roda no workflow "Voltar o site para a versão anterior" (.github/workflows/voltar-versao.yml), no único passo
// com o token da Cloudflare: `node scripts/voltar-versao.mjs`, com as entradas do workflow em MOTIVO e VERSAO
// (vazio: a versão anterior à que está no ar, pela mesma regra do `wrangler rollback`; se a versão no ar já é uma
// volta, para com erro em vez de desfazê-la). Não mexe no banco.
//
// Por que não o `wrangler rollback`: sem terminal (no CI), o wrangler 4.156.1 responde "sim" sozinho a toda
// pergunta, com ou sem --yes, inclusive a "os segredos mudaram desde aquela versão; continuar?", e volta com os
// segredos de antes (o webhook pode parar ou voltar ao token antigo; lancamento.md 2.4). Provado na RIFA-035
// contra uma API fictícia: recusado, ele repete o pedido com ?force=true (o teste deste script mostra isso). O
// `wrangler versions deploy <id>@100%` faz a mesma publicação (a versão com 100% do tráfego e o motivo como
// mensagem) e nunca manda o ?force=true: com segredos trocados, a Cloudflare recusa (código 10220) e este script
// termina com erro, explicando como escolher a versão pelo id. Testes em scripts/voltar-versao.test.mjs.

import { spawnSync } from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** O `wrangler rollback` pede o motivo com "120 characters max". */
export const MOTIVO_MAXIMO = 120;

/** Id de uma versão do Worker (UUID, como a Cloudflare mostra). */
const ID_DE_VERSAO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** O erro da API quando os segredos mudaram desde a versão pedida (o wrangler escreve "[code: 10220]"). */
export const SEGREDOS_MUDARAM = /\[code: 10220\]/;

/** Caracteres de controle (quebra de linha, tabulação...): o motivo é uma linha só. */
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/;

/** Erro nas entradas do workflow: termina antes de chamar o wrangler. */
export class ErroDoPedido extends Error {}

/** Confere as entradas do workflow. `versao` undefined: a anterior à que está no ar. */
export function lerPedido(env) {
  const motivo = String(env.MOTIVO ?? "").trim();
  if (motivo === "")
    throw new ErroDoPedido('Escreva o motivo da volta no campo "motivo".');
  if (CONTROLE.test(motivo))
    throw new ErroDoPedido("O motivo tem de ser uma linha só.");
  if ([...motivo].length > MOTIVO_MAXIMO)
    throw new ErroDoPedido(
      `O motivo tem ${[...motivo].length} caracteres; o máximo é ${MOTIVO_MAXIMO}.`,
    );
  const versao = String(env.VERSAO ?? "")
    .trim()
    .toLowerCase();
  if (versao !== "" && !ID_DE_VERSAO.test(versao))
    throw new ErroDoPedido(
      'O campo "versao" tem de ficar vazio (a anterior) ou ter o id de uma versão, como 1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.',
    );
  return { motivo, versao: versao === "" ? undefined : versao };
}

/** As publicações da mais nova para a mais antiga. */
function maisNovasPrimeiro(publicacoes) {
  return [...publicacoes].sort((a, b) =>
    String(b.created_on).localeCompare(String(a.created_on)),
  );
}

/** A versão com 100% do tráfego numa publicação (undefined se o tráfego está dividido). */
function versaoInteira(publicacao) {
  return publicacao?.versions?.find((versao) => versao.percentage === 100)
    ?.version_id;
}

/** A versão no ar (100% da publicação mais recente). */
export function versaoNoAr(publicacoes) {
  return versaoInteira(maisNovasPrimeiro(publicacoes)[0]);
}

/**
 * A versão para onde o `wrangler rollback` voltaria (a mesma regra do wrangler 4.156.1): a de 100% da publicação
 * mais recente antes da atual. undefined: não há (o site foi publicado uma vez só).
 */
export function versaoAnterior(publicacoes) {
  for (const publicacao of maisNovasPrimeiro(publicacoes).slice(1)) {
    const versao = versaoInteira(publicacao);
    if (versao) return versao;
  }
  return undefined;
}

/**
 * true quando a versão no ar já tinha estado no ar (com 100%) numa publicação mais antiga da lista: a publicação
 * atual é uma volta. Aí a "anterior" do rollback é a versão que a volta tirou do ar, e rodar de novo sem o id
 * (um toque a mais no celular, um Re-run) desfaria a volta.
 */
export function noArJaVoltou(publicacoes) {
  const [atual, ...antigas] = maisNovasPrimeiro(publicacoes);
  const versao = versaoInteira(atual);
  return (
    versao !== undefined &&
    antigas.some((publicacao) => versaoInteira(publicacao) === versao)
  );
}

/** Texto vindo da Cloudflare numa linha, sem controles nem crases (vai para o log e para o resumo). */
function umaLinha(texto) {
  return String(texto ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replaceAll("`", "'")
    .trim();
}

/**
 * Uma linha por publicação recente, a mais nova primeiro: a data, as versões com o tráfego, a origem (upload,
 * secret, rollback...) e a mensagem. Sem o e-mail de quem publicou.
 */
export function descreverPublicacoes(publicacoes) {
  return maisNovasPrimeiro(publicacoes).map((publicacao, indice) => {
    const versoes = (publicacao.versions ?? [])
      .map((versao) => `${versao.version_id} (${versao.percentage}%)`)
      .join(" + ");
    const origem =
      publicacao.annotations?.["workers/triggered_by"] ??
      publicacao.source ??
      "-";
    const mensagem = umaLinha(publicacao.annotations?.["workers/message"]);
    return `${indice === 0 ? "[no ar]" : "       "} ${umaLinha(publicacao.created_on)}  ${umaLinha(versoes)}  ${umaLinha(origem)}${mensagem ? `: ${mensagem}` : ""}`;
  });
}

/** Roda o wrangler instalado no projeto (o do package-lock.json), na raiz do projeto e sem shell. */
function executarWrangler(argumentos) {
  const execucao = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
      ),
      ...argumentos,
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (execucao.error) throw execucao.error;
  return {
    status: execucao.status ?? 1,
    stdout: execucao.stdout,
    stderr: execucao.stderr,
  };
}

/** Escreve no resumo da execução (a página do run no GitHub, também no celular), se houver. */
function resumir(env, linhas) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${linhas.join("\n")}\n`);
  } catch {
    // O resumo é só conveniência: o log tem o mesmo conteúdo.
  }
}

/**
 * Volta a versão. Devolve o código de saída. `executar` recebe os argumentos do wrangler e devolve
 * { status, stdout, stderr } (os testes trocam por um falso); `escrever` e `avisar` são o stdout e o stderr.
 */
export async function principal({
  env = process.env,
  executar = executarWrangler,
  escrever = (texto) => console.log(texto),
  avisar = (texto) => console.error(texto),
} = {}) {
  let pedido;
  try {
    pedido = lerPedido(env);
  } catch (erro) {
    if (!(erro instanceof ErroDoPedido)) throw erro;
    avisar(`::error::${erro.message}`);
    return 1;
  }

  // As 10 publicações mais recentes (a mesma consulta do `wrangler rollback`). O JSON não vai para o log: tem
  // o e-mail de quem publicou.
  const lista = await executar(["deployments", "list", "--json"]);
  let publicacoes;
  try {
    publicacoes = lista.status === 0 ? JSON.parse(lista.stdout) : undefined;
  } catch {
    publicacoes = undefined;
  }
  if (!Array.isArray(publicacoes)) {
    if (lista.stderr) avisar(lista.stderr);
    avisar(
      "::error::Não foi possível ler as publicações do site na Cloudflare (veja o erro acima). Antes da primeira publicação não existe versão para voltar; depois dela, confira o segredo CLOUDFLARE_API_TOKEN (docs/lancamento.md, 1.2).",
    );
    return 1;
  }

  const descricao = descreverPublicacoes(publicacoes);
  escrever(
    ["Publicações recentes (a mais nova primeiro):", ...descricao].join("\n"),
  );
  const listaNoResumo = [
    "",
    "Publicações recentes (a mais nova primeiro; data, versão, origem e mensagem):",
    "",
    "```",
    ...descricao,
    "```",
  ];

  const noAr = versaoNoAr(publicacoes);
  const alvo = pedido.versao ?? versaoAnterior(publicacoes);
  if (!alvo) {
    avisar(
      '::error::Não existe versão anterior para voltar: o site foi publicado uma vez só (na primeira publicação, só o Time Travel do banco volta algo; docs/lancamento.md, 2.4). Para outra versão, informe o id em "versao".',
    );
    resumir(env, [
      "### Volta da versão: não há versão anterior",
      ...listaNoResumo,
    ]);
    return 1;
  }
  if (alvo === noAr) {
    escrever(
      `::notice::A versão ${alvo} já está no ar com todo o tráfego: nada mudou.`,
    );
    resumir(env, [
      `### A versão \`${alvo}\` já estava no ar`,
      ...listaNoResumo,
    ]);
    return 0;
  }
  // Uma volta já feita: sem o id, a regra do rollback escolheria a versão que ela tirou do ar (o defeito volta).
  if (pedido.versao === undefined && noArJaVoltou(publicacoes)) {
    avisar(
      `::error::O site já está numa versão que voltou (${noAr}, que já tinha estado no ar antes). Com "versao" vazio, a volta seria desfeita e a ${alvo}, que saiu do ar, voltaria. Nada mudou no site. Para desfazer a volta de propósito, rode de novo com ${alvo} em "versao"; para voltar mais, informe em "versao" o id da versão desejada (a lista está no resumo desta execução; docs/lancamento.md, 2.4).`,
    );
    resumir(env, [
      "### Nada mudou: o site já está numa versão que voltou",
      "",
      `No ar: \`${noAr}\`, que já tinha estado no ar antes. Com "versao" vazio, a volta seria desfeita (a \`${alvo}\`, que saiu do ar, voltaria). Para desfazer a volta de propósito, rode de novo com esse id em "versao"; para voltar mais, informe o id da versão desejada.`,
      ...listaNoResumo,
    ]);
    return 1;
  }

  escrever(
    `Voltando o site para a versão ${alvo} (no ar: ${noAr ?? "tráfego dividido"}). Motivo: ${pedido.motivo}`,
  );
  // `--message=` junto: um motivo que comece com "-" continua sendo o motivo, e não uma opção do wrangler.
  const volta = await executar([
    "versions",
    "deploy",
    `${alvo}@100%`,
    `--message=${pedido.motivo}`,
    "--yes",
  ]);
  if (volta.stdout) escrever(volta.stdout);
  if (volta.stderr) avisar(volta.stderr);

  if (volta.status === 0) {
    escrever(
      `::notice::Site de volta à versão ${alvo} (antes: ${noAr ?? "tráfego dividido"}). O banco não mudou.`,
    );
    resumir(env, [
      `### Site de volta à versão \`${alvo}\``,
      "",
      `Antes estava no ar: \`${noAr ?? "tráfego dividido"}\`. O banco não mudou. Para desfazer, rode de novo com esse id em "versao".`,
      ...listaNoResumo,
    ]);
    return 0;
  }

  if (SEGREDOS_MUDARAM.test(`${volta.stdout}\n${volta.stderr}`)) {
    avisar(
      `::error::Os segredos do site mudaram depois da versão ${alvo} (por exemplo, o token do webhook gravado pelo wrangler). O workflow não volta com os segredos de antes: o webhook poderia parar ou voltar ao token antigo. Nada mudou no site. Rode de novo com o id de uma versão publicada depois da troca do segredo em "versao" (a lista está no resumo desta execução; docs/lancamento.md, 2.4).`,
    );
    resumir(env, [
      "### Volta recusada: os segredos mudaram depois daquela versão",
      "",
      'Nada mudou no site. Rode de novo com o id de uma versão publicada depois da troca do segredo no campo "versao" (docs/lancamento.md, 2.4).',
      ...listaNoResumo,
    ]);
    return 1;
  }

  avisar(
    `::error::A volta para a versão ${alvo} falhou (veja o erro do wrangler acima). Confira qual versão está no ar em Cloudflare → Workers & Pages → rifa-videira-kids → Deployments.`,
  );
  resumir(env, [
    `### A volta para a versão \`${alvo}\` falhou`,
    ...listaNoResumo,
  ]);
  return 1;
}

/** true quando este arquivo é o programa principal (`node scripts/voltar-versao.mjs`), e não um import. */
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

if (executadoDiretamente()) process.exitCode = await principal();
