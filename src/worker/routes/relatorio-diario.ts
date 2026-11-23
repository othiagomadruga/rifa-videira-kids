/**
 * Relatório diário por e-mail (RIFA-086, D40; docs/api.md), SÓ ADMIN:
 * - GET /api/admin/relatorio-diario/previa?data=AAAA-MM-DD: o HTML do e-mail do dia (padrão: ontem), para ver no
 *   navegador, com a CSP própria da prévia (só os estilos inline; nenhum script: middleware/cabecalhos-seguranca.ts);
 * - POST /api/admin/relatorio-diario/enviar `{ data? }`: envia agora, um e-mail por destinatário do segredo
 *   `RELATORIO_EMAILS`, pelo binding `EMAIL`. 503 `nao_configurado` sem o binding ou sem destinatário válido (antes de
 *   ler o banco). Trilha `relatorio_diario.enviar` com o dia e as contagens, nunca os e-mails.
 *
 * O index.ts monta este sub-app sob /api/admin, depois do login da coordenação (passo 4); cada rota exige o papel admin
 * no próprio handler (exigirSessao), antes da consulta e do corpo, nunca num use de /api/admin/*. O envio do cron das 7h
 * é o `scheduled` do index.ts (lib/relatorio-diario-envio.ts), sem rota.
 */
import { Hono } from "hono";
import {
  ALVO_AUDITORIA_RELATORIO_DIARIO,
  ROTAS_RELATORIO_DIARIO,
  TIPO_CONTEUDO_HTML,
} from "../../shared/contracts";
import { prepararRegistroAuditoria } from "../db/auditoria";
import { relogioDoSistema, type Relogio } from "../db/painel";
import type { OpcoesEfi } from "../lib/efi";
import { lerDestinatarios } from "../lib/email";
import {
  enviarAosDestinatarios,
  lerRelatorioDiario,
  type OpcoesEnvio,
} from "../lib/relatorio-diario-envio";
import { responderErro } from "../lib/respostas-erro";
import { CSP_PREVIA_EMAIL } from "../middleware/cabecalhos-seguranca";
import {
  autoriaDaSessao,
  exigirSessao,
  type AmbienteSessao,
} from "../middleware/sessao";
import { validarConsulta, validarJson } from "../middleware/validacao";

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_RELATORIO_DIARIO = "/api/admin";

const PREVIA = ROTAS_RELATORIO_DIARIO.previaRelatorioDiario;
const ENVIAR = ROTAS_RELATORIO_DIARIO.enviarRelatorioDiario;
const local = (caminho: string) =>
  caminho.slice(PREFIXO_RELATORIO_DIARIO.length);

export function criarRelatorioDiario({
  relogio = relogioDoSistema,
  efi,
  envio,
}: { relogio?: Relogio; efi?: OpcoesEfi; envio?: OpcoesEnvio } = {}) {
  const app = new Hono<AmbienteSessao>();

  app.get(
    local(PREVIA.caminho),
    exigirSessao(PREVIA.papeis),
    validarConsulta(PREVIA.consulta),
    async (c) => {
      const lido = await lerRelatorioDiario(
        c.env,
        relogio,
        c.req.valid("query").data,
        efi,
      );
      if (!lido.ok)
        return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
      return c.body(PREVIA.sucesso.corpo.parse(lido.email.html), 200, {
        "Content-Type": TIPO_CONTEUDO_HTML,
        "Content-Security-Policy": CSP_PREVIA_EMAIL,
      });
    },
  );

  app.post(
    local(ENVIAR.caminho),
    exigirSessao(ENVIAR.papeis),
    validarJson(ENVIAR.corpo),
    async (c) => {
      const { data } = c.req.valid("json");
      const { validos } = lerDestinatarios(c.env.RELATORIO_EMAILS);
      if (!c.env.EMAIL || validos.length === 0)
        return responderErro(
          c,
          "nao_configurado",
          !c.env.EMAIL
            ? "O envio de e-mail ainda não foi ligado na Cloudflare"
            : "Não há destinatários do relatório configurados",
        );
      const lido = await lerRelatorioDiario(c.env, relogio, data, efi);
      if (!lido.ok)
        return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
      const agora = relogio();
      const { enviados, falhas } = await enviarAosDestinatarios(
        c.env.EMAIL,
        validos,
        lido.email,
        agora,
        envio,
      );
      const autoria = autoriaDaSessao(c, agora);
      if (autoria)
        await prepararRegistroAuditoria(c.env.DB, {
          ...autoria,
          acao: "relatorio_diario.enviar",
          alvo: ALVO_AUDITORIA_RELATORIO_DIARIO,
          resumo: `Relatório de ${lido.data} enviado: ${enviados} de ${validos.length} destinatário(s)${falhas > 0 ? `, ${falhas} falha(s)` : ""}`,
        }).run();
      return c.json(
        ENVIAR.sucesso.corpo.parse({
          data: lido.data,
          destinatarios: validos.length,
          enviados,
          falhas,
        }),
        200,
      );
    },
  );

  return app;
}

/** O sub-app de produção (relógio do sistema). */
export const relatorioDiario = criarRelatorioDiario();
