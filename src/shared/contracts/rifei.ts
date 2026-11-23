/**
 * Contrato da integração com a Rifei: payload do webhook, payload REDIGIDO e regras de conversão.
 *
 * Fonte do payload: documentação oficial (https://rifei.com.br/ajuda/webhook/referencia-do-webhook,
 * lida em 06/11/2026). Decisões D1 a D9: docs/integracao-rifei.md.
 *
 * Nomes dos campos do payload ficam como a Rifei manda (inglês). O que é nosso fica em português.
 */
import { z } from "zod";
import {
  detalhesDeValidacao,
  resumirDetalhes,
  type DetalheResumido,
} from "./erros";

/**
 * Nome do segredo do Worker com o token que a Rifei manda em `Authorization: Bearer <token>` (D6). Desde a RIFA-039
 * (docs/decisions.md D21), vale só quando não há token gerado pela tela: o da tela tem prioridade
 * (credencialVigenteDoWebhook em ./token-webhook).
 */
export const SEGREDO_WEBHOOK_RIFEI = "RIFEI_WEBHOOK_TOKEN";

/** Eventos do webhook ("Novo pedido", "Pedido pago" e "Pedido expirado" na tela da Rifei). */
export const EVENTOS_RIFEI = [
  "new_order",
  "paid_order",
  "expired_order",
] as const;
export const eventoRifeiSchema = z.enum(EVENTOS_RIFEI);
export type EventoRifei = z.infer<typeof eventoRifeiSchema>;

/**
 * Evento de teste que a Rifei manda ao "Adicionar" o webhook (visto em produção em 17/11/2026: `event` "test", sem
 * id, slug nem total). A Rifei recusa a URL ("não retornou uma resposta válida") se a resposta não for 2xx, então o
 * Worker responde 200 `{"resultado":"teste"}` sem gravar nada (RIFA-060). Não é um evento de pedido: fica fora de
 * EVENTOS_RIFEI.
 */
export const EVENTO_TESTE_RIFEI = "test";

/** O corpo é o evento de teste da Rifei? Só o `event` exato conta; o resto do corpo não é lido. */
export function ehEventoDeTesteRifei(corpo: unknown): boolean {
  return (
    typeof corpo === "object" &&
    corpo !== null &&
    !Array.isArray(corpo) &&
    (corpo as Record<string, unknown>)["event"] === EVENTO_TESTE_RIFEI
  );
}

/**
 * Valores de `status` citados na doc oficial. O schema aceita qualquer texto porque o valor num
 * `expired_order` não é documentado (SUPOSIÇÃO). O estado do pedido vem do `event` (D4), não daqui.
 */
export const STATUS_RIFEI_DOCUMENTADOS = ["in_process", "approved"] as const;

/** Instante ISO 8601 com fuso, como a Rifei manda (ex.: 2024-08-23T11:28:45.035-03:00). */
export const instanteRifeiSchema = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------------------------------
// Limites (RIFA-002b). Acima deles o valor não cabe no banco ou é absurdo: os essenciais são recusados
// (400) com mensagem clara; os informativos viram null com aviso. Assim nunca há 500 na gravação.
// ---------------------------------------------------------------------------------------------------

/** Teto de valor por pedido, em reais: R$ 10.000.000,00. */
export const LIMITE_REAIS = 10_000_000;
/** Teto de bilhetes por pedido (`numbers_count`). */
export const LIMITE_BILHETES = 1_000_000;
/** Máximo de números de bilhete guardados (`numbers`, `lucky_numbers`); acima disso fica null. */
export const LIMITE_NUMEROS_GUARDADOS = 10_000;

const idPedidoRifeiSchema = z.string().min(1).max(128);
const slugRifeiSchema = z.string().min(1).max(200);
const numerosBilhetesSchema = z
  .array(z.number().int().nonnegative())
  .max(LIMITE_NUMEROS_GUARDADOS, {
    message: `Mais de ${LIMITE_NUMEROS_GUARDADOS} números de bilhete: não são guardados`,
  });
const reaisSchema = z
  .number()
  .nonnegative()
  .max(LIMITE_REAIS, { message: "Valor acima do limite de R$ 10.000.000,00" });
const qtdBilhetesSchema = z.number().int().nonnegative().max(LIMITE_BILHETES, {
  message: "Quantidade de bilhetes acima do limite de 1.000.000",
});
/** id do afiliado: inteiro positivo (afiliados.affiliate_id > 0). */
const affiliateIdRifeiSchema = z.number().int().positive();
/** Textos curtos que são guardados (status, método, utm…): o limite segura o tamanho da linha no D1. */
const textoGuardado = (maximo: number) => z.string().max(maximo);
const upsellsSchema = z.array(textoGuardado(200)).max(50);

/** Campo que a doc marca como `null/string`: aceita null e também a ausência do campo (vira null). */
const textoAnulavel = () => z.string().nullable().default(null);

// ---------------------------------------------------------------------------------------------------
// Centavos (D2) por aritmética decimal exata, nunca por float: "1.005" não vira 100 em silêncio.
// Fração de centavo é arredondada meio para cima (1.005 → 101 centavos) e gera aviso.
// ---------------------------------------------------------------------------------------------------

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** Centavos de um decimal em texto ("19.90" → 1990), com fração de centavo arredondada meio para cima. */
export function textoDecimalParaCentavos(texto: string): number | null {
  const partes = DECIMAL.exec(texto.trim());
  if (!partes) return null;
  const fracao = partes[2] ?? "";
  const centavos =
    Number(partes[1]) * 100 + Number(fracao.slice(0, 2).padEnd(2, "0"));
  return (fracao[2] ?? "0") >= "5" ? centavos + 1 : centavos;
}

/** Se o valor (número ou texto decimal) tem fração de centavo: mais de duas casas não nulas. */
export function temFracaoDeCentavo(valor: unknown): boolean {
  const texto =
    typeof valor === "number"
      ? String(Math.abs(valor))
      : typeof valor === "string"
        ? valor.trim()
        : "";
  const fracao = DECIMAL.exec(texto)?.[2] ?? "";
  return /[1-9]/.test(fracao.slice(2));
}

/**
 * D2: reais para centavos (inteiro), exato. Usa os dígitos decimais do número (`String(1.005)` é
 * "1.005", o que veio no JSON), não `valor * 100` em ponto flutuante. Fração de centavo: meio para cima.
 */
export function reaisParaCentavos(reais: number): number {
  const absoluto = Math.abs(reais);
  const centavos =
    textoDecimalParaCentavos(String(absoluto)) ?? Math.round(absoluto * 100);
  return reais < 0 ? -centavos : centavos;
}

// ---------------------------------------------------------------------------------------------------
// Dois schemas para o mesmo payload (RIFA-002b). A Rifei não reenvia avisos: um 400 ou um 500 é uma
// venda perdida. Por isso:
// - payloadRifeiDocSchema é FIEL à documentação (mais os limites acima) e não decide nada: as
//   diferenças viram AVISOS;
// - payloadRifeiSchema é TOLERANTE: só recusa quando falta o que torna o pedido gravável.
// O handler usa analisarPayloadRifei(corpo), que aplica os dois. O payload bruto só existe na memória
// da requisição e nunca é gravado (D1).
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

const utmTextoDoc = () => textoGuardado(500).nullable().default(null);

export const utmRifeiSchema = z.object({
  source: utmTextoDoc(),
  campaign: utmTextoDoc(),
  medium: utmTextoDoc(),
  content: utmTextoDoc(),
  term: utmTextoDoc(),
});

/**
 * Payload como a documentação descreve (mais os limites de armazenamento): tipos da doc; todo campo
 * `null/...` aceita null ou ausência (vira null); campos desconhecidos são descartados. Serve só para
 * gerar os avisos de analisarPayloadRifei.
 */
export const payloadRifeiDocSchema = z.object({
  event: eventoRifeiSchema,
  id: idPedidoRifeiSchema,
  slug: slugRifeiSchema.refine((slug) => slug.trim() === slug, {
    message: "slug com espaços nas pontas",
  }),
  is_rifinha: z.boolean(),
  buyer: compradorRifeiSchema,
  numbers: numerosBilhetesSchema.nullable().default(null),
  numbers_count: qtdBilhetesSchema,
  lucky_numbers: numerosBilhetesSchema.nullable().default(null),
  subtotal: reaisSchema,
  total: reaisSchema,
  promotion_discount: reaisSchema.nullable().default(null),
  coupon_discount: reaisSchema.nullable().default(null),
  payment_method: textoGuardado(100),
  status: textoGuardado(100).min(1),
  status_detail: textoGuardado(100),
  coupon_id: z.number().int().nullable().default(null),
  affiliate_id: affiliateIdRifeiSchema.nullable().default(null),
  created_at: instanteRifeiSchema,
  expires_at: instanteRifeiSchema,
  approved_at: instanteRifeiSchema.nullable().default(null),
  /** Ausente no exemplo oficial: ausência vira null. */
  expired_at: instanteRifeiSchema.nullable().default(null),
  upsells: upsellsSchema,
  observation: textoAnulavel(),
  /** Ausentes no exemplo oficial: ausência vira null. */
  fbp: textoAnulavel(),
  fbc: textoAnulavel(),
  /** SUPOSIÇÃO: `utm` ausente ou null é tolerado e vira o objeto com tudo null. */
  utm: utmRifeiSchema.nullish().transform((utm) => utm ?? { ...UTM_VAZIO }),
});

/** Formato que a documentação descreve (campos `null/...` podem faltar). */
export type PayloadRifeiEntrada = z.input<typeof payloadRifeiDocSchema>;

// Tolerantes: ausente ou com tipo errado vira null (e a diferença aparece nos avisos).
const textoOuNulo = z.string().nullable().catch(null);
const textoGuardadoOuNulo = (maximo: number) =>
  textoGuardado(maximo).nullable().catch(null);
const instanteOuNulo = instanteRifeiSchema.nullable().catch(null);
const numerosOuNulo = numerosBilhetesSchema.nullable().catch(null);

/** Número, ou texto decimal com ponto ("19.90"), convertido em centavos exatos. Vírgula decimal não. */
const reaisCoercivelSchema = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(DECIMAL)
      .transform(
        (texto) => (textoDecimalParaCentavos(texto) ?? Number.NaN) / 100,
      ),
  ])
  .pipe(reaisSchema);

/** Inteiro ≥ 0, ou texto de inteiro ("12", "12.0"). */
const qtdBilhetesCoercivelSchema = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d+(\.0+)?$/)
      .transform(Number),
  ])
  .pipe(qtdBilhetesSchema);

/** Inteiro positivo, ou texto só com dígitos ("1042"). */
const affiliateIdCoercivelSchema = z
  .union([z.number(), z.string().trim().regex(/^\d+$/).transform(Number)])
  .pipe(affiliateIdRifeiSchema);

/** Texto, ou inteiro seguro convertido em texto (12345 → "12345"). */
const idPedidoCoercivelSchema = z
  .union([z.string(), z.number().int().transform(String)])
  .pipe(idPedidoRifeiSchema);

const COMPRADOR_VAZIO = {
  name: null,
  phone: null,
  email: null,
  document: null,
  date_of_birth: null,
  address: null,
} as const;

/**
 * Payload aceito pelo webhook. Recusa (400) só quando falta o que torna o pedido gravável:
 * - `event` reconhecido;
 * - `id`: texto de 1 a 128 caracteres, ou inteiro seguro (vira texto, com aviso);
 * - `slug`: texto não vazio (espaços nas pontas são removidos, com aviso);
 * - `numbers_count`: inteiro de 0 a 1.000.000, ou texto de inteiro ("12", "12.0");
 * - `total`: número de 0 a R$ 10.000.000,00, ou texto decimal com ponto ("19.90").
 * O resto vira null quando ausente, com tipo errado ou acima dos limites:
 * - descartados na redação: todo o `buyer` (o `phone` só para derivar ddd/pais), observation, fbp, fbc;
 * - informativos: is_rifinha, status, status_detail, payment_method, expires_at, expired_at, upsells,
 *   numbers, lucky_numbers, subtotal, descontos, coupon_id e utm.*;
 * - affiliate_id: inteiro positivo, ou texto só com dígitos; outro valor vira null (venda "sem afiliado");
 * - created_at e approved_at inválidos viram null (pedidos.criado_em fica NULL; um pedido aprovado sem
 *   approved_at usa a hora do recebimento em aprovado_em).
 */
export const payloadRifeiSchema = z.object({
  event: eventoRifeiSchema,
  /** Identificador único do pedido na Rifei: chave primária de `pedidos` (D3). */
  id: idPedidoCoercivelSchema,
  /** Identificador da campanha. O webhook é da CONTA: slug diferente do configurado é ignorado (D5). */
  slug: z.string().trim().pipe(slugRifeiSchema),
  /** Quantidade de bilhetes: base das metas em bilhetes. */
  numbers_count: qtdBilhetesCoercivelSchema,
  /** Reais, depois dos descontos: é o valor arrecadado (centavos exatos com reaisParaCentavos, D2). */
  total: reaisCoercivelSchema,
  is_rifinha: z.boolean().nullable().catch(null),
  buyer: z
    .object({
      name: textoOuNulo,
      phone: textoOuNulo,
      email: textoOuNulo,
      document: textoOuNulo,
      date_of_birth: textoOuNulo,
      address: enderecoRifeiSchema.nullable().catch(null),
    })
    .catch(() => ({ ...COMPRADOR_VAZIO })),
  numbers: numerosOuNulo,
  lucky_numbers: numerosOuNulo,
  subtotal: reaisCoercivelSchema.nullable().catch(null),
  promotion_discount: reaisCoercivelSchema.nullable().catch(null),
  coupon_discount: reaisCoercivelSchema.nullable().catch(null),
  payment_method: textoGuardadoOuNulo(100),
  status: textoGuardado(100).min(1).nullable().catch(null),
  status_detail: textoGuardadoOuNulo(100),
  coupon_id: z.number().int().nullable().catch(null),
  /** Afiliado (líder de célula) que fez a venda; null = venda sem afiliado (D7). */
  affiliate_id: affiliateIdCoercivelSchema.nullable().catch(null),
  created_at: instanteOuNulo,
  expires_at: instanteOuNulo,
  approved_at: instanteOuNulo,
  expired_at: instanteOuNulo,
  upsells: upsellsSchema.nullable().catch(null),
  observation: textoOuNulo,
  fbp: textoOuNulo,
  fbc: textoOuNulo,
  utm: z
    .object({
      source: textoGuardadoOuNulo(500),
      campaign: textoGuardadoOuNulo(500),
      medium: textoGuardadoOuNulo(500),
      content: textoGuardadoOuNulo(500),
      term: textoGuardadoOuNulo(500),
    })
    .catch(() => ({ ...UTM_VAZIO })),
});

/** Payload aceito (saída do schema tolerante): o que o processamento recebe antes da redação. */
export type PayloadRifei = z.infer<typeof payloadRifeiSchema>;

/**
 * Diferença do payload aceito em relação à doc, agrupada por caminho sem índices: 5.000 bilhetes em
 * texto viram UM aviso `["numbers", "*"]` com `ocorrencias: 5000` (formato `DetalheResumido`).
 */
export type AvisoPayloadRifei = DetalheResumido;

/** O que gravar em webhook_eventos.avisos: null quando não há aviso (a coluna nunca guarda `[]`). */
export function avisosParaGravar(
  avisos: readonly AvisoPayloadRifei[],
): AvisoPayloadRifei[] | null {
  return avisos.length === 0 ? null : [...avisos];
}

const CAMPOS_EM_REAIS = [
  "subtotal",
  "total",
  "promotion_discount",
  "coupon_discount",
] as const;

export type AnalisePayloadRifei =
  | { aceito: true; payload: PayloadRifei; avisos: AvisoPayloadRifei[] }
  | { aceito: false; problemas: DetalheResumido[] };

/**
 * Decide se a entrega é gravável e lista os avisos. É o que o handler do webhook deve usar (validar
 * só com payloadRifeiSchema perde os avisos).
 * - Recusada: `problemas` (só dos essenciais; agrupados e limitados como os avisos) vai para o evento
 *   `erro_validacao` (400).
 * - Aceita: `payload` segue para a redação; `avisos` (agrupados e limitados; vazio quando o payload
 *   segue a doc) vai para webhook_eventos.avisos com avisosParaGravar (null se vazio).
 */
export function analisarPayloadRifei(corpo: unknown): AnalisePayloadRifei {
  const tolerante = payloadRifeiSchema.safeParse(corpo);
  if (!tolerante.success) {
    return {
      aceito: false,
      problemas: resumirDetalhes(detalhesDeValidacao(tolerante.error)),
    };
  }
  const fiel = payloadRifeiDocSchema.safeParse(corpo);
  const detalhes = fiel.success ? [] : detalhesDeValidacao(fiel.error);
  const objeto = corpo as Record<string, unknown>;
  for (const campo of CAMPOS_EM_REAIS) {
    if (temFracaoDeCentavo(objeto[campo])) {
      detalhes.push({
        caminho: [campo],
        codigo: "fracao_de_centavo",
        mensagem: "Fração de centavo arredondada meio para cima",
      });
    }
  }
  return {
    aceito: true,
    payload: tolerante.data,
    avisos: resumirDetalhes(detalhes),
  };
}

// ---------------------------------------------------------------------------------------------------
// Payload REDIGIDO (D1): é o único formato gravado (webhook_eventos.payload_redigido) e o único que o
// processamento lê. Montado por lista de permissão: tudo o que não está aqui é descartado.
// ---------------------------------------------------------------------------------------------------

/**
 * Caminhos do payload bruto que NUNCA entram no payload redigido (D1), o que a trilha guarda. Do `buyer` sobram só
 * ddd e pais, derivados do telefone. RIFA-076 (D36): `buyer.name` e `buyer.phone` vão SÓ para as colunas do pedido
 * (extrairContatoComprador), nunca para a trilha.
 */
export const CAMPOS_DESCARTADOS_NA_REDACAO = [
  "buyer.name",
  "buyer.phone",
  "buyer.email",
  "buyer.document",
  "buyer.date_of_birth",
  "buyer.address",
  "observation",
  "fbp",
  "fbc",
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
  is_rifinha: z.boolean().nullable(),
  /** Substitui `buyer`: só DDD e código do país, derivados de `buyer.phone`. */
  comprador: telefoneRedigidoSchema,
  numbers: numerosBilhetesSchema.nullable(),
  numbers_count: qtdBilhetesSchema,
  lucky_numbers: numerosBilhetesSchema.nullable(),
  subtotal: reaisSchema.nullable(),
  total: reaisSchema,
  promotion_discount: reaisSchema.nullable(),
  coupon_discount: reaisSchema.nullable(),
  payment_method: textoGuardado(100).nullable(),
  status: textoGuardado(100).min(1).nullable(),
  status_detail: textoGuardado(100).nullable(),
  coupon_id: z.number().int().nullable(),
  affiliate_id: affiliateIdRifeiSchema.nullable(),
  created_at: instanteRifeiSchema.nullable(),
  expires_at: instanteRifeiSchema.nullable(),
  approved_at: instanteRifeiSchema.nullable(),
  expired_at: instanteRifeiSchema.nullable(),
  upsells: upsellsSchema.nullable(),
  utm: z.strictObject({
    source: textoGuardado(500).nullable(),
    campaign: textoGuardado(500).nullable(),
    medium: textoGuardado(500).nullable(),
    content: textoGuardado(500).nullable(),
    term: textoGuardado(500).nullable(),
  }),
});
export type PayloadRifeiRedigido = z.infer<typeof payloadRifeiRedigidoSchema>;

/** Códigos de país (E.164) com 1 e 2 dígitos. Os demais têm 3 (os códigos não são prefixo uns dos outros). */
const DDI_COM_1_DIGITO = new Set(["1", "7"]);
const DDI_COM_2_DIGITOS = new Set(
  [
    "20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49",
    "51 52 53 54 55 56 57 58 60 61 62 63 64 65 66",
    "81 82 84 86 90 91 92 93 94 95 98",
  ]
    .join(" ")
    .split(" "),
);

/**
 * Deriva DDD e código do país de um telefone E.164 (D1). Espaços, parênteses, pontos e hífens são
 * ignorados. Sem "+" inicial ou fora do E.164: tudo null. DDD só para o Brasil (+55) com número de
 * 10 ou 11 dígitos depois do país.
 */
export function derivarTelefone(
  telefone: string | null | undefined,
): TelefoneRedigido {
  const vazio: TelefoneRedigido = { ddd: null, pais: null };
  if (!telefone) return vazio;
  const digitos = /^\+([1-9]\d{6,14})$/.exec(
    telefone.replace(/[\s().-]/g, ""),
  )?.[1];
  if (digitos === undefined) return vazio;
  const pais = DDI_COM_1_DIGITO.has(digitos.slice(0, 1))
    ? digitos.slice(0, 1)
    : DDI_COM_2_DIGITOS.has(digitos.slice(0, 2))
      ? digitos.slice(0, 2)
      : digitos.slice(0, 3);
  if (pais !== "55") return { ddd: null, pais };
  const nacional = digitos.slice(2);
  return /^[1-9]{2}\d{8,9}$/.test(nacional)
    ? { ddd: nacional.slice(0, 2), pais }
    : { ddd: null, pais };
}

/**
 * D1: monta o payload redigido campo a campo (lista de permissão). Nada do `buyer` além de ddd/pais,
 * e nada de observation, fbp ou fbc.
 */
export function redigirPayloadRifei(
  payload: PayloadRifei,
): PayloadRifeiRedigido {
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

// ---------------------------------------------------------------------------------------------------
// Contato de quem reservou ou comprou (RIFA-076, D36): o nome e o telefone (E.164), gravados SÓ nas colunas
// pedidos.comprador_nome e pedidos.comprador_telefone e mostrados SÓ ao admin. Ficam fora do payload redigido
// (a trilha, webhook_eventos.payload_redigido, continua sem nome e sem telefone). E-mail, documento, nascimento e
// endereço continuam descartados (D1).
// ---------------------------------------------------------------------------------------------------

/** Tamanho máximo do nome do comprador gravado (CHECK da migração 0017); o resto é cortado. */
export const LIMITE_NOME_COMPRADOR = 120;

/** Telefone E.164: "+", o país e o número, de 7 a 15 algarismos no total (o CHECK da migração 0017 aceita de 8 a 16 caracteres com o "+"). */
export const TELEFONE_E164 = /^\+[1-9]\d{6,14}$/;

export interface ContatoComprador {
  /** Sem espaços nas pontas nem repetidos; null se ausente ou vazio. */
  nome: string | null;
  /** E.164 (+5591988887777); null se ausente ou fora do formato. */
  telefone: string | null;
}

/** O nome como fica gravado: espaços juntados, no máximo LIMITE_NOME_COMPRADOR caracteres; vazio vira null. */
export function normalizarNomeComprador(
  nome: string | null | undefined,
): string | null {
  if (typeof nome !== "string") return null;
  // Tira os caracteres de controle (quebra de linha, tab) antes de juntar os espaços.
  const limpo = [...nome]
    .map((letra) => {
      const codigo = letra.charCodeAt(0);
      return codigo < 0x20 || codigo === 0x7f ? " " : letra;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (limpo === "") return null;
  const cortado = [...limpo].slice(0, LIMITE_NOME_COMPRADOR).join("").trim();
  return cortado === "" ? null : cortado;
}

/**
 * O telefone em E.164, como a Rifei manda ("+55 (91) 98888-7777" vira "+5591988887777"). Espaços, parênteses,
 * pontos e hífens são ignorados (a mesma regra de derivarTelefone); sem "+" ou fora do E.164: null.
 */
export function normalizarTelefoneE164(
  telefone: string | null | undefined,
): string | null {
  if (typeof telefone !== "string") return null;
  const compacto = telefone.replace(/[\s().-]/g, "");
  return TELEFONE_E164.test(compacto) ? compacto : null;
}

/** RIFA-076 (D36): o nome e o telefone do `buyer`, para as colunas do pedido (nunca para a trilha). */
export function extrairContatoComprador(
  payload: Pick<PayloadRifei, "buyer">,
): ContatoComprador {
  return {
    nome: normalizarNomeComprador(payload.buyer.name),
    telefone: normalizarTelefoneE164(payload.buyer.phone),
  };
}

/** O que dá para gravar de um payload recusado (D9): só event, id e slug. */
export interface IdentificacaoPayloadInvalido {
  evento: string | null;
  pedido_id: string | null;
  slug: string | null;
}

/**
 * Extrai event, id e slug de um corpo recusado para o registro `erro_validacao`. Nenhum outro campo é
 * lido, então nada pessoal é gravado. `id` inteiro vira texto; textos maiores que os limites da tabela
 * são cortados.
 */
export function identificarPayloadInvalido(
  corpo: unknown,
): IdentificacaoPayloadInvalido {
  const objeto =
    typeof corpo === "object" && corpo !== null
      ? (corpo as Record<string, unknown>)
      : {};
  const texto = (valor: unknown, limite: number): string | null =>
    typeof valor === "string" && valor.length > 0
      ? valor.slice(0, limite)
      : null;
  const id = objeto["id"];
  return {
    evento: texto(objeto["event"], 64),
    pedido_id: texto(Number.isSafeInteger(id) ? String(id) : id, 128),
    slug: texto(objeto["slug"], 200),
  };
}
