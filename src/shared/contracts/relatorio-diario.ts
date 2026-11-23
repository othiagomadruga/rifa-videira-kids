/**
 * Relatório diário por e-mail (RIFA-086 e RIFA-087, D40). Sem zod: o site e o Worker importam daqui os valores. Os
 * schemas e os catálogos das rotas ficam em ./api (`ROTAS_RELATORIO_DIARIO` e `ROTAS_ARRECADADO`).
 *
 * - Dois e-mails por dia (`CRONS_RELATORIO_DIARIO`, em UTC no wrangler.jsonc):
 *   - manhã, 07:00 de Belém (`CRON_RELATORIO_MANHA`): o DIA ANTERIOR fechado;
 *   - tarde, 17:00 de Belém (`CRON_RELATORIO_TARDE`): o DIA DE HOJE até a hora do envio (parcial).
 *   Fora da campanha (manhã: ontem fora; tarde: hoje fora), não sai.
 * - Os destinatários vêm só do segredo `RELATORIO_EMAILS` do Worker (lista separada por vírgula): nenhum e-mail no
 *   repositório, que é público.
 * - O dinheiro que entrou vem do banco: a soma dos pedidos pagos que a Rifei manda pelo webhook (D2, D32), a mesma
 *   regra do total da campanha no painel. O saldo da Efí saiu (RIFA-087, adendo da D40): não há consulta à Efí.
 */

/** Os dois envios do dia: `manha` (o dia anterior fechado) e `tarde` (o dia de hoje até a hora do envio). */
export const TIPOS_RELATORIO_DIARIO = ["manha", "tarde"] as const;
export type TipoRelatorioDiario = (typeof TIPOS_RELATORIO_DIARIO)[number];

/** Sem `tipo` na prévia e no envio do admin, é o da manhã (o e-mail de sempre). */
export const TIPO_RELATORIO_DIARIO_PADRAO: TipoRelatorioDiario = "manha";

/** Cron da manhã (UTC): 10:00 UTC = 07:00 em Belém (UTC−3, sem horário de verão), com o dia anterior. */
export const CRON_RELATORIO_MANHA = "0 10 * * *";

/** Cron da tarde (UTC): 20:00 UTC = 17:00 em Belém, com o dia de hoje até a hora do envio. */
export const CRON_RELATORIO_TARDE = "0 20 * * *";

/** O tipo de cada cron: o `scheduled` escolhe o envio pelo `controller.cron` (outro cron só avisa no log). */
export const CRONS_RELATORIO_DIARIO = {
  manha: CRON_RELATORIO_MANHA,
  tarde: CRON_RELATORIO_TARDE,
} as const satisfies Record<TipoRelatorioDiario, string>;

/** Remetente do e-mail (o domínio precisa estar no Email Routing da Cloudflare: docs/lancamento.md). */
export const REMETENTE_RELATORIO_DIARIO = {
  nome: "Projeto Videira Kids",
  email: "relatorio@projetokidsbelem.com.br",
} as const;

/** O botão "Abrir o painel completo" do e-mail: a Visão geral da coordenação. */
export const LINK_PAINEL_RELATORIO_DIARIO =
  "https://projetokidsbelem.com.br/coordenacao";

/** Teto de destinatários lidos do segredo (o pastor e o PO; o resto é ignorado e avisado no log). */
export const LIMITE_DESTINATARIOS_RELATORIO_DIARIO = 10;

/** Quantas células entram em "Células que mais avançaram". */
export const CELULAS_NO_RELATORIO_DIARIO = 5;

/** Content-Type da prévia do e-mail (GET /api/admin/relatorio-diario/previa): o HTML, para ver no navegador. */
export const TIPO_CONTEUDO_HTML = "text/html; charset=utf-8";

/** Todo HTML do relatório começa assim (a prévia e o corpo HTML do e-mail são o mesmo texto). */
export const INICIO_HTML_RELATORIO_DIARIO = "<!doctype html>";
