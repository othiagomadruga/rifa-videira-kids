// Textos do ranking geral (RIFA-090, adendo da D12) na /minha do discipulador e da rede, sem React: só nomes de
// discipuladores e células, posições, % da meta e bilhetes; nunca dinheiro nem comprador. A palavra "rede" não aparece
// para o discipulador (D30: com uma rede só, nenhuma tela a mostra), por isso o título é "Ranking geral".
import type {
  JanelaRanking,
  NivelRankingGrupos,
} from "../../../shared/contracts/calculos";
import type { TipoAlvo } from "../../../shared/contracts/dominio";
import { formatarNumero } from "../../lib/formatadores";

/** Quantas linhas de cada lista aparecem antes do "Ver todas" (a API manda todas). */
export const LINHAS_VISIVEIS_TODAS_AS_REDES = 10;

/** O título do cartão. */
export const TITULO_TODAS_AS_REDES = "Ranking geral";

/** Os títulos das duas listas. */
export const TITULO_DA_LISTA: Record<NivelRankingGrupos, string> = {
  discipulador: "Discipuladores",
  celula: "Células",
};

// Ajuda (RIFA-066, D31): o que é, para que serve e, quando há escolha, um exemplo.
export const AJUDA_TODAS_AS_REDES = {
  titulo:
    "Todos os discipuladores e todas as células da campanha, com a posição, o % da meta e os bilhetes. Serve para ver a disputa inteira, além das suas células. Ex.: em “Campanha toda”, desde o primeiro dia.",
  discipuladores:
    "A disputa entre todos os discipuladores, pelo resultado das células de cada um. As linhas destacadas são as suas.",
  celulas:
    "A disputa entre todas as células da campanha, com o discipulador de cada uma. As linhas destacadas são as suas.",
} as const;

// Dicas (RIFA-045): a explicação dos botões, com o mouse parado ou o foco do teclado.
export const DICAS_TODAS_AS_REDES = {
  janela: {
    atual: "Mostra o ranking geral do período de agora (normalmente a semana).",
    campanha: "Mostra o ranking geral desde o primeiro dia da campanha.",
  } satisfies Record<JanelaRanking, string>,
  verTodas: "Mostra a lista inteira aqui mesmo, sem sair da página.",
  verMenos: "Volta a mostrar só os primeiros da lista.",
} as const;

/** O selo das linhas de quem vê: a do discipulador é "Você"; as células dele, "Sua"; na rede, "Sua rede". */
export function seloDaLinha(tipo: TipoAlvo, nivel: NivelRankingGrupos): string {
  if (tipo === "rede") return "Sua rede";
  return nivel === "discipulador" ? "Você" : "Sua";
}

/** "Ver todos os 12 discipuladores" / "Ver todas as 40 células". */
export function textoVerTodas(
  nivel: NivelRankingGrupos,
  quantos: number,
): string {
  return nivel === "discipulador"
    ? `Ver todos os ${formatarNumero(quantos)} discipuladores`
    : `Ver todas as ${formatarNumero(quantos)} células`;
}

/** "Mostrar só os 10 primeiros" / "Mostrar só as 10 primeiras". */
export function textoVerMenos(
  nivel: NivelRankingGrupos,
  quantos: number,
): string {
  return nivel === "discipulador"
    ? `Mostrar só os ${formatarNumero(quantos)} primeiros`
    : `Mostrar só as ${formatarNumero(quantos)} primeiras`;
}

/** Quando a lista está vazia (nenhuma célula na campanha ainda). */
export function listaVazia(nivel: NivelRankingGrupos): string {
  return nivel === "discipulador"
    ? "Ainda não há discipuladores com células."
    : "Ainda não há células na campanha.";
}
