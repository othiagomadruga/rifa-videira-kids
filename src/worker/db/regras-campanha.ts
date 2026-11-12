/**
 * Regras do admin na campanha (Sprint 6, docs/decisions.md D20; colunas da migração 0008), no D1:
 * - RIFA-028: desconsiderar e reconsiderar pedido (POST /api/admin/pedidos/desconsiderar e /reconsiderar);
 * - RIFA-029: a chave de acesso de discipuladores e redes, lida na hora (SQL_ACESSO_DO_PAPEL, na consulta da
 *   sessão e do link: +1 linha, a campanha ativa, sem ida a mais), e a chave na geração de links;
 * - RIFA-031: remover afiliado de teste (DELETE /api/admin/afiliados/:affiliateId).
 * As chaves e as mensagens são gravadas pelo PUT da campanha (db/campanha.ts).
 *
 * Atomicidade (D20, OBRIGATÓRIO 2; como a D11): cada ação é um db.batch só (uma transação do D1). No desconsiderar e
 * no reconsiderar, (a) o registro da trilha vai ANTES do UPDATE e com a MESMA condição (o resumo sai da própria
 * linha do pedido, no SQL: o status, os bilhetes e a célula são os de quando a ação aconteceu), (b) o UPDATE só
 * das três colunas pela chave primária, com a chave `pedidos.desconsiderar` lida DENTRO do lote (um admin que a
 * desliga ao mesmo tempo não deixa passar), e (c) a leitura do item como a lista o monta e a da chave, que
 * decidem a resposta sem ida a mais. Não existe tabela agregada: o SQLite tira (ou devolve) o pedido do índice
 * parcial da 0003 recriado e da view na mesma transação.
 */
import {
  ACESSO_PADRAO,
  alvoDoPedidoNaAuditoria,
  type AcaoAuditoria,
  type ItemPedido,
  type MotivoDesconsideracao,
  type PapelComChaveDeAcesso,
} from "../../shared/contracts";
import { prepararRegistroAuditoria, type Autoria } from "./auditoria";
import { COLUNAS_ITEM, itemDaLinha, type LinhaPedido } from "./lista-pedidos";

const comoNumero = (valor: boolean) => (valor ? 1 : 0);

/**
 * A chave de acesso do papel na campanha ativa (RIFA-029), em SQL, para a coluna de papel `papel`: 1 = entra, 0 =
 * desligado. Só `discipulador` e `rede` dependem da chave (o líder e a coordenação, nunca: o CASE nem lê a
 * campanha); sem campanha ativa, vale ACESSO_PADRAO. Lida na hora, na mesma consulta (subconsulta pelo índice
 * campanhas_uma_ativa): nunca do cache da visão (D14).
 */
export function sqlAcessoDoPapel(papel: string): string {
  return `CASE ${papel}
    WHEN 'discipulador' THEN coalesce((SELECT acesso_discipuladores FROM campanhas WHERE ativa = 1), ${comoNumero(ACESSO_PADRAO.discipuladores)})
    WHEN 'rede' THEN coalesce((SELECT acesso_redes FROM campanhas WHERE ativa = 1), ${comoNumero(ACESSO_PADRAO.redes)})
    ELSE 1 END`;
}

/** A chave do papel (o `chave` do 409 `acao_desligada`). */
export const CHAVE_DO_PAPEL = {
  discipulador: "acesso.discipuladores",
  rede: "acesso.redes",
} as const satisfies Record<PapelComChaveDeAcesso, string>;

/** A mensagem do 409 `acao_desligada` ao gerar link de um papel com o acesso desligado. */
export function mensagemChaveDeAcessoDesligada(
  papel: PapelComChaveDeAcesso,
): string {
  return `O acesso ${papel === "discipulador" ? "dos discipuladores" : "das redes"} está desligado na Campanha: ligue a chave antes de gerar ou mandar o link`;
}

/**
 * O acesso do papel está ligado na campanha ativa (sem campanha, o padrão)? Para gerar links em lote. É uma leitura
 * à parte, antes do lote (não dentro dele): um link gerado no instante em que a chave é desligada não abre sessão
 * (o login confere a chave na hora).
 */
export async function acessoDoPapelLigado(
  db: D1Database,
  papel: PapelComChaveDeAcesso,
): Promise<boolean> {
  const linha = await db
    .prepare(`SELECT ${sqlAcessoDoPapel("?1")} AS ligado`)
    .bind(papel)
    .first<{ ligado: number }>();
  return linha?.ligado === 1;
}

/** O papel do usuário e a chave de acesso dele (para o link avulso); null se o usuário não existe. */
export async function papelEAcessoDoUsuario(
  db: D1Database,
  usuarioId: number,
): Promise<{ papel: string; ligado: boolean } | null> {
  const linha = await db
    .prepare(
      `SELECT u.papel, ${sqlAcessoDoPapel("u.papel")} AS ligado FROM usuarios AS u WHERE u.id = ?1`,
    )
    .bind(usuarioId)
    .first<{ papel: string; ligado: number }>();
  return linha === null
    ? null
    : { papel: linha.papel, ligado: linha.ligado === 1 };
}

// ---------------------------------------------------------------------------------------------------
// RIFA-028: desconsiderar e reconsiderar pedido
// ---------------------------------------------------------------------------------------------------

/** A campanha ativa, só se a chave `pedidos.desconsiderar` está ligada (senão NULL, e nada casa). */
const ATIVA_COM_A_CHAVE =
  "(SELECT id FROM campanhas WHERE ativa = 1 AND pedidos_desconsiderar = 1)";

/** O pedido ?1 da campanha ativa, com a chave ligada, ainda contando (desconsiderar) ou não (reconsiderar). */
const CONDICAO = {
  desconsiderar: `p.id = ?1 AND p.campanha_id = ${ATIVA_COM_A_CHAVE} AND p.desconsiderado_em IS NULL`,
  reconsiderar: `p.id = ?1 AND p.campanha_id = ${ATIVA_COM_A_CHAVE} AND p.desconsiderado_em IS NOT NULL`,
} as const;

/**
 * O resumo da trilha, montado da linha do pedido (antes do UPDATE), sem dados pessoais (D11): o id em JSON (?5; pode
 * ter aspas), o status e os bilhetes, a célula pelo id e o motivo; da observação, só que foi informada (?7, texto
 * livre). No reconsiderar: o motivo que tinha e quando fora desconsiderado. Cabe nos 1.000 caracteres (o id tem até
 * 128), e o substr garante.
 */
const RESUMO = {
  desconsiderar: `'Pedido ' || ?5 || ' desconsiderado (motivo ' || ?6 || '): ' || p.status || ', '
    || p.qtd_bilhetes || CASE p.qtd_bilhetes WHEN 1 THEN ' bilhete' ELSE ' bilhetes' END
    || ', célula ' || coalesce(a.celula_id, 'nenhuma')
    || CASE WHEN ?7 IS NULL THEN '' ELSE '; observação informada' END`,
  reconsiderar: `'Pedido ' || ?5 || ' volta a contar (era desconsiderado por ' || p.desconsiderado_motivo
    || ' em ' || p.desconsiderado_em || '): ' || p.status || ', '
    || p.qtd_bilhetes || CASE p.qtd_bilhetes WHEN 1 THEN ' bilhete' ELSE ' bilhetes' END
    || ', célula ' || coalesce(a.celula_id, 'nenhuma')`,
} as const;

const ACAO = {
  desconsiderar: "pedido.desconsiderar",
  reconsiderar: "pedido.reconsiderar",
} as const satisfies Record<string, AcaoAuditoria>;

/** O UPDATE das três colunas (o webhook nunca as escreve), pela chave primária e com a condição da ação. */
const GRAVAR = {
  desconsiderar: `UPDATE pedidos AS p SET desconsiderado_em = ?2, desconsiderado_motivo = ?3,
      desconsiderado_observacao = ?4
    WHERE ${CONDICAO.desconsiderar}`,
  reconsiderar: `UPDATE pedidos AS p SET desconsiderado_em = NULL, desconsiderado_motivo = NULL,
      desconsiderado_observacao = NULL
    WHERE ${CONDICAO.reconsiderar}`,
} as const;

/**
 * No lote, depois do UPDATE: o pedido como um item da lista (lista-pedidos.ts), só se o UPDATE mudou a linha
 * (`changes()` é o do comando anterior do lote, o UPDATE: sem mudança, a consulta nem lê o pedido inteiro).
 */
const LER_ITEM_SE_MUDOU = `SELECT ${COLUNAS_ITEM}
  FROM pedidos AS p
  LEFT JOIN afiliados AS a ON a.affiliate_id = p.affiliate_id
  LEFT JOIN celulas AS c ON c.id = a.celula_id
  WHERE p.id = ?1 AND changes() > 0`;

/**
 * A leitura curta, só quando o lote não mudou nada (D20): a chave da campanha ativa e o pedido dela como um item da
 * lista. Nenhuma linha = sem campanha ativa; `id` null = o pedido não é da campanha ativa.
 */
const LER_CURTA = `SELECT k.chave, ${COLUNAS_ITEM}
  FROM (SELECT id, pedidos_desconsiderar AS chave FROM campanhas WHERE ativa = 1) AS k
  LEFT JOIN pedidos AS p ON p.id = ?1 AND p.campanha_id = k.id
  LEFT JOIN afiliados AS a ON a.affiliate_id = p.affiliate_id
  LEFT JOIN celulas AS c ON c.id = a.celula_id`;

export type AcaoDesconsideracao = keyof typeof GRAVAR;

export interface PedidoParaDesconsiderar {
  pedidoId: string;
  /** Só no desconsiderar. */
  motivo?: MotivoDesconsideracao;
  observacao?: string | null;
}

export type ResultadoDesconsideracao =
  | { ok: true; item: ItemPedido; mudou: boolean }
  | {
      ok: false;
      motivo: "sem_campanha" | "chave_desligada" | "pedido_nao_encontrado";
    };

/**
 * Desconsidera (ou reconsidera) o pedido da campanha ativa, num lote só: a trilha (só se mudar), o UPDATE e o item.
 * Sem mudança, uma leitura curta decide na ordem de erros da D20: sem campanha ativa, chave desligada, pedido fora
 * da campanha ativa e, por fim, 200 com o pedido como está (repetir não muda nada e não registra). `autoria` é quem
 * fez e o instante (o mesmo grava `desconsiderado_em`). Medido (routes/regras-campanha.test.ts): desconsiderar lê 10
 * linhas no lote (a trilha 4, com a chave estrangeira do autor; o UPDATE 3; o item 3), reconsiderar 9, e sem
 * mudança, 9 (o lote e a leitura curta).
 */
export async function aplicarDesconsideracao(
  db: D1Database,
  acao: AcaoDesconsideracao,
  pedido: PedidoParaDesconsiderar,
  autoria: Autoria,
): Promise<ResultadoDesconsideracao> {
  const observacao = pedido.observacao ?? null;
  const registro = db
    .prepare(
      `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
       SELECT ?2, ?3, ?4, ?8, substr(${RESUMO[acao]}, 1, 1000)
       FROM pedidos AS p LEFT JOIN afiliados AS a ON a.affiliate_id = p.affiliate_id
       WHERE ${CONDICAO[acao]}`,
    )
    .bind(
      pedido.pedidoId,
      autoria.usuarioId,
      autoria.em,
      ACAO[acao],
      JSON.stringify(pedido.pedidoId),
      pedido.motivo ?? null,
      observacao,
      alvoDoPedidoNaAuditoria(pedido.pedidoId),
    );
  const gravacao =
    acao === "desconsiderar"
      ? db
          .prepare(GRAVAR.desconsiderar)
          .bind(pedido.pedidoId, autoria.em, pedido.motivo ?? null, observacao)
      : db.prepare(GRAVAR.reconsiderar).bind(pedido.pedidoId);
  const [, gravado, item] = await db.batch([
    registro,
    gravacao,
    db.prepare(LER_ITEM_SE_MUDOU).bind(pedido.pedidoId),
  ]);
  const mudado = item.results[0] as LinhaPedido | undefined;
  if (gravado.meta.changes > 0 && mudado)
    return { ok: true, item: itemDaLinha(mudado), mudou: true };

  const curta = await db
    .prepare(LER_CURTA)
    .bind(pedido.pedidoId)
    .first<
      { chave: number } & Omit<LinhaPedido, "id"> & { id: string | null }
    >();
  if (curta === null) return { ok: false, motivo: "sem_campanha" };
  const { chave, ...linha } = curta;
  if (chave !== 1) return { ok: false, motivo: "chave_desligada" };
  if (linha.id === null) return { ok: false, motivo: "pedido_nao_encontrado" };
  return {
    ok: true,
    item: itemDaLinha({ ...linha, id: linha.id }),
    mudou: false,
  };
}

// ---------------------------------------------------------------------------------------------------
// RIFA-031: remover afiliado de teste
// ---------------------------------------------------------------------------------------------------

/** Nenhum pedido do afiliado ?1 conta, de qualquer status e de qualquer campanha (todos desconsiderados, ou nenhum). */
const NENHUM_QUE_CONTA =
  "NOT EXISTS (SELECT 1 FROM pedidos WHERE affiliate_id = ?1 AND desconsiderado_em IS NULL)";

/**
 * O afiliado, quantos pedidos dele contam (com os ids dos mais recentes, na ordem da lista de pedidos) e os ids dos
 * desconsiderados (que ficarão sem afiliado). Lê os pedidos dele pelo índice por afiliado.
 */
const LER_AFILIADO = `
  SELECT a.celula_id,
    (SELECT count(*) FROM pedidos WHERE affiliate_id = ?1 AND desconsiderado_em IS NULL) AS contam,
    (SELECT json_group_array(id) FROM (SELECT id FROM pedidos
       WHERE affiliate_id = ?1 AND desconsiderado_em IS NULL
       ORDER BY registrado_em DESC, id DESC LIMIT ?2)) AS que_contam,
    (SELECT json_group_array(id) FROM (SELECT id FROM pedidos
       WHERE affiliate_id = ?1 AND desconsiderado_em IS NOT NULL
       ORDER BY registrado_em DESC, id DESC)) AS desconsiderados
  FROM afiliados AS a WHERE a.affiliate_id = ?1`;

/** Tentativas de remover: só falha se um pedido do afiliado mudou entre a leitura e o lote (raro). */
const TENTATIVAS_DE_REMOVER = 3;

export type ResultadoRemoverAfiliado =
  | { ok: true }
  | { ok: false; motivo: "nao_encontrado" }
  | {
      ok: false;
      motivo: "afiliado_com_pedidos";
      pedidosQueContam: number;
      pedidos: string[];
    };

/** O resumo da trilha (sem dados pessoais): a célula pelo id e quantos pedidos ficaram sem afiliado (os ids, se couberem). */
export function resumirRemocaoDoAfiliado(
  celulaId: number | null,
  desconsiderados: readonly string[],
): string {
  const celula = celulaId === null ? "sem célula" : `célula ${celulaId}`;
  const quantos = desconsiderados.length;
  const base =
    quantos === 0
      ? `Afiliado removido (${celula}); nenhum pedido dele`
      : `Afiliado removido (${celula}); ${quantos} ${quantos === 1 ? "pedido desconsiderado ficou" : "pedidos desconsiderados ficaram"} sem afiliado`;
  const comIds = `${base}: ${JSON.stringify(desconsiderados)}`;
  return quantos > 0 && comIds.length <= 1000 ? comIds : base;
}

/**
 * Remove o afiliado (vinculado ou não) se nenhum pedido dele conta. No mesmo lote (D20, OBRIGATÓRIO 2): o registro
 * da trilha, os pedidos desconsiderados dele sem afiliado (a FK de pedidos é RESTRICT) e o DELETE, os três com a
 * mesma condição: um pedido que passe a contar no meio (o webhook) faz o lote não mudar nada, e a decisão é refeita.
 */
export async function removerAfiliado(
  db: D1Database,
  affiliateId: number,
  autoria: Autoria,
  limiteDeIds: number,
): Promise<ResultadoRemoverAfiliado> {
  for (let tentativa = 1; tentativa <= TENTATIVAS_DE_REMOVER; tentativa++) {
    const lido = await db
      .prepare(LER_AFILIADO)
      .bind(affiliateId, limiteDeIds)
      .first<{
        celula_id: number | null;
        contam: number;
        que_contam: string;
        desconsiderados: string;
      }>();
    if (lido === null) return { ok: false, motivo: "nao_encontrado" };
    if (lido.contam > 0)
      return {
        ok: false,
        motivo: "afiliado_com_pedidos",
        pedidosQueContam: lido.contam,
        pedidos: JSON.parse(lido.que_contam) as string[],
      };
    const desconsiderados = JSON.parse(lido.desconsiderados) as string[];
    const resultados = await db.batch([
      prepararRegistroAuditoria(
        db,
        {
          ...autoria,
          acao: "afiliado.remover",
          alvo: `afiliado:${affiliateId}`,
          resumo: resumirRemocaoDoAfiliado(lido.celula_id, desconsiderados),
        },
        {
          sql: `EXISTS (SELECT 1 FROM afiliados WHERE affiliate_id = ?6)
            AND NOT EXISTS (SELECT 1 FROM pedidos WHERE affiliate_id = ?6 AND desconsiderado_em IS NULL)`,
          valores: [affiliateId],
        },
      ),
      db
        .prepare(
          `UPDATE pedidos SET affiliate_id = NULL
           WHERE affiliate_id = ?1 AND desconsiderado_em IS NOT NULL AND ${NENHUM_QUE_CONTA}`,
        )
        .bind(affiliateId),
      db
        .prepare(
          `DELETE FROM afiliados WHERE affiliate_id = ?1 AND ${NENHUM_QUE_CONTA}`,
        )
        .bind(affiliateId),
    ]);
    if ((resultados.at(-1)?.meta.changes ?? 0) > 0) return { ok: true };
  }
  throw new Error(
    `O afiliado ${affiliateId} mudou durante ${TENTATIVAS_DE_REMOVER} tentativas de remover`,
  );
}
