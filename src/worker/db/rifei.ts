/**
 * O que as rotas da API da Rifei (RIFA-070, D32; routes/rifei.ts) leem e gravam no D1.
 *
 * - Marcar como pago: só LÊ os pedidos do corpo (o status e a desconsideração), para mandar à Rifei só os pendentes ou
 *   expirados da campanha ativa. Nada do pedido é gravado: ele passa a contar quando o "Pedido pago" chegar pelo
 *   webhook. A trilha (`rifei.marcar_pagos`) é a única escrita.
 * - Afiliados: lê as células (com o e-mail e o telefone do líder, dados da equipe; só para comparar o e-mail e montar o
 *   WhatsApp do convite, nunca na trilha) e os afiliados. A sincronização grava, num db.batch só, o código de cada
 *   afiliado da Rifei, os vínculos novos pelo e-mail (nunca troca um vínculo que já existe) e a trilha.
 */
import {
  ALVO_AUDITORIA_CONEXAO_RIFEI,
  type AcaoAuditoria,
  type StatusPedido,
} from "../../shared/contracts";
import { prepararRegistroAuditoria, type Autoria } from "./auditoria";
import { juntarAfiliado, juntarCelulaEfetiva } from "./celula-efetiva";
import { COLUNAS_ITEM, type LinhaPedido } from "./lista-pedidos";

/** Um pedido da campanha ativa como a marcação precisa. */
export interface PedidoParaMarcar {
  id: string;
  status: StatusPedido;
  desconsiderado_em: string | null;
}

/** Os pedidos da campanha com os ids do corpo (os que não são dela ficam de fora do mapa). */
export async function lerPedidosParaMarcar(
  db: D1Database,
  campanhaId: number,
  ids: readonly string[],
): Promise<Map<string, PedidoParaMarcar>> {
  const { results } = await db
    .prepare(
      `SELECT id, status, desconsiderado_em FROM pedidos
       WHERE campanha_id = ?1 AND id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(campanhaId, JSON.stringify(ids))
    .all<PedidoParaMarcar>();
  return new Map(results.map((pedido) => [pedido.id, pedido]));
}

/** Grava uma linha na trilha (fora de outro lote: a ação aconteceu na Rifei, não no banco). */
export async function registrarNaTrilha(
  db: D1Database,
  quem: Autoria,
  acao: AcaoAuditoria,
  alvo: string,
  resumo: string,
): Promise<void> {
  await prepararRegistroAuditoria(db, { ...quem, acao, alvo, resumo }).run();
}

/** Uma célula com os dados do líder que a integração usa. */
export interface CelulaParaRifei {
  celula_id: number;
  celula_nome: string;
  lider_nome: string;
  lider_email: string | null;
  lider_telefone: string | null;
}

/** Um afiliado do sistema: o vínculo e o código na Rifei. */
export interface AfiliadoDoSistema {
  affiliate_id: number;
  celula_id: number | null;
  codigo_rifei: string | null;
}

const LER_CELULAS = `SELECT id AS celula_id, nome AS celula_nome, lider_nome, lider_email, lider_telefone
  FROM celulas ORDER BY nome, id`;
const LER_AFILIADOS =
  "SELECT affiliate_id, celula_id, codigo_rifei FROM afiliados";

/** Todas as células e todos os afiliados, numa ida só. */
export async function lerCelulasEAfiliados(db: D1Database): Promise<{
  celulas: CelulaParaRifei[];
  afiliados: AfiliadoDoSistema[];
}> {
  const [celulas, afiliados] = await db.batch([
    db.prepare(LER_CELULAS),
    db.prepare(LER_AFILIADOS),
  ]);
  return {
    celulas: celulas.results as CelulaParaRifei[],
    afiliados: afiliados.results as AfiliadoDoSistema[],
  };
}

/** As células com os ids pedidos (as que não existem ficam de fora). */
export async function lerCelulas(
  db: D1Database,
  ids: readonly number[],
): Promise<CelulaParaRifei[]> {
  const { results } = await db
    .prepare(
      `SELECT id AS celula_id, nome AS celula_nome, lider_nome, lider_email, lider_telefone
       FROM celulas WHERE id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(ids))
    .all<CelulaParaRifei>();
  return results;
}

/** O que a sincronização grava (lib/rifei-afiliados.ts planeja). */
export interface PlanoSincronizacao {
  /**
   * Afiliados da Rifei novos no sistema ou com o código mudado: cria o afiliado (origem `manual`, sem célula) ou
   * atualiza o código (null só no afiliado novo sem código na Rifei).
   */
  codigos: { affiliate_id: number; codigo: string | null }[];
  /** Afiliados não vinculados com sugestão pelo e-mail: vincula à célula (só se ainda estiver sem célula). */
  vinculos: { affiliate_id: number; celula_id: number }[];
}

/**
 * Grava o plano num db.batch só (uma transação): os códigos e os vínculos (que nunca trocam uma célula já gravada:
 * `WHERE celula_id IS NULL`). Devolve quantas linhas mudaram de fato em cada parte; a rota registra a trilha com
 * esses números, só quando algo mudou.
 */
export async function gravarSincronizacao(
  db: D1Database,
  plano: PlanoSincronizacao,
  agora: string,
): Promise<{ codigosGravados: number; vinculados: number }> {
  const codigos = plano.codigos.map(({ affiliate_id, codigo }) =>
    db
      .prepare(
        `INSERT INTO afiliados (affiliate_id, origem, codigo_rifei, criado_em, atualizado_em)
         VALUES (?1, 'manual', ?2, ?3, ?3)
         ON CONFLICT (affiliate_id) DO UPDATE SET codigo_rifei = excluded.codigo_rifei,
           atualizado_em = excluded.atualizado_em
         WHERE afiliados.codigo_rifei IS NOT excluded.codigo_rifei`,
      )
      .bind(affiliate_id, codigo, agora),
  );
  const vinculos = plano.vinculos.map(({ affiliate_id, celula_id }) =>
    db
      .prepare(
        `UPDATE afiliados SET celula_id = ?2, vinculado_em = ?3, atualizado_em = ?3
         WHERE affiliate_id = ?1 AND celula_id IS NULL`,
      )
      .bind(affiliate_id, celula_id, agora),
  );
  if (codigos.length + vinculos.length === 0)
    return { codigosGravados: 0, vinculados: 0 };
  const resultados = await db.batch([...codigos, ...vinculos]);
  const mudou = (resultado: D1Result) => resultado.meta.changes > 0;
  return {
    codigosGravados: resultados.slice(0, codigos.length).filter(mudou).length,
    vinculados: resultados.slice(codigos.length).filter(mudou).length,
  };
}

// ---------------------------------------------------------------------------------------------------
// Conexão com a Rifei pela tela (RIFA-070, D32): a linha única de rifei_conexao (o token só cifrado).
// ---------------------------------------------------------------------------------------------------

/** A linha da conexão como o banco guarda. */
export interface LinhaConexaoRifei {
  token_cifrado: string;
  final_token: string;
  expira_em: string | null;
  conectado_em: string;
  testado_em: string | null;
  recusado_em: string | null;
}

export async function lerConexaoRifei(
  db: D1Database,
): Promise<LinhaConexaoRifei | null> {
  return db
    .prepare(
      `SELECT token_cifrado, final_token, expira_em, conectado_em, testado_em, recusado_em
       FROM rifei_conexao WHERE id = 1`,
    )
    .first<LinhaConexaoRifei>();
}

/** Grava (ou troca) o token, já testado, e a trilha num lote só. O resumo leva só o final do token. */
export async function gravarConexaoRifei(
  db: D1Database,
  dados: {
    tokenCifrado: string;
    final: string;
    expiraEm: string | null;
    trocou: boolean;
  },
  quem: Autoria,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO rifei_conexao (id, token_cifrado, final_token, expira_em, conectado_em, testado_em, recusado_em)
         VALUES (1, ?1, ?2, ?3, ?4, ?4, NULL)
         ON CONFLICT (id) DO UPDATE SET token_cifrado = excluded.token_cifrado,
           final_token = excluded.final_token, expira_em = excluded.expira_em,
           conectado_em = excluded.conectado_em, testado_em = excluded.testado_em, recusado_em = NULL`,
      )
      .bind(dados.tokenCifrado, dados.final, dados.expiraEm, quem.em),
    prepararRegistroAuditoria(db, {
      ...quem,
      acao: "rifei.conectar",
      alvo: ALVO_AUDITORIA_CONEXAO_RIFEI,
      resumo: `${dados.trocou ? "Token da Rifei trocado" : "Token da Rifei colado"} e testado (termina em …${dados.final})`,
    }),
  ]);
}

/** Apaga o token da tela e registra na trilha (só se havia token). Devolve se apagou. */
export async function apagarConexaoRifei(
  db: D1Database,
  quem: Autoria,
): Promise<boolean> {
  const linha = await lerConexaoRifei(db);
  if (!linha) return false;
  await db.batch([
    db.prepare("DELETE FROM rifei_conexao WHERE id = 1"),
    prepararRegistroAuditoria(db, {
      ...quem,
      acao: "rifei.desconectar",
      alvo: ALVO_AUDITORIA_CONEXAO_RIFEI,
      resumo: `Token da Rifei apagado (terminava em …${linha.final_token})`,
    }),
  ]);
  return true;
}

/**
 * O que a última chamada real à Rifei com o token da tela mostrou: `ok` grava `testado_em` e limpa a recusa;
 * `recusado` grava `recusado_em` só na primeira recusa (o instante em que o token parou de valer). Só mexe na linha
 * se o token ainda é o mesmo (`token_cifrado`): uma troca no meio não é marcada com o resultado do token velho.
 */
export async function registrarUsoDaConexaoRifei(
  db: D1Database,
  tokenCifrado: string,
  resultado: "ok" | "recusado",
  em: string,
): Promise<void> {
  await db
    .prepare(
      resultado === "ok"
        ? "UPDATE rifei_conexao SET testado_em = ?2, recusado_em = NULL WHERE id = 1 AND token_cifrado = ?1"
        : "UPDATE rifei_conexao SET recusado_em = ?2 WHERE id = 1 AND token_cifrado = ?1 AND recusado_em IS NULL",
    )
    .bind(tokenCifrado, em)
    .run();
}

// ---------------------------------------------------------------------------------------------------
// Busca do pedido para marcar à mão (RIFA-070, D32): pelo número do pedido ou por um bilhete dele.
// ---------------------------------------------------------------------------------------------------

/**
 * Os pedidos da campanha ativa com este id ou com este bilhete em `numeros` (como na tela de Pedidos: COLUNAS_ITEM, com
 * a célula EFETIVA, RIFA-088/D41: o nome vem da célula do afiliado ou, sem ela, da atribuída à mão).
 * O do id vem primeiro; pelo bilhete, os pendentes, depois os pagos, depois os expirados, do mais novo ao mais antigo.
 * A busca pelo bilhete lê os pedidos da campanha (é um clique do admin, não uma tela que se atualiza sozinha).
 */
export async function buscarPedidosParaMarcar(
  db: D1Database,
  campanhaId: number,
  texto: string,
  bilhete: number | null,
  limite: number,
): Promise<(LinhaPedido & { achado_por: "pedido" | "bilhete" })[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUNAS_ITEM}, CASE WHEN p.id = ?2 THEN 'pedido' ELSE 'bilhete' END AS achado_por
       FROM pedidos AS p
         ${juntarAfiliado()}
         ${juntarCelulaEfetiva()}
       WHERE p.campanha_id = ?1
         AND (p.id = ?2 OR (?3 IS NOT NULL AND p.numeros IS NOT NULL
           AND EXISTS (SELECT 1 FROM json_each(p.numeros) AS n WHERE n.value = ?3)))
       ORDER BY p.id = ?2 DESC,
         CASE p.status WHEN 'in_process' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
         p.registrado_em DESC, p.id DESC
       LIMIT ?4`,
    )
    .bind(campanhaId, texto, bilhete, limite)
    .all<LinhaPedido & { achado_por: "pedido" | "bilhete" }>();
  return results;
}
