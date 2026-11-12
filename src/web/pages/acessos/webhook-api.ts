// Chamadas da aba "Webhook da Rifei" (RIFA-039, D21; só admin): o estado do token do webhook e a geração de um
// token novo (docs/api.md, "Token do webhook da Rifei"). Do contrato vêm só os TIPOS: o caminho, as credenciais e o
// código do 409 abaixo são cópias, conferidas por acessos-contrato.test.ts.
//
// O token só existe na resposta do POST: quem chama o guarda só na memória da tela (nunca em storage, URL ou log).
import type {
  CorpoGerarTokenWebhook,
  CredencialWebhook,
  EstadoTokenWebhook,
  RespostaGerarTokenWebhook,
} from "../../../shared/contracts";
import { ErroApi, api } from "../../lib/api";

/** ROTAS_TOKEN_WEBHOOK: obterTokenWebhook (GET) e gerarTokenWebhook (POST), no mesmo caminho. */
export const CAMINHO_TOKEN_WEBHOOK = "/api/admin/webhook/token";

/** CREDENCIAIS_WEBHOOK do contrato. */
export const CREDENCIAIS: readonly CredencialWebhook[] = ["tela", "segredo"];

type Opcoes = { signal?: AbortSignal };

/** O estado: qual credencial vale, desde quando, o último uso e a URL. Nunca traz o token. */
export function obterEstadoToken(
  opcoes: Opcoes = {},
): Promise<EstadoTokenWebhook> {
  return api.get<EstadoTokenWebhook>(CAMINHO_TOKEN_WEBHOOK, opcoes);
}

/**
 * Gera um token novo (201: a ÚNICA vez em que ele aparece). Sem `substituir` e com uma credencial vigente, a API
 * responde 409 `em_uso` e nada muda (veja `credencialEmUso`).
 */
export function gerarTokenWebhook(
  substituir: boolean,
  opcoes: Opcoes = {},
): Promise<RespostaGerarTokenWebhook> {
  const corpo: CorpoGerarTokenWebhook = substituir ? { substituir: true } : {};
  return api.post<RespostaGerarTokenWebhook>(
    CAMINHO_TOKEN_WEBHOOK,
    corpo,
    opcoes,
  );
}

/**
 * O 409 `em_uso` do POST (uma credencial vigente, sem `substituir`): devolve a credencial que deixaria de valer
 * (`detalhes.vigente`), ou null se o erro é outro. Um detalhe fora do esperado conta como o token da tela.
 */
export function credencialEmUso(erro: unknown): CredencialWebhook | null {
  if (
    !(erro instanceof ErroApi) ||
    erro.status !== 409 ||
    erro.codigo !== "em_uso"
  )
    return null;
  const vigente = (erro.detalhes as { vigente?: unknown } | null | undefined)
    ?.vigente;
  return CREDENCIAIS.find((credencial) => credencial === vigente) ?? "tela";
}
