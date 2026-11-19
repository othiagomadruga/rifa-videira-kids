#!/usr/bin/env node
// RIFA-058 (adaptado do script da RIFA-055): verificação do site publicado, SÓ LEITURA.
//
//   npm run verificar:producao -- --url https://rifa-videira-kids.madruga.workers.dev [--admin-link <arquivo>]
//
// Opções:
//   --url <origem>          endereço do site (obrigatório), só a origem. Local (http://127.0.0.1:<porta>) vale para a
//                           prova contra o `npm run preview`.
//   --admin-link <arquivo>  arquivo com o link /acesso/<token> de um admin (pode ser a saída inteira do
//                           `npm run acesso:criar`): entra, abre Visão geral, Campanha e Adesão e sai (encerra a sessão).
//                           O link nunca vai na linha de comando: o `npm run` imprime os argumentos.
//   --sem-navegador         pula as telas abertas no Chromium (só HTTP). O --admin-link continua usando o Chromium.
//   --capturas <pasta>      grava capturas das telas ABERTAS (nunca das telas com sessão).
//   --playwright <pasta>    node_modules com o Playwright. Padrão: o do projeto, se houver, e o da sessão de nuvem do
//                           Claude (/opt/node-tools/node_modules). O projeto não traz o Playwright como dependência.
//
// O que confere: /api/health; o app nas rotas do site, com os 4 cabeçalhos de segurança e sem cache longo no HTML;
// os arquivos que não podem sair; os assets com hash; a área fechada sem sessão (401), cookie forjado e CSRF; o
// webhook sem token válido; a API pública sem valores em R$; e, no Chromium, as telas abertas a 390 e 1366 px.
// O que NÃO faz: não cria pedido, não grava configuração, não manda webhook com token válido, não gera link nem
// token. Com --admin-link, a única escrita é a da própria sessão (entrar cria a sessão, sair a apaga).
// Nunca imprime o link, o token nem o cookie: toda saída passa por limpar().
// Saída: 0 = tudo certo; 1 = alguma FALHA; 2 = uso errado.
// Roteiro: docs/lancamento.md, 2.3 e 3.1. Testes: scripts/verificar-producao.test.mjs.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const USO = `Uso: npm run verificar:producao -- --url https://<site> [--admin-link <arquivo>]
       [--sem-navegador] [--capturas <pasta>] [--playwright <node_modules>]`;

/** Onde a sessão de nuvem do Claude tem o Playwright (fora do projeto). */
export const PLAYWRIGHT_DA_SESSAO = "/opt/node-tools/node_modules";

// ------------------------------------------------------------------------------------------------ proxy da sessão
// O fetch do Node 22 (undici) ignora HTTPS_PROXY, a não ser que o processo já comece com NODE_USE_ENV_PROXY=1: o
// Node lê a variável só na partida, então mudá-la em process.env aqui dentro não adianta. Na sessão de nuvem do
// Claude toda saída para a internet passa pelo proxy (HTTPS_PROXY), e sem isso nenhum pedido sai. Por isso, com
// HTTPS_PROXY e sem a variável, o script se reabre uma vez com ela ligada e devolve o código de saída do filho.
// Sem proxy (a máquina do PO, o CI) roda direto. --disable-warning=UNDICI-EHPA cala o aviso de recurso experimental
// do EnvHttpProxyAgent, o agente que o Node usa para seguir o proxy. O endereço local (prova contra o preview) não
// passa pelo proxy: o NO_PROXY da sessão cobre 127.0.0.1 e localhost.

/** true quando o script precisa se reabrir com NODE_USE_ENV_PROXY=1 para o fetch seguir o proxy. */
export function precisaReabrirComProxy(env) {
  return (
    Boolean(env.HTTPS_PROXY || env.https_proxy) &&
    env.NODE_USE_ENV_PROXY !== "1"
  );
}

function reabrirComProxy() {
  const filho = spawnSync(
    process.execPath,
    [
      "--disable-warning=UNDICI-EHPA",
      ...process.execArgv,
      process.argv[1],
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } },
  );
  if (filho.error)
    process.stderr.write(
      `Erro: não deu para reabrir o script com NODE_USE_ENV_PROXY=1 (${filho.error.code ?? filho.error.message}).\n`,
    );
  return filho.status ?? 1;
}

// ------------------------------------------------------------------------------------------------ segredos na saída
/** Token de um link pessoal (FORMATO_TOKEN_ACESSO do contrato: 43 caracteres base64url), solto no texto. */
const TOKEN_SOLTO = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;

/**
 * Esconde o que não pode sair na tela: cada valor de `segredos` (o link e o token lidos do arquivo, o cookie da
 * sessão, o token errado e o cookie forjado que o próprio script inventa), qualquer /acesso/<token>, o valor do
 * cookie __Host-sessao, o que vem depois de "Bearer" e um token de 43 caracteres solto.
 */
export function limpar(texto, segredos = []) {
  let saida = String(texto);
  for (const segredo of segredos)
    if (segredo) saida = saida.split(segredo).join("[omitido]");
  return saida
    .replace(/\/acesso\/[A-Za-z0-9_-]{16,}/g, "/acesso/[omitido]")
    .replace(/__Host-sessao=[^;\s"',]+/g, "__Host-sessao=[omitido]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [omitido]")
    .replace(TOKEN_SOLTO, "[omitido]");
}

// ------------------------------------------------------------------------------------------------ argumentos
/** Erro de uso: o script termina com 2 antes de qualquer pedido. */
export class ErroDeUso extends Error {}

const COM_VALOR = {
  "--url": "url",
  "--admin-link": "adminLink",
  "--capturas": "capturas",
  "--playwright": "playwright",
};

/** Lê as opções. Devolve { ajuda: true } para --help. */
export function lerArgumentos(argv) {
  const op = {
    ajuda: false,
    url: null,
    adminLink: null,
    semNavegador: false,
    capturas: null,
    playwright: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const argumento = argv[i];
    if (argumento === "--help" || argumento === "-h") return { ajuda: true };
    if (argumento === "--sem-navegador") {
      op.semNavegador = true;
      continue;
    }
    const [nome, valorJunto] = argumento.split(/=(.*)/s, 2);
    if (!(nome in COM_VALOR))
      throw new ErroDeUso(`opção desconhecida: ${nome}`);
    const valor = valorJunto ?? argv[++i];
    if (!valor || valor.startsWith("--"))
      throw new ErroDeUso(`${nome} precisa de um valor`);
    op[COM_VALOR[nome]] = valor;
  }
  if (!op.url) throw new ErroDeUso("--url é obrigatória");
  let endereco;
  try {
    endereco = new URL(op.url);
  } catch {
    throw new ErroDeUso("--url não é um endereço válido");
  }
  if (
    !/^https?:$/.test(endereco.protocol) ||
    (endereco.pathname !== "/" && endereco.pathname !== "") ||
    endereco.search ||
    endereco.hash ||
    endereco.username ||
    endereco.password
  )
    throw new ErroDeUso(
      "--url deve ser só a origem, ex.: https://rifa-videira-kids.madruga.workers.dev",
    );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(endereco.hostname);
  if (endereco.protocol === "http:" && !local)
    throw new ErroDeUso("--url fora da máquina local precisa ser https");
  return { ...op, origem: endereco.origin, local };
}

// ------------------------------------------------------------------------------------------------ lista de checagens
/** As conferências só por HTTP, na ordem. A saúde vem primeiro: se ela falha, as outras são puladas. */
export const CHECAGENS_HTTP = [
  "saude",
  "site",
  "assets",
  "area-fechada",
  "webhook",
  "api-publica",
];

export const TITULOS = {
  saude: "1. Saúde (/api/health)",
  site: "2. Site: rotas do app, cabeçalhos e arquivos que não podem sair",
  assets:
    "3. Assets com hash (JS, CSS, fonte woff2, imagens) e arquivos públicos",
  "area-fechada":
    "4. Área fechada sem sessão (/api/admin/*, /api/painel/*, /api/minha/*)",
  webhook: "5. Webhook da Rifei sem token e com token errado (nada é gravado)",
  "api-publica": "6. API pública (ranking e bumbo, sem valores em R$)",
  navegador:
    "7. Navegador (Chromium, CSP de produção): telas abertas a 390 e 1366 px",
  admin:
    "8. Coordenação com o link do admin: entrar, Visão geral, Campanha, Adesão e sair",
  "sem-playwright": "7. Navegador: Playwright não encontrado",
};

/** true quando alguma conferência pedida usa o Chromium (as telas abertas ou o link do admin). */
export function precisaDoNavegador(op) {
  return !op.semNavegador || Boolean(op.adminLink);
}

/**
 * A lista de conferências que esta execução vai rodar, na ordem. Sem o Playwright, as do navegador viram
 * "sem-playwright" (uma FALHA com o que fazer); com --sem-navegador e sem --admin-link, nem se procura o Playwright.
 */
export function montarChecagens(op, { temPlaywright }) {
  const noNavegador = [];
  if (!op.semNavegador) noNavegador.push("navegador");
  if (op.adminLink) noNavegador.push("admin");
  if (noNavegador.length === 0) return [...CHECAGENS_HTTP];
  return temPlaywright
    ? [...CHECAGENS_HTTP, ...noNavegador]
    : [...CHECAGENS_HTTP, "sem-playwright"];
}

// ------------------------------------------------------------------------------------------------ o que se espera
// Os 4 cabeçalhos da regra "/*" de public/_headers e de src/worker/middleware/cabecalhos-seguranca.ts. O teste deste
// script confere que são os do public/_headers, e o do middleware, que o public/_headers e o middleware são iguais
// (docs/acesso.md, seção 4; docs/lancamento.md, 2.3 item 3).
export const CABECALHOS_ESPERADOS = {
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

// GETs de /api/admin/*, /api/painel/* e /api/minha/* do contrato (src/shared/contracts/), mais caminhos que não
// existem e a própria sessão: sem sessão, todos dão 401 `nao_autenticado` (docs/acesso.md, seção 6).
export const GETS_PROTEGIDOS = [
  "/api/admin/acessos-hierarquia?papel=lider",
  "/api/admin/adesao",
  "/api/admin/afiliados",
  "/api/admin/auditoria",
  "/api/admin/campanha",
  "/api/admin/celulas",
  "/api/admin/celulas/1",
  "/api/admin/discipuladores",
  "/api/admin/discipuladores/1",
  "/api/admin/links-vendas",
  "/api/admin/pedidos",
  "/api/admin/pedidos/suspeitos",
  "/api/admin/reconciliacao/recuperacoes",
  "/api/admin/redes",
  "/api/admin/redes/1",
  "/api/admin/usuarios",
  "/api/admin/webhook/entregas",
  "/api/admin/webhook/estado",
  "/api/admin/webhook/token",
  "/api/painel/mapa-ddd",
  "/api/painel/ranking",
  "/api/painel/relatorio",
  "/api/painel/resumo",
  "/api/minha/links-vendas",
  "/api/minha/visao",
  "/api/admin/rota-que-nao-existe",
  "/api/painel/rota-que-nao-existe",
  "/api/minha/rota-que-nao-existe",
  "/api/sessao",
];

// Telas abertas (sem login). "/ranking" não é rota do site (o ranking público é "/"): o servidor devolve o app (200)
// e o app mostra "Página não encontrada".
const ROTAS_SPA = [
  "/",
  "/ranking",
  "/telao",
  "/entrar",
  "/status",
  "/acesso",
  "/coordenacao",
  "/minha",
];
const TELAS_PUBLICAS = ["/", "/telao", "/entrar", "/status", "/ranking"];
const TELAS_ADMIN = [
  { rotulo: "Visão geral", caminho: "/coordenacao" },
  { rotulo: "Campanha", caminho: "/coordenacao/campanha" },
  { rotulo: "Adesão", caminho: "/coordenacao/adesao" },
];
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1366, height: 768 },
];

const aleatorio = () => randomBytes(6).toString("hex");

/** Os 4 cabeçalhos com o valor exato. Devolve a lista do que está errado (`headers` com .get, como o do fetch). */
export function problemasDosCabecalhos(headers) {
  const problemas = [];
  for (const [nome, valor] of Object.entries(CABECALHOS_ESPERADOS)) {
    const recebido = headers.get(nome);
    if (recebido === null) problemas.push(`${nome} ausente`);
    else if (recebido.trim() !== valor)
      problemas.push(`${nome} = "${recebido}"`);
  }
  return problemas;
}

/** O HTML do app pode ficar guardado no navegador? (o index.html tem de ser revalidado a cada visita) */
export function cacheLongo(cacheControl) {
  if (!cacheControl) return false;
  const maxAge = /(?:^|[,\s])max-age=(\d+)/i.exec(cacheControl);
  return (
    /immutable/i.test(cacheControl) || (maxAge !== null && maxAge[1] !== "0")
  );
}

/** Acha o link /acesso/<token> completo num texto (a saída do acesso:criar, por exemplo). */
export function lerLinkDoAdmin(texto) {
  const achado = String(texto).match(
    /(https?:\/\/[^\s/]+)\/acesso\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/,
  );
  if (!achado)
    throw new Error(
      "o arquivo não tem um link /acesso/<token> completo (43 caracteres)",
    );
  return { link: achado[0], origem: achado[1], token: achado[2] };
}

// ------------------------------------------------------------------------------------------------ relatório
function criarRelatorio(escrever) {
  const contagem = { ok: 0, falha: 0, aviso: 0 };
  const falhas = [];
  const linha = (nome, detalhe) => `${nome}${detalhe ? ": " + detalhe : ""}`;
  const rel = {
    contagem,
    falhas,
    secao: (titulo) => escrever(`\n== ${titulo}`),
    ok(nome, detalhe = "") {
      contagem.ok++;
      escrever(`  [ok]    ${linha(nome, detalhe)}`);
    },
    falha(nome, detalhe = "") {
      contagem.falha++;
      falhas.push(linha(nome, detalhe));
      escrever(`  [FALHA] ${linha(nome, detalhe)}`);
    },
    aviso(nome, detalhe = "") {
      contagem.aviso++;
      escrever(`  [aviso] ${linha(nome, detalhe)}`);
    },
    conferir(condicao, nome, detalheOk, detalheFalha) {
      if (condicao) rel.ok(nome, detalheOk);
      else rel.falha(nome, detalheFalha ?? detalheOk);
      return condicao;
    },
  };
  return rel;
}

// ------------------------------------------------------------------------------------------------ HTTP
async function pedir(
  ctx,
  caminho,
  { metodo = "GET", cabecalhos = {}, corpo } = {},
) {
  const inicio = performance.now();
  const r = await fetch(new URL(caminho, ctx.origem), {
    method: metodo,
    headers: cabecalhos,
    body: corpo,
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  const bytes = new Uint8Array(await r.arrayBuffer());
  const texto = new TextDecoder().decode(bytes);
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    json = undefined;
  }
  return {
    status: r.status,
    headers: r.headers,
    bytes,
    texto,
    json,
    ms: Math.round(performance.now() - inicio),
    segredos: ctx.segredos,
  };
}

function resumoResposta(r) {
  const tipo = r.headers.get("content-type") ?? "?";
  // limpar() antes de cortar: um segredo cortado ao meio já não seria reconhecido na hora de escrever.
  const corpo = r.json?.erro
    ? `erro ${r.json.erro.codigo}`
    : limpar(r.texto, r.segredos).slice(0, 60).replace(/\s+/g, " ");
  return `${r.status} ${tipo.split(";")[0]} (${corpo})`;
}

function conferirCabecalhos(ctx, nome, r) {
  const problemas = problemasDosCabecalhos(r.headers);
  ctx.rel.conferir(
    problemas.length === 0,
    `cabeçalhos de segurança em ${nome}`,
    "os 4, com os valores de public/_headers",
    problemas.join("; "),
  );
}

function erroDaApi(r, status, codigo) {
  return (
    r.status === status &&
    r.json?.erro?.codigo === codigo &&
    typeof r.json.erro.mensagem === "string"
  );
}

async function emLotes(itens, tamanho, fn) {
  const saida = [];
  for (let i = 0; i < itens.length; i += tamanho)
    saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  return saida;
}

// ------------------------------------------------------------------------------------------------ 1. saúde
async function conferirSaude(ctx) {
  const { rel } = ctx;
  let r;
  try {
    r = await pedir(ctx, "/api/health");
  } catch (e) {
    rel.falha(
      "GET /api/health",
      `sem resposta (${e.cause?.code ?? e.name}: ${e.message}). O endereço está certo e o site no ar?`,
    );
    return false;
  }
  const j = r.json;
  rel.conferir(
    r.status === 200 &&
      j?.ok === true &&
      j?.db === "ok" &&
      typeof j?.latenciaMs === "number",
    "GET /api/health",
    `200 {"ok":true,"db":"ok","latenciaMs":${j?.latenciaMs}} em ${r.ms} ms`,
    resumoResposta(r),
  );
  conferirCabecalhos(ctx, "/api/health", r);
  // Responde, mas não é o Worker da rifa (nem JSON nem a CSP do projeto): o resto só repetiria a mesma falha.
  const ehOWorker =
    j !== undefined ||
    r.headers.get("content-security-policy") ===
      CABECALHOS_ESPERADOS["content-security-policy"];
  if (!ehOWorker) {
    const cloudflare = /cloudflare/i.test(r.headers.get("server") ?? "");
    rel.falha(
      "o endereço é o site da rifa?",
      cloudflare && r.status === 404
        ? 'a Cloudflare responde 404 sem o Worker (página "not found" / erro 1042): não há Worker publicado neste endereço, ou o nome/subdomínio está errado'
        : `o endereço responde ${r.status}, mas não é o Worker da rifa`,
    );
    return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ 2. site (SPA)
async function conferirSite(ctx) {
  const { rel } = ctx;
  const raiz = await pedir(ctx, "/");
  const html = raiz.texto;
  const ehApp =
    html.includes('<div id="root"></div>') &&
    html.includes("<title>Projeto Videira Kids</title>") &&
    /<script type="module"[^>]+src="\/assets\/index-[\w-]+\.js"/.test(html);
  if (
    rel.conferir(
      raiz.status === 200 &&
        /text\/html/.test(raiz.headers.get("content-type") ?? "") &&
        ehApp,
      "GET /",
      "200, o HTML do app",
      resumoResposta(raiz),
    )
  )
    ctx.index = html;
  conferirCabecalhos(ctx, "/ (site)", raiz);
  rel.conferir(
    raiz.headers.get("set-cookie") === null,
    "GET / sem Set-Cookie",
    "nenhum cookie nas telas abertas",
    "a página aberta grava cookie",
  );
  const cache = raiz.headers.get("cache-control");
  rel.conferir(
    !cacheLongo(cache),
    "GET / sem cache longo",
    `o HTML do app é revalidado a cada visita (Cache-Control: ${cache ?? "ausente"})`,
    `Cache-Control: ${cache}: o celular pode ficar com o app antigo depois de uma publicação`,
  );

  const rotas = [...ROTAS_SPA.slice(1), `/rota-que-nao-existe-${aleatorio()}`];
  const respostas = await emLotes(rotas, 4, async (c) => [
    c,
    await pedir(ctx, c),
  ]);
  for (const [c, r] of respostas) {
    const igual = ctx.index !== null && r.texto === ctx.index;
    const problemas = problemasDosCabecalhos(r.headers);
    rel.conferir(
      r.status === 200 && igual && problemas.length === 0,
      `GET ${c.replace(/-[0-9a-f]{12}$/, "-…")}`,
      "200, o mesmo HTML do app, com os 4 cabeçalhos" +
        (c === "/ranking"
          ? ' (no app, cai em "Página não encontrada": o ranking público é "/")'
          : ""),
      `${resumoResposta(r)}${igual ? "" : ", HTML diferente do de /"}${problemas.length ? ", cabeçalhos: " + problemas.join("; ") : ""}`,
    );
  }

  // O que o build tem e não pode ser servido (dist/client/.assetsignore e o _headers): devolve o app, não o arquivo.
  for (const c of [
    "/_headers",
    "/.assetsignore",
    "/.dev.vars",
    "/.env",
    "/wrangler.json",
  ]) {
    const r = await pedir(ctx, c);
    rel.conferir(
      ctx.index !== null &&
        r.texto === ctx.index &&
        !/Content-Security-Policy:|RIFEI_|database_id/.test(r.texto),
      `GET ${c} não sai`,
      "devolve o app (o arquivo não é servido)",
      resumoResposta(r),
    );
  }

  // /api e /api/* vão sempre ao Worker (run_worker_first), nunca ao index.html.
  for (const c of ["/api", `/api/rota-que-nao-existe-${aleatorio()}`]) {
    const r = await pedir(ctx, c);
    rel.conferir(
      erroDaApi(r, 404, "nao_encontrado") &&
        problemasDosCabecalhos(r.headers).length === 0,
      `GET ${c.replace(/-[0-9a-f]{12}$/, "-…")}`,
      "404 nao_encontrado em JSON (vai ao Worker, não ao app)",
      resumoResposta(r),
    );
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ 3. assets
const TIPO_POR_EXTENSAO = {
  js: /javascript/,
  css: /text\/css/,
  woff2: /font\/woff2/,
  png: /image\/png/,
  webp: /image\/webp/,
  svg: /image\/svg/,
  ico: /image\/(x-icon|vnd\.microsoft\.icon)/,
  csv: /text\/csv/,
};

async function conferirAssets(ctx) {
  const { rel } = ctx;
  if (!ctx.index) {
    rel.falha("assets", "sem o HTML do app, não há lista de assets");
    return true;
  }
  const achados = new Set();
  const coletar = (texto) => {
    for (const m of texto.matchAll(
      /(?:\/|\.\/|["'(])(assets\/[\w.-]+\.(?:js|css|woff2|png|webp|svg|jpg|ico))/g,
    ))
      achados.add("/" + m[1]);
    for (const m of texto.matchAll(
      /["'(]\.\/([\w.-]+-[\w-]{8}\.(?:js|css|woff2|png|webp|svg))/g,
    ))
      achados.add("/assets/" + m[1]);
  };
  coletar(ctx.index);
  const vistos = new Set();
  const resultados = [];
  // Abre cada JS e CSS para achar os pedaços carregados depois (telas da coordenação, fonte, imagens).
  while ([...achados].some((a) => !vistos.has(a))) {
    const pendentes = [...achados].filter((a) => !vistos.has(a));
    pendentes.forEach((a) => vistos.add(a));
    const lote = await emLotes(pendentes, 6, async (a) => {
      try {
        return [a, await pedir(ctx, a)];
      } catch (e) {
        return [a, null, e];
      }
    });
    for (const [a, r, e] of lote) {
      resultados.push([a, r, e]);
      if (r && r.status === 200 && /\.(js|css)$/.test(a)) coletar(r.texto);
    }
  }
  let bytes = 0;
  const ruins = [];
  for (const [a, r, e] of resultados) {
    const ext = a.split(".").pop();
    if (!r) {
      ruins.push(`${a}: sem resposta (${e?.message})`);
      continue;
    }
    bytes += r.bytes.length;
    const tipo = r.headers.get("content-type") ?? "";
    if (
      r.status !== 200 ||
      r.bytes.length === 0 ||
      !TIPO_POR_EXTENSAO[ext]?.test(tipo) ||
      r.texto === ctx.index
    )
      ruins.push(`${a}: ${r.status} ${tipo} ${r.bytes.length} B`);
    else if (!/-[\w-]{8}\.[a-z0-9]+$/.test(a))
      ruins.push(`${a}: sem hash no nome`);
  }
  const fontes = resultados.filter(([a]) => a.endsWith(".woff2"));
  rel.conferir(
    ruins.length === 0 && resultados.length > 0,
    "assets carregando",
    `${resultados.length} arquivos, ${(bytes / 1024).toFixed(0)} KiB, todos 200 com o tipo certo e hash no nome`,
    ruins.slice(0, 8).join("; "),
  );
  rel.conferir(
    fontes.length > 0 && fontes.every(([, r]) => r?.status === 200),
    "fonte woff2",
    fontes
      .map(
        ([a, r]) =>
          `${a} ${r?.status} ${r?.headers.get("content-type")} ${r?.bytes.length} B`,
      )
      .join(", ") || "nenhuma fonte achada no HTML/CSS",
  );
  const umJs = resultados.find(([a, r]) => a.endsWith(".js") && r);
  if (umJs) {
    conferirCabecalhos(ctx, umJs[0], umJs[1]);
    ctx.escrever(
      `  (Cache-Control dos assets: ${umJs[1].headers.get("cache-control") ?? "ausente"})`,
    );
  }

  for (const [c, ext] of [
    ["/favicon.ico", "ico"],
    ["/apple-touch-icon.png", "png"],
    ["/modelos/hierarquia-modelo.csv", "csv"],
  ]) {
    const r = await pedir(ctx, c);
    const okTipo = TIPO_POR_EXTENSAO[ext].test(
      r.headers.get("content-type") ?? "",
    );
    const extra =
      ext === "csv"
        ? r.texto
            .replace(/^﻿/, "")
            .startsWith(
              "rede;divisao;rede_responsavel;discipulador;celula;qtd_pessoas;lider_nome;lider_email;lider_telefone",
            )
          ? ", cabeçalho do modelo certo"
          : ", CABEÇALHO DIFERENTE"
        : "";
    rel.conferir(
      r.status === 200 &&
        okTipo &&
        r.texto !== ctx.index &&
        !extra.includes("DIFERENTE"),
      `GET ${c}`,
      `200 ${r.headers.get("content-type")} ${r.bytes.length} B${extra}`,
      resumoResposta(r) + extra,
    );
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ 4. área fechada
async function conferirAreaFechada(ctx) {
  const { rel } = ctx;
  const respostas = await emLotes(GETS_PROTEGIDOS, 5, async (c) => [
    c,
    await pedir(ctx, c),
  ]);
  const errados = respostas.filter(
    ([, r]) =>
      !erroDaApi(r, 401, "nao_autenticado") ||
      problemasDosCabecalhos(r.headers).length,
  );
  rel.conferir(
    errados.length === 0,
    `GET sem sessão em ${respostas.length} caminhos`,
    "todos 401 nao_autenticado, com os 4 cabeçalhos (inclusive os que não existem)",
    errados.map(([c, r]) => `${c} → ${resumoResposta(r)}`).join("; "),
  );

  // Cookie forjado (formato certo, sessão inexistente): 401 e o cookie é expirado.
  const forjado = randomBytes(32).toString("base64url");
  ctx.segredos.add(forjado);
  const r1 = await pedir(ctx, "/api/admin/campanha", {
    cabecalhos: { Cookie: `__Host-sessao=${forjado}` },
  });
  const expira = /__Host-sessao=;.*Max-Age=0/i.test(
    r1.headers.get("set-cookie") ?? "",
  );
  rel.conferir(
    erroDaApi(r1, 401, "nao_autenticado") && expira,
    "cookie de sessão forjado",
    "401 nao_autenticado e o cookie expirado (Max-Age=0)",
    resumoResposta(r1) + (expira ? "" : ", sem expirar o cookie"),
  );

  // CSRF: escrita de outra origem é recusada antes da sessão (corpo vazio: nada é lido nem gravado).
  for (const [metodo, c] of [
    ["PUT", "/api/admin/campanha"],
    ["POST", "/api/sessao"],
  ]) {
    const r = await pedir(ctx, c, {
      metodo,
      cabecalhos: { Origin: "https://outro-site.example" },
    });
    rel.conferir(
      erroDaApi(r, 403, "proibido"),
      `${metodo} ${c} de outra origem`,
      "403 proibido (CSRF, antes da sessão)",
      resumoResposta(r),
    );
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ 5. webhook
async function conferirWebhook(ctx) {
  const { rel } = ctx;
  const tokenErrado = randomBytes(32).toString("hex");
  ctx.segredos.add(tokenErrado);
  const casos = [
    ["sem Authorization", "/api/webhooks/rifei", {}],
    [
      "com token errado",
      "/api/webhooks/rifei",
      { Authorization: `Bearer ${tokenErrado}` },
    ],
    ["sem Authorization, com barra no fim", "/api/webhooks/rifei/", {}],
  ];
  const codigos = new Set();
  for (const [nome, c, cab] of casos) {
    const r = await pedir(ctx, c, {
      metodo: "POST",
      cabecalhos: { "Content-Type": "application/json", ...cab },
      corpo: "{}",
    });
    const semToken = erroDaApi(r, 503, "nao_configurado");
    const recusado =
      erroDaApi(r, 401, "nao_autenticado") &&
      /Bearer/i.test(r.headers.get("www-authenticate") ?? "");
    codigos.add(r.json?.erro?.codigo);
    rel.conferir(
      (semToken || recusado) && problemasDosCabecalhos(r.headers).length === 0,
      `POST ${c} ${nome}`,
      semToken
        ? "503 nao_configurado (ainda sem token do webhook: esperado antes da 3.2)"
        : "401 nao_autenticado com WWW-Authenticate: Bearer",
      resumoResposta(r),
    );
  }
  ctx.webhook = [...codigos].map((c) => c ?? "?").join("/");
  if (codigos.size > 1)
    rel.falha(
      "webhook coerente",
      `respostas diferentes entre os casos: ${ctx.webhook}`,
    );
  return true;
}

// ------------------------------------------------------------------------------------------------ 6. API pública
async function conferirApiPublica(ctx) {
  const { rel } = ctx;
  for (const c of ["/api/publico/ranking", "/api/publico/bumbo"]) {
    const r = await pedir(ctx, c);
    const semCampanha =
      erroDaApi(r, 404, "nao_encontrado") &&
      /campanha/i.test(r.json.erro.mensagem);
    const comCampanha = r.status === 200 && r.json !== undefined;
    const temDinheiro =
      comCampanha && /centavos|"total_|valor_reais|R\$/.test(r.texto);
    if (c.endsWith("ranking"))
      ctx.campanha = semCampanha
        ? "não configurada"
        : comCampanha
          ? "configurada"
          : "?";
    rel.conferir(
      (semCampanha || comCampanha) &&
        !temDinheiro &&
        problemasDosCabecalhos(r.headers).length === 0,
      `GET ${c}`,
      semCampanha
        ? "404 nao_encontrado: a campanha ainda não foi configurada (esperado antes da 3.3)"
        : "200, sem valores em R$",
      resumoResposta(r) + (temDinheiro ? ", COM CAMPO DE DINHEIRO" : ""),
    );
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ Playwright
/** Onde procurar o Playwright, na ordem: --playwright; senão, o projeto e a pasta da sessão de nuvem do Claude. */
export function locaisDoPlaywright(opcao) {
  if (opcao) return [resolve(opcao)];
  return [
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    PLAYWRIGHT_DA_SESSAO,
  ];
}

/**
 * A primeira pasta node_modules que tem o pacote `playwright`, ou null. Não carrega o pacote. Olha o arquivo, e não
 * a resolução do require, que também acharia um Playwright do NODE_PATH, de outra versão e sem o Chromium dela.
 */
export function acharPlaywright(locais) {
  return (
    locais.find((pasta) =>
      existsSync(join(pasta, "playwright", "package.json")),
    ) ?? null
  );
}

/**
 * Variáveis que ligam o log do próprio Playwright (DEBUG=pw:api escreve no stderr cada page.goto com o endereço
 * inteiro, inclusive o /acesso/<token>; DEBUG_FILE grava o mesmo num arquivo). Esse log não passa por limpar(), por
 * isso elas saem do ambiente antes de carregar o pacote, que as lê ao carregar.
 */
export const VARIAVEIS_DE_LOG_DO_PLAYWRIGHT = ["DEBUG", "DEBUG_FILE"];

async function abrirChromium(ctx) {
  if (!ctx.chromium) {
    for (const nome of VARIAVEIS_DE_LOG_DO_PLAYWRIGHT) delete process.env[nome];
    const { chromium } = createRequire(
      join(ctx.pastaPlaywright, "procurar.js"),
    )("playwright");
    ctx.chromium = chromium;
  }
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  try {
    // Endereço local: sem proxy (o Chromium mandaria até o loopback para o proxy).
    return await ctx.chromium.launch({
      args: ["--lang=pt-BR"],
      ...(proxy && !ctx.local ? { proxy: { server: proxy } } : {}),
    });
  } catch (e) {
    throw new Error(
      `o Chromium do Playwright (${ctx.pastaPlaywright}) não abriu: ${e.message.split("\n")[0]}. ` +
        "Instale o navegador com `npx playwright install chromium` ou rode com --sem-navegador (só HTTP).",
    );
  }
}

function semPlaywright(ctx) {
  const usos = [
    !ctx.op.semNavegador && "as telas abertas",
    ctx.op.adminLink && "o --admin-link",
  ].filter(Boolean);
  const quem = usos.join(" e ");
  ctx.rel.falha(
    "Playwright",
    `não encontrado (procurado em ${locaisDoPlaywright(ctx.op.playwright).join(" e ")}). ` +
      `${quem[0].toUpperCase()}${quem.slice(1)} ${ctx.op.semNavegador ? "precisa" : "precisam"} do Chromium do Playwright, e o projeto não o traz como dependência. ` +
      "Fora da sessão do Claude, rode com --sem-navegador (só HTTP) ou passe --playwright <pasta node_modules com o playwright>.",
  );
  return true;
}

// ------------------------------------------------------------------------------------------------ 7. navegador
/** Escuta console, erros de página e respostas; classifica o que é esperado. */
function escutar(ctx, page) {
  const registro = { erros: [], conhecidos: [], esperados: [], pendentes: [] };
  const respostasApi = new Map();
  const aoResponder = (resp) => {
    const u = new URL(resp.url());
    if (u.origin !== ctx.origem) return;
    if (resp.status() >= 400) {
      // O corpo pode já não estar disponível (a página navegou): num GET, pergunta de novo com os mesmos cookies.
      const p = resp
        .json()
        .catch(() =>
          resp.request().method() === "GET"
            ? page.request.get(resp.url()).then((r) => r.json())
            : null,
        )
        .catch(() => null)
        .then((j) => ({
          status: resp.status(),
          codigo: j?.erro?.codigo,
          mensagem: j?.erro?.mensagem,
        }));
      respostasApi.set(resp.url(), p);
    }
  };
  const classificar = async (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const texto = m.text();
    const url = m.location()?.url ?? "";
    if (/Failed to load resource/.test(texto) && !respostasApi.has(url))
      await new Promise((r) => setTimeout(r, 300));
    if (/Failed to load resource/.test(texto) && respostasApi.has(url)) {
      const info = await respostasApi.get(url);
      const caminho = new URL(url).pathname;
      if (info.status === 401 && caminho === "/api/sessao")
        return registro.esperados.push(
          "401 de GET /api/sessao (o site pergunta se há sessão)",
        );
      if (
        info.status === 404 &&
        info.codigo === "nao_encontrado" &&
        /campanha/i.test(info.mensagem ?? "") &&
        !/pedido/i.test(info.mensagem ?? "")
      )
        return registro.esperados.push(
          `404 de ${caminho}: campanha ainda não configurada`,
        );
      return registro.erros.push(
        `${m.type()}: ${texto} (${caminho} ${info.status} ${info.codigo ?? ""})`,
      );
    }
    // docs/acesso.md, seção 4: o zod testa uma vez se pode usar Function("") e o Chrome registra a violação de eval.
    if (/unsafe-eval|evaluate a string as JavaScript/i.test(texto))
      return registro.conhecidos.push(
        "CSP barrou o teste de eval do zod (esperado, docs/acesso.md §4)",
      );
    registro.erros.push(
      `${m.type()}: ${limpar(texto, ctx.segredos).slice(0, 300)}`,
    );
  };
  const aoConsole = (m) => registro.pendentes.push(classificar(m));
  const aoErroDaPagina = (e) =>
    registro.erros.push(
      `pageerror: ${limpar(String(e), ctx.segredos).slice(0, 300)}`,
    );
  const aoFalharRequisicao = (req) => {
    const motivo = req.failure()?.errorText ?? "";
    if (/ERR_ABORTED/.test(motivo)) return; // navegação ou consulta cancelada pelo próprio app
    registro.erros.push(
      `requisição falhou: ${new URL(req.url()).pathname} ${motivo}`,
    );
  };
  page.on("response", aoResponder);
  page.on("console", aoConsole);
  page.on("pageerror", aoErroDaPagina);
  page.on("requestfailed", aoFalharRequisicao);
  registro.parar = () => {
    page.off("response", aoResponder);
    page.off("console", aoConsole);
    page.off("pageerror", aoErroDaPagina);
    page.off("requestfailed", aoFalharRequisicao);
  };
  return registro;
}

async function medir(page) {
  return page.evaluate(() => {
    const janela = window.innerWidth;
    const largura = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const transbordam = [];
    if (largura > janela) {
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (
          r.width > 0 &&
          r.right > janela + 1 &&
          getComputedStyle(el).position !== "fixed"
        ) {
          const classe =
            typeof el.className === "string" && el.className
              ? `.${el.className.trim().split(/\s+/).join(".")}`
              : "";
          transbordam.push(
            `${el.tagName.toLowerCase()}${classe} (${Math.round(r.right)} px)`,
          );
          if (transbordam.length >= 4) break;
        }
      }
    }
    const h1 = document.querySelector("h1")?.textContent?.trim() ?? "";
    const raizComConteudo =
      (document.getElementById("root")?.children.length ?? 0) > 0;
    const erroDeTela = /Algo deu errado/.test(document.body?.innerText ?? "");
    return { janela, largura, transbordam, h1, raizComConteudo, erroDeTela };
  });
}

async function esperarAssentar(page, registro) {
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  if (registro) await Promise.allSettled(registro.pendentes);
}

function relatarTela(ctx, nome, medida, registro, cspDoDocumento) {
  const problemas = [];
  if (!medida.raizComConteudo) problemas.push("o app não montou (#root vazio)");
  if (medida.erroDeTela) problemas.push('a tela mostra "Algo deu errado"');
  if (medida.largura > medida.janela)
    problemas.push(
      `rolagem lateral: ${medida.largura} px numa janela de ${medida.janela} (${medida.transbordam.join(", ")})`,
    );
  if (
    cspDoDocumento !== undefined &&
    cspDoDocumento !== CABECALHOS_ESPERADOS["content-security-policy"]
  )
    problemas.push(`CSP do documento: ${cspDoDocumento ?? "ausente"}`);
  problemas.push(...registro.erros.map((e) => `console: ${e}`));
  const extras = [
    medida.h1 && `h1 "${medida.h1}"`,
    registro.esperados.length &&
      `esperado: ${[...new Set(registro.esperados)].join("; ")}`,
  ]
    .filter(Boolean)
    .join("; ");
  ctx.rel.conferir(
    problemas.length === 0,
    nome,
    `console limpo, sem rolagem lateral${extras ? "; " + extras : ""}`,
    problemas.join(" | "),
  );
  for (const c of new Set(registro.conhecidos)) ctx.rel.aviso(nome, c);
}

async function conferirNavegador(ctx) {
  const navegador = await abrirChromium(ctx);
  try {
    for (const vp of VIEWPORTS) {
      for (const caminho of [
        ...TELAS_PUBLICAS,
        `/rota-que-nao-existe-${aleatorio()}`,
      ]) {
        const contexto = await navegador.newContext({
          viewport: vp,
          locale: "pt-BR",
          timezoneId: "America/Belem",
          hasTouch: vp.width <= 480,
        });
        const page = await contexto.newPage();
        const registro = escutar(ctx, page);
        const nome = `${caminho.replace(/-[0-9a-f]{12}$/, "-…")} a ${vp.width} px`;
        try {
          const resp = await page.goto(ctx.origem + caminho, {
            waitUntil: "load",
            timeout: 30000,
          });
          await esperarAssentar(page, registro);
          const medida = await medir(page);
          relatarTela(
            ctx,
            nome,
            medida,
            registro,
            resp?.headers()["content-security-policy"] ?? null,
          );
          if (ctx.op.capturas) {
            mkdirSync(ctx.op.capturas, { recursive: true });
            const arquivo = `${caminho === "/" ? "inicio" : caminho.slice(1).replace(/[^\w-]+/g, "_")}-${vp.width}.png`;
            await page.screenshot({
              path: join(ctx.op.capturas, arquivo),
              fullPage: true,
            });
          }
        } catch (e) {
          ctx.rel.falha(nome, `não abriu: ${e.message.split("\n")[0]}`);
        } finally {
          await contexto.close();
        }
      }
    }
  } finally {
    await navegador.close();
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ 8. admin
async function conferirAdmin(ctx) {
  const { rel } = ctx;
  let link;
  try {
    let texto;
    try {
      texto = readFileSync(ctx.op.adminLink, "utf8");
    } catch (e) {
      throw new Error(
        `não deu para ler o arquivo do link (${e.code ?? e.message})`,
      );
    }
    const lido = lerLinkDoAdmin(texto);
    ctx.segredos.add(lido.token);
    ctx.segredos.add(lido.link);
    if (lido.origem !== ctx.origem) {
      rel.falha(
        "link do admin",
        `o link é de outro endereço (${lido.origem}), não de ${ctx.origem}`,
      );
      return true;
    }
    link = lido.link;
  } catch (e) {
    rel.falha("link do admin", e.message);
    return true;
  }
  const navegador = await abrirChromium(ctx);
  const contexto = await navegador.newContext({
    viewport: VIEWPORTS[1],
    locale: "pt-BR",
    timezoneId: "America/Belem",
  });
  const page = await contexto.newPage();
  let conectado = false;
  let cookieDaSessao = null;
  try {
    // Entrar: abre o link (o app tira o token do endereço) e toca em "Entrar".
    let registro = escutar(ctx, page);
    await page.goto(link, { waitUntil: "load", timeout: 30000 });
    const botaoEntrar = page.getByRole("button", { name: /^Entrar$/ });
    await botaoEntrar
      .waitFor({ state: "visible", timeout: 15000 })
      .catch(() => {});
    await page
      .waitForURL((u) => u.pathname === "/acesso", { timeout: 5000 })
      .catch(() => {});
    const endereco = new URL(page.url()).pathname;
    rel.conferir(
      endereco === "/acesso",
      "o token sai da barra de endereço",
      "o endereço virou /acesso",
      `o endereço ficou ${endereco.startsWith("/acesso/") ? "/acesso/[token]" : endereco}`,
    );
    await botaoEntrar.click({ timeout: 15000 });
    try {
      await page.waitForURL((u) => u.pathname.startsWith("/coordenacao"), {
        timeout: 20000,
      });
    } catch {
      const motivo = (
        await page
          .locator(".acesso-resultado")
          .innerText()
          .catch(() => "")
      ).split("\n")[0];
      rel.falha(
        "entrar com o link do admin",
        `não chegou a /coordenacao${motivo ? ` ("${motivo}")` : ""}`,
      );
      return true;
    }
    conectado = true;
    await esperarAssentar(page);
    cookieDaSessao =
      (await contexto.cookies()).find((c) => c.name === "__Host-sessao")
        ?.value ?? null;
    if (cookieDaSessao) ctx.segredos.add(cookieDaSessao);
    const sessao = await page.evaluate(async () => {
      const r = await fetch("/api/sessao");
      const j = await r.json().catch(() => null);
      return { status: r.status, papel: j?.usuario?.papel };
    });
    rel.conferir(
      sessao.status === 200 &&
        ["admin", "coordenacao"].includes(sessao.papel) &&
        cookieDaSessao !== null,
      "entrar com o link do admin",
      `sessão aberta (papel ${sessao.papel}), cookie __Host-sessao gravado`,
      `GET /api/sessao ${sessao.status} papel ${sessao.papel ?? "-"}${cookieDaSessao ? "" : ", sem cookie"}`,
    );
    if (sessao.papel !== "admin")
      rel.aviso("papel do link", `o link é de ${sessao.papel}, não de admin`);

    for (const vp of VIEWPORTS.slice().reverse()) {
      await page.setViewportSize(vp);
      for (const tela of TELAS_ADMIN) {
        registro.parar();
        registro = escutar(ctx, page);
        const naoAutorizado = [];
        const ouvirStatus = (resp) => {
          const u = new URL(resp.url());
          if (
            u.origin === ctx.origem &&
            u.pathname.startsWith("/api/") &&
            (resp.status() === 401 ||
              resp.status() === 403 ||
              resp.status() >= 500)
          )
            naoAutorizado.push(`${u.pathname} ${resp.status()}`);
        };
        page.on("response", ouvirStatus);
        const nome = `${tela.rotulo} a ${vp.width} px`;
        try {
          const resp = await page.goto(ctx.origem + tela.caminho, {
            waitUntil: "load",
            timeout: 30000,
          });
          await esperarAssentar(page, registro);
          const medida = await medir(page);
          if (naoAutorizado.length)
            registro.erros.push(`API respondeu ${naoAutorizado.join(", ")}`);
          if (!medida.h1.includes(tela.rotulo))
            registro.erros.push(
              `o título é "${medida.h1}", não "${tela.rotulo}"`,
            );
          if (!new URL(page.url()).pathname.startsWith(tela.caminho))
            registro.erros.push(`foi parar em ${new URL(page.url()).pathname}`);
          relatarTela(
            ctx,
            nome,
            medida,
            registro,
            resp?.headers()["content-security-policy"] ?? null,
          );
        } catch (e) {
          rel.falha(nome, `não abriu: ${e.message.split("\n")[0]}`);
        } finally {
          page.off("response", ouvirStatus);
        }
      }
    }

    // Sair pelo botão do menu (a 1366 px o menu lateral está aberto) e conferir que a sessão acabou no servidor.
    registro.parar();
    await page.setViewportSize(VIEWPORTS[1]);
    await page
      .getByRole("button", { name: /^Sair$/ })
      .click({ timeout: 15000 });
    await page
      .waitForURL((u) => !u.pathname.startsWith("/coordenacao"), {
        timeout: 20000,
      })
      .catch(() => {});
    const depois = await pedir(ctx, "/api/sessao", {
      cabecalhos: { Cookie: `__Host-sessao=${cookieDaSessao}` },
    });
    const semCookie = !(await contexto.cookies()).some(
      (c) => c.name === "__Host-sessao" && c.value,
    );
    conectado = !erroDaApi(depois, 401, "nao_autenticado");
    rel.conferir(
      !conectado && semCookie,
      "sair",
      `sessão encerrada no servidor (o cookie antigo dá 401) e apagada do navegador; a tela foi para ${new URL(page.url()).pathname}`,
      `depois de sair: GET /api/sessao com o cookie antigo → ${resumoResposta(depois)}${semCookie ? "" : ", cookie ainda no navegador"}`,
    );
  } catch (e) {
    rel.falha("coordenação com o link do admin", e.message.split("\n")[0]);
  } finally {
    if (conectado) {
      // Garantia: encerra a sessão mesmo se algo falhou no meio.
      const r = await page
        .evaluate(
          async () =>
            (await fetch("/api/sessao/sair", { method: "POST" })).status,
        )
        .catch(() => null);
      rel.aviso(
        "sair (garantia)",
        r === 204
          ? "sessão encerrada pelo POST /api/sessao/sair"
          : `não confirmou o encerramento (${r}); revogue o link se preciso`,
      );
    }
    await contexto.close();
    await navegador.close();
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ principal
const EXECUTAR = {
  saude: conferirSaude,
  site: conferirSite,
  assets: conferirAssets,
  "area-fechada": conferirAreaFechada,
  webhook: conferirWebhook,
  "api-publica": conferirApiPublica,
  navegador: conferirNavegador,
  admin: conferirAdmin,
  "sem-playwright": semPlaywright,
};

/** Roda a verificação. Devolve o código de saída: 0 tudo certo, 1 alguma falha, 2 uso errado. */
export async function principal({
  argv,
  escrever: saida = (texto) => process.stdout.write(texto + "\n"),
}) {
  const segredos = new Set();
  const escrever = (texto = "") => saida(limpar(texto, segredos));
  let op;
  try {
    op = lerArgumentos(argv);
  } catch (e) {
    if (!(e instanceof ErroDeUso)) throw e;
    escrever(`Erro: ${e.message}\n\n${USO}`);
    return 2;
  }
  if (op.ajuda) {
    escrever(USO);
    return 0;
  }

  const pastaPlaywright = precisaDoNavegador(op)
    ? acharPlaywright(locaisDoPlaywright(op.playwright))
    : null;
  const checagens = montarChecagens(op, {
    temPlaywright: pastaPlaywright !== null,
  });
  const rel = criarRelatorio(escrever);
  const ctx = {
    op,
    origem: op.origem,
    local: op.local,
    segredos,
    rel,
    escrever,
    pastaPlaywright,
    chromium: null,
    index: null,
    webhook: "?",
    campanha: "?",
  };

  escrever(
    `Verificação de ${op.origem} (só leitura) em ${new Date().toISOString()}`,
  );
  escrever(
    `Conferências: ${checagens.join(", ")}${pastaPlaywright ? ` (Playwright de ${pastaPlaywright})` : ""}`,
  );
  try {
    for (const id of checagens) {
      rel.secao(TITULOS[id]);
      const seguir = await EXECUTAR[id](ctx);
      if (!seguir) {
        escrever(
          "\nO endereço não respondeu como o site da rifa: as outras conferências foram puladas.",
        );
        break;
      }
    }
  } catch (e) {
    rel.falha("erro inesperado", e?.message ?? String(e));
  }
  if (op.semNavegador)
    escrever(
      "\n(--sem-navegador: as telas abertas no Chromium não foram conferidas)",
    );
  escrever(
    `\nResumo: ${rel.contagem.ok} ok, ${rel.contagem.falha} FALHA(S), ${rel.contagem.aviso} aviso(s). Webhook: ${ctx.webhook}. Campanha: ${ctx.campanha}.`,
  );
  if (rel.falhas.length) {
    escrever("Falhas:");
    for (const f of rel.falhas) escrever(`  - ${f}`);
  }
  return rel.contagem.falha ? 1 : 0;
}

/** true quando este arquivo é o programa principal (`node scripts/verificar-producao.mjs`), e não um import. */
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

if (executadoDiretamente()) {
  if (precisaReabrirComProxy(process.env)) process.exitCode = reabrirComProxy();
  else process.exitCode = await principal({ argv: process.argv.slice(2) });
}
