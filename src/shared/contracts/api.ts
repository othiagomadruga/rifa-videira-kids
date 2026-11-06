/**
 * Contrato HTTP da API v1: schemas de parâmetros, consulta, corpo e resposta de cada rota, e o catálogo
 * `ROTAS`. Documentação: docs/api.md.
 *
 * - Rotas "detalhadas" (Sprints 1–3) estão fechadas. Rotas "rascunho" (Sprint 4) podem mudar quando
 *   forem implementadas; só o SM altera o contrato.
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
// RASCUNHO: POST /api/admin/reconciliacao (CSV "Exportar Pedidos" da Rifei → divergências)
// O CSV traz dados pessoais: é lido só em memória e nada dele é gravado nem devolvido além do abaixo.
// ---------------------------------------------------------------------------------------------------

export const corpoReconciliacaoSchema = z.object({
  csv: z.string().min(1).max(10_000_000),
});

export const TIPOS_DIVERGENCIA = [
  "ausente_no_sistema",
  "ausente_no_csv",
  "status_divergente",
  "valor_divergente",
  "afiliado_divergente",
] as const;

const ladoReconciliacaoSchema = z.object({
  status: z.string().nullable(),
  total_centavos: centavosSchema.nullable(),
  qtd_bilhetes: z.number().int().nonnegative().nullable(),
  affiliate_id: affiliateIdSchema.nullable(),
});

export const divergenciaSchema = z.object({
  tipo: z.enum(TIPOS_DIVERGENCIA),
  pedido_id: z.string().min(1),
  sistema: ladoReconciliacaoSchema.nullable(),
  csv: ladoReconciliacaoSchema.nullable(),
});

export const respostaReconciliacaoSchema = z.object({
  linhas_lidas: z.number().int().nonnegative(),
  pedidos_no_csv: z.number().int().nonnegative(),
  pedidos_no_sistema: z.number().int().nonnegative(),
  divergencias: z.array(divergenciaSchema),
});

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
  reconciliacao: {
    metodo: "POST",
    caminho: "/api/admin/reconciliacao",
    grupo: "coordenacao",
    situacao: "rascunho",
    corpo: corpoReconciliacaoSchema,
    sucesso: { status: 200, corpo: respostaReconciliacaoSchema },
  },
} as const satisfies Record<string, DefinicaoRota>;

export type NomeRota = keyof typeof ROTAS;
