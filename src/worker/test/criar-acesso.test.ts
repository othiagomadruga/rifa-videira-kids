// RIFA-007 CA6: scripts/criar-acesso.mjs (primeiro acesso). O script roda de verdade, com o wrangler trocado
// por um executor que faz o que `wrangler d1 execute DB --local --json --command` faz: separa os comandos e
// roda em um batch no D1 (aqui, o D1 dos testes) e devolve o JSON de resultados.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  ORIGEM_LOCAL,
  VALIDADE_LINK_DIAS,
  montarComandos,
  principal,
  sha256Hex,
  validarNome,
  type ResultadoWrangler,
} from "../../../scripts/criar-acesso.mjs";
import { VALIDADE_LINK_DIAS as VALIDADE_DO_CONTRATO } from "../../shared/contracts";
import { chamar, cookieDaResposta, criarAppDeTeste } from "./acesso-teste";

/** O valor de `--command` nos argumentos do wrangler. */
function comandoSql(argumentos: string[]): string {
  const indice = argumentos.indexOf("--command");
  expect(indice).toBeGreaterThan(-1);
  return argumentos[indice + 1];
}

/** Como o wrangler local: um comando por linha (o script gera assim), todos num batch, saída --json. */
async function wranglerComD1DeTeste(
  argumentos: string[],
): Promise<ResultadoWrangler> {
  const comandos = comandoSql(argumentos)
    .split("\n")
    .filter((linha) => linha.trim() !== "");
  try {
    const resultados = await env.DB.batch(
      comandos.map((sql) => env.DB.prepare(sql)),
    );
    return {
      status: 0,
      stdout: JSON.stringify(
        resultados.map((resultado) => ({
          results: resultado.results,
          success: resultado.success,
          meta: { duration: resultado.meta.duration },
        })),
      ),
      stderr: "",
    };
  } catch (erro) {
    return { status: 1, stdout: "", stderr: `✘ [ERROR] ${String(erro)}` };
  }
}

async function rodar(argv: string[], executar = wranglerComD1DeTeste) {
  const saida: string[] = [];
  const erros: string[] = [];
  const chamadas: string[][] = [];
  const codigo = await principal({
    argv,
    executarWrangler: async (argumentos) => {
      chamadas.push(argumentos);
      return executar(argumentos);
    },
    escrever: (texto) => saida.push(texto),
    escreverErro: (texto) => erros.push(texto),
  });
  return { codigo, saida: saida.join("\n"), erros: erros.join("\n"), chamadas };
}

function tokenImpresso(saida: string, origem: string): string {
  const linha = saida
    .split("\n")
    .find((texto) => texto.trim().startsWith(`${origem}/acesso/`));
  expect(linha).toBeDefined();
  const token = linha!.trim().slice(`${origem}/acesso/`.length);
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return token;
}

describe("CA6: scripts/criar-acesso.mjs", () => {
  it("cria um admin no D1 local e imprime um link que abre sessão no POST /api/sessao", async () => {
    const nome = `Admin Inicial ${crypto.randomUUID().slice(0, 8)}`;

    const execucao = await rodar(["--nome", nome, "--papel", "admin"]);

    expect(execucao.erros).toBe("");
    expect(execucao.codigo).toBe(0);
    expect(execucao.chamadas).toHaveLength(1);
    expect(execucao.chamadas[0].slice(0, 6)).toEqual([
      "d1",
      "execute",
      "DB",
      "--local",
      "--json",
      "--command",
    ]);
    const token = tokenImpresso(execucao.saida, ORIGEM_LOCAL);
    // O SQL enviado ao wrangler leva o hash, nunca o token.
    const sql = comandoSql(execucao.chamadas[0]);
    expect(sql).not.toContain(token);
    expect(sql).toContain(await sha256Hex(token));

    const usuario = await env.DB.prepare(
      `SELECT u.id, u.papel, u.ativo, l.expira_em, l.criado_em FROM usuarios AS u
       JOIN links_acesso AS l ON l.usuario_id = u.id WHERE u.nome = ?`,
    )
      .bind(nome)
      .first<{
        id: number;
        papel: string;
        ativo: number;
        expira_em: string;
        criado_em: string;
      }>();
    expect(usuario).toMatchObject({ papel: "admin", ativo: 1 });
    expect(
      Date.parse(usuario!.expira_em) - Date.parse(usuario!.criado_em),
    ).toBe(VALIDADE_LINK_DIAS * 24 * 60 * 60 * 1000);

    const app = criarAppDeTeste();
    const res = await chamar(app, "POST", "/api/sessao", { corpo: { token } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      usuario: { id: usuario!.id, nome, papel: "admin" },
    });
    const sessao = cookieDaResposta(res)?.valor;
    const admin = await chamar(app, "GET", "/api/admin/usuarios", { sessao });
    expect(admin.status).toBe(200);
  });

  it("--remote usa o D1 remoto e exige --origem https", async () => {
    const semOrigem = await rodar([
      "--nome",
      "Fulano",
      "--papel",
      "admin",
      "--remote",
    ]);
    expect(semOrigem.codigo).toBe(2);
    expect(semOrigem.erros).toContain("--origem");
    expect(semOrigem.chamadas).toHaveLength(0);

    const http = await rodar([
      "--nome",
      "Fulano",
      "--papel",
      "admin",
      "--remote",
      "--origem",
      "http://rifa.example.org",
    ]);
    expect(http.codigo).toBe(2);
    expect(http.chamadas).toHaveLength(0);

    const execucao = await rodar([
      "--nome",
      `Coordenacao Remota ${crypto.randomUUID().slice(0, 8)}`,
      "--papel=coordenacao",
      "--remote",
      "--origem=https://rifa.example.org/",
    ]);
    expect(execucao.codigo).toBe(0);
    expect(execucao.chamadas[0].slice(0, 5)).toEqual([
      "d1",
      "execute",
      "DB",
      "--remote",
      "--json",
    ]);
    tokenImpresso(execucao.saida, "https://rifa.example.org");
  });

  it("nome com apóstrofo é gravado como digitado (as aspas são dobradas no SQL)", async () => {
    const nome = `Joana D'Arc ${crypto.randomUUID().slice(0, 8)}`;

    const execucao = await rodar(["--nome", nome, "--papel", "coordenacao"]);

    expect(execucao.codigo).toBe(0);
    const gravado = await env.DB.prepare(
      "SELECT nome FROM usuarios WHERE nome = ?",
    )
      .bind(nome)
      .first<{ nome: string }>();
    expect(gravado?.nome).toBe(nome);
  });

  it.each([
    ["injeção de SQL", "x'); DROP TABLE usuarios; --"],
    ["aspas duplas", 'Ana "Admin"'],
    ["ponto e vírgula", "Ana; DELETE FROM usuarios"],
    ["barra invertida", "Ana\\"],
    ["começando por hífen", "-Ana"],
    ["só espaços", "   "],
    ["acima de 120 caracteres", "A".repeat(121)],
  ])("recusa nome com %s antes de chamar o wrangler", async (_caso, nome) => {
    const execucao = await rodar(["--nome", nome, "--papel", "admin"]);

    expect(execucao.codigo).toBe(2);
    expect(execucao.erros).toContain("--nome");
    expect(execucao.chamadas).toHaveLength(0);
    expect(() =>
      montarComandos({ nome, papel: "admin", tokenHash: "0".repeat(64) }),
    ).toThrow();
  });

  it("aceita nomes comuns com acento, ponto e hífen", () => {
    expect(validarNome("  Fábio  Felipe ")).toBe("Fábio Felipe");
    expect(validarNome("Pr. João-Paulo D’Ávila 2")).toBe(
      "Pr. João-Paulo D’Ávila 2",
    );
  });

  it.each([
    ["sem --nome", ["--papel", "admin"]],
    ["sem --papel", ["--nome", "Fulano"]],
    ["papel desconhecido", ["--nome", "Fulano", "--papel", "pastor"]],
    [
      "opção desconhecida",
      ["--nome", "Fulano", "--papel", "admin", "--senha", "x"],
    ],
    ["--nome sem valor", ["--nome", "--papel", "admin"]],
    [
      "origem com caminho",
      ["--nome", "Fulano", "--papel", "admin", "--origem", "https://x.org/a"],
    ],
    [
      "opção desconhecida com valor",
      ["--nome", "Fulano", "--papel", "admin", "--senha=x"],
    ],
    [
      "opção em maiúsculas",
      ["--nome", "Fulano", "--papel", "admin", "--Remote"],
    ],
    [
      "valor solto depois de uma flag",
      ["--nome", "Fulano", "--papel", "admin", "--remote", "false"],
    ],
    [
      "--local e --remote juntos",
      ["--nome", "Fulano", "--papel", "admin", "--local", "--remote"],
    ],
  ])("uso errado (%s) sai com código 2 e mostra o uso", async (_caso, argv) => {
    const execucao = await rodar(argv);

    expect(execucao.codigo).toBe(2);
    expect(execucao.erros).toContain("Uso: npm run acesso:criar");
    expect(execucao.chamadas).toHaveLength(0);
  });

  it.each([
    "--remote=false",
    "--remote=true",
    "--remote=",
    "--local=0",
    "--help=1",
  ])(
    "flag booleana com valor (%s) é recusada: não liga o D1 remoto nem chama o wrangler",
    async (flag) => {
      const execucao = await rodar([
        "--nome",
        "Fulano",
        "--papel",
        "admin",
        "--origem",
        "https://rifa.example.org",
        flag,
      ]);

      expect(execucao.codigo).toBe(2);
      expect(execucao.erros).toContain(
        `${flag.split("=")[0]} não aceita valor`,
      );
      expect(execucao.chamadas).toHaveLength(0);
      expect(execucao.saida).toBe("");
    },
  );

  it("falha do wrangler (ex.: migrações não aplicadas) sai com código 1, dá a dica e não imprime link", async () => {
    const execucao = await rodar(
      ["--nome", "Fulano", "--papel", "admin"],
      async () => ({
        status: 1,
        stdout: "",
        stderr: "✘ [ERROR] no such table: usuarios: SQLITE_ERROR",
      }),
    );

    expect(execucao.codigo).toBe(1);
    expect(execucao.erros).toContain("npm run db:migrate:local");
    expect(execucao.erros).toContain("no such table: usuarios");
    expect(execucao.saida).toBe("");
    expect(execucao.erros).not.toMatch(/\/acesso\//);
  });

  it("sem a confirmação da gravação (SELECT vazio), sai com código 1 e não imprime link", async () => {
    const execucao = await rodar(
      ["--nome", "Fulano", "--papel", "admin"],
      async () => ({
        status: 0,
        stdout: JSON.stringify([
          { results: [] },
          { results: [] },
          { results: [] },
        ]),
        stderr: "",
      }),
    );

    expect(execucao.codigo).toBe(1);
    expect(execucao.saida).toBe("");
  });

  it("--help mostra o uso e sai com 0; a validade padrão é a do contrato", async () => {
    const execucao = await rodar(["--help"]);

    expect(execucao.codigo).toBe(0);
    expect(execucao.saida).toContain("--papel");
    expect(execucao.chamadas).toHaveLength(0);
    expect(VALIDADE_LINK_DIAS).toBe(VALIDADE_DO_CONTRATO);
  });
});
