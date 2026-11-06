/**
 * Contrato da integração com a Rifei: payload do webhook, payload REDIGIDO e regras de conversão.
 *
 * Fonte do payload: documentação oficial (https://rifei.com.br/ajuda/webhook/referencia-do-webhook,
 * lida em 06/11/2026). Decisões D1 a D9: docs/integracao-rifei.md.
 *
 * Nomes dos campos do payload ficam como a Rifei manda (inglês). O que é nosso fica em português.
 */
import { z } from 'zod';

/** Nome do segredo do Worker com o token que a Rifei manda em `Authorization: Bearer <token>` (D6). */
export const SEGREDO_WEBHOOK_RIFEI = 'RIFEI_WEBHOOK_TOKEN';

/** Eventos do webhook ("Novo pedido", "Pedido pago" e "Pedido expirado" na tela da Rifei). */
export const EVENTOS_RIFEI = ['new_order', 'paid_order', 'expired_order'] as const;
export const eventoRifeiSchema = z.enum(EVENTOS_RIFEI);
export type EventoRifei = z.infer<typeof eventoRifeiSchema>;

/**
 * Valores de `status` citados na doc oficial. O schema aceita qualquer texto não vazio porque o valor
 * num `expired_order` não é documentado (SUPOSIÇÃO). O estado do pedido vem do `event` (D4), não daqui.
 */
export const STATUS_RIFEI_DOCUMENTADOS = ['in_process', 'approved'] as const;

/** Instante ISO 8601 com fuso, como a Rifei manda (ex.: 2024-08-23T11:28:45.035-03:00). */
export const instanteRifeiSchema = z.iso.datetime({ offset: true });

const idPedidoRifeiSchema = z.string().min(1).max(128);
const slugRifeiSchema = z.string().min(1).max(200);
const numerosBilhetesSchema = z.array(z.number().int().nonnegative());
const reaisSchema = z.number().nonnegative();
const affiliateIdRifeiSchema = z.number().int().nonnegative();

/** Campo que a doc marca como `null/string`: aceita null e também a ausência do campo (vira null). */
const textoAnulavel = () => z.string().nullable().default(null);

// ---------------------------------------------------------------------------------------------------
// Payload recebido (bruto). Só existe na memória da requisição: nunca é gravado (D1).
// Regras: tipos conforme a doc; todo campo `null/...` aceita null ou ausência (vira null); campos
// desconhecidos são tolerados e descartados.
// ---------------------------------------------------------------------------------------------------

export const enderecoRifeiSchema = z.object({
  country: textoAnulavel(),
  zipcode: textoAnulavel(),
  address: textoAnulavel(),
  number: textoAnulavel(),
  neighborhood: textoAnulavel(),
  complement: textoAnulavel(),
  state: textoAnulavel(),
  city: textoAnulavel(),
});

export const compradorRifeiSchema = z.object({
  name: z.string(),
  /** E.164 (ex.: +5591988887777). Sem validação de formato: um telefone fora do padrão só deixa ddd/pais nulos. */
  phone: z.string(),
  email: textoAnulavel(),
  document: textoAnulavel(),
  /** DD/MM/YYYY */
  date_of_birth: textoAnulavel(),
  address: enderecoRifeiSchema.nullable().default(null),
});

const UTM_VAZIO = {
  source: null,
  campaign: null,
  medium: null,
  content: null,
  term: null,
} as const;

export const utmRifeiSchema = z.object({
  source: textoAnulavel(),
  campaign: textoAnulavel(),
  medium: textoAnulavel(),
  content: textoAnulavel(),
  term: textoAnulavel(),
});

export const payloadRifeiSchema = z.object({
  event: eventoRifeiSchema,
  /** Identificador único do pedido na Rifei: chave primária de `pedidos` (D3). */
  id: idPedidoRifeiSchema,
  /** Identificador da campanha. O webhook é da CONTA: slug diferente do configurado é ignorado (D5). */
  slug: slugRifeiSchema,
  is_rifinha: z.boolean(),
  buyer: compradorRifeiSchema,
  numbers: numerosBilhetesSchema.nullable().default(null),
  numbers_count: z.number().int().nonnegative(),
  lucky_numbers: numerosBilhetesSchema.nullable().default(null),
  /** Reais (decimal). Guardado em centavos (D2). */
  subtotal: reaisSchema,
  /** Reais (decimal), depois dos descontos. É o valor arrecadado. */
  total: reaisSchema,
  promotion_discount: reaisSchema.nullable().default(null),
  coupon_discount: reaisSchema.nullable().default(null),
  payment_method: z.string(),
  status: z.string().min(1),
  status_detail: z.string(),
  coupon_id: z.number().int().nullable().default(null),
  /** Afiliado (líder de célula) que fez a venda; null = venda sem afiliado (D7). */
  affiliate_id: affiliateIdRifeiSchema.nullable().default(null),
  created_at: instanteRifeiSchema,
  expires_at: instanteRifeiSchema,
  approved_at: instanteRifeiSchema.nullable().default(null),
  /** Ausente no exemplo oficial: ausência vira null. */
  expired_at: instanteRifeiSchema.nullable().default(null),
  upsells: z.array(z.string()),
  observation: textoAnulavel(),
  /** Ausente no exemplo oficial: ausência vira null. */
  fbp: textoAnulavel(),
  /** Ausente no exemplo oficial: ausência vira null. */
  fbc: textoAnulavel(),
  /** SUPOSIÇÃO: `utm` ausente ou null é tolerado e vira o objeto com tudo null. */
  utm: utmRifeiSchema.nullish().transform((utm) => utm ?? { ...UTM_VAZIO }),
});

/** Payload validado (saída do schema): nulos normalizados, campos desconhecidos descartados. */
export type PayloadRifei = z.infer<typeof payloadRifeiSchema>;
/** Formato aceito na entrada (campos `null/...` podem faltar). */
export type PayloadRifeiEntrada = z.input<typeof payloadRifeiSchema>;

// ---------------------------------------------------------------------------------------------------
// Payload REDIGIDO (D1): é o único formato gravado (webhook_eventos.payload_redigido) e o único que o
// processamento lê. Montado por lista de permissão: tudo o que não está aqui é descartado.
// ---------------------------------------------------------------------------------------------------

/** Caminhos do payload bruto que NUNCA são gravados (D1). Do `buyer` sobram só ddd e pais, derivados do telefone. */
export const CAMPOS_DESCARTADOS_NA_REDACAO = [
  'buyer.name',
  'buyer.phone',
  'buyer.email',
  'buyer.document',
  'buyer.date_of_birth',
  'buyer.address',
  'observation',
  'fbp',
  'fbc',
] as const;

/** DDD brasileiro: dois dígitos de 1 a 9 (11 a 99, sem zero). */
export const dddSchema = z.string().regex(/^[1-9]{2}$/);
/** Código de discagem do país (DDI) em dígitos, sem "+": "55" = Brasil. */
export const codigoPaisSchema = z.string().regex(/^[1-9]\d{0,2}$/);

export const telefoneRedigidoSchema = z.strictObject({
  ddd: dddSchema.nullable(),
  pais: codigoPaisSchema.nullable(),
});
export type TelefoneRedigido = z.infer<typeof telefoneRedigidoSchema>;

export const payloadRifeiRedigidoSchema = z.strictObject({
  event: eventoRifeiSchema,
  id: idPedidoRifeiSchema,
  slug: slugRifeiSchema,
  is_rifinha: z.boolean(),
  /** Substitui `buyer`: só DDD e código do país, derivados de `buyer.phone`. */
  comprador: telefoneRedigidoSchema,
  numbers: numerosBilhetesSchema.nullable(),
  numbers_count: z.number().int().nonnegative(),
  lucky_numbers: numerosBilhetesSchema.nullable(),
  subtotal: reaisSchema,
  total: reaisSchema,
  promotion_discount: reaisSchema.nullable(),
  coupon_discount: reaisSchema.nullable(),
  payment_method: z.string(),
  status: z.string().min(1),
  status_detail: z.string(),
  coupon_id: z.number().int().nullable(),
  affiliate_id: affiliateIdRifeiSchema.nullable(),
  created_at: instanteRifeiSchema,
  expires_at: instanteRifeiSchema,
  approved_at: instanteRifeiSchema.nullable(),
  expired_at: instanteRifeiSchema.nullable(),
  upsells: z.array(z.string()),
  utm: z.strictObject({
    source: z.string().nullable(),
    campaign: z.string().nullable(),
    medium: z.string().nullable(),
    content: z.string().nullable(),
    term: z.string().nullable(),
  }),
});
export type PayloadRifeiRedigido = z.infer<typeof payloadRifeiRedigidoSchema>;

/** Códigos de país (E.164) com 1 e 2 dígitos. Os demais têm 3 (os códigos não são prefixo uns dos outros). */
const DDI_COM_1_DIGITO = new Set(['1', '7']);
const DDI_COM_2_DIGITOS = new Set(
  [
    '20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49',
    '51 52 53 54 55 56 57 58 60 61 62 63 64 65 66',
    '81 82 84 86 90 91 92 93 94 95 98',
  ]
    .join(' ')
    .split(' '),
);

/**
 * Deriva DDD e código do país de um telefone E.164 (D1). Espaços, parênteses, pontos e hífens são
 * ignorados. Sem "+" inicial ou fora do E.164: tudo null. DDD só para o Brasil (+55) com número de
 * 10 ou 11 dígitos depois do país.
 */
export function derivarTelefone(telefone: string | null | undefined): TelefoneRedigido {
  const vazio: TelefoneRedigido = { ddd: null, pais: null };
  if (!telefone) return vazio;
  const digitos = /^\+([1-9]\d{6,14})$/.exec(telefone.replace(/[\s().-]/g, ''))?.[1];
  if (digitos === undefined) return vazio;
  const pais = DDI_COM_1_DIGITO.has(digitos.slice(0, 1))
    ? digitos.slice(0, 1)
    : DDI_COM_2_DIGITOS.has(digitos.slice(0, 2))
      ? digitos.slice(0, 2)
      : digitos.slice(0, 3);
  if (pais !== '55') return { ddd: null, pais };
  const nacional = digitos.slice(2);
  return /^[1-9]{2}\d{8,9}$/.test(nacional)
    ? { ddd: nacional.slice(0, 2), pais }
    : { ddd: null, pais };
}

/** D2: reais (decimal) para centavos (inteiro). */
export function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100);
}

/**
 * D1: monta o payload redigido campo a campo (lista de permissão). Nada do `buyer` além de ddd/pais,
 * e nada de observation, fbp ou fbc.
 */
export function redigirPayloadRifei(payload: PayloadRifei): PayloadRifeiRedigido {
  return {
    event: payload.event,
    id: payload.id,
    slug: payload.slug,
    is_rifinha: payload.is_rifinha,
    comprador: derivarTelefone(payload.buyer.phone),
    numbers: payload.numbers,
    numbers_count: payload.numbers_count,
    lucky_numbers: payload.lucky_numbers,
    subtotal: payload.subtotal,
    total: payload.total,
    promotion_discount: payload.promotion_discount,
    coupon_discount: payload.coupon_discount,
    payment_method: payload.payment_method,
    status: payload.status,
    status_detail: payload.status_detail,
    coupon_id: payload.coupon_id,
    affiliate_id: payload.affiliate_id,
    created_at: payload.created_at,
    expires_at: payload.expires_at,
    approved_at: payload.approved_at,
    expired_at: payload.expired_at,
    upsells: payload.upsells,
    utm: {
      source: payload.utm.source,
      campaign: payload.utm.campaign,
      medium: payload.utm.medium,
      content: payload.utm.content,
      term: payload.utm.term,
    },
  };
}

/** O que dá para gravar de um payload que falhou na validação (D9): só textos de event, id e slug. */
export interface IdentificacaoPayloadInvalido {
  evento: string | null;
  pedido_id: string | null;
  slug: string | null;
}

/**
 * Extrai event, id e slug de um corpo inválido para o registro `erro_validacao`. Nenhum outro campo é
 * lido, então nada pessoal é gravado. Textos maiores que os limites da tabela são cortados.
 */
export function identificarPayloadInvalido(corpo: unknown): IdentificacaoPayloadInvalido {
  const objeto =
    typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {};
  const texto = (valor: unknown, limite: number): string | null =>
    typeof valor === 'string' && valor.length > 0 ? valor.slice(0, limite) : null;
  return {
    evento: texto(objeto['event'], 64),
    pedido_id: texto(objeto['id'], 128),
    slug: texto(objeto['slug'], 200),
  };
}
