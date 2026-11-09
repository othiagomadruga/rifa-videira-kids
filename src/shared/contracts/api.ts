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
  alvoSchema,
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
import {
  AFILIADOS_AGREGADO,
  CODIGOS_AVISO_RECONCILIACAO,
  FORMATO_ID_PEDIDO_RECONCILIACAO,
  LIMITE_ITENS_POR_DIVERGENCIA,
  MOTIVOS_NAO_RECUPERADO,
  OBSERVACOES_DIVERGENCIA,
  ORIGENS_DATA_RECUPERADA,
  ORIGENS_PEDIDO,
  SITUACOES_AFILIADO_ARQUIVO,
  STATUS_ARQUIVO_RECONCILIACAO,
  TIPOS_DIVERGENCIA,
  validarCorpoConferencia,
  validarCorpoRecuperacao,
  type CorpoConferencia,
  type CorpoRecuperacao,
} from "./conferencia";
import { detalheResumidoSchema } from "./erros";
import { payloadRifeiSchema } from "./rifei";
// Só o tipo (apagado na compilação): acesso.ts importa valores daqui, e este import não cria ciclo.
import type { Papel } from "./acesso";

// ---------------------------------------------------------------------------------------------------
// Autorização e utilitários
// ---------------------------------------------------------------------------------------------------

/**
 * - aberto: sem autenticação (/api/health e /api/publico/*; o público nunca recebe valores financeiros);
 * - rifei_bearer: `Authorization: Bearer <RIFEI_WEBHOOK_TOKEN>` (/api/webhooks/*);
 * - coordenacao: equipe da campanha (/api/admin/* e /api/painel/*), com a sessão do link pessoal (RIFA-007);
 * - hierarquia: líder, discipulador e rede (/api/minha/*), com a mesma sessão (RIFA-014, D12). O alvo vem só
 *   da sessão: nenhuma rota deste grupo aceita id de célula, discipulador ou rede na URL, na consulta ou no corpo.
 */
export const GRUPOS_AUTORIZACAO = [
  "aberto",
  "rifei_bearer",
  "coordenacao",
  "hierarquia",
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
 * `detalhes` do erro 400 `csv_invalido` (importação da hierarquia; a conferência lê o CSV no navegador): o
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
// GET /api/admin/pedidos/suspeitos (RIFA-013b): pedidos aprovados que o webhook marcou como implausíveis.
// A marcação NÃO tira o pedido das vendas: ele continua contando até a coordenação decidir (PO).
// ---------------------------------------------------------------------------------------------------

/** Teto de bilhetes num pedido só: acima dele, o pedido aprovado é marcado para revisão. */
export const TETO_BILHETES_POR_PEDIDO = 200;

/**
 * Desconto aceito (cupom, promoção) sobre bilhetes × preço do bilhete da campanha, em pontos-base: com
 * 5000, um total abaixo da metade do esperado marca o pedido. O exemplo oficial da Rifei tem 50% de
 * promoção, que fica dentro.
 */
export const TOLERANCIA_DESCONTO_BP = 5000;

/** Máximo de itens na resposta (os mais recentes); `total` diz quantos existem. */
export const LIMITE_PEDIDOS_SUSPEITOS = 500;

/**
 * Por que o pedido foi marcado. O mesmo item vai para `webhook_eventos.avisos` do evento que aprovou o
 * pedido (formato `DetalheResumido`, sem o valor recebido):
 * - quantidade_acima_do_teto (`numbers_count`): mais de TETO_BILHETES_POR_PEDIDO bilhetes;
 * - total_acima_do_esperado (`total`): total maior que bilhetes × preço do bilhete da campanha;
 * - total_abaixo_do_esperado (`total`): total abaixo de bilhetes × preço, além de TOLERANCIA_DESCONTO_BP.
 */
export const MOTIVOS_PEDIDO_SUSPEITO = [
  "quantidade_acima_do_teto",
  "total_acima_do_esperado",
  "total_abaixo_do_esperado",
] as const;
export type MotivoPedidoSuspeito = (typeof MOTIVOS_PEDIDO_SUSPEITO)[number];

export const motivoPedidoSuspeitoSchema = detalheResumidoSchema.extend({
  codigo: z.enum(MOTIVOS_PEDIDO_SUSPEITO),
});

/** Um pedido marcado. Sem nenhum dado do comprador (D1): só o pedido, os valores e o afiliado. */
export const pedidoSuspeitoSchema = z.object({
  pedido_id: z.string().min(1).max(128),
  affiliate_id: affiliateIdSchema.nullable(),
  /** Célula do afiliado agora (o pedido conta para ela); null = sem afiliado ou não vinculado. */
  celula_id: idSchema.nullable(),
  celula_nome: z.string().min(1).max(120).nullable(),
  qtd_bilhetes: z.number().int().nonnegative(),
  total_centavos: centavosSchema,
  /** qtd_bilhetes × preço do bilhete da campanha quando o pedido foi marcado. */
  esperado_centavos: centavosSchema,
  motivos: z.array(motivoPedidoSuspeitoSchema).min(1),
  aprovado_em: instanteSchema.nullable(),
  marcado_em: instanteSchema,
});
export type PedidoSuspeito = z.infer<typeof pedidoSuspeitoSchema>;

export const respostaPedidosSuspeitosSchema = z.object({
  /** Da campanha ativa, o mais recente primeiro; no máximo LIMITE_PEDIDOS_SUSPEITOS. */
  itens: z.array(pedidoSuspeitoSchema).max(LIMITE_PEDIDOS_SUSPEITOS),
  /** Quantos pedidos da campanha ativa estão marcados (pode passar do tamanho de `itens`). */
  total: z.number().int().nonnegative(),
});
export type RespostaPedidosSuspeitos = z.infer<
  typeof respostaPedidosSuspeitosSchema
>;

// ---------------------------------------------------------------------------------------------------
// GET /api/admin/auditoria (RIFA-013b, só admin): quem mudou o quê na campanha, nos vínculos, na
// hierarquia (importação) e nos acessos. Paginação por cursor: do mais novo para o mais antigo.
// ---------------------------------------------------------------------------------------------------

/**
 * Ações registradas (a lista cresce sem mudar o formato):
 * - campanha.salvar: PUT /api/admin/campanha (criação ou troca da configuração, inclusive do slug);
 * - afiliado.salvar: PUT /api/admin/afiliados/:affiliateId (vínculo, troca ou desvínculo de célula);
 * - hierarquia.importar: POST /api/admin/hierarquia/importar quando aplica (não na simulação);
 * - usuario.criar, usuario.ativar, usuario.desativar, link.criar e link.revogar: administração dos acessos;
 * - acessos_hierarquia.gerar_links: POST /api/admin/acessos-hierarquia/links (RIFA-014, D12), uma linha por
 *   lote, alvo `papel:<papel>`, resumo sem nomes (quantos alvos, quantos usuários criados e se revogou os
 *   anteriores; os ids só se couberem no resumo);
 * - conferencia.recuperar: POST /api/admin/reconciliacao/recuperar quando grava algum pedido (RIFA-012, D13;
 *   não na prévia nem quando nada entrou), alvo `campanha:<id>`, resumo sem dados pessoais (o id da
 *   recuperação, quantos pedidos e bilhetes entraram; os códigos estão em GET .../recuperacoes).
 */
export const ACOES_AUDITORIA = [
  "campanha.salvar",
  "afiliado.salvar",
  "hierarquia.importar",
  "usuario.criar",
  "usuario.ativar",
  "usuario.desativar",
  "link.criar",
  "link.revogar",
  "acessos_hierarquia.gerar_links",
  "conferencia.recuperar",
] as const;
export type AcaoAuditoria = (typeof ACOES_AUDITORIA)[number];

/** Itens por página: padrão e máximo. */
export const PAGINA_AUDITORIA_PADRAO = 50;
export const PAGINA_AUDITORIA_MAXIMA = 200;

export const consultaAuditoriaSchema = z.object({
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINA_AUDITORIA_MAXIMA)
    .default(PAGINA_AUDITORIA_PADRAO),
  /** Cursor: só registros com id menor que este (o `proximo` da página anterior). */
  antes_de: z.coerce.number().int().positive().optional(),
});
export type ConsultaAuditoria = z.output<typeof consultaAuditoriaSchema>;

export const registroAuditoriaSchema = z.object({
  id: idSchema,
  em: instanteSchema,
  /** Quem fez: o usuário da sessão. */
  usuario_id: idSchema,
  usuario_nome: z.string().min(1).max(120),
  acao: z.enum(ACOES_AUDITORIA),
  /** `<tipo>:<id>` ou só `<tipo>`: "campanha:1", "afiliado:1042", "hierarquia", "usuario:3", "link:12". */
  alvo: z.string().min(1).max(64),
  /** O que mudou, sem dados pessoais: nunca nome, e-mail ou telefone de ninguém (só ids e configuração). */
  resumo: z.string().min(1).max(1000),
});
export type RegistroAuditoria = z.infer<typeof registroAuditoriaSchema>;

export const respostaAuditoriaSchema = z.object({
  itens: z.array(registroAuditoriaSchema),
  /** Para a página seguinte, passe em `antes_de`; null = não há mais. */
  proximo: idSchema.nullable(),
});
export type RespostaAuditoria = z.infer<typeof respostaAuditoriaSchema>;

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

/**
 * Janela do `data` do bumbo: do 1º dia da campanha até este número de dias depois do último. No dia
 * seguinte ao fim, a mensagem ainda traz a venda do último dia; dali em diante, o texto não muda mais.
 */
export const DIAS_DO_BUMBO_DEPOIS_DO_FIM = 1;

export const consultaBumboSchema = z.object({
  /**
   * Dia da mensagem (local); a mensagem fala do dia anterior. Sem `data`, é hoje, em qualquer fase
   * (antes do início, a contagem regressiva; depois do fim, o resultado final). Com `data`, só na janela
   * da campanha (do 1º dia ao dia seguinte ao último: DIAS_DO_BUMBO_DEPOIS_DO_FIM) e no máximo hoje;
   * fora dela, 400 `requisicao_invalida` com o detalhe `fora_da_campanha` (depois de hoje, `data_futura`).
   * A rota confere a janela com a campanha ativa antes de ler as vendas: datas arbitrárias não viram
   * chaves do cache das rotas abertas.
   */
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
// GET /api/minha/visao (líder, discipulador e rede: a visão individual, RIFA-014, RF08, D12)
//
// - O alvo vem SÓ da sessão (usuarios.celula_id, discipulador_id ou rede_id): a rota não aceita id.
// - NENHUM valor financeiro sai daqui, com qualquer configuração da campanha: nada de centavos, R$ ou
//   arrecadação. Com meta em centavos, as quantidades na unidade da meta saem null e ficam só os percentuais;
//   o schema recusa quantidade preenchida nesse caso.
// - Números (meta, realizado, falta, bilhetes) só do próprio alvo e da equipe dele (quem está abaixo dele na
//   hierarquia). Dos pares (o mesmo nível), só nome e posição.
// - Percentuais sobre a meta EXATA (a fração, sem arredondar) e truncados, com a mesma conta de
//   percentual_meta_bp e percentual_esperado_bp do painel.
// - Sem cache compartilhado da resposta (é por pessoa). Os dados de base podem vir de um cache de até 30 s por
//   isolate, como as rotas abertas (D10).
// ---------------------------------------------------------------------------------------------------

export const consultaVisaoIndividualSchema = z.object({
  /** Janela do ranking: o período atual (padrão; o "ranking da semana") ou a campanha inteira. */
  periodo: z.enum(JANELAS_RANKING).default("atual"),
});
export type ConsultaVisaoIndividual = z.output<
  typeof consultaVisaoIndividualSchema
>;

/** Ritmo numa janela, sem dinheiro. Quantidades na unidade da meta só quando ela é `bilhetes` (senão null). */
export const ritmoIndividualSchema = z.strictObject({
  meta: quantidadeSchema.nullable(),
  /** Esperado pela curva até o fim de ontem, dentro da janela. */
  esperado: quantidadeSchema.nullable(),
  /** Vendido na janela até agora (inclui hoje). */
  realizado: quantidadeSchema.nullable(),
  /** realizado − esperado (negativo = abaixo da curva). */
  diferenca: z.number().int().nullable(),
  situacao: z.enum(SITUACOES_RITMO),
  /** realizado ÷ meta; null sem meta. */
  percentual_meta_bp: percentualBpSchema.nullable(),
  /** Onde a curva manda estar: esperado ÷ meta; null sem meta. */
  percentual_esperado_bp: percentualBpSchema.max(10_000).nullable(),
});
export type RitmoIndividual = z.infer<typeof ritmoIndividualSchema>;

/** Meta do dia, sem dinheiro (mesma regra R3 do painel). Quantidades só com meta em bilhetes. */
export const metaDoDiaIndividualSchema = z.strictObject({
  data: dataLocalSchema,
  /** Esperado até o fim de hoje − realizado até ontem, nunca negativa: o que faltou entra aqui. */
  meta: quantidadeSchema.nullable(),
  realizado: quantidadeSchema.nullable(),
  /** max(0, meta − realizado). */
  falta: quantidadeSchema.nullable(),
  /** realizado ÷ meta; null quando a meta do dia é zero. */
  percentual_meta_bp: percentualBpSchema.nullable(),
  batida: z.boolean(),
});
export type MetaDoDiaIndividual = z.infer<typeof metaDoDiaIndividualSchema>;

/** Bilhetes vendidos (pedidos aprovados que contam): quantidade, nunca dinheiro. Sai com qualquer unidade de meta. */
export const bilhetesIndividualSchema = z.strictObject({
  /** Na janela da campanha, até agora. */
  campanha: quantidadeSchema,
  /** Hoje (data local da campanha); null fora da campanha, junto com `hoje` do desempenho. */
  hoje: quantidadeSchema.nullable(),
});

/** Números de um alvo (o próprio ou um da equipe dele). */
export const desempenhoIndividualSchema = z.strictObject({
  /** Só durante a campanha. */
  hoje: metaDoDiaIndividualSchema.nullable(),
  /** Período atual; só durante a campanha. */
  periodo: ritmoIndividualSchema.nullable(),
  campanha: ritmoIndividualSchema.extend({
    /** Projeção do fim no ritmo dos dias fechados, em % da meta. Null antes do início e no 1º dia. */
    projecao_percentual_meta_bp: percentualBpSchema.nullable(),
  }),
  bilhetes: bilhetesIndividualSchema,
});
export type DesempenhoIndividual = z.infer<typeof desempenhoIndividualSchema>;

/**
 * Um dia do gráfico, em pontos-base da meta exata da campanha do alvo (serve para meta em bilhetes ou em
 * centavos). Um ponto por dia da campanha; a lista sai vazia quando o alvo não tem meta (não há percentual).
 */
export const pontoCurvaIndividualSchema = z.strictObject({
  dia: z.number().int().min(1),
  data: dataLocalSchema,
  /** Esperado acumulado até o fim do dia ÷ meta da campanha. */
  esperado_bp: percentualBpSchema.max(10_000),
  /**
   * Realizado acumulado até o fim do dia ÷ meta da campanha (sem teto: passa de 10000 acima da meta). Hoje: até
   * agora, igual a `desempenho.campanha.percentual_meta_bp`. null nos dias depois de hoje.
   */
  realizado_bp: percentualBpSchema.nullable(),
});

/** Quem está logo acima ou logo abaixo do alvo no ranking (empatados não são vizinhos). */
export const vizinhoIndividualSchema = z.strictObject({
  nome: z.string().min(1),
  posicao: z.number().int().min(1),
  /**
   * Distância até o vizinho no critério do ranking. **Sai sempre null enquanto o PO não decidir** (D12): somada ao
   * próprio número, ela revela o número do vizinho. Se for liberada: pontos-base (percentual_meta) ou bilhetes
   * (bilhetes). No critério arrecadação, nunca (o schema recusa).
   */
  diferenca: z.number().int().nonnegative().nullable(),
});

/**
 * Posição do alvo entre os pares: todos do nível que têm pelo menos uma célula (R8), inclusive quem ainda não
 * vendeu; empates dividem a posição (1, 1, 3).
 */
export const posicaoIndividualSchema = z.strictObject({
  posicao: z.number().int().min(1),
  /** Quantos estão neste ranking. */
  participantes: z.number().int().min(1),
  acima: vizinhoIndividualSchema.nullable(),
  abaixo: vizinhoIndividualSchema.nullable(),
});

export const rankingIndividualSchema = z.strictObject({
  /** O nível do alvo: célula (líder), discipulador ou rede. */
  nivel: z.enum(NIVEIS_RANKING),
  janela: janelaRankingSchema,
  criterio: z.enum(CRITERIOS_RANKING),
  /** Entre todos do nível (jovens e adultos juntos). null: o alvo não tem células e não entra no ranking (R8). */
  geral: posicaoIndividualSchema.nullable(),
  /** Entre os do nível na divisão do alvo (a premiação separa as divisões). null: como em `geral`. */
  divisao: posicaoIndividualSchema.nullable(),
  /**
   * Os primeiros da divisão, pela regra do ranking público: só quem já vendeu na janela, posição até
   * `publico.limite_ranking` (padrão 3; null = todos), empates na última posição entram todos. Só nome e
   * posição; `eu` marca o próprio alvo (pelo id, não pelo nome).
   */
  primeiros: z.array(
    z.strictObject({
      posicao: z.number().int().min(1),
      nome: z.string().min(1),
      eu: z.boolean(),
    }),
  ),
});

/**
 * Um alvo da equipe do usuário (quem está abaixo dele): as células do discipulador; os discipuladores e as
 * células da rede. Com números (o usuário responde por eles) e sem dinheiro.
 */
export const itemEquipeSchema = z.strictObject({
  tipo: z.enum(["discipulador", "celula"]),
  id: idSchema,
  nome: z.string().min(1),
  /** Nas células: o discipulador delas (a visão da rede agrupa por ele). null nos discipuladores. */
  discipulador_id: idSchema.nullable(),
  /** Nas células: o líder, como está na hierarquia. null nos discipuladores. */
  lider_nome: z.string().min(1).nullable(),
  /** Nas células: quantos afiliados da Rifei estão vinculados a ela (0 = o líder ainda não aderiu). null nos discipuladores. */
  afiliados_vinculados: quantidadeSchema.nullable(),
  desempenho: desempenhoIndividualSchema,
  /**
   * Posição no ranking do nível dele, na divisão, na janela pedida. null quando ele não entra no ranking
   * (discipulador sem células, R8).
   */
  posicao_divisao: z.number().int().min(1).nullable(),
});
export type ItemEquipe = z.infer<typeof itemEquipeSchema>;

/** Campos de cada janela do desempenho que estão na unidade da meta (com meta em centavos, seriam dinheiro). */
const QUANTIDADES_NA_UNIDADE_DA_META = {
  hoje: ["meta", "realizado", "falta"],
  periodo: ["meta", "esperado", "realizado", "diferenca"],
  campanha: ["meta", "esperado", "realizado", "diferenca"],
} as const;

export const respostaVisaoIndividualSchema = z
  .strictObject({
    alvo: alvoSchema,
    /** Nome do usuário conectado (quem recebeu o link). */
    pessoa: z.string().min(1).max(120),
    referencia: referenciaCampanhaSchema,
    unidade: z.enum(UNIDADES_META),
    desempenho: desempenhoIndividualSchema,
    /** Só no líder: quantos afiliados estão vinculados à célula (0 = falta a adesão). null nos outros papéis. */
    afiliados_vinculados: quantidadeSchema.nullable(),
    curva: z.array(pontoCurvaIndividualSchema),
    ranking: rankingIndividualSchema,
    /**
     * Líder: vazia. Discipulador: as células dele. Rede: os discipuladores dela e as células de cada um.
     * Ordem: discipuladores por nome; células pela ordem do discipulador delas e por nome.
     */
    equipe: z.array(itemEquipeSchema),
    atualizado_em: instanteSchema,
  })
  .superRefine((visao, ctx) => {
    const problema = (path: PropertyKey[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const desempenhos = [
      { caminho: ["desempenho"], desempenho: visao.desempenho },
      ...visao.equipe.map((item, indice) => ({
        caminho: ["equipe", indice, "desempenho"],
        desempenho: item.desempenho,
      })),
    ];
    for (const { caminho, desempenho } of desempenhos) {
      if ((desempenho.hoje === null) !== (desempenho.bilhetes.hoje === null))
        problema(
          [...caminho, "bilhetes", "hoje"],
          "Os bilhetes de hoje existem só quando existe a meta de hoje",
        );
      if (visao.unidade !== "centavos") continue;
      for (const janela of ["hoje", "periodo", "campanha"] as const) {
        const valores: Record<string, unknown> | null = desempenho[janela];
        for (const campo of QUANTIDADES_NA_UNIDADE_DA_META[janela])
          if (valores !== null && valores[campo] !== null)
            problema(
              [...caminho, janela, campo],
              "Meta em centavos: esta quantidade seria dinheiro (null)",
            );
      }
    }
    // D12: a distância até os vizinhos sai null até o PO decidir. Se ele liberar, a regra continua valendo só
    // para o critério arrecadação (lá a distância seria dinheiro).
    for (const escopo of ["geral", "divisao"] as const)
      for (const lado of ["acima", "abaixo"] as const)
        if (visao.ranking[escopo]?.[lado]?.diferenca != null)
          problema(
            ["ranking", escopo, lado, "diferenca"],
            visao.ranking.criterio === "arrecadacao"
              ? "Critério arrecadação: a distância seria dinheiro (null)"
              : "A distância até o vizinho sai null até o PO decidir (D12)",
          );
    if ((visao.ranking.geral === null) !== (visao.ranking.divisao === null))
      problema(
        ["ranking", "divisao"],
        "Fora do ranking (alvo sem células): geral e divisão null juntos",
      );
    const { fase, dia_campanha, duracao_dias } = visao.referencia;
    if (visao.desempenho.campanha.percentual_meta_bp === null) {
      if (visao.curva.length > 0)
        problema(["curva"], "Sem meta não há curva em percentual (vazia)");
    } else if (visao.curva.length !== duracao_dias)
      problema(["curva"], "Um ponto por dia da campanha");
    const [ano, mes, diaInicio] = visao.referencia.data_inicio
      .split("-")
      .map(Number);
    visao.curva.forEach((ponto, indice) => {
      if (ponto.dia !== indice + 1)
        problema(
          ["curva", indice, "dia"],
          "Os dias da curva vão de 1 a N, em ordem",
        );
      const dataDoDia = new Date(Date.UTC(ano, mes - 1, diaInicio + indice))
        .toISOString()
        .slice(0, 10);
      if (ponto.data !== dataDoDia)
        problema(
          ["curva", indice, "data"],
          "A data acompanha o dia da campanha",
        );
      const depoisDeHoje =
        fase === "antes" ||
        (fase === "durante" &&
          dia_campanha !== null &&
          ponto.dia > dia_campanha);
      if (depoisDeHoje !== (ponto.realizado_bp === null))
        problema(
          ["curva", indice, "realizado_bp"],
          "Realizado até hoje; null só nos dias depois de hoje",
        );
      if (
        fase === "durante" &&
        ponto.dia === dia_campanha &&
        ponto.realizado_bp !== visao.desempenho.campanha.percentual_meta_bp
      )
        problema(
          ["curva", indice, "realizado_bp"],
          "O ponto de hoje é o percentual da meta da campanha",
        );
    });
    const ultimo = visao.curva.at(-1);
    if (
      fase === "encerrada" &&
      ultimo !== undefined &&
      ultimo.realizado_bp !== visao.desempenho.campanha.percentual_meta_bp
    )
      problema(
        ["curva", visao.curva.length - 1, "realizado_bp"],
        "Depois do fim, o último ponto é o percentual da meta da campanha",
      );
    if (visao.ranking.nivel !== visao.alvo.tipo)
      problema(["ranking", "nivel"], "O nível do ranking é o do alvo");
    if (visao.ranking.primeiros.filter((item) => item.eu).length > 1)
      problema(["ranking", "primeiros"], "Só um item pode ser o próprio alvo");
    if (
      (visao.alvo.tipo === "celula") !==
      (visao.afiliados_vinculados !== null)
    )
      problema(
        ["afiliados_vinculados"],
        "Os afiliados vinculados vêm só na visão do líder",
      );
    const discipuladoresDaEquipe = new Set(
      visao.equipe
        .filter((item) => item.tipo === "discipulador")
        .map((item) => item.id),
    );
    visao.equipe.forEach((item, indice) => {
      const ehCelula = item.tipo === "celula";
      if (
        ehCelula !==
          (item.discipulador_id !== null &&
            item.lider_nome !== null &&
            item.afiliados_vinculados !== null) ||
        (!ehCelula &&
          (item.discipulador_id !== null ||
            item.lider_nome !== null ||
            item.afiliados_vinculados !== null))
      )
        problema(
          ["equipe", indice],
          "Discipulador da equipe sem os campos de célula; célula com discipulador, líder e afiliados",
        );
      const dentroDoAlvo =
        visao.alvo.tipo === "discipulador"
          ? ehCelula && item.discipulador_id === visao.alvo.id
          : visao.alvo.tipo === "rede"
            ? !ehCelula ||
              (item.discipulador_id !== null &&
                discipuladoresDaEquipe.has(item.discipulador_id))
            : false;
      if (ehCelula && item.posicao_divisao === null)
        problema(
          ["equipe", indice, "posicao_divisao"],
          "Célula sempre entra no ranking",
        );
      if (!dentroDoAlvo)
        problema(
          ["equipe", indice],
          "A equipe tem só quem está abaixo do alvo: o líder não tem equipe; o discipulador, as células dele; a rede, os discipuladores dela e as células deles",
        );
    });
  });
export type RespostaVisaoIndividual = z.infer<
  typeof respostaVisaoIndividualSchema
>;

// ---------------------------------------------------------------------------------------------------
// Conferência pelo CSV "Exportar Pedidos" da Rifei (RIFA-012): POST /api/admin/reconciliacao/analisar,
// POST /api/admin/reconciliacao/recuperar e GET /api/admin/reconciliacao/recuperacoes.
//
// O navegador lê o CSV, reconhece e mapeia as colunas (src/shared/conferencia) e manda à API só as colunas
// mapeadas que não são de dado pessoal, já normalizadas: o corpo compacto de ./conferencia, conferido pelo
// validador leve de lá (sem zod item a item: a CPU do Worker é curta). As listas e os limites também estão
// em ./conferencia, sem zod, para o site usar. Documentação: docs/api.md e docs/integracao-rifei.md (10).
// ---------------------------------------------------------------------------------------------------

/** Corpo compacto da análise; o validador de ./conferencia confere cada posição e diz o problema. */
export const corpoAnalisarReconciliacaoSchema = z.custom<CorpoConferencia>(
  (valor) => validarCorpoConferencia(valor).ok,
  { message: "Corpo da conferência inválido" },
);

/**
 * "Recuperar": o corpo da análise (com a coluna do código) mais `pedidos` (1 a 500 códigos) e `simular`
 * (true = prévia, nada é gravado). Grava como aprovados (origem `conferencia`) os pedidos escolhidos, com
 * os dados do arquivo; pedido que já existe nunca é sobrescrito; atômico e idempotente.
 */
export const corpoRecuperarReconciliacaoSchema = z.custom<CorpoRecuperacao>(
  (valor) => validarCorpoRecuperacao(valor).ok,
  { message: "Corpo do Recuperar inválido" },
);

/** Um código de pedido do arquivo (FORMATO_ID_PEDIDO_RECONCILIACAO). */
export const idPedidoReconciliacaoSchema = z
  .string()
  .regex(FORMATO_ID_PEDIDO_RECONCILIACAO, {
    message: "Código de pedido inválido",
  });

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
  /** null: sem a coluna, ilegível ou ambíguo (pedido em várias linhas: observação `valor_ambiguo`). */
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

/** Um aviso (tipo AvisoReconciliacao, de ./conferencia). */
export const avisoReconciliacaoSchema = z.strictObject({
  codigo: z.enum(CODIGOS_AVISO_RECONCILIACAO),
  mensagem: z.string().min(1),
  quantidade: z.number().int().positive().nullable(),
});

/** O que a API viu no corpo. */
export const arquivoLidoSchema = z.strictObject({
  /** Linhas de dados do arquivo. */
  linhas: z.number().int().nonnegative(),
  /** Linhas sem código (vazio ou ilegível) no modo por pedido: ficam de fora. */
  linhas_ignoradas: z.number().int().nonnegative(),
  /** O mesmo código em várias linhas, ou uma linha por bilhete (opção "Um bilhete por linha"). */
  um_bilhete_por_linha: z.boolean(),
  /** Dias (no fuso da campanha) que a coluna da data cobre; null sem datas. */
  data_inicio: dataLocalSchema.nullable(),
  data_fim: dataLocalSchema.nullable(),
});

/** Totais pagos de um lado no arquivo: null quando o arquivo não permite contar. */
export const totaisArquivoSchema = z.strictObject({
  pedidos_aprovados: z.number().int().nonnegative().nullable(),
  bilhetes: z.number().int().nonnegative().nullable(),
  total_centavos: centavosSchema.nullable(),
});
export type TotaisArquivo = z.infer<typeof totaisArquivoSchema>;

const comumAnaliseReconciliacao = {
  arquivo: arquivoLidoSchema,
  /** Avisos da comparação (os do arquivo, como colunas ou células ilegíveis, a tela monta sozinha). */
  avisos: z.array(avisoReconciliacaoSchema),
  conferido_em: instanteSchema,
};

/**
 * A coluna escolhida como código confere com o sistema? `confere: false` quando, com pelo menos
 * MINIMO_CODIGOS_PARA_CONFERIR (5) pagos no arquivo, menos da metade existe no sistema (em qualquer
 * campanha), a não ser que os pagos do sistema no período do arquivo (também pelo menos 5) estejam na
 * maioria no arquivo: provavelmente é outra coluna. Aí nada pode ser recuperado (aviso
 * `codigo_nao_confere`; o "Recuperar" responde 400) até a coordenação trocar a coluna.
 */
export const codigoDoPedidoSchema = z.strictObject({
  confere: z.boolean(),
  pagos_no_arquivo: z.number().int().nonnegative(),
  encontrados: z.number().int().nonnegative(),
});

/** Modo por pedido: o corpo traz a coluna do código. */
export const respostaAnalisePorPedidoSchema = z.strictObject({
  modo: z.literal("por_pedido"),
  ...comumAnaliseReconciliacao,
  codigo: codigoDoPedidoSchema,
  resumo: z.strictObject({
    /** Códigos distintos e válidos no arquivo. */
    pedidos_no_arquivo: z.number().int().nonnegative(),
    aprovados_no_arquivo: totaisArquivoSchema,
    /** Todos os pagos da campanha ativa no sistema. */
    aprovados_no_sistema: totaisVendasSchema,
    /** Pagos nos dois lados, sem nenhuma diferença. */
    conferem: z.number().int().nonnegative(),
    /**
     * Pedidos com alguma divergência (cada um conta uma vez), sem os pagos do sistema de dias que o
     * arquivo não cobre: esses ficam à parte, em `ausentes_fora_do_periodo`.
     */
    com_divergencia: z.number().int().nonnegative(),
    /** Pagos no sistema e ausentes no arquivo de dias que ele não cobre (listados em ausente_no_arquivo). */
    ausentes_fora_do_periodo: z.number().int().nonnegative(),
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
  /** SHA-256 do texto do arquivo (calculado no navegador): identifica o arquivo sem o conteúdo. */
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
  /**
   * Papéis aceitos quando a rota é mais restrita que o grupo (ex.: `["admin"]` na auditoria). Ausente =
   * os do grupo (`coordenacao`: admin e coordenacao). Mesmo campo de `ROTAS_ACESSO` (acesso.ts).
   */
  readonly papeis?: readonly Papel[] | null;
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
  pedidosSuspeitos: {
    metodo: "GET",
    caminho: "/api/admin/pedidos/suspeitos",
    grupo: "coordenacao",
    situacao: "detalhada",
    sucesso: { status: 200, corpo: respostaPedidosSuspeitosSchema },
  },
  auditoria: {
    metodo: "GET",
    caminho: "/api/admin/auditoria",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    consulta: consultaAuditoriaSchema,
    sucesso: { status: 200, corpo: respostaAuditoriaSchema },
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
  /** Sem sessão: 401. Sessão da coordenação: 403 (`proibido`). Sem campanha ativa: como o painel. */
  visaoIndividual: {
    metodo: "GET",
    caminho: "/api/minha/visao",
    grupo: "hierarquia",
    papeis: ["lider", "discipulador", "rede"],
    situacao: "detalhada",
    consulta: consultaVisaoIndividualSchema,
    sucesso: { status: 200, corpo: respostaVisaoIndividualSchema },
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
