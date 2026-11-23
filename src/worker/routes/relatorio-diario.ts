/**
 * Relatório diário por e-mail (RIFA-086 e RIFA-087, D40; docs/api.md), SÓ ADMIN:
 * - GET /api/admin/relatorio-diario/previa?tipo=manha|tarde&data=AAAA-MM-DD: o HTML do e-mail (padrão: o da manhã, com
 *   o dia de ontem; na tarde, hoje até agora), para ver no navegador, com a CSP própria da prévia (só os estilos
 *   inline; nenhum script: middleware/cabecalhos-seguranca.ts);
 * - POST /api/admin/relatorio-diario/enviar `{ tipo?, data? }`: envia agora, um e-mail por destinatário do segredo
 *   `RELATORIO_EMAILS`, pelo binding `EMAIL`. 503 `nao_configurado` sem o binding ou sem destinatário válido (antes de
 *   ler o banco). Trilha `relatorio_diario.enviar` com o tipo, o dia e as contagens, nunca os e-mails.
 *
 * O index.ts monta este sub-app sob /api/admin, depois do login da coordenação (passo 4); cada rota exige o papel admin
 * no próprio handler (exigirSessao), antes da consulta e do corpo, nunca num use de /api/admin/*. Os envios das 7h e
 * das 17h são o `scheduled` do index.ts (lib/relatorio-diario-envio.ts), sem rota.
 */
import { Hono } from "hono";
import {
  ALVO_AUDITORIA_RELATORIO_DIARIO,
  ROTAS_RELATORIO_DIARIO,
  TIPO_CONTEUDO_HTML,
  type TipoRelatorioDiario,
} from "../../shared/contracts";
import { prepararRegistroAuditoria } from "../db/auditoria";
import { relogioDoSistema, type Relogio } from "../db/painel";
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

/** O tipo na trilha: "Relatório da manhã" ou "Relatório da tarde". */
const NOME_NA_TRILHA: Record<TipoRelatorioDiario, string> = {
  manha: "Relatório da manhã",
  tarde: "Relatório da tarde",
};

export function criarRelatorioDiario({
  relogio = relogioDoSistema,
  envio,
}: { relogio?: Relogio; envio?: OpcoesEnvio } = {}) {
  const app = new Hono<AmbienteSessao>();

  app.get(
    local(PREVIA.caminho),
    exigirSessao(PREVIA.papeis),
    validarConsulta(PREVIA.consulta),
    async (c) => {
      const lido = await lerRelatorioDiario(
        c.env,
        relogio,
        c.req.valid("query"),
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
      const pedido = c.req.valid("json");
      const { validos } = lerDestinatarios(c.env.RELATORIO_EMAILS);
      if (!c.env.EMAIL || validos.length === 0)
        return responderErro(
          c,
          "nao_configurado",
          !c.env.EMAIL
            ? "O envio de e-mail ainda não foi ligado na Cloudflare"
            : "Não há destinatários do relatório configurados",
        );
      const lido = await lerRelatorioDiario(c.env, relogio, pedido);
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
          resumo: `${NOME_NA_TRILHA[lido.tipo]} de ${lido.data} enviado: ${enviados} de ${validos.length} destinatário(s)${falhas > 0 ? `, ${falhas} falha(s)` : ""}`,
        }).run();
      return c.json(
        ENVIAR.sucesso.corpo.parse({
          tipo: lido.tipo,
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
