/**
 * Valores das células do CSV da Rifei na conferência (RIFA-012): código do pedido, status, quantidade,
 * números dos bilhetes (só contados), valor em centavos, afiliado e data no fuso da campanha.
 *
 * Módulo puro e sem zod, do navegador: as funções recebem o texto de uma célula e devolvem o valor
 * normalizado (ou VAZIO/INVALIDO), nunca o texto. O Worker usa daqui só `chaveDoAfiliado` (para comparar o
 * usuário do afiliado com os rótulos cadastrados).
 *
 * Datas: o leitor de cada fuso guarda o formatador do Intl e o deslocamento de cada bloco de 15 minutos;
 * criar um Intl.DateTimeFormat por célula custava ~95% do tempo da leitura (revisão do ciclo 1).
 */
import {
  FORMATO_ID_PEDIDO_RECONCILIACAO,
  MAXIMO_BILHETES_RECONCILIACAO,
  MAXIMO_CENTAVOS_RECONCILIACAO,
  type AfiliadoDoCorpo,
  type StatusArquivoReconciliacao,
} from "../contracts/conferencia";
import { diaDoCalendario } from "../contracts/calendario";
import { conjunto } from "./colunas";

/** Célula vazia (ou só um traço). */
export const VAZIO = "vazio";
/** Célula com conteúdo que não dá para ler. */
export const INVALIDO = "invalido";
export type Lido<T> = T | typeof VAZIO | typeof INVALIDO;

const MARCAS_DE_VAZIO = new Set(["", "-", "—", "–"]);

/** Começa como uma fórmula de planilha (=, +, @, ou - seguido de algo que não é número). */
export function pareceFormula(texto: string): boolean {
  const limpo = texto.trim();
  return /^[=+@]/.test(limpo) || /^-[^\d\s]/.test(limpo);
}

/** Espaços, inclusive os não separáveis (U+00A0 e U+202F, que o \s do JavaScript inclui). */
const ESPACOS = /\s+/g;

/** Formatos aceitos de valor, depois de tirar "R$" e os espaços. A ordem resolve "1.234" e "1,234". */
const FORMATOS_DE_VALOR: {
  padrao: RegExp;
  milhar: string | null;
  decimal: string;
}[] = [
  // 1.234,56 · 1.234 (milhar com ponto, decimal com vírgula)
  { padrao: /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/, milhar: ".", decimal: "," },
  // 1234,56 · 20,5 · 20
  { padrao: /^\d+(?:,\d{1,2})?$/, milhar: null, decimal: "," },
  // 1,234.56 · 1,234 (milhar com vírgula, decimal com ponto)
  { padrao: /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/, milhar: ",", decimal: "." },
  // 1234.56 · 20.5
  { padrao: /^\d+(?:\.\d{1,2})?$/, milhar: null, decimal: "." },
];

/**
 * Valor em reais para centavos inteiros, por texto (sem float, D2): "R$ 1.234,56" → 123456;
 * "20,00", "20.00" e "20" → 2000. Negativo, com mais de 2 casas ou acima de R$ 10.000.000,00: inválido.
 */
export function lerCentavos(texto: string): Lido<number> {
  const limpo = texto.trim();
  if (MARCAS_DE_VAZIO.has(limpo)) return VAZIO;
  if (limpo.length > 40) return INVALIDO;
  const numero = limpo.replace(/R\$|BRL/gi, "").replace(ESPACOS, "");
  for (const { padrao, milhar, decimal } of FORMATOS_DE_VALOR) {
    if (!padrao.test(numero)) continue;
    const semMilhar = milhar === null ? numero : numero.split(milhar).join("");
    const [inteiro, fracao = ""] = semMilhar.split(decimal);
    if (inteiro.length > 13) return INVALIDO;
    const centavos = Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));
    return centavos <= MAXIMO_CENTAVOS_RECONCILIACAO ? centavos : INVALIDO;
  }
  return INVALIDO;
}

/** Quantidade de bilhetes: inteiro de 0 a 1.000.000 ("12", "1.000", "12,0"). */
export function lerQuantidade(texto: string): Lido<number> {
  const limpo = texto.trim().replace(ESPACOS, "");
  if (MARCAS_DE_VAZIO.has(limpo)) return VAZIO;
  let digitos: string | null = null;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(limpo)) digitos = limpo.split(".").join("");
  else if (/^\d{1,9}(?:[.,]0+)?$/.test(limpo)) digitos = limpo.split(/[.,]/)[0];
  if (digitos === null) return INVALIDO;
  const quantidade = Number(digitos);
  return quantidade <= MAXIMO_BILHETES_RECONCILIACAO ? quantidade : INVALIDO;
}

/** Tamanho máximo da célula dos números dos bilhetes (um pedido grande cabe com folga). */
const MAXIMO_CARACTERES_BILHETES = 200_000;

/**
 * Quantos números de bilhete a célula tem ("001, 002, 003", "[1, 2]", "1 2 3": só dígitos e
 * separadores). Os números em si não saem do navegador.
 */
export function contarNumeros(texto: string): Lido<number> {
  const limpo = texto.trim();
  if (MARCAS_DE_VAZIO.has(limpo)) return VAZIO;
  if (
    limpo.length > MAXIMO_CARACTERES_BILHETES ||
    /[^\d\s,;|/.()[\]-]/.test(limpo)
  )
    return INVALIDO;
  const numeros = limpo.match(/\d+/g);
  if (numeros === null || numeros.some((numero) => numero.length > 12))
    return INVALIDO;
  return new Set(numeros.map(Number)).size;
}

/** Palavras do status, sem acento e em minúsculas ("Não pago" → {nao, pago}). */
function palavrasDoTexto(texto: string): Set<string> {
  return new Set(
    texto
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((palavra) => palavra !== ""),
  );
}

const STATUS_CANCELADO = conjunto(
  "cancelado cancelada canceled cancelled estornado estornada estorno reembolsado reembolsada refunded recusado recusada rejeitado rejeitada rejected chargeback devolvido devolvida",
);
const STATUS_EXPIRADO = conjunto(
  "expirado expirada expired vencido vencida expirou",
);
const STATUS_PENDENTE = conjunto(
  "pendente pendentes pending aguardando processando processamento process processing reservado reservada aberto aberta andamento analise nao not unpaid",
);
const STATUS_APROVADO = conjunto(
  "aprovado aprovada approved pago paga paid confirmado confirmada concluido concluida completed accredited quitado quitada",
);

/**
 * Status do arquivo, normalizado. Primeiro o que nega a venda (cancelado, expirado, pendente, "não"):
 * "Não pago" e "Pagamento pendente" não são pagos; "Pago" e "approved" são.
 */
export function lerStatus(
  texto: string,
): StatusArquivoReconciliacao | typeof VAZIO {
  const limpo = texto.trim();
  if (MARCAS_DE_VAZIO.has(limpo)) return VAZIO;
  if (limpo.length > 60) return "desconhecido";
  const palavras = palavrasDoTexto(limpo);
  const tem = (alvo: ReadonlySet<string>) =>
    [...palavras].some((palavra) => alvo.has(palavra));
  if (tem(STATUS_CANCELADO)) return "cancelado";
  if (tem(STATUS_EXPIRADO)) return "expirado";
  if (tem(STATUS_PENDENTE)) return "pendente";
  if (tem(STATUS_APROVADO)) return "aprovado";
  return "desconhecido";
}

const SEM_AFILIADO = new Set([
  "nenhum",
  "nenhuma",
  "sem afiliado",
  "sem",
  "n/a",
  "na",
  "nao",
  "null",
  "none",
  "0",
]);

/** Texto do afiliado (ou do rótulo cadastrado) para comparação: sem acento, minúsculo, sem @ no início. */
export function chaveDoAfiliado(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^@\s*/, "");
}

/** Usuário do afiliado no corpo: até 120 caracteres (o rótulo cadastrado também tem esse limite). */
const MAXIMO_USUARIO = 120;

/**
 * Afiliado da célula, como vai no corpo: o número (affiliate_id), o usuário normalizado (para achar o
 * rótulo cadastrado), null (vazio ou "sem afiliado") ou false (ilegível).
 */
export function lerAfiliado(texto: string): AfiliadoDoCorpo {
  const limpo = texto.trim();
  if (MARCAS_DE_VAZIO.has(limpo)) return null;
  // "@usuario" é o jeito comum de escrever o usuário: no afiliado, só = e + (e - seguido de letra) são
  // fórmula.
  if (
    limpo.length > MAXIMO_USUARIO ||
    (pareceFormula(limpo) && !limpo.startsWith("@"))
  )
    return false;
  const numero = /^#?\s*(\d+)$/.exec(limpo);
  if (numero) {
    if (numero[1].length > 15) return false;
    const id = Number(numero[1]);
    if (id === 0) return null;
    return Number.isSafeInteger(id) ? id : false;
  }
  const chave = chaveDoAfiliado(limpo);
  if (SEM_AFILIADO.has(chave)) return null;
  return chave === "" || chave.length > MAXIMO_USUARIO ? false : chave;
}

/** Código do pedido (FORMATO_ID_PEDIDO_RECONCILIACAO). */
export function lerIdPedido(texto: string): Lido<string> {
  const limpo = texto.trim();
  if (limpo === "") return VAZIO;
  return FORMATO_ID_PEDIDO_RECONCILIACAO.test(limpo) ? limpo : INVALIDO;
}

// ---------------------------------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------------------------------

/** Data lida: o dia no fuso da campanha e, quando o arquivo tem a hora, o instante (ms, UTC). */
export interface DataLida {
  dia: string;
  instante: number | null;
}

const DATA_COM_FUSO =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?\s*(Z|[+-]\d{2}:?\d{2})$/i;
const DATA_ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?$/;
const DATA_BR =
  /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:(?:\s+|\s*,\s*|\s+[àa]s\s+)(\d{1,2})[:h](\d{2})(?::(\d{2}))?)?$/i;

const dois = (numero: number) => String(numero).padStart(2, "0");

function diaValido(ano: number, mes: number, dia: number): string | null {
  if (ano < 2000 || ano > 2099) return null;
  const texto = `${ano}-${dois(mes)}-${dois(dia)}`;
  return diaDoCalendario(texto) === null ? null : texto;
}

/** Milissegundos desde a meia-noite; null sem hora; NaN com hora impossível. */
function horaValida(
  hora: string | undefined,
  minuto: string | undefined,
  segundo: string | undefined,
): number | null {
  if (hora === undefined || minuto === undefined) return null;
  const [h, m, s] = [Number(hora), Number(minuto), Number(segundo ?? 0)];
  if (h > 23 || m > 59 || s > 59) return Number.NaN;
  return ((h * 60 + m) * 60 + s) * 1000;
}

const MS_POR_BLOCO = 15 * 60_000;
const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatadorDoFuso(fuso: string): Intl.DateTimeFormat {
  let formatador = formatadores.get(fuso);
  if (!formatador) {
    formatador = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatadores.set(fuso, formatador);
  }
  return formatador;
}

/** Leitor de datas de um fuso: guarda o deslocamento de cada bloco de 15 minutos e cada texto já lido. */
export interface LeitorDeData {
  (texto: string): Lido<DataLida>;
  /** O dia local ("YYYY-MM-DD") de um instante. */
  diaDoInstante(instante: number): string;
}

/** Máximo de textos guardados por leitor (passou disso, recomeça). */
const LIMITE_TEXTOS_GUARDADOS = 20_000;

/**
 * Data do pagamento (ou do pedido): "23/11/2026", "23/11/2026 14:35", "23/11/26 às 14h35",
 * "2026-11-23", "2026-11-23 14:35:10" (hora local do fuso da campanha) ou ISO com fuso
 * ("2026-11-23T14:35:10-03:00"). Dia e mês na ordem brasileira.
 */
export function criarLeitorDeData(fuso: string): LeitorDeData {
  const formatador = formatadorDoFuso(fuso);
  const deslocamentos = new Map<number, number>();
  const lidos = new Map<string, Lido<DataLida>>();

  /** Relógio local (no fuso) do início de um bloco, menos o instante: o deslocamento, em ms. */
  const deslocamento = (instante: number): number => {
    const bloco = Math.floor(instante / MS_POR_BLOCO);
    let valor = deslocamentos.get(bloco);
    if (valor === undefined) {
      const inicio = bloco * MS_POR_BLOCO;
      const partes = formatador.formatToParts(inicio);
      const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
        Number(partes.find((item) => item.type === tipo)?.value);
      valor =
        Date.UTC(
          parte("year"),
          parte("month") - 1,
          parte("day"),
          parte("hour"),
          parte("minute"),
          parte("second"),
        ) - inicio;
      deslocamentos.set(bloco, valor);
    }
    return valor;
  };
  const diaDoInstante = (instante: number) =>
    new Date(instante + deslocamento(instante)).toISOString().slice(0, 10);
  /** Hora local (sem fuso, escrita como UTC) para o instante: duas voltas resolvem o deslocamento. */
  const instanteDoRelogio = (relogio: number) => {
    const primeiro = relogio - deslocamento(relogio);
    return relogio - deslocamento(primeiro);
  };

  const ler = (texto: string): Lido<DataLida> => {
    const limpo = texto.trim();
    if (MARCAS_DE_VAZIO.has(limpo)) return VAZIO;
    if (limpo.length > 40) return INVALIDO;

    const comFuso = DATA_COM_FUSO.exec(limpo);
    if (comFuso) {
      const [, ano, mes, dia, hora, minuto, segundo, fracao, fusoDoTexto] =
        comFuso;
      if (diaValido(Number(ano), Number(mes), Number(dia)) === null)
        return INVALIDO;
      if (Number.isNaN(horaValida(hora, minuto, segundo) ?? 0)) return INVALIDO;
      const offset =
        fusoDoTexto.toUpperCase() === "Z"
          ? "Z"
          : `${fusoDoTexto.slice(0, 3)}:${fusoDoTexto.slice(-2)}`;
      const instante = Date.parse(
        `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo ?? "00"}${(fracao ?? "").slice(0, 4)}${offset}`,
      );
      if (Number.isNaN(instante)) return INVALIDO;
      return { dia: diaDoInstante(instante), instante };
    }

    const iso = DATA_ISO.exec(limpo);
    const br = iso ? null : DATA_BR.exec(limpo);
    if (!iso && !br) return INVALIDO;
    const [ano, mes, dia, hora, minuto, segundo] = iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3]), iso[4], iso[5], iso[6]]
      : [
          br![3].length === 2 ? 2000 + Number(br![3]) : Number(br![3]),
          Number(br![2]),
          Number(br![1]),
          br![4],
          br![5],
          br![6],
        ];
    const diaTexto = diaValido(ano, mes, dia);
    const ms = horaValida(hora, minuto, segundo);
    if (diaTexto === null || Number.isNaN(ms)) return INVALIDO;
    return {
      dia: diaTexto,
      instante:
        ms === null
          ? null
          : instanteDoRelogio(Date.UTC(ano, mes - 1, dia) + ms),
    };
  };

  const leitor = (texto: string): Lido<DataLida> => {
    let lido = lidos.get(texto);
    if (lido === undefined) {
      lido = ler(texto);
      if (lidos.size >= LIMITE_TEXTOS_GUARDADOS) lidos.clear();
      lidos.set(texto, lido);
    }
    return lido;
  };
  leitor.diaDoInstante = diaDoInstante;
  return leitor;
}
