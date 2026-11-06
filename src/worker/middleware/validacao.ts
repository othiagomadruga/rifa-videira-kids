/**
 * Validação de entrada com os schemas do contrato, respondendo no formato único de erro (docs/api.md):
 * - JSON malformado ou corpo vazio: 400 `json_invalido`;
 * - fora do schema: 400 `requisicao_invalida`, com os problemas em `detalhes` (sem os valores recebidos).
 *
 * O validador "json" do Hono lança uma exceção no JSON malformado e ignora o corpo sem Content-Type JSON;
 * validarJson lê o corpo e responde os dois casos acima.
 */
import { zValidator } from "@hono/zod-validator";
import type { Env } from "hono";
import { createMiddleware } from "hono/factory";
import type { z } from "zod";
import { detalhesDeValidacao } from "../../shared/contracts";
import { responderErro } from "../lib/respostas-erro";

/** Corpo JSON validado: no handler, `c.req.valid("json")` já vem tipado e com os padrões do schema. */
export function validarJson<T extends z.ZodType>(schema: T) {
  return createMiddleware<
    Env,
    string,
    { in: { json: z.input<T> }; out: { json: z.output<T> } }
  >(async (c, next) => {
    let corpo: unknown;
    try {
      corpo = await c.req.json();
    } catch {
      return responderErro(
        c,
        "json_invalido",
        "O corpo da requisição não é um JSON válido",
      );
    }
    const resultado = await schema.safeParseAsync(corpo);
    if (!resultado.success) {
      return responderErro(
        c,
        "requisicao_invalida",
        "Dados inválidos",
        detalhesDeValidacao(resultado.error),
      );
    }
    c.req.addValidatedData("json", resultado.data as object);
    await next();
  });
}

/** Parâmetros do caminho (ex.: `:id`): no handler, `c.req.valid("param")` já vem convertido. */
export function validarParametros<T extends z.ZodType>(schema: T) {
  return zValidator("param", schema, (resultado, c) =>
    resultado.success
      ? undefined
      : responderErro(
          c,
          "requisicao_invalida",
          "Parâmetros inválidos",
          detalhesDeValidacao(resultado.error),
        ),
  );
}
