/**
 * GET /api/admin/pedidos (grupo `coordenacao`, RIFA-025, D16; docs/api.md): os pedidos da campanha ativa, do
 * registrado mais novo para o mais antigo, com filtros, totais por status (só na primeira página) e cursor opaco.
 * Só leitura; do comprador, só o DDD (D1). A leitura e os planos estão em db/lista-pedidos.ts.
 *
 * Este sub-app NÃO autentica: o index.ts o monta sob /api/admin, depois do login da coordenação (passo 4):
 * `app.route(PREFIXO_PEDIDOS, pedidos)`.
 */
import { Hono } from "hono";
import { ROTAS } from "../../shared/contracts";
import { decodificarCursorPedidos, listarPedidos } from "../db/lista-pedidos";
import { responderErro } from "../lib/respostas-erro";
import { validarConsulta } from "../middleware/validacao";

type Ambiente = { Bindings: Cloudflare.Env };

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
