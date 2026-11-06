// Schema do D1 (migrations/0000_setup.sql + 0001_init.sql), aplicado pelo setup
// apply-migrations.ts no D1 local dos testes, dentro do workerd.
import { env } from "cloudflare:workers";
import { describe, expect, it, onTestFinished } from "vitest";

const TABELAS = [
  "_meta",
  "afiliados",
  "campanha_periodos",
  "campanhas",
  "celulas",
  "discipuladores",
  "pedidos",
  "redes",
  "webhook_eventos",
];

describe("migrações: schema do D1", () => {
  it("cria as tabelas e a view vendas_aprovadas", async () => {
    const { results } = await env.DB.prepare(
      `SELECT type, name FROM sqlite_master
       WHERE type IN ('table', 'view')
         AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name <> 'd1_migrations'
       ORDER BY name`,
    ).all<{ type: string; name: string }>();

    const tabelas = results
      .filter((o) => o.type === "table")
      .map((o) => o.name);
    expect(tabelas).toEqual(expect.arrayContaining(TABELAS));
    expect(results).toContainEqual({ type: "view", name: "vendas_aprovadas" });
  });

  it("CHECK de enum rejeita valor inválido", async () => {
    await expect(
      env.DB.prepare("INSERT INTO redes (nome, divisao) VALUES (?, ?)")
        .bind("Rede de teste (enum)", "kids")
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("chave estrangeira é respeitada", async () => {
    await expect(
      env.DB.prepare("INSERT INTO discipuladores (rede_id, nome) VALUES (?, ?)")
        .bind(999_999, "Discipulador de teste sem rede")
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("grava um pedido aprovado e a view atribui a venda à célula do afiliado (D7)", async () => {
    const db = env.DB;
    const id = async (sql: string, ...valores: (string | number)[]) => {
      const linha = await db
        .prepare(`${sql} RETURNING id`)
        .bind(...valores)
        .first<{ id: number }>();
      if (!linha) throw new Error(`sem id: ${sql}`);
      return linha.id;
    };

    // Campanha inativa: não disputa o índice de "uma campanha ativa".
    const campanha = await id(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
         meta_unidade, meta_regra, meta_valor, ranking_criterio)
       VALUES ('Campanha de teste', 'teste-migracao', 0, '2026-12-01', 2000,
         'bilhetes', 'por_pessoa', 10, 'percentual_meta')`,
    );
    const rede = await id(
      "INSERT INTO redes (nome, divisao) VALUES ('Rede de teste (migração)', 'jovens')",
    );
    const discipulador = await id(
      "INSERT INTO discipuladores (rede_id, nome) VALUES (?, 'Discipulador de teste (migração)')",
      rede,
    );
    const celula = await id(
      `INSERT INTO celulas (discipulador_id, nome, qtd_pessoas, lider_nome)
       VALUES (?, 'Célula de teste (migração)', 12, 'Líder de teste')`,
      discipulador,
    );
    await db
      .prepare(
        `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
         VALUES (990001, ?, 'manual', '2026-11-30T20:00:00.000Z')`,
      )
      .bind(celula)
      .run();
    // Instantes UTC com milissegundos: o CHECK de formato (strftime) roda no D1.
    await db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, status_rifei,
           status_detail_rifei, qtd_bilhetes, numeros, subtotal_centavos, total_centavos,
           metodo_pagamento, rifinha, ddd, pais, criado_em, expira_em, aprovado_em)
         VALUES ('TESTE-MIGRACAO-1', ?, 990001, 'approved', 'approved', 'accredited', 3,
           '[101,202,303]', 6000, 6000, 'pix', 0, '91', '55',
           '2026-12-01T12:15:00.000Z', '2026-12-01T12:45:00.000Z', '2026-12-01T12:20:31.512Z')`,
      )
      .bind(campanha)
      .run();
    onTestFinished(async () => {
      await db.batch([
        db.prepare("DELETE FROM pedidos WHERE id = 'TESTE-MIGRACAO-1'"),
        db.prepare("DELETE FROM afiliados WHERE affiliate_id = 990001"),
        db.prepare("DELETE FROM celulas WHERE id = ?").bind(celula),
        db
          .prepare("DELETE FROM discipuladores WHERE id = ?")
          .bind(discipulador),
        db.prepare("DELETE FROM redes WHERE id = ?").bind(rede),
        db.prepare("DELETE FROM campanhas WHERE id = ?").bind(campanha),
      ]);
    });

    const venda = await db
      .prepare(
        "SELECT celula_id, divisao, total_centavos FROM vendas_aprovadas WHERE pedido_id = ?",
      )
      .bind("TESTE-MIGRACAO-1")
      .first();
    expect(venda).toEqual({
      celula_id: celula,
      divisao: "jovens",
      total_centavos: 6000,
    });

    // Instante fora do padrão (com fuso) é recusado; exclusão de célula com afiliado é RESTRICT.
    await expect(
      db
        .prepare(
          "UPDATE pedidos SET aprovado_em = ? WHERE id = 'TESTE-MIGRACAO-1'",
        )
        .bind("2026-12-01T09:20:31.512-03:00")
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      db.prepare("DELETE FROM celulas WHERE id = ?").bind(celula).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });
});
