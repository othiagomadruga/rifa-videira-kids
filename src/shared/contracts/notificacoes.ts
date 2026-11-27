/**
 * Notificações de venda no celular e no computador (RIFA-095, docs/decisions.md D43): Web Push padrão (RFC 8030, com a
 * criptografia da RFC 8291 e a identificação VAPID da RFC 8292), com as chaves do próprio Worker e sem serviço de
 * terceiros. Cada compra paga que passa a contar vira, em todo aparelho inscrito, a notificação
 * "🎟️ A célula <nome> vendeu N bilhetes!" (sem o comprador, sem R$). Tocar nela abre o ranking aberto ("/").
 *
 * Aqui ficam o que o Worker e o site dividem: as rotas abertas (ROTAS_NOTIFICACOES), os corpos, a lista dos serviços
 * de push aceitos (contra SSRF), o texto da notificação e a opção da campanha (`notificacoes.vendas`).
 */
import { z } from "zod";
import type { DefinicaoRota } from "./api";

// ---------------------------------------------------------------------------------------------------
// A opção da campanha
// ---------------------------------------------------------------------------------------------------

/** RIFA-095 (D43): as notificações de venda começam ligadas. */
export const NOTIFICACOES_PADRAO = { vendas: true } as const;

/**
 * As notificações da campanha (RIFA-095, D43). `vendas` ("Enviar notificações de venda" na tela Campanha): desligada,
 * o botão "Receber avisos de venda" some (GET /api/publico/notificacoes diz `ligadas: false`), a inscrição é recusada
 * (409 `acao_desligada`) e nada é enviado. As inscrições que já existem ficam guardadas e voltam a receber quando a
 * opção volta. Padrão: ligada (NOTIFICACOES_PADRAO). Grupo da coordenação (como o `publico`), não só do admin.
 */
export const notificacoesConfigSchema = z.object({
  vendas: z.boolean(),
});
export type NotificacoesConfig = z.infer<typeof notificacoesConfigSchema>;

// ---------------------------------------------------------------------------------------------------
// Serviços de push aceitos (SSRF)
// ---------------------------------------------------------------------------------------------------

/**
 * Os serviços de push dos navegadores, pelo nome exato do servidor: o do Chrome, do Edge no Android, do Samsung
 * Internet e do Opera (FCM, Google), o do Firefox (Mozilla) e o do Safari (Apple, iPhone a partir do iOS 16.4 e Mac).
 */
export const SERVIDORES_DE_PUSH = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
] as const;

/** O do Edge no computador (WNS, Microsoft): `<região>.notify.windows.com`. */
export const SUFIXO_PUSH_MICROSOFT = ".notify.windows.com";

/** O endpoint mais longo aceito (os reais têm de 150 a 500 caracteres). */
export const LIMITE_ENDPOINT_PUSH = 2048;

/**
 * O endpoint é de um serviço de push conhecido? Só `https:`, sem usuário, senha nem porta, e o servidor de
 * SERVIDORES_DE_PUSH (ou um `<nome>.notify.windows.com`). Qualquer outro (um IP, `localhost`, um servidor da rede da
 * Cloudflare ou da igreja) é recusado: o Worker faz um POST para este endereço a cada venda, e assim ele nunca vira um
 * jeito de mandar requisições para onde alguém quiser (SSRF).
 */
export function endpointDePushPermitido(endpoint: string): boolean {
  if (endpoint.length > LIMITE_ENDPOINT_PUSH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "")
    return false;
  if (url.port !== "") return false;
  const servidor = url.hostname;
  if ((SERVIDORES_DE_PUSH as readonly string[]).includes(servidor)) return true;
  if (!servidor.endsWith(SUFIXO_PUSH_MICROSOFT)) return false;
  const prefixo = servidor.slice(0, -SUFIXO_PUSH_MICROSOFT.length);
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(
    prefixo,
  );
}

// ---------------------------------------------------------------------------------------------------
// Corpos e respostas
// ---------------------------------------------------------------------------------------------------

/** Base64url sem `=` (o navegador pode mandar com: a entrada tira). */
const base64UrlDe = (caracteres: number) =>
  z
    .string()
    .max(caracteres + 2)
    .transform((valor) => valor.replace(/=+$/, ""))
    .pipe(z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${caracteres}}$`)));

/** A chave pública P-256 do aparelho, sem compressão (65 bytes: 87 caracteres em base64url). */
export const FORMATO_CHAVE_P256 = /^B[A-Za-z0-9_-]{86}$/;
/** O segredo de autenticação do aparelho (16 bytes: 22 caracteres em base64url). */
export const FORMATO_SEGREDO_AUTH = /^[A-Za-z0-9_-]{22}$/;

/** De onde a inscrição veio: o ranking aberto ou o painel dos líderes (/minha). Só para contar. */
export const ORIGENS_INSCRICAO_PUSH = ["publico", "minha"] as const;
export type OrigemInscricaoPush = (typeof ORIGENS_INSCRICAO_PUSH)[number];

const endpointSchema = z
  .string()
  .min(1)
  .max(LIMITE_ENDPOINT_PUSH)
  .refine(endpointDePushPermitido, {
    message: "O endereço não é de um serviço de notificações conhecido",
  });

/**
 * POST /api/publico/notificacoes/inscrever: a inscrição do navegador (PushSubscription), com o nome dos campos em
 * português. Gravada pelo `endpoint` (repetir troca as chaves e zera as falhas).
 */
export const corpoInscreverNotificacoesSchema = z.strictObject({
  endpoint: endpointSchema,
  chaves: z.strictObject({
    p256dh: base64UrlDe(87).pipe(z.string().regex(FORMATO_CHAVE_P256)),
    auth: base64UrlDe(22),
  }),
  origem: z.enum(ORIGENS_INSCRICAO_PUSH),
});
export type CorpoInscreverNotificacoes = z.input<
  typeof corpoInscreverNotificacoesSchema
>;

/** POST /api/publico/notificacoes/cancelar: só o endpoint (o aparelho que desliga). */
export const corpoCancelarNotificacoesSchema = z.strictObject({
  endpoint: z.string().min(1).max(LIMITE_ENDPOINT_PUSH),
});
export type CorpoCancelarNotificacoes = z.input<
  typeof corpoCancelarNotificacoesSchema
>;

/**
 * GET /api/publico/notificacoes: o site mostra o botão só com `ligadas: true` (as chaves VAPID configuradas no
 * servidor, uma campanha ativa e a opção `notificacoes.vendas` ligada). `chave_publica` é a chave VAPID pública
 * (applicationServerKey da inscrição), só com `ligadas`.
 */
export const respostaEstadoNotificacoesSchema = z
  .strictObject({
    ligadas: z.boolean(),
    chave_publica: z.string().regex(FORMATO_CHAVE_P256).nullable(),
  })
  .refine((estado) => estado.ligadas === (estado.chave_publica !== null), {
    message: "A chave pública vem só com as notificações ligadas",
  });
export type RespostaEstadoNotificacoes = z.infer<
  typeof respostaEstadoNotificacoesSchema
>;

// ---------------------------------------------------------------------------------------------------
// A notificação
// ---------------------------------------------------------------------------------------------------

/** O título de toda notificação. */
export const TITULO_NOTIFICACAO = "Projeto Videira Kids";
/** Para onde o toque na notificação leva: o ranking aberto. */
export const URL_NOTIFICACAO = "/";

/** Tira acento e caixa (para ver se o nome já começa com "Célula"). */
const semAcento = (texto: string) =>
  texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * "🎟️ A célula Betel vendeu 3 bilhetes!" ("1 bilhete" no singular). Um nome que já começa com "Célula" não ganha a
 * palavra de novo ("🎟️ A Célula Betel vendeu..."). Nada do comprador e nenhum valor em R$.
 */
export function textoDaNotificacaoDeVenda(
  celula: string,
  bilhetes: number,
): string {
  const nome = celula.trim();
  const sujeito = semAcento(nome).startsWith("celula ")
    ? `A ${nome}`
    : `A célula ${nome}`;
  const quantidade = `${bilhetes} ${bilhetes === 1 ? "bilhete" : "bilhetes"}`;
  return `🎟️ ${sujeito} vendeu ${quantidade}!`;
}

/**
 * O que vai criptografado dentro de cada push (o service worker, public/sw.js, mostra): o título, o texto e a URL do
 * toque. Mais nada: nem id do pedido, nem comprador, nem valor.
 */
export const notificacaoDeVendaSchema = z.strictObject({
  titulo: z.literal(TITULO_NOTIFICACAO),
  corpo: z.string().min(1).max(200),
  url: z.literal(URL_NOTIFICACAO),
});
export type NotificacaoDeVenda = z.infer<typeof notificacaoDeVendaSchema>;

/** A notificação de uma venda (o corpo de textoDaNotificacaoDeVenda). */
export function montarNotificacaoDeVenda(
  celula: string,
  bilhetes: number,
): NotificacaoDeVenda {
  return notificacaoDeVendaSchema.parse({
    titulo: TITULO_NOTIFICACAO,
    corpo: textoDaNotificacaoDeVenda(celula, bilhetes),
    url: URL_NOTIFICACAO,
  });
}

// ---------------------------------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------------------------------

/**
 * As três rotas das notificações (RIFA-095, D43), abertas como as de /api/publico (sem login): quem quiser recebe.
 * Catálogo à parte de ROTAS, como ROTAS_TODAS_AS_REDES; o src/worker/protecao.test.ts o põe nas listas dele.
 *
 * - GET estado: 200 sempre (sem campanha ativa ou sem as chaves, `ligadas: false`), com o cache curto das rotas
 *   abertas (D10: 30 s, e o limite por IP só nas idas ao banco).
 * - POST inscrever e cancelar: só da mesma origem do site (403 `proibido`), limite por IP (429), corpo de até 4 KiB
 *   (413), JSON do schema (400; o endpoint fora da lista de serviços também é 400, sem ecoar o valor). Inscrever: 503
 *   `nao_configurado` sem as chaves VAPID no servidor e 409 `acao_desligada` sem campanha ativa ou com a opção
 *   desligada; 204 gravada (ou trocada, pelo endpoint). Cancelar: 204 sempre (apagada ou não existia). Respostas com
 *   `no-store`. O endpoint nunca vai para log, resposta ou trilha.
 */
export const ROTAS_NOTIFICACOES = {
  estadoNotificacoes: {
    metodo: "GET",
    caminho: "/api/publico/notificacoes",
    grupo: "aberto",
    situacao: "detalhada",
    sucesso: { status: 200, corpo: respostaEstadoNotificacoesSchema },
  },
  inscreverNotificacoes: {
    metodo: "POST",
    caminho: "/api/publico/notificacoes/inscrever",
    grupo: "aberto",
    situacao: "detalhada",
    corpo: corpoInscreverNotificacoesSchema,
    sucesso: { status: 204, corpo: null },
  },
  cancelarNotificacoes: {
    metodo: "POST",
    caminho: "/api/publico/notificacoes/cancelar",
    grupo: "aberto",
    situacao: "detalhada",
    corpo: corpoCancelarNotificacoesSchema,
    sucesso: { status: 204, corpo: null },
  },
} as const satisfies Record<string, DefinicaoRota>;

export type NomeRotaNotificacoes = keyof typeof ROTAS_NOTIFICACOES;
