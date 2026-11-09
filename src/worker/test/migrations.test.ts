// Schema do D1 (migrations/0000_setup.sql, 0001_init.sql, 0002_acessos.sql, 0003_vendas_por_dia.sql,
// 0005_auditoria.sql e 0006_acesso_hierarquia.sql), aplicado pelo setup apply-migrations.ts no D1 local dos
// testes, dentro do workerd. A 0006 também é aplicada num D1 à parte (DB_MIGRACAO, vitest.config.ts) SOBRE
// dados gravados com as migrações anteriores: o que existia continua lá (RIFA-014, CA7).
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { buscarLinkValido, buscarUsuarioDaSessao } from "../db/acessos";

const TABELAS = [
  "_meta",
  "afiliados",
  // 0005 (RIFA-013b): trilha de auditoria.
  "auditoria",
  "campanha_periodos",
  "campanhas",
  "celulas",
  "discipuladores",
  "links_acesso",
  "pedidos",
  // 0005 (RIFA-013b): pedidos aprovados marcados como implausíveis.
  "pedidos_suspeitos",
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
      pedidos: [
        "pedidos_por_afiliado_status",
        "pedidos_por_status_aprovacao",
        // 0003: parcial (approved) e com o dia de UTC−3, para a leitura do painel (db/painel.ts).
        "pedidos_aprovados_por_afiliado_dia",
      ],
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
      // 0005 (RIFA-013b).
      auditoria: ["auditoria_por_usuario"],
      pedidos_suspeitos: ["pedidos_suspeitos_por_marcacao"],
      // 0006 (RIFA-014): no máximo um usuário por alvo.
      usuarios: [
        "usuarios_um_por_celula",
        "usuarios_um_por_discipulador",
        "usuarios_um_por_rede",
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

// ---------------------------------------------------------------------------------------------------
// 0006 (RIFA-014, D12): papéis da hierarquia sem recriar `usuarios`, aplicada sobre dados que já existiam
// ---------------------------------------------------------------------------------------------------

const { DB_MIGRACAO, TEST_MIGRATIONS } = env as Cloudflare.Env & {
  DB_MIGRACAO: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

const hash = (letra: string) => letra.repeat(64);
const AGORA_DA_MIGRACAO = "2026-11-05T12:00:00.000Z";

/** O que já existia antes da 0006, tabela por tabela, com as colunas de antes (a ordem pela chave). */
const FOTOS = {
  usuarios:
    "SELECT id, nome, email, papel, ativo, criado_em FROM usuarios ORDER BY id",
  links_acesso: "SELECT * FROM links_acesso ORDER BY id",
  sessoes: "SELECT * FROM sessoes ORDER BY id_hash",
  auditoria: "SELECT * FROM auditoria ORDER BY id",
  hierarquia: `SELECT r.id AS rede, d.id AS discipulador, c.id AS celula
    FROM redes AS r LEFT JOIN discipuladores AS d ON d.rede_id = r.id
    LEFT JOIN celulas AS c ON c.discipulador_id = d.id ORDER BY r.id, d.id, c.id`,
} as const;

async function fotografar(db: D1Database) {
  const resultados = await db.batch(
    Object.values(FOTOS).map((sql) => db.prepare(sql)),
  );
  return Object.fromEntries(
    Object.keys(FOTOS).map((nome, indice) => [
      nome,
      resultados[indice].results,
    ]),
  );
}

describe("0006 sobre dados que já existiam (CA7)", () => {
  const db = DB_MIGRACAO;
  let antes: Awaited<ReturnType<typeof fotografar>>;

  beforeAll(async () => {
    const ate0005 = TEST_MIGRATIONS.filter(
      (migracao) => migracao.name < "0006",
    );
    expect(ate0005.map((migracao) => migracao.name)).not.toContain(
      "0006_acesso_hierarquia.sql",
    );
    await applyD1Migrations(db, ate0005);
    // Antes da 0006: a hierarquia, um afiliado, um admin e uma coordenadora (desativada), com links válidos,
    // revogados e vencidos, sessões e a trilha de auditoria (que segura o admin com RESTRICT).
    await db.batch([
      db.prepare(
        `INSERT INTO redes (id, nome, divisao) VALUES (1, 'Rede Antes da 0006', 'jovens'),
           (2, 'Rede Sem Discipuladores', 'adultos')`,
      ),
      db.prepare(
        `INSERT INTO discipuladores (id, rede_id, nome) VALUES (10, 1, 'Discipulador Antes'),
           (11, 1, 'Discipulador Sem Celulas')`,
      ),
      db.prepare(
        `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome) VALUES
           (100, 10, 'Celula Antes', 10, 'Lider Antes'),
           (101, 10, 'Celula Com Afiliado', 8, 'Lider Com Afiliado'),
           (102, 10, 'Celula Da Trilha', 6, 'Lider Da Trilha')`,
      ),
      db.prepare(
        `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
         VALUES (5001, 101, 'manual', '2026-11-01T12:00:00.000Z')`,
      ),
      db.prepare(
        `INSERT INTO usuarios (id, nome, email, papel, ativo, criado_em) VALUES
           (1, 'Admin Antes da 0006', 'admin@example.com', 'admin', 1, '2026-11-01T10:00:00.000Z'),
           (2, 'Coordenacao Antes da 0006', NULL, 'coordenacao', 0, '2026-11-02T10:00:00.000Z')`,
      ),
      db
        .prepare(
          `INSERT INTO links_acesso (id, usuario_id, token_hash, criado_em, expira_em, revogado_em, ultimo_uso_em)
           VALUES (1, 1, ?1, '2026-11-01T10:00:00.000Z', '2026-12-16T10:00:00.000Z', NULL, '2026-11-04T09:00:00.000Z'),
                  (2, 1, ?2, '2026-11-01T11:00:00.000Z', '2026-12-16T11:00:00.000Z', '2026-11-03T08:00:00.000Z', NULL),
                  (3, 2, ?3, '2026-09-01T10:00:00.000Z', '2026-10-16T10:00:00.000Z', NULL, NULL)`,
        )
        .bind(hash("a"), hash("b"), hash("c")),
      db
        .prepare(
          `INSERT INTO sessoes (id_hash, usuario_id, link_id, criado_em, expira_em, ultimo_uso_em)
           VALUES (?1, 1, 1, '2026-11-04T09:00:00.000Z', '2026-12-16T10:00:00.000Z', '2026-11-05T11:00:00.000Z')`,
        )
        .bind(hash("d")),
      db.prepare(
        `INSERT INTO auditoria (id, usuario_id, em, acao, alvo, resumo) VALUES
           (1, 1, '2026-11-02T10:00:00.000Z', 'usuario.criar', 'usuario:2', 'Acesso criado com o papel coordenacao e um link'),
           (2, 1, '2026-11-03T08:00:00.000Z', 'link.revogar', 'link:2', 'Link do usuário 1 revogado')`,
      ),
    ]);
    antes = await fotografar(db);
    await applyD1Migrations(db, TEST_MIGRATIONS);
  });

  it("a 0006 foi aplicada por último, sobre os dados (não num banco vazio)", async () => {
    const { results } = await db
      .prepare("SELECT name FROM d1_migrations ORDER BY id")
      .all<{ name: string }>();
    expect(results.map((linha) => linha.name).at(-1)).toBe(
      "0006_acesso_hierarquia.sql",
    );
    expect(antes.usuarios).toHaveLength(2);
    expect(antes.links_acesso).toHaveLength(3);
    expect(antes.sessoes).toHaveLength(1);
    expect(antes.auditoria).toHaveLength(2);
  });

  it("usuários, links, sessões, auditoria e hierarquia continuam iguais; o alvo dos antigos é nulo", async () => {
    expect(await fotografar(db)).toEqual(antes);
    const { results } = await db
      .prepare(
        "SELECT id, celula_id, discipulador_id, rede_id FROM usuarios ORDER BY id",
      )
      .all();
    expect(results).toEqual([
      { id: 1, celula_id: null, discipulador_id: null, rede_id: null },
      { id: 2, celula_id: null, discipulador_id: null, rede_id: null },
    ]);
    // A tabela não foi recriada: as FKs que apontam para usuarios continuam, e nenhuma ficou órfã (o D1 não
    // deixa rodar PRAGMA foreign_key_check).
    const orfaos = await db
      .prepare(
        `SELECT (SELECT count(*) FROM links_acesso WHERE usuario_id NOT IN (SELECT id FROM usuarios))
              + (SELECT count(*) FROM sessoes WHERE usuario_id NOT IN (SELECT id FROM usuarios))
              + (SELECT count(*) FROM auditoria WHERE usuario_id NOT IN (SELECT id FROM usuarios)) AS total`,
      )
      .first<{ total: number }>();
    expect(orfaos).toEqual({ total: 0 });
    // As referências a usuarios seguem no schema das tabelas filhas (o D1 não deixa ler pragma_foreign_key_list).
    const { results: filhas } = await db
      .prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'table' AND name IN ('auditoria', 'links_acesso', 'sessoes') ORDER BY name`,
      )
      .all<{ name: string; sql: string }>();
    expect(
      filhas.map(({ name, sql }) => ({
        name,
        referencia:
          /usuario_id\s+INTEGER NOT NULL REFERENCES usuarios \(id\) ON DELETE (\w+)/.exec(
            sql,
          )?.[1],
      })),
    ).toEqual([
      { name: "auditoria", referencia: "RESTRICT" },
      { name: "links_acesso", referencia: "CASCADE" },
      { name: "sessoes", referencia: "CASCADE" },
    ]);
  });

  it("o admin de antes continua entrando: o link e a sessão dele valem no banco migrado", async () => {
    expect(await buscarLinkValido(db, hash("a"), AGORA_DA_MIGRACAO)).toEqual({
      linkId: 1,
      usuario: { id: 1, nome: "Admin Antes da 0006", papel: "admin" },
    });
    expect(await buscarLinkValido(db, hash("b"), AGORA_DA_MIGRACAO)).toBeNull();
    expect(
      await buscarUsuarioDaSessao(db, hash("d"), AGORA_DA_MIGRACAO),
    ).toEqual({ id: 1, nome: "Admin Antes da 0006", papel: "admin" });
  });

  it("CHECK do papel: os 5 papéis, o alvo certo para cada um e nenhum alvo na coordenação", async () => {
    const inserir = (colunas: string, valores: string) =>
      db
        .prepare(
          `INSERT INTO usuarios (nome, ${colunas}) VALUES ('Teste da 0006', ${valores})`,
        )
        .run();
    const recusados: [string, string][] = [
      ["papel", "'kids'"],
      ["papel", "'lider'"],
      ["papel, discipulador_id", "'lider', 10"],
      ["papel, celula_id, rede_id", "'lider', 100, 1"],
      ["papel, celula_id", "'discipulador', 100"],
      ["papel, rede_id", "'discipulador', 1"],
      ["papel", "'rede'"],
      ["papel, celula_id", "'admin', 100"],
      ["papel, rede_id", "'coordenacao', 1"],
    ];
    for (const [colunas, valores] of recusados)
      await expect(inserir(colunas, valores)).rejects.toThrow(
        /CHECK constraint failed/,
      );
    await expect(
      db.prepare("UPDATE usuarios SET celula_id = 100 WHERE id = 1").run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      db.prepare("UPDATE usuarios SET papel = 'lider' WHERE id = 1").run(),
    ).rejects.toThrow(/CHECK constraint failed/);

    for (const [colunas, valores] of [
      ["papel, celula_id", "'lider', 100"],
      ["papel, discipulador_id", "'discipulador', 10"],
      ["papel, rede_id", "'rede', 1"],
    ])
      await inserir(colunas, valores);
    onTestFinished(async () => {
      await db
        .prepare("DELETE FROM usuarios WHERE nome = 'Teste da 0006'")
        .run();
    });
    // A chave estrangeira do alvo vale: célula que não existe.
    await expect(
      db
        .prepare(
          "INSERT INTO usuarios (nome, papel, celula_id) VALUES ('Sem Alvo', 'lider', 999)",
        )
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("gatilhos: papel NULL é recusado ao inserir e ao atualizar, com a mensagem do NOT NULL", async () => {
    await expect(
      db.prepare("INSERT INTO usuarios (nome) VALUES ('Sem Papel')").run(),
    ).rejects.toThrow(/NOT NULL constraint failed: usuarios\.papel/);
    await expect(
      db
        .prepare(
          "INSERT INTO usuarios (nome, papel, celula_id) VALUES ('Sem Papel', NULL, 100)",
        )
        .run(),
    ).rejects.toThrow(/NOT NULL constraint failed: usuarios\.papel/);
    await expect(
      db.prepare("UPDATE usuarios SET papel = NULL WHERE id = 2").run(),
    ).rejects.toThrow(/NOT NULL constraint failed: usuarios\.papel/);
    const { results } = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'usuarios' ORDER BY name",
      )
      .all<{ name: string }>();
    expect(results.map((linha) => linha.name)).toEqual([
      "usuarios_papel_obrigatorio_ao_atualizar",
      "usuarios_papel_obrigatorio_ao_inserir",
    ]);
    expect(
      await db.prepare("SELECT papel FROM usuarios WHERE id = 2").first(),
    ).toEqual({ papel: "coordenacao" });
  });

  it("um usuário por alvo: o segundo da mesma célula, do mesmo discipulador ou da mesma rede é recusado", async () => {
    await db.batch([
      db.prepare(
        "INSERT INTO usuarios (nome, papel, celula_id) VALUES ('Unico da Celula', 'lider', 100)",
      ),
      db.prepare(
        "INSERT INTO usuarios (nome, papel, discipulador_id) VALUES ('Unico do Discipulador', 'discipulador', 10)",
      ),
      db.prepare(
        "INSERT INTO usuarios (nome, papel, rede_id) VALUES ('Unico da Rede', 'rede', 1)",
      ),
    ]);
    onTestFinished(async () => {
      await db.prepare("DELETE FROM usuarios WHERE nome LIKE 'Unico%'").run();
    });
    for (const [coluna, papel, id] of [
      ["celula_id", "lider", 100],
      ["discipulador_id", "discipulador", 10],
      ["rede_id", "rede", 1],
    ] as const)
      await expect(
        db
          .prepare(
            `INSERT INTO usuarios (nome, papel, ${coluna}) VALUES ('Segundo', ?1, ?2)`,
          )
          .bind(papel, id)
          .run(),
      ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("cascata: apagar a célula, o discipulador ou a rede apaga o usuário do alvo, os links e as sessões dele", async () => {
    const criarAcesso = async (
      coluna: string,
      papel: string,
      id: number,
      letras: [string, string],
    ) => {
      const usuario = await db
        .prepare(
          `INSERT INTO usuarios (nome, papel, ${coluna}) VALUES ('Acesso em Cascata', ?1, ?2) RETURNING id`,
        )
        .bind(papel, id)
        .first<{ id: number }>();
      const link = await db
        .prepare(
          `INSERT INTO links_acesso (usuario_id, token_hash, expira_em)
           VALUES (?1, ?2, '2026-12-16T10:00:00.000Z') RETURNING id`,
        )
        .bind(usuario!.id, hash(letras[0]))
        .first<{ id: number }>();
      await db
        .prepare(
          `INSERT INTO sessoes (id_hash, usuario_id, link_id, expira_em)
           VALUES (?1, ?2, ?3, '2026-12-16T10:00:00.000Z')`,
        )
        .bind(hash(letras[1]), usuario!.id, link!.id)
        .run();
      return usuario!.id;
    };
    const restos = async (usuarioId: number) =>
      (
        await db.batch<{ total: number }>([
          db
            .prepare("SELECT count(*) AS total FROM usuarios WHERE id = ?1")
            .bind(usuarioId),
          db
            .prepare(
              "SELECT count(*) AS total FROM links_acesso WHERE usuario_id = ?1",
            )
            .bind(usuarioId),
          db
            .prepare(
              "SELECT count(*) AS total FROM sessoes WHERE usuario_id = ?1",
            )
            .bind(usuarioId),
        ])
      ).map((resultado) => resultado.results[0].total);

    const lider = await criarAcesso("celula_id", "lider", 100, ["e", "1"]);
    const discipulador = await criarAcesso(
      "discipulador_id",
      "discipulador",
      11,
      ["f", "2"],
    );
    const rede = await criarAcesso("rede_id", "rede", 2, ["9", "3"]);
    for (const id of [lider, discipulador, rede])
      expect(await restos(id)).toEqual([1, 1, 1]);

    await db.prepare("DELETE FROM celulas WHERE id = 100").run();
    await db.prepare("DELETE FROM discipuladores WHERE id = 11").run();
    await db.prepare("DELETE FROM redes WHERE id = 2").run();
    for (const id of [lider, discipulador, rede])
      expect(await restos(id)).toEqual([0, 0, 0]);
    // O resto não foi junto.
    expect((await fotografar(db)).usuarios).toEqual(antes.usuarios);
  });

  it("a trilha de auditoria continua segurando quem fez (RESTRICT), inclusive na cascata do alvo", async () => {
    await expect(
      db.prepare("DELETE FROM usuarios WHERE id = 1").run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    // Um usuário da hierarquia que aparecesse como autor na trilha seguraria a exclusão do alvo dele.
    const usuario = await db
      .prepare(
        "INSERT INTO usuarios (nome, papel, celula_id) VALUES ('Lider Da Trilha', 'lider', 102) RETURNING id",
      )
      .first<{ id: number }>();
    await db
      .prepare(
        `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
         VALUES (?1, '2026-11-05T10:00:00.000Z', 'link.criar', 'link:1', 'Registro de teste')`,
      )
      .bind(usuario!.id)
      .run();
    await expect(
      db.prepare("DELETE FROM celulas WHERE id = 102").run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    expect(
      await db.prepare("SELECT id FROM celulas WHERE id = 102").first(),
    ).toEqual({ id: 102 });
  });
});
