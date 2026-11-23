/**
 * Tarefas agendadas do Worker (`triggers.crons` no wrangler.jsonc): o handler `scheduled` do index.ts.
 *
 * - CRON_RELATORIO_DIARIO ("0 10 * * *" = 07:00 em Belém): o relatório diário por e-mail (RIFA-086, D40), com o dia de
 *   ontem, para os destinatários do segredo `RELATORIO_EMAILS` (lib/relatorio-diario-envio.ts). O "agora" é o horário
 *   agendado do disparo (um disparo atrasado manda o mesmo dia).
 * Outro cron (que só existiria por engano no wrangler.jsonc) só avisa no log.
 */
import { CRON_RELATORIO_DIARIO } from "../shared/contracts";
import {
  executarRelatorioDiario,
  type OpcoesEnvio,
} from "./lib/relatorio-diario-envio";

export async function tratarAgendado(
  controle: Pick<ScheduledController, "cron" | "scheduledTime">,
  env: Cloudflare.Env,
  opcoes: OpcoesEnvio = {},
): Promise<void> {
  if (controle.cron !== CRON_RELATORIO_DIARIO) {
    console.warn("Agendamento desconhecido; nada feito", {
      cron: controle.cron,
    });
    return;
  }
  await executarRelatorioDiario(env, new Date(controle.scheduledTime), opcoes);
}

/** O handler do Worker (a assinatura do runtime). */
export const scheduled: ExportedHandlerScheduledHandler<Cloudflare.Env> = (
  controle,
  env,
) => tratarAgendado(controle, env);
