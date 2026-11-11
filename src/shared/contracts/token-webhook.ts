/**
 * Token do webhook da Rifei gerado pela tela da coordenação (RIFA-039; docs/decisions.md D21). O admin gera o token
 * no site e cola direto na Rifei (menu do usuário → Integrações → Outro → Adicionar), sem Node, wrangler, chat,
 * e-mail ou WhatsApp. O segredo do Worker `RIFEI_WEBHOOK_TOKEN` (D6 da integração) continua valendo, mas só sem o
 * token da tela.
 *
 * Sem zod, como regras.ts: o site importa daqui (formato, credenciais e as regras puras) sem levar o zod para o
 * pacote. Os schemas e o catálogo das rotas (ROTAS_TOKEN_WEBHOOK) ficam em api.ts.
 */

/** Tamanho do token em bytes (256 bits de crypto.getRandomValues), como os links de acesso (D8). */
export const BYTES_TOKEN_WEBHOOK = 32;

/**
 * Formato do token gerado pela tela: os 32 bytes em hex minúsculo, 64 caracteres. Só letras e números (o mesmo
 * formato do `openssl rand -hex 32` do roteiro): nada de `+`, `/`, `=`, `-` ou `_` que o formulário da Rifei possa
 * cortar ou que o toque longo do celular pare de selecionar. O segredo do Worker pode ter outro formato.
 *
 * ATENÇÃO: é o mesmo formato do SHA-256 em hex que vai para o banco, então o CHECK da coluna não distingue o token
 * do hash. O teste de varredura (nenhuma tabela guarda o token) é obrigatório na -db e na -api (D21).
 */
export const FORMATO_TOKEN_WEBHOOK = /^[0-9a-f]{64}$/;

/**
 * A credencial que autentica o webhook agora (D21):
 * - tela: o token gerado pela tela (no banco, só o SHA-256);
 * - segredo: o segredo do Worker `RIFEI_WEBHOOK_TOKEN` (só quando não há token da tela).
 */
export const CREDENCIAIS_WEBHOOK = ["tela", "segredo"] as const;
export type CredencialWebhook = (typeof CREDENCIAIS_WEBHOOK)[number];

/** O `alvo` da trilha na ação `webhook.gerar_token` (sem id: há um token só). */
export const ALVO_AUDITORIA_TOKEN_WEBHOOK = "webhook";

/**
 * O segredo do Worker conta como configurado quando existe e não é só espaço (é o que o webhook já fazia antes da
 * D21: vazio no `.dev.vars` dá 503).
 */
export function segredoDoWorkerConfigurado(valor: string | undefined): boolean {
  return valor !== undefined && valor.trim() !== "";
}

/**
 * A regra da D21 para quando existem os dois: **o token da tela tem prioridade**. Com ele, só ele vale e o segredo
 * do Worker é ignorado; sem ele, vale o segredo; sem nenhum dos dois, null (o webhook responde 503
 * `nao_configurado`).
 */
export function credencialVigenteDoWebhook(credenciais: {
  readonly tokenDaTela: boolean;
  readonly segredoConfigurado: boolean;
}): CredencialWebhook | null {
  if (credenciais.tokenDaTela) return "tela";
  return credenciais.segredoConfigurado ? "segredo" : null;
}

/**
 * O "último uso" que a tela mostra, calculado na leitura (o webhook não escreve nada a mais, D21). `ultimaEntregaEm`
 * é a última entrega AUTENTICADA gravada em webhook_eventos, de qualquer resultado (inclusive as recusadas pelo
 * corpo, 400 e 413; 401, 503 e 500 não são gravadas). Instantes no formato único da API (a ordem do texto é a do
 * tempo).
 * - tela: a última entrega recebida em ou depois de `geradoEm` (antes disso, quem autenticou foi outra credencial);
 *   null = o token novo ainda não foi usado (a Rifei ainda não mandou nada com ele);
 * - segredo: a última entrega;
 * - nenhuma: null.
 */
export function ultimoUsoDoWebhook(
  vigente: CredencialWebhook | null,
  geradoEm: string | null,
  ultimaEntregaEm: string | null,
): string | null {
  if (vigente === null || ultimaEntregaEm === null) return null;
  if (vigente === "segredo") return ultimaEntregaEm;
  return geradoEm !== null && ultimaEntregaEm >= geradoEm
    ? ultimaEntregaEm
    : null;
}
