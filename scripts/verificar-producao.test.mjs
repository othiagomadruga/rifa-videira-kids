// @vitest-environment node
// RIFA-058: scripts/verificar-producao.mjs, a verificação do site publicado (só leitura).
// - As partes puras: o filtro que esconde link, token e cookie da saída; as opções; a lista de checagens (com e sem
//   o Playwright); os cabeçalhos esperados contra o public/_headers; e o link lido da saída do acesso:criar.
// - A ponta, sem rede: uso errado (2) e um endereço sem nada escutando (1, com a saúde como única conferência).
//   Nada vaza com um servidor local que ecoa o que recebe e com um Playwright de mentira (revisão da RIFA-058):
//   resposta cortada só depois de limpar, token do arquivo escondido mesmo codificado, DEBUG fora do ambiente.
//   A prova contra o build local (npm run preview) e contra a produção fica no relatório da tarefa e no roteiro
//   (docs/lancamento.md, 2.3 e 3.1): ela precisa do Worker no ar e, para as telas, do Playwright.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CABECALHOS_ESPERADOS,
  CHECAGENS_HTTP,
  ErroDeUso,
  GETS_PROTEGIDOS,
  PLAYWRIGHT_DA_SESSAO,
  TITULOS,
  acharPlaywright,
  cacheLongo,
  lerArgumentos,
  lerLinkDoAdmin,
  limpar,
  locaisDoPlaywright,
  montarChecagens,
  precisaDoNavegador,
  precisaReabrirComProxy,
  principal,
  problemasDosCabecalhos,
} from "./verificar-producao.mjs";

/** Um token no formato do contrato (FORMATO_TOKEN_ACESSO: 43 caracteres base64url). Fictício. */
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE";
const ORIGEM = "https://rifa-videira-kids.madruga.workers.dev";
const LINK = `${ORIGEM}/acesso/${TOKEN}`;

describe("limpar: nada de link, token ou cookie na saída", () => {
  it.each([
    [
      "o link inteiro",
      `abra ${LINK} agora`,
      `abra ${ORIGEM}/acesso/[omitido] agora`,
    ],
    ["o caminho sem a origem", `GET /acesso/${TOKEN}`, "GET /acesso/[omitido]"],
    [
      "um token cortado de 16 caracteres ou mais no caminho",
      "/acesso/AbCdEfGhIjKlMnOp",
      "/acesso/[omitido]",
    ],
    [
      "o cookie da sessão num Cookie ou Set-Cookie",
      `Set-Cookie: __Host-sessao=${TOKEN}; Path=/; Secure; HttpOnly`,
      "Set-Cookie: __Host-sessao=[omitido]; Path=/; Secure; HttpOnly",
    ],
    [
      "o cookie entre aspas e vírgulas",
      `{"cookie":"__Host-sessao=abc.def"}, __Host-sessao=xyz,`,
      `{"cookie":"__Host-sessao=[omitido]"}, __Host-sessao=[omitido],`,
    ],
    [
      "o que vem depois de Bearer (maiúscula ou minúscula)",
      "Authorization: Bearer 0123abcd/+=.~_- e bearer outro",
      "Authorization: Bearer [omitido] e Bearer [omitido]",
    ],
    ["um token de 43 caracteres solto", `token=${TOKEN}.`, "token=[omitido]."],
  ])("esconde %s", (_caso, texto, esperado) => {
    expect(limpar(texto)).toBe(esperado);
  });

  it("esconde cada segredo conhecido, onde estiver (ex.: o token do webhook em hexadecimal)", () => {
    const hex = "f".repeat(64);
    expect(limpar(`token errado ${hex} e ${hex}x`, new Set([hex, ""]))).toBe(
      "token errado [omitido] e [omitido]x",
    );
  });

  it("não esconde o que é útil: assets com hash, ids de versão, /acesso sem token e a URL do webhook", () => {
    const texto = [
      "/assets/index-CxKiX6XU.js 200",
      "/assets/outfit-latin-800-normal-CxKiX6XU.woff2",
      "Current Version ID: 1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      "o endereço virou /acesso",
      "/acesso/[token]",
      `${ORIGEM}/api/webhooks/rifei`,
      "__Host-sessao=; Max-Age=0",
      "um token de 42: AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCd",
    ].join("\n");

    expect(limpar(texto)).toBe(texto);
  });

  it("aceita qualquer valor (erro, número) e devolve texto", () => {
    expect(limpar(new Error(`falhou em ${LINK}`))).toBe(
      `Error: falhou em ${ORIGEM}/acesso/[omitido]`,
    );
    expect(limpar(401)).toBe("401");
  });
});

describe("lerArgumentos", () => {
  it("só --url: produção, com o navegador e sem o link", () => {
    expect(lerArgumentos(["--url", ORIGEM])).toEqual({
      ajuda: false,
      url: ORIGEM,
      adminLink: null,
      semNavegador: false,
      capturas: null,
      playwright: null,
      origem: ORIGEM,
      local: false,
    });
  });

  it("aceita --opção=valor, --sem-navegador e o endereço local em http (prova contra o preview)", () => {
    const op = lerArgumentos([
      "--url=http://127.0.0.1:5943/",
      "--sem-navegador",
      "--admin-link=/tmp/link.txt",
      "--capturas",
      "/tmp/capturas",
    ]);

    expect(op).toMatchObject({
      origem: "http://127.0.0.1:5943",
      local: true,
      semNavegador: true,
      adminLink: "/tmp/link.txt",
      capturas: "/tmp/capturas",
    });
  });

  it("--help pede a ajuda", () => {
    expect(lerArgumentos(["--url", ORIGEM, "--help"])).toEqual({ ajuda: true });
  });

  it.each([
    ["sem --url", [], "--url é obrigatória"],
    ["--url sem valor", ["--url"], "--url precisa de um valor"],
    [
      "valor que é outra opção",
      ["--url", "--sem-navegador"],
      "--url precisa de um valor",
    ],
    [
      "opção desconhecida",
      ["--url", ORIGEM, "--token", "x"],
      "opção desconhecida: --token",
    ],
    ["endereço inválido", ["--url", "rifa"], "--url não é um endereço válido"],
    [
      "caminho além da origem",
      ["--url", `${ORIGEM}/coordenacao`],
      "--url deve ser só a origem",
    ],
    ["com consulta", ["--url", `${ORIGEM}/?a=1`], "--url deve ser só a origem"],
    [
      "com usuário e senha",
      ["--url", "https://a:b@exemplo.com"],
      "--url deve ser só a origem",
    ],
    [
      "outro protocolo",
      ["--url", "ftp://exemplo.com"],
      "--url deve ser só a origem",
    ],
    [
      "http fora da máquina local",
      ["--url", "http://rifa-videira-kids.madruga.workers.dev"],
      "precisa ser https",
    ],
  ])("recusa %s", (_caso, argv, mensagem) => {
    expect(() => lerArgumentos(argv)).toThrow(ErroDeUso);
    expect(() => lerArgumentos(argv)).toThrow(mensagem);
  });
});

describe("montarChecagens: a lista do que esta execução confere", () => {
  const op = (extra = {}) => ({
    ...lerArgumentos(["--url", ORIGEM]),
    ...extra,
  });

  it("as conferências HTTP vêm sempre, nesta ordem, com a saúde primeiro (ela decide se o resto roda)", () => {
    expect(CHECAGENS_HTTP).toEqual([
      "saude",
      "site",
      "assets",
      "area-fechada",
      "webhook",
      "api-publica",
    ]);
  });

  it.each([
    [
      "padrão: HTTP e as telas abertas",
      {},
      true,
      [...CHECAGENS_HTTP, "navegador"],
    ],
    ["--sem-navegador: só HTTP", { semNavegador: true }, true, CHECAGENS_HTTP],
    [
      "--admin-link: HTTP, as telas abertas e a coordenação",
      { adminLink: "/tmp/link.txt" },
      true,
      [...CHECAGENS_HTTP, "navegador", "admin"],
    ],
    [
      "--sem-navegador com --admin-link: HTTP e a coordenação (o link usa o Chromium)",
      { semNavegador: true, adminLink: "/tmp/link.txt" },
      true,
      [...CHECAGENS_HTTP, "admin"],
    ],
    [
      "sem o Playwright: HTTP e a falha que explica o que fazer",
      {},
      false,
      [...CHECAGENS_HTTP, "sem-playwright"],
    ],
    [
      "sem o Playwright, com --admin-link: a mesma falha, uma vez",
      { semNavegador: true, adminLink: "/tmp/link.txt" },
      false,
      [...CHECAGENS_HTTP, "sem-playwright"],
    ],
    [
      "sem o Playwright e com --sem-navegador: só HTTP, sem falha",
      { semNavegador: true },
      false,
      CHECAGENS_HTTP,
    ],
  ])("%s", (_caso, extra, temPlaywright, esperado) => {
    expect(montarChecagens(op(extra), { temPlaywright })).toEqual(esperado);
  });

  it("procura o Playwright só quando alguma conferência usa o Chromium", () => {
    expect(precisaDoNavegador(op())).toBe(true);
    expect(precisaDoNavegador(op({ semNavegador: true }))).toBe(false);
    expect(precisaDoNavegador(op({ semNavegador: true, adminLink: "x" }))).toBe(
      true,
    );
  });

  it("toda checagem possível tem título", () => {
    const todas = new Set(
      [true, false].flatMap((temPlaywright) =>
        [{}, { semNavegador: true }, { adminLink: "x" }].flatMap((extra) =>
          montarChecagens(op(extra), { temPlaywright }),
        ),
      ),
    );
    for (const id of todas) expect(TITULOS[id], id).toBeTypeOf("string");
  });
});

describe("Playwright fora do projeto", () => {
  it("procura no projeto e na pasta da sessão de nuvem do Claude, ou só na pasta de --playwright", () => {
    const [doProjeto, daSessao] = locaisDoPlaywright(null);

    expect(doProjeto).toMatch(/node_modules$/);
    expect(daSessao).toBe(PLAYWRIGHT_DA_SESSAO);
    expect(locaisDoPlaywright("/outra/node_modules")).toEqual([
      "/outra/node_modules",
    ]);
  });

  it("pasta sem o pacote: não acha (e não carrega nada), mesmo com um Playwright no NODE_PATH", () => {
    expect(acharPlaywright(["/pasta-que-nao-existe/node_modules"])).toBeNull();
  });

  it("fica com a primeira pasta que tem o pacote", () => {
    const vazia = mkdtempSync(join(tmpdir(), "sem-playwright-"));
    const comPacote = mkdtempSync(join(tmpdir(), "com-playwright-"));
    try {
      mkdirSync(join(comPacote, "playwright"));
      writeFileSync(join(comPacote, "playwright", "package.json"), "{}");

      expect(acharPlaywright([vazia, comPacote])).toBe(comPacote);
    } finally {
      rmSync(vazia, { recursive: true, force: true });
      rmSync(comPacote, { recursive: true, force: true });
    }
  });
});

describe("o que se espera do site", () => {
  it("os cabeçalhos esperados são os da regra /* do public/_headers", () => {
    const texto = readFileSync(
      new URL("../public/_headers", import.meta.url),
      "utf8",
    );
    const regraGeral = texto.split(/\r?\n/).reduce(
      (estado, linha) => {
        if (linha.trim() === "" || linha.trim().startsWith("#")) return estado;
        if (!/^\s/.test(linha)) return { ...estado, atual: linha.trim() };
        if (estado.atual !== "/*") return estado;
        const separador = linha.indexOf(":");
        estado.cabecalhos[linha.slice(0, separador).trim().toLowerCase()] =
          linha.slice(separador + 1).trim();
        return estado;
      },
      { atual: null, cabecalhos: {} },
    ).cabecalhos;

    expect(regraGeral).toEqual(CABECALHOS_ESPERADOS);
  });

  it("problemasDosCabecalhos aponta o ausente e o diferente", () => {
    const certos = new Headers(CABECALHOS_ESPERADOS);
    expect(problemasDosCabecalhos(certos)).toEqual([]);

    certos.delete("x-frame-options");
    certos.set("referrer-policy", "origin");
    expect(problemasDosCabecalhos(certos)).toEqual([
      'referrer-policy = "origin"',
      "x-frame-options ausente",
    ]);
  });

  it("os caminhos da área fechada estão todos atrás do login", () => {
    for (const caminho of GETS_PROTEGIDOS)
      expect(caminho).toMatch(/^\/api\/(admin\/|painel\/|minha\/|sessao$)/);
    expect(new Set(GETS_PROTEGIDOS).size).toBe(GETS_PROTEGIDOS.length);
  });

  it.each([
    [null, false],
    ["public, max-age=0, must-revalidate", false],
    ["no-store", false],
    ["public, s-maxage=600", false],
    ["public, max-age=31536000, immutable", true],
    ["max-age=60", true],
    ["public, immutable", true],
  ])("cacheLongo(%s) = %s", (valor, esperado) => {
    expect(cacheLongo(valor)).toBe(esperado);
  });
});

describe("lerLinkDoAdmin", () => {
  it("acha o link na saída inteira do acesso:criar", () => {
    const saida = [
      "Acesso criado no D1 remoto: Fulano de Tal (admin), usuário 1.",
      "",
      `  ${LINK}`,
      "",
      "O link vale até 2026-12-30T12:00:00.000Z (UTC) e pode ser aberto mais de uma vez nesse prazo.",
    ].join("\n");

    expect(lerLinkDoAdmin(saida)).toEqual({
      link: LINK,
      origem: ORIGEM,
      token: TOKEN,
    });
  });

  it.each([
    ["token cortado", `${ORIGEM}/acesso/${TOKEN.slice(0, 40)}`],
    ["token com caractere a mais", `${ORIGEM}/acesso/${TOKEN}x`],
    ["sem a origem", `/acesso/${TOKEN}`],
    ["vazio", ""],
  ])("recusa %s, sem repetir o conteúdo na mensagem", (_caso, texto) => {
    expect(() => lerLinkDoAdmin(texto)).toThrow(
      "o arquivo não tem um link /acesso/<token> completo (43 caracteres)",
    );
  });
});

describe("proxy da sessão", () => {
  it.each([
    [{}, false],
    [{ HTTPS_PROXY: "http://127.0.0.1:1" }, true],
    [{ https_proxy: "http://127.0.0.1:1" }, true],
    [{ HTTPS_PROXY: "http://127.0.0.1:1", NODE_USE_ENV_PROXY: "1" }, false],
  ])("precisaReabrirComProxy(%o) = %s", (env, esperado) => {
    expect(precisaReabrirComProxy(env)).toBe(esperado);
  });
});

describe("principal (sem rede)", () => {
  /** Uma porta da máquina sem nada escutando. */
  async function portaFechada() {
    const servidor = createServer();
    await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto));
    const { port } = servidor.address();
    await new Promise((fechado) => servidor.close(fechado));
    return port;
  }

  async function rodar(argv) {
    const linhas = [];
    const codigo = await principal({ argv, escrever: (t) => linhas.push(t) });
    return { codigo, saida: linhas.join("\n") };
  }

  it("uso errado: 2, com o uso", async () => {
    const { codigo, saida } = await rodar(["--url", `${ORIGEM}/x`]);

    expect(codigo).toBe(2);
    expect(saida).toContain("--url deve ser só a origem");
    expect(saida).toContain("Uso: npm run verificar:producao");
  });

  it("--help: 0", async () => {
    expect((await rodar(["--help"])).codigo).toBe(0);
  });

  it("endereço sem nada escutando: 1, a saúde falha e o resto é pulado", async () => {
    const porta = await portaFechada();
    const { codigo, saida } = await rodar([
      "--url",
      `http://127.0.0.1:${porta}`,
      "--sem-navegador",
    ]);

    expect(codigo).toBe(1);
    expect(saida).toContain(`Conferências: ${CHECAGENS_HTTP.join(", ")}`);
    expect(saida).toMatch(
      /\[FALHA\] GET \/api\/health: sem resposta \(ECONNREFUSED/,
    );
    expect(saida).toContain("as outras conferências foram puladas");
    expect(saida).not.toContain("== 2. Site");
    expect(saida).toContain("Resumo: 0 ok, 1 FALHA(S), 0 aviso(s)");
  });

  it("nada vaza: o servidor ecoa cookie e Authorization, e o link do arquivo é de outro endereço", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "verificar-producao-"));
    // Um "playwright" de mentira: a coordenação para antes de abrir o navegador (o link é de outro endereço).
    const pacote = join(pasta, "node_modules", "playwright");
    mkdirSync(pacote, { recursive: true });
    writeFileSync(
      join(pacote, "package.json"),
      '{"name":"playwright","main":"index.js"}',
    );
    writeFileSync(
      join(pacote, "index.js"),
      'module.exports = { chromium: { launch() { throw new Error("não devia abrir o navegador"); } } };',
    );
    const arquivoDoLink = join(pasta, "link.txt");
    writeFileSync(arquivoDoLink, `Acesso criado.\n\n  ${LINK}\n`);

    // Responde JSON na saúde (passa a porta de entrada) e ecoa os cabeçalhos sensíveis no resto.
    const recebidos = [];
    const servidor = createHttpServer((req, res) => {
      const sensiveis = [req.headers.authorization, req.headers.cookie].filter(
        Boolean,
      );
      recebidos.push(...sensiveis);
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":false}');
        return;
      }
      res.writeHead(401, { "content-type": "text/plain" });
      res.end(sensiveis.join(" "));
    });
    await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto));
    try {
      const { codigo, saida } = await rodar([
        "--url",
        `http://127.0.0.1:${servidor.address().port}`,
        "--sem-navegador",
        "--admin-link",
        arquivoDoLink,
        "--playwright",
        join(pasta, "node_modules"),
      ]);

      expect(codigo).toBe(1);
      expect(saida).toContain(
        `[FALHA] link do admin: o link é de outro endereço (${ORIGEM})`,
      );
      // O script mandou o cookie forjado e o token errado, e o servidor os devolveu no corpo.
      const segredos = recebidos.map((v) =>
        v.replace(/^(Bearer |__Host-sessao=)/, ""),
      );
      expect(segredos.length).toBeGreaterThanOrEqual(2);
      expect(saida).toContain("Bearer [omitido]");
      expect(saida).toContain("__Host-sessao=[omitido]");
      for (const segredo of [...segredos, TOKEN])
        expect(saida).not.toContain(segredo.slice(0, 16));
    } finally {
      await new Promise((fechado) => servidor.close(fechado));
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it("corta a resposta só depois de esconder: um segredo ecoado no meio do corpo não sai pela metade", async () => {
    // Ecoa o valor cru (sem "Bearer " nem "__Host-sessao=") a partir do 31º caractere: o resumo mostra 60.
    const recebidos = [];
    const servidor = createHttpServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":false}');
        return;
      }
      const crus = [req.headers.authorization, req.headers.cookie]
        .filter(Boolean)
        .map((v) => v.replace(/^(Bearer |__Host-sessao=)/, ""));
      recebidos.push(...crus);
      res.writeHead(401, { "content-type": "text/plain" });
      res.end(".".repeat(30) + crus.join(" "));
    });
    await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto));
    try {
      const { codigo, saida } = await rodar([
        "--url",
        `http://127.0.0.1:${servidor.address().port}`,
        "--sem-navegador",
      ]);

      expect(codigo).toBe(1);
      // O cookie forjado (base64url) e o token errado do webhook (hexadecimal), cada um mandado ao menos uma vez.
      expect(recebidos.length).toBeGreaterThanOrEqual(2);
      expect(saida).toContain("cookie de sessão forjado: 401 text/plain (");
      for (const segredo of recebidos)
        expect(saida).not.toContain(segredo.slice(0, 16));
    } finally {
      await new Promise((fechado) => servidor.close(fechado));
    }
  });

  describe("com o link do admin do mesmo endereço (o Chromium de mentira não abre)", () => {
    /**
     * Roda com um "playwright" de mentira (o index.js é `indexJs`, cujo launch() lança um erro), contra um servidor
     * que só responde à saúde. O link do arquivo é do mesmo endereço: a coordenação lê o token e tenta abrir o Chromium.
     */
    async function rodarComChromiumQueFalha(indexJs) {
      const pasta = mkdtempSync(join(tmpdir(), "verificar-producao-"));
      const pacote = join(pasta, "node_modules", "playwright");
      mkdirSync(pacote, { recursive: true });
      writeFileSync(
        join(pacote, "package.json"),
        '{"name":"playwright","main":"index.js"}',
      );
      writeFileSync(join(pacote, "index.js"), indexJs);
      const servidor = createHttpServer((req, res) => {
        res.writeHead(req.url === "/api/health" ? 200 : 404, {
          "content-type": "application/json",
        });
        res.end('{"ok":false}');
      });
      await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto));
      const origem = `http://127.0.0.1:${servidor.address().port}`;
      const arquivoDoLink = join(pasta, "link.txt");
      writeFileSync(
        arquivoDoLink,
        `Acesso criado.\n\n  ${origem}/acesso/${TOKEN}\n`,
      );
      try {
        return await rodar([
          "--url",
          origem,
          "--sem-navegador",
          "--admin-link",
          arquivoDoLink,
          "--playwright",
          join(pasta, "node_modules"),
        ]);
      } finally {
        await new Promise((fechado) => servidor.close(fechado));
        rmSync(pasta, { recursive: true, force: true });
      }
    }

    it("o token lido do arquivo some mesmo onde os padrões gerais não o reconhecem (erro com o link codificado)", async () => {
      const codificado = `${encodeURIComponent("http://127.0.0.1:1/acesso/")}${TOKEN}`;
      // Sem a lista de segredos, limpar() deixaria passar: "%2F" cola uma letra antes do token.
      expect(limpar(`falhou em ${codificado}`)).toContain(TOKEN);

      const { codigo, saida } = await rodarComChromiumQueFalha(
        `module.exports = { chromium: { launch() { throw new Error(${JSON.stringify(`page.goto: falhou em ${codificado}`)}); } } };`,
      );

      expect(codigo).toBe(1);
      expect(saida).toContain(
        `não abriu: page.goto: falhou em ${encodeURIComponent("http://127.0.0.1:1/acesso/")}[omitido]`,
      );
      expect(saida).not.toContain(TOKEN.slice(0, 16));
    });

    it("tira DEBUG e DEBUG_FILE do ambiente antes de carregar o Playwright (o log dele não passa por limpar)", async () => {
      const antes = {
        DEBUG: process.env.DEBUG,
        DEBUG_FILE: process.env.DEBUG_FILE,
      };
      process.env.DEBUG = "pw:api";
      process.env.DEBUG_FILE = join(tmpdir(), "nao-devia-gravar.log");
      try {
        const { saida } = await rodarComChromiumQueFalha(
          [
            "const visto = `DEBUG=${process.env.DEBUG ?? 'ausente'} DEBUG_FILE=${process.env.DEBUG_FILE ?? 'ausente'}`;",
            "module.exports = { chromium: { launch() { throw new Error('ao carregar: ' + visto); } } };",
          ].join("\n"),
        );

        expect(saida).toContain(
          "não abriu: ao carregar: DEBUG=ausente DEBUG_FILE=ausente",
        );
      } finally {
        for (const [nome, valor] of Object.entries(antes))
          if (valor === undefined) delete process.env[nome];
          else process.env[nome] = valor;
      }
    });
  });
});
