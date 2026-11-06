// Textos e regras da tela de adesão (sem React): tempo relativo, busca, situação da célula e o código
// de afiliado digitado.
import {
  FUSO_HORARIO,
  LOCALIDADE,
  formatarNumero,
} from "../../lib/formatadores";
import type { CelulaAdesao } from "./adesao-api";

/**
 * Há quanto tempo, a partir de `agora` (ms): "agora mesmo", "há 2 min", "há 3 h", "há 2 dias".
 * Relógio do aparelho atrasado (instante no futuro) também vira "agora mesmo".
 */
export function tempoRelativo(instante: string, agora: number): string {
  const minutos = Math.floor((agora - Date.parse(instante)) / 60_000);
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

const formatoHoraComSegundos = new Intl.DateTimeFormat(LOCALIDADE, {
  timeZone: FUSO_HORARIO,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "19:32:05" (fuso de Belém): a hora da última atualização do painel. */
export function formatarHoraComSegundos(instante: number): string {
  return formatoHoraComSegundos.format(instante);
}

/** "1 pedido aprovado", "3 pedidos aprovados". */
export function quantidade(
  numero: number,
  singular: string,
  plural: string,
): string {
  return `${formatarNumero(numero)} ${numero === 1 ? singular : plural}`;
}

/** Sem acentos, em minúsculas e sem espaços nas pontas: a base da busca. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase(LOCALIDADE)
    .trim();
}

/**
 * A célula aparece na busca se cada palavra digitada estiver no nome dela, no nome do líder, do
 * discipulador ou da rede (sem acentos e sem diferenciar maiúsculas), ou for o código inteiro de um
 * afiliado dela: "03" acha a "Célula Jovem 03", mas não o afiliado 1003.
 */
export function celulaCombina(celula: CelulaAdesao, busca: string): boolean {
  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return true;
  const textos = normalizar(
    [
      celula.celula_nome,
      celula.lider_nome,
      celula.discipulador_nome,
      celula.rede_nome,
    ].join(" "),
  );
  const codigos = celula.afiliados.map(String);
  return termos.every(
    (termo) => textos.includes(termo) || codigos.includes(termo),
  );
}

export type SituacaoCelula = "sem_afiliado" | "vinculada" | "ja_vendeu";

export function situacaoDaCelula(celula: CelulaAdesao): SituacaoCelula {
  if (celula.pedidos_aprovados > 0) return "ja_vendeu";
  return celula.vinculada ? "vinculada" : "sem_afiliado";
}

/** Para escolher a célula de um afiliado: as que ainda não têm afiliado primeiro (mantém a ordem da API). */
export function ordenarParaEscolha(celulas: CelulaAdesao[]): CelulaAdesao[] {
  return [
    ...celulas.filter((celula) => !celula.vinculada),
    ...celulas.filter((celula) => celula.vinculada),
  ];
}

/** O código de afiliado digitado: só dígitos, inteiro positivo. Qualquer outra coisa vira null. */
export function lerCodigoAfiliado(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,16}$/.test(limpo)) return null;
  const codigo = Number(limpo);
  return codigo > 0 && Number.isSafeInteger(codigo) ? codigo : null;
}

/** Link de ligação: "tel:" com os dígitos (e o "+" do código do país, se houver). */
export function linkTelefone(telefone: string): string {
  return `tel:${telefone.replace(/[^\d+]/g, "")}`;
}
