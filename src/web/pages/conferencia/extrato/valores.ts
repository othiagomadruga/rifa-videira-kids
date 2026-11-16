// Valores e datas do extrato do banco (RIFA-059), lidos de um campo (o TRNAMT do OFX, uma célula do CSV) ou de uma
// linha de texto colado. Tolerante: "R$ 1.234,56", "1234.56", "-20,00", "20,00-", "20,00 D", "(20,00)", "− R$ 9,90".
import {
  INVALIDO,
  VAZIO,
  lerCentavos,
} from "../../../../shared/conferencia/valores";
import type { Relogio } from "./lancamentos";

/** Sinais que os bancos e os sites usam no lugar do hífen (menos, travessões). */
const MENOS_TIPOGRAFICO = /[\u2212\u2012\u2013\u2014\ufe63\uff0d]/g;
/** Espaços, inclusive os não separáveis. */
const ESPACOS = /[\s\u00a0\u202f]+/g;

/** Troca os sinais tipográficos de menos por "-" e os espaços especiais por espaço comum. */
export function limparSinais(texto: string): string {
  return texto.replace(MENOS_TIPOGRAFICO, "-").replace(/[\u00a0\u202f]/g, " ");
}

/**
 * Um valor com sinal, em centavos (positivo = crédito), de um campo só: "-50.00", "+20,00", "R$ 1.234,56",
 * "20,00 D", "20,00 C", "20,00-", "(20,00)". null quando o campo está vazio ou não é um valor.
 */
export function lerValorComSinal(texto: string): number | null {
  let resto = limparSinais(texto).replace(ESPACOS, "").toUpperCase();
  let negativo = false;
  if (/^\(.*\)$/.test(resto)) {
    negativo = true;
    resto = resto.slice(1, -1);
  }
  if (/\d[CD]$/.test(resto)) {
    negativo = negativo || resto.endsWith("D");
    resto = resto.slice(0, -1);
  }
  if (/\d-$/.test(resto)) {
    negativo = true;
    resto = resto.slice(0, -1);
  }
  // Sinal e "R$" no começo, em qualquer ordem: "-R$20,00", "R$-20,00", "+R$20,00".
  for (let volta = 0; volta < 3; volta++) {
    resto = resto.replace(/^(?:R\$|BRL)/, "");
    if (resto.startsWith("-")) negativo = true;
    if (resto.startsWith("-") || resto.startsWith("+")) resto = resto.slice(1);
  }
  const centavos = lerCentavos(resto);
  if (centavos === VAZIO || centavos === INVALIDO) return null;
  return negativo ? -centavos : centavos;
}

// ---------------------------------------------------------------------------------------------------
// Datas e horas num texto ("16/11/2026", "16/11/26", "16/11", "2026-11-16", "16 nov 2026", "16 de novembro")
// ---------------------------------------------------------------------------------------------------

export interface DataNoTexto {
  ano: number;
  mes: number;
  dia: number;
  /** Onde a data está no texto (para tirá-la da descrição). */
  inicio: number;
  fim: number;
}

const MESES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
/** O mês escrito: o nome inteiro ou a abreviação de 3 letras (nunca o começo de um nome: "2 MARCOS" não é março). */
const NOME_DO_MES =
  "janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez";

const DATA_ISO = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;
/** 16/11/2026, 16/11/26, 16/11 e 16-11-2026 (com hífen, só com o ano). */
const DATA_BR =
  /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])|(?<![\d-])(\d{1,2})-(\d{1,2})-(\d{4})(?![\d-])/;
/** 16 nov 2026, 16 de novembro de 2026, 16 NOV, 16/nov/2026. */
const DATA_POR_EXTENSO = new RegExp(
  `(?<![\\p{L}\\d])(\\d{1,2})\\s*(?:de\\s+|/|-)?\\s*(${NOME_DO_MES})\\.?(?![\\p{L}])(?:\\s*(?:de\\s+|/|-)?\\s*(\\d{4})(?!\\d))?`,
  "iu",
);

/**
 * O ano que falta ("16/11"): o deste ano, ou o do ano passado se a data cairia mais de um dia depois de hoje
 * (um extrato de dezembro lido em janeiro).
 */
function anoProvavel(mes: number, dia: number, hoje: string): number {
  const ano = Number(hoje.slice(0, 4));
  const texto = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const diferenca =
    Date.parse(`${texto}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`);
  return diferenca > 86_400_000 ? ano - 1 : ano;
}

const anoDe = (
  texto: string | undefined,
  mes: number,
  dia: number,
  hoje: string,
) =>
  texto === undefined
    ? anoProvavel(mes, dia, hoje)
    : texto.length === 2
      ? 2000 + Number(texto)
      : Number(texto);

/** A primeira data do texto (a mais à esquerda), ou null. "Hoje" e "Ontem" valem como data. */
export function acharData(texto: string, hoje: string): DataNoTexto | null {
  const achados: DataNoTexto[] = [];
  const iso = DATA_ISO.exec(texto);
  if (iso)
    achados.push({
      ano: Number(iso[1]),
      mes: Number(iso[2]),
      dia: Number(iso[3]),
      inicio: iso.index,
      fim: iso.index + iso[0].length,
    });
  const br = DATA_BR.exec(texto);
  if (br) {
    const [dia, mes, ano] =
      br[1] !== undefined ? [br[1], br[2], br[3]] : [br[4], br[5], br[6]];
    achados.push({
      ano: anoDe(ano, Number(mes), Number(dia), hoje),
      mes: Number(mes),
      dia: Number(dia),
      inicio: br.index,
      fim: br.index + br[0].length,
    });
  }
  const extenso = DATA_POR_EXTENSO.exec(texto);
  if (extenso) {
    const mes =
      MESES.indexOf(extenso[2].toLowerCase().replace("ç", "c").slice(0, 3)) + 1;
    achados.push({
      ano: anoDe(extenso[3], mes, Number(extenso[1]), hoje),
      mes,
      dia: Number(extenso[1]),
      inicio: extenso.index,
      fim: extenso.index + extenso[0].length,
    });
  }
  const relativo = /(?<![\p{L}])(hoje|ontem)(?![\p{L}])/iu.exec(texto);
  if (relativo) {
    const base =
      Date.parse(`${hoje}T12:00:00Z`) -
      (relativo[1].toLowerCase() === "ontem" ? 86_400_000 : 0);
    const dia = new Date(base).toISOString().slice(0, 10);
    achados.push({
      ano: Number(dia.slice(0, 4)),
      mes: Number(dia.slice(5, 7)),
      dia: Number(dia.slice(8, 10)),
      inicio: relativo.index,
      fim: relativo.index + relativo[0].length,
    });
  }
  const validos = achados.filter(
    (achado) =>
      achado.mes >= 1 &&
      achado.mes <= 12 &&
      achado.dia >= 1 &&
      achado.dia <= 31,
  );
  validos.sort((a, b) => a.inicio - b.inicio);
  return validos[0] ?? null;
}

export interface HoraNoTexto {
  h: number;
  m: number;
  s: number;
  inicio: number;
  fim: number;
}

const HORA =
  /(?<![\d:,.])([01]?\d|2[0-3])(?::|h)([0-5]\d)(?::([0-5]\d))?(?![\d:])/i;

/** A primeira hora do texto ("10:05", "10:05:33", "10h05"), ou null. */
export function acharHora(texto: string): HoraNoTexto | null {
  const achado = HORA.exec(texto);
  if (!achado) return null;
  return {
    h: Number(achado[1]),
    m: Number(achado[2]),
    s: Number(achado[3] ?? 0),
    inicio: achado.index,
    fim: achado.index + achado[0].length,
  };
}

/** Data (e hora, se houver) de um campo só, no fuso da campanha: "16/11/2026 10:05", "2026-11-16T10:05:00-03:00". */
export function lerDataDoCampo(
  texto: string,
  relogio: Relogio,
): { dia: string; instante: number | null } | null {
  const limpo = texto.trim();
  // ISO com fuso: o instante exato.
  const comFuso =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.exec(
      limpo,
    );
  if (comFuso) {
    const instante = Date.parse(limpo.replace(" ", "T"));
    return Number.isNaN(instante)
      ? null
      : { dia: relogio.diaDoInstante(instante), instante };
  }
  const data = acharData(limpo, relogio.hoje);
  if (!data) return null;
  const hora = acharHora(
    limpo.slice(0, data.inicio) + " " + limpo.slice(data.fim),
  );
  return relogio.local(data.ano, data.mes, data.dia, hora ?? undefined);
}
