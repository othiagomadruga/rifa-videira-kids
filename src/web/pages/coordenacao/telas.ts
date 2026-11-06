import type { ComponentType } from "react";
import type { ItemNavegacao } from "../../components/ui";
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
];

export const ITENS_NAVEGACAO_COORDENACAO: readonly ItemNavegacao[] =
  TELAS_COORDENACAO.map(({ segmento, rotulo }) => ({
    para: segmento ? `/coordenacao/${segmento}` : "/coordenacao",
    rotulo,
    exato: segmento === "",
  }));
