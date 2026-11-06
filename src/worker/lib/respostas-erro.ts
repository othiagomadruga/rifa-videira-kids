// Respostas de erro no formato único da API v1: { "erro": { "codigo", "mensagem", "detalhes"? } }.
// O status HTTP sai sempre de STATUS_HTTP_DO_ERRO (contrato), nunca escrito à mão.
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  STATUS_HTTP_DO_ERRO,
  criarErroApi,
  type CodigoErro,
} from "../../shared/contracts";

/** Mensagem fixa do json_invalido: a do SyntaxError do V8 cita trechos do corpo (dados pessoais). */
export const MENSAGEM_JSON_INVALIDO =
  "O corpo da requisição não é um JSON válido";

export function responderErro(
  c: Context,
  codigo: CodigoErro,
  mensagem: string,
  detalhes?: unknown,
): Response {
  return c.json(
    criarErroApi(codigo, mensagem, detalhes),
    STATUS_HTTP_DO_ERRO[codigo],
  );
}

/** app.notFound: rota inexistente em /api. */
export const rotaInexistente: NotFoundHandler = (c) =>
  responderErro(c, "nao_encontrado", "Rota não encontrada");

/**
 * app.onError:
 * - corpo que não é JSON vira 400 json_invalido. O Hono lança HTTPException 400 sem resposta própria
 *   ("Malformed JSON in request body") antes do hook do zValidator, e c.req.json() lança SyntaxError,
 *   cuja mensagem cita trechos do corpo: ela não vai para a resposta nem para o log;
 * - qualquer outra HTTPException (ex.: lançada por middleware) responde como ela mesma definiu;
 * - qualquer outro erro é registrado no log e vira 500 erro_interno, sem detalhes para o cliente.
 */
export const erroNaoTratado: ErrorHandler = (erro, c) => {
  const corpoNaoJson =
    erro instanceof SyntaxError ||
    (erro instanceof HTTPException &&
      erro.status === 400 &&
      erro.res === undefined);
  if (corpoNaoJson) {
    return responderErro(c, "json_invalido", MENSAGEM_JSON_INVALIDO);
  }
  if (erro instanceof HTTPException) return erro.getResponse();
  console.error(`${c.req.method} ${c.req.path}: erro não tratado`, erro);
  return responderErro(c, "erro_interno", "Erro interno");
};
