/**
 * As inscrições das notificações de venda (RIFA-095, D43; tabela `push_inscricoes`, migração 0022) e a leitura da venda
 * que vira notificação. O endpoint de cada inscrição nunca sai daqui para log, resposta ou trilha.
 */
import type { OrigemInscricaoPush } from "../../shared/contracts";
import { juntarAfiliado, juntarCelulaEfetiva } from "./celula-efetiva";

export interface NovaInscricao {
  endpoint: string;
  p256dh: string;
  auth: string;
  origem: OrigemInscricaoPush;
  agora: string;
}

/**
 * Grava a inscrição ou, se o endpoint já existe (o mesmo aparelho de novo), troca as chaves e a origem e zera as
 * falhas. `criado_em` e `ultimo_envio_em` ficam como estavam.
 */
export async function gravarInscricao(
  db: D1Database,
  inscricao: NovaInscricao,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_inscricoes (endpoint, p256dh, auth, origem, criado_em)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh = excluded.p256dh, auth = excluded.auth, origem = excluded.origem, falhas = 0`,
    )
    .bind(
      inscricao.endpoint,
      inscricao.p256dh,
      inscricao.auth,
      inscricao.origem,
      inscricao.agora,
    )
    .run();
}

/** Apaga a inscrição do endpoint (nada acontece se ela não existe). */
export async function apagarInscricao(
  db: D1Database,
  endpoint: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM push_inscricoes WHERE endpoint = ?1")
    .bind(endpoint)
    .run();
}

/** Uma inscrição para o envio. */
export interface InscricaoParaEnvio {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Até `limite` inscrições, na ordem do envio: as que nunca receberam, depois a que recebeu há mais tempo (o índice
 * push_inscricoes_por_envio, sem ordenar). Com mais inscrições que o teto, quem ficou de fora numa venda vem primeiro
 * na seguinte.
 */
export async function lerInscricoesParaEnvio(
  db: D1Database,
  limite: number,
): Promise<InscricaoParaEnvio[]> {
  const { results } = await db
    .prepare(
      `SELECT id, endpoint, p256dh, auth FROM push_inscricoes
       ORDER BY ultimo_envio_em, id LIMIT ?1`,
    )
    .bind(limite)
    .all<InscricaoParaEnvio>();
  return results;
}

export async function contarInscricoes(db: D1Database): Promise<number> {
  const linha = await db
    .prepare("SELECT count(*) AS n FROM push_inscricoes")
    .first<{ n: number }>();
  return linha?.n ?? 0;
}

export interface ResultadosDosEnvios {
  aceitas: number[];
  expiradas: number[];
  falharam: number[];
  agora: string;
  /** Com este número de falhas seguidas, a inscrição é apagada. */
  falhasParaApagar: number;
}

/**
 * Grava o resultado de um disparo num lote só (4 comandos, com qualquer número de inscrições): as aceitas ficam com o
 * envio de agora e sem falhas; as expiradas (404 e 410) são apagadas; as que falharam somam uma falha e, com
 * `falhasParaApagar` seguidas, são apagadas.
 */
export async function gravarResultadosDosEnvios(
  db: D1Database,
  resultados: ResultadosDosEnvios,
): Promise<void> {
  const ids = (lista: number[]) => JSON.stringify(lista);
  await db.batch([
    db
      .prepare(
        `UPDATE push_inscricoes SET ultimo_envio_em = ?1, falhas = 0
         WHERE id IN (SELECT value FROM json_each(?2))`,
      )
      .bind(resultados.agora, ids(resultados.aceitas)),
    db
      .prepare(
        "DELETE FROM push_inscricoes WHERE id IN (SELECT value FROM json_each(?1))",
      )
      .bind(ids(resultados.expiradas)),
    db
      .prepare(
        `UPDATE push_inscricoes SET falhas = falhas + 1
         WHERE id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(ids(resultados.falharam)),
    db
      .prepare(
        `DELETE FROM push_inscricoes
         WHERE id IN (SELECT value FROM json_each(?1)) AND falhas >= ?2`,
      )
      .bind(ids(resultados.falharam), resultados.falhasParaApagar),
  ]);
}

/** A venda que pode virar notificação: os bilhetes, o nome da célula efetiva e o instante da aprovação. */
export interface VendaParaNotificar {
  bilhetes: number;
  celula: string;
  aprovado_em: string;
}

/**
 * O pedido da campanha, se ele CONTA agora: aprovado, sem desconsiderar e com célula EFETIVA (a do afiliado ou, sem
 * ela, a atribuída à mão; D41). Senão, null (a venda sem célula não notifica). A de 0 bilhetes (o webhook aceita
 * `numbers_count` 0) também não: não há o que anunciar (como nos avisos da página, D42). Uma ida ao D1, pela chave
 * do pedido.
 */
export async function lerVendaParaNotificar(
  db: D1Database,
  campanhaId: number,
  pedidoId: string,
): Promise<VendaParaNotificar | null> {
  return db
    .prepare(
      `SELECT p.qtd_bilhetes AS bilhetes, c.nome AS celula, p.aprovado_em AS aprovado_em
       FROM pedidos AS p
         ${juntarAfiliado()}
         ${juntarCelulaEfetiva()}
       WHERE p.id = ?1 AND p.campanha_id = ?2 AND p.status = 'approved'
         AND p.desconsiderado_em IS NULL AND c.id IS NOT NULL AND p.aprovado_em IS NOT NULL
         AND p.qtd_bilhetes > 0`,
    )
    .bind(pedidoId, campanhaId)
    .first<VendaParaNotificar>();
}

/** A opção da campanha ativa (1 = envia), ou null sem campanha ativa. Um comando pequeno. */
export async function lerOpcaoDasNotificacoes(
  db: D1Database,
): Promise<boolean | null> {
  const linha = await db
    .prepare("SELECT notificacoes_vendas FROM campanhas WHERE ativa = 1")
    .first<{ notificacoes_vendas: number }>();
  return linha === null ? null : linha.notificacoes_vendas !== 0;
}
