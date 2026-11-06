// Schema do D1 (migrations/0000_setup.sql, 0001_init.sql e 0002_acessos.sql), aplicado pelo setup
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
  "links_acesso",
  "pedidos",
  "redes",
  "sessoes",
  "usuarios",
  "webhook_eventos",
];

/** Exclui as tabelas internas do SQLite, do D1 e do controle de migrações. */
const soNossas = (coluna: string) =>
  `${coluna} NOT GLOB 'sqlite_*' AND ${coluna} NOT GLOB '_cf_*' AND ${coluna} <> 'd1_migrations'`;

describe("migrações: schema do D1", () => {
  it("cria as tabelas e a view vendas_aprovadas", async () => {
    const { results } = await env.DB.prepare(
      `SELECT type, name FROM sqlite_master
       WHERE type IN ('table', 'view') AND ${soNossas("name")} ORDER BY name`,
    ).all<{ type: string; name: string }>();

    const tabelas = results
      .filter((o) => o.type === "table")
      .map((o) => o.name);
    expect(tabelas).toEqual(expect.arrayContaining(TABELAS));
    expect(results).toContainEqual({ type: "view", name: "vendas_aprovadas" });
  });

  it("D1/LGPD: nenhuma tabela tem coluna de dado pessoal do comprador (pragma_table_info)", async () => {
    const { results } = await env.DB.prepare(
      `SELECT m.name AS tabela, c.name AS coluna
       FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS c
       WHERE m.type = 'table' AND ${soNossas("m.name")}`,
    ).all<{ tabela: string; coluna: string }>();
    expect(results.length).toBeGreaterThan(60);

    const pessoal =
      /comprador|buyer|name|cpf|document|nascimento|birth|endereco|address|cep|zipcode|phone|telefone|email|observa|fbp|fbc/;
    // Contato do LÍDER de célula e e-mail de quem usa o sistema (usuarios, RIFA-007) são cadastro da
    // equipe da igreja, não do comprador.
    const equipe = new Set([
      "celulas.lider_email",
      "celulas.lider_telefone",
      "usuarios.email",
    ]);
    const suspeitas = results
      .filter(
        ({ tabela, coluna }) =>
          pessoal.test(coluna) ||
          // Nas tabelas que recebem dados da Rifei, nem "nome" pode existir.
          (["pedidos", "webhook_eventos"].includes(tabela) &&
            coluna.includes("nome")),
      )
      .map(({ tabela, coluna }) => `${tabela}.${coluna}`)
      .filter((coluna) => !equipe.has(coluna));
    expect(suspeitas).toEqual([]);
  });

  it("os índices esperados existem (pragma_index_list)", async () => {
    const esperados: Record<string, string[]> = {
      campanhas: ["campanhas_uma_ativa"],
      discipuladores: ["discipuladores_por_rede"],
      celulas: ["celulas_por_discipulador"],
      afiliados: ["afiliados_por_celula"],
      pedidos: ["pedidos_por_afiliado_status", "pedidos_por_status_aprovacao"],
      webhook_eventos: [
        "webhook_eventos_por_pedido",
        "webhook_eventos_por_resultado",
      ],
      links_acesso: ["links_acesso_por_usuario"],
      sessoes: [
        "sessoes_por_usuario",
        "sessoes_por_link",
        "sessoes_por_expiracao",
      ],
    };
    for (const [tabela, indices] of Object.entries(esperados)) {
      const { results } = await env.DB.prepare(
        "SELECT name FROM pragma_index_list(?)",
      )
        .bind(tabela)
        .all<{ name: string }>();
      expect({ tabela, indices: results.map((r) => r.name) }).toEqual({
        tabela,
        indices: expect.arrayContaining(indices),
      });
    }
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

  it("affiliate_id não é alias do rowid: NULL, 0 e não inteiro são recusados (sem afiliado fantasma)", async () => {
    const inserir = (sql: string) => env.DB.prepare(sql).run();
    await expect(
      inserir(
        "INSERT INTO afiliados (affiliate_id, origem) VALUES (NULL, 'webhook')",
      ),
    ).rejects.toThrow(/NOT NULL constraint failed/);
    await expect(
      inserir("INSERT INTO afiliados (origem) VALUES ('webhook')"),
    ).rejects.toThrow(/NOT NULL constraint failed/);
    await expect(
      inserir(
        "INSERT INTO afiliados (affiliate_id, origem) VALUES (0, 'webhook')",
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      inserir(
        "INSERT INTO afiliados (affiliate_id, origem) VALUES (12.5, 'webhook')",
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    const fantasmas = await env.DB.prepare(
      "SELECT count(*) AS n FROM afiliados WHERE affiliate_id IS NULL OR affiliate_id <= 0",
    ).first<{ n: number }>();
    expect(fantasmas).toEqual({ n: 0 });
  });

  it("webhook_eventos: avisos é lista JSON não vazia, só em evento aceito", async () => {
    const evento = await env.DB.prepare(
      `INSERT INTO webhook_eventos (evento, pedido_id, slug, resultado, status_resultante,
         payload_redigido, avisos)
       VALUES ('paid_order', 'TESTE-AVISOS-1', 'teste', 'processado', 'approved', '{}', ?)
       RETURNING id`,
    )
      .bind(
        JSON.stringify([
          {
            caminho: ["numbers", "*"],
            codigo: "invalid_type",
            mensagem: "Invalid input",
            ocorrencias: 5000,
          },
        ]),
      )
      .first<{ id: number }>();
    expect(evento?.id).toBeGreaterThan(0);
    onTestFinished(async () => {
      await env.DB.prepare("DELETE FROM webhook_eventos WHERE id = ?")
        .bind(evento?.id ?? 0)
        .run();
    });

    await expect(
      env.DB.prepare(
        `INSERT INTO webhook_eventos (resultado, erro, avisos)
         VALUES ('erro_validacao', '[]', '[]')`,
      ).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    // Lista vazia, objeto e texto que não é JSON: o CHECK reprova (sem avisos, grava-se NULL).
    for (const avisos of ["[]", "{}", '"texto"', "[nao json"]) {
      await expect(
        env.DB.prepare(
          `INSERT INTO webhook_eventos (resultado, payload_redigido, avisos)
           VALUES ('ignorado_outra_campanha', '{}', ?)`,
        )
          .bind(avisos)
          .run(),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
  });

  it("grava pedidos e a view atribui a venda à célula do afiliado (D7)", async () => {
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
       VALUES ('Campanha de teste', 'teste-migracao', 0, '2026-11-23', 2000,
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
    // Pedido sem afiliado e com todos os campos informativos nulos (payload tolerado com avisos),
    // inclusive criado_em, expira_em, status_rifei, status_detail_rifei, subtotal e método.
    await db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, aprovado_em)
         VALUES ('TESTE-MIGRACAO-2', ?, 'approved', 2, 4000, '2026-12-01T13:00:00.000Z')`,
      )
      .bind(campanha)
      .run();
    const informativos = await db
      .prepare(
        `SELECT criado_em, expira_em, status_rifei, status_detail_rifei, subtotal_centavos,
           metodo_pagamento, rifinha FROM pedidos WHERE id = 'TESTE-MIGRACAO-2'`,
      )
      .first();
    expect(informativos).toEqual({
      criado_em: null,
      expira_em: null,
      status_rifei: null,
      status_detail_rifei: null,
      subtotal_centavos: null,
      metodo_pagamento: null,
      rifinha: null,
    });
    // Os essenciais continuam NOT NULL: id, campanha_id, status, qtd_bilhetes e total_centavos.
    const colunasEssenciais = {
      id: "'TESTE-MIGRACAO-3'",
      campanha_id: String(campanha),
      status: "'approved'",
      qtd_bilhetes: "1",
      total_centavos: "2000",
    };
    for (const essencial of Object.keys(colunasEssenciais)) {
      const valores = { ...colunasEssenciais, [essencial]: "NULL" };
      await expect(
        db
          .prepare(
            `INSERT INTO pedidos (${Object.keys(valores).join(", ")}, aprovado_em)
             VALUES (${Object.values(valores).join(", ")}, '2026-12-01T14:00:00.000Z')`,
          )
          .run(),
      ).rejects.toThrow(/NOT NULL constraint failed/);
    }
    onTestFinished(async () => {
      await db.batch([
        db.prepare(
          "DELETE FROM pedidos WHERE id IN ('TESTE-MIGRACAO-1', 'TESTE-MIGRACAO-2')",
        ),
        db.prepare("DELETE FROM afiliados WHERE affiliate_id = 990001"),
        db.prepare("DELETE FROM celulas WHERE id = ?").bind(celula),
        db
          .prepare("DELETE FROM discipuladores WHERE id = ?")
          .bind(discipulador),
        db.prepare("DELETE FROM redes WHERE id = ?").bind(rede),
        db.prepare("DELETE FROM campanhas WHERE id = ?").bind(campanha),
      ]);
    });

    const { results: vendas } = await db
      .prepare(
        `SELECT pedido_id, celula_id, divisao, total_centavos FROM vendas_aprovadas
         WHERE pedido_id IN ('TESTE-MIGRACAO-1', 'TESTE-MIGRACAO-2') ORDER BY pedido_id`,
      )
      .all();
    expect(vendas).toEqual([
      {
        pedido_id: "TESTE-MIGRACAO-1",
        celula_id: celula,
        divisao: "jovens",
        total_centavos: 6000,
      },
      {
        pedido_id: "TESTE-MIGRACAO-2",
        celula_id: null,
        divisao: null,
        total_centavos: 4000,
      },
    ]);

    const recusa = (sql: string, valor: string | number) =>
      expect(
        db.prepare(`${sql} WHERE id = 'TESTE-MIGRACAO-1'`).bind(valor).run(),
      ).rejects.toThrow(/CHECK constraint failed/);
    // Instante fora do padrão (com fuso).
    await recusa(
      "UPDATE pedidos SET aprovado_em = ?",
      "2026-12-01T09:20:31.512-03:00",
    );
    // Dinheiro e contadores só aceitam inteiros (typeof).
    await recusa("UPDATE pedidos SET total_centavos = ?", 60.5);
    await recusa("UPDATE pedidos SET subtotal_centavos = ?", 10.5);
    await recusa("UPDATE pedidos SET qtd_bilhetes = ?", "abc");
    await expect(
      db
        .prepare("UPDATE celulas SET qtd_pessoas = ? WHERE id = ?")
        .bind(7.5, celula)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    // Exclusão de célula com afiliado é RESTRICT.
    await expect(
      db.prepare("DELETE FROM celulas WHERE id = ?").bind(celula).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });
});
