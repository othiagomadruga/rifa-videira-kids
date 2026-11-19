import type { ComponentType } from "react";
import type { Papel } from "../../../shared/contracts";
import type { ItemNavegacao, NomeIcone } from "../../components/ui";
import { AcessosPage } from "../acessos/AcessosPage";
import { AdesaoPage } from "../adesao/AdesaoPage";
import { BumboPage } from "../bumbo/BumboPage";
import { CampanhaPage } from "../campanha/CampanhaPage";
import { ConferenciaPage } from "../conferencia/ConferenciaPage";
import { HierarquiaPage } from "../hierarquia/HierarquiaPage";
import { MapaPage } from "../mapa/MapaPage";
import { MinhaSenhaPage } from "../minha-senha/MinhaSenhaPage";
import { PedidosPage } from "../pedidos/PedidosPage";
import { PedidosSuspeitosPage } from "../pedidos-suspeitos/PedidosSuspeitosPage";
import { RankingsPage } from "../rankings/RankingsPage";
import { TrilhaPage } from "../trilha/TrilhaPage";
import { VisaoGeralPage } from "../visao-geral/VisaoGeralPage";
import { DICA_DO_MENU } from "./textos";

export type TelaCoordenacao = {
  /** Segmento depois de /coordenacao; "" é a tela inicial (Visão geral). */
  segmento: string;
  /** Texto do link no menu. */
  rotulo: string;
  /** Dica do link no menu (RIFA-045): o que a tela faz, em 1 ou 2 frases curtas (textos.ts). */
  dica: string;
  /** Ícone do link no menu (RIFA-051, D25): um nome de components/ui/icones.ts, à esquerda do rótulo, só visual. */
  icone: NomeIcone;
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
  {
    segmento: "",
    rotulo: "Visão geral",
    dica: DICA_DO_MENU[""],
    icone: "visao-geral",
    Component: VisaoGeralPage,
  },
  {
    segmento: "campanha",
    rotulo: "Campanha",
    dica: DICA_DO_MENU.campanha,
    icone: "campanha",
    Component: CampanhaPage,
  },
  {
    segmento: "hierarquia",
    rotulo: "Hierarquia",
    dica: DICA_DO_MENU.hierarquia,
    icone: "hierarquia",
    Component: HierarquiaPage,
  },
  {
    segmento: "adesao",
    rotulo: "Adesão",
    dica: DICA_DO_MENU.adesao,
    icone: "adesao",
    Component: AdesaoPage,
  },
  {
    segmento: "pedidos",
    rotulo: "Pedidos",
    dica: DICA_DO_MENU.pedidos,
    icone: "pedidos",
    Component: PedidosPage,
  },
  {
    segmento: "pedidos-suspeitos",
    rotulo: "Pedidos suspeitos",
    dica: DICA_DO_MENU["pedidos-suspeitos"],
    icone: "suspeito",
    Component: PedidosSuspeitosPage,
  },
  {
    segmento: "rankings",
    rotulo: "Rankings",
    dica: DICA_DO_MENU.rankings,
    icone: "ranking",
    Component: RankingsPage,
  },
  // Mapa de vendas por DDD (RIFA-015): GET /api/painel/mapa-ddd é de toda a coordenação.
  {
    segmento: "mapa",
    rotulo: "Mapa",
    dica: DICA_DO_MENU.mapa,
    icone: "mapa",
    Component: MapaPage,
  },
  {
    segmento: "bumbo",
    rotulo: "Bumbo",
    dica: DICA_DO_MENU.bumbo,
    icone: "bumbo",
    Component: BumboPage,
  },
  {
    segmento: "conferencia",
    rotulo: "Conferência",
    dica: DICA_DO_MENU.conferencia,
    icone: "conferencia",
    Component: ConferenciaPage,
  },
  {
    segmento: "acessos",
    rotulo: "Acessos",
    dica: DICA_DO_MENU.acessos,
    icone: "acessos",
    Component: AcessosPage,
    papeis: ["admin"],
  },
  // A trilha de auditoria: GET /api/admin/auditoria é só do admin (ROTAS.auditoria.papeis).
  {
    segmento: "trilha",
    rotulo: "Trilha",
    dica: DICA_DO_MENU.trilha,
    icone: "trilha",
    Component: TrilhaPage,
    papeis: ["admin"],
  },
  // RIFA-073 (D33): o usuário e a senha do próprio admin (GET, PUT e DELETE /api/admin/minha-senha, só admin).
  {
    segmento: "minha-senha",
    rotulo: "Minha senha",
    dica: DICA_DO_MENU["minha-senha"],
    icone: "chave",
    Component: MinhaSenhaPage,
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
    ({ segmento, rotulo, dica, icone }) => ({
      para: segmento ? `/coordenacao/${segmento}` : "/coordenacao",
      rotulo,
      exato: segmento === "",
      dica,
      icone,
    }),
  );
}
