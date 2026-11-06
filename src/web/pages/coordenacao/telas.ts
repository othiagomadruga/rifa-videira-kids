import type { ComponentType } from "react";
import type { Papel } from "../../../shared/contracts";
import type { ItemNavegacao } from "../../components/ui";
import { AcessosPage } from "../acessos/AcessosPage";
import { AdesaoPage } from "../adesao/AdesaoPage";
import { BumboPage } from "../bumbo/BumboPage";
import { CampanhaPage } from "../campanha/CampanhaPage";
import { ConferenciaPage } from "../conferencia/ConferenciaPage";
import { HierarquiaPage } from "../hierarquia/HierarquiaPage";
import { PedidosPage } from "../pedidos/PedidosPage";
import { RankingsPage } from "../rankings/RankingsPage";
import { VisaoGeralPage } from "../visao-geral/VisaoGeralPage";

export type TelaCoordenacao = {
  /** Segmento depois de /coordenacao; "" é a tela inicial (Visão geral). */
  segmento: string;
  /** Texto do link no menu. */
  rotulo: string;
  Component: ComponentType;
  /**
   * Papéis que veem a tela: o link só aparece no menu deles e, para os outros, a rota mostra
   * "sem permissão" (a API também recusa). Sem a lista: toda a coordenação.
   */
  papeis?: readonly Papel[];
};

// Telas da coordenação, na ordem do menu. Esta lista gera as rotas filhas de
// /coordenacao (rotas.tsx) e os links da navegação (CoordenacaoLayout).
export const TELAS_COORDENACAO: readonly TelaCoordenacao[] = [
  { segmento: "", rotulo: "Visão geral", Component: VisaoGeralPage },
  { segmento: "campanha", rotulo: "Campanha", Component: CampanhaPage },
  { segmento: "hierarquia", rotulo: "Hierarquia", Component: HierarquiaPage },
  { segmento: "adesao", rotulo: "Adesão", Component: AdesaoPage },
  { segmento: "pedidos", rotulo: "Pedidos", Component: PedidosPage },
  { segmento: "rankings", rotulo: "Rankings", Component: RankingsPage },
  { segmento: "bumbo", rotulo: "Bumbo", Component: BumboPage },
  {
    segmento: "conferencia",
    rotulo: "Conferência",
    Component: ConferenciaPage,
  },
  {
    segmento: "acessos",
    rotulo: "Acessos",
    Component: AcessosPage,
    papeis: ["admin"],
  },
];

/** A tela aparece para este papel (no menu e na rota)? */
export function telaVisivelPara(tela: TelaCoordenacao, papel: Papel): boolean {
  return tela.papeis === undefined || tela.papeis.includes(papel);
}

/** Links do menu da coordenação para quem tem este papel. */
export function itensDaNavegacao(papel: Papel): ItemNavegacao[] {
  return TELAS_COORDENACAO.filter((tela) => telaVisivelPara(tela, papel)).map(
    ({ segmento, rotulo }) => ({
      para: segmento ? `/coordenacao/${segmento}` : "/coordenacao",
      rotulo,
      exato: segmento === "",
    }),
  );
}
