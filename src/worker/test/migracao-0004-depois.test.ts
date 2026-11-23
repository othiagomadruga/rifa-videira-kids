// 0004 (RIFA-012) aplicada DEPOIS da 0005 à 0007, sobre dados que já existiam. A conferência entrou na `main`
// depois delas: num D1 que já tenha recebido as outras, o wrangler aplica, por nome, as que faltam, e a 0004 roda
// por último (docs/lancamento.md, 2.3). Ela é aditiva e não depende das outras, nem elas dela: o schema final é o
// mesmo da ordem normal (o DB dos testes) e o que existia continua lá. Este arquivo tem o próprio DB_MIGRACAO,
// vazio no início (vitest.config.ts). As que vieram depois da 0004 entrar na `main` (a 0008, D20) são aplicadas
// depois dela, como num D1 de verdade.
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

const { DB, DB_MIGRACAO, TEST_MIGRATIONS } = env as Cloudflare.Env & {
  DB_MIGRACAO: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

const CONFERENCIA = "0004_conferencia.sql";
/** As migrações que existiam quando a 0004 entrou na `main` (até a 0007). */
const ATE_0007 = TEST_MIGRATIONS.filter((migracao) => migracao.name < "0008");

/** Tabelas, índices, views e gatilhos com o SQL de cada um, sem os internos do SQLite, do D1 e das migrações. */
async function schema(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master
       WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name <> 'd1_migrations'
       ORDER BY type, name`,
    )
    .all();
  return results;
}

const PEDIDOS = "SELECT * FROM pedidos ORDER BY id";

describe("0004 aplicada depois da 0005 à 0007 (RIFA-012)", () => {
  const db = DB_MIGRACAO;
  let antes: Record<string, unknown>[];

  beforeAll(async () => {
    const semConferencia = ATE_0007.filter(
      (migracao) => migracao.name !== CONFERENCIA,
    );
    expect(semConferencia.map((migracao) => migracao.name)).toContain(
      "0007_indices_pedidos_entregas.sql",
    );
    await applyD1Migrations(db, semConferencia);
    // Antes da 0004: a campanha, um afiliado, um admin (o papel da 0006), dois pedidos e uma entrega do webhook.
    const campanha = await db
      .prepare(
        `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
         meta_regra, meta_valor, ranking_criterio)
       VALUES ('Campanha Antes da 0004', 'campanha-antes-da-0004', 1, '2026-11-23', 2000, 'bilhetes',
         'por_pessoa', 10, 'percentual_meta')
       RETURNING id`,
      )
      .first<{ id: number }>();
    await db.batch([
      db.prepare(
        "INSERT INTO afiliados (affiliate_id, origem) VALUES (4001, 'webhook')",
      ),
      db.prepare(
        `INSERT INTO usuarios (id, nome, papel, ativo, criado_em)
         VALUES (1, 'Admin Antes da 0004', 'admin', 1, '2026-11-01T10:00:00.000Z')`,
      ),
      db
        .prepare(
          `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em,
           registrado_em, atualizado_em) VALUES
           ('ANTES-0004-1', ?1, 4001, 'approved', 2, 4000, '2026-11-24T13:00:00.000Z',
             '2026-11-24T12:59:00.000Z', '2026-11-24T13:00:01.000Z'),
           ('ANTES-0004-2', ?1, NULL, 'in_process', 1, 2000, NULL,
             '2026-11-24T14:00:00.000Z', '2026-11-24T14:00:00.000Z')`,
        )
        .bind(campanha!.id),
      db.prepare(
        `INSERT INTO webhook_eventos (recebido_em, evento, pedido_id, slug, resultado, status_anterior,
         status_resultante, payload_redigido, erro, avisos)
         VALUES ('2026-11-24T13:00:01.000Z', 'paid_order', 'ANTES-0004-1', 'campanha-antes-da-0004', 'processado',
           'in_process', 'approved', '{}', NULL, NULL)`,
      ),
    ]);
    antes = (await db.prepare(PEDIDOS).all<Record<string, unknown>>()).results;
    // A 0004 sozinha (é a única que falta até a 0007) e, depois, as que vieram depois dela (a 0008).
    await applyD1Migrations(db, ATE_0007);
    await applyD1Migrations(db, TEST_MIGRATIONS);
  });

  it("a 0004 foi aplicada depois da 0007, sobre os dados (e as posteriores, depois dela)", async () => {
    const { results } = await db
      .prepare("SELECT name FROM d1_migrations ORDER BY id")
      .all<{ name: string }>();
    expect(results.map((linha) => linha.name)).toEqual([
      ...ATE_0007.map((migracao) => migracao.name).filter(
        (nome) => nome !== CONFERENCIA,
      ),
      CONFERENCIA,
      ...TEST_MIGRATIONS.map((migracao) => migracao.name).filter(
        (nome) => nome >= "0008",
      ),
    ]);
    expect(results.map((linha) => linha.name)).toContain(
      "0008_regras_campanha.sql",
    );
    expect(antes).toHaveLength(2);
  });

  it("o schema é o mesmo da ordem normal (tabelas, colunas, CHECKs, índices, view e gatilhos)", async () => {
    const depois = await schema(db);
    expect(depois).toEqual(await schema(DB));
    // Não é a comparação de dois vazios: estão lá o que a 0004 cria e o que a 0006 e a 0007 criaram antes dela.
    expect(depois.map((objeto) => objeto.name)).toEqual(
      expect.arrayContaining([
        "recuperacoes",
        "recuperacoes_por_campanha",
        "pedidos_por_recuperacao",
        "pedidos_por_campanha_registro",
        "usuarios_um_por_celula",
        "usuarios_papel_obrigatorio_ao_inserir",
        "vendas_aprovadas",
      ]),
    );
    const pedidos = depois.find((objeto) => objeto.name === "pedidos");
    expect(String(pedidos?.sql)).toMatch(
      /origem TEXT NOT NULL DEFAULT 'webhook'/,
    );
  });

  it("os pedidos que existiam continuam iguais e ficam com a origem webhook, sem recuperação", async () => {
    const { results } = await db
      .prepare(PEDIDOS)
      .all<Record<string, unknown>>();
    expect(results).toEqual(
      antes.map((pedido) => ({
        ...pedido,
        origem: "webhook",
        recuperacao_id: null,
        // 0008 (D20): os pedidos de antes contam (nenhum desconsiderado).
        desconsiderado_em: null,
        desconsiderado_motivo: null,
        desconsiderado_observacao: null,
        // 0011 (RIFA-056): nenhum pagamento registrado pela conferência.
        pagamento_recuperacao_id: null,
        // 0017 (RIFA-076, D36): sem o contato do comprador até o próximo evento.
        comprador_nome: null,
        comprador_telefone: null,
        // 0020 (RIFA-088, D41): nenhuma célula atribuída à mão.
        celula_atribuida_id: null,
        celula_atribuida_em: null,
        celula_atribuida_por: null,
      })),
    );
  });

  it("a conferência grava no banco migrado: a recuperação do admin e o pedido recuperado", async () => {
    const recuperacao = await db
      .prepare(
        `INSERT INTO recuperacoes (campanha_id, usuario_id, executado_em, pedidos_solicitados, pedidos_recuperados,
         bilhetes, total_centavos, linhas_arquivo, arquivo_sha256, mapeamento)
         SELECT id, 1, '2026-11-25T12:00:00.000Z', 1, 1, 3, 6000, 10, ?1, '{"pedido_id":"Pedido"}'
         FROM campanhas WHERE slug_rifei = 'campanha-antes-da-0004'
         RETURNING id`,
      )
      .bind("a".repeat(64))
      .first<{ id: number }>();
    await db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, aprovado_em, origem,
         recuperacao_id)
         SELECT 'RECUPERADO-0004', campanha_id, 'approved', 3, 6000, '2026-11-25T11:00:00.000Z', 'conferencia', id
         FROM recuperacoes WHERE id = ?1`,
      )
      .bind(recuperacao!.id)
      .run();
    expect(
      await db
        .prepare(
          "SELECT origem, recuperacao_id FROM pedidos WHERE id = 'RECUPERADO-0004'",
        )
        .first(),
    ).toEqual({ origem: "conferencia", recuperacao_id: recuperacao!.id });
    // O CHECK da 0004 vale também aqui: 'conferencia' sem a recuperação é recusado.
    await expect(
      db
        .prepare(
          `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, origem)
           SELECT 'SEM-RECUPERACAO', id, 'approved', 1, 2000, 'conferencia' FROM campanhas`,
        )
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
