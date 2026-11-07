/**
 * Contrato HTTP da API v1: schemas de parâmetros, consulta, corpo e resposta de cada rota, e o catálogo
 * `ROTAS`. Documentação: docs/api.md.
 *
 * - Rotas "detalhadas" (Sprints 1–4) estão fechadas. Uma rota "rascunho" pode mudar quando for
 *   implementada (hoje não há nenhuma); só o SM altera o contrato.
 * - Erros: sempre o formato de ./erros (`{ erro: { codigo, mensagem, detalhes? } }`).
 * - O webhook valida o corpo dentro do handler (precisa registrar `erro_validacao` antes de responder 400);
 *   as demais rotas podem usar @hono/zod-validator com um hook que devolve `requisicao_invalida`.
 */
import { z } from "zod";
import {
  CRITERIOS_RANKING,
  UNIDADES_META,
  affiliateIdSchema,
  afiliadoSchema,
  campanhaEntradaSchema,
  campanhaSchema,
  celulaEntradaSchema,
  celulaSchema,
  centavosSchema,
  dataLocalSchema,
  discipuladorEntradaSchema,
  discipuladorSchema,
  divisaoSchema,
  idSchema,
  instanteSchema,
  redeEntradaSchema,
  redeSchema,
  resultadoEventoWebhookSchema,
  statusPedidoSchema,
} from "./dominio";
import { detalheResumidoSchema } from "./erros";
import { payloadRifeiSchema } from "./rifei";

// ---------------------------------------------------------------------------------------------------
// Autorização e utilitários
// ---------------------------------------------------------------------------------------------------

/**
 * - aberto: sem autenticação (/api/health e /api/publico/*; o público nunca recebe valores financeiros);
 * - rifei_bearer: `Authorization: Bearer <RIFEI_WEBHOOK_TOKEN>` (/api/webhooks/*);
 * - coordenacao: equipe da campanha (/api/admin/* e /api/painel/*); o mecanismo sai na RIFA-007.
 */
export const GRUPOS_AUTORIZACAO = [
  "aberto",
  "rifei_bearer",
  "coordenacao",
] as const;
export type GrupoAutorizacao = (typeof GRUPOS_AUTORIZACAO)[number];

export const SITUACOES_ROTA = ["detalhada", "rascunho"] as const;
export type SituacaoRota = (typeof SITUACOES_ROTA)[number];

/** Resposta de listagem: `{ itens: [...] }`, sem paginação na v1. */
export function lista<T extends z.ZodType>(item: T) {
  return z.object({ itens: z.array(item) });
}

/** Parâmetro `:id` numérico (vem como texto na URL). */
export const parametroIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Totais de vendas aprovadas (só pedidos `approved` contam, D4). */
export const totaisVendasSchema = z.object({
  pedidos_aprovados: z.number().int().nonnegative(),
  bilhetes: z.number().int().nonnegative(),
  total_centavos: centavosSchema,
});
export type TotaisVendas = z.infer<typeof totaisVendasSchema>;

// ---------------------------------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------------------------------

/** Formato que o esqueleto (RIFA-001) já serve e o site já lê (`src/web/api.ts`). */
export const respostaHealthSchema = z.object({
  ok: z.literal(true),
  db: z.literal("ok"),
  latenciaMs: z.number().nonnegative(),
});

// ---------------------------------------------------------------------------------------------------
// POST /api/webhooks/rifei. O handler valida o corpo com analisarPayloadRifei(corpo), e não com
// payloadRifeiSchema direto: só assim os avisos chegam a webhook_eventos.avisos (avisosParaGravar).
// ---------------------------------------------------------------------------------------------------

/**
 * Tamanho máximo do corpo do webhook (1 MiB). É conferido depois da autenticação: acima disso, 413
 * `corpo_muito_grande` (o evento é registrado como `erro_validacao`, sem payload). Um pedido real
 * ocupa poucos KB; o limite protege memória e CPU do Worker.
 */
export const LIMITE_CORPO_WEBHOOK_BYTES = 1_048_576;

/** Caminhos aceitos do webhook: com e sem barra no fim. */
export const CAMINHOS_WEBHOOK_RIFEI = [
  "/api/webhooks/rifei",
  "/api/webhooks/rifei/",
] as const;

/** 200: o evento foi gravado em webhook_eventos (com o resultado). */
export const respostaWebhookRifeiSchema = z.object({
  resultado: resultadoEventoWebhookSchema.exclude(["erro_validacao"]),
  evento_id: idSchema,
});
export type RespostaWebhookRifei = z.infer<typeof respostaWebhookRifeiSchema>;

/**
 * `detalhes` dos erros do webhook que gravam evento: 400 `json_invalido` ou `payload_invalido` e 413
 * `corpo_muito_grande`. Os problemas vêm agrupados e limitados (resumirDetalhes).
 */
export const detalhesErroWebhookSchema = z.object({
  evento_id: idSchema,
  problemas: z.array(detalheResumidoSchema).min(1),
});

// ---------------------------------------------------------------------------------------------------
// GET e PUT /api/admin/campanha
// ---------------------------------------------------------------------------------------------------

export const corpoSalvarCampanhaSchema = campanhaEntradaSchema;
export const respostaCampanhaSchema = campanhaSchema;

// ---------------------------------------------------------------------------------------------------
// CRUD /api/admin/redes, /api/admin/discipuladores, /api/admin/celulas
// ---------------------------------------------------------------------------------------------------

export const respostaListaRedesSchema = lista(redeSchema);

export const consultaDiscipuladoresSchema = z.object({
  rede_id: z.coerce.number().int().positive().optional(),
});
export const respostaListaDiscipuladoresSchema = lista(discipuladorSchema);

export const consultaCelulasSchema = z.object({
  discipulador_id: z.coerce.number().int().positive().optional(),
  rede_id: z.coerce.number().int().positive().optional(),
  divisao: divisaoSchema.optional(),
});
export const respostaListaCelulasSchema = lista(celulaSchema);

// ---------------------------------------------------------------------------------------------------
// POST /api/admin/hierarquia/importar
// ---------------------------------------------------------------------------------------------------

/** Colunas do CSV, na ordem sugerida. Cabeçalho obrigatório; nomes sem acento, em minúsculas. */
export const COLUNAS_CSV_HIERARQUIA = [
  "rede",
  "divisao",
  "rede_responsavel",
  "discipulador",
  "celula",
  "qtd_pessoas",
  "lider_nome",
  "lider_email",
  "lider_telefone",
] as const;
export type ColunaCsvHierarquia = (typeof COLUNAS_CSV_HIERARQUIA)[number];

export const COLUNAS_CSV_HIERARQUIA_OBRIGATORIAS = [
  "rede",
  "divisao",
  "discipulador",
  "celula",
  "qtd_pessoas",
  "lider_nome",
] as const satisfies readonly ColunaCsvHierarquia[];

/** Máximo de linhas de dados por arquivo. */
export const LIMITE_LINHAS_CSV_HIERARQUIA = 2000;

/** Máximo de caracteres do arquivo (o campo `csv` do corpo): cerca de 1 MB. */
export const LIMITE_CARACTERES_CSV_HIERARQUIA = 1_000_000;

/**
 * `detalhes` do erro 400 `csv_invalido` (importação da hierarquia e, depois, a reconciliação): o
 * arquivo não pôde nem ser lido linha a linha. A tela mostra a `mensagem`; `motivo` é para quem
 * precisa tratar cada caso. `linha` conta o cabeçalho como linha 1.
 */
export const detalhesCsvInvalidoSchema = z.discriminatedUnion("motivo", [
  /** Arquivo vazio ou sem linha de cabeçalho. */
  z.object({ motivo: z.literal("sem_cabecalho") }),
  /** Faltam colunas obrigatórias no cabeçalho. */
  z.object({
    motivo: z.literal("colunas_faltando"),
    colunas: z.array(z.string().min(1)).min(1),
  }),
  /** Mais linhas de dados que o limite. */
  z.object({
    motivo: z.literal("linhas_demais"),
    limite: z.number().int().positive(),
    total_linhas: z.number().int().positive(),
  }),
  /** Arquivo maior que o limite de caracteres. */
  z.object({
    motivo: z.literal("arquivo_grande"),
    limite_caracteres: z.number().int().positive(),
  }),
  /** Uma coluna conhecida aparece mais de uma vez no cabeçalho. */
  z.object({
    motivo: z.literal("coluna_repetida"),
    coluna: z.string().min(1),
  }),
  /** Aspas abertas que não fecham até o fim do arquivo. */
  z.object({
    motivo: z.literal("aspas_abertas"),
    linha: z.number().int().positive(),
  }),
  /** O arquivo não estava em UTF-8 (o texto chegou com caracteres de substituição). */
  z.object({
    motivo: z.literal("codificacao_invalida"),
    linha: z.number().int().positive(),
  }),
]);
export type DetalhesCsvInvalido = z.infer<typeof detalhesCsvInvalidoSchema>;

export const corpoImportarHierarquiaSchema = z.object({
  /** Conteúdo do arquivo (UTF-8, separador "," ou ";", aspas como no RFC 4180). */
  csv: z.string().min(1).max(LIMITE_CARACTERES_CSV_HIERARQUIA),
  /** true = só valida e conta o que mudaria, sem gravar. */
  simular: z.boolean().default(false),
});

/**
 * Junta espaços em sequência (inclusive tab, quebra de linha e espaço não separável) num espaço só e
 * tira os das pontas: "Rede  Jovem" e "Rede Jovem" são o mesmo nome. Vale para os textos da planilha e
 * para a comparação de nomes da hierarquia.
 */
export function normalizarEspacos(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/** Célula de texto do CSV: espaços normalizados (`normalizarEspacos`); vazio vira null. */
function textoCsv(valor: unknown): unknown {
  if (typeof valor !== "string") return valor;
  const limpo = normalizarEspacos(valor);
  return limpo === "" ? null : limpo;
}

const nomeCsvSchema = z.preprocess(textoCsv, z.string().min(1).max(120));
const opcionalCsv = <T extends z.ZodType>(schema: T) =>
  z.preprocess(textoCsv, schema.nullable()).optional();

/**
 * Uma linha de dados do CSV, com as chaves do cabeçalho. Coluna opcional ausente do cabeçalho = mantém
 * o valor atual; presente e vazia = apaga (null). Colunas desconhecidas são ignoradas.
 */
export const linhaCsvHierarquiaSchema = z.object({
  rede: nomeCsvSchema,
  divisao: z.preprocess(
    (valor) => (typeof valor === "string" ? valor.trim().toLowerCase() : valor),
    divisaoSchema,
  ),
  rede_responsavel: opcionalCsv(z.string().min(1).max(120)),
  discipulador: nomeCsvSchema,
  celula: nomeCsvSchema,
  qtd_pessoas: z.preprocess(
    textoCsv,
    z
      .string()
      .regex(/^\d+$/, { message: "Use um número inteiro" })
      .transform(Number)
      .pipe(z.number().int().min(1).max(1000)),
  ),
  lider_nome: nomeCsvSchema,
  lider_email: opcionalCsv(z.email().max(254)),
  lider_telefone: opcionalCsv(z.string().min(1).max(40)),
});
export type LinhaCsvHierarquia = z.infer<typeof linhaCsvHierarquiaSchema>;

export const contagemHierarquiaSchema = z.object({
  redes: z.number().int().nonnegative(),
  discipuladores: z.number().int().nonnegative(),
  celulas: z.number().int().nonnegative(),
});

export const erroLinhaImportacaoSchema = z.object({
  /** Linha no arquivo, contando o cabeçalho como linha 1. */
  linha: z.number().int().min(2),
  /** null quando o problema é da linha inteira (ex.: célula repetida com dados diferentes). */
  coluna: z.enum(COLUNAS_CSV_HIERARQUIA).nullable(),
  mensagem: z.string().min(1),
});

/**
 * Avisos não impedem a importação:
 * - linha_repetida: linha igual a uma anterior (mesma célula, mesmos dados), ignorada;
 * - coluna_ignorada: coluna do cabeçalho que não é do contrato (linha 1), com sugestão quando parecida.
 * A mensagem não traz dados pessoais (só números de linha e nomes de coluna).
 */
export const TIPOS_AVISO_IMPORTACAO = [
  "linha_repetida",
  "coluna_ignorada",
] as const;

export const avisoImportacaoSchema = z.object({
  tipo: z.enum(TIPOS_AVISO_IMPORTACAO),
  /** Linha no arquivo, contando o cabeçalho como linha 1. */
  linha: z.number().int().min(1),
  mensagem: z.string().min(1),
});
export type AvisoImportacao = z.infer<typeof avisoImportacaoSchema>;

/**
 * Importação atômica: se qualquer linha tiver erro, nada é gravado (`aplicado: false`) e as contagens
 * mostram o que teria acontecido. Linhas de outras células não citadas no arquivo ficam como estão.
 */
export const respostaImportarHierarquiaSchema = z.object({
  aplicado: z.boolean(),
  simulado: z.boolean(),
  total_linhas: z.number().int().nonnegative(),
  criados: contagemHierarquiaSchema,
  atualizados: contagemHierarquiaSchema,
  inalterados: contagemHierarquiaSchema,
  erros: z.array(erroLinhaImportacaoSchema),
  /** Lista vazia quando não há aviso. */
  avisos: z.array(avisoImportacaoSchema),
});
export type RespostaImportarHierarquia = z.infer<
  typeof respostaImportarHierarquiaSchema
>;

// ---------------------------------------------------------------------------------------------------
// GET /api/admin/afiliados e PUT /api/admin/afiliados/:affiliateId
// ---------------------------------------------------------------------------------------------------

export const consultaAfiliadosSchema = z.object({
  /** true = só vinculados a uma célula; false = só a fila de órfãos; ausente = todos. */
  vinculado: z.stringbool().optional(),
});

export const parametroAffiliateIdSchema = z.object({
  affiliateId: z.coerce.number().int().positive(),
});

/** Cria o afiliado se ainda não existe (pré-cadastro, origem `manual`). */
export const corpoSalvarAfiliadoSchema = z.object({
  /** id da célula para vincular; null para desvincular. */
  celula_id: idSchema.nullable(),
  /** Ausente = mantém; null = apaga. */
  rotulo: z.string().trim().min(1).max(120).nullable().optional(),
});

export const afiliadoResumoSchema = afiliadoSchema.extend({
  celula_nome: z.string().min(1).max(120).nullable(),
  /** Só pedidos aprovados. */
  vendas: totaisVendasSchema,
  primeira_venda_em: instanteSchema.nullable(),
  ultima_venda_em: instanteSchema.nullable(),
});
export type AfiliadoResumo = z.infer<typeof afiliadoResumoSchema>;

export const respostaListaAfiliadosSchema = z.object({
  itens: z.array(afiliadoResumoSchema),
  /** Vendas aprovadas sem affiliate_id (não entram em nenhuma célula). */
  sem_afiliado: totaisVendasSchema,
});

// ---------------------------------------------------------------------------------------------------
// GET /api/admin/adesao ("quem falta")
// ---------------------------------------------------------------------------------------------------

export const adesaoCelulaSchema = z.object({
  celula_id: idSchema,
  celula_nome: z.string().min(1).max(120),
  qtd_pessoas: z.number().int().min(1),
  lider_nome: z.string().min(1).max(120),
  lider_telefone: z.string().nullable(),
  discipulador_id: idSchema,
  discipulador_nome: z.string().min(1).max(120),
  rede_id: idSchema,
  rede_nome: z.string().min(1).max(120),
  divisao: divisaoSchema,
  /** Afiliados vinculados à célula (normalmente um). */
  afiliados: z.array(affiliateIdSchema),
  /** Tem ao menos um afiliado vinculado. */
  vinculada: z.boolean(),
  /** Primeiro pedido aprovado de qualquer afiliado da célula. */
  primeira_venda_em: instanteSchema.nullable(),
  pedidos_aprovados: z.number().int().nonnegative(),
});

export const respostaAdesaoSchema = z.object({
  resumo: z.object({
    celulas: z.number().int().nonnegative(),
    vinculadas: z.number().int().nonnegative(),
    com_venda: z.number().int().nonnegative(),
    afiliados_nao_vinculados: z.number().int().nonnegative(),
  }),
  itens: z.array(adesaoCelulaSchema),
});

// ---------------------------------------------------------------------------------------------------
// Painel, rankings, visão pública e bumbo (RIFA-008). As respostas saem das funções `montar*` de
// ./calculos (montarResumoPainel, montarRankingPainel, montarRankingPublico e montarBumbo); regras,
// fontes e arredondamento em docs/regras-de-calculo.md.
//
// - `meta`, `esperado`, `realizado`, `diferenca`, `projecao` e as metas do dia estão na unidade da meta
//   da campanha (`unidade`: bilhetes ou centavos). Alvos são arredondados para cima, em unidades inteiras.
// - Percentuais `*_bp` são pontos-base inteiros, truncados, e passam de 10000 quando a meta é superada.
// - "Esperado" é sempre até o fim de ONTEM (dias fechados): o dia corrente tem a meta do dia à parte.
// - Schemas estritos: um campo a mais invalida a resposta (nas rotas abertas, é a prova de que nenhum
//   valor financeiro escapa).
// ---------------------------------------------------------------------------------------------------

export const FASES_CAMPANHA = ["antes", "durante", "encerrada"] as const;

/**
 * Situação de uma instância numa janela (docs/regras-de-calculo.md, R4):
 * - em_dia: o realizado até agora cobre o esperado até o fim de ontem;
 * - abaixo: não cobre (`diferenca` negativa);
 * - sem_meta: a meta da instância na janela é zero (não há o que cobrar).
 */
export const SITUACOES_RITMO = ["em_dia", "abaixo", "sem_meta"] as const;
export type SituacaoRitmo = (typeof SITUACOES_RITMO)[number];

const quantidadeSchema = z.number().int().nonnegative();
/** Pontos-base truncados, sem teto (passam de 10000 acima da meta). */
const percentualBpSchema = z.number().int().nonnegative();

/** Fase, dia e período numa data local. Não tem valores: também vai para as rotas abertas. */
export const referenciaCampanhaSchema = z.strictObject({
  /** Data de referência: hoje no fuso da campanha ou a `data` consultada. */
  data: dataLocalSchema,
  fase: z.enum(FASES_CAMPANHA),
  data_inicio: dataLocalSchema,
  data_fim: dataLocalSchema,
  duracao_dias: z.number().int().min(1),
  /** Dia da campanha (1 = primeiro dia de vendas); null fora dela. */
  dia_campanha: z.number().int().min(1).nullable(),
  /** Dias que faltam contando hoje: antes = duração; no último dia = 1; encerrada = 0. */
  dias_restantes: quantidadeSchema,
  /** Só antes do início: dias até o primeiro dia (véspera = 1). */
  dias_para_inicio: z.number().int().min(1).nullable(),
  /** Período que contém a data; null fora da campanha. */
  periodo: z
    .strictObject({
      ordem: z.number().int().min(1),
      nome: z.string().min(1),
      data_inicio: dataLocalSchema,
      data_fim: dataLocalSchema,
      dias: z.number().int().min(1),
      dia_no_periodo: z.number().int().min(1),
      /** Contando hoje: no último dia do período = 1. */
      dias_restantes: z.number().int().min(1),
    })
    .nullable(),
});
export type ReferenciaCampanha = z.infer<typeof referenciaCampanhaSchema>;

// ---------------------------------------------------------------------------------------------------
// GET /api/painel/resumo (coordenação, com valores)
// ---------------------------------------------------------------------------------------------------

export const ESCOPOS_PAINEL = [
  "campanha",
  "divisao",
  "rede",
  "discipulador",
  "celula",
] as const;
export type EscopoPainel = (typeof ESCOPOS_PAINEL)[number];
const ESCOPOS_COM_ID: readonly string[] = ["rede", "discipulador", "celula"];

export const consultaPainelResumoSchema = z
  .object({
    escopo: z.enum(ESCOPOS_PAINEL).default("campanha"),
    /** id da rede, do discipulador ou da célula (obrigatório nesses escopos). */
    id: z.coerce.number().int().positive().optional(),
    /** Obrigatória no escopo `divisao`. */
    divisao: divisaoSchema.optional(),
    /** Data de referência (local), no máximo hoje; padrão: hoje no fuso da campanha. */
    data: dataLocalSchema.optional(),
  })
  .refine(
    (consulta) =>
      !ESCOPOS_COM_ID.includes(consulta.escopo) || consulta.id !== undefined,
    {
      message: "Informe id para este escopo",
      path: ["id"],
    },
  )
  .refine(
    (consulta) =>
      consulta.escopo !== "divisao" || consulta.divisao !== undefined,
    {
      message: "Informe a divisão",
      path: ["divisao"],
    },
  );
export type ConsultaPainelResumo = z.output<typeof consultaPainelResumoSchema>;

/** Ritmo de uma instância numa janela (campanha inteira ou período atual). */
export const ritmoSchema = z.strictObject({
  /** Meta da instância na janela. */
  meta: quantidadeSchema,
  /** Esperado pela curva até o fim de ontem, dentro da janela. */
  esperado: quantidadeSchema,
  /** Vendido na janela até agora (inclui hoje). */
  realizado: quantidadeSchema,
  /** Vendido na janela até o fim de ontem. */
  realizado_ate_ontem: quantidadeSchema,
  /** realizado − esperado (negativo = abaixo da curva). */
  diferenca: z.number().int(),
  situacao: z.enum(SITUACOES_RITMO),
  /** realizado ÷ meta; null sem meta. */
  percentual_meta_bp: percentualBpSchema.nullable(),
  /** Onde a curva manda estar: esperado ÷ meta; null sem meta. */
  percentual_esperado_bp: percentualBpSchema.max(10_000).nullable(),
  /** realizado_ate_ontem ÷ esperado (dias fechados); null enquanto o esperado é zero. */
  ritmo_bp: percentualBpSchema.nullable(),
});
export type Ritmo = z.infer<typeof ritmoSchema>;

/** Meta do dia corrente (docs/regras-de-calculo.md, R3). */
export const metaDoDiaSchema = z.strictObject({
  data: dataLocalSchema,
  /** Esperado até o fim de hoje − realizado até ontem, nunca negativa: o que faltou entra aqui. */
  meta: quantidadeSchema,
  /** A parte da curva neste dia, sem o ajuste do que faltou ou sobrou antes. */
  meta_base: quantidadeSchema,
  realizado: quantidadeSchema,
  /** max(0, meta − realizado). */
  falta: quantidadeSchema,
  /** realizado ÷ meta; null quando a meta do dia é zero. */
  percentual_meta_bp: percentualBpSchema.nullable(),
  batida: z.boolean(),
});

/** Um dia da curva (gráfico): esperado e realizado acumulados ao fim do dia. */
export const pontoCurvaSchema = z.strictObject({
  dia: z.number().int().min(1),
  data: dataLocalSchema,
  esperado: quantidadeSchema,
  /** null nos dias depois da data de referência. */
  realizado: quantidadeSchema.nullable(),
  realizado_no_dia: quantidadeSchema.nullable(),
});

export const respostaPainelResumoSchema = z.strictObject({
  escopo: z.strictObject({
    tipo: z.enum(ESCOPOS_PAINEL),
    /** null nos escopos campanha e divisão. */
    id: idSchema.nullable(),
    /** A divisão do escopo (a da rede, nos escopos rede, discipulador e célula); null na campanha. */
    divisao: divisaoSchema.nullable(),
    nome: z.string().min(1),
  }),
  referencia: referenciaCampanhaSchema,
  unidade: z.enum(UNIDADES_META),
  /** Meta e venda de hoje; só durante a campanha. */
  hoje: metaDoDiaSchema.nullable(),
  /** Período atual; só durante a campanha. */
  periodo: ritmoSchema.nullable(),
  /** Campanha inteira, com a projeção do fim no ritmo dos dias fechados. */
  campanha: ritmoSchema.extend({
    /** Na unidade da meta (para baixo). Null antes do início e no 1º dia; depois do fim, o resultado. */
    projecao: quantidadeSchema.nullable(),
    projecao_percentual_meta_bp: percentualBpSchema.nullable(),
  }),
  /** Um ponto por dia da campanha. */
  curva: z.array(pontoCurvaSchema),
  /** Vendas aprovadas do escopo dentro da janela da campanha, até a data de referência. */
  vendas: totaisVendasSchema,
  /** Só no escopo campanha: as vendas sem célula (já somadas em `vendas`). */
  vendas_sem_celula: totaisVendasSchema.nullable(),
  /** Só no escopo campanha: aprovadas fora da janela (não contam em nada), para a coordenação ver. */
  vendas_fora_da_janela: z
    .strictObject({
      antes_do_inicio: totaisVendasSchema,
      depois_do_fim: totaisVendasSchema,
    })
    .nullable(),
  atualizado_em: instanteSchema,
});
export type RespostaPainelResumo = z.infer<typeof respostaPainelResumoSchema>;

// ---------------------------------------------------------------------------------------------------
// GET /api/painel/ranking (coordenação, com valores)
// ---------------------------------------------------------------------------------------------------

export const NIVEIS_RANKING = ["celula", "discipulador", "rede"] as const;
export type NivelRanking = (typeof NIVEIS_RANKING)[number];
export const JANELAS_RANKING = ["atual", "campanha"] as const;
/**
 * Janela PEDIDA na consulta (`periodo`): "atual" | "campanha". O objeto que sai na resposta (tipo,
 * ordem, nome e datas) é `janelaRankingSchema`, com o tipo nomeado `JanelaRankingResposta` em calculos.ts.
 */
export type JanelaRanking = (typeof JANELAS_RANKING)[number];

export const consultaRankingSchema = z.object({
  nivel: z.enum(NIVEIS_RANKING).default("celula"),
  /** Filtra uma divisão (rankings separados de jovens e adultos). */
  divisao: divisaoSchema.optional(),
  /**
   * `atual` = período que contém a data (antes do início, o 1º; depois do fim, o último);
   * `campanha` = do primeiro dia até a data.
   */
  periodo: z.enum(JANELAS_RANKING).default("atual"),
  /** Data de referência (local), no máximo hoje; padrão: hoje no fuso da campanha. */
  data: dataLocalSchema.optional(),
});
export type ConsultaRanking = z.output<typeof consultaRankingSchema>;

/** A janela como sai na resposta; `tipo` é a `JanelaRanking` pedida. Tipo: `JanelaRankingResposta`. */
export const janelaRankingSchema = z.strictObject({
  tipo: z.enum(JANELAS_RANKING),
  /** Ordem do período (null quando a janela é a campanha). */
  ordem: z.number().int().min(1).nullable(),
  nome: z.string().min(1),
  data_inicio: dataLocalSchema,
  data_fim: dataLocalSchema,
});

const vinculoRankingSchema = z.strictObject({
  id: idSchema,
  nome: z.string().min(1),
});

/** Quem está logo acima ou logo abaixo (na posição vizinha; empatados não são vizinhos). */
export const vizinhoRankingSchema = z.strictObject({
  id: idSchema,
  nome: z.string().min(1),
  posicao: z.number().int().min(1),
  /** Distância no critério (pontos-base, bilhetes ou centavos); null se um dos dois está sem meta. */
  diferenca: z.number().int().nonnegative().nullable(),
});

export const itemRankingSchema = z.strictObject({
  /** Empates dividem a posição (1, 1, 3). */
  posicao: z.number().int().min(1),
  /** id da célula, do discipulador ou da rede. */
  id: idSchema,
  nome: z.string().min(1),
  divisao: divisaoSchema,
  /** Só no nível célula. */
  discipulador: vinculoRankingSchema.nullable(),
  /** Nos níveis célula e discipulador. */
  rede: vinculoRankingSchema.nullable(),
  meta: quantidadeSchema,
  esperado: quantidadeSchema,
  realizado: quantidadeSchema,
  diferenca: z.number().int(),
  situacao: z.enum(SITUACOES_RITMO),
  percentual_meta_bp: percentualBpSchema.nullable(),
  vendas: totaisVendasSchema,
  acima: vizinhoRankingSchema.nullable(),
  abaixo: vizinhoRankingSchema.nullable(),
});
export type ItemRanking = z.infer<typeof itemRankingSchema>;

export const respostaRankingSchema = z.strictObject({
  nivel: z.enum(NIVEIS_RANKING),
  divisao: divisaoSchema.nullable(),
  janela: janelaRankingSchema,
  criterio: z.enum(CRITERIOS_RANKING),
  unidade: z.enum(UNIDADES_META),
  referencia: referenciaCampanhaSchema,
  /** Todas as instâncias do nível (e da divisão), inclusive as que ainda não venderam. */
  itens: z.array(itemRankingSchema),
  atualizado_em: instanteSchema,
});
export type RespostaRanking = z.infer<typeof respostaRankingSchema>;

// ---------------------------------------------------------------------------------------------------
// GET /api/publico/ranking e GET /api/publico/bumbo (abertos: NENHUM valor financeiro)
// ---------------------------------------------------------------------------------------------------

export const consultaRankingPublicoSchema = consultaRankingSchema.omit({
  data: true,
});
export type ConsultaRankingPublico = z.output<
  typeof consultaRankingPublicoSchema
>;

export const itemRankingPublicoSchema = z.strictObject({
  posicao: z.number().int().min(1),
  nome: z.string().min(1),
  divisao: divisaoSchema,
  /** Só aparece se a campanha liga `publico.mostra_percentual_meta`. */
  percentual_meta_bp: percentualBpSchema.optional(),
});

export const respostaRankingPublicoSchema = z.strictObject({
  nivel: z.enum(NIVEIS_RANKING),
  divisao: divisaoSchema.nullable(),
  janela: janelaRankingSchema,
  criterio: z.enum(CRITERIOS_RANKING),
  referencia: referenciaCampanhaSchema,
  /**
   * Só quem já vendeu na janela, com `posicao` até `publico.limite_ranking` (padrão 3; null = todos).
   * As posições são as do ranking completo; empates na última posição entram todos (1, 2, 3, 3).
   */
  itens: z.array(itemRankingPublicoSchema),
  atualizado_em: instanteSchema,
});
export type RespostaRankingPublico = z.infer<
  typeof respostaRankingPublicoSchema
>;

export const consultaBumboSchema = z.object({
  /** Dia da mensagem (local), no máximo hoje; padrão: hoje. A mensagem fala do dia anterior. */
  data: dataLocalSchema.optional(),
});
export type ConsultaBumbo = z.output<typeof consultaBumboSchema>;

export const respostaBumboSchema = z.strictObject({
  data: dataLocalSchema,
  referencia: referenciaCampanhaSchema,
  /** Mensagem pronta para colar no WhatsApp. Nunca contém R$, centavos nem quantidade de bilhetes. */
  texto: z.string().min(1).max(4000),
  gerado_em: instanteSchema,
});
export type RespostaBumbo = z.infer<typeof respostaBumboSchema>;

// ---------------------------------------------------------------------------------------------------
// Conferência pelo CSV "Exportar Pedidos" da Rifei (RIFA-012): POST /api/admin/reconciliacao/analisar,
// POST /api/admin/reconciliacao/recuperar e GET /api/admin/reconciliacao/recuperacoes.
//
// O CSV traz nome, e-mail e telefone dos compradores (D1): é lido só na memória da requisição e
// descartado. As colunas de dado pessoal (pelo nome do cabeçalho) nunca são lidas nem podem entrar no
// mapeamento; as respostas só trazem códigos de pedido, status, quantidades, valores, afiliados, datas e
// os NOMES das colunas do cabeçalho. Nada do arquivo vai para o banco (além do pedido recuperado) nem
// para o log. Documentação: docs/api.md e docs/integracao-rifei.md (seção 10).
// ---------------------------------------------------------------------------------------------------

/** Máximo de caracteres do arquivo (o campo `csv`): cerca de 5 MB. */
export const LIMITE_CARACTERES_CSV_RECONCILIACAO = 5_000_000;
/** Máximo de linhas de dados (sem o cabeçalho e as linhas em branco). */
export const LIMITE_LINHAS_CSV_RECONCILIACAO = 50_000;
/** Colunas lidas do cabeçalho; as que passarem disso são ignoradas (aviso `colunas_demais`). */
export const LIMITE_COLUNAS_CSV_RECONCILIACAO = 200;
/** Pedidos por chamada de "Recuperar". */
export const LIMITE_PEDIDOS_RECUPERAR = 500;
/** Itens listados por tipo de divergência; a contagem e as somas do tipo contam todos. */
export const LIMITE_ITENS_POR_DIVERGENCIA = 500;

/**
 * Campos que a conferência lê do arquivo (todos opcionais):
 * - pedido_id: código do pedido na Rifei (o `id` do webhook). Com ele, a comparação é pedido a pedido;
 *   sem ele, por totais (por afiliado e por dia).
 * - status: situação do pedido ("Pago", "Pendente", "Expirado"...). Sem a coluna, todos os pedidos do
 *   arquivo são tratados como pagos (aviso `sem_coluna_status`).
 * - qtd_bilhetes: quantidade de bilhetes do pedido; bilhetes: os números dos bilhetes (a quantidade
 *   sai da contagem quando não há a coluna da quantidade).
 * - valor: valor pago ("R$ 20,00", "20,00", "20.00").
 * - afiliado: o `affiliate_id` (número) ou o usuário do afiliado na Rifei, comparado com o rótulo do
 *   afiliado cadastrado na tela Adesão.
 * - data: data do pagamento (ou do pedido), com ou sem hora, no fuso da campanha.
 */
export const CAMPOS_RECONCILIACAO = [
  "pedido_id",
  "status",
  "qtd_bilhetes",
  "bilhetes",
  "valor",
  "afiliado",
  "data",
] as const;
export type CampoReconciliacao = (typeof CAMPOS_RECONCILIACAO)[number];

/** Posição da coluna no cabeçalho (0 = primeira). */
const indiceColunaSchema = z
  .number()
  .int()
  .min(0)
  .max(LIMITE_COLUNAS_CSV_RECONCILIACAO - 1);

/**
 * Coluna de cada campo (posição no cabeçalho; null = o arquivo não tem). Uma coluna serve a um campo só
 * e nunca pode ser uma coluna de dado pessoal (a API confere com o cabeçalho e responde 400).
 */
export const mapeamentoReconciliacaoSchema = z.strictObject({
  pedido_id: indiceColunaSchema.nullable(),
  status: indiceColunaSchema.nullable(),
  qtd_bilhetes: indiceColunaSchema.nullable(),
  bilhetes: indiceColunaSchema.nullable(),
  valor: indiceColunaSchema.nullable(),
  afiliado: indiceColunaSchema.nullable(),
  data: indiceColunaSchema.nullable(),
});
export type MapeamentoReconciliacao = z.infer<
  typeof mapeamentoReconciliacaoSchema
>;

/**
 * Código do pedido como o arquivo traz: começa com letra ou número e só tem letras, números e . _ : / # -.
 * Assim nunca é uma fórmula de planilha (=, +, - ou @ no início), um e-mail ou um telefone com +. Linha
 * com código fora disso fica de fora (aviso `id_invalido`).
 */
export const FORMATO_ID_PEDIDO_RECONCILIACAO =
  /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$/;
export const idPedidoReconciliacaoSchema = z
  .string()
  .regex(FORMATO_ID_PEDIDO_RECONCILIACAO, {
    message: "Código de pedido inválido",
  });

const csvReconciliacaoSchema = z
  .string()
  .min(1)
  .max(LIMITE_CARACTERES_CSV_RECONCILIACAO);

export const corpoAnalisarReconciliacaoSchema = z.object({
  /** Conteúdo do arquivo (UTF-8, separador "," ou ";", aspas como no RFC 4180, BOM aceito). */
  csv: csvReconciliacaoSchema,
  /** Ausente: o sistema detecta as colunas pelos nomes do cabeçalho (`mapeamento_detectado: true`). */
  mapeamento: mapeamentoReconciliacaoSchema.optional(),
});

/** Uma coluna do cabeçalho do arquivo. Só o NOME da coluna sai na resposta, nunca o conteúdo. */
export const colunaArquivoReconciliacaoSchema = z.strictObject({
  indice: z.number().int().nonnegative(),
  /** Nome do cabeçalho com os espaços normalizados, até 40 caracteres; "Coluna N" quando vazio. */
  nome: z.string().min(1).max(40),
  /** Campo que o nome indica (null = nenhum). Pode haver mais de uma coluna com o mesmo campo. */
  campo_detectado: z.enum(CAMPOS_RECONCILIACAO).nullable(),
  /** Nome, e-mail, telefone, CPF, endereço...: nunca é lida e não pode entrar no mapeamento. */
  dado_pessoal: z.boolean(),
});
export type ColunaArquivoReconciliacao = z.infer<
  typeof colunaArquivoReconciliacaoSchema
>;

/** Status do pedido no arquivo, normalizado ("Pago" e "approved" são `aprovado`). */
export const STATUS_ARQUIVO_RECONCILIACAO = [
  "aprovado",
  "pendente",
  "expirado",
  "cancelado",
  "desconhecido",
] as const;
export type StatusArquivoReconciliacao =
  (typeof STATUS_ARQUIVO_RECONCILIACAO)[number];

/**
 * Afiliado do pedido no arquivo: sem a coluna; vazio (venda sem afiliado); reconhecido (número, ou
 * usuário igual ao rótulo de um afiliado cadastrado); ou não reconhecido (o valor não sai na resposta).
 */
export const SITUACOES_AFILIADO_ARQUIVO = [
  "sem_coluna",
  "vazio",
  "reconhecido",
  "nao_reconhecido",
] as const;
export type SituacaoAfiliadoArquivo =
  (typeof SITUACOES_AFILIADO_ARQUIVO)[number];

/** Como o pedido entrou no sistema: pelo webhook ou recuperado na conferência (migração 0004). */
export const ORIGENS_PEDIDO = ["webhook", "conferencia"] as const;
export type OrigemPedido = (typeof ORIGENS_PEDIDO)[number];

/** A célula do afiliado (null = sem afiliado, afiliado não vinculado ou não reconhecido). */
const celulaReconciliacaoSchema = z
  .strictObject({ id: idSchema, nome: z.string().min(1).max(120) })
  .nullable();

/** O pedido como o arquivo o traz (as linhas do mesmo código juntas). */
export const pedidoNoArquivoSchema = z.strictObject({
  /** `aprovado` também quando o arquivo não tem a coluna de status (aviso `sem_coluna_status`). */
  status: z.enum(STATUS_ARQUIVO_RECONCILIACAO),
  /** null: sem a coluna ou ilegível. */
  qtd_bilhetes: z.number().int().nonnegative().nullable(),
  total_centavos: centavosSchema.nullable(),
  afiliado: z.enum(SITUACOES_AFILIADO_ARQUIVO),
  /** Só com `afiliado` = reconhecido. */
  affiliate_id: affiliateIdSchema.nullable(),
  celula: celulaReconciliacaoSchema,
  /** Dia (no fuso da campanha) da coluna da data; null sem a coluna ou ilegível. */
  data: dataLocalSchema.nullable(),
});
export type PedidoNoArquivo = z.infer<typeof pedidoNoArquivoSchema>;

/** O pedido como está gravado (campanha ativa). */
export const pedidoNoSistemaSchema = z.strictObject({
  status: statusPedidoSchema,
  qtd_bilhetes: z.number().int().nonnegative(),
  total_centavos: centavosSchema,
  affiliate_id: affiliateIdSchema.nullable(),
  celula: celulaReconciliacaoSchema,
  aprovado_em: instanteSchema.nullable(),
  origem: z.enum(ORIGENS_PEDIDO),
});
export type PedidoNoSistema = z.infer<typeof pedidoNoSistemaSchema>;

/**
 * Tipos de divergência do modo por pedido, na ordem em que a resposta os traz:
 * - venda_perdida: pago na Rifei e ausente no sistema (não conta no painel nem no ranking): "Recuperar";
 * - pagamento_nao_registrado: pago na Rifei, e no sistema pendente ou expirado (o aviso de pagamento
 *   não chegou);
 * - nao_pago_na_rifei: pago no sistema, e na Rifei pendente, expirado ou cancelado (ex.: estorno);
 * - ausente_no_arquivo: pago no sistema e ausente no arquivo (arquivo parcial ou compra de teste);
 * - valor_diferente, quantidade_diferente e afiliado_diferente: pago nos dois lados, com o valor, a
 *   quantidade de bilhetes ou o afiliado diferentes (um pedido pode estar em mais de um desses).
 */
export const TIPOS_DIVERGENCIA = [
  "venda_perdida",
  "pagamento_nao_registrado",
  "nao_pago_na_rifei",
  "ausente_no_arquivo",
  "valor_diferente",
  "quantidade_diferente",
  "afiliado_diferente",
] as const;
export type TipoDivergencia = (typeof TIPOS_DIVERGENCIA)[number];

/**
 * Observações de um item: na venda perdida, o que impede a recuperação (sem quantidade, sem valor ou
 * data depois de agora); na ausente no arquivo, o pedido é de um dia que o arquivo não cobre.
 */
export const OBSERVACOES_DIVERGENCIA = [
  "sem_quantidade",
  "sem_valor",
  "data_no_futuro",
  "fora_do_periodo_do_arquivo",
] as const;

export const divergenciaSchema = z.strictObject({
  pedido_id: z.string().min(1).max(128),
  /** null em ausente_no_arquivo. */
  arquivo: pedidoNoArquivoSchema.nullable(),
  /** null em venda_perdida. */
  sistema: pedidoNoSistemaSchema.nullable(),
  /** Só em venda_perdida, e só sem observação: o arquivo tem o que a gravação precisa. */
  recuperavel: z.boolean(),
  observacoes: z.array(z.enum(OBSERVACOES_DIVERGENCIA)),
});
export type Divergencia = z.infer<typeof divergenciaSchema>;

/** Soma de um lado (só os valores legíveis). */
const somaLadoSchema = z.strictObject({
  bilhetes: z.number().int().nonnegative(),
  total_centavos: centavosSchema,
});

export const grupoDivergenciaSchema = z.strictObject({
  tipo: z.enum(TIPOS_DIVERGENCIA),
  /** Pedidos deste tipo (todos, mesmo os que passam do limite da lista). */
  quantidade: z.number().int().nonnegative(),
  arquivo: somaLadoSchema,
  sistema: somaLadoSchema,
  /** Os primeiros LIMITE_ITENS_POR_DIVERGENCIA, em ordem de código. */
  itens: z.array(divergenciaSchema).max(LIMITE_ITENS_POR_DIVERGENCIA),
  itens_omitidos: z.number().int().nonnegative(),
});
export type GrupoDivergencia = z.infer<typeof grupoDivergenciaSchema>;

/** Avisos da leitura do arquivo (mensagens sem nenhum valor do arquivo: só números e nomes de coluna). */
export const CODIGOS_AVISO_RECONCILIACAO = [
  "sem_coluna_pedido",
  "sem_coluna_status",
  "sem_coluna_quantidade",
  "sem_coluna_valor",
  "sem_coluna_afiliado",
  "sem_coluna_data",
  "colunas_pessoais_ignoradas",
  "colunas_demais",
  "sem_id",
  "id_invalido",
  "status_desconhecido",
  "quantidade_invalida",
  "quantidade_diferente_dos_numeros",
  "valor_invalido",
  "data_invalida",
  "afiliado_nao_reconhecido",
  "formula_ignorada",
  "pedido_inconsistente",
  "um_bilhete_por_linha",
  "um_bilhete_por_linha_sem_id",
  "pedido_de_outra_campanha",
  "sem_aprovados",
] as const;
export type CodigoAvisoReconciliacao =
  (typeof CODIGOS_AVISO_RECONCILIACAO)[number];

export const avisoReconciliacaoSchema = z.strictObject({
  codigo: z.enum(CODIGOS_AVISO_RECONCILIACAO),
  mensagem: z.string().min(1),
  /** Quantas linhas, pedidos ou colunas o aviso cobre; null quando vale para o arquivo inteiro. */
  quantidade: z.number().int().positive().nullable(),
});
export type AvisoReconciliacao = z.infer<typeof avisoReconciliacaoSchema>;

/** O que foi lido do arquivo. */
export const arquivoLidoSchema = z.strictObject({
  /** Linhas de dados (sem o cabeçalho e as linhas em branco). */
  linhas: z.number().int().nonnegative(),
  /** Linhas deixadas de fora: sem código ou com código inválido (modo por pedido). */
  linhas_ignoradas: z.number().int().nonnegative(),
  /** O mesmo pedido em várias linhas, ou uma linha por bilhete (opção "Um bilhete por linha"). */
  um_bilhete_por_linha: z.boolean(),
  /** Dias (no fuso da campanha) que a coluna da data cobre; null sem datas legíveis. */
  data_inicio: dataLocalSchema.nullable(),
  data_fim: dataLocalSchema.nullable(),
});

/** Totais pagos de um lado no arquivo: null quando o arquivo não permite contar (sem a coluna). */
export const totaisArquivoSchema = z.strictObject({
  pedidos_aprovados: z.number().int().nonnegative().nullable(),
  bilhetes: z.number().int().nonnegative().nullable(),
  total_centavos: centavosSchema.nullable(),
});
export type TotaisArquivo = z.infer<typeof totaisArquivoSchema>;

const comumAnaliseReconciliacao = {
  colunas: z.array(colunaArquivoReconciliacaoSchema),
  /** O mapeamento usado (o enviado ou o detectado). */
  mapeamento: mapeamentoReconciliacaoSchema,
  /** true: o corpo não trouxe mapeamento e o sistema detectou pelo cabeçalho. */
  mapeamento_detectado: z.boolean(),
  arquivo: arquivoLidoSchema,
  avisos: z.array(avisoReconciliacaoSchema),
  conferido_em: instanteSchema,
};

/** Modo por pedido: a coluna do código do pedido está no mapeamento. */
export const respostaAnalisePorPedidoSchema = z.strictObject({
  modo: z.literal("por_pedido"),
  ...comumAnaliseReconciliacao,
  resumo: z.strictObject({
    /** Códigos distintos e válidos no arquivo. */
    pedidos_no_arquivo: z.number().int().nonnegative(),
    aprovados_no_arquivo: totaisArquivoSchema,
    /** Todos os pagos da campanha ativa no sistema. */
    aprovados_no_sistema: totaisVendasSchema,
    /** Pagos nos dois lados, sem nenhuma diferença. */
    conferem: z.number().int().nonnegative(),
    /** Pedidos com alguma divergência (cada um conta uma vez). */
    com_divergencia: z.number().int().nonnegative(),
  }),
  /** Os sete tipos, sempre nesta ordem (TIPOS_DIVERGENCIA), mesmo os sem pedido. */
  divergencias: z.array(grupoDivergenciaSchema),
});
export type RespostaAnalisePorPedido = z.infer<
  typeof respostaAnalisePorPedidoSchema
>;

/** Uma linha da comparação por totais: o que o arquivo não permite contar fica null e não é comparado. */
const comparacaoTotaisSchema = {
  arquivo: totaisArquivoSchema,
  sistema: totaisVendasSchema,
  /** Os totais que o arquivo permite contar são iguais aos do sistema. */
  confere: z.boolean(),
};

export const AFILIADOS_AGREGADO = [
  "afiliado",
  "sem_afiliado",
  "nao_reconhecido",
] as const;

/** Modo agregado: sem a coluna do código, compara os totais pagos (por afiliado e por dia). */
export const respostaAnaliseAgregadaSchema = z.strictObject({
  modo: z.literal("agregado"),
  ...comumAnaliseReconciliacao,
  /** Com datas no arquivo, o sistema conta só os pagos desses dias; null = tudo. */
  recorte: z
    .strictObject({ data_inicio: dataLocalSchema, data_fim: dataLocalSchema })
    .nullable(),
  total: z.strictObject(comparacaoTotaisSchema),
  /** Diferentes primeiro; null sem a coluna do afiliado. */
  por_afiliado: z
    .array(
      z.strictObject({
        afiliado: z.enum(AFILIADOS_AGREGADO),
        affiliate_id: affiliateIdSchema.nullable(),
        celula: celulaReconciliacaoSchema,
        ...comparacaoTotaisSchema,
      }),
    )
    .nullable(),
  /** Em ordem de data; null sem a coluna da data. */
  por_dia: z
    .array(z.strictObject({ data: dataLocalSchema, ...comparacaoTotaisSchema }))
    .nullable(),
});
export type RespostaAnaliseAgregada = z.infer<
  typeof respostaAnaliseAgregadaSchema
>;

export const respostaAnaliseReconciliacaoSchema = z.discriminatedUnion("modo", [
  respostaAnalisePorPedidoSchema,
  respostaAnaliseAgregadaSchema,
]);
export type RespostaAnaliseReconciliacao = z.infer<
  typeof respostaAnaliseReconciliacaoSchema
>;

/**
 * "Recuperar": grava como aprovados (origem `conferencia`) os pedidos escolhidos, com os dados do
 * arquivo. Só vendas perdidas: pedido que já existe nunca é sobrescrito. `simular: true` é a
 * pré-visualização (nada é gravado). Atômico (um lote só) e idempotente: repetir não duplica.
 */
export const corpoRecuperarReconciliacaoSchema = z.object({
  csv: csvReconciliacaoSchema,
  /** O mapeamento conferido na análise; precisa da coluna do código do pedido. */
  mapeamento: mapeamentoReconciliacaoSchema.refine(
    (mapeamento) => mapeamento.pedido_id !== null,
    {
      message: "Para recuperar, o arquivo precisa da coluna do código do pedido",
      path: ["pedido_id"],
    },
  ),
  pedidos: z
    .array(idPedidoReconciliacaoSchema)
    .min(1)
    .max(LIMITE_PEDIDOS_RECUPERAR),
  simular: z.boolean().default(false),
});

/** De onde veio o instante gravado em `aprovado_em`. */
export const ORIGENS_DATA_RECUPERADA = [
  /** data e hora do arquivo */
  "arquivo",
  /** só o dia no arquivo: meio-dia (ou agora, se for hoje) */
  "dia_do_arquivo",
  /** sem data no arquivo: o instante da recuperação */
  "recuperacao",
] as const;

export const MOTIVOS_NAO_RECUPERADO = [
  "ja_existe",
  "nao_esta_no_arquivo",
  "nao_aprovado_no_arquivo",
  "inconsistente_no_arquivo",
  "sem_quantidade",
  "sem_valor",
  "data_no_futuro",
] as const;

export const pedidoRecuperadoSchema = z.strictObject({
  pedido_id: z.string().min(1).max(128),
  qtd_bilhetes: z.number().int().positive(),
  total_centavos: centavosSchema,
  /** `nao_reconhecido` grava sem afiliado (a venda entra em "sem afiliado"). */
  afiliado: z.enum(SITUACOES_AFILIADO_ARQUIVO),
  affiliate_id: affiliateIdSchema.nullable(),
  celula: celulaReconciliacaoSchema,
  aprovado_em: instanteSchema,
  origem_data: z.enum(ORIGENS_DATA_RECUPERADA),
});
export type PedidoRecuperado = z.infer<typeof pedidoRecuperadoSchema>;

export const respostaRecuperarReconciliacaoSchema = z.strictObject({
  simulado: z.boolean(),
  /** true quando gravou pelo menos um pedido. */
  aplicado: z.boolean(),
  /** A linha da auditoria (GET .../recuperacoes); null na simulação ou se nada foi gravado. */
  recuperacao_id: idSchema.nullable(),
  /** Gravados (ou, na simulação, os que seriam gravados), na ordem pedida. */
  recuperados: z.array(pedidoRecuperadoSchema),
  nao_recuperados: z.array(
    z.strictObject({
      pedido_id: z.string().min(1).max(128),
      motivo: z.enum(MOTIVOS_NAO_RECUPERADO),
    }),
  ),
  /** Soma dos recuperados. */
  totais: totaisVendasSchema,
  avisos: z.array(avisoReconciliacaoSchema),
});
export type RespostaRecuperarReconciliacao = z.infer<
  typeof respostaRecuperarReconciliacaoSchema
>;

/** Uma recuperação feita (auditoria): quem, quando, quantos e de qual arquivo. */
export const recuperacaoSchema = z.strictObject({
  id: idSchema,
  executado_em: instanteSchema,
  usuario: z.strictObject({ id: idSchema, nome: z.string().min(1).max(120) }),
  pedidos_solicitados: z.number().int().positive(),
  pedidos_recuperados: z.number().int().positive(),
  bilhetes: z.number().int().nonnegative(),
  total_centavos: centavosSchema,
  linhas_arquivo: z.number().int().nonnegative(),
  /** SHA-256 do texto do arquivo: identifica o arquivo sem guardar o conteúdo. */
  arquivo_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Nome da coluna do arquivo usada em cada campo (null = sem a coluna). */
  colunas: z.strictObject({
    pedido_id: z.string().min(1).nullable(),
    status: z.string().min(1).nullable(),
    qtd_bilhetes: z.string().min(1).nullable(),
    bilhetes: z.string().min(1).nullable(),
    valor: z.string().min(1).nullable(),
    afiliado: z.string().min(1).nullable(),
    data: z.string().min(1).nullable(),
  }),
  /** Códigos dos pedidos gravados, em ordem. */
  pedidos: z.array(z.string().min(1).max(128)),
});
export type Recuperacao = z.infer<typeof recuperacaoSchema>;

/** A mais recente primeiro. */
export const respostaListaRecuperacoesSchema = lista(recuperacaoSchema);

// ---------------------------------------------------------------------------------------------------
// Catálogo de rotas
// ---------------------------------------------------------------------------------------------------

export type MetodoHttp = "GET" | "POST" | "PUT" | "DELETE";

export interface DefinicaoRota {
  readonly metodo: MetodoHttp;
  /** Caminho no formato do Hono (`:param`). */
  readonly caminho: `/api/${string}`;
  readonly grupo: GrupoAutorizacao;
  readonly situacao: SituacaoRota;
  readonly parametros?: z.ZodType;
  readonly consulta?: z.ZodType;
  readonly corpo?: z.ZodType;
  /** Status de sucesso e schema do corpo da resposta (null = sem corpo). */
  readonly sucesso: {
    readonly status: 200 | 201 | 204;
    readonly corpo: z.ZodType | null;
  };
}

export const ROTAS = {
  health: {
    metodo: "GET",
    caminho: "/api/health",
    grupo: "aberto",
    situacao: "detalhada",
    sucesso: { status: 200, corpo: respostaHealthSchema },
  },
  webhookRifei: {
    metodo: "POST",
    caminho: "/api/webhooks/rifei",
    grupo: "rifei_bearer",
    situacao: "detalhada",
    corpo: payloadRifeiSchema,
    sucesso: { status: 200, corpo: respostaWebhookRifeiSchema },
  },
  obterCampanha: {
    metodo: "GET",
    caminho: "/api/admin/campanha",
    grupo: "coordenacao",
    situacao: "detalhada",
    sucesso: { status: 200, corpo: respostaCampanhaSchema },
  },
  salvarCampanha: {
    metodo: "PUT",
    caminho: "/api/admin/campanha",
    grupo: "coordenacao",
    situacao: "detalhada",
    corpo: corpoSalvarCampanhaSchema,
    sucesso: { status: 200, corpo: respostaCampanhaSchema },
  },
  listarRedes: {
    metodo: "GET",
    caminho: "/api/admin/redes",
    grupo: "coordenacao",
    situacao: "detalhada",
    sucesso: { status: 200, corpo: respostaListaRedesSchema },
  },
  obterRede: {
    metodo: "GET",
    caminho: "/api/admin/redes/:id",
    grupo: "coordenacao",
    situacao: "detalhada",
    parametros: parametroIdSchema,
    sucesso: { status: 200, corpo: redeSchema },
  },
  criarRede: {
    metodo: "POST",
    caminho: "/api/admin/redes",
    grupo: "coordenacao",
    situacao: "detalhada",
    corpo: redeEntradaSchema,
    sucesso: { status: 201, corpo: redeSchema },
  },
  atualizarRede: {
    metodo: "PUT",
    caminho: "/api/admin/redes/:id",
    grupo: "coordenacao",
    situacao: "detalhada",
    parametros: parametroIdSchema,
    corpo: redeEntradaSchema,
    sucesso: { status: 200, corpo: redeSchema },
  },
  removerRede: {
    metodo: "DELETE",
    caminho: "/api/admin/redes/:id",
    grupo: "coordenacao",
    situacao: "detalhada",
    parametros: parametroIdSchema,
    sucesso: { status: 204, corpo: null },
  },
  listarDiscipuladores: {
    metodo: "GET",
    caminho: "/api/admin/discipuladores",
    grupo: "coordenacao",
    situacao: "detalhada",
    consulta: consultaDiscipuladoresSchema,
    sucesso: { status: 200, corpo: respostaListaDiscipuladoresSchema },
  },
  obterDiscipulador: {
    metodo: "GET",
    caminho: "/api/admin/discipuladores/:id",
    grupo: "coordenacao",
    situacao: "detalhada",
    parametros: parametroIdSchema,
    sucesso: { status: 200, corpo: discipuladorSchema },
  },
  criarDiscipulador: {
    metodo: "POST",
    caminho: "/api/admin/discipuladores",
    grupo: "coordenacao",
    situacao: "detalhada",
    corpo: discipuladorEntradaSchema,
    sucesso: { status: 201, corpo: discipuladorSchema },
  },
  atualizarDiscipulador: {
    metodo: "PUT",
    caminho: "/api/admin/discipuladores/:id",
    grupo: "coordenacao",
    situacao: "detalhada",
    parametros: parametroIdSchema,
    corpo: discipuladorEntradaSchema,
    sucesso: { status: 200, corpo: discipuladorSchema },
  },
  removerDiscipulador: {
    metodo: "DELETE",
    caminho: "/api/admin/discipuladores/:id",
    grupo: "coordenacao",
    situacao: "detalhada",
    parametros: parametroIdSchema,
    sucesso: { status: 204, corpo: null },
  },
  listarCelulas: {
    metodo: "GET",
    caminho: "/api/admin/celulas",
    grupo: "coordenacao",
    situacao: "detalhada",
    consulta: consultaCelulasSchema,
    sucesso: { status: 200, corpo: respostaListaCelulasSchema },
  },
  obterCelula: {
    metodo: "GET",
    caminho: "/api/admin/celulas/:id",
    grupo: "coordenacao",
    situacao: "detalhada",
    parametros: parametroIdSchema,
    sucesso: { status: 200, corpo: celulaSchema },
  },
  criarCelula: {
    metodo: "POST",
    caminho: "/api/admin/celulas",
    grupo: "coordenacao",
    situacao: "detalhada",
    corpo: celulaEntradaSchema,
    sucesso: { status: 201, corpo: celulaSchema },
  },
  atualizarCelula: {
    metodo: "PUT",
    caminho: "/api/admin/celulas/:id",
    grupo: "coordenacao",
    situacao: "detalhada",
    parametros: parametroIdSchema,
    corpo: celulaEntradaSchema,
    sucesso: { status: 200, corpo: celulaSchema },
  },
  removerCelula: {
    metodo: "DELETE",
    caminho: "/api/admin/celulas/:id",
    grupo: "coordenacao",
    situacao: "detalhada",
    parametros: parametroIdSchema,
    sucesso: { status: 204, corpo: null },
  },
  importarHierarquia: {
    metodo: "POST",
    caminho: "/api/admin/hierarquia/importar",
    grupo: "coordenacao",
    situacao: "detalhada",
    corpo: corpoImportarHierarquiaSchema,
    sucesso: { status: 200, corpo: respostaImportarHierarquiaSchema },
  },
  listarAfiliados: {
    metodo: "GET",
    caminho: "/api/admin/afiliados",
    grupo: "coordenacao",
    situacao: "detalhada",
    consulta: consultaAfiliadosSchema,
    sucesso: { status: 200, corpo: respostaListaAfiliadosSchema },
  },
  salvarAfiliado: {
    metodo: "PUT",
    caminho: "/api/admin/afiliados/:affiliateId",
    grupo: "coordenacao",
    situacao: "detalhada",
    parametros: parametroAffiliateIdSchema,
    corpo: corpoSalvarAfiliadoSchema,
    sucesso: { status: 200, corpo: afiliadoResumoSchema },
  },
  adesao: {
    metodo: "GET",
    caminho: "/api/admin/adesao",
    grupo: "coordenacao",
    situacao: "detalhada",
    sucesso: { status: 200, corpo: respostaAdesaoSchema },
  },
  painelResumo: {
    metodo: "GET",
    caminho: "/api/painel/resumo",
    grupo: "coordenacao",
    situacao: "detalhada",
    consulta: consultaPainelResumoSchema,
    sucesso: { status: 200, corpo: respostaPainelResumoSchema },
  },
  painelRanking: {
    metodo: "GET",
    caminho: "/api/painel/ranking",
    grupo: "coordenacao",
    situacao: "detalhada",
    consulta: consultaRankingSchema,
    sucesso: { status: 200, corpo: respostaRankingSchema },
  },
  rankingPublico: {
    metodo: "GET",
    caminho: "/api/publico/ranking",
    grupo: "aberto",
    situacao: "detalhada",
    consulta: consultaRankingPublicoSchema,
    sucesso: { status: 200, corpo: respostaRankingPublicoSchema },
  },
  bumbo: {
    metodo: "GET",
    caminho: "/api/publico/bumbo",
    grupo: "aberto",
    situacao: "detalhada",
    consulta: consultaBumboSchema,
    sucesso: { status: 200, corpo: respostaBumboSchema },
  },
  analisarReconciliacao: {
    metodo: "POST",
    caminho: "/api/admin/reconciliacao/analisar",
    grupo: "coordenacao",
    situacao: "detalhada",
    corpo: corpoAnalisarReconciliacaoSchema,
    sucesso: { status: 200, corpo: respostaAnaliseReconciliacaoSchema },
  },
  recuperarReconciliacao: {
    metodo: "POST",
    caminho: "/api/admin/reconciliacao/recuperar",
    grupo: "coordenacao",
    situacao: "detalhada",
    corpo: corpoRecuperarReconciliacaoSchema,
    sucesso: { status: 200, corpo: respostaRecuperarReconciliacaoSchema },
  },
  listarRecuperacoes: {
    metodo: "GET",
    caminho: "/api/admin/reconciliacao/recuperacoes",
    grupo: "coordenacao",
    situacao: "detalhada",
    sucesso: { status: 200, corpo: respostaListaRecuperacoesSchema },
  },
} as const satisfies Record<string, DefinicaoRota>;

export type NomeRota = keyof typeof ROTAS;
