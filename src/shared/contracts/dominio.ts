/**
 * Tipos e schemas do domínio: campanha (configuração), hierarquia (rede → discipulador → célula),
 * afiliado, pedido e evento de webhook. Espelham as tabelas de migrations/0001_init.sql.
 *
 * Convenções: nomes em português, snake_case; dinheiro em centavos (inteiro); percentuais em pontos-base
 * (3500 = 35%); instantes em UTC ("2026-12-01T12:20:31.512Z"); datas locais da campanha em "YYYY-MM-DD".
 * `*EntradaSchema` = corpo de criação/edição; `*Schema` = como a API devolve.
 */
import { z } from "zod";
import { detalheValidacaoSchema } from "./erros";
import {
  codigoPaisSchema,
  dddSchema,
  payloadRifeiRedigidoSchema,
  type EventoRifei,
} from "./rifei";

// ---------------------------------------------------------------------------------------------------
// Primitivos
// ---------------------------------------------------------------------------------------------------

export const idSchema = z.number().int().positive();
export const centavosSchema = z.number().int().nonnegative();
/** Pontos-base: 10000 = 100%. */
export const pontosBaseSchema = z.number().int().min(0).max(10_000);
/** Data local no fuso da campanha, "YYYY-MM-DD" (datas impossíveis são rejeitadas). */
export const dataLocalSchema = z.iso.date();
/** Instante em UTC com milissegundos: "2026-12-01T12:20:31.512Z" (ordem alfabética = cronológica). */
export const instanteSchema = z.iso.datetime({ precision: 3 });
/** id de afiliado da Rifei (inteiro). */
export const affiliateIdSchema = z.number().int().nonnegative();

/** D8: fuso padrão da campanha. */
export const FUSO_PADRAO = "America/Belem";

function fusoHorarioValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** Fuso IANA (ex.: America/Belem). */
export const fusoHorarioSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(fusoHorarioValido, {
    message: "Fuso horário IANA inválido (ex.: America/Belem)",
  });

const nomeSchema = z.string().trim().min(1).max(120);
const textoOpcionalSchema = z.string().trim().min(1).max(120).nullable();
const emailSchema = z.email().max(254);
const telefoneContatoSchema = z.string().trim().min(1).max(40);

// ---------------------------------------------------------------------------------------------------
// Enumerações
// ---------------------------------------------------------------------------------------------------

export const DIVISOES = ["jovens", "adultos"] as const;
export const divisaoSchema = z.enum(DIVISOES);
export type Divisao = z.infer<typeof divisaoSchema>;

/** Estado do pedido (D4). Só `approved` conta como venda. */
export const STATUS_PEDIDO = ["in_process", "approved", "expired"] as const;
export const statusPedidoSchema = z.enum(STATUS_PEDIDO);
export type StatusPedido = z.infer<typeof statusPedidoSchema>;

/** Resultado de cada entrega do webhook (D3, D4, D5, D9). */
export const RESULTADOS_EVENTO_WEBHOOK = [
  "processado",
  "duplicado",
  "ignorado_outra_campanha",
  "ignorado_transicao",
  "erro_validacao",
] as const;
export const resultadoEventoWebhookSchema = z.enum(RESULTADOS_EVENTO_WEBHOOK);
export type ResultadoEventoWebhook = z.infer<
  typeof resultadoEventoWebhookSchema
>;

/** Em que unidade a meta é medida. */
export const UNIDADES_META = ["bilhetes", "centavos"] as const;
/**
 * Como a meta de cada célula sai de `meta.valor`:
 * - por_pessoa: valor × qtd_pessoas da célula;
 * - total_proporcional: valor (total da campanha) × qtd_pessoas / soma de qtd_pessoas de todas as células;
 * - fixa_por_celula: valor, igual para todas.
 */
export const REGRAS_META = [
  "por_pessoa",
  "total_proporcional",
  "fixa_por_celula",
] as const;
/** Critério de ordenação dos rankings. */
export const CRITERIOS_RANKING = [
  "percentual_meta",
  "bilhetes",
  "arrecadacao",
] as const;
/** Como o afiliado entrou no sistema: pelo webhook (órfão, D7) ou cadastrado pela coordenação. */
export const ORIGENS_AFILIADO = ["webhook", "manual"] as const;

export type UnidadeMeta = (typeof UNIDADES_META)[number];
export type RegraMeta = (typeof REGRAS_META)[number];
export type CriterioRanking = (typeof CRITERIOS_RANKING)[number];
export type OrigemAfiliado = (typeof ORIGENS_AFILIADO)[number];

// ---------------------------------------------------------------------------------------------------
// Campanha (configuração: nada disso fica no código)
// ---------------------------------------------------------------------------------------------------

/**
 * Período da campanha (ex.: "Semana 1"). Os períodos são consecutivos a partir de `data_inicio` da
 * campanha, na ordem do array, e cada um dura `dias` dias. Os percentuais não precisam somar 10000:
 * o cálculo normaliza (docs/modelo-de-dados.md).
 */
export const periodoCampanhaEntradaSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  dias: z.number().int().min(1).max(366),
  percentual_bp: pontosBaseSchema,
});

export const periodoCampanhaSchema = z.object({
  ordem: z.number().int().min(1),
  nome: z.string().min(1).max(60),
  dias: z.number().int().min(1).max(366),
  percentual_bp: pontosBaseSchema,
  /** Calculadas pela API a partir de data_inicio da campanha e dos dias dos períodos anteriores. */
  data_inicio: dataLocalSchema,
  data_fim: dataLocalSchema,
});

export const metaCampanhaSchema = z.object({
  unidade: z.enum(UNIDADES_META),
  regra: z.enum(REGRAS_META),
  /** Na unidade da meta: bilhetes ou centavos. O significado depende da regra (ver REGRAS_META). */
  valor: z.number().int().positive(),
});

export const rankingConfigSchema = z.object({
  criterio: z.enum(CRITERIOS_RANKING),
});

/** Visão pública (telão e grupo). Valores em R$ nunca aparecem em /api/publico, com qualquer configuração. */
export const publicoConfigSchema = z.object({
  /** Se o ranking público mostra o % da meta (indicador não financeiro). Padrão: não. */
  mostra_percentual_meta: z.boolean(),
  /** Quantas posições o ranking público mostra; null = todas. Padrão: 3. */
  limite_ranking: z.number().int().min(1).max(100).nullable(),
});

export const PUBLICO_PADRAO = {
  mostra_percentual_meta: false,
  limite_ranking: 3,
} as const;

export const campanhaEntradaSchema = z.object({
  nome: nomeSchema,
  /** Slug da campanha na Rifei: só eventos com este slug são processados (D5). */
  slug_rifei: z.string().trim().min(1).max(200),
  fuso_horario: fusoHorarioSchema.default(FUSO_PADRAO),
  /** Primeiro dia de vendas (data local). */
  data_inicio: dataLocalSchema,
  preco_bilhete_centavos: z.number().int().positive(),
  meta: metaCampanhaSchema,
  periodos: z
    .array(periodoCampanhaEntradaSchema)
    .min(1)
    .max(53)
    .refine(
      (periodos) => periodos.some((periodo) => periodo.percentual_bp > 0),
      {
        message: "Pelo menos um período precisa ter percentual maior que zero",
      },
    ),
  ranking: rankingConfigSchema,
  publico: publicoConfigSchema.default(() => ({ ...PUBLICO_PADRAO })),
});
export type CampanhaEntrada = z.input<typeof campanhaEntradaSchema>;

export const campanhaSchema = z.object({
  id: idSchema,
  nome: z.string().min(1).max(120),
  slug_rifei: z.string().min(1).max(200),
  fuso_horario: fusoHorarioSchema,
  data_inicio: dataLocalSchema,
  /** Último dia de vendas (data local): data_inicio + soma dos dias − 1. */
  data_fim: dataLocalSchema,
  preco_bilhete_centavos: z.number().int().positive(),
  meta: metaCampanhaSchema,
  periodos: z.array(periodoCampanhaSchema).min(1),
  /** Soma dos percentuais configurados. Diferente de 10000 = a interface avisa (o cálculo normaliza). */
  soma_percentuais_bp: z.number().int().positive(),
  ranking: rankingConfigSchema,
  publico: publicoConfigSchema,
  criado_em: instanteSchema,
  atualizado_em: instanteSchema,
});
export type Campanha = z.infer<typeof campanhaSchema>;

// ---------------------------------------------------------------------------------------------------
// Hierarquia: rede (divisão jovens|adultos) → discipulador → célula
// ---------------------------------------------------------------------------------------------------

export const redeEntradaSchema = z.object({
  nome: nomeSchema,
  divisao: divisaoSchema,
  /** Pastor ou obreiro responsável pela rede. */
  responsavel_nome: textoOpcionalSchema.default(null),
});
export type RedeEntrada = z.input<typeof redeEntradaSchema>;

export const redeSchema = z.object({
  id: idSchema,
  nome: z.string().min(1).max(120),
  divisao: divisaoSchema,
  responsavel_nome: z.string().min(1).max(120).nullable(),
  criado_em: instanteSchema,
  atualizado_em: instanteSchema,
});
export type Rede = z.infer<typeof redeSchema>;

export const discipuladorEntradaSchema = z.object({
  rede_id: idSchema,
  nome: nomeSchema,
});
export type DiscipuladorEntrada = z.input<typeof discipuladorEntradaSchema>;

export const discipuladorSchema = z.object({
  id: idSchema,
  rede_id: idSchema,
  nome: z.string().min(1).max(120),
  rede_nome: z.string().min(1).max(120),
  divisao: divisaoSchema,
  criado_em: instanteSchema,
  atualizado_em: instanteSchema,
});
export type Discipulador = z.infer<typeof discipuladorSchema>;

export const celulaEntradaSchema = z.object({
  discipulador_id: idSchema,
  nome: nomeSchema,
  /** Base da meta proporcional. */
  qtd_pessoas: z.number().int().min(1).max(1000),
  lider_nome: nomeSchema,
  lider_email: emailSchema.nullable().default(null),
  lider_telefone: telefoneContatoSchema.nullable().default(null),
});
export type CelulaEntrada = z.input<typeof celulaEntradaSchema>;

export const celulaSchema = z.object({
  id: idSchema,
  discipulador_id: idSchema,
  nome: z.string().min(1).max(120),
  qtd_pessoas: z.number().int().min(1).max(1000),
  lider_nome: z.string().min(1).max(120),
  lider_email: emailSchema.nullable(),
  lider_telefone: z.string().min(1).max(40).nullable(),
  discipulador_nome: z.string().min(1).max(120),
  rede_id: idSchema,
  rede_nome: z.string().min(1).max(120),
  divisao: divisaoSchema,
  criado_em: instanteSchema,
  atualizado_em: instanteSchema,
});
export type Celula = z.infer<typeof celulaSchema>;

// ---------------------------------------------------------------------------------------------------
// Afiliado (D7): affiliate_id da Rifei → célula; celula_id null = não vinculado (fila de órfãos)
// ---------------------------------------------------------------------------------------------------

export const afiliadoSchema = z.object({
  affiliate_id: affiliateIdSchema,
  celula_id: idSchema.nullable(),
  /** Nota livre da coordenação (ex.: usuário do líder na Rifei). */
  rotulo: z.string().min(1).max(120).nullable(),
  origem: z.enum(ORIGENS_AFILIADO),
  criado_em: instanteSchema,
  /** Preenchido se e somente se celula_id não é null. */
  vinculado_em: instanteSchema.nullable(),
  atualizado_em: instanteSchema,
});
export type Afiliado = z.infer<typeof afiliadoSchema>;

// ---------------------------------------------------------------------------------------------------
// Pedido: estado atual de cada pedido da Rifei (sem nenhum dado pessoal, D1)
// ---------------------------------------------------------------------------------------------------

export const utmSchema = z.object({
  source: z.string().nullable(),
  campaign: z.string().nullable(),
  medium: z.string().nullable(),
  content: z.string().nullable(),
  term: z.string().nullable(),
});

export const pedidoSchema = z.object({
  /** `id` do pedido na Rifei. */
  id: z.string().min(1).max(128),
  campanha_id: idSchema,
  /** null = venda sem afiliado. A célula é resolvida na leitura, pelo afiliado (D7). */
  affiliate_id: affiliateIdSchema.nullable(),
  status: statusPedidoSchema,
  /** `status` e `status_detail` como vieram no último evento processado. */
  status_rifei: z.string().min(1),
  status_detail_rifei: z.string(),
  qtd_bilhetes: z.number().int().nonnegative(),
  numeros: z.array(z.number().int().nonnegative()).nullable(),
  subtotal_centavos: centavosSchema,
  total_centavos: centavosSchema,
  desconto_promocao_centavos: centavosSchema.nullable(),
  desconto_cupom_centavos: centavosSchema.nullable(),
  cupom_id: z.number().int().nullable(),
  metodo_pagamento: z.string(),
  rifinha: z.boolean(),
  ddd: dddSchema.nullable(),
  /** Código de discagem do país do comprador ("55" = Brasil). */
  pais: codigoPaisSchema.nullable(),
  utm: utmSchema,
  /** Instantes da Rifei normalizados para UTC. */
  criado_em: instanteSchema,
  expira_em: instanteSchema,
  /** approved_at; se a Rifei mandar null num pedido aprovado, vale o instante do recebimento. */
  aprovado_em: instanteSchema.nullable(),
  expirado_em: instanteSchema.nullable(),
  /** Nossos: primeira vez que o pedido foi gravado e última alteração. */
  registrado_em: instanteSchema,
  atualizado_em: instanteSchema,
});
export type Pedido = z.infer<typeof pedidoSchema>;

// ---------------------------------------------------------------------------------------------------
// Evento de webhook (D3): uma linha por entrega autenticada, com o payload REDIGIDO
// ---------------------------------------------------------------------------------------------------

export const eventoWebhookSchema = z.object({
  id: idSchema,
  recebido_em: instanteSchema,
  /** `event`, `id` e `slug` como vieram (em erro_validacao podem faltar ou ser desconhecidos). */
  evento: z.string().max(64).nullable(),
  pedido_id: z.string().max(128).nullable(),
  slug: z.string().max(200).nullable(),
  resultado: resultadoEventoWebhookSchema,
  /** Estado do pedido antes do evento (null se o pedido não existia). */
  status_anterior: statusPedidoSchema.nullable(),
  /** Estado depois do evento: preenchido em processado, duplicado e ignorado_transicao. */
  status_resultante: statusPedidoSchema.nullable(),
  /** null só em erro_validacao. */
  payload_redigido: payloadRifeiRedigidoSchema.nullable(),
  /** Problemas de validação (sem valores); só em erro_validacao. */
  erro: z.array(detalheValidacaoSchema).nullable(),
});
export type EventoWebhook = z.infer<typeof eventoWebhookSchema>;

// ---------------------------------------------------------------------------------------------------
// D4: máquina de estados do pedido
// ---------------------------------------------------------------------------------------------------

/** Estado que cada evento pede. */
export const STATUS_ALVO_POR_EVENTO = {
  new_order: "in_process",
  paid_order: "approved",
  expired_order: "expired",
} as const satisfies Record<EventoRifei, StatusPedido>;

/** Transições permitidas: in_process → approved | expired; expired → approved; approved é terminal. */
export const TRANSICOES_PERMITIDAS = {
  in_process: ["approved", "expired"],
  expired: ["approved"],
  approved: [],
} as const satisfies Record<StatusPedido, readonly StatusPedido[]>;

export interface DecisaoTransicao {
  resultado: Extract<
    ResultadoEventoWebhook,
    "processado" | "duplicado" | "ignorado_transicao"
  >;
  /** Estado do pedido depois do evento (igual ao atual quando nada muda). */
  status_resultante: StatusPedido;
}

/**
 * Decide o que um evento faz com o pedido (D3/D4):
 * - pedido inexistente: cria direto no estado do evento (eventos fora de ordem caem aqui);
 * - mesmo estado: `duplicado` (reentrega, nada muda);
 * - transição permitida: `processado`;
 * - qualquer outra (ex.: expired depois de approved): `ignorado_transicao`.
 */
export function decidirTransicaoPedido(
  statusAtual: StatusPedido | null,
  evento: EventoRifei,
): DecisaoTransicao {
  const alvo = STATUS_ALVO_POR_EVENTO[evento];
  if (statusAtual === null)
    return { resultado: "processado", status_resultante: alvo };
  if (statusAtual === alvo)
    return { resultado: "duplicado", status_resultante: statusAtual };
  const permitidos: readonly StatusPedido[] =
    TRANSICOES_PERMITIDAS[statusAtual];
  return permitidos.includes(alvo)
    ? { resultado: "processado", status_resultante: alvo }
    : { resultado: "ignorado_transicao", status_resultante: statusAtual };
}
