// O extrato do banco lido NO NAVEGADOR (RIFA-059, D26): os lançamentos que os leitores (ofx.ts, texto-colado.ts e
// csv.ts) tiram do arquivo ou do texto colado, o relógio do fuso da campanha e o filtro dos créditos que parecem Pix.
//
// Privacidade (D26): nada daqui vai para o servidor, para o localStorage ou para o log. A descrição do lançamento (que
// pode ter o nome de quem pagou) fica só na memória da tela, para a pessoa desempatar um Pix ambíguo.
import { criarLeitorDeData } from "../../../../shared/conferencia/valores";

/** Um lançamento do extrato, já normalizado. */
export interface Lancamento {
  /** A posição no extrato (1, 2, 3...): desempata dois Pix no mesmo instante e identifica a linha na tela. */
  ordem: number;
  /** O dia no fuso da campanha ("YYYY-MM-DD"). */
  dia: string;
  /** O instante (ms, UTC) quando o extrato traz a hora; null = só o dia. */
  instante: number | null;
  /** Centavos: positivo é crédito; negativo, débito. */
  centavos: number;
  /** A descrição como o banco escreveu (pode ter o nome de quem pagou): só na tela. */
  descricao: string;
  /** Campos que podem trazer o número do pedido além da descrição (FITID, documento): só para achar o "Certo". */
  identificadores: string[];
}

export type FormatoExtrato = "ofx" | "texto" | "csv";

/** Uma data do calendário (sem fuso). */
export interface DataLocal {
  ano: number;
  mes: number;
  dia: number;
}

/** O extrato lido. */
export interface ExtratoLido {
  ok: true;
  formato: FormatoExtrato;
  lancamentos: Lancamento[];
  /** Lançamentos com valor que não deu para ler (sem data ou com o valor ilegível). */
  ilegiveis: number;
  /** O banco não mandou a hora (todas iguais, ou meia-noite em ponto): o cruzamento usa só o dia. */
  semHora: boolean;
}

export interface FalhaDoExtrato {
  ok: false;
  titulo: string;
  mensagem: string;
}

/** O fuso da campanha e o agora (para o ano que falta em "16/11"). */
export interface ContextoDeLeitura {
  fuso: string;
  agora: number;
}

/** Textos em maiúsculas e sem acento, para comparar palavras ("Transferência" → "TRANSFERENCIA"). */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

const dois = (numero: number) => String(numero).padStart(2, "0");

/** O relógio do fuso da campanha: hora local para instante e de volta, sem um Intl por lançamento. */
export interface Relogio {
  /** O dia e o instante de uma data e hora locais; null se a data não existe. */
  local(
    ano: number,
    mes: number,
    dia: number,
    hora?: { h: number; m: number; s: number },
  ): { dia: string; instante: number | null } | null;
  /** O dia local de um instante. */
  diaDoInstante(instante: number): string;
  /** O primeiro e o último milissegundo do dia local. */
  limitesDoDia(dia: string): { inicio: number; fim: number };
  /** O dia local de hoje (do contexto). */
  hoje: string;
}

export function criarRelogio(contexto: ContextoDeLeitura): Relogio {
  const leitor = criarLeitorDeData(contexto.fuso);
  const inicioDoDia = (dia: string): number => {
    const lido = leitor(`${dia} 00:00:00`);
    if (typeof lido === "string" || lido.instante === null)
      throw new RangeError(`dia inválido: ${dia}`);
    return lido.instante;
  };
  const diaSeguinte = (dia: string): string =>
    new Date(Date.parse(`${dia}T12:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
  return {
    local(ano, mes, dia, hora) {
      const texto = `${ano}-${dois(mes)}-${dois(dia)}${hora ? ` ${dois(hora.h)}:${dois(hora.m)}:${dois(hora.s)}` : ""}`;
      const lido = leitor(texto);
      return typeof lido === "string" ? null : lido;
    },
    diaDoInstante: (instante) => leitor.diaDoInstante(instante),
    limitesDoDia(dia) {
      return {
        inicio: inicioDoDia(dia),
        fim: inicioDoDia(diaSeguinte(dia)) - 1,
      };
    },
    hoje: leitor.diaDoInstante(contexto.agora),
  };
}

/**
 * O banco que não tem a hora costuma completar com a meia-noite (ou com a mesma hora em todos). Se todos os
 * lançamentos com hora têm a mesma hora do dia (pelo menos 2), ela não vale: fica só o dia. Os da meia-noite em
 * ponto já chegam sem hora dos leitores.
 */
export function semHoraRepetida(
  lancamentos: Lancamento[],
  relogio: Relogio,
): { lancamentos: Lancamento[]; semHora: boolean } {
  const comHora = lancamentos.filter((item) => item.instante !== null);
  if (comHora.length === 0) return { lancamentos, semHora: true };
  const horaDoDia = (item: Lancamento) =>
    (item.instante as number) - relogio.limitesDoDia(item.dia).inicio;
  const primeira = horaDoDia(comHora[0]);
  const repetida =
    comHora.length >= 2 &&
    comHora.every((item) => horaDoDia(item) === primeira);
  if (!repetida) return { lancamentos, semHora: false };
  return {
    lancamentos: lancamentos.map((item) => ({ ...item, instante: null })),
    semHora: true,
  };
}

// ---------------------------------------------------------------------------------------------------
// Os créditos que parecem Pix
// ---------------------------------------------------------------------------------------------------

/** As palavras padrão: o Pix aparece como "PIX RECEBIDO", "TRANSFERENCIA PIX", "TRANSF PIX"... */
export const PALAVRAS_PADRAO = "PIX, TRANSF";
export const MAXIMO_PALAVRAS = 10;

/** "PIX, TRANSF" → ["PIX", "TRANSF"] (sem acento, maiúsculas, sem repetir; vírgula ou ponto e vírgula). */
export function palavrasDoPix(texto: string): string[] {
  const palavras = texto
    .split(/[,;]/)
    .map((palavra) => normalizar(palavra).replace(/\s+/g, " ").trim())
    .filter((palavra) => palavra !== "");
  return [...new Set(palavras)].slice(0, MAXIMO_PALAVRAS);
}

/** Um Pix do extrato: o lançamento e o intervalo em que ele pode ter caído (o instante, ou o dia inteiro). */
export interface Pix extends Lancamento {
  /** Uma chave estável na tela ("L3"). */
  chave: string;
  inicio: number;
  fim: number;
}

/** Por que um lançamento ficou de fora. */
export interface Ignorados {
  /** Saídas de dinheiro (valor negativo). */
  debitos: number;
  /** Créditos sem nenhuma das palavras do Pix na descrição. */
  semPalavra: number;
  /** Linhas de saldo ("SALDO ANTERIOR", "SALDO DO DIA"). */
  saldos: number;
  /** Valor zero, sem data ou com o valor ilegível. */
  ilegiveis: number;
}

const SALDO = /\bSALDO\b/;

/**
 * Os créditos que parecem Pix: valor maior que zero e, na descrição, alguma das palavras (sem palavras, todos os
 * créditos). As linhas de saldo nunca são Pix. Devolve também quantos ficaram de fora e por quê.
 */
export function filtrarPix(
  extrato: ExtratoLido,
  palavras: readonly string[],
  relogio: Relogio,
): { pix: Pix[]; ignorados: Ignorados } {
  const ignorados: Ignorados = {
    debitos: 0,
    semPalavra: 0,
    saldos: 0,
    ilegiveis: extrato.ilegiveis,
  };
  const pix: Pix[] = [];
  for (const lancamento of extrato.lancamentos) {
    const descricao = normalizar(lancamento.descricao);
    if (SALDO.test(descricao)) ignorados.saldos++;
    else if (lancamento.centavos === 0) ignorados.ilegiveis++;
    else if (lancamento.centavos < 0) ignorados.debitos++;
    else if (
      palavras.length > 0 &&
      !palavras.some((palavra) => descricao.includes(palavra))
    )
      ignorados.semPalavra++;
    else {
      const limites =
        lancamento.instante === null
          ? relogio.limitesDoDia(lancamento.dia)
          : { inicio: lancamento.instante, fim: lancamento.instante };
      pix.push({ ...lancamento, chave: `L${lancamento.ordem}`, ...limites });
    }
  }
  return { pix, ignorados };
}

/** O primeiro instante em que algum crédito do extrato pode ter caído (para saber até onde buscar os pedidos). */
export function primeiroInstante(
  extrato: ExtratoLido,
  relogio: Relogio,
): number | null {
  let menor: number | null = null;
  for (const lancamento of extrato.lancamentos) {
    if (lancamento.centavos <= 0) continue;
    const inicio =
      lancamento.instante ?? relogio.limitesDoDia(lancamento.dia).inicio;
    if (menor === null || inicio < menor) menor = inicio;
  }
  return menor;
}
