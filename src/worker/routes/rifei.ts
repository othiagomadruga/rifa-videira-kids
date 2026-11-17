/**
 * API interna da Rifei (RIFA-070, docs/decisions.md D27; docs/api.md; docs/integracao-rifei.md, seção 13), SÓ ADMIN:
 * - POST /api/admin/rifei/marcar-pagos { pedidos }: marca como pagos na Rifei os pedidos que a Conferência do extrato
 *   achou. Confere no banco antes: só os pendentes ou expirados da campanha ativa, sem desconsideração, vão à Rifei.
 *   Não grava nada no pedido (ele passa a contar quando o "Pedido pago" chegar pelo webhook).
 * - GET /api/admin/rifei/afiliados: os afiliados da conta na Rifei, com a célula vinculada ou a sugerida pelo e-mail
 *   do líder, e as células sem afiliado.
 * - POST /api/admin/rifei/afiliados/sincronizar: grava os códigos (o `ref` do link de vendas) e os vínculos sugeridos.
 * - POST /api/admin/rifei/convites { celulas }: um convite de afiliado (uso único, 1 dia) por célula.
 *
 * O index.ts monta este sub-app sob /api/admin, depois do login da coordenação (passo 4). O "só admin" fica no handler
 * de cada rota (exigirSessao antes do validador: a coordenação leva 403, nunca 400). Sem o segredo RIFEI_API_TOKEN:
 * 503 `nao_configurado`; a Rifei falhou inteira: 502 `rifei_falhou` com o motivo. O token nunca sai daqui.
 */
import { Hono, type Context } from "hono";
import {
  ALVO_AUDITORIA_AFILIADOS_RIFEI,
  MENSAGEM_FALHA_RIFEI,
  RESULTADOS_MARCADOS_NA_RIFEI,
  ROTAS_RIFEI_API,
  SEGREDO_API_RIFEI,
  apiRifeiConfigurada,
  eLinkDeConviteRifei,
  respostaAfiliadosRifeiSchema,
  respostaConvitesRifeiSchema,
  respostaMarcarPagosRifeiSchema,
  type ItemMarcarPagosRifei,
  type RespostaConvitesRifei,
} from "../../shared/contracts";
import type { Autoria } from "../db/auditoria";
import { buscarCampanhaAtiva } from "../db/campanha";
import {
  gravarSincronizacao,
  lerCelulas,
  lerCelulasEAfiliados,
  lerPedidosParaMarcar,
  registrarNaTrilha,
} from "../db/rifei";
import { responderErro } from "../lib/respostas-erro";
import {
  montarAfiliadosRifei,
  planejarSincronizacao,
} from "../lib/rifei-afiliados";
import {
  FalhaRifei,
  criarClienteRifei,
  emLotes,
  marcarPedidoNaRifei,
  type ClienteRifei,
} from "../lib/rifei-api";
import {
  autoriaDaSessao,
  exigirSessao,
  type AmbienteSessao,
} from "../middleware/sessao";
import { validarJson } from "../middleware/validacao";

type Ambiente = AmbienteSessao;
type Contexto = Context<Ambiente>;

const {
  marcarPagosRifei: MARCAR,
  afiliadosRifei: AFILIADOS,
  sincronizarAfiliadosRifei: SINCRONIZAR,
  convitesRifei: CONVITES,
} = ROTAS_RIFEI_API;

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_RIFEI_API = "/api/admin";

const local = (caminho: string) => caminho.slice(PREFIXO_RIFEI_API.length);

/** Chamadas à Rifei ao mesmo tempo: rápido o bastante para 100 pedidos, sem parecer um ataque ao limite deles. */
const PARALELAS_PEDIDOS = 4;
const PARALELAS_CONVITES = 2;

const MENSAGEM_SEM_CAMPANHA =
  "Nenhuma campanha ativa: configure a campanha (com o slug da Rifei) antes de marcar os pedidos";
const MENSAGEM_NAO_CONFIGURADO =
  "A integração com a Rifei não está configurada no servidor: falta o segredo RIFEI_API_TOKEN (veja o roteiro na documentação da integração)";
const MENSAGEM_SEM_LINK =
  "A Rifei não devolveu o link do convite: gere no painel da Rifei (Afiliados → Convidar).";

/** O cliente da Rifei com o token do segredo, ou null sem o segredo. */
function clienteDaRifei(c: Contexto): ClienteRifei | null {
  const token = c.env[SEGREDO_API_RIFEI];
  return apiRifeiConfigurada(token) ? criarClienteRifei(token ?? "") : null;
}

function responderNaoConfigurado(c: Contexto) {
  return responderErro(c, "nao_configurado", MENSAGEM_NAO_CONFIGURADO);
}

/** Roda a ação; uma FalhaRifei vira 502 `rifei_falhou` com o motivo (o resto segue para o onError: 500). */
async function comRifei(
  c: Contexto,
  acao: () => Promise<Response>,
): Promise<Response> {
  try {
    return await acao();
  } catch (erro) {
    if (erro instanceof FalhaRifei)
      return responderErro(
        c,
        "rifei_falhou",
        MENSAGEM_FALHA_RIFEI[erro.motivo],
        {
          motivo: erro.motivo,
        },
      );
    throw erro;
  }
}

/** Quem faz e quando: a rota roda depois de exigirSessao. */
function autoria(c: Contexto): Autoria {
  const quem = autoriaDaSessao(c);
  if (!quem) throw new Error("rota da Rifei sem sessão (falta exigirSessao)");
  return quem;
}

/** Os números entre aspas, enquanto couberem no resumo da trilha. */
function numerosNoResumo(ids: readonly string[], espaco: number): string {
  const partes: string[] = [];
  let tamanho = 0;
  for (const id of ids) {
    const parte = `"${id}"`;
    if (tamanho + parte.length + 2 > espaco) {
      partes.push(`e mais ${ids.length - partes.length}`);
      break;
    }
    partes.push(parte);
    tamanho += parte.length + 2;
  }
  return partes.join(", ");
}

export const rifeiApi = new Hono<Ambiente>();

rifeiApi.post(
  local(MARCAR.caminho),
  // Só admin, antes de ler o corpo: a coordenação leva 403 mesmo com um corpo inválido.
  exigirSessao(MARCAR.papeis),
  validarJson(MARCAR.corpo),
  async (c) => {
    const { pedidos } = c.req.valid("json");
    const api = clienteDaRifei(c);
    if (api === null) return responderNaoConfigurado(c);
    const db = c.env.DB;
    const campanha = await buscarCampanhaAtiva(db);
    if (!campanha)
      return responderErro(c, "nao_encontrado", MENSAGEM_SEM_CAMPANHA);

    // 1. O banco decide o que vai à Rifei: só o pendente ou expirado da campanha ativa, sem desconsideração.
    const doSistema = await lerPedidosParaMarcar(db, campanha.id, pedidos);
    const itens: ItemMarcarPagosRifei[] = pedidos.map((id) => {
      const pedido = doSistema.get(id);
      const resultado =
        pedido === undefined
          ? "fora_do_sistema"
          : pedido.desconsiderado_em !== null
            ? "desconsiderado"
            : pedido.status === "approved"
              ? "ja_pago"
              : null;
      return {
        pedido_id: id,
        resultado: resultado ?? "falhou",
        mensagem: null,
      };
    });
    const paraRifei = pedidos.filter((id) => {
      const pedido = doSistema.get(id);
      return (
        pedido !== undefined &&
        pedido.desconsiderado_em === null &&
        pedido.status !== "approved"
      );
    });

    // 2. A Rifei, um pedido por vez (até PARALELAS_PEDIDOS ao mesmo tempo).
    return comRifei(c, async () => {
      if (paraRifei.length > 0) {
        const campanhaRifei = await api.buscarCampanha(campanha.slug_rifei);
        const resultados = await emLotes(paraRifei, PARALELAS_PEDIDOS, (id) =>
          marcarPedidoNaRifei(api, campanhaRifei, id),
        );
        const porId = new Map(
          paraRifei.map((id, indice) => [id, resultados[indice]]),
        );
        for (const item of itens) {
          const daRifei = porId.get(item.pedido_id);
          if (daRifei) {
            item.resultado = daRifei.resultado;
            item.mensagem = daRifei.mensagem;
          }
        }
      }
      const marcados = itens.filter((item) =>
        RESULTADOS_MARCADOS_NA_RIFEI.includes(item.resultado),
      );
      if (paraRifei.length > 0) {
        const cabeca = `${marcados.length} de ${paraRifei.length} pedido(s) marcado(s) como pago(s) na Rifei`;
        const naoMarcados = paraRifei.length - marcados.length;
        const resumo = `${cabeca}${naoMarcados > 0 ? ` (${naoMarcados} recusado(s) ou com falha)` : ""}${
          marcados.length > 0
            ? `: ${numerosNoResumo(
                marcados.map((item) => item.pedido_id),
                900 - cabeca.length,
              )}`
            : ""
        }`;
        await registrarNaTrilha(
          db,
          autoria(c),
          "rifei.marcar_pagos",
          `campanha:${campanha.id}`,
          resumo,
        );
      }
      return c.json(
        respostaMarcarPagosRifeiSchema.parse({
          itens,
          marcados: marcados.length,
        }),
        200,
      );
    });
  },
);

rifeiApi.get(
  local(AFILIADOS.caminho),
  exigirSessao(AFILIADOS.papeis),
  async (c) => {
    const api = clienteDaRifei(c);
    if (api === null) return responderNaoConfigurado(c);
    return comRifei(c, async () => {
      const [daRifei, leitura] = await Promise.all([
        api.listarAfiliados(),
        lerCelulasEAfiliados(c.env.DB),
      ]);
      const montados = montarAfiliadosRifei(
        daRifei,
        leitura.celulas,
        leitura.afiliados,
      );
      return c.json(
        respostaAfiliadosRifeiSchema.parse({
          ...montados,
          sincronizacao: null,
        }),
        200,
      );
    });
  },
);

rifeiApi.post(
  local(SINCRONIZAR.caminho),
  exigirSessao(SINCRONIZAR.papeis),
  validarJson(SINCRONIZAR.corpo),
  async (c) => {
    const api = clienteDaRifei(c);
    if (api === null) return responderNaoConfigurado(c);
    const db = c.env.DB;
    return comRifei(c, async () => {
      const [daRifei, antes] = await Promise.all([
        api.listarAfiliados(),
        lerCelulasEAfiliados(db),
      ]);
      const plano = planejarSincronizacao(
        daRifei,
        montarAfiliadosRifei(daRifei, antes.celulas, antes.afiliados),
        antes.afiliados,
      );
      const quem = autoria(c);
      const { codigosGravados, vinculados } = await gravarSincronizacao(
        db,
        plano,
        quem.em,
      );
      if (codigosGravados + vinculados > 0)
        await registrarNaTrilha(
          db,
          quem,
          "rifei.sincronizar_afiliados",
          ALVO_AUDITORIA_AFILIADOS_RIFEI,
          `${daRifei.length} afiliado(s) lido(s) da Rifei; ${vinculados} vinculado(s) à célula pelo e-mail do líder; ${codigosGravados} código(s) gravado(s) ou afiliado(s) novo(s)`,
        );
      const depois = await lerCelulasEAfiliados(db);
      return c.json(
        respostaAfiliadosRifeiSchema.parse({
          ...montarAfiliadosRifei(daRifei, depois.celulas, depois.afiliados),
          sincronizacao: { vinculados, codigos_gravados: codigosGravados },
        }),
        200,
      );
    });
  },
);

rifeiApi.post(
  local(CONVITES.caminho),
  exigirSessao(CONVITES.papeis),
  validarJson(CONVITES.corpo),
  async (c) => {
    const { celulas: ids } = c.req.valid("json");
    const api = clienteDaRifei(c);
    if (api === null) return responderNaoConfigurado(c);
    const db = c.env.DB;
    const lidas = await lerCelulas(db, ids);
    const porId = new Map(lidas.map((celula) => [celula.celula_id, celula]));
    const faltam = ids.filter((id) => !porId.has(id));
    if (faltam.length > 0)
      return responderErro(
        c,
        "nao_encontrado",
        `Célula não encontrada: ${faltam.join(", ")}`,
        { celulas: faltam },
      );
    const celulas = ids.map((id) => porId.get(id)!);

    return comRifei(c, async () => {
      const resposta: RespostaConvitesRifei = { convites: [], falhas: [] };
      const resultados = await emLotes(
        celulas,
        PARALELAS_CONVITES,
        async (celula) => {
          try {
            return { celula, convite: await api.criarConvite() };
          } catch (erro) {
            if (erro instanceof FalhaRifei && erro.motivo === "indisponivel")
              return {
                celula,
                convite: {
                  link: null,
                  mensagem: MENSAGEM_FALHA_RIFEI.indisponivel,
                },
              };
            throw erro;
          }
        },
      );
      for (const { celula, convite } of resultados) {
        if (convite.link !== null && eLinkDeConviteRifei(convite.link))
          resposta.convites.push({
            celula_id: celula.celula_id,
            celula_nome: celula.celula_nome,
            lider_nome: celula.lider_nome,
            lider_telefone: celula.lider_telefone,
            link: convite.link,
          });
        else
          resposta.falhas.push({
            celula_id: celula.celula_id,
            mensagem:
              (convite.link === null ? convite.mensagem : null) ??
              MENSAGEM_SEM_LINK,
          });
      }
      if (resposta.convites.length > 0)
        await registrarNaTrilha(
          db,
          autoria(c),
          "rifei.gerar_convites",
          ALVO_AUDITORIA_AFILIADOS_RIFEI,
          `${resposta.convites.length} convite(s) de afiliado gerado(s) na Rifei (células ${resposta.convites
            .map((convite) => convite.celula_id)
            .join(
              ", ",
            )})${resposta.falhas.length > 0 ? `; ${resposta.falhas.length} falha(s)` : ""}`,
        );
      return c.json(respostaConvitesRifeiSchema.parse(resposta), 201);
    });
  },
);
