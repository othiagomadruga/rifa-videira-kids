/**
 * Formato único de erro da API v1 e catálogo de códigos.
 *
 * Toda resposta não 2xx tem o corpo `{ "erro": { "codigo", "mensagem", "detalhes"? } }`.
 * Os clientes devem tratar `codigo` como texto aberto: códigos novos podem surgir sem quebrar o contrato.
 * Documentação: docs/api.md, seção "Erros".
 */
import { z } from "zod";

/** Códigos de erro conhecidos na v1. */
export const CODIGOS_ERRO = [
  "requisicao_invalida",
  "json_invalido",
  "payload_invalido",
  "csv_invalido",
  "referencia_invalida",
  "nao_autenticado",
  "proibido",
  "nao_encontrado",
  "nome_duplicado",
  "em_uso",
  "corpo_muito_grande",
  "muitas_requisicoes",
  "erro_interno",
  "nao_configurado",
  "banco_indisponivel",
] as const;

export type CodigoErro = (typeof CODIGOS_ERRO)[number];

/** Status HTTP de cada código de erro. */
export const STATUS_HTTP_DO_ERRO = {
  requisicao_invalida: 400,
  json_invalido: 400,
  payload_invalido: 400,
  csv_invalido: 400,
  referencia_invalida: 400,
  nao_autenticado: 401,
  proibido: 403,
  nao_encontrado: 404,
  nome_duplicado: 409,
  em_uso: 409,
  corpo_muito_grande: 413,
  muitas_requisicoes: 429,
  erro_interno: 500,
  nao_configurado: 503,
  banco_indisponivel: 503,
} as const satisfies Record<CodigoErro, number>;

/**
 * Um problema de validação, sem o valor recebido (o zod 4 não inclui a entrada nas mensagens).
 * Por isso pode ser gravado e devolvido sem vazar dado pessoal (D1).
 */
export const detalheValidacaoSchema = z.object({
  caminho: z.array(z.union([z.string(), z.number()])),
  codigo: z.string(),
  mensagem: z.string(),
});
export type DetalheValidacao = z.infer<typeof detalheValidacaoSchema>;

export const erroApiSchema = z.object({
  erro: z.object({
    codigo: z.string().min(1),
    mensagem: z.string().min(1),
    detalhes: z.unknown().optional(),
  }),
});
export type ErroApi = z.infer<typeof erroApiSchema>;

/** Monta o corpo de erro padrão. */
export function criarErroApi(
  codigo: CodigoErro,
  mensagem: string,
  detalhes?: unknown,
): ErroApi {
  return detalhes === undefined
    ? { erro: { codigo, mensagem } }
    : { erro: { codigo, mensagem, detalhes } };
}

/** O mínimo de um problema do zod. Vale para o ZodError e para o $ZodError que o hook do @hono/zod-validator recebe. */
export interface ProblemaZod {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly message: string;
}

/** Converte os problemas de um erro do zod em `DetalheValidacao[]` (caminho, código e mensagem; nunca o valor). */
export function detalhesDeValidacao(erro: {
  readonly issues: readonly ProblemaZod[];
}): DetalheValidacao[] {
  return erro.issues.map((problema) => ({
    caminho: problema.path.map((parte) =>
      typeof parte === "number" ? parte : String(parte),
    ),
    codigo: problema.code,
    mensagem: problema.message,
  }));
}

/** Máximo de itens numa lista gravada de problemas ou avisos; o resto vira um item final de contagem. */
export const LIMITE_DETALHES = 50;

/**
 * Problema ou aviso agrupado por caminho sem índices (`["numbers", "*"]`) e código, com o número de
 * ocorrências: 5.000 bilhetes inválidos viram UM item com `ocorrencias: 5000`. Nunca traz o valor.
 */
export const detalheResumidoSchema = detalheValidacaoSchema.extend({
  ocorrencias: z.number().int().min(1),
});
export type DetalheResumido = z.infer<typeof detalheResumidoSchema>;

/**
 * Agrupa por caminho (índices viram "*") e código, e corta em LIMITE_DETALHES grupos. O que passar do
 * limite vira um item final `itens_omitidos` com o total de ocorrências omitidas. Mantém pequeno o
 * registro do evento (o D1 recusa linhas acima de 2 MB).
 */
export function resumirDetalhes(
  detalhes: readonly DetalheValidacao[],
): DetalheResumido[] {
  const grupos = new Map<string, DetalheResumido>();
  for (const detalhe of detalhes) {
    const caminho = detalhe.caminho.map((parte) =>
      typeof parte === "number" ? "*" : parte,
    );
    const chave = JSON.stringify([caminho, detalhe.codigo]);
    const grupo = grupos.get(chave);
    if (grupo) {
      grupo.ocorrencias += 1;
    } else {
      grupos.set(chave, {
        caminho,
        codigo: detalhe.codigo,
        mensagem: detalhe.mensagem,
        ocorrencias: 1,
      });
    }
  }
  const resumo = [...grupos.values()];
  if (resumo.length <= LIMITE_DETALHES) return resumo;
  const omitidos = resumo.slice(LIMITE_DETALHES);
  return [
    ...resumo.slice(0, LIMITE_DETALHES),
    {
      caminho: [],
      codigo: "itens_omitidos",
      mensagem: `${omitidos.length} itens omitidos (limite de ${LIMITE_DETALHES})`,
      ocorrencias: omitidos.reduce((soma, item) => soma + item.ocorrencias, 0),
    },
  ];
}
