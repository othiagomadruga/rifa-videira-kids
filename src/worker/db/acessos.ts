/**
 * Acesso da equipe (RIFA-007) no D1: usuários, links pessoais e sessões (migrations/0002_acessos.sql e, para os
 * papéis da hierarquia presos a um alvo, 0006_acesso_hierarquia.sql; RIFA-014, D12).
 *
 * Esta camada só recebe e grava hashes (SHA-256 hex) do token do link e do id da sessão: quem gera e
 * confere os segredos são as rotas, com src/worker/lib/cripto.ts. Instantes em UTC ISO com milissegundos
 * ("2026-12-01T12:20:31.512Z"), então comparar o texto é comparar o tempo.
 *
 * As ações do admin sobre usuários e links levam, opcionalmente, quem fez (`Autoria`): o registro da
 * trilha de auditoria (RIFA-013b) vai no mesmo db.batch da ação e só existe se ela aconteceu.
 */
import {
  PAPEIS_COORDENACAO,
  TIPO_ALVO_DO_PAPEL,
  type Alvo,
  type Divisao,
  type LinkAcesso,
  type Papel,
  type PapelCoordenacao,
  type SituacaoLink,
  type TipoAlvo,
  type Usuario,
  type UsuarioSessao,
} from "../../shared/contracts";
import { prepararRegistroAuditoria, type Autoria } from "./auditoria";

/** O `ultimo_uso_em` da sessão é regravado no máximo uma vez por minuto (a leitura não vira escrita). */
const INTERVALO_TOQUE_SESSAO_MS = 60_000;

/**
 * Inatividade máxima de uma sessão (RIFA-013b): sem uso há MAIS de 7 dias, ela deixa de valer, mesmo
 * dentro da validade (o link pessoal continua abrindo uma sessão nova). Com o toque de no máximo uma vez
 * por minuto, o `ultimo_uso_em` pode atrasar até INTERVALO_TOQUE_SESSAO_MS em relação ao último uso.
 */
export const INATIVIDADE_MAXIMA_SESSAO_DIAS = 7;
const INATIVIDADE_MAXIMA_SESSAO_MS =
  INATIVIDADE_MAXIMA_SESSAO_DIAS * 24 * 60 * 60 * 1000;

/** O `ultimo_uso_em` mais antigo que ainda vale em `agora` (exatamente 7 dias atrás ainda vale). */
export function limiteDeInatividade(agora: string): string {
  return new Date(
    Date.parse(agora) - INATIVIDADE_MAXIMA_SESSAO_MS,
  ).toISOString();
}

// ---------------------------------------------------------------------------------------------------
// Alvo dos papéis da hierarquia (D12): a célula, o discipulador ou a rede, lidos na hora
// ---------------------------------------------------------------------------------------------------

/**
 * Colunas do alvo do usuário `u`: o id (a coluna do papel), o nome e a divisão (a da rede), lidos da hierarquia
 * na hora. Nulas nos papéis da coordenação, que não têm alvo (o CHECK do papel garante, migração 0006).
 * Vai com JUNTAR_ALVO, que liga as três colunas de alvo às tabelas da hierarquia.
 */
const COLUNAS_ALVO = `coalesce(u.celula_id, u.discipulador_id, u.rede_id) AS alvo_id,
  coalesce(alvo_c.nome, alvo_d.nome, alvo_r.nome) AS alvo_nome,
  coalesce(alvo_rc.divisao, alvo_rd.divisao, alvo_r.divisao) AS alvo_divisao`;

const JUNTAR_ALVO = `
  LEFT JOIN celulas AS alvo_c ON alvo_c.id = u.celula_id
  LEFT JOIN discipuladores AS alvo_dc ON alvo_dc.id = alvo_c.discipulador_id
  LEFT JOIN redes AS alvo_rc ON alvo_rc.id = alvo_dc.rede_id
  LEFT JOIN discipuladores AS alvo_d ON alvo_d.id = u.discipulador_id
  LEFT JOIN redes AS alvo_rd ON alvo_rd.id = alvo_d.rede_id
  LEFT JOIN redes AS alvo_r ON alvo_r.id = u.rede_id`;

interface ColunasAlvo {
  alvo_id: number | null;
  alvo_nome: string | null;
  alvo_divisao: Divisao | null;
}

const TIPOS_DOS_PAPEIS: Partial<Record<Papel, TipoAlvo>> = TIPO_ALVO_DO_PAPEL;

/**
 * O alvo do papel: undefined nos papéis da coordenação; null se um papel da hierarquia ficou sem alvo (o banco
 * não deixa: o CHECK do papel exige a coluna, e a FK em cascata apaga o usuário junto com o alvo).
 */
function alvoDaLinha(
  papel: Papel,
  linha: ColunasAlvo,
): Alvo | null | undefined {
  const tipo = TIPOS_DOS_PAPEIS[papel];
  if (tipo === undefined) return undefined;
  if (
    linha.alvo_id === null ||
    linha.alvo_nome === null ||
    linha.alvo_divisao === null
  )
    return null;
  return {
    tipo,
    id: linha.alvo_id,
    nome: linha.alvo_nome,
    divisao: linha.alvo_divisao,
  };
}

/**
 * Quem está conectado, com o alvo nos papéis da hierarquia (na coordenação, sem o campo, como antes da D12).
 * null quando um papel da hierarquia vem sem alvo: sem o alvo, a sessão não vale.
 */
function usuarioDaSessao(
  linha: { id: number; nome: string; papel: Papel } & ColunasAlvo,
): UsuarioSessao | null {
  const alvo = alvoDaLinha(linha.papel, linha);
  if (alvo === null) return null;
  const usuario: UsuarioSessao = {
    id: linha.id,
    nome: linha.nome,
    papel: linha.papel,
  };
  return alvo === undefined ? usuario : { ...usuario, alvo };
}

interface LinhaUsuario extends ColunasAlvo {
  id: number;
  nome: string;
  email: string | null;
  papel: Papel;
  ativo: number;
  criado_em: string;
}

export interface LinhaLink {
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

export function paraLink(linha: LinhaLink, agora: string): LinkAcesso {
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

/**
 * Usuários com os links (sem hash) e as sessões válidas (no prazo e não paradas): um usuário pelo id (de qualquer
 * papel, com o alvo nos da hierarquia) ou, com `id` null, todos os da coordenação (a hierarquia tem a lista
 * própria, em db/acessos-hierarquia.ts).
 */
async function carregarUsuarios(
  db: D1Database,
  agora: string,
  id: number | null,
): Promise<Usuario[]> {
  // ?1 = o id, ou null para a lista da coordenação; ?2 = os papéis da coordenação (lista JSON do contrato).
  const doFiltro = `((?1 IS NULL AND u.papel IN (SELECT value FROM json_each(?2))) OR u.id = ?1)`;
  const coordenacao = JSON.stringify(PAPEIS_COORDENACAO);
  const [usuarios, links, sessoes] = await db.batch([
    db
      .prepare(
        `SELECT u.id, u.nome, u.email, u.papel, u.ativo, u.criado_em, ${COLUNAS_ALVO}
         FROM usuarios AS u ${JUNTAR_ALVO}
         WHERE ${doFiltro}
         ORDER BY u.nome COLLATE NOCASE, u.id`,
      )
      .bind(id, coordenacao),
    db
      .prepare(
        `SELECT l.id, l.usuario_id, l.criado_em, l.expira_em, l.revogado_em, l.ultimo_uso_em
         FROM links_acesso AS l JOIN usuarios AS u ON u.id = l.usuario_id
         WHERE ${doFiltro}
         ORDER BY l.criado_em DESC, l.id DESC`,
      )
      .bind(id, coordenacao),
    db
      .prepare(
        `SELECT s.usuario_id, count(*) AS total
         FROM sessoes AS s JOIN usuarios AS u ON u.id = s.usuario_id
         WHERE ${doFiltro} AND s.expira_em > ?3 AND s.ultimo_uso_em >= ?4
         GROUP BY s.usuario_id`,
      )
      .bind(id, coordenacao, agora, limiteDeInatividade(agora)),
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

  return (usuarios.results as LinhaUsuario[]).map((linha) => {
    const alvo = alvoDaLinha(linha.papel, linha);
    if (alvo === null)
      throw new Error(
        `Usuário ${linha.id} (${linha.papel}) sem alvo: o banco não deveria permitir`,
      );
    const usuario: Usuario = {
      id: linha.id,
      nome: linha.nome,
      email: linha.email,
      papel: linha.papel,
      ativo: linha.ativo === 1,
      criado_em: linha.criado_em,
      sessoes_ativas: sessoesPorUsuario.get(linha.id) ?? 0,
      links: linksPorUsuario.get(linha.id) ?? [],
    };
    return alvo === undefined ? usuario : { ...usuario, alvo };
  });
}

/** As pessoas da coordenação (admin e coordenacao). Os usuários da hierarquia têm a lista própria. */
export function listarUsuarios(
  db: D1Database,
  agora: string,
): Promise<Usuario[]> {
  return carregarUsuarios(db, agora, null);
}

/** Um usuário de qualquer papel (com o alvo, nos papéis da hierarquia), ou null. */
export async function buscarUsuario(
  db: D1Database,
  id: number,
  agora: string,
): Promise<Usuario | null> {
  const [usuario] = await carregarUsuarios(db, agora, id);
  return usuario ?? null;
}

/**
 * Cria uma pessoa da coordenação e o primeiro link numa transação só. Os usuários da hierarquia nascem só pelos
 * links em lote (db/acessos-hierarquia.ts), presos ao alvo.
 */
export async function criarUsuarioComLink(
  db: D1Database,
  dados: { nome: string; email: string | null; papel: PapelCoordenacao },
  link: NovoLink,
  autoria?: Autoria,
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
    // Auditoria: o usuário é o do link recém-criado (last_insert_rowid() agora é o link). Sem nome nem
    // e-mail no resumo: só o papel.
    ...(autoria
      ? [
          prepararRegistroAuditoria(db, {
            ...autoria,
            acao: "usuario.criar",
            alvo: {
              tipo: "usuario",
              idSql:
                "(SELECT usuario_id FROM links_acesso WHERE id = last_insert_rowid())",
            },
            resumo: `Acesso criado com o papel ${dados.papel} e um link`,
          }),
        ]
      : []),
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
  autoria?: Autoria,
): Promise<ResultadoDefinirAtivo> {
  const valor = ativo ? 1 : 0;
  // Auditoria: só se a mudança aconteceu (recusada, o usuário continua como estava).
  const registro =
    autoria &&
    prepararRegistroAuditoria(
      db,
      {
        ...autoria,
        acao: ativo ? "usuario.ativar" : "usuario.desativar",
        alvo: `usuario:${usuarioId}`,
        resumo: ativo
          ? "Acesso reativado (os links no prazo voltam a valer)"
          : "Acesso desativado (as sessões foram encerradas)",
      },
      {
        sql: "EXISTS (SELECT 1 FROM usuarios WHERE id = ?6 AND ativo = ?7)",
        valores: [usuarioId, valor],
      },
    );
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
    ...(registro ? [registro] : []),
  ]);
  if (atualizacao.meta.changes > 0) return "ok";
  return existente.results.length > 0 ? "ultimo_admin" : "nao_encontrado";
}

// ---------------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------------

/**
 * Link novo para um usuário existente; null se o usuário não existe. Com `autoria`, o registro da
 * auditoria vai no mesmo lote, só se o link foi criado (o id dele é o last_insert_rowid() do lote).
 */
export async function criarLink(
  db: D1Database,
  usuarioId: number,
  link: NovoLink,
  autoria?: Autoria,
): Promise<number | null> {
  const insercao = db
    .prepare(
      `INSERT INTO links_acesso (usuario_id, token_hash, criado_em, expira_em)
       SELECT id, ?2, ?3, ?4 FROM usuarios WHERE id = ?1
       RETURNING id`,
    )
    .bind(usuarioId, link.tokenHash, link.criadoEm, link.expiraEm);
  if (!autoria) {
    const linha = await insercao.first<{ id: number }>();
    return linha?.id ?? null;
  }
  const [criacao] = await db.batch<{ id: number }>([
    insercao,
    prepararRegistroAuditoria(
      db,
      {
        ...autoria,
        acao: "link.criar",
        alvo: { tipo: "link", idSql: "last_insert_rowid()" },
        resumo: `Link novo para o usuário ${usuarioId}`,
      },
      {
        // Sem o usuário, nada foi inserido e o last_insert_rowid() é de outra gravação.
        sql: "EXISTS (SELECT 1 FROM links_acesso WHERE id = last_insert_rowid() AND usuario_id = ?6)",
        valores: [usuarioId],
      },
    ),
  ]);
  return criacao.results[0]?.id ?? null;
}

/**
 * O link do hash, se ainda abre sessão: não revogado, dentro da validade e de usuário ativo. O usuário vem com o
 * alvo nos papéis da hierarquia (lido na hora).
 */
export async function buscarLinkValido(
  db: D1Database,
  tokenHash: string,
  agora: string,
): Promise<{ linkId: number; usuario: UsuarioSessao } | null> {
  const linha = await db
    .prepare(
      `SELECT l.id AS link_id, u.id, u.nome, u.papel, ${COLUNAS_ALVO}
       FROM links_acesso AS l JOIN usuarios AS u ON u.id = l.usuario_id ${JUNTAR_ALVO}
       WHERE l.token_hash = ?1 AND l.revogado_em IS NULL AND l.expira_em > ?2 AND u.ativo = 1`,
    )
    .bind(tokenHash, agora)
    .first<
      { link_id: number; id: number; nome: string; papel: Papel } & ColunasAlvo
    >();
  if (linha === null) return null;
  const usuario = usuarioDaSessao(linha);
  return usuario === null ? null : { linkId: linha.link_id, usuario };
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
  autoria?: Autoria,
): Promise<ResultadoRevogarLink> {
  // Auditoria: o dono do link entra no resumo (uma leitura pequena) e o registro só fica se o link ficou
  // revogado (a revogação recusada não registra nada).
  const dono =
    autoria &&
    (await db
      .prepare("SELECT usuario_id FROM links_acesso WHERE id = ?1")
      .bind(linkId)
      .first<{ usuario_id: number }>());
  const registro =
    autoria &&
    dono &&
    prepararRegistroAuditoria(
      db,
      {
        ...autoria,
        acao: "link.revogar",
        alvo: `link:${linkId}`,
        resumo: `Link do usuário ${dono.usuario_id} revogado (as sessões abertas por ele foram encerradas)`,
      },
      {
        sql: "EXISTS (SELECT 1 FROM links_acesso WHERE id = ?6 AND revogado_em IS NOT NULL)",
        valores: [linkId],
      },
    );
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
    ...(registro ? [registro] : []),
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
 * link e apaga as sessões vencidas, as paradas há mais de INATIVIDADE_MAXIMA_SESSAO_DIAS e a sessão anterior
 * deste navegador. Devolve a validade gravada, ou null se o link deixou de valer.
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
      .prepare(
        "DELETE FROM sessoes WHERE expira_em <= ?1 OR ultimo_uso_em < ?3 OR id_hash = ?2",
      )
      .bind(
        sessao.criadoEm,
        sessao.idHashAnterior,
        limiteDeInatividade(sessao.criadoEm),
      ),
  ]);
  return criacao.results[0]?.expira_em ?? null;
}

/**
 * Usuário da sessão, se ela vale: existe, não venceu, foi usada nos últimos INATIVIDADE_MAXIMA_SESSAO_DIAS
 * (RIFA-013b; exatamente 7 dias ainda vale) e o usuário está ativo. Nos papéis da hierarquia, vem com o alvo
 * (D12), lido da hierarquia na hora: é dele, e só dele, que as rotas de /api/minha tiram o alvo.
 */
export async function buscarUsuarioDaSessao(
  db: D1Database,
  idHash: string,
  agora: string,
): Promise<UsuarioSessao | null> {
  const linha = await db
    .prepare(
      `SELECT u.id, u.nome, u.papel, s.ultimo_uso_em, ${COLUNAS_ALVO}
       FROM sessoes AS s JOIN usuarios AS u ON u.id = s.usuario_id ${JUNTAR_ALVO}
       WHERE s.id_hash = ?1 AND s.expira_em > ?2 AND s.ultimo_uso_em >= ?3 AND u.ativo = 1`,
    )
    .bind(idHash, agora, limiteDeInatividade(agora))
    .first<
      {
        id: number;
        nome: string;
        papel: Papel;
        ultimo_uso_em: string;
      } & ColunasAlvo
    >();
  if (linha === null) return null;
  const usuario = usuarioDaSessao(linha);
  if (usuario === null) return null;
  const limiteToque = new Date(
    Date.parse(agora) - INTERVALO_TOQUE_SESSAO_MS,
  ).toISOString();
  if (linha.ultimo_uso_em < limiteToque) {
    await db
      .prepare("UPDATE sessoes SET ultimo_uso_em = ?2 WHERE id_hash = ?1")
      .bind(idHash, agora)
      .run();
  }
  return usuario;
}

export async function apagarSessao(
  db: D1Database,
  idHash: string,
): Promise<void> {
  await db.prepare("DELETE FROM sessoes WHERE id_hash = ?1").bind(idHash).run();
}
