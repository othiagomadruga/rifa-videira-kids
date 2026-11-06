// Formatadores pt-BR. Dinheiro chega em centavos (inteiros) e percentuais em
// pontos-base (1% = 100 pontos-base). Datas e horas são mostradas sempre no fuso
// de Belém (America/Belem: UTC-3, sem horário de verão).

export const LOCALIDADE = "pt-BR";
export const FUSO_HORARIO = "America/Belem";

const formatoMoeda = new Intl.NumberFormat(LOCALIDADE, {
  style: "currency",
  currency: "BRL",
});

/**
 * Centavos em reais: 123456 → "R$ 1.234,56" (entre "R$" e o número vai um espaço
 * não separável, U+00A0). Nunca use em telas públicas.
 */
export function formatarMoeda(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) {
    throw new RangeError(`Valor em centavos inválido: ${centavos}`);
  }
  return formatoMoeda.format(centavos / 100);
}

/** 1234567 → "1.234.567"; com casasDecimais fixa as casas: (1234.5, { casasDecimais: 2 }) → "1.234,50". */
export function formatarNumero(
  valor: number,
  opcoes: { casasDecimais?: number } = {},
): string {
  garantirFinito(valor, "Número");
  return formatoNumero(opcoes.casasDecimais).format(valor);
}

/**
 * Pontos-base em percentual: 3500 → "35%"; (1250, { casasDecimais: 1 }) → "12,5%".
 * Trunca em vez de arredondar (9999 → "99%"), para nunca mostrar "100%" antes de
 * a meta ser batida. Com `sinal`, positivos ganham "+": (1200, { sinal: true }) → "+12%".
 */
export function formatarPercentual(
  pontosBase: number,
  opcoes: { casasDecimais?: 0 | 1 | 2; sinal?: boolean } = {},
): string {
  garantirFinito(pontosBase, "Pontos-base");
  const { casasDecimais = 0, sinal = false } = opcoes;
  // Trunca em pontos-base inteiros (sem multiplicar frações, que erram em ponto flutuante).
  const passo = 10 ** (2 - casasDecimais);
  // "+ 0" troca -0 por 0, para não aparecer "-0%".
  const percentual = Math.trunc(pontosBase / passo) / 10 ** casasDecimais + 0;
  return formatoPercentual(casasDecimais, sinal).format(percentual);
}

/** Datas aceitas pelos formatadores de data e hora. */
export type EntradaData = Date | string | number;

const formatoData = new Intl.DateTimeFormat(LOCALIDADE, {
  timeZone: FUSO_HORARIO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const formatoHora = new Intl.DateTimeFormat(LOCALIDADE, {
  timeZone: FUSO_HORARIO,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "23/11/2026" (no fuso de Belém). */
export function formatarData(valor: EntradaData): string {
  return formatoData.format(paraData(valor));
}

/** "19:30" (no fuso de Belém). */
export function formatarHora(valor: EntradaData): string {
  return formatoHora.format(paraData(valor));
}

/** "23/11/2026 19:30" (no fuso de Belém). */
export function formatarDataHora(valor: EntradaData): string {
  const data = paraData(valor);
  return `${formatoData.format(data)} ${formatoHora.format(data)}`;
}

const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const DATA_HORA_SEM_FUSO =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

/**
 * Converte a entrada em Date:
 * - texto ISO com fuso ("...Z", "...-03:00"), Date ou milissegundos: o instante exato;
 * - texto de data e hora sem fuso ("2026-11-23 22:30:00"): UTC, o padrão do D1/SQLite;
 * - só a data ("2026-11-23"): o dia do calendário (meia-noite em Belém).
 */
export function paraData(valor: EntradaData): Date {
  let data: Date;
  if (valor instanceof Date) {
    data = valor;
  } else if (typeof valor === "number") {
    data = new Date(valor);
  } else {
    const texto = valor.trim();
    if (SO_DATA.test(texto)) {
      data = new Date(`${texto}T00:00:00-03:00`);
    } else if (DATA_HORA_SEM_FUSO.test(texto)) {
      data = new Date(`${texto.replace(" ", "T")}Z`);
    } else {
      data = new Date(texto);
    }
  }
  if (Number.isNaN(data.getTime())) {
    throw new RangeError(`Data inválida: ${String(valor)}`);
  }
  return data;
}

const formatosNumero = new Map<number | undefined, Intl.NumberFormat>();

function formatoNumero(casasDecimais: number | undefined): Intl.NumberFormat {
  let formato = formatosNumero.get(casasDecimais);
  if (!formato) {
    formato = new Intl.NumberFormat(
      LOCALIDADE,
      casasDecimais === undefined
        ? {}
        : {
            minimumFractionDigits: casasDecimais,
            maximumFractionDigits: casasDecimais,
          },
    );
    formatosNumero.set(casasDecimais, formato);
  }
  return formato;
}

const formatosPercentual = new Map<string, Intl.NumberFormat>();

function formatoPercentual(
  casasDecimais: number,
  sinal: boolean,
): Intl.NumberFormat {
  const chave = `${casasDecimais}:${sinal}`;
  let formato = formatosPercentual.get(chave);
  if (!formato) {
    formato = new Intl.NumberFormat(LOCALIDADE, {
      style: "unit",
      unit: "percent",
      minimumFractionDigits: casasDecimais,
      maximumFractionDigits: casasDecimais,
      signDisplay: sinal ? "exceptZero" : "auto",
    });
    formatosPercentual.set(chave, formato);
  }
  return formato;
}

function garantirFinito(valor: number, nome: string): void {
  if (!Number.isFinite(valor)) {
    throw new RangeError(`${nome} inválido: ${valor}`);
  }
}
