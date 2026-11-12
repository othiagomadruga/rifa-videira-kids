/**
 * Pedidos da campanha ativa (docs/api.md):
 * - GET /api/admin/pedidos (grupo `coordenacao`, RIFA-025, D16): do registrado mais novo para o mais antigo, com
 *   filtros (inclusive `desconsiderado`, D20), totais por status (só na primeira página) e cursor opaco. Só
 *   leitura; do comprador, só o DDD (D1). A leitura e os planos estão em db/lista-pedidos.ts.
 * - POST /api/admin/pedidos/desconsiderar e /reconsiderar (RIFA-028, D20; ROTAS_REGRAS_CAMPANHA), SÓ ADMIN: tira o
 *   pedido de todas as contas, ou o devolve, num lote só com a trilha (db/regras-campanha.ts). Erros, depois do
 *   login (401) e do papel (403, antes de ler o corpo): 400 (corpo), 404 sem campanha ativa, 409 `acao_desligada`
 *   com a chave `pedidos.desconsiderar` desligada e 404 pedido fora da campanha ativa. Repetir dá 200 com o pedido
 *   como está, sem trilha.
 *
 * Este sub-app NÃO autentica o grupo: o index.ts o monta sob /api/admin, depois do login da coordenação (passo
 * 4): `app.route(PREFIXO_PEDIDOS, pedidos)`. O "só admin" das duas escritas fica nelas (exigirSessao).
 */
import { Hono, type Context } from "hono";
import { ROTAS, ROTAS_REGRAS_CAMPANHA } from "../../shared/contracts";
import { decodificarCursorPedidos, listarPedidos } from "../db/lista-pedidos";
import {
  aplicarDesconsideracao,
  type AcaoDesconsideracao,
  type ResultadoDesconsideracao,
} from "../db/regras-campanha";
import { responderErro } from "../lib/respostas-erro";
import {
  autoriaDaSessao,
  exigirSessao,
  type AmbienteSessao,
} from "../middleware/sessao";
import { validarConsulta, validarJson } from "../middleware/validacao";

type Ambiente = AmbienteSessao;

const { desconsiderarPedido: DESCONSIDERAR, reconsiderarPedido: RECONSIDERAR } =
  ROTAS_REGRAS_CAMPANHA;

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_PEDIDOS = "/api/admin";

export const pedidos = new Hono<Ambiente>();

pedidos.get(
  ROTAS.listarPedidos.caminho.slice(PREFIXO_PEDIDOS.length),
  validarConsulta(ROTAS.listarPedidos.consulta),
  async (c) => {
    const consulta = c.req.valid("query");
    let cursor = null;
    if (consulta.antes_de !== undefined) {
      cursor = decodificarCursorPedidos(consulta.antes_de);
      if (cursor === null)
        return responderErro(c, "requisicao_invalida", "Consulta inválida", [
          {
            caminho: ["antes_de"],
            codigo: "cursor_invalido",
            mensagem:
              "Cursor inválido: use o valor de `proximo` da página anterior",
          },
        ]);
    }
    return c.json(await listarPedidos(c.env.DB, consulta, cursor), 200);
  },
);

/** A resposta de desconsiderar ou reconsiderar, na ordem de erros da D20 (o 400 já saiu no validador). */
function responderDesconsideracao(
  c: Context,
  resultado: ResultadoDesconsideracao,
) {
  if (resultado.ok) return c.json(resultado.item, 200);
  switch (resultado.motivo) {
    case "sem_campanha":
      return responderErro(
        c,
        "nao_encontrado",
        "A campanha ainda não foi configurada",
      );
    case "chave_desligada":
      return responderErro(
        c,
        "acao_desligada",
        "Desconsiderar pedido está desligado na Campanha: ligue a chave antes de desconsiderar ou desfazer",
        { chave: "pedidos.desconsiderar" },
      );
    case "pedido_nao_encontrado":
      return responderErro(
        c,
        "nao_encontrado",
        "Pedido não encontrado na campanha ativa",
      );
  }
}

/** Quem faz e quando (o mesmo instante grava `desconsiderado_em`): a rota roda depois de exigirSessao. */
function autoria(c: Context<Ambiente>) {
  const quem = autoriaDaSessao(c);
  if (!quem) throw new Error("desconsiderar sem sessão (falta exigirSessao)");
  return quem;
}

const acoes: [
  AcaoDesconsideracao,
  typeof DESCONSIDERAR | typeof RECONSIDERAR,
][] = [
  ["desconsiderar", DESCONSIDERAR],
  ["reconsiderar", RECONSIDERAR],
];

for (const [acao, rota] of acoes)
  pedidos.post(
    rota.caminho.slice(PREFIXO_PEDIDOS.length),
    // Só admin, antes de ler o corpo (a coordenação leva 403 mesmo com um corpo inválido).
    exigirSessao(rota.papeis),
    validarJson(rota.corpo),
    async (c) => {
      const corpo = c.req.valid("json");
      return responderDesconsideracao(
        c,
        await aplicarDesconsideracao(
          c.env.DB,
          acao,
          {
            pedidoId: corpo.pedido_id,
            ...("motivo" in corpo
              ? { motivo: corpo.motivo, observacao: corpo.observacao }
              : {}),
          },
          autoria(c),
        ),
      );
    },
  );
