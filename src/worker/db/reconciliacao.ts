/**
 * Conferência pelo CSV da Rifei (RIFA-012; docs/api.md e docs/integracao-rifei.md, seção 10): o que a
 * análise lê do banco, a gravação do "Recuperar" e a lista das recuperações feitas (auditoria).
 *
 * Nada do arquivo chega aqui além do pedido recuperado (código, quantidade, números dos bilhetes, valor,
 * afiliado e instante) e, na auditoria, o SHA-256 do arquivo e os nomes das colunas usadas (D1).
 *
 * Gravação (um único db.batch, que o D1 roda numa transação: tudo ou nada):
 * 1. a linha da auditoria em `recuperacoes`;
 * 2. os afiliados novos (fila de órfãos, como os do webhook: origem 'webhook' = apareceu numa venda);
 * 3. os pedidos, com INSERT ... ON CONFLICT (id) DO NOTHING: um pedido que já existe (inclusive um que o
 *    webhook gravou depois da pré-visualização) nunca é sobrescrito, e repetir a mesma recuperação não
 *    duplica nada (idempotente). Cada pedido leva `origem = 'conferencia'` e o id da auditoria;
 * 4. as contagens da auditoria, tiradas dos pedidos que de fato entraram;
 * 5. a lista desses pedidos;
 * 6. se nada entrou, a auditoria é apagada (não houve mudança a registrar).
 * O id da auditoria é o maior de `recuperacoes` dentro do lote: o D1 serializa as escritas, então nenhuma
 * outra gravação entra no meio da transação.
 */
import type { Recuperacao } from "../../shared/contracts";
import type {
  AfiliadoGravado,
  PedidoAGravar,
  PedidoGravado,
} from "../lib/conferencia-analise";

const SELECIONAR_PEDIDOS = `
  SELECT id, campanha_id, status, qtd_bilhetes, total_centavos, affiliate_id, aprovado_em, origem
  FROM pedidos`;

const SELECIONAR_AFILIADOS = `
  SELECT a.affiliate_id, a.rotulo, a.celula_id, c.nome AS celula_nome
  FROM afiliados AS a
  LEFT JOIN celulas AS c ON c.id = a.celula_id`;

/** Tudo o que a análise compara: os pedidos (de todas as campanhas) e os afiliados com a célula. */
export async function lerDadosDaConferencia(db: D1Database): Promise<{
  pedidos: PedidoGravado[];
  afiliados: AfiliadoGravado[];
}> {
  const [pedidos, afiliados] = await db.batch([
    db.prepare(SELECIONAR_PEDIDOS),
    db.prepare(SELECIONAR_AFILIADOS),
  ]);
  return {
    pedidos: pedidos.results as unknown as PedidoGravado[],
    afiliados: afiliados.results as unknown as AfiliadoGravado[],
  };
}

/** Para o "Recuperar": quais dos códigos já existem (em qualquer campanha) e os afiliados. */
export async function lerParaRecuperar(
  db: D1Database,
  codigos: readonly string[],
): Promise<{ existentes: Set<string>; afiliados: AfiliadoGravado[] }> {
  const [existentes, afiliados] = await db.batch([
    db
      .prepare(
        "SELECT id FROM pedidos WHERE id IN (SELECT value FROM json_each(?1))",
      )
      .bind(JSON.stringify(codigos)),
    db.prepare(SELECIONAR_AFILIADOS),
  ]);
  return {
    existentes: new Set(
      (existentes.results as { id: string }[]).map((linha) => linha.id),
    ),
    afiliados: afiliados.results as unknown as AfiliadoGravado[],
  };
}

export interface GravacaoRecuperacao {
  campanhaId: number;
  usuarioId: number;
  executadoEm: string;
  pedidosSolicitados: number;
  linhasArquivo: number;
  arquivoSha256: string;
  /** Nome da coluna usada em cada campo. */
  colunas: Record<string, string | null>;
  pedidos: readonly PedidoAGravar[];
}

/** Tamanho máximo (em caracteres) do JSON de pedidos num comando: o D1 limita o tamanho de um valor. */
const LIMITE_JSON_POR_COMANDO = 400_000;

/** Os pedidos em pedaços de JSON pequenos o bastante para um parâmetro do D1. */
function pedacosDePedidos(pedidos: readonly PedidoAGravar[]): string[] {
  const pedacos: string[] = [];
  let atual: string[] = [];
  let tamanho = 0;
  for (const pedido of pedidos) {
    const json = JSON.stringify({
      id: pedido.pedido_id,
      afiliado: pedido.affiliate_id,
      bilhetes: pedido.qtd_bilhetes,
      numeros: pedido.numeros,
      centavos: pedido.total_centavos,
      aprovado_em: pedido.aprovado_em,
    });
    if (atual.length > 0 && tamanho + json.length > LIMITE_JSON_POR_COMANDO) {
      pedacos.push(`[${atual.join(",")}]`);
      atual = [];
      tamanho = 0;
    }
    atual.push(json);
    tamanho += json.length + 1;
  }
  if (atual.length > 0) pedacos.push(`[${atual.join(",")}]`);
  return pedacos;
}

const ID_DA_RECUPERACAO = "(SELECT max(id) FROM recuperacoes)";

/**
 * Grava a recuperação num lote só (veja o topo do arquivo). Devolve o id da auditoria (null se nada
 * entrou) e os códigos que de fato foram gravados.
 */
export async function gravarRecuperacao(
  db: D1Database,
  gravacao: GravacaoRecuperacao,
): Promise<{ recuperacaoId: number | null; gravados: Set<string> }> {
  const afiliados = [
    ...new Set(
      gravacao.pedidos.flatMap((pedido) =>
        pedido.affiliate_id === null ? [] : [pedido.affiliate_id],
      ),
    ),
  ];
  const comandos: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO recuperacoes (campanha_id, usuario_id, executado_em, pedidos_solicitados,
           linhas_arquivo, arquivo_sha256, mapeamento)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        gravacao.campanhaId,
        gravacao.usuarioId,
        gravacao.executadoEm,
        gravacao.pedidosSolicitados,
        gravacao.linhasArquivo,
        gravacao.arquivoSha256,
        JSON.stringify(gravacao.colunas),
      ),
    db
      .prepare(
        `INSERT INTO afiliados (affiliate_id, origem, criado_em, atualizado_em)
         SELECT DISTINCT value, 'webhook', ?2, ?2 FROM json_each(?1) WHERE true
         ON CONFLICT (affiliate_id) DO NOTHING`,
      )
      .bind(JSON.stringify(afiliados), gravacao.executadoEm),
    ...pedacosDePedidos(gravacao.pedidos).map((pedaco) =>
      db
        .prepare(
          `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, numeros,
             total_centavos, aprovado_em, registrado_em, atualizado_em, origem, recuperacao_id)
           SELECT json_extract(j.value, '$.id'), ?1, json_extract(j.value, '$.afiliado'), 'approved',
             json_extract(j.value, '$.bilhetes'), json_extract(j.value, '$.numeros'),
             json_extract(j.value, '$.centavos'), json_extract(j.value, '$.aprovado_em'), ?2, ?2,
             'conferencia', ${ID_DA_RECUPERACAO}
           FROM json_each(?3) AS j WHERE true
           ON CONFLICT (id) DO NOTHING`,
        )
        .bind(gravacao.campanhaId, gravacao.executadoEm, pedaco),
    ),
    db.prepare(
      `UPDATE recuperacoes SET
         pedidos_recuperados = (SELECT count(*) FROM pedidos WHERE recuperacao_id = recuperacoes.id),
         bilhetes = (SELECT coalesce(sum(qtd_bilhetes), 0) FROM pedidos
           WHERE recuperacao_id = recuperacoes.id),
         total_centavos = (SELECT coalesce(sum(total_centavos), 0) FROM pedidos
           WHERE recuperacao_id = recuperacoes.id)
       WHERE id = ${ID_DA_RECUPERACAO}
       RETURNING id, pedidos_recuperados`,
    ),
    db.prepare(
      `SELECT id FROM pedidos WHERE recuperacao_id = ${ID_DA_RECUPERACAO} ORDER BY id`,
    ),
    db.prepare(
      `DELETE FROM recuperacoes WHERE id = ${ID_DA_RECUPERACAO} AND pedidos_recuperados = 0`,
    ),
  ];
  const resultados = await db.batch(comandos);
  const contagem = resultados[resultados.length - 3].results[0] as
    { id: number; pedidos_recuperados: number } | undefined;
  const gravados = new Set(
    (resultados[resultados.length - 2].results as { id: string }[]).map(
      (linha) => linha.id,
    ),
  );
  return {
    recuperacaoId:
      contagem !== undefined && contagem.pedidos_recuperados > 0
        ? contagem.id
        : null,
    gravados,
  };
}

interface LinhaRecuperacao {
  id: number;
  executado_em: string;
  usuario_id: number;
  usuario: string;
  pedidos_solicitados: number;
  pedidos_recuperados: number;
  bilhetes: number;
  total_centavos: number;
  linhas_arquivo: number;
  arquivo_sha256: string;
  mapeamento: string;
  pedidos: string;
}

const CAMPOS_DAS_COLUNAS = [
  "pedido_id",
  "status",
  "qtd_bilhetes",
  "bilhetes",
  "valor",
  "afiliado",
  "data",
] as const;

/** As recuperações feitas, da mais recente para a mais antiga, com quem fez e os pedidos gravados. */
export async function listarRecuperacoes(
  db: D1Database,
): Promise<Recuperacao[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.executado_em, r.usuario_id, u.nome AS usuario, r.pedidos_solicitados,
         r.pedidos_recuperados, r.bilhetes, r.total_centavos, r.linhas_arquivo, r.arquivo_sha256,
         r.mapeamento,
         (SELECT json_group_array(p.id) FROM pedidos AS p WHERE p.recuperacao_id = r.id) AS pedidos
       FROM recuperacoes AS r
       JOIN usuarios AS u ON u.id = r.usuario_id
       ORDER BY r.id DESC`,
    )
    .all<LinhaRecuperacao>();
  return results.map((linha) => {
    const mapeamento = JSON.parse(linha.mapeamento) as Record<string, unknown>;
    const colunas = Object.fromEntries(
      CAMPOS_DAS_COLUNAS.map((campo) => {
        const nome = mapeamento[campo];
        return [campo, typeof nome === "string" && nome !== "" ? nome : null];
      }),
    ) as Recuperacao["colunas"];
    return {
      id: linha.id,
      executado_em: linha.executado_em,
      usuario: { id: linha.usuario_id, nome: linha.usuario },
      pedidos_solicitados: linha.pedidos_solicitados,
      pedidos_recuperados: linha.pedidos_recuperados,
      bilhetes: linha.bilhetes,
      total_centavos: linha.total_centavos,
      linhas_arquivo: linha.linhas_arquivo,
      arquivo_sha256: linha.arquivo_sha256,
      colunas,
      pedidos: (JSON.parse(linha.pedidos) as string[]).sort(),
    };
  });
}
