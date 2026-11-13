// Textos da tela pública: fase da campanha, janela do ranking e posição. Só datas, dias e posições:
// nenhum valor em dinheiro nem quantidade (regra em docs/frontend.md).
import type {
  JanelaRankingResposta,
  ReferenciaCampanha,
} from "../../../shared/contracts/calculos";
import { formatarData } from "../../lib/formatadores";

/** Posição no ranking: 1 → "1º". Empatados mostram a mesma posição (1º, 2º, 3º, 3º). */
export function formatarPosicao(posicao: number): string {
  return `${posicao}º`;
}

/** Dia e mês de uma data local, pelo formatador de datas: "2026-12-03" → "03/12". */
export function diaEMes(data: string): string {
  return formatarData(data).slice(0, 5);
}

export type TextoDaFase = {
  /** O que vem em destaque: "Dia 12 de 24", "Faltam 3 dias para começar", "Campanha encerrada". */
  destaque: string;
  detalhe: string;
};

/** Onde a campanha está hoje (a `referencia` da resposta: a data é a do servidor, no fuso da campanha). */
export function textoDaFase(referencia: ReferenciaCampanha): TextoDaFase {
  if (referencia.fase === "antes") {
    const faltam = referencia.dias_para_inicio ?? 1;
    return {
      destaque:
        faltam === 1 ? "Começa amanhã" : `Faltam ${faltam} dias para começar`,
      detalhe: `Vendas de ${formatarData(referencia.data_inicio)} a ${formatarData(referencia.data_fim)}`,
    };
  }
  if (referencia.fase === "encerrada") {
    return {
      destaque: "Campanha encerrada",
      detalhe: `Terminou em ${formatarData(referencia.data_fim)}`,
    };
  }
  // dias_restantes conta hoje: no último dia vale 1.
  const restantes = referencia.dias_restantes;
  return {
    destaque: `Dia ${referencia.dia_campanha ?? 1} de ${referencia.duracao_dias}`,
    detalhe:
      restantes <= 1 ? "Hoje é o último dia" : `Faltam ${restantes} dias`,
  };
}

export type LinhaDoTempo = {
  /** Quanto da campanha já passou, contando hoje (0 a 100): "Dia 12 de 24" → 50. */
  percorrido: number;
  /** As pontas: "23/11" e "16/12". */
  inicio: string;
  fim: string;
};

/**
 * A linha do tempo da faixa da fase (RIFA-050), só durante a campanha: os dias passados sobre o total. Só a
 * `referencia` (nenhum dado novo); antes do início e depois do fim, o texto da faixa já diz tudo.
 */
export function linhaDoTempo(
  referencia: ReferenciaCampanha,
): LinhaDoTempo | null {
  if (referencia.fase !== "durante") return null;
  const dia = referencia.dia_campanha ?? 1;
  return {
    percorrido: Math.min(100, (100 * dia) / referencia.duracao_dias),
    inicio: diaEMes(referencia.data_inicio),
    fim: diaEMes(referencia.data_fim),
  };
}

/** Título da disputa: "Semana 2 · 03/12 a 09/12"; depois do fim, "Resultado final da campanha". */
export function textoDaJanela(
  janela: JanelaRankingResposta,
  referencia: ReferenciaCampanha,
): string {
  if (janela.tipo === "campanha" && referencia.fase === "encerrada") {
    return "Resultado final da campanha";
  }
  return `${janela.nome} · ${diaEMes(janela.data_inicio)} a ${diaEMes(janela.data_fim)}`;
}
