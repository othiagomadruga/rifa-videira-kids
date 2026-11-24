/**
 * Pedidos da campanha ativa (docs/api.md):
 * - GET /api/admin/pedidos (grupo `coordenacao`, RIFA-025, D16): do registrado mais novo para o mais antigo, com
 *   filtros (inclusive `desconsiderado`, D20), totais por status (só na primeira página) e cursor opaco. Só
 *   leitura; do comprador, o DDD (D1) e, SÓ para o admin, o `comprador` (nome e telefone; RIFA-076, D36). A leitura e
 *   os planos estão em db/lista-pedidos.ts.
 * - GET /api/admin/pedidos/compradores (RIFA-076, D36), SÓ ADMIN: a planilha de compradores em CSV (routes/compradores.ts
 *   db/compradores.ts lê; a trilha registra quem exportou, sem os dados).
 * - POST /api/admin/pedidos/desconsiderar e /reconsiderar (RIFA-028, D20; ROTAS_REGRAS_CAMPANHA), SÓ ADMIN: tira o
 *   pedido de todas as contas, ou o devolve, num lote só com a trilha (db/regras-campanha.ts). Erros, depois do
 *   login (401) e do papel (403, antes de ler o corpo): 400 (corpo), 404 sem campanha ativa, 409 `acao_desligada`
 *   com a chave `pedidos.desconsiderar` desligada e 404 pedido fora da campanha ativa. Repetir dá 200 com o pedido
 *   como está, sem trilha.
 * - PUT /api/admin/pedidos/:id/celula (RIFA-088, D41; ROTAS_REGRAS_CAMPANHA), SÓ ADMIN: atribui à mão a célula de um
 *   pedido sem célula pelo afiliado (ou desfaz, com `celula_id: null`), num lote só com a trilha
 *   (db/celula-atribuida.ts). Erros, depois do login (401) e do papel (403, antes de ler o corpo): 400 (corpo), 404
 *   sem campanha ativa ou pedido fora dela, 409 `pedido_ja_tem_celula` e 400 `referencia_invalida` (célula que não
 *   existe). Repetir dá 200 com o pedido como está, sem trilha. RIFA-091 (adendo da D41): com `celula_id`, num pedido
 *   sem afiliado e a célula com exatamente um afiliado, liga a venda a ele também na Rifei (lib/afiliado-na-rifei.ts;
 *   repetir tenta de novo) e responde o item + `rifei` (a situação); a Rifei nunca faz a rota falhar.
 *
 * Este sub-app NÃO autentica o grupo: o index.ts o monta sob /api/admin, depois do login da coordenação (passo
 * 4): `app.route(PREFIXO_PEDIDOS, pedidos)`. O "só admin" das duas escritas fica nelas (exigirSessao).
 */
import { Hono, type Context } from "hono";
import {
  ROTAS,
  ROTAS_REGRAS_CAMPANHA,
  cabecalhosDosCompradores,
  hojeNoFuso,
  type RespostaAtribuirCelulaPedido,
} from "../../shared/contracts";
import { atribuirCelulaDoPedido } from "../db/celula-atribuida";
import { exportarCompradores } from "../db/compradores";
import { decodificarCursorPedidos, listarPedidos } from "../db/lista-pedidos";
import {
  aplicarDesconsideracao,
  type AcaoDesconsideracao,
  type ResultadoDesconsideracao,
} from "../db/regras-campanha";
import { ligarAfiliadoNaRifei } from "../lib/afiliado-na-rifei";
import { responderErro } from "../lib/respostas-erro";
import {
  autoriaDaSessao,
  exigirSessao,
  type AmbienteSessao,
} from "../middleware/sessao";
import {
  validarConsulta,
  validarJson,
  validarParametros,
} from "../middleware/validacao";

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
    // RIFA-076 (D36): o nome e o telefone do comprador só para o admin; a coordenação nem recebe o campo.
    const admin = c.get("usuario")?.papel === "admin";
    return c.json(
      await listarPedidos(c.env.DB, consulta, cursor, { comComprador: admin }),
      200,
    );
  },
);

// RIFA-076 (D36): a planilha de compradores, SÓ ADMIN (403 antes de ler a consulta). 404 sem campanha ativa; 200 com o
// CSV, os cabeçalhos do contrato (no-store) e o registro na trilha (no mesmo lote da leitura).
const EXPORTAR = ROTAS.exportarCompradores;
pedidos.get(
  EXPORTAR.caminho.slice(PREFIXO_PEDIDOS.length),
  exigirSessao(EXPORTAR.papeis),
  validarConsulta(EXPORTAR.consulta),
  async (c) => {
    const { so_pagou: soPagou = false } = c.req.valid("query");
    const quem = autoriaDaSessao(c);
    if (!quem) throw new Error("exportar sem sessão (falta exigirSessao)");
    const resultado = await exportarCompradores(c.env.DB, {
      soPagou,
      autoria: quem,
    });
    if (resultado === null)
      return responderErro(
        c,
        "nao_encontrado",
        "A campanha ainda não foi configurada",
      );
    return c.body(
      resultado.csv,
      200,
      cabecalhosDosCompradores(hojeNoFuso(resultado.fuso)),
    );
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

// RIFA-088 (D41): a célula atribuída à mão, SÓ ADMIN (403 antes de ler o corpo).
const ATRIBUIR = ROTAS_REGRAS_CAMPANHA.atribuirCelulaPedido;
pedidos.put(
  ATRIBUIR.caminho.slice(PREFIXO_PEDIDOS.length),
  exigirSessao(ATRIBUIR.papeis),
  validarParametros(ATRIBUIR.parametros),
  validarJson(ATRIBUIR.corpo),
  async (c) => {
    const { id } = c.req.valid("param");
    const { celula_id: celulaId } = c.req.valid("json");
    const quem = autoriaDaSessao(c);
    if (!quem)
      throw new Error("atribuir célula sem sessão (falta exigirSessao)");
    const resultado = await atribuirCelulaDoPedido(
      c.env.DB,
      id,
      celulaId,
      quem,
    );
    if (resultado.ok) {
      // RIFA-091: a venda ligada também na Rifei ao afiliado da célula, quando dá; nunca muda o status da resposta.
      const { item, rifei } = await ligarAfiliadoNaRifei(
        c.env,
        resultado.item,
        celulaId,
        quem,
      );
      return c.json(
        { ...item, rifei } satisfies RespostaAtribuirCelulaPedido,
        200,
      );
    }
    switch (resultado.motivo) {
      case "pedido_nao_encontrado":
        return responderErro(
          c,
          "nao_encontrado",
          "Pedido não encontrado na campanha ativa",
        );
      case "pedido_ja_tem_celula":
        return responderErro(
          c,
          "pedido_ja_tem_celula",
          "Este pedido já tem célula pelo afiliado: a célula do afiliado vale e não pode ser trocada à mão",
        );
      case "celula_inexistente": {
        // Como no vínculo do afiliado, `detalhes` aponta o campo do corpo.
        const mensagem = `A célula ${celulaId} não existe`;
        return responderErro(c, "referencia_invalida", mensagem, [
          { caminho: ["celula_id"], codigo: "referencia_invalida", mensagem },
        ]);
      }
    }
  },
);
