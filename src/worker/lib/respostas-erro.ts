// Respostas de erro no formato único da API v1: { "erro": { "codigo", "mensagem", "detalhes"? } }.
// O status HTTP sai sempre de STATUS_HTTP_DO_ERRO (contrato), nunca escrito à mão.
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  STATUS_HTTP_DO_ERRO,
  criarErroApi,
  type CodigoErro,
} from "../../shared/contracts";

/** Mensagem fixa do json_invalido (docs/api.md): a do SyntaxError do V8 cita trechos do corpo. */
export const MENSAGEM_JSON_INVALIDO = "O corpo não é um JSON válido";

/** Mensagem da HTTPException 400 do validador de JSON do Hono (hono/validator, alvo "json"). */
const MENSAGEM_JSON_MALFORMADO_DO_HONO = "Malformed JSON in request body";

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

/**
 * Corpo que não é JSON: o SyntaxError do JSON.parse / c.req.json() (as mensagens do V8 citam "JSON")
 * ou a HTTPException 400, sem resposta própria, que o validador de JSON do Hono lança antes do hook
 * do zValidator. Outros erros de corpo (ex.: FormData malformado) não entram aqui.
 */
function eErroDeJson(erro: Error): boolean {
  if (erro instanceof HTTPException) {
    return (
      erro.status === 400 &&
      erro.res === undefined &&
      erro.message === MENSAGEM_JSON_MALFORMADO_DO_HONO
    );
  }
  return erro instanceof SyntaxError && erro.message.includes("JSON");
}

/** app.notFound: rota inexistente em /api. */
export const rotaInexistente: NotFoundHandler = (c) =>
  responderErro(c, "nao_encontrado", "Rota não encontrada");

/**
 * app.onError:
 * - corpo que não é JSON vira 400 json_invalido, sem log: a mensagem do SyntaxError cita trechos do
 *   corpo (dados pessoais) e não vai para a resposta nem para o log;
 * - qualquer outra HTTPException (ex.: lançada por middleware) responde como ela mesma definiu;
 * - qualquer outro erro é registrado no log e vira 500 erro_interno, sem detalhes para o cliente.
 */
export const erroNaoTratado: ErrorHandler = (erro, c) => {
  if (eErroDeJson(erro)) {
    return responderErro(c, "json_invalido", MENSAGEM_JSON_INVALIDO);
  }
  if (erro instanceof HTTPException) return erro.getResponse();
  console.error(`${c.req.method} ${c.req.path}: erro não tratado`, erro);
  return responderErro(c, "erro_interno", "Erro interno");
};
