/**
 * Acesso da equipe (RIFA-007) no D1: usuários, links pessoais e sessões (migrations/0002_acessos.sql).
 *
 * Esta camada só recebe e grava hashes (SHA-256 hex) do token do link e do id da sessão: quem gera e
 * confere os segredos são as rotas, com src/worker/lib/cripto.ts. Instantes em UTC ISO com milissegundos
 * ("2026-12-01T12:20:31.512Z"), então comparar o texto é comparar o tempo.
 */
import type {
  LinkAcesso,
  Papel,
  SituacaoLink,
  Usuario,
  UsuarioSessao,
} from "../../shared/contracts";

/** O `ultimo_uso_em` da sessão é regravado no máximo uma vez por minuto (a leitura não vira escrita). */
const INTERVALO_TOQUE_SESSAO_MS = 60_000;

interface LinhaUsuario {
  id: number;
  nome: string;
  email: string | null;
  papel: Papel;
  ativo: number;
  criado_em: string;
}

interface LinhaLink {
  id: number;
  usuario_id: number;
  criado_em: string;
  expira_em: string;
  revogado_em: string | null;
  ultimo_uso_em: string | null;
}

/** Link novo: só o hash do token chega aqui. */
export interface NovoLink {
  tokenHash: string;
  criadoEm: string;
  expiraEm: string;
}

export interface NovaSessao {
  idHash: string;
  linkId: number;
  criadoEm: string;
  /** Validade pedida (login + VALIDADE_SESSAO_DIAS); a gravada é o menor entre esta e o fim do link. */
  expiraEm: string;
  /** Hash do cookie que o navegador já tinha: essa sessão antiga é encerrada no login. */
  idHashAnterior: string | null;
}

export function situacaoDoLink(
  link: Pick<LinhaLink, "expira_em" | "revogado_em">,
  agora: string,
): SituacaoLink {
  if (link.revogado_em !== null) return "revogado";
  return link.expira_em > agora ? "valido" : "expirado";
}

function paraLink(linha: LinhaLink, agora: string): LinkAcesso {
  return {
    id: linha.id,
    criado_em: linha.criado_em,
    expira_em: linha.expira_em,
    revogado_em: linha.revogado_em,
    ultimo_uso_em: linha.ultimo_uso_em,
    situacao: situacaoDoLink(linha, agora),
  };
}

// ---------------------------------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------------------------------

/** Usuários com os links (sem hash) e as sessões válidas. `id` null = todos. */
async function carregarUsuarios(
  db: D1Database,
  agora: string,
  id: number | null,
): Promise<Usuario[]> {
  const [usuarios, links, sessoes] = await db.batch([
    db
      .prepare(
        `SELECT id, nome, email, papel, ativo, criado_em FROM usuarios
         WHERE ?1 IS NULL OR id = ?1
         ORDER BY nome COLLATE NOCASE, id`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT id, usuario_id, criado_em, expira_em, revogado_em, ultimo_uso_em FROM links_acesso
         WHERE ?1 IS NULL OR usuario_id = ?1
         ORDER BY criado_em DESC, id DESC`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT usuario_id, count(*) AS total FROM sessoes
         WHERE (?1 IS NULL OR usuario_id = ?1) AND expira_em > ?2
         GROUP BY usuario_id`,
      )
      .bind(id, agora),
  ]);

  const linksPorUsuario = new Map<number, LinkAcesso[]>();
  for (const linha of links.results as LinhaLink[]) {
    const lista = linksPorUsuario.get(linha.usuario_id) ?? [];
    lista.push(paraLink(linha, agora));
    linksPorUsuario.set(linha.usuario_id, lista);
  }
  const sessoesPorUsuario = new Map(
    (sessoes.results as { usuario_id: number; total: number }[]).map(
      (linha) => [linha.usuario_id, linha.total],
    ),
  );

  return (usuarios.results as LinhaUsuario[]).map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    papel: linha.papel,
    ativo: linha.ativo === 1,
    criado_em: linha.criado_em,
    sessoes_ativas: sessoesPorUsuario.get(linha.id) ?? 0,
    links: linksPorUsuario.get(linha.id) ?? [],
  }));
}

export function listarUsuarios(
  db: D1Database,
  agora: string,
): Promise<Usuario[]> {
  return carregarUsuarios(db, agora, null);
}

export async function buscarUsuario(
  db: D1Database,
  id: number,
  agora: string,
): Promise<Usuario | null> {
  const [usuario] = await carregarUsuarios(db, agora, id);
  return usuario ?? null;
}

/** Cria o usuário e o primeiro link numa transação só. */
export async function criarUsuarioComLink(
  db: D1Database,
  dados: { nome: string; email: string | null; papel: Papel },
  link: NovoLink,
): Promise<{ usuarioId: number; linkId: number }> {
  const [usuario, novoLink] = await db.batch<{ id: number }>([
    db
      .prepare(
        "INSERT INTO usuarios (nome, email, papel, criado_em) VALUES (?1, ?2, ?3, ?4) RETURNING id",
      )
      .bind(dados.nome, dados.email, dados.papel, link.criadoEm),
    // Mesma transação: last_insert_rowid() é o usuário recém-criado.
    db
      .prepare(
        `INSERT INTO links_acesso (usuario_id, token_hash, criado_em, expira_em)
         VALUES (last_insert_rowid(), ?1, ?2, ?3) RETURNING id`,
      )
      .bind(link.tokenHash, link.criadoEm, link.expiraEm),
  ]);
  const usuarioId = usuario.results[0]?.id;
  const linkId = novoLink.results[0]?.id;
  if (usuarioId === undefined || linkId === undefined)
    throw new Error("D1 não devolveu os ids do usuário e do link criados");
  return { usuarioId, linkId };
}

/** "ultimo_admin": desativar deixaria a equipe sem nenhum admin ativo (nada muda). */
export type ResultadoDefinirAtivo = "ok" | "nao_encontrado" | "ultimo_admin";

/**
 * Ativa ou desativa o usuário. Desativar apaga as sessões dele na mesma transação e é recusado se ele for o
 * último admin ativo. A condição fica no próprio UPDATE: dois admins desativando um ao outro ao mesmo tempo
 * não deixam a equipe sem admin (o segundo UPDATE já vê só um admin ativo).
 */
export async function definirAtivo(
  db: D1Database,
  usuarioId: number,
  ativo: boolean,
): Promise<ResultadoDefinirAtivo> {
  const valor = ativo ? 1 : 0;
  const [atualizacao, , existente] = await db.batch([
    db
      .prepare(
        `UPDATE usuarios SET ativo = ?2
         WHERE id = ?1
           AND NOT (?2 = 0 AND papel = 'admin' AND ativo = 1
                    AND (SELECT count(*) FROM usuarios WHERE papel = 'admin' AND ativo = 1) = 1)`,
      )
      .bind(usuarioId, valor),
    // Só se a desativação aconteceu: recusada, o usuário continua ativo e as sessões ficam.
    db
      .prepare(
        `DELETE FROM sessoes WHERE usuario_id = ?1 AND ?2 = 0
           AND EXISTS (SELECT 1 FROM usuarios WHERE id = ?1 AND ativo = 0)`,
      )
      .bind(usuarioId, valor),
    db
      .prepare("SELECT 1 AS existe FROM usuarios WHERE id = ?1")
      .bind(usuarioId),
  ]);
  if (atualizacao.meta.changes > 0) return "ok";
  return existente.results.length > 0 ? "ultimo_admin" : "nao_encontrado";
}

// ---------------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------------

/** Link novo para um usuário existente; null se o usuário não existe. */
export async function criarLink(
  db: D1Database,
  usuarioId: number,
  link: NovoLink,
): Promise<number | null> {
  const linha = await db
    .prepare(
      `INSERT INTO links_acesso (usuario_id, token_hash, criado_em, expira_em)
       SELECT id, ?2, ?3, ?4 FROM usuarios WHERE id = ?1
       RETURNING id`,
    )
    .bind(usuarioId, link.tokenHash, link.criadoEm, link.expiraEm)
    .first<{ id: number }>();
  return linha?.id ?? null;
}

/** O link do hash, se ainda abre sessão: não revogado, dentro da validade e de usuário ativo. */
export async function buscarLinkValido(
  db: D1Database,
  tokenHash: string,
  agora: string,
): Promise<{ linkId: number; usuario: UsuarioSessao } | null> {
  const linha = await db
    .prepare(
      `SELECT l.id AS link_id, u.id, u.nome, u.papel
       FROM links_acesso AS l JOIN usuarios AS u ON u.id = l.usuario_id
       WHERE l.token_hash = ?1 AND l.revogado_em IS NULL AND l.expira_em > ?2 AND u.ativo = 1`,
    )
    .bind(tokenHash, agora)
    .first<{ link_id: number; id: number; nome: string; papel: Papel }>();
  if (linha === null) return null;
  return {
    linkId: linha.link_id,
    usuario: { id: linha.id, nome: linha.nome, papel: linha.papel },
  };
}

/** "ultimo_link_admin": revogar deixaria nenhum admin ativo com link válido (nada muda). */
export type ResultadoRevogarLink =
  "ok" | "nao_encontrado" | "ultimo_link_admin";

/**
 * Revoga o link (mantém a data da primeira revogação) e apaga as sessões abertas por ele. Recusa revogar um
 * link válido de admin ativo se nenhum outro admin ativo tiver link válido: a equipe ficaria sem como entrar
 * como admin quando as sessões acabassem. A condição fica no próprio UPDATE, como em definirAtivo: duas
 * revogações ao mesmo tempo dos dois últimos links não passam juntas (a segunda já vê só um link).
 */
export async function revogarLink(
  db: D1Database,
  linkId: number,
  agora: string,
): Promise<ResultadoRevogarLink> {
  const [revogacao, , existente] = await db.batch([
    db
      .prepare(
        `UPDATE links_acesso SET revogado_em = coalesce(revogado_em, ?2)
         WHERE id = ?1
           AND NOT (revogado_em IS NULL AND expira_em > ?2
                    AND usuario_id IN (SELECT id FROM usuarios WHERE papel = 'admin' AND ativo = 1)
                    AND NOT EXISTS (
                      SELECT 1 FROM links_acesso AS outro JOIN usuarios AS u ON u.id = outro.usuario_id
                      WHERE outro.id <> ?1 AND outro.revogado_em IS NULL AND outro.expira_em > ?2
                        AND u.papel = 'admin' AND u.ativo = 1))`,
      )
      .bind(linkId, agora),
    // Só se o link está revogado: recusada a revogação, as sessões abertas por ele continuam.
    db
      .prepare(
        `DELETE FROM sessoes WHERE link_id = ?1
           AND EXISTS (SELECT 1 FROM links_acesso WHERE id = ?1 AND revogado_em IS NOT NULL)`,
      )
      .bind(linkId),
    db
      .prepare("SELECT 1 AS existe FROM links_acesso WHERE id = ?1")
      .bind(linkId),
  ]);
  if (revogacao.meta.changes > 0) return "ok";
  return existente.results.length > 0 ? "ultimo_link_admin" : "nao_encontrado";
}

// ---------------------------------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------------------------------

/**
 * Abre a sessão se o link ainda vale (a condição é conferida de novo dentro da transação), com validade até o
 * menor entre `expiraEm` e o fim do link: a sessão nunca dura mais que o link que a abriu. Marca o uso do
 * link e apaga as sessões vencidas e a sessão anterior deste navegador. Devolve a validade gravada, ou null
 * se o link deixou de valer.
 */
export async function criarSessao(
  db: D1Database,
  sessao: NovaSessao,
): Promise<string | null> {
  const [criacao] = await db.batch<{ expira_em: string }>([
    db
      .prepare(
        `INSERT INTO sessoes (id_hash, usuario_id, link_id, criado_em, expira_em, ultimo_uso_em)
         SELECT ?1, l.usuario_id, l.id, ?3, min(?4, l.expira_em), ?3
         FROM links_acesso AS l JOIN usuarios AS u ON u.id = l.usuario_id
         WHERE l.id = ?2 AND l.revogado_em IS NULL AND l.expira_em > ?3 AND u.ativo = 1
         RETURNING expira_em`,
      )
      .bind(sessao.idHash, sessao.linkId, sessao.criadoEm, sessao.expiraEm),
    db
      .prepare(
        `UPDATE links_acesso SET ultimo_uso_em = ?2
         WHERE id = ?1 AND EXISTS (SELECT 1 FROM sessoes WHERE id_hash = ?3)`,
      )
      .bind(sessao.linkId, sessao.criadoEm, sessao.idHash),
    db
      .prepare("DELETE FROM sessoes WHERE expira_em <= ?1 OR id_hash = ?2")
      .bind(sessao.criadoEm, sessao.idHashAnterior),
  ]);
  return criacao.results[0]?.expira_em ?? null;
}

/** Usuário da sessão, se ela vale: existe, não venceu e o usuário está ativo. */
export async function buscarUsuarioDaSessao(
  db: D1Database,
  idHash: string,
  agora: string,
): Promise<UsuarioSessao | null> {
  const linha = await db
    .prepare(
      `SELECT u.id, u.nome, u.papel, s.ultimo_uso_em
       FROM sessoes AS s JOIN usuarios AS u ON u.id = s.usuario_id
       WHERE s.id_hash = ?1 AND s.expira_em > ?2 AND u.ativo = 1`,
    )
    .bind(idHash, agora)
    .first<UsuarioSessao & { ultimo_uso_em: string }>();
  if (linha === null) return null;
  const limiteToque = new Date(
    Date.parse(agora) - INTERVALO_TOQUE_SESSAO_MS,
  ).toISOString();
  if (linha.ultimo_uso_em < limiteToque) {
    await db
      .prepare("UPDATE sessoes SET ultimo_uso_em = ?2 WHERE id_hash = ?1")
      .bind(idHash, agora)
      .run();
  }
  return { id: linha.id, nome: linha.nome, papel: linha.papel };
}

export async function apagarSessao(
  db: D1Database,
  idHash: string,
): Promise<void> {
  await db.prepare("DELETE FROM sessoes WHERE id_hash = ?1").bind(idHash).run();
}
