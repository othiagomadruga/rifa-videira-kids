/**
 * Trilha de auditoria (RIFA-013b; migrations/0005_auditoria.sql): quem (o usuário da sessão), quando, a
 * ação, o alvo e um resumo SEM dados pessoais. Leitura: GET /api/admin/auditoria (só admin).
 *
 * O registro vai no MESMO db.batch da ação (uma transação do D1): se a ação falha, o registro também não
 * fica; se a ação acontece, ele fica junto. As ações que podem ser recusadas dentro do lote (vínculo com
 * célula inexistente, desativar o último admin...) levam uma condição que repete a da gravação.
 */
import type {
  AcaoAuditoria,
  ConsultaAuditoria,
  RespostaAuditoria,
} from "../../shared/contracts";

/** Quem fez e quando: o que a rota sabe (o usuário vem de `c.var.usuario`). */
export interface Autoria {
  usuarioId: number;
  /** Instante UTC ISO com milissegundos. */
  em: string;
}

/**
 * Alvo pronto ("afiliado:1042", "hierarquia") ou o id gerado DENTRO do lote, por um trecho SQL constante
 * do código (ex.: `last_insert_rowid()`): o texto gravado vira `<tipo>:<id>`.
 */
export type AlvoAuditoria = string | { tipo: string; idSql: string };

export interface EntradaAuditoria extends Autoria {
  acao: AcaoAuditoria;
  alvo: AlvoAuditoria;
  /** Texto curto, sem dados pessoais (ids e configuração). */
  resumo: string;
}

/** Condição em SQL (trecho constante do código) para gravar só se a ação aconteceu; valores de ?6 em diante. */
export interface CondicaoAuditoria {
  sql: string;
  valores: readonly unknown[];
}

/** Tamanho máximo do resumo (CHECK da tabela). */
export const LIMITE_RESUMO_AUDITORIA = 1000;

/** Corta o resumo no limite da coluna, com reticências. */
export function cortarResumo(resumo: string): string {
  return resumo.length <= LIMITE_RESUMO_AUDITORIA
    ? resumo
    : `${resumo.slice(0, LIMITE_RESUMO_AUDITORIA - 1)}…`;
}

/**
 * O INSERT do registro, para pôr no db.batch da ação. Sem `condicao`, grava sempre que o lote passar.
 * Os valores vão sempre por bind (?1 a ?5 e, na condição, ?6 em diante); só os trechos SQL do alvo e da
 * condição são texto, e são constantes do código.
 */
export function prepararRegistroAuditoria(
  db: D1Database,
  entrada: EntradaAuditoria,
  condicao?: CondicaoAuditoria,
): D1PreparedStatement {
  const { alvo } = entrada;
  const [alvoSql, alvoValor] =
    typeof alvo === "string"
      ? ["?4", alvo]
      : [`?4 || ${alvo.idSql}`, `${alvo.tipo}:`];
  return db
    .prepare(
      `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
       SELECT ?1, ?2, ?3, ${alvoSql}, ?5
       WHERE ${condicao?.sql ?? "1"}`,
    )
    .bind(
      entrada.usuarioId,
      entrada.em,
      entrada.acao,
      alvoValor,
      cortarResumo(entrada.resumo),
      ...(condicao?.valores ?? []),
    );
}

interface LinhaAuditoria {
  id: number;
  em: string;
  usuario_id: number;
  usuario_nome: string;
  acao: AcaoAuditoria;
  alvo: string;
  resumo: string;
}

/**
 * Uma página da trilha, do mais novo para o mais antigo (pelo id, a chave primária: a leitura desce pelo
 * rowid a partir do cursor e para no limite). `proximo` é o id a passar em `antes_de` na página seguinte.
 */
export async function listarAuditoria(
  db: D1Database,
  { limite, antes_de }: ConsultaAuditoria,
): Promise<RespostaAuditoria> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.em, a.usuario_id, u.nome AS usuario_nome, a.acao, a.alvo, a.resumo
       FROM auditoria AS a JOIN usuarios AS u ON u.id = a.usuario_id
       WHERE a.id < ?1
       ORDER BY a.id DESC
       LIMIT ?2`,
    )
    // Sem cursor, a primeira página: todos os ids são menores que o maior inteiro seguro.
    .bind(antes_de ?? Number.MAX_SAFE_INTEGER, limite + 1)
    .all<LinhaAuditoria>();
  const itens = results.slice(0, limite);
  return {
    itens,
    proximo: results.length > limite ? (itens.at(-1)?.id ?? null) : null,
  };
}
