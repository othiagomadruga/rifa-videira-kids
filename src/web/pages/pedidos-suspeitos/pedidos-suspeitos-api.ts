// Chamada da tela Pedidos suspeitos (coordenação): GET /api/admin/pedidos/suspeitos (docs/api.md), os pedidos
// aprovados que o webhook marcou como implausíveis, o mais recente primeiro. Eles CONTAM nas vendas.
//
// Do contrato vêm só os TIPOS: os valores de src/shared/contracts poriam o zod no pacote do site (veja
// lib/api.ts). O caminho e os limites da marcação são cópias, conferidas pelo tipo e por
// pedidos-suspeitos-contrato.test.ts.
import type { RespostaPedidosSuspeitos } from "../../../shared/contracts";
import type { ROTAS } from "../../../shared/contracts/api";
import { ErroApi, api } from "../../lib/api";

export const CAMINHO_PEDIDOS_SUSPEITOS: (typeof ROTAS)["pedidosSuspeitos"]["caminho"] =
  "/api/admin/pedidos/suspeitos";

/** TETO_BILHETES_POR_PEDIDO do contrato: acima disso, o pedido aprovado é marcado. */
export const TETO_BILHETES_POR_PEDIDO = 200;

/** TOLERANCIA_DESCONTO_BP do contrato: desconto aceito sobre bilhetes × preço do bilhete, em pontos-base. */
export const TOLERANCIA_DESCONTO_BP = 5000;

export function carregarPedidosSuspeitos(
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaPedidosSuspeitos> {
  return api.get<RespostaPedidosSuspeitos>(CAMINHO_PEDIDOS_SUSPEITOS, opcoes);
}

/** 403: a sessão não tem permissão para a lista (ex.: o papel mudou com a tela aberta). */
export function ehSemPermissao(erro: unknown): boolean {
  return erro instanceof ErroApi && erro.status === 403;
}
