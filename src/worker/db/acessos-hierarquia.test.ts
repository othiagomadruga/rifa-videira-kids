// RIFA-014: o lote de links da hierarquia (db/acessos-hierarquia.ts) quando outra gravação muda os alvos entre a
// conferência e o lote. A restrição do banco desfaz o lote inteiro (tudo ou nada) e a conferência é refeita uma
// vez: o alvo que ganhou um usuário recebe o link nele; o desativado dá 409; o que sumiu, 404.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { VALIDADE_LINK_DIAS } from "../../shared/contracts";
import { gerarSegredo, sha256Hex } from "../lib/cripto";
import { limparBanco, semearHierarquia } from "../test/painel-apoio";
import type { NovoLink } from "./acessos";
import { gerarLinksHierarquia } from "./acessos-hierarquia";

async function linksNovos(quantos: number): Promise<NovoLink[]> {
  const agora = Date.now();
  return Promise.all(
    Array.from({ length: quantos }, async () => ({
      tokenHash: await sha256Hex(gerarSegredo()),
      criadoEm: new Date(agora).toISOString(),
      expiraEm: new Date(
        agora + VALIDADE_LINK_DIAS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    })),
  );
}

/** O D1 dos testes, mas com `antes` rodando (uma vez) logo antes do primeiro lote: a gravação concorrente. */
function bancoComConcorrente(antes: () => Promise<unknown>): {
  db: D1Database;
  lotes: () => number;
} {
  let lotes = 0;
  const db = new Proxy(env.DB, {
    get(alvo, nome) {
      if (nome === "batch")
        return async (comandos: D1PreparedStatement[]) => {
          lotes += 1;
          if (lotes === 1) await antes();
          return alvo.batch(comandos);
        };
      const valor: unknown = Reflect.get(alvo, nome, alvo);
      return typeof valor === "function" ? valor.bind(alvo) : valor;
    },
  });
  return { db, lotes: () => lotes };
}

async function contar(tabela: "usuarios" | "links_acesso"): Promise<number> {
  const linha = await env.DB.prepare(
    `SELECT count(*) AS total FROM ${tabela}`,
  ).first<{ total: number }>();
  return linha!.total;
}

beforeEach(async () => {
  await limparBanco();
  await semearHierarquia();
});

describe("lote de links com outra gravação no meio", () => {
  it("o alvo ganhou um usuário (outro lote): o lote é desfeito e refeito, e o link vai para esse usuário", async () => {
    const { db, lotes } = bancoComConcorrente(() =>
      env.DB.prepare(
        "INSERT INTO usuarios (nome, papel, celula_id) VALUES ('Criado ao mesmo tempo', 'lider', 2)",
      ).run(),
    );
    const resultado = await gerarLinksHierarquia(
      db,
      { papel: "lider", ids: [1, 2], revogarAnteriores: false },
      await linksNovos(2),
    );
    expect(lotes()).toBe(2);
    expect(resultado.ok).toBe(true);
    const { results } = await env.DB.prepare(
      "SELECT celula_id, nome FROM usuarios WHERE celula_id IS NOT NULL ORDER BY celula_id",
    ).all();
    // Um usuário por célula; o que já existia ficou com o nome do líder atual.
    expect(results).toEqual([
      { celula_id: 1, nome: "Líder da Célula Ágape" },
      { celula_id: 2, nome: "Líder da Célula Betel" },
    ]);
    expect(await contar("links_acesso")).toBe(2);
  });

  it("o usuário do alvo foi desativado: nada é gravado e a resposta é 409 com o id", async () => {
    const [existente] = await linksNovos(1);
    const criado = await gerarLinksHierarquia(
      env.DB,
      { papel: "lider", ids: [3], revogarAnteriores: false },
      [existente],
    );
    expect(criado.ok).toBe(true);
    const antes = [await contar("usuarios"), await contar("links_acesso")];

    const { db } = bancoComConcorrente(() =>
      env.DB.prepare("UPDATE usuarios SET ativo = 0 WHERE celula_id = 3").run(),
    );
    const resultado = await gerarLinksHierarquia(
      db,
      { papel: "lider", ids: [1, 3], revogarAnteriores: true },
      await linksNovos(2),
    );
    expect(resultado).toEqual({ ok: false, codigo: "em_uso", ids: [3] });
    expect([await contar("usuarios"), await contar("links_acesso")]).toEqual(
      antes,
    );
  });

  it("o alvo foi apagado: nada é gravado e a resposta é 404 com o id", async () => {
    const { db } = bancoComConcorrente(() =>
      env.DB.batch([
        env.DB.prepare("DELETE FROM afiliados WHERE celula_id = 5"),
        env.DB.prepare("DELETE FROM celulas WHERE id = 5"),
      ]),
    );
    const resultado = await gerarLinksHierarquia(
      db,
      { papel: "lider", ids: [4, 5], revogarAnteriores: false },
      await linksNovos(2),
    );
    expect(resultado).toEqual({
      ok: false,
      codigo: "nao_encontrado",
      ids: [5],
    });
    expect(await contar("usuarios")).toBe(0);
    expect(await contar("links_acesso")).toBe(0);
  });

  it("um link novo por alvo, sempre: o número de links tem de bater com o de ids", async () => {
    await expect(
      gerarLinksHierarquia(
        env.DB,
        { papel: "lider", ids: [1, 2], revogarAnteriores: false },
        await linksNovos(1),
      ),
    ).rejects.toThrow(RangeError);
  });
});
