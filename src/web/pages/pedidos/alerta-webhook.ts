// Alerta de webhook parado (RIFA-025, D16): GET /api/admin/webhook/estado e os textos do aviso, por situação.
// Fica fora do pacote da tela Pedidos porque aparece também no topo da Visão geral.
//
// Do contrato vêm só os TIPOS (os valores poriam o zod no pacote do site). O caminho, as situações e as
// constantes da janela do alerta são cópias, conferidas pelo tipo e por pedidos-contrato.test.ts.
import type {
  RespostaEstadoWebhook,
  ResultadoEventoWebhook,
} from "../../../shared/contracts";
import type { ROTAS } from "../../../shared/contracts/api";
import { api } from "../../lib/api";
import { formatarHora } from "../../lib/formatadores";

export const CAMINHO_ESTADO_WEBHOOK: (typeof ROTAS)["estadoWebhook"]["caminho"] =
  "/api/admin/webhook/estado";

/** SITUACOES_WEBHOOK do contrato, na ordem de prioridade. */
export const SITUACOES_WEBHOOK = [
  "erros_recentes",
  "sem_entregas_recentes",
  "nunca_recebeu",
  "ok",
] as const satisfies readonly RespostaEstadoWebhook["situacao"][];

/** HORAS_SEM_ENTREGA_ALERTA do contrato: horas de dia sem venda que acendem o alerta. */
export const HORAS_SEM_ENTREGA_ALERTA = 4;
/** HORA_INICIO_ALERTA e HORA_FIM_ALERTA do contrato: a janela do dia (hora local) em que o alerta conta. */
export const HORA_INICIO_ALERTA = 8;
export const HORA_FIM_ALERTA = 22;

/** De quanto em quanto tempo o estado é consultado de novo, com a aba visível. */
export const INTERVALO_ESTADO_MS = 5 * 60_000;

/** A aba das entregas na tela Pedidos (`?aba=entregas`) e o filtro de resultado (`&resultado=`). */
export const PARAM_ABA = "aba";
export const ABA_ENTREGAS = "entregas";
export const CAMINHO_TELA_PEDIDOS = "/coordenacao/pedidos";
export const CAMINHO_CONFERENCIA = "/coordenacao/conferencia";

/**
 * As entregas da tela Pedidos com este resultado. Com `atuais` (a consulta da tela Pedidos aberta), troca só a aba e
 * o resultado e mantém o resto: os filtros dos pedidos não mudam, e a primeira página deles (cara, por causa dos
 * totais) não é pedida de novo.
 */
export function linkDasEntregas(
  resultado: ResultadoEventoWebhook,
  atuais: URLSearchParams | null = null,
): string {
  const params = new URLSearchParams(atuais ?? undefined);
  params.set(PARAM_ABA, ABA_ENTREGAS);
  params.set("resultado", resultado);
  return `${CAMINHO_TELA_PEDIDOS}?${params.toString()}`;
}

/** O estado, se a resposta tem uma situação que o site conhece (o tipo de api.get não é conferido). */
export async function carregarEstadoWebhook(
  opcoes: { signal?: AbortSignal } = {},
): Promise<RespostaEstadoWebhook> {
  const estado = await api.get<RespostaEstadoWebhook>(
    CAMINHO_ESTADO_WEBHOOK,
    opcoes,
  );
  if (
    !(SITUACOES_WEBHOOK as readonly unknown[]).includes(estado?.situacao) ||
    typeof estado.ultimas_24h !== "object" ||
    estado.ultimas_24h === null
  ) {
    throw new TypeError("Resposta do estado do webhook fora do formato.");
  }
  return estado;
}

const MINUTO_MS = 60_000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;

const plural = (quantidade: number, um: string, varios: string) =>
  `${quantidade} ${quantidade === 1 ? um : varios}`;

/** Horas inteiras entre dois instantes ISO (nunca negativas). */
export function horasEntre(de: string, ate: string): number {
  return Math.max(0, Math.floor((Date.parse(ate) - Date.parse(de)) / HORA_MS));
}

/** "há menos de 1 min", "há 12 min", "há 3 h", "há 2 dias" (de `de` até `ate`). */
export function haQuanto(de: string, ate: string): string {
  const ms = Math.max(0, Date.parse(ate) - Date.parse(de));
  if (ms < MINUTO_MS) return "há menos de 1 min";
  if (ms < HORA_MS) return `há ${Math.floor(ms / MINUTO_MS)} min`;
  if (ms < 2 * DIA_MS) return `há ${Math.floor(ms / HORA_MS)} h`;
  return `há ${plural(Math.floor(ms / DIA_MS), "dia", "dias")}`;
}

/** O que mostrar no topo da tela, por situação (o "ok" é só uma linha discreta, sem aviso). */
export type TextoAlerta =
  | {
      tipo: "aviso";
      tom: "perigo" | "alerta" | "info";
      titulo: string;
      paragrafos: string[];
      /** O próximo passo: as entregas com erro ou a conferência pelo CSV. */
      link: { para: string; texto: string } | null;
    }
  | { tipo: "linha"; texto: string }
  | { tipo: "nada" };

/** Chegou alguma entrega de outra campanha nas 24 h e nada da campanha (processado, duplicado e
 * ignorado_transicao só existem com o slug da campanha): o slug na Rifei pode estar errado. */
export function sugereConferirSlug(estado: RespostaEstadoWebhook): boolean {
  const { processado, duplicado, ignorado_transicao, ignorado_outra_campanha } =
    estado.ultimas_24h;
  return (
    ignorado_outra_campanha > 0 &&
    processado + duplicado + ignorado_transicao === 0
  );
}

const CONFIRA_NA_RIFEI =
  "Confira na Rifei a URL do webhook, o token e o slug da campanha.";

function paragrafoDoSlug(estado: RespostaEstadoWebhook): string[] {
  if (!sugereConferirSlug(estado)) return [];
  const quantos = estado.ultimas_24h.ignorado_outra_campanha;
  return [
    `Nas últimas 24 h, ${plural(quantos, "pedido chegou", "pedidos chegaram")} com o slug de outra campanha: confira se o slug da campanha no sistema é o mesmo da Rifei.`,
  ];
}

/** A hora da consulta (verificado_em), no fuso da campanha: "12:00". */
export function horaDaConferencia(estado: RespostaEstadoWebhook): string {
  return formatarHora(estado.verificado_em);
}

/** O começo da linha discreta do "ok" (RIFA-043): conta qualquer entrega da campanha, não só as vendas. */
export const TEXTO_ULTIMA_ENTREGA = "Última entrega da Rifei";

/**
 * O que mostrar por situação. `naTelaPedidos`: a consulta da tela Pedidos, quando o alerta está nela (o link das
 * entregas com erro mantém os filtros dos pedidos); null na Visão geral.
 */
export function textoDoAlerta(
  estado: RespostaEstadoWebhook,
  naTelaPedidos: URLSearchParams | null = null,
): TextoAlerta {
  switch (estado.situacao) {
    case "erros_recentes": {
      // A contagem das 24 h é de qualquer slug (a situação só olha o slug da campanha ou sem slug).
      const erros = estado.ultimas_24h.erro_validacao;
      return {
        tipo: "aviso",
        tom: "perigo",
        titulo: "A Rifei mandou pedidos com erro nas últimas 24 h",
        paragrafos: [
          `${erros > 0 ? `Nas últimas 24 h, ${plural(erros, "entrega foi recusada", "entregas foram recusadas")} por erro, contando qualquer slug (também de outras campanhas da conta na Rifei). ` : ""}Pedido recusado não é gravado: veja quais foram e confira cada um na Rifei.`,
          ...paragrafoDoSlug(estado),
        ],
        link: {
          para: linkDasEntregas("erro_validacao", naTelaPedidos),
          texto: "Ver as entregas com erro",
        },
      };
    }
    case "sem_entregas_recentes": {
      const titulo =
        estado.ultima_processada_em === null
          ? "Nenhuma venda chegou até agora"
          : `Nenhuma venda chegou há ${plural(horasEntre(estado.ultima_processada_em, estado.verificado_em), "hora", "horas")}`;
      return {
        tipo: "aviso",
        tom: "alerta",
        titulo,
        paragrafos: [
          `${CONFIRA_NA_RIFEI} Se faltar alguma venda, use a conferência pelo CSV da Rifei.`,
          ...paragrafoDoSlug(estado),
        ],
        link: { para: CAMINHO_CONFERENCIA, texto: "Abrir a Conferência" },
      };
    }
    case "nunca_recebeu":
      return {
        tipo: "aviso",
        tom: "info",
        titulo: "Ainda não chegou nenhuma venda",
        paragrafos: [
          `Se a campanha já começou, ${CONFIRA_NA_RIFEI.charAt(0).toLowerCase()}${CONFIRA_NA_RIFEI.slice(1)}`,
          ...paragrafoDoSlug(estado),
        ],
        link: null,
      };
    case "ok":
      // RIFA-043: "entrega", não "venda": `ultima_processada_em` é a última entrega da campanha, de qualquer evento
      // (pedido novo, pago ou expirado; a regra é a da D16 e não mudou).
      return estado.ultima_processada_em === null
        ? { tipo: "nada" }
        : {
            tipo: "linha",
            texto: `${TEXTO_ULTIMA_ENTREGA} ${haQuanto(estado.ultima_processada_em, estado.verificado_em)}; conferido às ${horaDaConferencia(estado)}.`,
          };
  }
}
