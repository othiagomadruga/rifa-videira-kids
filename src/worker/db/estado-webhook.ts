/**
 * Estado do webhook para o alerta da coordenação (RIFA-025, D16; docs/api.md, GET /api/admin/webhook/estado).
 * Só lê. A `situacao` sai de `decidirSituacao`, função pura com a regra da D16, na ordem de prioridade:
 * 1. erros_recentes: algum erro_validacao nas últimas 24 h com slug ausente ou, sem os espaços das pontas (o
 *    mesmo trim do zod que o webhook aplica ao slug aceito), igual ao da campanha ativa;
 * 2. sem_entregas_recentes: a data local (fuso da campanha) está entre data_inicio e data_fim, a hora local está
 *    em [HORA_INICIO_ALERTA, HORA_FIM_ALERTA) e passaram MAIS de HORAS_SEM_ENTREGA_ALERTA horas desde o mais
 *    recente entre a última entrega da campanha e as HORA_INICIO_ALERTA de hoje (sem falso alarme toda manhã);
 * 3. nunca_recebeu: nenhuma entrega da campanha (inclusive sem campanha ativa);
 * 4. ok.
 * "Entrega da campanha" = slug igual ao `slug_rifei` da campanha ativa e resultado processado, duplicado ou
 * ignorado_transicao.
 *
 * Custo (D10): duas idas ao banco, a campanha ativa (buscarCampanhaAtiva) e um db.batch. Os planos ficam
 * travados em db/pedidos-webhook-desempenho.test.ts: a contagem das 24 h usa `resultado IN (...)` (é o que faz o
 * índice webhook_eventos_por_resultado ser percorrido só na janela; sem o IN, o índice inteiro) e as últimas
 * entregas usam `MAX(recebido_em)`, que desce pelo mesmo índice e para na primeira linha de cada resultado (com
 * `ORDER BY recebido_em DESC LIMIT 1`, o planejador ia para o índice da migração 0007 e lia a tabela inteira).
 * Sem campanha ativa, as consultas da campanha nem vão ao banco: com o slug nulo, o MAX percorreria o índice todo.
 */
import {
  HORAS_SEM_ENTREGA_ALERTA,
  HORA_FIM_ALERTA,
  HORA_INICIO_ALERTA,
  RESULTADOS_EVENTO_WEBHOOK,
  calcularCalendario,
  diasEntre,
  hojeNoFuso,
  type RespostaEstadoWebhook,
  type ResultadoEventoWebhook,
} from "../../shared/contracts";
import { buscarCampanhaAtiva } from "./campanha";

const MS_POR_HORA = 3_600_000;
const MS_POR_DIA = 24 * MS_POR_HORA;

/** Resultados de uma "entrega da campanha" (D16), quando o slug é o da campanha ativa. */
export const RESULTADOS_DA_CAMPANHA = [
  "processado",
  "duplicado",
  "ignorado_transicao",
] as const satisfies readonly ResultadoEventoWebhook[];

/**
 * Os espaços que o `trim()` do JavaScript (o do zod, que o webhook aplica ao slug) tira das pontas: o trim do
 * SQLite sem segundo argumento só tira o espaço comum. Passado como o 2º argumento de `trim(slug, ?)`.
 */
export const ESPACOS_DO_TRIM = "\t\n\v\f\r              " + "    　﻿";

const lista = (valores: readonly string[]) =>
  valores.map((valor) => `'${valor}'`).join(", ");

/** Contagem das últimas 24 h por resultado, de qualquer slug (?1 = o instante de 24 h atrás). */
export const CONTAR_ULTIMAS_24H = `SELECT resultado, count(*) AS entregas
  FROM webhook_eventos
  WHERE resultado IN (${lista(RESULTADOS_EVENTO_WEBHOOK)}) AND recebido_em >= ?1
  GROUP BY resultado`;

/** Última entrega autenticada, de qualquer resultado e slug. */
export const ULTIMA_ENTREGA = `SELECT MAX(recebido_em) AS em
  FROM webhook_eventos
  WHERE resultado IN (${lista(RESULTADOS_EVENTO_WEBHOOK)})`;

/** Última entrega da campanha (?1 = slug_rifei da ativa). */
export const ULTIMA_DA_CAMPANHA = `SELECT MAX(recebido_em) AS em
  FROM webhook_eventos
  WHERE resultado IN (${lista(RESULTADOS_DA_CAMPANHA)}) AND slug = ?1`;

/** Aprovação mais recente entre os pedidos da campanha (?1 = id da ativa). */
export const ULTIMO_APROVADO = `SELECT MAX(aprovado_em) AS em
  FROM pedidos
  WHERE status = 'approved' AND campanha_id = ?1`;

/**
 * Algum erro_validacao nas últimas 24 h (?1) com slug ausente ou, sem os espaços das pontas (?2 =
 * ESPACOS_DO_TRIM), igual ao da campanha (?3; NULL sem campanha ativa: só o slug ausente conta). Um slug só de
 * espaços conta como ausente (o webhook grava o slug do corpo recusado como veio, e vazio vira NULL).
 */
export const ERRO_RECENTE = `SELECT EXISTS (
    SELECT 1 FROM webhook_eventos
    WHERE resultado = 'erro_validacao' AND recebido_em >= ?1
      AND (slug IS NULL OR trim(slug, ?2) IN ('', ?3))
  ) AS existe`;

// ---------------------------------------------------------------------------------------------------
// Regra (pura)
// ---------------------------------------------------------------------------------------------------

/** O que a regra precisa da campanha ativa. */
export interface CampanhaDoAlerta {
  fuso_horario: string;
  data_inicio: string;
  data_fim: string;
}

export interface EntradaSituacao {
  agora: Date;
  /** null = sem campanha ativa. */
  campanha: CampanhaDoAlerta | null;
  /** Instante (UTC ISO) da última entrega da campanha; null = nenhuma. */
  ultimaDaCampanha: string | null;
  /** Algum erro_validacao nas últimas 24 h com slug ausente ou o da campanha. */
  erroRecente: boolean;
}

const formatadoresDeHora = new Map<string, Intl.DateTimeFormat>();

/** Hora, minuto, segundo e milissegundo de parede no fuso (0 a 23). */
function relogioDeParede(
  fuso: string,
  agora: Date,
): { hora: number; minuto: number; segundo: number; ms: number } {
  let formatador = formatadoresDeHora.get(fuso);
  if (!formatador) {
    formatador = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatadoresDeHora.set(fuso, formatador);
  }
  const partes = formatador.formatToParts(agora);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((item) => item.type === tipo)?.value ?? Number.NaN);
  return {
    hora: parte("hour"),
    minuto: parte("minute"),
    segundo: parte("second"),
    // Os fusos de hoje têm deslocamento em minutos inteiros: o milissegundo local é o do UTC.
    ms: agora.getUTCMilliseconds(),
  };
}

/**
 * O webhook está há mais de HORAS_SEM_ENTREGA_ALERTA horas sem entrega da campanha, de dia, num dia da campanha?
 * As HORA_INICIO_ALERTA de hoje saem da hora de parede de agora (agora menos o tempo desde aquela hora); vale em
 * todo fuso que não muda o deslocamento entre aquela hora e agora (as mudanças de horário de verão são de
 * madrugada, e o Brasil não tem horário de verão desde 2019).
 */
export function semEntregasRecentes({
  agora,
  campanha,
  ultimaDaCampanha,
}: Omit<EntradaSituacao, "erroRecente">): boolean {
  if (campanha === null) return false;
  const hoje = hojeNoFuso(campanha.fuso_horario, agora);
  if (
    diasEntre(campanha.data_inicio, hoje) < 0 ||
    diasEntre(hoje, campanha.data_fim) < 0
  )
    return false;
  const parede = relogioDeParede(campanha.fuso_horario, agora);
  if (parede.hora < HORA_INICIO_ALERTA || parede.hora >= HORA_FIM_ALERTA)
    return false;
  const desdeOInicio =
    (((parede.hora - HORA_INICIO_ALERTA) * 60 + parede.minuto) * 60 +
      parede.segundo) *
      1000 +
    parede.ms;
  const inicioDoAlerta = agora.getTime() - desdeOInicio;
  const ultima =
    ultimaDaCampanha === null
      ? Number.NEGATIVE_INFINITY
      : Date.parse(ultimaDaCampanha);
  return (
    agora.getTime() - Math.max(ultima, inicioDoAlerta) >
    HORAS_SEM_ENTREGA_ALERTA * MS_POR_HORA
  );
}

/** A `situacao` do estado (D16), na ordem de prioridade de SITUACOES_WEBHOOK. */
export function decidirSituacao(
  entrada: EntradaSituacao,
): RespostaEstadoWebhook["situacao"] {
  if (entrada.erroRecente) return "erros_recentes";
  if (semEntregasRecentes(entrada)) return "sem_entregas_recentes";
  if (entrada.ultimaDaCampanha === null) return "nunca_recebeu";
  return "ok";
}

// ---------------------------------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------------------------------

type Ultimas24h = RespostaEstadoWebhook["ultimas_24h"];

/** O estado no instante `agora` (o relógio da rota, injetável nos testes). */
export async function lerEstadoWebhook(
  db: D1Database,
  agora: Date,
): Promise<RespostaEstadoWebhook> {
  const ativa = await buscarCampanhaAtiva(db);
  const desde = new Date(agora.getTime() - MS_POR_DIA).toISOString();
  const comandos = [
    db.prepare(CONTAR_ULTIMAS_24H).bind(desde),
    db.prepare(ULTIMA_ENTREGA),
    db
      .prepare(ERRO_RECENTE)
      .bind(desde, ESPACOS_DO_TRIM, ativa?.slug_rifei ?? null),
  ];
  if (ativa !== null)
    comandos.push(
      db.prepare(ULTIMA_DA_CAMPANHA).bind(ativa.slug_rifei),
      db.prepare(ULTIMO_APROVADO).bind(ativa.id),
    );
  const [contagem, ultimaEntrega, erroRecente, daCampanha, aprovado] =
    await db.batch(comandos);
  const instante = (resultado: D1Result | undefined) =>
    (resultado?.results[0] as { em: string | null } | undefined)?.em ?? null;

  const ultimas24h = Object.fromEntries(
    RESULTADOS_EVENTO_WEBHOOK.map((resultado) => [resultado, 0]),
  ) as Ultimas24h;
  for (const linha of contagem.results as {
    resultado: ResultadoEventoWebhook;
    entregas: number;
  }[])
    if (linha.resultado in ultimas24h)
      ultimas24h[linha.resultado] = linha.entregas;

  const ultimaDaCampanha = instante(daCampanha);
  const campanha =
    ativa === null
      ? null
      : {
          fuso_horario: ativa.fuso_horario,
          data_inicio: ativa.data_inicio,
          data_fim: calcularCalendario(ativa.data_inicio, ativa.periodos)
            .data_fim,
        };
  return {
    situacao: decidirSituacao({
      agora,
      campanha,
      ultimaDaCampanha,
      erroRecente:
        (erroRecente.results[0] as { existe: number } | undefined)?.existe ===
        1,
    }),
    ultima_entrega_em: instante(ultimaEntrega),
    ultima_processada_em: ultimaDaCampanha,
    ultimo_aprovado_em: instante(aprovado),
    ultimas_24h: ultimas24h,
    verificado_em: agora.toISOString(),
  };
}
