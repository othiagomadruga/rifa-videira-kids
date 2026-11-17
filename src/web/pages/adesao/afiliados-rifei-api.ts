// Os afiliados da Rifei na Adesão (RIFA-070, D29; só o admin): ler os afiliados da conta, sincronizar (código e
// vínculo pelo e-mail do líder) e gerar os convites das células sem afiliado. Do contrato vêm só TIPOS e o limite de
// rifei-api.ts (módulo sem zod); os caminhos são cópias, conferidas pelo tipo e por AfiliadosDaRifei.test.tsx.
import type {
  ROTAS_RIFEI_API,
  RespostaAfiliadosRifei,
  RespostaConvitesRifei,
} from "../../../shared/contracts/api";
import { LIMITE_CONVITES_RIFEI } from "../../../shared/contracts/rifei-api";
import { api } from "../../lib/api";

export type { RespostaAfiliadosRifei, RespostaConvitesRifei };

export const CAMINHO_AFILIADOS_RIFEI: (typeof ROTAS_RIFEI_API)["afiliadosRifei"]["caminho"] =
  "/api/admin/rifei/afiliados";
export const CAMINHO_SINCRONIZAR_RIFEI: (typeof ROTAS_RIFEI_API)["sincronizarAfiliadosRifei"]["caminho"] =
  "/api/admin/rifei/afiliados/sincronizar";
export const CAMINHO_CONVITES_RIFEI: (typeof ROTAS_RIFEI_API)["convitesRifei"]["caminho"] =
  "/api/admin/rifei/convites";

/** A Rifei responde um convite por vez: um lote de 50 leva alguns segundos. */
const TEMPO_LIMITE_RIFEI_MS = 60_000;

export function lerAfiliadosDaRifei(): Promise<RespostaAfiliadosRifei> {
  return api.get<RespostaAfiliadosRifei>(CAMINHO_AFILIADOS_RIFEI, {
    tempoLimiteMs: TEMPO_LIMITE_RIFEI_MS,
  });
}

export function sincronizarAfiliadosDaRifei(): Promise<RespostaAfiliadosRifei> {
  return api.post<RespostaAfiliadosRifei>(
    CAMINHO_SINCRONIZAR_RIFEI,
    {},
    { tempoLimiteMs: TEMPO_LIMITE_RIFEI_MS },
  );
}

/** Os convites das células, em lotes de LIMITE_CONVITES_RIFEI, juntos na ordem. */
export async function gerarConvitesNaRifei(
  celulas: readonly number[],
): Promise<RespostaConvitesRifei> {
  const resposta: RespostaConvitesRifei = { convites: [], falhas: [] };
  for (
    let inicio = 0;
    inicio < celulas.length;
    inicio += LIMITE_CONVITES_RIFEI
  ) {
    const lote = await api.post<RespostaConvitesRifei>(
      CAMINHO_CONVITES_RIFEI,
      { celulas: celulas.slice(inicio, inicio + LIMITE_CONVITES_RIFEI) },
      { tempoLimiteMs: TEMPO_LIMITE_RIFEI_MS },
    );
    resposta.convites.push(...lote.convites);
    resposta.falhas.push(...lote.falhas);
  }
  return resposta;
}

/** O telefone do líder no formato do wa.me: só dígitos, com o 55 quando o cadastro tem só DDD e número. */
export function telefoneParaWhatsApp(telefone: string | null): string | null {
  if (telefone === null) return null;
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos.length >= 12 && digitos.length <= 15 ? digitos : null;
}

/** A mensagem do convite no WhatsApp do líder. */
export function mensagemDoConvite(
  liderNome: string,
  celulaNome: string,
  link: string,
): string {
  const primeiroNome = liderNome.trim().split(/\s+/)[0] ?? liderNome;
  return `Olá, ${primeiroNome}! Este é o convite para a ${celulaNome} vender a rifa do Videira Kids pela Rifei. Abra o link e crie sua conta de afiliado (o convite vale 1 dia e só pode ser usado uma vez): ${link}`;
}
