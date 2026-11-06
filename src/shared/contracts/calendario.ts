// Calendário da campanha: datas de cada período, data final, soma e normalização dos percentuais
// e fase.
//
// Regra (docs/modelo-de-dados.md, seções 7.1 e 7.3): os períodos são consecutivos a partir de
// data_inicio, na ordem, e cada um dura `dias` dias; a data final é data_inicio + soma dos
// dias − 1. As datas são do calendário ("YYYY-MM-DD"), sem fuso.
//
// Módulo puro (sem DOM, sem banco e sem zod), parte do contrato: o Worker (src/worker/db/
// campanha.ts) e a tela da campanha usam este mesmo código, para a regra existir num lugar só.
import type { FASES_CAMPANHA } from "./api";

/** antes | durante | encerrada, como no contrato (FASES_CAMPANHA). */
export type FaseCampanha = (typeof FASES_CAMPANHA)[number];

export type DatasPeriodo = { data_inicio: string; data_fim: string };

export type CalendarioCampanha = {
  periodos: DatasPeriodo[];
  /** Último dia de vendas. */
  data_fim: string;
  /** Soma dos dias de todos os períodos. */
  total_dias: number;
};

const MS_POR_DIA = 86_400_000;
const DATA_LOCAL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Dias desde 1970-01-01 de uma data "YYYY-MM-DD"; null se o texto não é uma data que existe. */
export function diaDoCalendario(data: string): number | null {
  const partes = DATA_LOCAL.exec(data);
  if (!partes) return null;
  const [ano, mes, dia] = [
    Number(partes[1]),
    Number(partes[2]),
    Number(partes[3]),
  ];
  const instante = new Date(0);
  instante.setUTCFullYear(ano, mes - 1, dia);
  const existe =
    instante.getUTCFullYear() === ano &&
    instante.getUTCMonth() === mes - 1 &&
    instante.getUTCDate() === dia;
  return existe ? instante.getTime() / MS_POR_DIA : null;
}

function textoDoDia(diasDesde1970: number): string {
  const instante = new Date(diasDesde1970 * MS_POR_DIA);
  const ano = String(instante.getUTCFullYear()).padStart(4, "0");
  const mes = String(instante.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(instante.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function diaOuErro(data: string): number {
  const dia = diaDoCalendario(data);
  if (dia === null) throw new RangeError(`Data inválida: ${data}`);
  return dia;
}

/** "2026-11-23" + 10 → "2026-12-03". Data inválida lança RangeError. */
export function somarDias(data: string, dias: number): string {
  return textoDoDia(diaOuErro(data) + dias);
}

/** Quantos dias vão de `de` até `ate` (negativo se `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  return diaOuErro(ate) - diaOuErro(de);
}

/**
 * Datas de cada período (consecutivos, na ordem) e a data final da campanha.
 * Ex.: 2026-11-23 com 10, 7 e 7 dias → 23/11–02/12, 03/12–09/12, 10/12–16/12; fim 2026-12-16.
 */
export function calcularCalendario(
  dataInicio: string,
  periodos: readonly { dias: number }[],
): CalendarioCampanha {
  const primeiroDia = diaOuErro(dataInicio);
  let inicio = primeiroDia;
  const datas = periodos.map(({ dias }) => {
    const datasDoPeriodo = {
      data_inicio: textoDoDia(inicio),
      data_fim: textoDoDia(inicio + dias - 1),
    };
    inicio += dias;
    return datasDoPeriodo;
  });
  return {
    periodos: datas,
    data_fim: textoDoDia(inicio - 1),
    total_dias: inicio - primeiroDia,
  };
}

/** Soma dos percentuais (pontos-base). Diferente de 10000 = a interface avisa que o cálculo normaliza. */
export function somarPercentuais(
  periodos: readonly { percentual_bp: number }[],
): number {
  return periodos.reduce((soma, periodo) => soma + periodo.percentual_bp, 0);
}

/**
 * Quanto cada período vale depois de normalizar (peso = percentual ÷ soma), em pontos-base
 * arredondados ao décimo de ponto percentual: 3500, 2500 e 4500 → 3330, 2380 e 4290. É para
 * mostrar: o cálculo usa o peso exato, sem arredondar (docs/modelo-de-dados.md, seção 7.3).
 */
export function percentuaisNormalizados(
  percentuais: readonly number[],
): number[] {
  const soma = percentuais.reduce((total, valor) => total + valor, 0);
  if (soma === 0) return percentuais.map(() => 0);
  return percentuais.map((valor) => Math.round((valor * 1000) / soma) * 10);
}

/** Data de hoje ("YYYY-MM-DD") no fuso da campanha. */
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((item) => item.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

/** Fase da campanha numa data: antes do primeiro dia, durante (inclui o primeiro e o último) ou encerrada. */
export function faseDaCampanha(
  hoje: string,
  dataInicio: string,
  dataFim: string,
): FaseCampanha {
  if (diasEntre(dataInicio, hoje) < 0) return "antes";
  if (diasEntre(dataFim, hoje) > 0) return "encerrada";
  return "durante";
}
