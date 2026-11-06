import { Outlet, type RouteObject } from "react-router";
import { PublicShell } from "./components/ui";
import { CoordenacaoLayout } from "./pages/coordenacao/CoordenacaoLayout";
import { TELAS_COORDENACAO } from "./pages/coordenacao/telas";
import { EntrarPage } from "./pages/entrar/EntrarPage";
import { ErroRota } from "./pages/erro/ErroRota";
import { NaoEncontradaPage } from "./pages/nao-encontrada/NaoEncontradaPage";
import { RankingPublicoPage } from "./pages/ranking-publico/RankingPublicoPage";
import { StatusPage } from "./pages/status/StatusPage";
import { TelaoPage } from "./pages/telao/TelaoPage";

// Rotas do site. Cada tela mora na própria pasta em pages/; as telas da
// coordenação vêm de pages/coordenacao/telas.ts (a mesma lista gera o menu).
//
//   /                 ranking público (sem valores em R$)
//   /telao            telão do culto (sem navegação)
//   /entrar           login da coordenação
//   /coordenacao/...  área da coordenação (menu lateral)
//   /status           saúde da API
//   qualquer outra    404
export const rotas: RouteObject[] = [
  {
    path: "/",
    ErrorBoundary: ErroGeral,
    children: [
      { path: "telao", Component: TelaoPage },
      {
        path: "coordenacao",
        Component: CoordenacaoLayout,
        children: [
          {
            // Erro numa tela da coordenação aparece dentro do layout (com o menu).
            ErrorBoundary: ErroRota,
            children: [
              ...TELAS_COORDENACAO.map(
                ({ segmento, Component }): RouteObject =>
                  segmento === ""
                    ? { index: true, Component }
                    : { path: segmento, Component },
              ),
              {
                path: "*",
                element: <NaoEncontradaPage inicio="/coordenacao" />,
              },
            ],
          },
        ],
      },
      {
        Component: LayoutPublico,
        children: [
          { index: true, Component: RankingPublicoPage },
          { path: "entrar", Component: EntrarPage },
          { path: "status", Component: StatusPage },
          { path: "*", Component: NaoEncontradaPage },
        ],
      },
    ],
  },
];

function LayoutPublico() {
  return (
    <PublicShell>
      <Outlet />
    </PublicShell>
  );
}

function ErroGeral() {
  return (
    <PublicShell>
      <ErroRota />
    </PublicShell>
  );
}
