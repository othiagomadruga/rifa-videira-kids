/**
 * API interna da Rifei (RIFA-070, docs/decisions.md D32; docs/api.md; docs/integracao-rifei.md, seção 13), SÓ ADMIN:
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
  LIMITE_PEDIDOS_BUSCA_RIFEI,
  MENSAGEM_FALHA_RIFEI,
  ROTAS_CONEXAO_RIFEI,
  SEGREDO_CHAVE_CIFRA_RIFEI,
  chaveCifraRifeiConfigurada,
  estadoConexaoRifeiSchema,
  expiracaoDoTokenRifei,
  finalDoTokenRifei,
  limparTokenRifei,
  numeroDeBilhete,
  respostaBuscarPedidoRifeiSchema,
  respostaTesteConexaoRifeiSchema,
  type EstadoConexaoRifei,
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
import { itemDaLinha } from "../db/lista-pedidos";
import {
  apagarConexaoRifei,
  buscarPedidosParaMarcar,
  gravarConexaoRifei,
  lerConexaoRifei,
  registrarUsoDaConexaoRifei,
  type LinhaConexaoRifei,
  gravarSincronizacao,
  lerCelulas,
  lerCelulasEAfiliados,
  lerPedidosParaMarcar,
  registrarNaTrilha,
} from "../db/rifei";
import { cifrarTokenRifei, decifrarTokenRifei } from "../lib/cifra-rifei";
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
import { validarConsulta, validarJson } from "../middleware/validacao";

type Ambiente = AmbienteSessao;
type Contexto = Context<Ambiente>;

const {
  obterConexaoRifei: OBTER_CONEXAO,
  salvarConexaoRifei: SALVAR_CONEXAO,
  testarConexaoRifei: TESTAR_CONEXAO,
  apagarConexaoRifei: APAGAR_CONEXAO,
  buscarPedidoRifei: BUSCAR_PEDIDO,
} = ROTAS_CONEXAO_RIFEI;
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
  "A conexão com a Rifei não está configurada: cole o token em Acessos → Conexão com a Rifei";
const MENSAGEM_TOKEN_ILEGIVEL =
  "O token salvo não pode ser lido (a chave do servidor mudou ou sumiu): cole um novo em Acessos → Conexão com a Rifei";
const MENSAGEM_SEM_CHAVE =
  "Falta o segredo RIFEI_CHAVE_CIFRA no servidor: sem ele o token não pode ser guardado. Peça ao suporte do sistema";
const MENSAGEM_TOKEN_MAL_FORMADO =
  "Isso não parece o token da Rifei: cole o texto inteiro copiado no passo 2 (sem espaços no meio)";
const MENSAGEM_SEM_LINK =
  "A Rifei não devolveu o link do convite: gere no painel da Rifei (Afiliados → Convidar).";

/**
 * O token que vale (D32): o da tela (no D1, cifrado) tem prioridade; sem ele, o segredo RIFEI_API_TOKEN. `uso` junta o
 * que a Rifei respondeu nesta requisição, para gravar o último sucesso ou a recusa do token da tela.
 */
interface ConexaoEmUso {
  api: ClienteRifei;
  /** O token cifrado da linha da tela (null quando vale o segredo do Worker). */
  tokenCifrado: string | null;
  uso: { ok: boolean; recusado: boolean };
}

/** O token da tela aberto com a chave; null sem chave ou se a chave não abre. */
async function abrirTokenDaTela(
  c: Contexto,
  linha: LinhaConexaoRifei,
): Promise<string | null> {
  const chave = c.env[SEGREDO_CHAVE_CIFRA_RIFEI];
  if (!chaveCifraRifeiConfigurada(chave)) return null;
  return decifrarTokenRifei(linha.token_cifrado, chave ?? "");
}

function clienteComUso(token: string, uso: ConexaoEmUso["uso"]): ClienteRifei {
  return criarClienteRifei(token, {
    aoResponder: (status) => {
      if (status === 401 || status === 403) uso.recusado = true;
      else if (status < 500 && status !== 429) uso.ok = true;
    },
  });
}

/** A conexão para chamar a Rifei, ou a resposta 503 (sem token, ou o da tela ilegível). */
async function abrirConexao(c: Contexto): Promise<ConexaoEmUso | Response> {
  const uso = { ok: false, recusado: false };
  const linha = await lerConexaoRifei(c.env.DB);
  if (linha) {
    const token = await abrirTokenDaTela(c, linha);
    if (token === null)
      return responderErro(c, "nao_configurado", MENSAGEM_TOKEN_ILEGIVEL);
    return {
      api: clienteComUso(token, uso),
      tokenCifrado: linha.token_cifrado,
      uso,
    };
  }
  const segredo = c.env[SEGREDO_API_RIFEI];
  if (!apiRifeiConfigurada(segredo))
    return responderErro(c, "nao_configurado", MENSAGEM_NAO_CONFIGURADO);
  return { api: clienteComUso(segredo ?? "", uso), tokenCifrado: null, uso };
}

/**
 * Roda a ação; uma FalhaRifei vira 502 `rifei_falhou` com o motivo (o resto segue para o onError: 500). No fim, grava
 * o que a Rifei respondeu ao token da tela: recusa (401/403) ou sucesso.
 */
async function comRifei(
  c: Contexto,
  conexao: ConexaoEmUso,
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
  } finally {
    const { uso, tokenCifrado } = conexao;
    if (tokenCifrado !== null && (uso.ok || uso.recusado))
      await registrarUsoDaConexaoRifei(
        c.env.DB,
        tokenCifrado,
        uso.recusado ? "recusado" : "ok",
        new Date().toISOString(),
      );
  }
}

/** O estado da conexão para a tela (nunca o token). */
async function estadoDaConexao(c: Contexto): Promise<EstadoConexaoRifei> {
  const linha = await lerConexaoRifei(c.env.DB);
  const chaveConfigurada = chaveCifraRifeiConfigurada(
    c.env[SEGREDO_CHAVE_CIFRA_RIFEI],
  );
  const segredoConfigurado = apiRifeiConfigurada(c.env[SEGREDO_API_RIFEI]);
  return estadoConexaoRifeiSchema.parse({
    origem: linha ? "tela" : segredoConfigurado ? "segredo" : null,
    conectado_em: linha?.conectado_em ?? null,
    final: linha?.final_token ?? null,
    testado_em: linha?.testado_em ?? null,
    recusado_em: linha?.recusado_em ?? null,
    expira_em: linha?.expira_em ?? null,
    chave_configurada: chaveConfigurada,
    token_legivel: linha ? (await abrirTokenDaTela(c, linha)) !== null : false,
    segredo_configurado: segredoConfigurado,
  });
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
    const conexao = await abrirConexao(c);
    if (conexao instanceof Response) return conexao;
    const { api } = conexao;
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
    return comRifei(c, conexao, async () => {
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
    const conexao = await abrirConexao(c);
    if (conexao instanceof Response) return conexao;
    const { api } = conexao;
    return comRifei(c, conexao, async () => {
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
    const conexao = await abrirConexao(c);
    if (conexao instanceof Response) return conexao;
    const { api } = conexao;
    const db = c.env.DB;
    return comRifei(c, conexao, async () => {
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
    const conexao = await abrirConexao(c);
    if (conexao instanceof Response) return conexao;
    const { api } = conexao;
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

    return comRifei(c, conexao, async () => {
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

// ---------------------------------------------------------------------------------------------------
// Conexão com a Rifei pela tela e busca do pedido (RIFA-070, D32)
// ---------------------------------------------------------------------------------------------------

rifeiApi.get(
  local(OBTER_CONEXAO.caminho),
  exigirSessao(OBTER_CONEXAO.papeis),
  async (c) => c.json(await estadoDaConexao(c), 200),
);

rifeiApi.put(
  local(SALVAR_CONEXAO.caminho),
  // Só admin, antes de ler o corpo (o corpo traz o token: nunca vai para log nem para mensagem de erro).
  exigirSessao(SALVAR_CONEXAO.papeis),
  validarJson(SALVAR_CONEXAO.corpo),
  async (c) => {
    const chave = c.env[SEGREDO_CHAVE_CIFRA_RIFEI];
    if (!chaveCifraRifeiConfigurada(chave))
      return responderErro(c, "nao_configurado", MENSAGEM_SEM_CHAVE);
    const token = limparTokenRifei(c.req.valid("json").token);
    if (token === null)
      return responderErro(
        c,
        "requisicao_invalida",
        MENSAGEM_TOKEN_MAL_FORMADO,
      );
    const db = c.env.DB;
    const campanha = await buscarCampanhaAtiva(db);
    if (!campanha)
      return responderErro(c, "nao_encontrado", MENSAGEM_SEM_CAMPANHA);
    // Testa antes de gravar: um token que a Rifei recusa nunca é guardado.
    let campanhaRifeiId: string;
    try {
      campanhaRifeiId = (
        await criarClienteRifei(token).buscarCampanha(campanha.slug_rifei)
      ).id;
    } catch (erro) {
      if (erro instanceof FalhaRifei)
        return responderErro(
          c,
          "rifei_falhou",
          MENSAGEM_FALHA_RIFEI[erro.motivo],
          { motivo: erro.motivo },
        );
      throw erro;
    }
    const antes = await lerConexaoRifei(db);
    await gravarConexaoRifei(
      db,
      {
        tokenCifrado: await cifrarTokenRifei(token, chave ?? ""),
        final: finalDoTokenRifei(token),
        expiraEm: expiracaoDoTokenRifei(token),
        trocou: antes !== null,
      },
      autoria(c),
    );
    return c.json(
      respostaTesteConexaoRifeiSchema.parse({
        estado: await estadoDaConexao(c),
        campanha_rifei_id: campanhaRifeiId,
      }),
      200,
    );
  },
);

rifeiApi.post(
  local(TESTAR_CONEXAO.caminho),
  exigirSessao(TESTAR_CONEXAO.papeis),
  validarJson(TESTAR_CONEXAO.corpo),
  async (c) => {
    const conexao = await abrirConexao(c);
    if (conexao instanceof Response) return conexao;
    const campanha = await buscarCampanhaAtiva(c.env.DB);
    if (!campanha)
      return responderErro(c, "nao_encontrado", MENSAGEM_SEM_CAMPANHA);
    let campanhaRifeiId = "";
    const resposta = await comRifei(c, conexao, async () => {
      campanhaRifeiId = (await conexao.api.buscarCampanha(campanha.slug_rifei))
        .id;
      return new Response(null, { status: 204 });
    });
    if (resposta.status !== 204) return resposta;
    return c.json(
      respostaTesteConexaoRifeiSchema.parse({
        estado: await estadoDaConexao(c),
        campanha_rifei_id: campanhaRifeiId,
      }),
      200,
    );
  },
);

rifeiApi.delete(
  local(APAGAR_CONEXAO.caminho),
  exigirSessao(APAGAR_CONEXAO.papeis),
  async (c) => {
    await apagarConexaoRifei(c.env.DB, autoria(c));
    return c.json(await estadoDaConexao(c), 200);
  },
);

rifeiApi.get(
  local(BUSCAR_PEDIDO.caminho),
  exigirSessao(BUSCAR_PEDIDO.papeis),
  validarConsulta(BUSCAR_PEDIDO.consulta),
  async (c) => {
    const { numero } = c.req.valid("query");
    const db = c.env.DB;
    const campanha = await buscarCampanhaAtiva(db);
    if (!campanha)
      return responderErro(c, "nao_encontrado", MENSAGEM_SEM_CAMPANHA);
    const linhas = await buscarPedidosParaMarcar(
      db,
      campanha.id,
      numero,
      numeroDeBilhete(numero),
      LIMITE_PEDIDOS_BUSCA_RIFEI,
    );
    return c.json(
      respostaBuscarPedidoRifeiSchema.parse({
        pedidos: linhas.map(({ achado_por, ...linha }) => ({
          achado_por,
          pedido: itemDaLinha(linha),
        })),
      }),
      200,
    );
  },
);
