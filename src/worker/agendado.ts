/**
 * Tarefas agendadas do Worker (`triggers.crons` no wrangler.jsonc): o handler `scheduled` do index.ts.
 *
 * O relatório diário por e-mail (RIFA-086 e RIFA-087, D40), para os destinatários do segredo `RELATORIO_EMAILS`
 * (lib/relatorio-diario-envio.ts), escolhido pelo cron (CRONS_RELATORIO_DIARIO do contrato):
 * - CRON_RELATORIO_MANHA ("0 10 * * *" = 07:00 em Belém): o dia de ontem, fechado;
 * - CRON_RELATORIO_TARDE ("0 20 * * *" = 17:00 em Belém): o dia de hoje até a hora do envio (parcial).
 * O "agora" é o horário agendado do disparo (um disparo atrasado manda o mesmo dia e diz a mesma hora).
 * Outro cron (que só existiria por engano no wrangler.jsonc) só avisa no log.
 */
import {
  CRONS_RELATORIO_DIARIO,
  TIPOS_RELATORIO_DIARIO,
} from "../shared/contracts";
import {
  executarRelatorioDiario,
  type OpcoesEnvio,
} from "./lib/relatorio-diario-envio";

export async function tratarAgendado(
  controle: Pick<ScheduledController, "cron" | "scheduledTime">,
  env: Cloudflare.Env,
  opcoes: OpcoesEnvio = {},
): Promise<void> {
  const tipo = TIPOS_RELATORIO_DIARIO.find(
    (candidato) => CRONS_RELATORIO_DIARIO[candidato] === controle.cron,
  );
  if (tipo === undefined) {
    console.warn("Agendamento desconhecido; nada feito", {
      cron: controle.cron,
    });
    return;
  }
  await executarRelatorioDiario(
    env,
    new Date(controle.scheduledTime),
    tipo,
    opcoes,
  );
}

/** O handler do Worker (a assinatura do runtime). */
export const scheduled: ExportedHandlerScheduledHandler<Cloudflare.Env> = (
  controle,
  env,
) => tratarAgendado(controle, env);
