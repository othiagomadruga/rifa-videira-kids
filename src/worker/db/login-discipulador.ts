/**
 * Login do discipulador com o nome e a senha padrão (RIFA-082; docs/decisions.md D37), no D1. A rota é
 * src/worker/routes/acesso.ts (POST /api/sessao/discipulador); a senha e a normalização, a regra da célula
 * (src/shared/contracts/login-discipulador.ts e login-celula.ts). O desenho é o do login da célula (db/login-celula.ts).
 *
 * - A senha nunca chega aqui: a rota a deriva do nome do discipulador e compara em tempo constante. Esta camada só lê
 *   os discipuladores (para a rota achar o do nome digitado) e abre a sessão do discipulador escolhido.
 * - A sessão é a do papel `discipulador` preso ao discipulador, no mesmo usuário do link dele (um usuário por
 *   discipulador, 0006). Se ele ainda não tem esse usuário (nenhum link gerado), o usuário nasce aqui com o nome do
 *   discipulador, como no lote de links (o `pessoa_nome` do discipulador é o nome dele); se já tem, o nome acompanha o da
 *   hierarquia (como no lote). Usuário desativado não entra (nem por senha).
 * - A sessão não tem link (`sessoes.link_id` NULL): é assim que a consulta da sessão a reconhece como aberta pela senha
 *   e a derruba quando qualquer uma das duas chaves, `acesso.celulas_senha` ou `acesso.discipuladores`, é desligada
 *   (SQL_LOGIN_DISCIPULADORES_SENHA_LIGADO, de db/regras-campanha.ts, na consulta da sessão em db/acessos.ts). Vale até
 *   login + 45 dias (não há link para encurtar) e cai parada há 7 dias, como as outras.
 * - Tudo num db.batch (uma transação): o usuário (se faltar), o nome, a sessão, a linha da trilha (só se a sessão
 *   nasceu, sem a senha) e a limpeza das sessões vencidas, paradas e da anterior deste navegador. As chaves e o usuário
 *   ativo são conferidos de novo DENTRO do lote: um admin que desliga uma chave ou desativa o discipulador ao mesmo
 *   tempo não deixa a sessão nascer.
 */
import { limiteDeInatividade } from "./acessos";
import { SQL_LOGIN_DISCIPULADORES_SENHA_LIGADO } from "./regras-campanha";

/** Os discipuladores para a rota achar o do nome digitado, e as chaves lidas no mesmo lote. */
export interface DiscipuladoresParaLogin {
  /** As duas chaves (`acesso.celulas_senha` e `acesso.discipuladores`) ligadas na campanha ativa. */
  ligado: boolean;
  discipuladores: { id: number; nome: string }[];
}

/**
 * Todos os discipuladores (id e nome) e as chaves do login por senha. A normalização (sem acentos) não cabe no SQLite:
 * a rota compara em JavaScript. A campanha tem uns 12 discipuladores; o limite de tentativas por IP (LIMITE_LOGIN)
 * segura o custo de cada tentativa.
 */
export async function lerDiscipuladoresParaLogin(
  db: D1Database,
): Promise<DiscipuladoresParaLogin> {
  const [chave, discipuladores] = await db.batch([
    db.prepare(`SELECT ${SQL_LOGIN_DISCIPULADORES_SENHA_LIGADO} AS ligado`),
    db.prepare("SELECT id, nome FROM discipuladores ORDER BY id"),
  ]);
  return {
    ligado: (chave.results[0] as { ligado: number } | undefined)?.ligado === 1,
    discipuladores: discipuladores.results as { id: number; nome: string }[],
  };
}

export interface NovaSessaoDoDiscipulador {
  discipuladorId: number;
  /** SHA-256 do id da sessão (o valor do cookie). */
  idHash: string;
  criadoEm: string;
  /** Login + VALIDADE_SESSAO_DIAS. */
  expiraEm: string;
  /** Hash do cookie que o navegador já tinha: essa sessão antiga é encerrada no login. */
  idHashAnterior: string | null;
}

/** O resumo da linha da trilha: nunca a senha (ela nem chega a esta camada). */
export const RESUMO_LOGIN_SENHA_DISCIPULADOR =
  "Entrada com a senha padrão do discipulador: sessão de discipulador aberta (sem link)";

/**
 * Abre a sessão do discipulador (o usuário dele nasce se faltar). Devolve a validade gravada, ou null se a sessão não
 * nasceu: uma das chaves foi desligada, o discipulador sumiu ou o usuário dele está desativado (a rota responde o mesmo
 * 401 da senha errada).
 */
export async function abrirSessaoDoDiscipulador(
  db: D1Database,
  sessao: NovaSessaoDoDiscipulador,
): Promise<string | null> {
  const resultados = await db.batch<{ expira_em: string }>([
    // O usuário do discipulador, se ainda não existe (o índice único da 0006: um por discipulador).
    db
      .prepare(
        `INSERT INTO usuarios (nome, papel, discipulador_id, criado_em)
         SELECT d.nome, 'discipulador', d.id, ?2 FROM discipuladores AS d
         WHERE d.id = ?1 AND ${SQL_LOGIN_DISCIPULADORES_SENHA_LIGADO}
           AND NOT EXISTS (SELECT 1 FROM usuarios WHERE discipulador_id = ?1)`,
      )
      .bind(sessao.discipuladorId, sessao.criadoEm),
    // O nome acompanha o do discipulador na hierarquia (como no lote de links); só escreve se mudou.
    db
      .prepare(
        `UPDATE usuarios SET nome = (SELECT nome FROM discipuladores WHERE id = ?1)
         WHERE discipulador_id = ?1 AND ativo = 1 AND ${SQL_LOGIN_DISCIPULADORES_SENHA_LIGADO}
           AND nome IS NOT (SELECT nome FROM discipuladores WHERE id = ?1)`,
      )
      .bind(sessao.discipuladorId),
    db
      .prepare(
        `INSERT INTO sessoes (id_hash, usuario_id, link_id, criado_em, expira_em, ultimo_uso_em)
         SELECT ?2, u.id, NULL, ?3, ?4, ?3 FROM usuarios AS u
         WHERE u.discipulador_id = ?1 AND u.papel = 'discipulador' AND u.ativo = 1
           AND ${SQL_LOGIN_DISCIPULADORES_SENHA_LIGADO}
         RETURNING expira_em`,
      )
      .bind(
        sessao.discipuladorId,
        sessao.idHash,
        sessao.criadoEm,
        sessao.expiraEm,
      ),
    // A trilha (0005): quem entrou é o usuário do discipulador; só se a sessão nasceu neste lote.
    db
      .prepare(
        `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
         SELECT s.usuario_id, ?2, 'sessao.entrar_com_senha_discipulador', ?3, ?4
         FROM sessoes AS s WHERE s.id_hash = ?1`,
      )
      .bind(
        sessao.idHash,
        sessao.criadoEm,
        `discipulador:${sessao.discipuladorId}`,
        RESUMO_LOGIN_SENHA_DISCIPULADOR,
      ),
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
  return resultados[2]?.results[0]?.expira_em ?? null;
}
