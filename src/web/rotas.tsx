import { Outlet, type RouteObject } from "react-router";
import { PublicShell } from "./components/ui";
import { ProvedorSessao } from "./lib/sessao";
import { AcessoPage } from "./pages/acesso/AcessoPage";
import { CoordenacaoLayout } from "./pages/coordenacao/CoordenacaoLayout";
import { ExigirPapel } from "./pages/coordenacao/ExigirPapel";
import { TELAS_COORDENACAO } from "./pages/coordenacao/telas";
import { EntrarPage } from "./pages/entrar/EntrarPage";
import { ErroRota } from "./pages/erro/ErroRota";
import { MinhaLayout } from "./pages/minha/MinhaLayout";
import { MinhaPage } from "./pages/minha/MinhaPage";
import { NaoEncontradaPage } from "./pages/nao-encontrada/NaoEncontradaPage";
import { RankingPublicoPage } from "./pages/ranking-publico/RankingPublicoPage";
import { StatusPage } from "./pages/status/StatusPage";
import { TelaoPage } from "./pages/telao/TelaoPage";

// Rotas do site. Cada tela mora na própria pasta em pages/; as telas da
// coordenação vêm de pages/coordenacao/telas.ts (a mesma lista gera o menu).
//
//   /                 ranking público (sem valores em R$)
//   /telao            telão do culto (sem navegação)
//   /acesso/<token>   link pessoal (coordenação, líder, discipulador e rede): confirma
//                     e só então entra; depois, cada papel vai para a sua área
//   /entrar           como entrar (sem sessão)
//   /coordenacao/...  área da coordenação (menu lateral), só com sessão de admin ou
//                     coordenação; líder, discipulador e rede vão para /minha
//   /minha            visão individual de líder, discipulador e rede (sem menu e sem
//                     dinheiro), só com sessão deles; a coordenação vai para /coordenacao
//   /status           saúde da API
//   qualquer outra    404
//
// A sessão (lib/sessao.tsx) fica na raiz: só as guardas das áreas com sessão
// (/coordenacao e /minha) e as telas de entrada perguntam à API; as telas abertas
// não fazem chamada nenhuma por ela.
export const rotas: RouteObject[] = [
  {
    path: "/",
    Component: RaizDoSite,
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
                ({ segmento, rotulo, papeis, Component }): RouteObject => {
                  const element = papeis ? (
                    <ExigirPapel papeis={papeis} titulo={rotulo}>
                      <Component />
                    </ExigirPapel>
                  ) : (
                    <Component />
                  );
                  return segmento === ""
                    ? { index: true, element }
                    : { path: segmento, element };
                },
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
        path: "minha",
        Component: MinhaLayout,
        children: [
          {
            // Erro na visão individual aparece dentro da moldura (com o "Sair").
            ErrorBoundary: ErroRota,
            children: [
              { index: true, Component: MinhaPage },
              { path: "*", element: <NaoEncontradaPage inicio="/minha" /> },
            ],
          },
        ],
      },
      {
        Component: LayoutPublico,
        children: [
          { index: true, Component: RankingPublicoPage },
          // O token fica depois de /acesso/; a tela o tira do endereço ao abrir.
          { path: "acesso/*", Component: AcessoPage },
          { path: "entrar", Component: EntrarPage },
          { path: "status", Component: StatusPage },
          { path: "*", Component: NaoEncontradaPage },
        ],
      },
    ],
  },
];

function RaizDoSite() {
  return (
    <ProvedorSessao>
      <Outlet />
    </ProvedorSessao>
  );
}

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
