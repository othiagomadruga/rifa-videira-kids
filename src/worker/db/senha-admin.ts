/**
 * Usuário e senha de login do admin (RIFA-073; docs/decisions.md D33), no D1 (migração 0015). As rotas são
 * src/worker/routes/acesso.ts (POST /api/sessao/admin) e src/worker/routes/senha-admin.ts (/api/admin/minha-senha); o
 * hash, src/worker/lib/senha.ts.
 *
 * - A senha nunca chega aqui: só o sal, o hash e as iterações.
 * - A sessão aberta pela senha é a do usuário admin, sem link (`sessoes.link_id` NULL). A consulta da sessão
 *   (db/acessos.ts, buscarSessao) só a aceita enquanto o usuário é admin e tem a linha em senhas_admin
 *   (SQL_SESSAO_SEM_LINK_DO_ADMIN_VALE, em db/acessos.ts).
 * - Cada escrita é um db.batch (uma transação), com a linha da trilha no mesmo lote, sem a senha, sem o hash e sem o
 *   usuário de login.
 */
import { limiteDeInatividade } from "./acessos";
import { prepararRegistroAuditoria, type Autoria } from "./auditoria";
import type { SenhaGravada } from "../lib/senha";

/** A senha do admin, como a tela mostra (sem sal e sem hash). */
export interface SenhaDoAdmin {
  usuario: string;
  atualizadaEm: string;
}

export async function lerSenhaDoAdmin(
  db: D1Database,
  usuarioId: number,
): Promise<SenhaDoAdmin | null> {
  const linha = await db
    .prepare(
      "SELECT usuario, atualizada_em FROM senhas_admin WHERE usuario_id = ?1",
    )
    .bind(usuarioId)
    .first<{ usuario: string; atualizada_em: string }>();
  return linha === null
    ? null
    : { usuario: linha.usuario, atualizadaEm: linha.atualizada_em };
}

/** A credencial de um usuário de login (já normalizado): só de admin ativo. */
export interface CredencialAdmin extends SenhaGravada {
  usuarioId: number;
}

export async function buscarCredencialAdmin(
  db: D1Database,
  usuario: string,
): Promise<CredencialAdmin | null> {
  const linha = await db
    .prepare(
      `SELECT sa.usuario_id, sa.sal, sa.hash, sa.iteracoes
       FROM senhas_admin AS sa JOIN usuarios AS u ON u.id = sa.usuario_id
       WHERE sa.usuario = ?1 AND u.papel = 'admin' AND u.ativo = 1`,
    )
    .bind(usuario)
    .first<{
      usuario_id: number;
      sal: string;
      hash: string;
      iteracoes: number;
    }>();
  return linha === null
    ? null
    : {
        usuarioId: linha.usuario_id,
        sal: linha.sal,
        hash: linha.hash,
        iteracoes: linha.iteracoes,
      };
}

export type ResultadoGravarSenha =
  | { tipo: "ok"; acao: "definir" | "trocar"; atualizadaEm: string }
  /** O usuário de login já é de outro admin. */
  | { tipo: "em_uso" };

/**
 * Define ou troca a senha do admin da sessão. Na troca, encerra as OUTRAS sessões dele abertas pela senha (a desta
 * requisição continua, se foi aberta pela senha; as do link não mudam). A trilha registra `senha_admin.definir` ou
 * `senha_admin.trocar` (alvo `usuario:<id>`), sem a senha e sem o usuário de login.
 */
export async function gravarSenhaDoAdmin(
  db: D1Database,
  dados: {
    usuarioId: number;
    usuario: string;
    senha: SenhaGravada;
    /** Hash do cookie desta requisição: a sessão dela não é encerrada na troca. */
    idHashAtual: string | null;
  },
  autoria: Autoria,
): Promise<ResultadoGravarSenha> {
  const anterior = await lerSenhaDoAdmin(db, dados.usuarioId);
  const acao = anterior === null ? "definir" : "trocar";
  const em = autoria.em;
  try {
    const resultados = await db.batch([
      // Só para admin ativo (a rota já exige; o lote confere de novo). O UNIQUE de `usuario` barra o de outro admin.
      db
        .prepare(
          `UPDATE senhas_admin SET usuario = ?2, sal = ?3, hash = ?4, iteracoes = ?5, atualizada_em = ?6
           WHERE usuario_id = ?1
             AND EXISTS (SELECT 1 FROM usuarios WHERE id = ?1 AND papel = 'admin' AND ativo = 1)`,
        )
        .bind(
          dados.usuarioId,
          dados.usuario,
          dados.senha.sal,
          dados.senha.hash,
          dados.senha.iteracoes,
          em,
        ),
      db
        .prepare(
          `INSERT INTO senhas_admin (usuario_id, usuario, sal, hash, iteracoes, criada_em, atualizada_em)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6 FROM usuarios
           WHERE id = ?1 AND papel = 'admin' AND ativo = 1
             AND NOT EXISTS (SELECT 1 FROM senhas_admin WHERE usuario_id = ?1)`,
        )
        .bind(
          dados.usuarioId,
          dados.usuario,
          dados.senha.sal,
          dados.senha.hash,
          dados.senha.iteracoes,
          em,
        ),
      // Na troca: as outras sessões abertas pela senha (sem link) caem; quem tinha a senha antiga sai.
      db
        .prepare(
          `DELETE FROM sessoes WHERE usuario_id = ?1 AND link_id IS NULL AND id_hash IS NOT ?2
             AND EXISTS (SELECT 1 FROM senhas_admin WHERE usuario_id = ?1 AND atualizada_em = ?3)`,
        )
        .bind(dados.usuarioId, dados.idHashAtual, em),
      prepararRegistroAuditoria(
        db,
        {
          ...autoria,
          acao:
            acao === "definir" ? "senha_admin.definir" : "senha_admin.trocar",
          alvo: `usuario:${dados.usuarioId}`,
          resumo:
            acao === "definir"
              ? "Senha de login do administrador definida"
              : `Senha de login do administrador trocada (${
                  anterior?.usuario === dados.usuario
                    ? "mesmo usuário de login"
                    : "usuário de login trocado"
                }); as outras sessões abertas pela senha foram encerradas`,
        },
        {
          sql: "EXISTS (SELECT 1 FROM senhas_admin WHERE usuario_id = ?6 AND atualizada_em = ?7)",
          valores: [dados.usuarioId, em],
        },
      ),
    ]);
    const gravadas =
      (resultados[0]?.meta.changes ?? 0) + (resultados[1]?.meta.changes ?? 0);
    if (gravadas === 0)
      throw new Error(
        "Senha do admin não gravada: o usuário não é admin ativo",
      );
    return { tipo: "ok", acao, atualizadaEm: em };
  } catch (erro) {
    if (
      erro instanceof Error &&
      /UNIQUE constraint failed: senhas_admin\.usuario/.test(erro.message)
    )
      return { tipo: "em_uso" };
    throw erro;
  }
}

/**
 * Remove a senha do admin e encerra as sessões dele abertas pela senha (inclusive a desta requisição, se foi aberta
 * por ela). Devolve false se não havia senha (nada muda, nada vai para a trilha).
 */
export async function removerSenhaDoAdmin(
  db: D1Database,
  usuarioId: number,
  autoria: Autoria,
): Promise<boolean> {
  const [, , remocao] = await db.batch([
    prepararRegistroAuditoria(
      db,
      {
        ...autoria,
        acao: "senha_admin.remover",
        alvo: `usuario:${usuarioId}`,
        resumo:
          "Senha de login do administrador removida; as sessões abertas pela senha foram encerradas (o link continua)",
      },
      {
        sql: "EXISTS (SELECT 1 FROM senhas_admin WHERE usuario_id = ?6)",
        valores: [usuarioId],
      },
    ),
    db
      .prepare("DELETE FROM sessoes WHERE usuario_id = ?1 AND link_id IS NULL")
      .bind(usuarioId),
    db
      .prepare("DELETE FROM senhas_admin WHERE usuario_id = ?1")
      .bind(usuarioId),
  ]);
  return (remocao?.meta.changes ?? 0) > 0;
}

export interface NovaSessaoDoAdmin {
  usuarioId: number;
  /** SHA-256 do id da sessão (o valor do cookie). */
  idHash: string;
  criadoEm: string;
  /** Login + VALIDADE_SESSAO_DIAS. */
  expiraEm: string;
  /** Hash do cookie que o navegador já tinha: essa sessão antiga é encerrada no login. */
  idHashAnterior: string | null;
}

/** O resumo da linha da trilha: nunca a senha nem o usuário de login. */
export const RESUMO_LOGIN_ADMIN =
  "Entrada do administrador com usuário e senha: sessão aberta (sem link)";

/**
 * Abre a sessão do admin (sem link). Devolve a validade gravada, ou null se ela não nasceu: o usuário deixou de ser
 * admin ativo ou a senha foi removida no meio (conferidos de novo dentro do lote; a rota responde o mesmo 401).
 */
export async function abrirSessaoDoAdmin(
  db: D1Database,
  sessao: NovaSessaoDoAdmin,
): Promise<string | null> {
  const resultados = await db.batch<{ expira_em: string }>([
    db
      .prepare(
        `INSERT INTO sessoes (id_hash, usuario_id, link_id, criado_em, expira_em, ultimo_uso_em)
         SELECT ?2, u.id, NULL, ?3, ?4, ?3 FROM usuarios AS u
         WHERE u.id = ?1 AND u.papel = 'admin' AND u.ativo = 1
           AND EXISTS (SELECT 1 FROM senhas_admin WHERE usuario_id = u.id)
         RETURNING expira_em`,
      )
      .bind(sessao.usuarioId, sessao.idHash, sessao.criadoEm, sessao.expiraEm),
    db
      .prepare(
        `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
         SELECT s.usuario_id, ?2, 'sessao.entrar_como_admin', 'usuario:' || s.usuario_id, ?3
         FROM sessoes AS s WHERE s.id_hash = ?1`,
      )
      .bind(sessao.idHash, sessao.criadoEm, RESUMO_LOGIN_ADMIN),
    // Como no login pelo link (criarSessao): as vencidas, as paradas e a anterior deste navegador.
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
  return resultados[0]?.results[0]?.expira_em ?? null;
}
