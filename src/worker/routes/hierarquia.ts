/**
 * Rotas da hierarquia (CRUD de redes, discipuladores e células) e da importação da planilha, do grupo
 * `coordenacao` (docs/api.md). Os caminhos e os schemas vêm do contrato (`ROTAS`).
 *
 * Este sub-app NÃO autentica: o index.ts o monta sob /api/admin, depois do middleware da coordenação:
 * `app.route(PREFIXO_HIERARQUIA, hierarquia)`.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import {
  ROTAS,
  STATUS_HTTP_DO_ERRO,
  criarErroApi,
  detalhesDeValidacao,
  type CodigoErro,
} from "../../shared/contracts";
import {
  atualizarCelula,
  atualizarDiscipulador,
  atualizarRede,
  criarCelula,
  criarDiscipulador,
  criarRede,
  importarHierarquia,
  listarCelulas,
  listarDiscipuladores,
  listarRedes,
  obterCelula,
  obterDiscipulador,
  obterRede,
  removerCelula,
  removerDiscipulador,
  removerRede,
  type Resultado,
} from "../db/hierarquia";

type Ambiente = { Bindings: Cloudflare.Env };

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_HIERARQUIA = "/api/admin";

type CaminhoLocal<T extends string> =
  T extends `${typeof PREFIXO_HIERARQUIA}${infer Resto}` ? Resto : never;

/** Caminho de ROTAS sem o prefixo de montagem ("/api/admin/redes/:id" → "/redes/:id"). */
function local<T extends `${typeof PREFIXO_HIERARQUIA}/${string}`>(
  caminho: T,
): CaminhoLocal<T> {
  return caminho.slice(PREFIXO_HIERARQUIA.length) as CaminhoLocal<T>;
}

function responderErro(
  c: Context,
  codigo: CodigoErro,
  mensagem: string,
  detalhes?: unknown,
) {
  return c.json(
    criarErroApi(codigo, mensagem, detalhes),
    STATUS_HTTP_DO_ERRO[codigo],
  );
}

function responder<T>(
  c: Context,
  resultado: Resultado<T>,
  status: 200 | 201 = 200,
) {
  return resultado.ok
    ? c.json(resultado.valor, status)
    : responderErro(
        c,
        resultado.codigo,
        resultado.mensagem,
        resultado.detalhes,
      );
}

const MENSAGEM_DE_INVALIDO = {
  json: "Dados inválidos",
  param: "Parâmetro inválido no caminho",
  query: "Consulta inválida",
} as const;

/** Valida com o schema do contrato; fora dele, 400 `requisicao_invalida` com os problemas em `detalhes`. */
function validar<
  Alvo extends keyof typeof MENSAGEM_DE_INVALIDO,
  Schema extends z.ZodType,
>(alvo: Alvo, schema: Schema) {
  return zValidator(alvo, schema, (resultado, c) => {
    if (!resultado.success)
      return responderErro(
        c,
        "requisicao_invalida",
        MENSAGEM_DE_INVALIDO[alvo],
        detalhesDeValidacao(resultado.error),
      );
  });
}

/** A mesma regra que o validador do Hono usa para decidir se lê o corpo como JSON. */
const CONTEUDO_JSON =
  /^application\/([a-z.-]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i;

/** Corpo sem `Content-Type: application/json` não é JSON: 400 `json_invalido`. */
const exigirJson = createMiddleware<Ambiente>(async (c, next) => {
  if (!CONTEUDO_JSON.test(c.req.header("Content-Type") ?? ""))
    return responderErro(
      c,
      "json_invalido",
      "Envie o corpo em JSON, com o cabeçalho Content-Type: application/json",
    );
  await next();
});

export const hierarquia = new Hono<Ambiente>();

// ---------------------------------------------------------------------------------------------------
// Redes
// ---------------------------------------------------------------------------------------------------

hierarquia.get(local(ROTAS.listarRedes.caminho), async (c) =>
  c.json({ itens: await listarRedes(c.env.DB) }),
);

hierarquia.get(
  local(ROTAS.obterRede.caminho),
  validar("param", ROTAS.obterRede.parametros),
  async (c) => responder(c, await obterRede(c.env.DB, c.req.valid("param").id)),
);

hierarquia.post(
  local(ROTAS.criarRede.caminho),
  exigirJson,
  validar("json", ROTAS.criarRede.corpo),
  async (c) =>
    responder(c, await criarRede(c.env.DB, c.req.valid("json")), 201),
);

hierarquia.put(
  local(ROTAS.atualizarRede.caminho),
  validar("param", ROTAS.atualizarRede.parametros),
  exigirJson,
  validar("json", ROTAS.atualizarRede.corpo),
  async (c) =>
    responder(
      c,
      await atualizarRede(
        c.env.DB,
        c.req.valid("param").id,
        c.req.valid("json"),
      ),
    ),
);

hierarquia.delete(
  local(ROTAS.removerRede.caminho),
  validar("param", ROTAS.removerRede.parametros),
  async (c) => {
    const resultado = await removerRede(c.env.DB, c.req.valid("param").id);
    return resultado.ok ? c.body(null, 204) : responder(c, resultado);
  },
);

// ---------------------------------------------------------------------------------------------------
// Discipuladores
// ---------------------------------------------------------------------------------------------------

hierarquia.get(
  local(ROTAS.listarDiscipuladores.caminho),
  validar("query", ROTAS.listarDiscipuladores.consulta),
  async (c) =>
    c.json({
      itens: await listarDiscipuladores(c.env.DB, c.req.valid("query")),
    }),
);

hierarquia.get(
  local(ROTAS.obterDiscipulador.caminho),
  validar("param", ROTAS.obterDiscipulador.parametros),
  async (c) =>
    responder(c, await obterDiscipulador(c.env.DB, c.req.valid("param").id)),
);

hierarquia.post(
  local(ROTAS.criarDiscipulador.caminho),
  exigirJson,
  validar("json", ROTAS.criarDiscipulador.corpo),
  async (c) =>
    responder(c, await criarDiscipulador(c.env.DB, c.req.valid("json")), 201),
);

hierarquia.put(
  local(ROTAS.atualizarDiscipulador.caminho),
  validar("param", ROTAS.atualizarDiscipulador.parametros),
  exigirJson,
  validar("json", ROTAS.atualizarDiscipulador.corpo),
  async (c) =>
    responder(
      c,
      await atualizarDiscipulador(
        c.env.DB,
        c.req.valid("param").id,
        c.req.valid("json"),
      ),
    ),
);

hierarquia.delete(
  local(ROTAS.removerDiscipulador.caminho),
  validar("param", ROTAS.removerDiscipulador.parametros),
  async (c) => {
    const resultado = await removerDiscipulador(
      c.env.DB,
      c.req.valid("param").id,
    );
    return resultado.ok ? c.body(null, 204) : responder(c, resultado);
  },
);

// ---------------------------------------------------------------------------------------------------
// Células
// ---------------------------------------------------------------------------------------------------

hierarquia.get(
  local(ROTAS.listarCelulas.caminho),
  validar("query", ROTAS.listarCelulas.consulta),
  async (c) =>
    c.json({ itens: await listarCelulas(c.env.DB, c.req.valid("query")) }),
);

hierarquia.get(
  local(ROTAS.obterCelula.caminho),
  validar("param", ROTAS.obterCelula.parametros),
  async (c) =>
    responder(c, await obterCelula(c.env.DB, c.req.valid("param").id)),
);

hierarquia.post(
  local(ROTAS.criarCelula.caminho),
  exigirJson,
  validar("json", ROTAS.criarCelula.corpo),
  async (c) =>
    responder(c, await criarCelula(c.env.DB, c.req.valid("json")), 201),
);

hierarquia.put(
  local(ROTAS.atualizarCelula.caminho),
  validar("param", ROTAS.atualizarCelula.parametros),
  exigirJson,
  validar("json", ROTAS.atualizarCelula.corpo),
  async (c) =>
    responder(
      c,
      await atualizarCelula(
        c.env.DB,
        c.req.valid("param").id,
        c.req.valid("json"),
      ),
    ),
);

hierarquia.delete(
  local(ROTAS.removerCelula.caminho),
  validar("param", ROTAS.removerCelula.parametros),
  async (c) => {
    const resultado = await removerCelula(c.env.DB, c.req.valid("param").id);
    return resultado.ok ? c.body(null, 204) : responder(c, resultado);
  },
);

// ---------------------------------------------------------------------------------------------------
// Importação da planilha
// ---------------------------------------------------------------------------------------------------

hierarquia.post(
  local(ROTAS.importarHierarquia.caminho),
  exigirJson,
  validar("json", ROTAS.importarHierarquia.corpo),
  async (c) => {
    const { csv, simular } = c.req.valid("json");
    return responder(c, await importarHierarquia(c.env.DB, csv, simular));
  },
);

// Vale só para as rotas deste sub-app (o Hono embrulha cada uma com este tratador ao montar).
hierarquia.onError((erro, c) => {
  // O validador do Hono lança HTTPException 400 quando o corpo se diz JSON, mas não é.
  if (erro instanceof HTTPException && erro.status === 400)
    return responderErro(
      c,
      "json_invalido",
      "O corpo da requisição não é um JSON válido",
    );
  console.error(`${c.req.method} ${c.req.path}: erro não tratado`, erro);
  return responderErro(c, "erro_interno", "Erro interno");
});
