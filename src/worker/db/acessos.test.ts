// RIFA-007: o banco nunca guarda token de link nem id de sessão em texto; a busca é pelo hash.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  respostaCriarLinkSchema,
  respostaCriarUsuarioSchema,
} from "../../shared/contracts";
import { gerarSegredo, sha256Hex } from "../lib/cripto";
import {
  ORIGEM,
  chamar,
  cookieDaResposta,
  criarAcessoNoBanco,
  criarAppDeTeste,
  entrar,
} from "../test/acesso-teste";
import { buscarLinkValido, buscarUsuarioDaSessao } from "./acessos";

const db = env.DB;
const HASH = /^[0-9a-f]{64}$/;

/** Todas as tabelas do banco (menos as internas do SQLite e do D1, que não podem ser lidas). */
async function tabelas(): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'
       ORDER BY name`,
    )
    .all<{ name: string }>();
  return results.map((linha) => linha.name);
}

async function hashesGravados(sql: string): Promise<string[]> {
  const { results } = await db.prepare(sql).all<{ hash: string }>();
  return results.map((linha) => linha.hash);
}

describe("CA5: segredos fora do banco", () => {
  it("depois de criar usuários, abrir, encerrar e revogar sessões, nenhuma tabela contém token ou id de sessão", async () => {
    const app = criarAppDeTeste();
    const segredos: string[] = [];
    const tokenDaUrl = (url: string) => url.slice(`${ORIGEM}/acesso/`.length);

    // Admin pelo banco (como o bootstrap) e a sessão dele.
    const raiz = await criarAcessoNoBanco("admin");
    const admin = await entrar(app, raiz.token);
    segredos.push(raiz.token, admin);

    // Admin cria um usuário pela API: o token chega só na URL da resposta.
    const criacao = await chamar(app, "POST", "/api/admin/usuarios", {
      corpo: { nome: "Coordenacao Varredura", papel: "coordenacao" },
      sessao: admin,
    });
    const criado = respostaCriarUsuarioSchema.parse(await criacao.json());
    const token1 = tokenDaUrl(criado.link.url);
    const sessao1 = await entrar(app, token1);
    const sessao2 = await entrar(app, token1);
    segredos.push(token1, sessao1, sessao2);

    // Link novo, uma sessão com ele, saída de uma sessão e revogação do primeiro link.
    const novo = await chamar(
      app,
      "POST",
      `/api/admin/usuarios/${criado.usuario.id}/links`,
      {
        sessao: admin,
      },
    );
    const token2 = tokenDaUrl(
      respostaCriarLinkSchema.parse(await novo.json()).link.url,
    );
    const sessao3 = await entrar(app, token2);
    segredos.push(token2, sessao3);
    const saida = await chamar(app, "POST", "/api/sessao/sair", {
      sessao: sessao2,
    });
    expect(saida.status).toBe(204);
    const revogacao = await chamar(
      app,
      "DELETE",
      `/api/admin/links/${criado.link.id}`,
      {
        sessao: admin,
      },
    );
    expect(revogacao.status).toBe(204);

    expect(
      segredos.every((segredo) => /^[A-Za-z0-9_-]{43}$/.test(segredo)),
    ).toBe(true);
    expect(new Set(segredos).size).toBe(segredos.length);

    // Varredura: toda célula de toda tabela, comparada com cada segredo.
    const nomes = await tabelas();
    expect(nomes).toEqual(
      expect.arrayContaining(["usuarios", "links_acesso", "sessoes"]),
    );
    const vazamentos: string[] = [];
    for (const tabela of nomes) {
      const { results } = await db
        .prepare(`SELECT * FROM "${tabela}"`)
        .all<Record<string, unknown>>();
      for (const linha of results) {
        for (const [coluna, valor] of Object.entries(linha)) {
          const texto = String(valor);
          if (segredos.some((segredo) => texto.includes(segredo)))
            vazamentos.push(`${tabela}.${coluna}`);
        }
      }
    }
    expect(vazamentos).toEqual([]);

    // O que fica é o SHA-256: dos três tokens e só das sessões que ainda valem.
    const tokenHashes = await hashesGravados(
      "SELECT token_hash AS hash FROM links_acesso",
    );
    const idHashes = await hashesGravados(
      "SELECT id_hash AS hash FROM sessoes",
    );
    expect([...tokenHashes, ...idHashes].every((hash) => HASH.test(hash))).toBe(
      true,
    );
    for (const token of [raiz.token, token1, token2])
      expect(tokenHashes).toContain(await sha256Hex(token));
    for (const sessao of [admin, sessao3])
      expect(idHashes).toContain(await sha256Hex(sessao));
    for (const encerrada of [sessao1, sessao2])
      expect(idHashes).not.toContain(await sha256Hex(encerrada));
  });

  it("o CHECK do banco recusa gravar um token ou id de sessão em texto no lugar do hash", async () => {
    const acesso = await criarAcessoNoBanco("coordenacao");

    await expect(
      db
        .prepare(
          "INSERT INTO links_acesso (usuario_id, token_hash, expira_em) VALUES (?, ?, ?)",
        )
        .bind(acesso.usuarioId, gerarSegredo(), "2026-12-31T00:00:00.000Z")
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      db
        .prepare(
          "INSERT INTO sessoes (id_hash, usuario_id, expira_em) VALUES (?, ?, ?)",
        )
        .bind(gerarSegredo(), acesso.usuarioId, "2026-12-31T00:00:00.000Z")
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    // Hash em maiúsculas (ou com outro tamanho) também não passa.
    await expect(
      db
        .prepare(
          "INSERT INTO links_acesso (usuario_id, token_hash, expira_em) VALUES (?, ?, ?)",
        )
        .bind(
          acesso.usuarioId,
          (await sha256Hex(gerarSegredo())).toUpperCase(),
          "2026-12-31T00:00:00.000Z",
        )
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});

describe("CA5: a busca é pelo hash", () => {
  it("o link e a sessão são encontrados pelo SHA-256 do segredo, nunca pelo segredo", async () => {
    const app = criarAppDeTeste();
    const acesso = await criarAcessoNoBanco("coordenacao");
    const sessao = await entrar(app, acesso.token);
    const agora = new Date().toISOString();

    expect(
      await buscarLinkValido(db, await sha256Hex(acesso.token), agora),
    ).toMatchObject({
      linkId: acesso.linkId,
    });
    expect(await buscarLinkValido(db, acesso.token, agora)).toBeNull();
    expect(
      await buscarUsuarioDaSessao(db, await sha256Hex(sessao), agora),
    ).toMatchObject({
      id: acesso.usuarioId,
    });
    expect(await buscarUsuarioDaSessao(db, sessao, agora)).toBeNull();
  });

  it("quem copiar os hashes do banco não entra: hash como token ou como cookie responde 401", async () => {
    const app = criarAppDeTeste();
    const acesso = await criarAcessoNoBanco("admin");
    const sessao = await entrar(app, acesso.token);
    const tokenHash = await sha256Hex(acesso.token);
    const idHash = await sha256Hex(sessao);

    const comTokenHash = await chamar(app, "POST", "/api/sessao", {
      corpo: { token: tokenHash },
    });
    const comIdHash = await chamar(app, "GET", "/api/sessao", {
      sessao: idHash,
    });

    expect(comTokenHash.status).toBe(401);
    expect(cookieDaResposta(comTokenHash)).toBeNull();
    expect(comIdHash.status).toBe(401);
  });
});
