/**
 * Relatório diário por e-mail e saldo da Efí (RIFA-086, D40). Sem zod: o site importa daqui os valores que mostra
 * (o saldo da Efí no cartão do admin). Os schemas e os catálogos das rotas ficam em ./api
 * (`ROTAS_RELATORIO_DIARIO` e `ROTAS_SALDO_EFI`).
 *
 * - O e-mail sai todo dia às 07:00 de Belém (`CRON_RELATORIO_DIARIO`, em UTC no wrangler.jsonc) com o DIA ANTERIOR
 *   fechado (o dia de referência é ontem no fuso da campanha). Antes do início e depois do fim da campanha, não sai.
 * - Os destinatários vêm só do segredo `RELATORIO_EMAILS` do Worker (lista separada por vírgula): nenhum e-mail no
 *   repositório, que é público.
 * - O saldo da Efí é só do admin: a rota exige o papel admin, e o cartão aparece só para ele.
 */

/** Cron do relatório (UTC): 10:00 UTC = 07:00 em Belém (UTC−3, sem horário de verão). */
export const CRON_RELATORIO_DIARIO = "0 10 * * *";

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

/**
 * Por que o saldo da Efí não veio (`erro` da resposta, só com a Efí configurada):
 * - autenticacao: a Efí recusou o token (client_id, client_secret ou certificado);
 * - consulta: a Efí respondeu com erro (ou a conexão caiu) na consulta do saldo;
 * - tempo_esgotado: a Efí não respondeu no tempo curto da consulta;
 * - resposta_invalida: a Efí respondeu 200 num formato que não é o da documentação.
 */
export const ERROS_SALDO_EFI = [
  "autenticacao",
  "consulta",
  "tempo_esgotado",
  "resposta_invalida",
] as const;
export type ErroSaldoEfi = (typeof ERROS_SALDO_EFI)[number];

/** Por quanto tempo a resposta do saldo vale (na memória do Worker): uma ida à Efí por minuto, no máximo. */
export const CACHE_SALDO_EFI_MS = 60_000;
