/**
 * Token do webhook da Rifei gerado pela tela da coordenação (RIFA-039, docs/decisions.md D21; tabela `token_webhook`
 * da migração 0009, uma linha no máximo, com `id` 1). No banco fica só o SHA-256 em hex do token; o token só existe
 * na resposta que o gera.
 *
 * - Webhook (routes/webhook-rifei.ts): LER_HASH_TOKEN_WEBHOOK, pela chave (`WHERE id = 1`), 1 linha lida com a tabela
 *   vazia ou não. A comparação é no Worker, em tempo constante; nunca `WHERE token_hash = ?`. Sem cache e sem a
 *   réplica de leitura do D1 (`withSession`): o token novo vale e o anterior para de valer na requisição seguinte.
 * - Tela (routes/webhook-token.ts): LER_GERADO_EM_TOKEN_WEBHOOK (o instante, nunca o hash) e, no GET, a última
 *   entrega (ULTIMA_ENTREGA de db/estado-webhook.ts) para o "último uso".
 * - Gravação (gravarTokenWebhook): um db.batch só, com o registro na trilha ANTES e sob a MESMA condição da gravação
 *   (D11). O resumo diz o que deixou de valer e nunca traz o token nem o hash.
 */
import {
  ALVO_AUDITORIA_TOKEN_WEBHOOK,
  type AcaoAuditoria,
} from "../../shared/contracts";
import { cortarResumo, type Autoria } from "./auditoria";
import { ULTIMA_ENTREGA } from "./estado-webhook";

/** A leitura do webhook: só o hash, pela chave primária (plano SEARCH ... USING INTEGER PRIMARY KEY; 1 linha). */
export const LER_HASH_TOKEN_WEBHOOK =
  "SELECT token_hash FROM token_webhook WHERE id = 1";

/** A leitura da tela: só quando o token foi gerado, pela chave. O hash não sai do banco para o GET nem o POST. */
export const LER_GERADO_EM_TOKEN_WEBHOOK =
  "SELECT gerado_em FROM token_webhook WHERE id = 1";

/** A ação da trilha (ACOES_AUDITORIA). */
const ACAO: AcaoAuditoria = "webhook.gerar_token";

/** O começo de todo resumo da trilha. */
const RESUMO = "Token do webhook gerado pela tela";

/** Os resumos da trilha (D21): o que deixou de valer. Nunca o token nem o hash. */
export const RESUMOS_TOKEN_WEBHOOK = {
  semCredencial: `${RESUMO}; não havia credencial`,
  segredo: `${RESUMO}; o segredo do Worker deixou de valer`,
  /** O token anterior: o texto vai em volta do `gerado_em` dele, lido por subconsulta dentro do lote. */
  anteriorAntes: `${RESUMO}; o token anterior, gerado em `,
  anteriorDepois: ", deixou de valer",
} as const;

/**
 * O SHA-256 do token da tela, ou null sem token da tela (vale o segredo do Worker, se houver). Sem try: se a leitura
 * falha, o erro sobe (o webhook responde 500 pelo onError e NUNCA cai para o segredo; D21).
 */
export async function lerHashDoTokenWebhook(
  db: D1Database,
): Promise<string | null> {
  const linha = await db
    .prepare(LER_HASH_TOKEN_WEBHOOK)
    .first<{ token_hash: string }>();
  return linha?.token_hash ?? null;
}

/** Quando o token da tela foi gerado; null sem token da tela. */
export async function lerGeradoEmDoTokenWebhook(
  db: D1Database,
): Promise<string | null> {
  const linha = await db
    .prepare(LER_GERADO_EM_TOKEN_WEBHOOK)
    .first<{ gerado_em: string }>();
  return linha?.gerado_em ?? null;
}

/** O que o GET precisa do banco: o `gerado_em` (1 linha) e a última entrega autenticada (~8 linhas). */
export interface LeituraTokenWebhook {
  geradoEm: string | null;
  ultimaEntregaEm: string | null;
}

/** As duas leituras do GET numa ida só (db.batch). */
export async function lerTokenWebhookParaATela(
  db: D1Database,
): Promise<LeituraTokenWebhook> {
  const [token, entrega] = await db.batch([
    db.prepare(LER_GERADO_EM_TOKEN_WEBHOOK),
    db.prepare(ULTIMA_ENTREGA),
  ]);
  return {
    geradoEm:
      (token.results[0] as { gerado_em: string } | undefined)?.gerado_em ??
      null,
    ultimaEntregaEm:
      (entrega.results[0] as { em: string | null } | undefined)?.em ?? null,
  };
}

/**
 * O registro da trilha. O resumo sai no SQL: com o token anterior, o `gerado_em` dele lido por subconsulta na hora
 * da gravação (é o que deixou de valer, mesmo que outra aba tenha gerado no meio); sem ele, ?7 (o segredo do Worker
 * ou "não havia credencial"). `condicao` é um trecho constante do código, o mesmo da gravação.
 */
function sqlRegistro(condicao: string): string {
  return `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
    SELECT ?1, ?2, ?3, ?4, substr(coalesce(?5 || (SELECT gerado_em FROM token_webhook WHERE id = 1) || ?6, ?7), 1, 1000)
    WHERE ${condicao}`;
}

/** Sem `substituir`: só grava se ainda não há token da tela (outra aba pode ter gerado entre a leitura e o lote). */
const SEM_TOKEN_DA_TELA = "NOT EXISTS (SELECT 1 FROM token_webhook)";

/** A gravação sem `substituir`: com uma linha já gravada, `changes` 0 (e o registro da trilha também não entra). */
export const GRAVAR_SE_NAO_HA_TOKEN = `INSERT INTO token_webhook (id, token_hash, gerado_em) VALUES (1, ?1, ?2)
  ON CONFLICT (id) DO NOTHING`;

/** A gravação com `substituir`: UPSERT na linha 1 (o anterior para de valer na requisição seguinte). */
export const SUBSTITUIR_TOKEN = `INSERT INTO token_webhook (id, token_hash, gerado_em) VALUES (1, ?1, ?2)
  ON CONFLICT (id) DO UPDATE SET token_hash = excluded.token_hash, gerado_em = excluded.gerado_em`;

export interface GravacaoTokenWebhook {
  /** sha256Hex do token novo (o token não chega aqui). */
  tokenHash: string;
  /**
   * true: substitui o que houver (UPSERT). false: só grava se ainda não há token da tela; a rota só chega aqui assim
   * sem credencial vigente (com o segredo do Worker, o 409 sai antes do lote).
   */
  substituir: boolean;
  /** O segredo do Worker conta como configurado: entra no resumo quando não há token da tela. */
  segredoConfigurado: boolean;
}

/**
 * Grava o hash do token novo e o registro da trilha num db.batch só (uma transação do D1), o registro antes e sob a
 * mesma condição. `autoria.em` é também o `gerado_em`. Devolve false só sem `substituir` e com um token da tela já
 * gravado (outra aba gerou no meio): nada mudou e a rota responde 409 `em_uso`.
 */
export async function gravarTokenWebhook(
  db: D1Database,
  gravacao: GravacaoTokenWebhook,
  autoria: Autoria,
): Promise<boolean> {
  const resumoSemToken = gravacao.segredoConfigurado
    ? RESUMOS_TOKEN_WEBHOOK.segredo
    : RESUMOS_TOKEN_WEBHOOK.semCredencial;
  const [, gravado] = await db.batch([
    db
      .prepare(sqlRegistro(gravacao.substituir ? "1" : SEM_TOKEN_DA_TELA))
      .bind(
        autoria.usuarioId,
        autoria.em,
        ACAO,
        ALVO_AUDITORIA_TOKEN_WEBHOOK,
        RESUMOS_TOKEN_WEBHOOK.anteriorAntes,
        RESUMOS_TOKEN_WEBHOOK.anteriorDepois,
        cortarResumo(resumoSemToken),
      ),
    db
      .prepare(gravacao.substituir ? SUBSTITUIR_TOKEN : GRAVAR_SE_NAO_HA_TOKEN)
      .bind(gravacao.tokenHash, autoria.em),
  ]);
  return gravado.meta.changes > 0;
}
