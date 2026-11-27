// Schema do D1 (migrations/0000_setup.sql, 0001_init.sql, 0002_acessos.sql, 0003_vendas_por_dia.sql,
// 0004_conferencia.sql, 0005_auditoria.sql, 0006_acesso_hierarquia.sql, 0007_indices_pedidos_entregas.sql,
// 0008_regras_campanha.sql, 0009_token_webhook.sql, 0010_link_vendas.sql, 0011_pagamento_conferencia.sql,
// 0012_ranking_por_divisao.sql, 0013_login_celulas_senha.sql, 0014_codigo_afiliado_rifei.sql, 0015_senha_admin.sql,
// 0016_bilhetes_campanha.sql, 0017_comprador_contato.sql, 0018_grupos.sql, 0019_grupo_da_celula.sql,
// 0020_celula_atribuida.sql, 0021_avisos_de_venda.sql e 0022_notificacoes_push.sql), aplicado pelo setup
// apply-migrations.ts no D1 local dos testes, dentro do workerd. A 0006 até a 0022 também são aplicadas num D1 à parte (DB_MIGRACAO, vitest.config.ts)
// SOBRE dados gravados com as migrações anteriores: o que existia continua lá (RIFA-014, CA7; RIFA-025, CA5; RIFA-028,
// CA8; RIFA-039, CA8; RIFA-046, CA7; RIFA-056; RIFA-061; RIFA-064; RIFA-070; RIFA-073; RIFA-075; RIFA-076; RIFA-084;
// RIFA-085; RIFA-088; RIFA-094; RIFA-095).
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import {
  ACESSO_PADRAO,
  MENSAGENS_PADRAO,
  PEDIDOS_PADRAO,
  campanhaEntradaSchema,
} from "../../shared/contracts";
import { buscarLinkValido, buscarUsuarioDaSessao } from "../db/acessos";
import {
  montarCampanha,
  salvarCampanhaAtiva,
  type CampanhaAtiva,
} from "../db/campanha";
import { SELECIONAR_VENDAS_POR_DIA_UTC_MENOS_3 } from "../db/painel";
import {
  GRAVAR_SE_NAO_HA_TOKEN,
  LER_HASH_TOKEN_WEBHOOK,
  SUBSTITUIR_TOKEN,
} from "../db/token-webhook";

/**
 * A leitura do painel por afiliado e dia em UTC−3 como era da 0008 à 0019 (db/painel.ts antes da RIFA-088, que passou a
 * agrupar também pela célula atribuída da 0020). Os blocos da 0008 rodam com o banco ainda sem a coluna nova.
 */
const PAINEL_ATE_0019 = `
  SELECT a.celula_id AS celula_id, v.dia AS dia, sum(v.pedidos) AS pedidos,
    sum(v.bilhetes) AS bilhetes, sum(v.centavos) AS centavos
  FROM (
    SELECT affiliate_id, date(aprovado_em, '-180 minutes') AS dia, count(*) AS pedidos,
      sum(qtd_bilhetes) AS bilhetes, sum(total_centavos) AS centavos
    FROM pedidos
    WHERE campanha_id = ?1 AND status = 'approved' AND desconsiderado_em IS NULL
    GROUP BY affiliate_id, dia
  ) AS v
  LEFT JOIN afiliados AS a ON a.affiliate_id = v.affiliate_id
  GROUP BY a.celula_id, v.dia`;

const TABELAS = [
  "_meta",
  "afiliados",
  // 0005 (RIFA-013b): trilha de auditoria.
  "auditoria",
  "campanha_periodos",
  "campanhas",
  "celulas",
  "discipuladores",
  // 0018 (RIFA-084, D39): os grupos do discipulador (adultos da manhã, adultos da noite, jovens, adolescentes).
  "grupos",
  "links_acesso",
  "pedidos",
  // 0005 (RIFA-013b): pedidos aprovados marcados como implausíveis.
  "pedidos_suspeitos",
  // 0022 (RIFA-095, D43): as inscrições das notificações de venda (Web Push).
  "push_inscricoes",
  // 0004 (RIFA-012): auditoria do "Recuperar" da conferência pelo CSV.
  "recuperacoes",
  "redes",
  "sessoes",
  // 0015 (RIFA-073, D33): o hash PBKDF2 da senha de login do admin.
  "senhas_admin",
  // 0009 (RIFA-039, D21): o SHA-256 do token do webhook gerado pela tela (uma linha no máximo).
  "token_webhook",
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
    // equipe da igreja, não do comprador. A observação da desconsideração (0008, D20) é a nota curta do ADMIN
    // sobre o pedido (teste, fraude, estorno), não um dado do comprador: o contrato recusa "@" e 8 dígitos
    // seguidos (observacaoTemContato) e a tela pede para não escrever nome, telefone ou e-mail.
    // RIFA-076 (D36, decisão do PO em 19/11, que substitui em parte a regra): o nome e o telefone de quem reserva ou
    // compra, só no pedido e só para o admin. E-mail, documento, nascimento e endereço continuam proibidos, e a trilha
    // (webhook_eventos) continua sem nada do comprador.
    const equipe = new Set([
      "celulas.lider_email",
      "celulas.lider_telefone",
      "usuarios.email",
      "pedidos.desconsiderado_observacao",
      "pedidos.comprador_nome",
      "pedidos.comprador_telefone",
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
      // 0018 (RIFA-084, D39): os discipuladores de cada grupo (o ranking por grupo e o SET NULL ao apagar o grupo).
      discipuladores: ["discipuladores_por_rede", "discipuladores_por_grupo"],
      // 0019 (RIFA-085): as células com grupo próprio (o ranking por grupo e o SET NULL ao apagar o grupo).
      celulas: ["celulas_por_discipulador", "celulas_por_grupo"],
      afiliados: ["afiliados_por_celula"],
      pedidos: [
        "pedidos_por_afiliado_status",
        "pedidos_por_status_aprovacao",
        // 0003: parcial (approved) e com o dia de UTC−3, para a leitura do painel (db/painel.ts).
        "pedidos_aprovados_por_afiliado_dia",
        // 0004 (RIFA-012): parcial (origem = 'conferencia'), para a lista das recuperações.
        "pedidos_por_recuperacao",
        // 0007 (RIFA-025): a lista de pedidos da campanha com o cursor (db/lista-pedidos.ts).
        "pedidos_por_campanha_registro",
        // 0008 (RIFA-028, D20): parcial (desconsiderado_em IS NOT NULL), para a lista com desconsiderado=true.
        "pedidos_desconsiderados_por_registro",
        // 0011 (RIFA-056): parcial (pagamento_recuperacao_id IS NOT NULL), os pagamentos registrados de cada
        // recuperação.
        "pedidos_por_pagamento_recuperado",
        // 0020 (RIFA-088, D41): parcial (celula_atribuida_id IS NOT NULL), os pedidos atribuídos à mão a cada célula.
        "pedidos_por_celula_atribuida",
      ],
      webhook_eventos: [
        "webhook_eventos_por_pedido",
        "webhook_eventos_por_resultado",
        // 0007 (RIFA-025): as entregas de um resultado pelo id (db/entregas-webhook.ts) e, parcial, as entregas
        // da campanha por slug (última entrega da campanha, db/estado-webhook.ts).
        "webhook_eventos_por_resultado_id",
        "webhook_eventos_da_campanha_por_slug",
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
      // 0022 (RIFA-095, D43): a ordem do envio (os que esperam há mais tempo primeiro).
      push_inscricoes: ["push_inscricoes_por_envio"],
      // 0004 (RIFA-012).
      recuperacoes: ["recuperacoes_por_campanha"],
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

  it("0004 (RIFA-012): origem e recuperacao_id andam juntos; recuperacoes confere o SHA-256, o mapeamento e as contagens", async () => {
    const db = env.DB;
    const campanha = await db
      .prepare(
        `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
           meta_unidade, meta_regra, meta_valor, ranking_criterio)
         VALUES ('Campanha de teste (0004)', 'teste-migracao-0004', 0, '2026-11-23', 2000,
           'bilhetes', 'por_pessoa', 10, 'percentual_meta')
         RETURNING id`,
      )
      .first<{ id: number }>();
    const usuario = await db
      .prepare(
        "INSERT INTO usuarios (nome, papel) VALUES ('Pessoa de teste (0004)', 'coordenacao') RETURNING id",
      )
      .first<{ id: number }>();
    const recuperacao = (sha256: string, mapeamento: string, solicitados = 1) =>
      db
        .prepare(
          `INSERT INTO recuperacoes (campanha_id, usuario_id, executado_em, pedidos_solicitados,
             linhas_arquivo, arquivo_sha256, mapeamento)
           VALUES (?1, ?2, '2026-12-01T12:00:00.000Z', ?3, 10, ?4, ?5)
           RETURNING id`,
        )
        .bind(campanha!.id, usuario!.id, solicitados, sha256, mapeamento);
    const pedido = (id: string, origem: string, recuperacaoId: number | null) =>
      db
        .prepare(
          `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, aprovado_em,
             origem, recuperacao_id)
           VALUES (?1, ?2, 'approved', 1, 2000, '2026-12-01T12:00:00.000Z', ?3, ?4)`,
        )
        .bind(id, campanha!.id, origem, recuperacaoId);
    const sha = "a".repeat(64);
    const criada = await recuperacao(sha, '{"pedido_id":"Pedido"}').first<{
      id: number;
    }>();
    onTestFinished(async () => {
      await db.batch([
        db.prepare("DELETE FROM pedidos WHERE id LIKE 'TESTE-0004-%'"),
        db.prepare("DELETE FROM recuperacoes WHERE id = ?").bind(criada!.id),
        db.prepare("DELETE FROM usuarios WHERE id = ?").bind(usuario!.id),
        db.prepare("DELETE FROM campanhas WHERE id = ?").bind(campanha!.id),
      ]);
    });

    // recuperacoes: SHA-256 em hex minúsculo, mapeamento objeto JSON e pelo menos um pedido solicitado.
    for (const [sha256, mapeamento, solicitados] of [
      ["A".repeat(64), "{}", 1],
      ["a".repeat(63), "{}", 1],
      [sha, "[]", 1],
      [sha, "nao json", 1],
      [sha, "{}", 0],
    ] as const)
      await expect(
        recuperacao(sha256, mapeamento, solicitados).run(),
      ).rejects.toThrow(/CHECK constraint failed/);

    // pedidos: 'conferencia' exige a recuperação, e só ele a tem; outra origem não existe.
    for (const [origem, recuperacaoId] of [
      ["conferencia", null],
      ["webhook", criada!.id],
      ["planilha", null],
    ] as const)
      await expect(
        pedido("TESTE-0004-X", origem, recuperacaoId).run(),
      ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      pedido("TESTE-0004-X", "conferencia", 999_999).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    await pedido("TESTE-0004-1", "conferencia", criada!.id).run();
    await pedido("TESTE-0004-2", "webhook", null).run();
    // A recuperação com pedido não pode ser apagada (ON DELETE RESTRICT).
    await expect(
      db
        .prepare("DELETE FROM recuperacoes WHERE id = ?")
        .bind(criada!.id)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
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

/** Todas as tabelas nossas, linha por linha (pela ordem do rowid), com todas as colunas de cada uma. */
async function fotografarTodasAsTabelas(
  db: D1Database,
): Promise<Record<string, Record<string, unknown>[]>> {
  const { results } = await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND ${soNossas("name")} ORDER BY name`,
    )
    .all<{ name: string }>();
  const nomes = results.map((linha) => linha.name);
  const linhas = await db.batch(
    nomes.map((nome) => db.prepare(`SELECT * FROM "${nome}" ORDER BY rowid`)),
  );
  return Object.fromEntries(
    nomes.map((nome, indice) => [
      nome,
      linhas[indice].results as Record<string, unknown>[],
    ]),
  );
}

// As migrações sobre dados que já existiam são um cenário em passos no mesmo D1 (DB_MIGRACAO): até a 0005 e os
// dados, a 0006 e as conferências dela, depois a 0007 sobre outros dados, a 0008 sobre mais outros, a 0009 sobre
// tudo o que ficou (inclusive a trilha e as entregas do webhook), a 0010 sobre tudo isso e o token, a 0011 sobre o
// resto (com uma recuperação e um pedido pendente) e a 0012 sobre tudo (as campanhas ganham a opção). Por isso a
// ordem é a do arquivo, mesmo com --sequence.shuffle: cada uma tem de ser a última aplicada quando os testes dela
// rodam, e a cascata apaga linhas que a comparação "continuam iguais" fotografou.
describe("migrações sobre dados que já existiam", { shuffle: false }, () => {
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
      const ate0006 = TEST_MIGRATIONS.filter(
        (migracao) => migracao.name < "0007",
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
      // Até a 0006: a 0007 é aplicada depois, sobre outros dados (describe "0007 sobre dados que já existiam").
      await applyD1Migrations(db, ate0006);
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
              + (SELECT count(*) FROM auditoria WHERE usuario_id NOT IN (SELECT id FROM usuarios))
              + (SELECT count(*) FROM recuperacoes WHERE usuario_id NOT IN (SELECT id FROM usuarios)) AS total`,
        )
        .first<{ total: number }>();
      expect(orfaos).toEqual({ total: 0 });
      // As referências a usuarios seguem no schema das tabelas filhas (o D1 não deixa ler pragma_foreign_key_list).
      const { results: filhas } = await db
        .prepare(
          `SELECT name, sql FROM sqlite_master
         WHERE type = 'table' AND name IN ('auditoria', 'links_acesso', 'recuperacoes', 'sessoes') ORDER BY name`,
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
        // 0004 (RIFA-012): quem fez cada "Recuperar".
        { name: "recuperacoes", referencia: "RESTRICT" },
        { name: "sessoes", referencia: "CASCADE" },
      ]);
    });

    it("o admin de antes continua com o link e a sessão no banco migrado (as consultas de hoje entram no describe da 0008)", async () => {
      // As consultas do login (db/acessos.ts) leem a chave de acesso da 0008 (RIFA-029): no banco ainda na 0006,
      // a conferência é das linhas; o login de verdade é conferido no fim do describe da 0008.
      const { results } = await db
        .prepare(
          `SELECT l.id, l.revogado_em IS NULL AS valido, s.id_hash IS NOT NULL AS com_sessao
           FROM links_acesso AS l LEFT JOIN sessoes AS s ON s.link_id = l.id
           WHERE l.usuario_id = 1 ORDER BY l.id`,
        )
        .all();
      expect(results).toEqual([
        { id: 1, valido: 1, com_sessao: 1 },
        { id: 2, valido: 0, com_sessao: 0 },
      ]);
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

  // ---------------------------------------------------------------------------------------------------
  // 0007 (RIFA-025, D16): dois índices, aplicados sobre pedidos e entregas que já existiam (CA5)
  // ---------------------------------------------------------------------------------------------------

  /** O que já existia antes da 0007 (a ordem pela chave). */
  const FOTOS_0007 = {
    pedidos: "SELECT * FROM pedidos ORDER BY id",
    pedidos_suspeitos: "SELECT * FROM pedidos_suspeitos ORDER BY pedido_id",
    webhook_eventos: "SELECT * FROM webhook_eventos ORDER BY id",
    afiliados: "SELECT * FROM afiliados ORDER BY affiliate_id",
  } as const;

  async function fotografar0007(db: D1Database) {
    const resultados = await db.batch(
      Object.values(FOTOS_0007).map((sql) => db.prepare(sql)),
    );
    return Object.fromEntries(
      Object.keys(FOTOS_0007).map((nome, indice) => [
        nome,
        resultados[indice].results,
      ]),
    );
  }

  describe("0007 sobre dados que já existiam (RIFA-025, CA5)", () => {
    const db = DB_MIGRACAO;
    let antes: Awaited<ReturnType<typeof fotografar0007>>;
    let campanhaId: number;

    beforeAll(async () => {
      // Idempotente: o describe da 0006 já aplicou até ela (aqui vale também rodando este describe sozinho).
      const ate0006 = TEST_MIGRATIONS.filter(
        (migracao) => migracao.name < "0007",
      );
      expect(ate0006.map((migracao) => migracao.name)).not.toContain(
        "0007_indices_pedidos_entregas.sql",
      );
      await applyD1Migrations(db, ate0006);
      const campanha = await db
        .prepare(
          `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
           meta_regra, meta_valor, ranking_criterio)
         VALUES ('Campanha Antes da 0007', 'campanha-antes-da-0007', 1, '2026-11-23', 2000, 'bilhetes',
           'por_pessoa', 10, 'percentual_meta')
         RETURNING id`,
        )
        .first<{ id: number }>();
      campanhaId = campanha!.id;
      // Hierarquia própria (ids que o describe da 0006 não usa), um afiliado vinculado e um órfão, três pedidos
      // (um suspeito) e as entregas deles, inclusive um erro e um aviso.
      await db.batch([
        db.prepare(
          "INSERT INTO redes (id, nome, divisao) VALUES (70, 'Rede Antes da 0007', 'adultos')",
        ),
        db.prepare(
          "INSERT INTO discipuladores (id, rede_id, nome) VALUES (700, 70, 'Discipulador Antes da 0007')",
        ),
        db.prepare(
          `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
         VALUES (7000, 700, 'Celula Antes da 0007', 9, 'Lider Antes da 0007')`,
        ),
        db.prepare(
          `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em) VALUES
           (7001, 7000, 'manual', '2026-11-20T12:00:00.000Z'),
           (7002, NULL, 'webhook', NULL)`,
        ),
        db
          .prepare(
            `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em,
             registrado_em, atualizado_em) VALUES
             ('ANTES-0007-1', ?1, 7001, 'approved', 2, 4000, '2026-11-24T13:00:00.000Z',
               '2026-11-24T12:59:00.000Z', '2026-11-24T13:00:01.000Z'),
             ('ANTES-0007-2', ?1, 7002, 'in_process', 1, 2000, NULL,
               '2026-11-24T14:00:00.000Z', '2026-11-24T14:00:00.000Z'),
             ('ANTES-0007-3', ?1, NULL, 'expired', 3, 6000, NULL,
               '2026-11-24T15:00:00.000Z', '2026-11-25T15:00:00.000Z')`,
          )
          .bind(campanhaId),
        db.prepare(
          `INSERT INTO pedidos_suspeitos (pedido_id, qtd_bilhetes, total_centavos, esperado_centavos, motivos, marcado_em)
         VALUES ('ANTES-0007-1', 2, 4000, 4000,
           '[{"caminho":["numbers_count"],"codigo":"bilhetes_acima_do_teto","mensagem":"x","ocorrencias":1}]',
           '2026-11-24T13:00:01.000Z')`,
        ),
        db.prepare(
          `INSERT INTO webhook_eventos (recebido_em, evento, pedido_id, slug, resultado, status_anterior,
           status_resultante, payload_redigido, erro, avisos) VALUES
           ('2026-11-24T12:59:00.000Z', 'new_order', 'ANTES-0007-1', 'campanha-antes-da-0007', 'processado',
             NULL, 'in_process', '{}', NULL, NULL),
           ('2026-11-24T13:00:01.000Z', 'paid_order', 'ANTES-0007-1', 'campanha-antes-da-0007', 'processado',
             'in_process', 'approved', '{}', NULL,
             '[{"caminho":["subtotal"],"codigo":"invalid_type","mensagem":"x","ocorrencias":1}]'),
           ('2026-11-24T13:30:00.000Z', NULL, NULL, NULL, 'erro_validacao', NULL, NULL, NULL,
             '[{"caminho":[],"codigo":"json_invalido","mensagem":"x","ocorrencias":1}]', NULL)`,
        ),
      ]);
      antes = await fotografar0007(db);
      // Até a 0007: a 0008 é aplicada depois, sobre mais dados (describe "0008 sobre dados que já existiam").
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0008"),
      );
    });

    it("a 0007 foi aplicada por último, sobre os dados (não num banco vazio)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name).at(-1)).toBe(
        "0007_indices_pedidos_entregas.sql",
      );
      expect(antes.pedidos).toHaveLength(3);
      expect(antes.pedidos_suspeitos).toHaveLength(1);
      expect(antes.webhook_eventos).toHaveLength(3);
    });

    it("nenhum dado muda: pedidos, suspeitos, entregas e afiliados continuam iguais", async () => {
      expect(await fotografar0007(db)).toEqual(antes);
    });

    it("os três índices existem, com as colunas na ordem, e cobrem as linhas que já existiam", async () => {
      const colunas = async (indice: string) =>
        (
          await db
            .prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
            .bind(indice)
            .all<{ name: string }>()
        ).results.map((linha) => linha.name);
      expect(await colunas("pedidos_por_campanha_registro")).toEqual([
        "campanha_id",
        "registrado_em",
        "id",
      ]);
      expect(await colunas("webhook_eventos_por_resultado_id")).toEqual([
        "resultado",
        "id",
      ]);
      expect(await colunas("webhook_eventos_da_campanha_por_slug")).toEqual([
        "slug",
        "recebido_em",
      ]);
      // Parcial: só as entregas da campanha (D16), com o WHERE que a consulta repete.
      const parcial = await db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'webhook_eventos_da_campanha_por_slug'",
        )
        .first<{ sql: string }>();
      expect(parcial?.sql).toMatch(
        /WHERE resultado IN \('processado', 'duplicado', 'ignorado_transicao'\)$/,
      );
      // Lidas pelo índice (INDEXED BY obriga), as linhas antigas estão todas lá, na ordem da lista.
      const { results: pedidos } = await db
        .prepare(
          `SELECT id FROM pedidos INDEXED BY pedidos_por_campanha_registro
         WHERE campanha_id = ?1 ORDER BY registrado_em DESC, id DESC`,
        )
        .bind(campanhaId)
        .all<{ id: string }>();
      expect(pedidos.map((linha) => linha.id)).toEqual([
        "ANTES-0007-3",
        "ANTES-0007-2",
        "ANTES-0007-1",
      ]);
      const { results: entregas } = await db
        .prepare(
          `SELECT resultado, count(*) AS n FROM webhook_eventos INDEXED BY webhook_eventos_por_resultado_id
         WHERE resultado IN ('processado', 'erro_validacao') GROUP BY resultado ORDER BY resultado`,
        )
        .all<{ resultado: string; n: number }>();
      expect(entregas).toEqual([
        { resultado: "erro_validacao", n: 1 },
        { resultado: "processado", n: 2 },
      ]);
      // As duas entregas processadas antigas estão no índice parcial; o erro (fora do WHERE dele), não.
      const { results: daCampanha } = await db
        .prepare(
          `SELECT recebido_em FROM webhook_eventos INDEXED BY webhook_eventos_da_campanha_por_slug
         WHERE resultado IN ('processado', 'duplicado', 'ignorado_transicao') AND slug = ?1
         ORDER BY recebido_em`,
        )
        .bind("campanha-antes-da-0007")
        .all<{ recebido_em: string }>();
      expect(daCampanha.map((linha) => linha.recebido_em)).toEqual([
        "2026-11-24T12:59:00.000Z",
        "2026-11-24T13:00:01.000Z",
      ]);
    });
  });

  // -------------------------------------------------------------------------------------------------
  // 0008 (RIFA-028, 029 e 032; D20): as regras do admin, aplicada sobre dados que já existiam
  // -------------------------------------------------------------------------------------------------

  describe("0008 sobre dados que já existiam (RIFA-028, CA8)", () => {
    const db = DB_MIGRACAO;
    const SLUG_0008 = "campanha-antes-da-0008";
    /** As colunas que a 0008 acrescenta em pedidos (null nos pedidos de antes: todos contam). */
    const SEM_DESCONSIDERACAO = {
      desconsiderado_em: null,
      desconsiderado_motivo: null,
      desconsiderado_observacao: null,
    };
    /** As vendas da campanha como o painel somava ANTES da 0008 (sem a coluna nova). */
    const SOMAR_COMO_ANTES = `SELECT count(*) AS pedidos, sum(qtd_bilhetes) AS bilhetes,
      sum(total_centavos) AS centavos FROM pedidos WHERE campanha_id = ?1 AND status = 'approved'`;
    let campanhaId: number;
    let antes: {
      pedidos: Record<string, unknown>[];
      view: Record<string, unknown>[];
      somas: Record<string, unknown> | null;
      campanha: Record<string, unknown> | null;
    };

    const fotografar0008 = async () => {
      const [pedidos, view, campanha] = await db.batch([
        db
          .prepare("SELECT * FROM pedidos WHERE campanha_id = ?1 ORDER BY id")
          .bind(campanhaId),
        db
          .prepare(
            "SELECT * FROM vendas_aprovadas WHERE campanha_id = ?1 ORDER BY pedido_id",
          )
          .bind(campanhaId),
        db.prepare("SELECT * FROM campanhas WHERE id = ?1").bind(campanhaId),
      ]);
      return {
        pedidos: pedidos.results as Record<string, unknown>[],
        view: view.results as Record<string, unknown>[],
        somas: await db
          .prepare(SOMAR_COMO_ANTES)
          .bind(campanhaId)
          .first<Record<string, unknown>>(),
        campanha: (campanha.results[0] ?? null) as Record<
          string,
          unknown
        > | null,
      };
    };

    /**
     * As vendas somadas pela consulta do painel como era da 0008 à 0019 (db/painel.ts antes da RIFA-088), por afiliado
     * e dia: a de hoje lê `celula_atribuida_id`, que só existe a partir da 0020 (o bloco da 0020 confere a de hoje).
     */
    const somarPeloPainel = async (id: number) => {
      const { results } = await db
        .prepare(PAINEL_ATE_0019)
        .bind(id)
        .all<{ pedidos: number; bilhetes: number; centavos: number }>();
      return results.reduce(
        (soma, linha) => ({
          pedidos: soma.pedidos + linha.pedidos,
          bilhetes: soma.bilhetes + linha.bilhetes,
          centavos: soma.centavos + linha.centavos,
        }),
        { pedidos: 0, bilhetes: 0, centavos: 0 },
      );
    };

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram até a 0007 (aqui vale também rodando este sozinho).
      const ate0007 = TEST_MIGRATIONS.filter(
        (migracao) => migracao.name < "0008",
      );
      expect(ate0007.map((migracao) => migracao.name)).not.toContain(
        "0008_regras_campanha.sql",
      );
      await applyD1Migrations(db, ate0007);
      // Uma campanha inativa própria (a do describe da 0007 é a ativa), com hierarquia própria, um afiliado
      // vinculado e um órfão, e pedidos de todos os status (aprovados com e sem afiliado).
      const campanha = await db
        .prepare(
          `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
           meta_regra, meta_valor, ranking_criterio)
         VALUES ('Campanha Antes da 0008', ?1, 0, '2026-11-23', 2000, 'bilhetes', 'por_pessoa', 10,
           'percentual_meta')
         RETURNING id`,
        )
        .bind(SLUG_0008)
        .first<{ id: number }>();
      campanhaId = campanha!.id;
      await db.batch([
        db.prepare(
          "INSERT INTO redes (id, nome, divisao) VALUES (80, 'Rede Antes da 0008', 'jovens')",
        ),
        db.prepare(
          "INSERT INTO discipuladores (id, rede_id, nome) VALUES (800, 80, 'Discipulador Antes da 0008')",
        ),
        db.prepare(
          `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
           VALUES (8000, 800, 'Celula Antes da 0008', 7, 'Lider Antes da 0008')`,
        ),
        db.prepare(
          `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em) VALUES
           (8001, 8000, 'manual', '2026-11-20T12:00:00.000Z'),
           (8002, NULL, 'webhook', NULL)`,
        ),
        db
          .prepare(
            `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em,
             registrado_em, atualizado_em) VALUES
             ('ANTES-0008-1', ?1, 8001, 'approved', 2, 4000, '2026-11-24T13:00:00.000Z',
               '2026-11-24T12:59:00.000Z', '2026-11-24T13:00:01.000Z'),
             ('ANTES-0008-2', ?1, 8001, 'approved', 5, 10000, '2026-11-25T02:59:59.999Z',
               '2026-11-25T02:59:00.000Z', '2026-11-25T03:00:00.000Z'),
             ('ANTES-0008-3', ?1, 8002, 'approved', 1, 2000, '2026-11-26T15:00:00.000Z',
               '2026-11-26T14:59:00.000Z', '2026-11-26T15:00:01.000Z'),
             ('ANTES-0008-4', ?1, NULL, 'approved', 3, 6000, '2026-11-27T15:00:00.000Z',
               '2026-11-27T14:59:00.000Z', '2026-11-27T15:00:01.000Z'),
             ('ANTES-0008-5', ?1, 8001, 'in_process', 1, 2000, NULL,
               '2026-11-28T14:00:00.000Z', '2026-11-28T14:00:00.000Z'),
             ('ANTES-0008-6', ?1, NULL, 'expired', 4, 8000, NULL,
               '2026-11-28T15:00:00.000Z', '2026-11-29T15:00:00.000Z')`,
          )
          .bind(campanhaId),
      ]);
      antes = await fotografar0008();
      // Até a 0008: a 0009 é aplicada depois, sobre tudo isto (describe "0009 sobre dados que já existiam").
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0009"),
      );
    });

    it("a 0008 foi aplicada por último, sobre os dados (não num banco vazio)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name).at(-1)).toBe(
        "0008_regras_campanha.sql",
      );
      expect(antes.pedidos).toHaveLength(6);
      expect(antes.view).toHaveLength(4);
      expect(antes.somas).toEqual({
        pedidos: 4,
        bilhetes: 11,
        centavos: 22000,
      });
    });

    it("nenhum dado muda: os pedidos ficam iguais, sem desconsideração, e a view e o painel contam o mesmo de antes", async () => {
      const depois = await fotografar0008();
      expect(depois.pedidos).toEqual(
        antes.pedidos.map((pedido) => ({ ...pedido, ...SEM_DESCONSIDERACAO })),
      );
      expect(depois.view).toEqual(antes.view);
      expect(depois.somas).toEqual(antes.somas);
      // A consulta do painel (com o filtro novo) soma o mesmo que a de antes da 0008.
      expect(await somarPeloPainel(campanhaId)).toEqual(antes.somas);
    });

    it("a campanha fica com os padrões: chave de desconsiderar desligada, acessos ligados e os modelos padrão", async () => {
      const depois = await fotografar0008();
      expect(depois.campanha).toEqual({
        ...antes.campanha,
        pedidos_desconsiderar: 0,
        acesso_discipuladores: 1,
        acesso_redes: 1,
        mensagem_link_coordenacao: null,
        mensagem_link_lider: null,
        mensagem_link_discipulador: null,
        mensagem_link_rede: null,
      });
      // Montada no contrato (a leitura de toda rota): os padrões de regras.ts.
      const montada = montarCampanha({
        ...(depois.campanha as unknown as Omit<CampanhaAtiva, "periodos">),
        periodos: [
          { ordem: 1, nome: "Período 1", dias: 10, percentual_bp: 10000 },
        ],
      });
      expect({
        pedidos: montada.pedidos,
        acesso: montada.acesso,
        mensagens: montada.mensagens,
      }).toEqual({
        pedidos: PEDIDOS_PADRAO,
        acesso: ACESSO_PADRAO,
        mensagens: MENSAGENS_PADRAO,
      });
    });

    it("os CHECK: motivo sem data, observação sem desconsideração, motivo fora da lista, data fora do formato, chave fora de 0/1 e modelo vazio ou longo", async () => {
      const recusar = (sql: string, ...valores: unknown[]) =>
        expect(
          db
            .prepare(sql)
            .bind(...valores)
            .run(),
        ).rejects.toThrow(/CHECK constraint failed/);
      const pedido = "WHERE id = 'ANTES-0008-1'";
      await recusar(
        `UPDATE pedidos SET desconsiderado_motivo = 'teste' ${pedido}`,
      );
      await recusar(
        `UPDATE pedidos SET desconsiderado_em = '2026-12-01T12:00:00.000Z' ${pedido}`,
      );
      await recusar(
        `UPDATE pedidos SET desconsiderado_observacao = 'compra de teste' ${pedido}`,
      );
      await recusar(
        `UPDATE pedidos SET desconsiderado_em = '2026-12-01T12:00:00.000Z', desconsiderado_motivo = 'erro' ${pedido}`,
      );
      await recusar(
        `UPDATE pedidos SET desconsiderado_em = '2026-12-01 12:00', desconsiderado_motivo = 'teste' ${pedido}`,
      );
      await recusar(
        `UPDATE pedidos SET desconsiderado_em = '2026-12-01T12:00:00.000Z', desconsiderado_motivo = 'teste',
           desconsiderado_observacao = ?1 ${pedido}`,
        "x".repeat(141),
      );
      await recusar(
        `UPDATE pedidos SET desconsiderado_em = '2026-12-01T12:00:00.000Z', desconsiderado_motivo = 'teste',
           desconsiderado_observacao = '' ${pedido}`,
      );
      const campanha = "WHERE id = ?1";
      for (const coluna of [
        "pedidos_desconsiderar",
        "acesso_discipuladores",
        "acesso_redes",
      ])
        await recusar(
          `UPDATE campanhas SET ${coluna} = 2 ${campanha}`,
          campanhaId,
        );
      for (const coluna of [
        "mensagem_link_coordenacao",
        "mensagem_link_lider",
        "mensagem_link_discipulador",
        "mensagem_link_rede",
      ]) {
        await recusar(
          `UPDATE campanhas SET ${coluna} = '' ${campanha}`,
          campanhaId,
        );
        await recusar(
          `UPDATE campanhas SET ${coluna} = ?2 ${campanha}`,
          campanhaId,
          "x".repeat(1001),
        );
      }
      // Os três juntos (a observação é opcional) passam; nada ficou gravado pelas recusas.
      await db
        .prepare(
          `UPDATE pedidos SET desconsiderado_em = '2026-12-01T12:00:00.000Z', desconsiderado_motivo = 'fraude',
             desconsiderado_observacao = ?1 ${pedido}`,
        )
        .bind("x".repeat(140))
        .run();
      await db
        .prepare(
          `UPDATE pedidos SET desconsiderado_em = NULL, desconsiderado_motivo = NULL,
             desconsiderado_observacao = NULL ${pedido}`,
        )
        .run();
      expect(await fotografar0008()).toMatchObject({
        pedidos: antes.pedidos.map((linha) => ({
          ...linha,
          ...SEM_DESCONSIDERACAO,
        })),
      });
    });

    it("o desconsiderado sai da view e do índice da 0003 recriado (o painel não o soma) e volta quando a desconsideração é desfeita", async () => {
      const desconsiderar = (em: string | null, motivo: string | null) =>
        db
          .prepare(
            `UPDATE pedidos SET desconsiderado_em = ?1, desconsiderado_motivo = ?2
             WHERE id = 'ANTES-0008-2'`,
          )
          .bind(em, motivo)
          .run();
      const noIndice = async () =>
        (
          await db
            .prepare(
              `SELECT id FROM pedidos INDEXED BY pedidos_aprovados_por_afiliado_dia
               WHERE campanha_id = ?1 AND status = 'approved' AND desconsiderado_em IS NULL ORDER BY id`,
            )
            .bind(campanhaId)
            .all<{ id: string }>()
        ).results.map((linha) => linha.id);
      const naView = async () =>
        (
          await db
            .prepare(
              "SELECT pedido_id FROM vendas_aprovadas WHERE campanha_id = ?1 ORDER BY pedido_id",
            )
            .bind(campanhaId)
            .all<{ pedido_id: string }>()
        ).results.map((linha) => linha.pedido_id);
      const todos = [
        "ANTES-0008-1",
        "ANTES-0008-2",
        "ANTES-0008-3",
        "ANTES-0008-4",
      ];

      await desconsiderar("2026-12-01T12:00:00.000Z", "teste");
      const semEle = todos.filter((id) => id !== "ANTES-0008-2");
      expect(await noIndice()).toEqual(semEle);
      expect(await naView()).toEqual(semEle);
      expect(await somarPeloPainel(campanhaId)).toEqual({
        pedidos: 3,
        bilhetes: 6,
        centavos: 12000,
      });

      await desconsiderar(null, null);
      expect(await noIndice()).toEqual(todos);
      expect(await naView()).toEqual(todos);
      expect(await somarPeloPainel(campanhaId)).toEqual(antes.somas);
    });

    it("os índices: o da 0003 recriado (desconsiderado_em por último, o WHERE novo) e o da lista dos desconsiderados", async () => {
      const definicao = async (indice: string) =>
        (
          await db
            .prepare(
              "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
            )
            .bind(indice)
            .first<{ sql: string }>()
        )?.sql.replace(/\s+/g, " ");
      expect(await definicao("pedidos_aprovados_por_afiliado_dia")).toMatch(
        /\( ?campanha_id, affiliate_id, date\(aprovado_em, '-180 minutes'\), aprovado_em, qtd_bilhetes, total_centavos, desconsiderado_em \) WHERE status = 'approved' AND desconsiderado_em IS NULL$/,
      );
      expect(await definicao("pedidos_desconsiderados_por_registro")).toMatch(
        /ON pedidos \(campanha_id, registrado_em, id\) WHERE desconsiderado_em IS NOT NULL$/,
      );
      // O painel (como era até a 0019) continua no índice de cobertura (sem voltar à tabela) no banco migrado.
      const { results } = await db
        .prepare(`EXPLAIN QUERY PLAN ${PAINEL_ATE_0019}`)
        .bind(campanhaId)
        .all<{ detail: string }>();
      expect(results.map((linha) => linha.detail)).toContain(
        "SEARCH pedidos USING COVERING INDEX pedidos_aprovados_por_afiliado_dia (campanha_id=?)",
      );
    });

    it("o afiliado com pedido não sai (FK RESTRICT); com os pedidos dele desconsiderados e sem afiliado, sai (RIFA-031)", async () => {
      await expect(
        db.prepare("DELETE FROM afiliados WHERE affiliate_id = 8002").run(),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
      const [, , removido] = await db.batch([
        db.prepare(
          `UPDATE pedidos SET desconsiderado_em = '2026-12-01T12:00:00.000Z', desconsiderado_motivo = 'teste'
           WHERE affiliate_id = 8002`,
        ),
        db.prepare(
          "UPDATE pedidos SET affiliate_id = NULL WHERE affiliate_id = 8002 AND desconsiderado_em IS NOT NULL",
        ),
        db.prepare("DELETE FROM afiliados WHERE affiliate_id = 8002"),
      ]);
      expect(removido.meta.changes).toBe(1);
      expect(
        await db
          .prepare(
            "SELECT affiliate_id, desconsiderado_motivo FROM pedidos WHERE id = 'ANTES-0008-3'",
          )
          .first(),
      ).toEqual({ affiliate_id: null, desconsiderado_motivo: "teste" });
    });
  });

  // -------------------------------------------------------------------------------------------------
  // 0009 (RIFA-039, D21): o token do webhook gerado pela tela, aplicada sobre tudo o que já existia
  // -------------------------------------------------------------------------------------------------

  describe("0009 sobre dados que já existiam (RIFA-039, CA8)", () => {
    const db = DB_MIGRACAO;
    const HASH_1 = "0123456789abcdef".repeat(4);
    const HASH_2 = "fedcba9876543210".repeat(4);
    const GERADO_EM_1 = "2026-11-12T10:00:00.000Z";
    const GERADO_EM_2 = "2026-11-12T11:30:00.123Z";
    let antes: Record<string, Record<string, unknown>[]>;
    /** Todas as tabelas nossas, linha por linha: a 0009 não pode mudar nenhuma. */
    const fotografarTudo = () => fotografarTodasAsTabelas(db);

    const linhaDoToken = () =>
      db.prepare("SELECT * FROM token_webhook ORDER BY rowid").all();
    const apagarToken = async () => {
      await db.prepare("DELETE FROM token_webhook").run();
    };

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram até a 0008 (aqui vale também rodando este sozinho).
      const ate0008 = TEST_MIGRATIONS.filter(
        (migracao) => migracao.name < "0009",
      );
      expect(ate0008.map((migracao) => migracao.name)).not.toContain(
        "0009_token_webhook.sql",
      );
      await applyD1Migrations(db, ate0008);
      // Além do que os describes anteriores gravaram: uma geração de link na trilha e entregas autenticadas do
      // webhook (o "último uso" da tela sai de webhook_eventos, D21), de antes da 0009.
      await db.batch([
        db.prepare(
          `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
           VALUES (1, '2026-11-10T10:00:00.000Z', 'link.criar', 'link:1', 'Link criado antes da 0009')`,
        ),
        db.prepare(
          `INSERT INTO webhook_eventos (recebido_em, evento, pedido_id, slug, resultado, payload_redigido, erro)
           VALUES ('2026-11-10T12:00:00.000Z', 'new_order', 'ANTES-0009-1', 'outra-campanha',
             'ignorado_outra_campanha', '{}', NULL),
           ('2026-11-10T12:05:00.000Z', NULL, NULL, NULL, 'erro_validacao', NULL,
             '[{"caminho":[],"codigo":"json_invalido","mensagem":"O corpo não é um JSON válido","ocorrencias":1}]')`,
        ),
      ]);
      antes = await fotografarTudo();
      // Até a 0009: a 0010 é aplicada depois, sobre tudo isto (describe "0010 sobre dados que já existiam").
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0010"),
      );
    });

    it("a 0009 foi aplicada por último, sobre os dados (não num banco vazio)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name).at(-1)).toBe(
        "0009_token_webhook.sql",
      );
      expect(antes.token_webhook).toBeUndefined();
      for (const tabela of [
        "usuarios",
        "links_acesso",
        "sessoes",
        "auditoria",
        "pedidos",
        "webhook_eventos",
        "campanhas",
      ])
        expect({ tabela, vazia: antes[tabela].length === 0 }).toEqual({
          tabela,
          vazia: false,
        });
    });

    it("nenhum dado muda: toda tabela de antes fica igual, e token_webhook começa vazia (vale o segredo do Worker)", async () => {
      const { token_webhook: tokenWebhook, ...depois } = await fotografarTudo();
      expect(depois).toEqual(antes);
      expect(tokenWebhook).toEqual([]);
      const { results: colunas } = await db
        .prepare(
          "SELECT name, type, \"notnull\", pk FROM pragma_table_info('token_webhook') ORDER BY cid",
        )
        .all();
      expect(colunas).toEqual([
        { name: "id", type: "INTEGER", notnull: 0, pk: 1 },
        { name: "token_hash", type: "TEXT", notnull: 1, pk: 0 },
        { name: "gerado_em", type: "TEXT", notnull: 1, pk: 0 },
      ]);
    });

    it("a leitura do webhook é pela chave (plano pela INTEGER PRIMARY KEY) e lê 1 linha, com a tabela vazia ou não", async () => {
      const { results: plano } = await db
        .prepare(`EXPLAIN QUERY PLAN ${LER_HASH_TOKEN_WEBHOOK}`)
        .all<{ detail: string }>();
      expect(plano.map((passo) => passo.detail)).toEqual([
        "SEARCH token_webhook USING INTEGER PRIMARY KEY (rowid=?)",
      ]);

      const vazia = await db.prepare(LER_HASH_TOKEN_WEBHOOK).all();
      expect({ linhas: vazia.results, lidas: vazia.meta.rows_read }).toEqual({
        linhas: [],
        lidas: 1,
      });
      await db.prepare(GRAVAR_SE_NAO_HA_TOKEN).bind(HASH_1, GERADO_EM_1).run();
      onTestFinished(apagarToken);
      const comLinha = await db.prepare(LER_HASH_TOKEN_WEBHOOK).all();
      expect({
        linhas: comLinha.results,
        lidas: comLinha.meta.rows_read,
      }).toEqual({ linhas: [{ token_hash: HASH_1 }], lidas: 1 });
    });

    it("os CHECK: uma linha só (id 2 e INSERT sem id), o hash fora do formato e o instante fora do formato são recusados", async () => {
      const recusar = (sql: string, ...valores: unknown[]) =>
        expect(
          db
            .prepare(sql)
            .bind(...valores)
            .run(),
        ).rejects.toThrow(/CHECK constraint failed/);
      onTestFinished(apagarToken);
      const inserir =
        "INSERT INTO token_webhook (id, token_hash, gerado_em) VALUES (?1, ?2, ?3)";

      await recusar(inserir, 2, HASH_1, GERADO_EM_1);
      await recusar(inserir, 0, HASH_1, GERADO_EM_1);
      for (const hashErrado of [
        HASH_1.toUpperCase(),
        HASH_1.slice(0, 63),
        `${HASH_1}0`,
        `${HASH_1.slice(0, 63)}g`,
        `${HASH_1.slice(0, 62)} 0`,
        "token-do-webhook-em-texto",
        "",
      ])
        await recusar(inserir, 1, hashErrado, GERADO_EM_1);
      for (const instanteErrado of [
        "2026-11-12 10:00:00",
        "2026-11-12T10:00:00Z",
        "2026-11-12T10:00:00.000+00:00",
        "2026-11-12",
        "12/11/2026 10:00",
      ])
        await recusar(inserir, 1, HASH_1, instanteErrado);
      // NOT NULL nas duas colunas.
      await expect(
        db
          .prepare(
            "INSERT INTO token_webhook (id, token_hash, gerado_em) VALUES (1, NULL, ?1)",
          )
          .bind(GERADO_EM_1)
          .run(),
      ).rejects.toThrow(/NOT NULL constraint failed/);
      expect((await linhaDoToken()).results).toEqual([]);

      // Com a linha 1 gravada, um INSERT sem id ganharia o rowid 2: recusado pelo CHECK.
      await db.prepare(inserir).bind(1, HASH_1, GERADO_EM_1).run();
      await recusar(
        "INSERT INTO token_webhook (token_hash, gerado_em) VALUES (?1, ?2)",
        HASH_2,
        GERADO_EM_2,
      );
      expect((await linhaDoToken()).results).toEqual([
        { id: 1, token_hash: HASH_1, gerado_em: GERADO_EM_1 },
      ]);
    });

    it("a gravação: sem substituir, ON CONFLICT DO NOTHING mantém a primeira (changes 0); com substituir, o UPSERT troca a linha", async () => {
      onTestFinished(apagarToken);
      const primeira = await db
        .prepare(GRAVAR_SE_NAO_HA_TOKEN)
        .bind(HASH_1, GERADO_EM_1)
        .run();
      expect(primeira.meta.changes).toBe(1);

      const outraAba = await db
        .prepare(GRAVAR_SE_NAO_HA_TOKEN)
        .bind(HASH_2, GERADO_EM_2)
        .run();
      expect(outraAba.meta.changes).toBe(0);
      expect((await linhaDoToken()).results).toEqual([
        { id: 1, token_hash: HASH_1, gerado_em: GERADO_EM_1 },
      ]);

      const troca = await db
        .prepare(SUBSTITUIR_TOKEN)
        .bind(HASH_2, GERADO_EM_2)
        .run();
      expect(troca.meta.changes).toBe(1);
      expect((await linhaDoToken()).results).toEqual([
        { id: 1, token_hash: HASH_2, gerado_em: GERADO_EM_2 },
      ]);
    });
  });

  // -------------------------------------------------------------------------------------------------
  // 0010 (RIFA-046, D24): o modelo do link de vendas na campanha, aplicada sobre tudo o que já existia
  // -------------------------------------------------------------------------------------------------

  describe("0010 sobre dados que já existiam (RIFA-046, CA7)", () => {
    const db = DB_MIGRACAO;
    const MODELO = "https://rifei.com.br/{slug}?afiliado={afiliado}";
    let antes: Record<string, Record<string, unknown>[]>;

    const modelos = async () =>
      (
        await db
          .prepare(
            "SELECT id, ativa, link_vendas_modelo FROM campanhas ORDER BY id",
          )
          .all<{
            id: number;
            ativa: number;
            link_vendas_modelo: string | null;
          }>()
      ).results;
    const apagarModelos = async () => {
      await db.prepare("UPDATE campanhas SET link_vendas_modelo = NULL").run();
    };

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram até a 0009 (aqui vale também rodando este sozinho).
      const ate0009 = TEST_MIGRATIONS.filter(
        (migracao) => migracao.name < "0010",
      );
      expect(ate0009.map((migracao) => migracao.name)).not.toContain(
        "0010_link_vendas.sql",
      );
      await applyD1Migrations(db, ate0009);
      // Além do que os describes anteriores gravaram: um token do webhook gravado pela tela (0009) e o líder com o
      // telefone e o e-mail, que a 0010 também não pode mexer.
      await db.batch([
        db
          .prepare(
            "INSERT INTO token_webhook (id, token_hash, gerado_em) VALUES (1, ?1, '2026-11-12T10:00:00.000Z')",
          )
          .bind("0123456789abcdef".repeat(4)),
        db.prepare(
          "UPDATE celulas SET lider_telefone = '(91) 98888-7777', lider_email = 'lider@example.com' WHERE id = 7000",
        ),
      ]);
      antes = await fotografarTodasAsTabelas(db);
      // Até a 0010: a 0011 é aplicada depois, sobre tudo isto (describe "0011 sobre dados que já existiam").
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0011"),
      );
    });

    it("a 0010 foi aplicada por último, sobre os dados (não num banco vazio)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name).at(-1)).toBe(
        "0010_link_vendas.sql",
      );
      // Duas campanhas (a ativa da 0007 e a inativa da 0008), sem a coluna nova antes da 0010.
      expect(antes.campanhas).toHaveLength(2);
      expect(antes.campanhas[0]).not.toHaveProperty("link_vendas_modelo");
      for (const tabela of [
        "usuarios",
        "links_acesso",
        "sessoes",
        "auditoria",
        "afiliados",
        "pedidos",
        "webhook_eventos",
        "token_webhook",
      ])
        expect({ tabela, vazia: antes[tabela].length === 0 }).toEqual({
          tabela,
          vazia: false,
        });
    });

    it("nenhum dado muda: toda tabela fica igual, e cada campanha ganha só link_vendas_modelo, NULL (nenhuma célula tem link)", async () => {
      const { campanhas, ...depois } = await fotografarTodasAsTabelas(db);
      const { campanhas: campanhasAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      expect(campanhas).toEqual(
        campanhasAntes.map((campanha) => ({
          ...campanha,
          link_vendas_modelo: null,
        })),
      );
      const { results: coluna } = await db
        .prepare(
          `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('campanhas')
           WHERE name = 'link_vendas_modelo'`,
        )
        .all();
      expect(coluna).toEqual([
        {
          name: "link_vendas_modelo",
          type: "TEXT",
          notnull: 0,
          dflt_value: null,
          pk: 0,
        },
      ]);
    });

    it("o CHECK: vazio e 301 caracteres recusados; NULL, 1 e 300 aceitos (o endereço e os marcadores ficam no contrato)", async () => {
      onTestFinished(apagarModelos);
      const gravar = (valor: string | null) =>
        db
          .prepare(
            "UPDATE campanhas SET link_vendas_modelo = ?1 WHERE ativa = 1",
          )
          .bind(valor)
          .run();
      for (const recusado of [
        "",
        "x".repeat(301),
        `${MODELO}${"x".repeat(301 - MODELO.length)}`,
      ])
        await expect(gravar(recusado)).rejects.toThrow(
          /CHECK constraint failed/,
        );
      expect(
        (await modelos()).map((linha) => linha.link_vendas_modelo),
      ).toEqual([null, null]);
      for (const aceito of [
        "x",
        "x".repeat(300),
        // Só o tamanho: um modelo fora das regras do contrato passa no banco (a API não grava; a montagem o ignora).
        "http://golpe.example/{afiliado}",
        MODELO,
        null,
      ]) {
        await gravar(aceito);
        expect(
          (await modelos()).find((linha) => linha.ativa === 1)
            ?.link_vendas_modelo,
        ).toBe(aceito);
      }
    });
  });

  // O "UPSERT do PUT não apaga o modelo" (RIFA-046) roda no describe da 0013: o PUT de hoje nomeia as colunas da 0012
  // (ranking_por_divisao) e da 0013 (acesso_celulas_senha), então só roda sobre o schema completo.

  // -------------------------------------------------------------------------------------------------
  // 0011 (RIFA-056): o pagamento registrado pela conferência, aplicada sobre tudo o que já existia
  // -------------------------------------------------------------------------------------------------

  describe("0011 sobre dados que já existiam (RIFA-056)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;
    let campanhaId: number;
    let recuperacaoId: number;

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram até a 0010 (aqui vale também rodando este sozinho).
      const ate0010 = TEST_MIGRATIONS.filter(
        (migracao) => migracao.name < "0011",
      );
      expect(ate0010.map((migracao) => migracao.name)).not.toContain(
        "0011_pagamento_conferencia.sql",
      );
      await applyD1Migrations(db, ate0010);
      campanhaId = (await db
        .prepare("SELECT id FROM campanhas WHERE ativa = 1")
        .first<{ id: number }>())!.id;
      const usuarioId = (await db
        .prepare("SELECT id FROM usuarios ORDER BY id LIMIT 1")
        .first<{ id: number }>())!.id;
      // Além do que os describes anteriores gravaram: uma recuperação com a venda perdida que ela gravou (0004), um
      // pedido pendente e um expirado do webhook (os casos do pagamento não registrado), de antes da 0011.
      recuperacaoId = (await db
        .prepare(
          `INSERT INTO recuperacoes (campanha_id, usuario_id, executado_em, pedidos_solicitados,
             pedidos_recuperados, bilhetes, total_centavos, linhas_arquivo, arquivo_sha256, mapeamento)
           VALUES (?1, ?2, '2026-11-12T10:00:00.000Z', 1, 1, 1, 2000, 3, ?3, '{"pedido_id":"Pedido"}')
           RETURNING id`,
        )
        .bind(campanhaId, usuarioId, "a".repeat(64))
        .first<{ id: number }>())!.id;
      await db.batch([
        db
          .prepare(
            `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, aprovado_em, origem,
               recuperacao_id)
             VALUES ('ANTES-0011-REC', ?1, 'approved', 1, 2000, '2026-11-12T09:00:00.000Z', 'conferencia', ?2)`,
          )
          .bind(campanhaId, recuperacaoId),
        db
          .prepare(
            `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos)
             VALUES ('ANTES-0011-PEND', ?1, 'in_process', 2, 4000), ('ANTES-0011-EXP', ?1, 'expired', 1, 2000)`,
          )
          .bind(campanhaId),
      ]);
      antes = await fotografarTodasAsTabelas(db);
      // Até a 0011: a 0012 e a 0013 são aplicadas depois, sobre tudo isto (os describes delas, abaixo).
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0012"),
      );
    });

    it("a 0011 foi aplicada por último, sobre os dados (não num banco vazio)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name).at(-1)).toBe(
        "0011_pagamento_conferencia.sql",
      );
      expect(antes.pedidos[0]).not.toHaveProperty("pagamento_recuperacao_id");
      for (const tabela of ["pedidos", "recuperacoes", "auditoria"])
        expect({ tabela, vazia: antes[tabela].length === 0 }).toEqual({
          tabela,
          vazia: false,
        });
    });

    it("nenhum dado muda: toda tabela fica igual, e cada pedido ganha só pagamento_recuperacao_id, NULL", async () => {
      const { pedidos, ...depois } = await fotografarTodasAsTabelas(db);
      const { pedidos: pedidosAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      expect(pedidos).toEqual(
        pedidosAntes.map((pedido) => ({
          ...pedido,
          pagamento_recuperacao_id: null,
        })),
      );
      const { results: coluna } = await db
        .prepare(
          `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('pedidos')
           WHERE name = 'pagamento_recuperacao_id'`,
        )
        .all();
      expect(coluna).toEqual([
        {
          name: "pagamento_recuperacao_id",
          type: "INTEGER",
          notnull: 0,
          dflt_value: null,
          pk: 0,
        },
      ]);
    });

    it("o CHECK e a FK: só num pedido do webhook já pago, apontando para uma recuperação que existe; a recuperação não sai com o pedido ligado", async () => {
      const marcar = (id: string, recuperacao: number | null) =>
        db
          .prepare(
            "UPDATE pedidos SET pagamento_recuperacao_id = ?1 WHERE id = ?2",
          )
          .bind(recuperacao, id)
          .run();
      onTestFinished(async () => {
        await db.batch([
          db.prepare(
            "UPDATE pedidos SET pagamento_recuperacao_id = NULL WHERE id LIKE 'ANTES-0011-%'",
          ),
          db.prepare(
            "UPDATE pedidos SET status = 'in_process', aprovado_em = NULL WHERE id = 'ANTES-0011-PEND'",
          ),
        ]);
      });
      // Pendente ou expirado (ainda não pago) e a venda perdida (origem 'conferencia'): o CHECK recusa.
      for (const id of ["ANTES-0011-PEND", "ANTES-0011-EXP", "ANTES-0011-REC"])
        await expect(marcar(id, recuperacaoId)).rejects.toThrow(
          /CHECK constraint failed/,
        );
      // Pago e marcado no mesmo UPDATE (como a gravação faz): aceito.
      await db
        .prepare(
          `UPDATE pedidos SET status = 'approved', aprovado_em = '2026-11-12T11:00:00.000Z',
             pagamento_recuperacao_id = ?1
           WHERE id = 'ANTES-0011-PEND'`,
        )
        .bind(recuperacaoId)
        .run();
      expect(
        await db
          .prepare(
            "SELECT status, origem, recuperacao_id, pagamento_recuperacao_id FROM pedidos WHERE id = 'ANTES-0011-PEND'",
          )
          .first(),
      ).toEqual({
        status: "approved",
        origem: "webhook",
        recuperacao_id: null,
        pagamento_recuperacao_id: recuperacaoId,
      });
      // Uma recuperação que não existe: a FK recusa.
      await expect(marcar("ANTES-0011-PEND", 999_999)).rejects.toThrow(
        /FOREIGN KEY constraint failed/,
      );
      // ON DELETE RESTRICT: a recuperação com o pagamento registrado não pode ser apagada (nem com a venda perdida).
      await db
        .prepare(
          "UPDATE pedidos SET recuperacao_id = NULL, origem = 'webhook' WHERE id = 'ANTES-0011-REC'",
        )
        .run();
      onTestFinished(async () => {
        await db
          .prepare(
            "UPDATE pedidos SET origem = 'conferencia', recuperacao_id = ?1 WHERE id = 'ANTES-0011-REC'",
          )
          .bind(recuperacaoId)
          .run();
      });
      await expect(
        db
          .prepare("DELETE FROM recuperacoes WHERE id = ?1")
          .bind(recuperacaoId)
          .run(),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it("o índice parcial novo serve às contagens e à lista dos pagamentos de uma recuperação", async () => {
      const plano = async (sql: string) =>
        (
          await db
            .prepare(`EXPLAIN QUERY PLAN ${sql}`)
            .bind(recuperacaoId)
            .all<{ detail: string }>()
        ).results.map((passo) => passo.detail);
      expect(
        await plano(
          "SELECT count(*), coalesce(sum(qtd_bilhetes), 0) FROM pedidos WHERE pagamento_recuperacao_id = ?1",
        ),
      ).toEqual([
        expect.stringMatching(
          /^SEARCH pedidos USING INDEX pedidos_por_pagamento_recuperado \(pagamento_recuperacao_id=\?\)$/,
        ),
      ]);
      expect(
        await plano(
          "SELECT json_group_array(id) FROM pedidos WHERE pagamento_recuperacao_id = ?1",
        ),
      ).toEqual([
        expect.stringMatching(
          /^SEARCH pedidos USING (COVERING )?INDEX pedidos_por_pagamento_recuperado \(pagamento_recuperacao_id=\?\)$/,
        ),
      ]);
    });
  });

  // -------------------------------------------------------------------------------------------------
  // 0012 (RIFA-061, D27): a opção do ranking por divisão na campanha, aplicada sobre tudo o que já existia
  // -------------------------------------------------------------------------------------------------

  describe("0012 sobre dados que já existiam (RIFA-061)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram até a 0011 (aqui vale também rodando este sozinho).
      const ate0011 = TEST_MIGRATIONS.filter(
        (migracao) => migracao.name < "0012",
      );
      expect(ate0011.map((migracao) => migracao.name)).not.toContain(
        "0012_ranking_por_divisao.sql",
      );
      await applyD1Migrations(db, ate0011);
      antes = await fotografarTodasAsTabelas(db);
      // Até a 0012: a 0013 (RIFA-064) é aplicada depois, sobre tudo isto (describe "0013 sobre dados que já existiam").
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0013"),
      );
    });

    it("a 0012 foi aplicada por último, sobre os dados (não num banco vazio)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name).at(-1)).toBe(
        "0012_ranking_por_divisao.sql",
      );
      // A ativa e a inativa, sem a coluna antes da 0012; e a hierarquia, os pedidos e a trilha que já existiam.
      expect(antes.campanhas).toHaveLength(2);
      expect(antes.campanhas[0]).not.toHaveProperty("ranking_por_divisao");
      for (const tabela of ["celulas", "redes", "pedidos", "auditoria"])
        expect({ tabela, vazia: antes[tabela].length === 0 }).toEqual({
          tabela,
          vazia: false,
        });
    });

    it("nenhum dado muda: toda tabela fica igual, e cada campanha ganha só ranking_por_divisao = 1 (separa, como sempre)", async () => {
      const { campanhas, ...depois } = await fotografarTodasAsTabelas(db);
      const { campanhas: campanhasAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      expect(campanhas).toEqual(
        campanhasAntes.map((campanha) => ({
          ...campanha,
          ranking_por_divisao: 1,
        })),
      );
      const { results: coluna } = await db
        .prepare(
          `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('campanhas')
           WHERE name = 'ranking_por_divisao'`,
        )
        .all();
      expect(coluna).toEqual([
        {
          name: "ranking_por_divisao",
          type: "INTEGER",
          notnull: 1,
          dflt_value: "1",
          pk: 0,
        },
      ]);
    });
    // O PUT (salvarCampanhaAtiva) nomeia a coluna da 0013: os testes dele rodam no describe da 0013.
  });

  // -------------------------------------------------------------------------------------------------
  // 0013 (RIFA-064, D29): a chave do login das células com a senha padrão, aplicada sobre tudo o que já existia
  // -------------------------------------------------------------------------------------------------

  describe("0013 sobre dados que já existiam (RIFA-064)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram até a 0011 (aqui vale também rodando este sozinho).
      const ate0012 = TEST_MIGRATIONS.filter(
        (migracao) => migracao.name < "0013",
      );
      expect(ate0012.map((migracao) => migracao.name)).not.toContain(
        "0013_login_celulas_senha.sql",
      );
      await applyD1Migrations(db, ate0012);
      antes = await fotografarTodasAsTabelas(db);
      // Até a 0013: a 0014 (RIFA-070), a 0015 (RIFA-073) e a 0016 (RIFA-075) são aplicadas depois, nos describes delas.
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0014"),
      );
    });

    it("a 0013 foi aplicada por último, sobre os dados (não num banco vazio)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name).at(-1)).toBe(
        "0013_login_celulas_senha.sql",
      );
      // A ativa e a inativa, sem a coluna antes da 0013; e a hierarquia, os acessos, as sessões e a trilha.
      expect(antes.campanhas.length).toBeGreaterThanOrEqual(2);
      expect(antes.campanhas[0]).not.toHaveProperty("acesso_celulas_senha");
      for (const tabela of [
        "celulas",
        "usuarios",
        "links_acesso",
        "sessoes",
        "auditoria",
      ])
        expect({ tabela, vazia: antes[tabela].length === 0 }).toEqual({
          tabela,
          vazia: false,
        });
    });

    it("nenhum dado muda: toda tabela fica igual, e cada campanha ganha só acesso_celulas_senha = 1 (ligado, o padrão)", async () => {
      const { campanhas, ...depois } = await fotografarTodasAsTabelas(db);
      const { campanhas: campanhasAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      expect(campanhas).toEqual(
        campanhasAntes.map((campanha) => ({
          ...campanha,
          acesso_celulas_senha: 1,
        })),
      );
      const { results: coluna } = await db
        .prepare(
          `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('campanhas')
           WHERE name = 'acesso_celulas_senha'`,
        )
        .all();
      expect(coluna).toEqual([
        {
          name: "acesso_celulas_senha",
          type: "INTEGER",
          notnull: 1,
          dflt_value: "1",
          pk: 0,
        },
      ]);
    });

    it("o CHECK aceita só 0 e 1", async () => {
      for (const valor of [2, -1, "sim"])
        await expect(
          db
            .prepare(
              "UPDATE campanhas SET acesso_celulas_senha = ?1 WHERE ativa = 1",
            )
            .bind(valor)
            .run(),
        ).rejects.toThrow(/CHECK constraint failed/);
      for (const valor of [0, 1])
        await db
          .prepare(
            "UPDATE campanhas SET acesso_celulas_senha = ?1 WHERE ativa = 1",
          )
          .bind(valor)
          .run();
    });
  });

  // -------------------------------------------------------------------------------------------------
  // 0016 (RIFA-075, D35): os números da rifa na campanha, aplicada sobre tudo o que já existia
  // -------------------------------------------------------------------------------------------------

  describe("0014 sobre dados que já existiam (RIFA-070)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram até a 0013 (aqui vale também rodando este sozinho).
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0014"),
      );
      antes = await fotografarTodasAsTabelas(db);
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0015"),
      );
    });

    it("a 0014 foi aplicada por último, sobre os dados (com afiliados gravados)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name).at(-1)).toBe(
        "0014_codigo_afiliado_rifei.sql",
      );
      expect(antes.afiliados.length).toBeGreaterThan(0);
      expect(antes.afiliados[0]).not.toHaveProperty("codigo_rifei");
    });

    it("nenhum dado muda: toda tabela fica igual, e cada afiliado ganha só codigo_rifei, NULL", async () => {
      const {
        afiliados,
        rifei_conexao: conexao,
        ...depois
      } = await fotografarTodasAsTabelas(db);
      const { afiliados: afiliadosAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      // A tabela nova (D32) nasce vazia: o token só chega quando o admin cola na tela.
      expect(conexao).toEqual([]);
      expect(afiliados).toEqual(
        afiliadosAntes.map((afiliado) => ({ ...afiliado, codigo_rifei: null })),
      );
    });

    it("rifei_conexao: uma linha só, o token só no formato cifrado e os instantes no formato único", async () => {
      const inserir = (
        id: number,
        cifrado: string,
        final: string,
        em: string,
      ) =>
        db
          .prepare(
            "INSERT INTO rifei_conexao (id, token_cifrado, final_token, conectado_em) VALUES (?1, ?2, ?3, ?4)",
          )
          .bind(id, cifrado, final, em)
          .run();
      const cifrado = `v1:${"A".repeat(16)}:${"B".repeat(40)}`;
      const em = "2026-11-19T12:00:00.000Z";
      await inserir(1, cifrado, "abcd", em);
      onTestFinished(async () => {
        await db.prepare("DELETE FROM rifei_conexao").run();
      });
      await expect(inserir(2, cifrado, "abcd", em)).rejects.toThrow(/CHECK/);
      await db.prepare("DELETE FROM rifei_conexao").run();
      // Token em claro (sem o "v1:"), final de outro tamanho e instante fora do formato: recusados.
      await expect(
        inserir(
          1,
          "eyJhbGciOiJIUzI1NiJ9.token-em-claro.assinatura",
          "abcd",
          em,
        ),
      ).rejects.toThrow(/CHECK/);
      await expect(inserir(1, cifrado, "abc", em)).rejects.toThrow(/CHECK/);
      await expect(inserir(1, cifrado, "abcd", "19/11/2026")).rejects.toThrow(
        /CHECK/,
      );
    });

    it("o CHECK: o código tem de 1 a 120 caracteres", async () => {
      const affiliateId = (await db
        .prepare(
          "SELECT affiliate_id FROM afiliados ORDER BY affiliate_id LIMIT 1",
        )
        .first<{ affiliate_id: number }>())!.affiliate_id;
      const gravar = (codigo: string | null) =>
        db
          .prepare(
            "UPDATE afiliados SET codigo_rifei = ?1 WHERE affiliate_id = ?2",
          )
          .bind(codigo, affiliateId)
          .run();
      onTestFinished(async () => {
        await gravar(null);
      });
      for (const codigo of ["", "x".repeat(121)])
        await expect(gravar(codigo)).rejects.toThrow(/CHECK constraint failed/);
      await gravar("lider-da-celula");
      await gravar("x".repeat(120));
    });
  });

  describe("0015 sobre dados que já existiam (RIFA-073)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;
    const SAL = "a".repeat(32);
    const HASH = "b".repeat(64);

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram até a 0013 (e a 0014, quando a RIFA-070 entrar, vem aqui).
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0015"),
      );
      antes = await fotografarTodasAsTabelas(db);
      // Só até a 0015: o describe não depende da 0014 (RIFA-070, que só soma) nem das que vierem depois.
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0016"),
      );
    });

    it("a 0015 foi aplicada sobre os dados e nada muda: só nasce a tabela senhas_admin, vazia", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name)).toContain(
        "0015_senha_admin.sql",
      );
      expect(antes.usuarios.length).toBeGreaterThan(0);
      expect(antes.sessoes.length).toBeGreaterThan(0);
      const { senhas_admin: senhas, ...depois } =
        await fotografarTodasAsTabelas(db);
      expect(depois).toEqual(antes);
      expect(senhas).toEqual([]);
    });

    // Veio do describe da 0013: a consulta da sessão lê senhas_admin (0015), então roda sobre o schema completo.
    it("o admin de antes da 0006 continua entrando depois de todas as migrações: o link e a sessão dele valem", async () => {
      expect(await buscarLinkValido(db, hash("a"), AGORA_DA_MIGRACAO)).toEqual({
        linkId: 1,
        usuario: { id: 1, nome: "Admin Antes da 0006", papel: "admin" },
        acessoLigado: true,
      });
      expect(
        await buscarLinkValido(db, hash("b"), AGORA_DA_MIGRACAO),
      ).toBeNull();
      expect(
        await buscarUsuarioDaSessao(db, hash("d"), AGORA_DA_MIGRACAO),
      ).toEqual({ id: 1, nome: "Admin Antes da 0006", papel: "admin" });
    });

    it("os CHECKs: usuário no formato, sal e hash em hex do tamanho certo, 100.000 iterações ou mais; usuário único", async () => {
      const inserir = (
        usuarioId: number,
        usuario: string,
        sal = SAL,
        hashSenha = HASH,
        iteracoes = 100_000,
      ) =>
        db
          .prepare(
            `INSERT INTO senhas_admin (usuario_id, usuario, sal, hash, iteracoes, criada_em, atualizada_em)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
          )
          .bind(
            usuarioId,
            usuario,
            sal,
            hashSenha,
            iteracoes,
            AGORA_DA_MIGRACAO,
          )
          .run();
      for (const [usuario, sal, hashSenha, iteracoes] of [
        ["Pastor", SAL, HASH, 100_000],
        ["ab", SAL, HASH, 100_000],
        [".pastor", SAL, HASH, 100_000],
        ["pastor", "a".repeat(31), HASH, 100_000],
        ["pastor", SAL, "B".repeat(64), 100_000],
        ["pastor", SAL, HASH, 99_999],
      ] as const)
        await expect(
          inserir(1, usuario, sal, hashSenha, iteracoes),
        ).rejects.toThrow(/CHECK constraint failed/);
      await inserir(1, "pastor");
      onTestFinished(async () => {
        await db.prepare("DELETE FROM senhas_admin").run();
      });
      const outro = await db
        .prepare(
          "INSERT INTO usuarios (nome, papel, criado_em) VALUES ('Outro admin', 'admin', ?1) RETURNING id",
        )
        .bind(AGORA_DA_MIGRACAO)
        .first<{ id: number }>();
      await expect(inserir(outro!.id, "pastor")).rejects.toThrow(
        /UNIQUE constraint failed/,
      );
    });
  });

  describe("0016 sobre dados que já existiam (RIFA-075)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram as anteriores (aqui vale também rodando este sozinho). Não
      // depende da 0014 e da 0015 (de outras branches): o filtro é pelo nome, antes da 0016.
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0016"),
      );
      antes = await fotografarTodasAsTabelas(db);
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0017"),
      );
    });

    it("a 0016 foi aplicada sobre os dados (com campanhas gravadas)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name)).toContain(
        "0016_bilhetes_campanha.sql",
      );
      expect(antes.campanhas.length).toBeGreaterThan(0);
      expect(antes.campanhas[0]).not.toHaveProperty("bilhetes_quantidade");
    });

    it("nenhum dado muda: cada campanha ganha só bilhetes_quantidade = 7005 e bilhetes_numero_inicial NULL (automático)", async () => {
      const { campanhas, ...depois } = await fotografarTodasAsTabelas(db);
      const { campanhas: campanhasAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      expect(campanhas).toEqual(
        campanhasAntes.map((campanha) => ({
          ...campanha,
          bilhetes_quantidade: 7005,
          bilhetes_numero_inicial: null,
        })),
      );
    });

    it("os CHECKs: quantidade inteira de 1 a 1.000.000; número inicial 0, 1 ou NULL", async () => {
      for (const sql of [
        "UPDATE campanhas SET bilhetes_quantidade = 0",
        "UPDATE campanhas SET bilhetes_quantidade = 1000001",
        "UPDATE campanhas SET bilhetes_quantidade = 10.5",
        "UPDATE campanhas SET bilhetes_numero_inicial = 2",
      ])
        await expect(db.prepare(sql).run()).rejects.toThrow(
          /CHECK constraint failed/,
        );
    });
  });

  describe("0017 sobre dados que já existiam (RIFA-076)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram as migrações até a 0016.
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0017"),
      );
      antes = await fotografarTodasAsTabelas(db);
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0018"),
      );
    });

    it("a 0017 foi aplicada sobre os pedidos que existiam; nenhum dado muda e cada pedido ganha as duas colunas em NULL", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name)).toContain(
        "0017_comprador_contato.sql",
      );
      expect(antes.pedidos.length).toBeGreaterThan(0);
      expect(antes.pedidos[0]).not.toHaveProperty("comprador_nome");
      const { pedidos, ...depois } = await fotografarTodasAsTabelas(db);
      const { pedidos: pedidosAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      expect(pedidos).toEqual(
        pedidosAntes.map((pedido) => ({
          ...pedido,
          comprador_nome: null,
          comprador_telefone: null,
        })),
      );
    });

    it("os CHECKs: nome de 1 a 120 caracteres; telefone só em E.164", async () => {
      const { id } = antes.pedidos[0] as { id: string };
      const gravar = (nome: string | null, telefone: string | null) =>
        db
          .prepare(
            "UPDATE pedidos SET comprador_nome = ?1, comprador_telefone = ?2 WHERE id = ?3",
          )
          .bind(nome, telefone, id)
          .run();
      onTestFinished(async () => {
        await gravar(null, null);
      });
      await gravar("Comprador Ficticio", "+5591900000001");
      await gravar("x".repeat(120), "+1415555");
      for (const [nome, telefone] of [
        ["   ", null],
        ["x".repeat(121), null],
        [null, "5591900000001"],
        [null, "+0591900000001"],
        [null, "+55 91 90000-0001"],
        [null, "+55919000000011234"],
        [null, "+5591"],
      ] as const)
        await expect(gravar(nome, telefone)).rejects.toThrow(
          /CHECK constraint failed/,
        );
    });
  });

  describe("0018 sobre dados que já existiam (RIFA-084, D39)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram as migrações até a 0017.
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0018"),
      );
      antes = await fotografarTodasAsTabelas(db);
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0019"),
      );
    });

    it("a 0018 foi aplicada sobre tudo o que existia: nada muda, cada discipulador fica sem grupo e os 4 grupos nascem na ordem", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name)).toContain("0018_grupos.sql");
      expect(antes).not.toHaveProperty("grupos");
      expect(antes.discipuladores.length).toBeGreaterThan(0);
      const { discipuladores, grupos, ...depois } =
        await fotografarTodasAsTabelas(db);
      const { discipuladores: discipuladoresAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      expect(discipuladores).toEqual(
        discipuladoresAntes.map((discipulador) => ({
          ...discipulador,
          grupo_id: null,
        })),
      );
      expect(
        grupos.map(({ id, nome, ordem }) => ({ id, nome, ordem })),
      ).toEqual([
        { id: 1, nome: "Adultos da manhã", ordem: 1 },
        { id: 2, nome: "Adultos da noite", ordem: 2 },
        { id: 3, nome: "Jovens", ordem: 3 },
        { id: 4, nome: "Adolescentes", ordem: 4 },
      ]);
    });

    it("o CHECK e o UNIQUE do nome: de 1 a 60 caracteres, sem repetir (sem diferenciar maiúsculas)", async () => {
      const inserir = (nome: string) =>
        db
          .prepare("INSERT INTO grupos (nome, ordem) VALUES (?1, 9)")
          .bind(nome)
          .run();
      onTestFinished(async () => {
        await db.prepare("DELETE FROM grupos WHERE ordem = 9").run();
      });
      await inserir("x".repeat(60));
      for (const nome of ["", "   ", "x".repeat(61)])
        await expect(inserir(nome)).rejects.toThrow(/CHECK constraint failed/);
      await expect(inserir("JOVENS")).rejects.toThrow(
        /UNIQUE constraint failed/,
      );
    });

    it("o grupo_id aponta para um grupo que existe; apagar o grupo deixa o discipulador sem grupo (SET NULL), sem apagá-lo", async () => {
      const { id } = antes.discipuladores[0] as { id: number };
      const grupoDoDiscipulador = async () =>
        (
          await db
            .prepare("SELECT grupo_id FROM discipuladores WHERE id = ?1")
            .bind(id)
            .first<{ grupo_id: number | null }>()
        )?.grupo_id;
      onTestFinished(async () => {
        await db.batch([
          db
            .prepare("UPDATE discipuladores SET grupo_id = NULL WHERE id = ?1")
            .bind(id),
          db.prepare(
            "INSERT OR IGNORE INTO grupos (id, nome, ordem) VALUES (4, 'Adolescentes', 4)",
          ),
        ]);
      });
      await expect(
        db
          .prepare("UPDATE discipuladores SET grupo_id = 999 WHERE id = ?1")
          .bind(id)
          .run(),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
      await db
        .prepare("UPDATE discipuladores SET grupo_id = 4 WHERE id = ?1")
        .bind(id)
        .run();
      expect(await grupoDoDiscipulador()).toBe(4);
      await db.prepare("DELETE FROM grupos WHERE id = 4").run();
      expect(await grupoDoDiscipulador()).toBeNull();
    });
  });

  describe("0019 sobre dados que já existiam (RIFA-085, adendo da D39)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram as migrações até a 0018.
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0019"),
      );
      // Um discipulador com grupo antes da 0019: as células dele continuam herdando (o grupo próprio nasce NULL).
      const { id } = (await db
        .prepare("SELECT id FROM discipuladores ORDER BY id LIMIT 1")
        .first<{ id: number }>())!;
      await db
        .prepare("UPDATE discipuladores SET grupo_id = 3 WHERE id = ?1")
        .bind(id)
        .run();
      antes = await fotografarTodasAsTabelas(db);
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0020"),
      );
    });

    it("a 0019 foi aplicada sobre tudo o que existia: nada muda e cada célula fica sem grupo próprio (herda o do discipulador)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name)).toContain(
        "0019_grupo_da_celula.sql",
      );
      expect(antes.celulas.length).toBeGreaterThan(0);
      expect(antes.celulas[0]).not.toHaveProperty("grupo_id");
      const { celulas, ...depois } = await fotografarTodasAsTabelas(db);
      const { celulas: celulasAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      expect(celulas).toEqual(
        celulasAntes.map((celula) => ({ ...celula, grupo_id: null })),
      );
      // O discipulador com grupo continua com ele (a coluna nova é só da célula).
      expect(
        (depois.discipuladores as { grupo_id: number | null }[]).some(
          (discipulador) => discipulador.grupo_id === 3,
        ),
      ).toBe(true);
    });

    it("o grupo_id da célula aponta para um grupo que existe; apagar o grupo deixa a célula herdando (SET NULL), sem apagá-la", async () => {
      const { id } = antes.celulas[0] as { id: number };
      const grupoDaCelula = async () =>
        (
          await db
            .prepare("SELECT grupo_id FROM celulas WHERE id = ?1")
            .bind(id)
            .first<{ grupo_id: number | null }>()
        )?.grupo_id;
      onTestFinished(async () => {
        await db.batch([
          db
            .prepare("UPDATE celulas SET grupo_id = NULL WHERE id = ?1")
            .bind(id),
          db.prepare(
            "INSERT OR IGNORE INTO grupos (id, nome, ordem) VALUES (4, 'Adolescentes', 4)",
          ),
        ]);
      });
      await expect(
        db
          .prepare("UPDATE celulas SET grupo_id = 999 WHERE id = ?1")
          .bind(id)
          .run(),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
      await db
        .prepare("UPDATE celulas SET grupo_id = 4 WHERE id = ?1")
        .bind(id)
        .run();
      expect(await grupoDaCelula()).toBe(4);
      const quantas = async () =>
        (await db
          .prepare("SELECT count(*) AS n FROM celulas")
          .first<{ n: number }>())!.n;
      const total = await quantas();
      await db.prepare("DELETE FROM grupos WHERE id = 4").run();
      expect(await grupoDaCelula()).toBeNull();
      expect(await quantas()).toBe(total);
    });
  });

  describe("0020 sobre dados que já existiam (RIFA-088, D41)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;
    let campanhaId: number;
    let celulaA: number;
    let celulaB: number;
    /** Um afiliado vinculado a uma célula (para a regra "a do afiliado vence") e um não vinculado. */
    const AFILIADO_COM_CELULA = 8_020_001;
    const AFILIADO_SEM_CELULA = 8_020_002;

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram as migrações até a 0019.
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0020"),
      );
      campanhaId = (await db
        .prepare("SELECT id FROM campanhas ORDER BY ativa DESC, id LIMIT 1")
        .first<{ id: number }>())!.id;
      const celulas = (
        await db
          .prepare("SELECT id FROM celulas ORDER BY id LIMIT 2")
          .all<{ id: number }>()
      ).results;
      [celulaA, celulaB] = celulas.map((linha) => linha.id);
      // Antes da 0020: um pedido aprovado sem afiliado, um de afiliado não vinculado e um de afiliado com célula.
      await db.batch([
        db
          .prepare(
            `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em) VALUES
             (?1, ?2, 'manual', '2026-12-01T10:00:00.000Z'), (?3, NULL, 'webhook', NULL)`,
          )
          .bind(AFILIADO_COM_CELULA, celulaB, AFILIADO_SEM_CELULA),
        db
          .prepare(
            `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em)
             VALUES ('ANTES-0020-SEM', ?1, NULL, 'approved', 3, 6000, '2026-12-01T13:00:00.000Z'),
                    ('ANTES-0020-ORFAO', ?1, ?2, 'approved', 2, 4000, '2026-12-01T14:00:00.000Z'),
                    ('ANTES-0020-COM', ?1, ?3, 'approved', 1, 2000, '2026-12-01T15:00:00.000Z')`,
          )
          .bind(campanhaId, AFILIADO_SEM_CELULA, AFILIADO_COM_CELULA),
      ]);
      antes = await fotografarTodasAsTabelas(db);
      // Até a 0020: a 0021 (RIFA-094) é aplicada depois, sobre tudo isto (describe "0021 sobre dados que já existiam").
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0021"),
      );
    });

    const atribuir = (
      id: string,
      celula: number | null,
      por: number | null = 1,
    ) =>
      db
        .prepare(
          `UPDATE pedidos SET celula_atribuida_id = ?2,
             celula_atribuida_em = CASE WHEN ?2 IS NULL THEN NULL ELSE '2026-12-02T12:00:00.000Z' END,
             celula_atribuida_por = ?3
           WHERE id = ?1`,
        )
        .bind(id, celula, celula === null ? null : por)
        .run();

    const naView = async (id: string) =>
      (
        await db
          .prepare(
            "SELECT celula_id, discipulador_id FROM vendas_aprovadas WHERE pedido_id = ?1",
          )
          .bind(id)
          .first<{ celula_id: number | null; discipulador_id: number | null }>()
      )?.celula_id;

    it("a 0020 foi aplicada sobre tudo o que existia: nada muda e cada pedido fica sem célula atribuída (as três colunas nulas)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name)).toContain(
        "0020_celula_atribuida.sql",
      );
      expect(antes.pedidos.length).toBeGreaterThan(3);
      expect(antes.pedidos[0]).not.toHaveProperty("celula_atribuida_id");
      const { pedidos, ...depois } = await fotografarTodasAsTabelas(db);
      const { pedidos: pedidosAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      expect(pedidos).toEqual(
        pedidosAntes.map((pedido) => ({
          ...pedido,
          celula_atribuida_id: null,
          celula_atribuida_em: null,
          celula_atribuida_por: null,
        })),
      );
    });

    it("o CHECK: as três colunas andam juntas, o instante no formato da API e os ids inteiros", async () => {
      onTestFinished(async () => {
        await atribuir("ANTES-0020-SEM", null);
      });
      const gravar = (id: unknown, em: unknown, por: unknown) =>
        db
          .prepare(
            `UPDATE pedidos SET celula_atribuida_id = ?1, celula_atribuida_em = ?2, celula_atribuida_por = ?3
             WHERE id = 'ANTES-0020-SEM'`,
          )
          .bind(id, em, por)
          .run();
      const em = "2026-12-02T12:00:00.000Z";
      for (const [id, quando, por] of [
        [celulaA, null, null],
        [celulaA, em, null],
        [celulaA, null, 1],
        [null, em, 1],
        [null, null, 1],
        [null, em, null],
        [celulaA, "2026-12-02 12:00", 1],
        [celulaA, em, 1.5],
      ] as const)
        await expect(gravar(id, quando, por)).rejects.toThrow(
          /CHECK constraint failed/,
        );
      await gravar(celulaA, em, 1);
      await gravar(null, null, null);
    });

    it("a célula atribuída aponta para uma célula que existe, e a célula com venda atribuída não sai (FK RESTRICT)", async () => {
      onTestFinished(async () => {
        await atribuir("ANTES-0020-SEM", null);
      });
      await expect(atribuir("ANTES-0020-SEM", 999_999)).rejects.toThrow(
        /FOREIGN KEY constraint failed/,
      );
      await atribuir("ANTES-0020-SEM", celulaA);
      await expect(
        db.prepare("DELETE FROM celulas WHERE id = ?1").bind(celulaA).run(),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
      expect(
        (await db
          .prepare("SELECT count(*) AS n FROM celulas WHERE id = ?1")
          .bind(celulaA)
          .first<{ n: number }>())!.n,
      ).toBe(1);
    });

    it("a view e o painel usam a célula efetiva: a atribuída no pedido sem célula pelo afiliado; a do afiliado vence", async () => {
      onTestFinished(async () => {
        await atribuir("ANTES-0020-SEM", null);
        await atribuir("ANTES-0020-ORFAO", null);
        await atribuir("ANTES-0020-COM", null);
      });
      expect(await naView("ANTES-0020-SEM")).toBeNull();
      await atribuir("ANTES-0020-SEM", celulaA);
      await atribuir("ANTES-0020-ORFAO", celulaA);
      // Gravada à mão no banco num pedido de afiliado com célula: não conta (a API nem aceita, 409).
      await atribuir("ANTES-0020-COM", celulaA);
      expect(await naView("ANTES-0020-SEM")).toBe(celulaA);
      expect(await naView("ANTES-0020-ORFAO")).toBe(celulaA);
      expect(await naView("ANTES-0020-COM")).toBe(celulaB);
      const { results } = await db
        .prepare(SELECIONAR_VENDAS_POR_DIA_UTC_MENOS_3)
        .bind(campanhaId)
        .all<{ celula_id: number | null; dia: string; bilhetes: number }>();
      const doDia = results.filter((linha) => linha.dia === "2026-12-01");
      expect(
        doDia.find((linha) => linha.celula_id === celulaA)?.bilhetes,
      ).toBeGreaterThanOrEqual(5);
      expect(
        doDia.find((linha) => linha.celula_id === celulaB)?.bilhetes,
      ).toBeGreaterThanOrEqual(1);
    });

    it("os índices: o da 0003 recriado com a célula atribuída depois do afiliado (o painel no índice de cobertura) e o parcial da célula atribuída", async () => {
      const definicao = async (indice: string) =>
        (
          await db
            .prepare(
              "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
            )
            .bind(indice)
            .first<{ sql: string }>()
        )?.sql.replace(/\s+/g, " ");
      expect(await definicao("pedidos_aprovados_por_afiliado_dia")).toMatch(
        /\( ?campanha_id, affiliate_id, celula_atribuida_id, date\(aprovado_em, '-180 minutes'\), aprovado_em, qtd_bilhetes, total_centavos, desconsiderado_em \) WHERE status = 'approved' AND desconsiderado_em IS NULL$/,
      );
      expect(await definicao("pedidos_por_celula_atribuida")).toMatch(
        /ON pedidos \(celula_atribuida_id\) WHERE celula_atribuida_id IS NOT NULL$/,
      );
      const { results } = await db
        .prepare(`EXPLAIN QUERY PLAN ${SELECIONAR_VENDAS_POR_DIA_UTC_MENOS_3}`)
        .bind(campanhaId)
        .all<{ detail: string }>();
      const plano = results.map((linha) => linha.detail);
      expect(plano).toContain(
        "SEARCH pedidos USING COVERING INDEX pedidos_aprovados_por_afiliado_dia (campanha_id=?)",
      );
      // A única B-tree temporária é a do agrupamento final por célula (o GROUP BY de dentro segue o índice).
      expect(
        plano.filter((passo) => passo.includes("TEMP B-TREE")),
      ).toHaveLength(1);
    });
  });

  describe("0021 sobre dados que já existiam (RIFA-094, D42)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;
    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram as migrações até a 0020.
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0021"),
      );
      antes = await fotografarTodasAsTabelas(db);
      // Até a 0021: a 0022 (RIFA-095) é aplicada depois, sobre tudo isto (describe "0022 sobre dados que já existiam").
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0022"),
      );
    });

    it("a 0021 foi aplicada sobre os dados: nada muda e cada campanha ganha só publico_avisos_de_venda = 1 (ligada)", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name)).toContain(
        "0021_avisos_de_venda.sql",
      );
      expect(antes.campanhas.length).toBeGreaterThan(0);
      expect(antes.campanhas[0]).not.toHaveProperty("publico_avisos_de_venda");
      const { campanhas, ...depois } = await fotografarTodasAsTabelas(db);
      const { campanhas: campanhasAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      expect(campanhas).toEqual(
        campanhasAntes.map((campanha) => ({
          ...campanha,
          publico_avisos_de_venda: 1,
        })),
      );
    });

    it("o CHECK: só 0 ou 1", async () => {
      for (const valor of [2, -1])
        await expect(
          db
            .prepare("UPDATE campanhas SET publico_avisos_de_venda = ?1")
            .bind(valor)
            .run(),
        ).rejects.toThrow(/CHECK constraint failed/);
    });
  });

  describe("0022 sobre dados que já existiam (RIFA-095, D43)", () => {
    const db = DB_MIGRACAO;
    let antes: Record<string, Record<string, unknown>[]>;
    // RIFA-046 (veio do describe da 0016 e, na RIFA-095, do da 0021): o modelo do link de vendas, que o PUT de hoje não apaga.
    const MODELO = "https://rifei.com.br/{slug}?afiliado={afiliado}";

    const modelos = async () =>
      (
        await db
          .prepare(
            "SELECT id, ativa, link_vendas_modelo FROM campanhas ORDER BY id",
          )
          .all<{
            id: number;
            ativa: number;
            link_vendas_modelo: string | null;
          }>()
      ).results;
    const apagarModelos = async () => {
      await db.prepare("UPDATE campanhas SET link_vendas_modelo = NULL").run();
    };

    beforeAll(async () => {
      // Idempotente: os describes anteriores já aplicaram as migrações de antes da 0022.
      await applyD1Migrations(
        db,
        TEST_MIGRATIONS.filter((migracao) => migracao.name < "0022"),
      );
      antes = await fotografarTodasAsTabelas(db);
      await applyD1Migrations(db, TEST_MIGRATIONS);
    });

    it("a 0022 foi aplicada sobre tudo o que existia: nada muda, cada campanha fica com as notificações ligadas e a tabela nova vem vazia", async () => {
      const { results } = await db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>();
      expect(results.map((linha) => linha.name)).toContain(
        "0022_notificacoes_push.sql",
      );
      expect(antes.campanhas.length).toBeGreaterThan(0);
      expect(antes.campanhas[0]).not.toHaveProperty("notificacoes_vendas");
      expect(antes).not.toHaveProperty("push_inscricoes");
      const { campanhas, push_inscricoes, ...depois } =
        await fotografarTodasAsTabelas(db);
      const { campanhas: campanhasAntes, ...resto } = antes;
      expect(depois).toEqual(resto);
      expect(campanhas).toEqual(
        campanhasAntes.map((campanha) => ({
          ...campanha,
          notificacoes_vendas: 1,
        })),
      );
      expect(push_inscricoes).toEqual([]);
    });

    it("push_inscricoes: o endpoint https e único, as chaves no formato, a origem e as falhas pelos CHECKs; a opção só 0 ou 1", async () => {
      const p256dh = `B${"A".repeat(86)}`;
      const auth = "A".repeat(22);
      const inserir = (
        endpoint: string,
        chave = p256dh,
        segredo = auth,
        origem = "publico",
        falhas = 0,
      ) =>
        db
          .prepare(
            `INSERT INTO push_inscricoes (endpoint, p256dh, auth, origem, criado_em, falhas)
             VALUES (?1, ?2, ?3, ?4, '2026-11-27T12:00:00.000Z', ?5)`,
          )
          .bind(endpoint, chave, segredo, origem, falhas)
          .run();
      const valido = "https://fcm.googleapis.com/fcm/send/ficticio-0022";
      await inserir(valido);
      await expect(inserir(valido)).rejects.toThrow(/UNIQUE constraint failed/);
      for (const recusado of [
        () => inserir("http://fcm.googleapis.com/fcm/send/x"),
        () => inserir(`https://${"a".repeat(2048)}`),
        () => inserir(`${valido}-2`, p256dh.slice(1)),
        () => inserir(`${valido}-3`, `${p256dh.slice(1)}+`),
        () => inserir(`${valido}-4`, p256dh, `${auth.slice(1)}/`),
        () => inserir(`${valido}-5`, p256dh, auth, "telao"),
        () => inserir(`${valido}-6`, p256dh, auth, "minha", -1),
        () =>
          db
            .prepare(
              `INSERT INTO push_inscricoes (endpoint, p256dh, auth, origem, criado_em)
               VALUES ('https://fcm.googleapis.com/x7', ?1, ?2, 'minha', '27/11/2026')`,
            )
            .bind(p256dh, auth)
            .run(),
        () => db.prepare("UPDATE campanhas SET notificacoes_vendas = 2").run(),
      ])
        await expect(recusado()).rejects.toThrow(/CHECK constraint failed/);
      await db.prepare("DELETE FROM push_inscricoes").run();
    });

    // RIFA-061 (veio do describe da 0012, depois da 0016 e da 0021): o PUT de hoje nomeia as colunas da 0021 (RIFA-094) e
    // da 0022 (RIFA-095), então roda sobre o schema completo, aqui.
    it("a campanha que já existia sai com o ranking por divisão ligado; o PUT sem a opção mantém, com a opção grava", async () => {
      const ativa = async () =>
        (await db
          .prepare(
            "SELECT ranking_por_divisao, ranking_criterio FROM campanhas WHERE ativa = 1",
          )
          .first<{ ranking_por_divisao: number; ranking_criterio: string }>())!;
      const linha = antes.campanhas.find((campanha) => campanha.ativa === 1)!;
      onTestFinished(async () => {
        await db
          .prepare(
            "UPDATE campanhas SET ranking_por_divisao = 1, ranking_criterio = ?1 WHERE ativa = 1",
          )
          .bind(linha.ranking_criterio)
          .run();
      });
      expect(await ativa()).toEqual({
        ranking_por_divisao: 1,
        ranking_criterio: linha.ranking_criterio,
      });
      const dados = campanhaEntradaSchema.parse({
        nome: "Campanha Depois da 0012",
        slug_rifei: linha.slug_rifei,
        data_inicio: "2026-11-23",
        preco_bilhete_centavos: 2000,
        meta: { unidade: "bilhetes", regra: "fixa_por_celula", valor: 50 },
        periodos: [{ nome: "Única", dias: 24, percentual_bp: 10_000 }],
        ranking: { criterio: "bilhetes", por_divisao: false },
      });
      const desligada = await salvarCampanhaAtiva(db, dados);
      expect(desligada.ok && desligada.campanha.ranking).toEqual({
        criterio: "bilhetes",
        por_divisao: false,
      });
      // Sem a opção no corpo (uma aba antiga): o gravado fica.
      const semOpcao = await salvarCampanhaAtiva(db, {
        ...dados,
        ranking: { criterio: "percentual_meta" },
      });
      expect(semOpcao.ok && semOpcao.campanha.ranking).toEqual({
        criterio: "percentual_meta",
        por_divisao: false,
      });
      expect((await ativa()).ranking_por_divisao).toBe(0);
      await expect(
        db.prepare("UPDATE campanhas SET ranking_por_divisao = 2").run(),
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it("o UPSERT do PUT da campanha (salvarCampanhaAtiva, que nomeia as colunas) não apaga o modelo, com e sem os grupos do admin", async () => {
      onTestFinished(apagarModelos);
      await db
        .prepare("UPDATE campanhas SET link_vendas_modelo = ?1 WHERE ativa = 1")
        .bind(MODELO)
        .run();
      const dados = {
        nome: "Campanha Depois da 0013",
        slug_rifei: "campanha-depois-da-0013",
        data_inicio: "2026-11-23",
        preco_bilhete_centavos: 2000,
        meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
        periodos: [{ nome: "Período 1", dias: 21, percentual_bp: 10000 }],
        ranking: { criterio: "percentual_meta" },
        publico: { mostra_percentual_meta: false, limite_ranking: 3 },
      };
      for (const corpo of [
        campanhaEntradaSchema.parse(dados),
        // Com os grupos do admin (o PUT do admin): o UPSERT também não nomeia o modelo.
        campanhaEntradaSchema.parse({
          ...dados,
          slug_rifei: "campanha-depois-da-0013-b",
          pedidos: PEDIDOS_PADRAO,
          acesso: ACESSO_PADRAO,
          mensagens: MENSAGENS_PADRAO,
        }),
      ]) {
        const salvo = await salvarCampanhaAtiva(db, corpo);
        expect(salvo.ok && salvo.campanha.slug_rifei).toBe(corpo.slug_rifei);
        expect(
          (await modelos()).find((linha) => linha.ativa === 1)
            ?.link_vendas_modelo,
        ).toBe(MODELO);
      }
    });
  });

  // -------------------------------------------------------------------------------------------------
  // 0015 (RIFA-073, D33): a senha de login do admin, uma tabela nova aplicada sobre tudo o que já existia
  // -------------------------------------------------------------------------------------------------

  // -------------------------------------------------------------------------------------------------
  // 0014 (RIFA-070, D32): o código do afiliado na Rifei, aplicada sobre tudo o que já existia
  // -------------------------------------------------------------------------------------------------
});
