// Textos e formatos da tela de rankings (coordenação: aqui os valores aparecem, em bilhetes ou em R$).
import type {
  CriterioRanking,
  JanelaRanking,
  NivelRanking,
  ReferenciaCampanha,
  SituacaoRitmo,
  UnidadeMeta,
} from "../../../shared/contracts/calculos";
import type { TomBadge } from "../../components/ui";
import {
  formatarData,
  formatarMoeda,
  formatarNumero,
} from "../../lib/formatadores";

type TextosNivel = {
  /** Rótulo da aba. */
  aba: string;
  /** Cabeçalho da coluna do nome. */
  coluna: string;
  singular: string;
  plural: string;
  /** Título do estado vazio. */
  vazio: string;
  /** O que falta cadastrar para o nível aparecer (só entra no ranking quem tem célula). */
  semItens: string;
};

export const TEXTO_NIVEL: Record<NivelRanking, TextosNivel> = {
  celula: {
    aba: "Células",
    coluna: "Célula",
    singular: "célula",
    plural: "células",
    vazio: "Nenhuma célula para mostrar.",
    semItens: "células cadastradas",
  },
  discipulador: {
    aba: "Discipuladores",
    coluna: "Discipulador",
    singular: "discipulador",
    plural: "discipuladores",
    vazio: "Nenhum discipulador para mostrar.",
    semItens: "discipuladores com células",
  },
  rede: {
    aba: "Redes",
    coluna: "Rede",
    singular: "rede",
    plural: "redes",
    vazio: "Nenhuma rede para mostrar.",
    semItens: "redes com células",
  },
};

/** Opções do seletor de janela (curtas, para caber no celular; o resumo mostra o nome e as datas). */
export const TEXTO_JANELA: Record<JanelaRanking, string> = {
  atual: "Período atual",
  campanha: "Campanha",
};

export const TEXTO_CRITERIO: Record<CriterioRanking, string> = {
  percentual_meta: "% da meta atingido",
  bilhetes: "bilhetes vendidos",
  arrecadacao: "valor arrecadado",
};

/** Cabeçalho da coluna de realizado e meta, conforme a unidade da meta da campanha. */
export const TEXTO_COLUNA_VALORES: Record<UnidadeMeta, string> = {
  bilhetes: "Vendidos / meta",
  centavos: "Arrecadado / meta",
};

export const TEXTO_SITUACAO: Record<
  SituacaoRitmo,
  { texto: string; tom: TomBadge }
> = {
  em_dia: { texto: "Em dia", tom: "sucesso" },
  abaixo: { texto: "Abaixo", tom: "alerta" },
  sem_meta: { texto: "Sem meta", tom: "neutro" },
};

/** Posição no ranking: 1 → "1º". Empatados mostram a mesma posição (1º, 1º, 3º). */
export function formatarPosicao(posicao: number): string {
  return `${posicao}º`;
}

/** Uma quantidade na unidade da meta: "1 bilhete", "12 bilhetes" ou "R$ 140,00". */
export function formatarQuantidade(
  valor: number,
  unidade: UnidadeMeta,
): string {
  if (unidade === "centavos") return formatarMoeda(valor);
  return `${formatarNumero(valor)} ${valor === 1 ? "bilhete" : "bilhetes"}`;
}

/** "7 de 29 bilhetes" ou "R$ 140,00 de R$ 580,00"; sem meta, só o realizado. */
export function realizadoEMeta(
  realizado: number,
  meta: number,
  unidade: UnidadeMeta,
): string {
  if (meta === 0) return formatarQuantidade(realizado, unidade);
  if (unidade === "centavos") {
    return `${formatarMoeda(realizado)} de ${formatarMoeda(meta)}`;
  }
  return `${formatarNumero(realizado)} de ${formatarQuantidade(meta, unidade)}`;
}

/** Quanto falta para ficar em dia: "falta 1 bilhete", "faltam 5 bilhetes", "faltam R$ 20,00". */
export function textoDaFalta(falta: number, unidade: UnidadeMeta): string {
  const verbo = unidade === "bilhetes" && falta === 1 ? "falta" : "faltam";
  return `${verbo} ${formatarQuantidade(falta, unidade)}`;
}

/** Onde a campanha está na data do ranking: "Dia 12 de 24", "Começa em 23/11/2026"... */
export function textoDaReferencia(referencia: ReferenciaCampanha): string {
  if (referencia.fase === "antes") {
    return `A campanha começa em ${formatarData(referencia.data_inicio)}`;
  }
  if (referencia.fase === "encerrada") {
    return `Campanha encerrada em ${formatarData(referencia.data_fim)}`;
  }
  return `Dia ${referencia.dia_campanha ?? 1} de ${referencia.duracao_dias} da campanha`;
}

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045): a explicação que aparece com o mouse parado (ou o foco do teclado) em cada botão e campo da
// tela. Dizem para que serve e o que acontece, sem repetir o rótulo.
// ---------------------------------------------------------------------------------------------------

export const DICAS = {
  aba: {
    celula:
      "A posição de cada célula na disputa, com quanto da meta já fez e se está em dia.",
    discipulador:
      "Cada discipulador, com as vendas e as metas das células dele somadas.",
    rede: "Cada rede, com as vendas e as metas das células dela somadas.",
  } satisfies Record<NivelRanking, string>,
  divisaoUnica:
    "Indisponível: a campanha usa um ranking só, com todas as células juntas. Para separar Jovens e Adultos, ligue a opção na tela Campanha.",
  /** RIFA-083: a troca de janela dos maiores compradores (só o admin vê). */
  janelaCompradores: {
    atual:
      "Mostra quem mais comprou no período de agora (normalmente a semana).",
    campanha: "Mostra quem mais comprou desde o primeiro dia da campanha.",
  } satisfies Record<JanelaRanking, string>,
  whatsapp: "Abre uma conversa no WhatsApp com quem comprou.",
  /** RIFA-093: o nome da célula, só para o admin, leva a Quem comprou com ela aberta. */
  quemComprou: "Abre a tela Quem comprou com as compras desta célula.",
} as const;

// ---------------------------------------------------------------------------------------------------
// Maiores compradores (RIFA-083, D38; só o admin): nome, telefone, bilhetes, total pago e células.
// ---------------------------------------------------------------------------------------------------

/** Os botões da troca de janela, na ordem. */
export const TEXTO_JANELA_COMPRADORES: Record<JanelaRanking, string> = {
  atual: "Esta semana",
  campanha: "Campanha toda",
};

/** Quando ainda ninguém comprou na janela. */
export function semCompras(janela: JanelaRanking): string {
  return janela === "atual"
    ? "Ainda não há compras nesta semana."
    : "Ainda não há compras na campanha.";
}

/** "1 bilhete", "12 bilhetes". */
export function textoDosBilhetes(bilhetes: number): string {
  return `${formatarNumero(bilhetes)} ${bilhetes === 1 ? "bilhete" : "bilhetes"}`;
}

/** As células do comprador: "Célula Ágape, Célula Betel"; com pedido sem célula, "…, sem célula" ou "Sem célula". */
export function textoDasCelulas(
  celulas: readonly string[],
  semCelula: boolean,
): string {
  if (celulas.length === 0) return "Sem célula";
  return semCelula ? `${celulas.join(", ")}, sem célula` : celulas.join(", ");
}
