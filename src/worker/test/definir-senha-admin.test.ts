// RIFA-073 (D33): scripts/definir-senha-admin.mjs (`npm run acesso:senha`), o login do admin pela linha de comando. O
// script roda de verdade, com o wrangler trocado por um executor que faz o que `wrangler d1 execute DB --local --json
// --command` faz (um comando por linha, todos num batch no D1 dos testes) e a senha entregue pela função de leitura
// (no programa de verdade, o stdin). Confere: a senha nunca entra por argumento; o hash é o mesmo do Worker; a senha
// gravada abre a sessão do admin no POST /api/sessao/admin; só admin ativo; o login de outro admin é recusado; nada
// imprime a senha nem o hash.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ResultadoWrangler } from "../../../scripts/criar-acesso.mjs";
import {
  FORMATO_USUARIO_ADMIN,
  ITERACOES_SENHA,
  MAXIMO_SENHA_ADMIN,
  MINIMO_SENHA_ADMIN,
  hashDaSenha,
  lerArgumentos,
  principal,
  problemaDaSenha,
} from "../../../scripts/definir-senha-admin.mjs";
import * as contrato from "../../shared/contracts";
import {
  hashDaSenha as hashDoWorker,
  ITERACOES_SENHA as ITERACOES_DO_WORKER,
} from "../lib/senha";
import { ORIGEM, criarAcessoNoBanco } from "./acesso-teste";

const SENHA = "senha ficticia do script";

/** Como o wrangler local: um comando por linha, todos num batch, saída --json. */
async function wranglerComD1DeTeste(
  argumentos: string[],
): Promise<ResultadoWrangler> {
  const indice = argumentos.indexOf("--command");
  const comandos = argumentos[indice + 1]
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
        })),
      ),
      stderr: "",
    };
  } catch (erro) {
    return { status: 1, stdout: "", stderr: `✘ [ERROR] ${String(erro)}` };
  }
}

async function rodar(argv: string[], senha: string = SENHA) {
  const saida: string[] = [];
  const erros: string[] = [];
  const chamadas: string[][] = [];
  let pediuSenha = false;
  const codigo = await principal({
    argv,
    executarWrangler: async (argumentos) => {
      chamadas.push(argumentos);
      return wranglerComD1DeTeste(argumentos);
    },
    lerSenha: () => {
      pediuSenha = true;
      return Promise.resolve(senha);
    },
    escrever: (texto) => saida.push(texto),
    escreverErro: (texto) => erros.push(texto),
  });
  return {
    codigo,
    saida: saida.join("\n"),
    erros: erros.join("\n"),
    chamadas,
    pediuSenha,
  };
}

function entrarComoAdmin(usuario: string, senha: string): Promise<Response> {
  return exports.default.fetch(`${ORIGEM}/api/sessao/admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGEM },
    body: JSON.stringify({ usuario, senha }),
  });
}

describe("RIFA-073: scripts/definir-senha-admin.mjs (npm run acesso:senha)", () => {
  it("as regras e o hash são os do contrato e do Worker", async () => {
    expect(MINIMO_SENHA_ADMIN).toBe(contrato.MINIMO_SENHA_ADMIN);
    expect(MAXIMO_SENHA_ADMIN).toBe(contrato.MAXIMO_SENHA_ADMIN);
    expect(FORMATO_USUARIO_ADMIN.source).toBe(
      contrato.FORMATO_USUARIO_ADMIN.source,
    );
    expect(ITERACOES_SENHA).toBe(ITERACOES_DO_WORKER);
    const sal = "0123456789abcdef0123456789abcdef";
    expect(await hashDaSenha(SENHA, sal)).toBe(await hashDoWorker(SENHA, sal));
    for (const [senha, usuario] of [
      ["123456789", "pastor"],
      ["1234567890", "pastor"],
      ["Pastor.Joao", "pastor.joao"],
    ])
      expect(problemaDaSenha(senha, usuario) === null).toBe(
        contrato.problemaDaSenhaAdmin(senha, usuario) === null,
      );
  });

  it("a senha nunca vai por argumento: --senha é recusado, sem tocar no banco", async () => {
    expect(() =>
      lerArgumentos(["--admin", "1", "--usuario", "pastor", "--senha", "x"]),
    ).toThrow(/histórico do shell/);
    const r = await rodar([
      "--admin",
      "1",
      "--usuario",
      "pastor",
      "--senha=qualquer coisa",
    ]);
    expect(r.codigo).toBe(2);
    expect(r.chamadas).toEqual([]);
    expect(r.pediuSenha).toBe(false);
  });

  it("define a senha de um admin pelo id (D1 local): só o hash no banco, a trilha registra, e o login abre a sessão dele", async () => {
    const admin = await criarAcessoNoBanco("admin");
    const r = await rodar([
      "--admin",
      String(admin.usuarioId),
      "--usuario",
      "Script.Um",
    ]);
    expect(r.erros).toBe("");
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain('usuário de login "script.um"');
    expect(
      r.chamadas.every((argumentos) => argumentos.includes("--local")),
    ).toBe(true);
    // Nem a senha nem o hash aparecem na saída, nem a senha nos comandos.
    const linha = await env.DB.prepare(
      "SELECT usuario, sal, hash, iteracoes FROM senhas_admin WHERE usuario_id = ?1",
    )
      .bind(admin.usuarioId)
      .first<{
        usuario: string;
        sal: string;
        hash: string;
        iteracoes: number;
      }>();
    expect(linha).toMatchObject({
      usuario: "script.um",
      iteracoes: ITERACOES_SENHA,
    });
    expect(r.saida).not.toContain(linha!.hash);
    expect(`${r.saida}${r.erros}${JSON.stringify(r.chamadas)}`).not.toContain(
      SENHA,
    );

    const res = await entrarComoAdmin("script.um", SENHA);
    expect(res.status).toBe(200);
    expect(
      contrato.respostaSessaoSchema.parse(await res.json()).usuario,
    ).toMatchObject({ id: admin.usuarioId, papel: "admin" });

    const { results } = await env.DB.prepare(
      "SELECT acao FROM auditoria WHERE usuario_id = ?1 AND acao LIKE 'senha_admin.%'",
    )
      .bind(admin.usuarioId)
      .all<{ acao: string }>();
    expect(results.map((r) => r.acao)).toEqual(["senha_admin.definir"]);
  });

  it("pelo nome, troca a senha: a antiga deixa de valer e as sessões abertas por ela caem", async () => {
    const nome = `Admin Do Script ${crypto.randomUUID().slice(0, 8)}`;
    const admin = await criarAcessoNoBanco("admin", nome);
    expect(
      (await rodar(["--admin", nome, "--usuario", "script.dois"])).codigo,
    ).toBe(0);
    const aberta = await entrarComoAdmin("script.dois", SENHA);
    expect(aberta.status).toBe(200);
    const cookie = /^__Host-sessao=([^;]+)/.exec(
      aberta.headers.get("Set-Cookie") ?? "",
    )?.[1];

    const outra = "outra senha ficticia";
    const r = await rodar(["--admin", nome, "--usuario", "script.dois"], outra);
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("trocada");
    expect((await entrarComoAdmin("script.dois", SENHA)).status).toBe(401);
    expect((await entrarComoAdmin("script.dois", outra)).status).toBe(200);
    const sessao = await exports.default.fetch(`${ORIGEM}/api/sessao`, {
      headers: { Cookie: `__Host-sessao=${cookie}` },
    });
    expect(sessao.status).toBe(401);
    const { results } = await env.DB.prepare(
      "SELECT acao FROM auditoria WHERE usuario_id = ?1 AND acao LIKE 'senha_admin.%' ORDER BY id",
    )
      .bind(admin.usuarioId)
      .all<{ acao: string }>();
    expect(results.map((r) => r.acao)).toEqual([
      "senha_admin.definir",
      "senha_admin.trocar",
    ]);
  });

  it("recusa sem gravar: quem não é admin, admin que não existe, login de outro admin, senha fraca", async () => {
    const coordenacao = await criarAcessoNoBanco("coordenacao");
    const naoAdmin = await rodar([
      "--admin",
      String(coordenacao.usuarioId),
      "--usuario",
      "script.tres",
    ]);
    expect(naoAdmin.codigo).toBe(1);
    expect(naoAdmin.erros).toContain("não é um admin ativo");
    expect(naoAdmin.pediuSenha).toBe(false);

    const inexistente = await rodar([
      "--admin",
      "999999",
      "--usuario",
      "script.tres",
    ]);
    expect(inexistente.codigo).toBe(1);
    expect(inexistente.pediuSenha).toBe(false);

    const dono = await criarAcessoNoBanco("admin");
    expect(
      (
        await rodar([
          "--admin",
          String(dono.usuarioId),
          "--usuario",
          "script.quatro",
        ])
      ).codigo,
    ).toBe(0);
    const outro = await criarAcessoNoBanco("admin");
    const emUso = await rodar([
      "--admin",
      String(outro.usuarioId),
      "--usuario",
      "Script.Quatro",
    ]);
    expect(emUso.codigo).toBe(1);
    expect(emUso.erros).toContain("já é de outro admin");

    const fraca = await rodar(
      ["--admin", String(outro.usuarioId), "--usuario", "script.cinco"],
      "curta",
    );
    expect(fraca.codigo).toBe(2);
    expect(fraca.erros).toContain("pelo menos 10");

    const total = await env.DB.prepare(
      "SELECT count(*) AS total FROM senhas_admin WHERE usuario_id IN (?1, ?2)",
    )
      .bind(coordenacao.usuarioId, outro.usuarioId)
      .first<{ total: number }>();
    expect(total?.total).toBe(0);
  });

  it("--remote vai para o D1 remoto (o argumento do wrangler); --local e --remote juntos é erro de uso", async () => {
    const admin = await criarAcessoNoBanco("admin");
    const r = await rodar([
      "--admin",
      String(admin.usuarioId),
      "--usuario",
      "script.seis",
      "--remote",
    ]);
    expect(r.codigo).toBe(0);
    expect(
      r.chamadas.every((argumentos) => argumentos.includes("--remote")),
    ).toBe(true);
    expect(r.saida).toContain("D1 remoto");
    expect(
      (
        await rodar([
          "--admin",
          "1",
          "--usuario",
          "x.y.z",
          "--local",
          "--remote",
        ])
      ).codigo,
    ).toBe(2);
  });
});
