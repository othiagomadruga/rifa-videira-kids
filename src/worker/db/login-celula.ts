/**
 * Login da célula com a senha padrão (RIFA-064; docs/decisions.md D29), no D1. A rota é src/worker/routes/acesso.ts
 * (POST /api/sessao/senha); a senha e a normalização, src/shared/contracts/login-celula.ts.
 *
 * - A senha nunca chega aqui: a rota a deriva do nome da célula e compara em tempo constante. Esta camada só lê as
 *   células (para a rota achar a do nome digitado) e abre a sessão da célula escolhida.
 * - A sessão é a do papel `lider` preso à célula, no mesmo usuário do link do líder (um usuário por célula, 0006). Se
 *   a célula ainda não tem esse usuário (nenhum link gerado), ele nasce aqui com o `lider_nome` da hierarquia (o
 *   líder da importação, mesmo provisório), como no lote de links; se já tem, o nome acompanha o `lider_nome` atual
 *   (como no lote). Usuário desativado não entra (nem por senha).
 * - A sessão não tem link (`sessoes.link_id` NULL): é assim que a consulta da sessão a reconhece como aberta pela
 *   senha e a derruba quando a chave `acesso.celulas_senha` é desligada (SQL_LOGIN_CELULAS_SENHA_LIGADO, de
 *   db/regras-campanha.ts, na consulta da sessão em db/acessos.ts). Vale até login + 45 dias (não há link para encurtar) e cai parada há 7 dias, como as outras.
 * - Tudo num db.batch (uma transação): o usuário (se faltar), a sessão, a linha da trilha (só se a sessão nasceu,
 *   sem a senha) e a limpeza das sessões vencidas, paradas e da anterior deste navegador. A chave e o usuário ativo
 *   são conferidos de novo DENTRO do lote: um admin que desliga a chave ou desativa a célula ao mesmo tempo não deixa
 *   a sessão nascer.
 */
import { limiteDeInatividade } from "./acessos";
import { SQL_LOGIN_CELULAS_SENHA_LIGADO } from "./regras-campanha";

/** As células para a rota achar a do nome digitado, e a chave lida no mesmo lote. */
export interface CelulasParaLogin {
  ligado: boolean;
  celulas: { id: number; nome: string }[];
}

/**
 * Todas as células (id e nome) e a chave do login por senha. A normalização (sem acentos) não cabe no SQLite: a rota
 * compara em JavaScript. A campanha tem dezenas de células; o limite de tentativas por IP (LIMITE_LOGIN) segura o
 * custo de cada tentativa.
 */
export async function lerCelulasParaLogin(
  db: D1Database,
): Promise<CelulasParaLogin> {
  const [chave, celulas] = await db.batch([
    db.prepare(`SELECT ${SQL_LOGIN_CELULAS_SENHA_LIGADO} AS ligado`),
    db.prepare("SELECT id, nome FROM celulas ORDER BY id"),
  ]);
  return {
    ligado: (chave.results[0] as { ligado: number } | undefined)?.ligado === 1,
    celulas: celulas.results as { id: number; nome: string }[],
  };
}

export interface NovaSessaoDaCelula {
  celulaId: number;
  /** SHA-256 do id da sessão (o valor do cookie). */
  idHash: string;
  criadoEm: string;
  /** Login + VALIDADE_SESSAO_DIAS. */
  expiraEm: string;
  /** Hash do cookie que o navegador já tinha: essa sessão antiga é encerrada no login. */
  idHashAnterior: string | null;
}

/** O resumo da linha da trilha: nunca a senha (ela nem chega a esta camada). */
export const RESUMO_LOGIN_SENHA =
  "Entrada com a senha padrão da célula: sessão de líder aberta (sem link)";

/**
 * Abre a sessão do líder da célula (o usuário dela nasce se faltar). Devolve a validade gravada, ou null se a sessão
 * não nasceu: a chave foi desligada, a célula sumiu ou o usuário dela está desativado (a rota responde o mesmo 401 da
 * senha errada).
 */
export async function abrirSessaoDaCelula(
  db: D1Database,
  sessao: NovaSessaoDaCelula,
): Promise<string | null> {
  const resultados = await db.batch<{ expira_em: string }>([
    // O usuário líder da célula, se ainda não existe (o índice único da 0006: um por célula).
    db
      .prepare(
        `INSERT INTO usuarios (nome, papel, celula_id, criado_em)
         SELECT c.lider_nome, 'lider', c.id, ?2 FROM celulas AS c
         WHERE c.id = ?1 AND ${SQL_LOGIN_CELULAS_SENHA_LIGADO}
           AND NOT EXISTS (SELECT 1 FROM usuarios WHERE celula_id = ?1)`,
      )
      .bind(sessao.celulaId, sessao.criadoEm),
    // O nome acompanha o líder da hierarquia (como no lote de links); só escreve se mudou.
    db
      .prepare(
        `UPDATE usuarios SET nome = (SELECT lider_nome FROM celulas WHERE id = ?1)
         WHERE celula_id = ?1 AND ativo = 1 AND ${SQL_LOGIN_CELULAS_SENHA_LIGADO}
           AND nome IS NOT (SELECT lider_nome FROM celulas WHERE id = ?1)`,
      )
      .bind(sessao.celulaId),
    db
      .prepare(
        `INSERT INTO sessoes (id_hash, usuario_id, link_id, criado_em, expira_em, ultimo_uso_em)
         SELECT ?2, u.id, NULL, ?3, ?4, ?3 FROM usuarios AS u
         WHERE u.celula_id = ?1 AND u.papel = 'lider' AND u.ativo = 1 AND ${SQL_LOGIN_CELULAS_SENHA_LIGADO}
         RETURNING expira_em`,
      )
      .bind(sessao.celulaId, sessao.idHash, sessao.criadoEm, sessao.expiraEm),
    // A trilha (0005): quem entrou é o usuário líder da célula; só se a sessão nasceu neste lote.
    db
      .prepare(
        `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
         SELECT s.usuario_id, ?2, 'sessao.entrar_com_senha', ?3, ?4
         FROM sessoes AS s WHERE s.id_hash = ?1`,
      )
      .bind(
        sessao.idHash,
        sessao.criadoEm,
        `celula:${sessao.celulaId}`,
        RESUMO_LOGIN_SENHA,
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
