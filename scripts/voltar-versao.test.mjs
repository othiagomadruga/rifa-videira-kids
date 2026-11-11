// @vitest-environment node
// RIFA-035 (D22): scripts/voltar-versao.mjs, a volta do site para uma versão anterior pelo workflow manual.
// - Unidade, com um wrangler falso: as entradas, a escolha da versão (a regra do `wrangler rollback`) e os
//   argumentos do `wrangler versions deploy`.
// - Ponta a ponta, com o wrangler do projeto contra uma API fictícia da Cloudflare em 127.0.0.1 (o proxy aponta
//   para lugar nenhum: nada sai da máquina): o `wrangler rollback`, no CI, confirma sozinho os segredos trocados
//   e repete o pedido com ?force=true; o script não, e termina com erro.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MOTIVO_MAXIMO,
  descreverPublicacoes,
  lerPedido,
  noArJaVoltou,
  principal,
  versaoAnterior,
  versaoNoAr,
} from "./voltar-versao.mjs";

const ATUAL = "11111111-1111-4111-8111-111111111111";
const ANTERIOR = "22222222-2222-4222-8222-222222222222";
const MAIS_ANTIGA = "33333333-3333-4333-8333-333333333333";
const CONTA = "0123456789abcdef0123456789abcdef";

/** Publicações como o `wrangler deployments list --json` devolve (a mais antiga primeiro). */
const PUBLICACOES = [
  {
    id: "p1",
    created_on: "2026-11-14T12:00:00.000000Z",
    source: "wrangler",
    strategy: "percentage",
    author_email: "dono@example.com",
    annotations: { "workers/triggered_by": "upload" },
    versions: [{ version_id: MAIS_ANTIGA, percentage: 100 }],
  },
  {
    id: "p2",
    created_on: "2026-11-15T12:00:00.000000Z",
    source: "wrangler",
    strategy: "percentage",
    author_email: "dono@example.com",
    annotations: {
      "workers/triggered_by": "secret",
      "workers/message": "token\nnovo `x`",
    },
    versions: [{ version_id: ANTERIOR, percentage: 100 }],
  },
  {
    id: "p3",
    created_on: "2026-11-16T12:00:00.000000Z",
    source: "wrangler",
    strategy: "percentage",
    author_email: "dono@example.com",
    annotations: { "workers/triggered_by": "upload" },
    versions: [{ version_id: ATUAL, percentage: 100 }],
  },
];

/** Um wrangler falso: devolve as respostas dadas, na ordem, e guarda os argumentos de cada chamada. */
function wranglerFalso(...respostas) {
  const chamadas = [];
  const executar = (argumentos) => {
    chamadas.push(argumentos);
    const resposta = respostas.shift();
    if (!resposta) throw new Error(`chamada a mais: ${argumentos.join(" ")}`);
    return { stdout: "", stderr: "", ...resposta };
  };
  return { chamadas, executar };
}

const listaOk = (publicacoes = PUBLICACOES) => ({
  status: 0,
  stdout: JSON.stringify(publicacoes),
});

/** Roda o principal com o wrangler falso e guarda o que ele escreve. */
async function rodarPrincipal(env, executar) {
  const saida = [];
  const erros = [];
  const codigo = await principal({
    env,
    executar,
    escrever: (texto) => saida.push(texto),
    avisar: (texto) => erros.push(texto),
  });
  return { codigo, saida: saida.join("\n"), erros: erros.join("\n") };
}

describe("entradas do workflow", () => {
  it("motivo aparado e versão opcional (vazio: a anterior); o id volta em minúsculas", () => {
    expect(lerPedido({ MOTIVO: "  site fora do ar  ", VERSAO: "" })).toEqual({
      motivo: "site fora do ar",
      versao: undefined,
    });
    expect(
      lerPedido({ MOTIVO: "x", VERSAO: ` ${ATUAL.toUpperCase()} ` }),
    ).toEqual({ motivo: "x", versao: ATUAL });
    expect(
      lerPedido({ MOTIVO: "é".repeat(MOTIVO_MAXIMO) }).motivo,
    ).toHaveLength(MOTIVO_MAXIMO);
  });

  it("recusa motivo vazio, com mais de 120 caracteres ou com quebra de linha, e versão que não é um id", () => {
    for (const env of [
      {},
      { MOTIVO: "   " },
      { MOTIVO: "a".repeat(MOTIVO_MAXIMO + 1) },
      { MOTIVO: "linha 1\n::error::linha 2" },
      { MOTIVO: "x", VERSAO: "--force" },
      { MOTIVO: "x", VERSAO: `${ATUAL}; echo` },
      { MOTIVO: "x", VERSAO: ATUAL.slice(0, -1) + "g" },
    ])
      expect(() => lerPedido(env)).toThrow();
  });

  it("entrada recusada: termina com erro antes de chamar o wrangler", async () => {
    const { chamadas, executar } = wranglerFalso();
    const { codigo, erros } = await rodarPrincipal({ MOTIVO: "" }, executar);
    expect(codigo).toBe(1);
    expect(erros).toMatch(/^::error::Escreva o motivo/);
    expect(chamadas).toEqual([]);
  });
});

describe("escolha da versão (a mesma regra do wrangler rollback)", () => {
  it("a anterior é a de 100% da publicação mais recente antes da atual, em qualquer ordem da lista", () => {
    expect(versaoNoAr(PUBLICACOES)).toBe(ATUAL);
    expect(versaoAnterior(PUBLICACOES)).toBe(ANTERIOR);
    expect(versaoAnterior([...PUBLICACOES].reverse())).toBe(ANTERIOR);
  });

  it("pula a publicação com o tráfego dividido; com uma publicação só (ou nenhuma), não há anterior", () => {
    const dividida = {
      ...PUBLICACOES[1],
      versions: [
        { version_id: ANTERIOR, percentage: 50 },
        { version_id: MAIS_ANTIGA, percentage: 50 },
      ],
    };
    expect(versaoAnterior([PUBLICACOES[0], dividida, PUBLICACOES[2]])).toBe(
      MAIS_ANTIGA,
    );
    expect(versaoAnterior([PUBLICACOES[2]])).toBeUndefined();
    expect(versaoAnterior([])).toBeUndefined();
  });

  it("a lista do log: a mais nova primeiro, a que está no ar marcada, sem e-mail, uma linha por publicação", () => {
    const linhas = descreverPublicacoes(PUBLICACOES);
    expect(linhas).toEqual([
      `[no ar] 2026-11-16T12:00:00.000000Z  ${ATUAL} (100%)  upload`,
      `        2026-11-15T12:00:00.000000Z  ${ANTERIOR} (100%)  secret: token novo 'x'`,
      `        2026-11-14T12:00:00.000000Z  ${MAIS_ANTIGA} (100%)  upload`,
    ]);
    expect(linhas.join("\n")).not.toContain("@");
  });
});

describe("a volta (wrangler falso)", () => {
  it("sem versão: volta para a anterior com o wrangler versions deploy, o motivo como mensagem e sem forçar", async () => {
    const { chamadas, executar } = wranglerFalso(listaOk(), { status: 0 });
    const { codigo, saida } = await rodarPrincipal(
      { MOTIVO: "--force: site fora do ar", VERSAO: "" },
      executar,
    );
    expect(codigo).toBe(0);
    expect(chamadas).toEqual([
      ["deployments", "list", "--json"],
      [
        "versions",
        "deploy",
        `${ANTERIOR}@100%`,
        // Junto do = : o motivo que começa com "-" não vira opção do wrangler.
        "--message=--force: site fora do ar",
        "--yes",
      ],
    ]);
    expect(saida).toContain(
      `::notice::Site de volta à versão ${ANTERIOR} (antes: ${ATUAL})`,
    );
    // O JSON da lista (com o e-mail de quem publicou) não vai para o log.
    expect(saida).not.toContain("dono@example.com");
  });

  it("com a versão: volta para ela (mesmo fora das 10 últimas publicações)", async () => {
    const outra = "44444444-4444-4444-8444-444444444444";
    const { chamadas, executar } = wranglerFalso(listaOk(), { status: 0 });
    const { codigo } = await rodarPrincipal(
      { MOTIVO: "voltar", VERSAO: outra },
      executar,
    );
    expect(codigo).toBe(0);
    expect(chamadas[1]).toEqual([
      "versions",
      "deploy",
      `${outra}@100%`,
      "--message=voltar",
      "--yes",
    ]);
  });

  it("nunca roda o wrangler rollback nem manda force, em nenhum caminho", async () => {
    const casos = [
      [{ status: 0 }],
      [{ status: 1, stderr: "x [code: 10220]" }],
      [{ status: 1, stderr: "outro erro" }],
    ];
    for (const respostas of casos) {
      const { chamadas, executar } = wranglerFalso(listaOk(), ...respostas);
      await rodarPrincipal({ MOTIVO: "x" }, executar);
      for (const argumentos of chamadas)
        expect(argumentos.join(" ")).not.toMatch(/rollback|force/);
    }
  });

  it("os segredos mudaram (10220): termina com erro explicando como escolher a versão pelo id, sem tentar de novo", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "voltar-versao-"));
    const resumo = join(pasta, "resumo.md");
    writeFileSync(resumo, "");
    try {
      const { chamadas, executar } = wranglerFalso(listaOk(), {
        status: 1,
        stderr:
          "✘ [ERROR] A request to the Cloudflare API failed.\n  The following secrets have changed: RIFEI_WEBHOOK_TOKEN [code: 10220]",
      });
      const { codigo, erros } = await rodarPrincipal(
        { MOTIVO: "x", GITHUB_STEP_SUMMARY: resumo },
        executar,
      );
      expect(codigo).toBe(1);
      expect(chamadas).toHaveLength(2);
      expect(erros).toContain(
        `::error::Os segredos do site mudaram depois da versão ${ANTERIOR}`,
      );
      expect(erros).toContain("Nada mudou no site");
      expect(erros).toContain('em "versao"');
      // O resumo da execução (a página do run, também no celular) tem a lista com os ids.
      const texto = readFileSync(resumo, "utf8");
      expect(texto).toContain("Volta recusada: os segredos mudaram");
      expect(texto).toContain(`${ANTERIOR} (100%)  secret`);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it("antes da primeira publicação (lista falha) ou com uma publicação só: erro, sem tentar voltar", async () => {
    const semWorker = wranglerFalso({
      status: 1,
      stderr: "This Worker does not exist on your account. [code: 10007]",
    });
    const primeiro = await rodarPrincipal({ MOTIVO: "x" }, semWorker.executar);
    expect(primeiro.codigo).toBe(1);
    expect(primeiro.erros).toContain(
      "Antes da primeira publicação não existe versão para voltar",
    );
    expect(semWorker.chamadas).toHaveLength(1);

    const umaSo = wranglerFalso(listaOk([PUBLICACOES[2]]));
    const segundo = await rodarPrincipal({ MOTIVO: "x" }, umaSo.executar);
    expect(segundo.codigo).toBe(1);
    expect(segundo.erros).toContain("Não existe versão anterior para voltar");
    expect(umaSo.chamadas).toHaveLength(1);
  });

  it("logo depois de uma volta, sem o id: para com erro em vez de desfazê-la (toque a mais, Re-run); com o id, volta", async () => {
    // A volta para a ANTERIOR (p4) pôs no ar de novo uma versão que já tinha estado no ar (p2).
    const depoisDaVolta = [
      ...PUBLICACOES,
      {
        id: "p4",
        created_on: "2026-11-17T12:00:00.000000Z",
        source: "wrangler",
        strategy: "percentage",
        annotations: {
          "workers/triggered_by": "deployment",
          "workers/message": "site fora do ar",
        },
        versions: [{ version_id: ANTERIOR, percentage: 100 }],
      },
    ];
    expect(noArJaVoltou(depoisDaVolta)).toBe(true);
    expect(noArJaVoltou(PUBLICACOES)).toBe(false);
    expect(noArJaVoltou([PUBLICACOES[2]])).toBe(false);
    expect(noArJaVoltou([])).toBe(false);
    // A regra do rollback, sozinha, desfaria a volta.
    expect(versaoAnterior(depoisDaVolta)).toBe(ATUAL);

    const pasta = mkdtempSync(join(tmpdir(), "voltar-versao-"));
    const resumo = join(pasta, "resumo.md");
    writeFileSync(resumo, "");
    try {
      const semId = wranglerFalso(listaOk(depoisDaVolta));
      const recusa = await rodarPrincipal(
        { MOTIVO: "x", VERSAO: "", GITHUB_STEP_SUMMARY: resumo },
        semId.executar,
      );
      expect(recusa.codigo).toBe(1);
      expect(semId.chamadas).toHaveLength(1);
      expect(recusa.erros).toContain(
        `::error::O site já está numa versão que voltou (${ANTERIOR}`,
      );
      expect(recusa.erros).toContain("Nada mudou no site");
      expect(recusa.erros).toContain(`rode de novo com ${ATUAL} em "versao"`);
      expect(readFileSync(resumo, "utf8")).toContain(
        "Nada mudou: o site já está numa versão que voltou",
      );
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }

    const comId = wranglerFalso(listaOk(depoisDaVolta), { status: 0 });
    const desfeita = await rodarPrincipal(
      { MOTIVO: "x", VERSAO: ATUAL },
      comId.executar,
    );
    expect(desfeita.codigo).toBe(0);
    expect(comId.chamadas[1]).toEqual([
      "versions",
      "deploy",
      `${ATUAL}@100%`,
      "--message=x",
      "--yes",
    ]);
  });

  it("a versão pedida já está no ar: nada muda; outra falha do wrangler: erro", async () => {
    const jaNoAr = wranglerFalso(listaOk());
    const mesma = await rodarPrincipal(
      { MOTIVO: "x", VERSAO: ATUAL },
      jaNoAr.executar,
    );
    expect(mesma.codigo).toBe(0);
    expect(mesma.saida).toContain("já está no ar");
    expect(jaNoAr.chamadas).toHaveLength(1);

    const falha = wranglerFalso(listaOk(), { status: 1, stderr: "sem rede" });
    const outra = await rodarPrincipal({ MOTIVO: "x" }, falha.executar);
    expect(outra.codigo).toBe(1);
    expect(outra.erros).toContain(
      `::error::A volta para a versão ${ANTERIOR} falhou`,
    );
  });
});

describe("ponta a ponta: o wrangler do projeto contra uma API fictícia da Cloudflare (127.0.0.1)", () => {
  const raiz = fileURLToPath(new URL("..", import.meta.url));
  const wrangler = join(raiz, "node_modules/wrangler/bin/wrangler.js");
  const script = join(raiz, "scripts/voltar-versao.mjs");
  let pasta;
  let servidor;
  let base;
  /** Pedidos recebidos pela API fictícia. */
  let pedidos = [];
  /** true: a API recusa a publicação sem ?force=true (os segredos mudaram), como a Cloudflare (10220). */
  let segredosMudaram = true;

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), "voltar-versao-e2e-"));
    servidor = createServer((req, res) => {
      let corpo = "";
      req.on("data", (pedaco) => (corpo += pedaco));
      req.on("end", () => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        pedidos.push({ metodo: req.method, url, corpo });
        const responder = (status, conteudo) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(conteudo));
        };
        const ok = (result) =>
          responder(200, { success: true, errors: [], messages: [], result });
        if (req.method === "GET" && url.pathname.endsWith("/deployments"))
          return ok({ deployments: [...PUBLICACOES].reverse() });
        if (req.method === "GET" && /\/versions\/[\w-]+$/.test(url.pathname))
          return ok({
            id: url.pathname.split("/").pop(),
            number: 1,
            metadata: {
              created_on: "2026-11-14T12:00:00Z",
              source: "wrangler",
            },
            annotations: {},
            resources: {
              bindings: [],
              script: { etag: "e", handlers: ["fetch"] },
              script_runtime: {},
            },
          });
        if (req.method === "POST" && url.pathname.endsWith("/deployments")) {
          if (segredosMudaram && url.searchParams.get("force") !== "true")
            return responder(400, {
              success: false,
              messages: [],
              result: null,
              errors: [
                {
                  code: 10220,
                  message:
                    "The following secrets have changed: RIFEI_WEBHOOK_TOKEN",
                },
              ],
            });
          return ok({ id: "p4" });
        }
        if (req.method === "PATCH" && url.pathname.endsWith("/script-settings"))
          return ok({ observability: { enabled: true } });
        return ok({});
      });
    });
    await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto));
    base = `http://127.0.0.1:${servidor.address().port}/client/v4`;
  });

  afterAll(async () => {
    await new Promise((fechado) => servidor.close(fechado));
    rmSync(pasta, { recursive: true, force: true });
  });

  /** Roda o node com os argumentos, como no CI, só com a API fictícia e um token falso no ambiente. */
  function rodar(argumentos, extra = {}) {
    const morto = "http://127.0.0.1:9";
    const env = {
      PATH: process.env.PATH,
      HOME: pasta,
      XDG_CONFIG_HOME: pasta,
      CI: "true",
      CLOUDFLARE_API_BASE_URL: base,
      CLOUDFLARE_API_TOKEN: "token-ficticio-dos-testes",
      CLOUDFLARE_ACCOUNT_ID: CONTA,
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: pasta,
      // Fora a API fictícia, nada sai da máquina.
      HTTPS_PROXY: morto,
      HTTP_PROXY: morto,
      https_proxy: morto,
      http_proxy: morto,
      NO_PROXY: "127.0.0.1",
      no_proxy: "127.0.0.1",
      ...extra,
    };
    return new Promise((pronto) =>
      execFile(
        process.execPath,
        argumentos,
        { cwd: raiz, env, timeout: 60_000 },
        (erro, stdout, stderr) =>
          pronto({ codigo: erro ? (erro.code ?? 1) : 0, stdout, stderr }),
      ),
    );
  }

  const publicacoesFeitas = () =>
    pedidos.filter(
      (pedido) =>
        pedido.metodo === "POST" &&
        pedido.url.pathname.endsWith("/deployments"),
    );

  it("por que não o wrangler rollback: no CI, mesmo com --yes, ele confirma sozinho os segredos trocados e repete com ?force=true (se mudar numa subida do wrangler, reveja a D22)", async () => {
    pedidos = [];
    segredosMudaram = true;
    const { codigo, stdout } = await rodar([
      wrangler,
      "rollback",
      "--message=teste",
      "--yes",
    ]);
    expect(codigo).toBe(0);
    expect(stdout).toContain("The following secrets have changed");
    expect(publicacoesFeitas().map((pedido) => pedido.url.search)).toEqual([
      "",
      "?force=true",
    ]);
  }, 60_000);

  it("o script, com os segredos trocados: um pedido só, sem force, e termina com erro explicando", async () => {
    pedidos = [];
    segredosMudaram = true;
    const resumo = join(pasta, "resumo-segredos.md");
    writeFileSync(resumo, "");
    const { codigo, stderr } = await rodar([script], {
      MOTIVO: "teste da volta",
      VERSAO: "",
      GITHUB_STEP_SUMMARY: resumo,
    });
    expect(codigo).toBe(1);
    const feitas = publicacoesFeitas();
    expect(feitas.map((pedido) => pedido.url.search)).toEqual([""]);
    expect(JSON.parse(feitas[0].corpo)).toMatchObject({
      strategy: "percentage",
      versions: [{ version_id: ANTERIOR, percentage: 100 }],
      annotations: { "workers/message": "teste da volta" },
    });
    expect(stderr).toContain(
      `::error::Os segredos do site mudaram depois da versão ${ANTERIOR}`,
    );
    expect(readFileSync(resumo, "utf8")).toContain(`${ANTERIOR} (100%)`);
  }, 60_000);

  it("o script, sem segredo trocado: volta para a anterior com o motivo e termina bem", async () => {
    pedidos = [];
    segredosMudaram = false;
    const { codigo, stdout } = await rodar([script], {
      MOTIVO: "site fora do ar",
      VERSAO: "",
    });
    expect(codigo).toBe(0);
    const feitas = publicacoesFeitas();
    expect(feitas.map((pedido) => pedido.url.search)).toEqual([""]);
    expect(JSON.parse(feitas[0].corpo)).toMatchObject({
      versions: [{ version_id: ANTERIOR, percentage: 100 }],
      annotations: { "workers/message": "site fora do ar" },
    });
    expect(stdout).toContain(`::notice::Site de volta à versão ${ANTERIOR}`);
    expect(stdout).not.toContain("dono@example.com");
  }, 60_000);
});
