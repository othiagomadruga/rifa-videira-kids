import { useRouteError } from "react-router";
import { ErrorState, PageHeader } from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { ajudaAberta } from "../ranking-publico/ajuda-sob-demanda";

// Mostrado quando uma tela quebra ao renderizar (ErrorBoundary das rotas), no
// lugar da tela padrão de erro do React Router.
export function ErroRota() {
  const erro = useRouteError();
  return (
    <>
      {/* O alerta ao lado do título (RIFA-050; no PageHeader desde a RIFA-053). */}
      <PageHeader
        icone="alerta"
        titulo="Algo deu errado"
        ajuda={ajudaAberta("erro")}
      />
      <ErrorState
        titulo="Esta tela encontrou um erro inesperado."
        mensagem={mensagemDoErro(erro)}
        aoTentarDeNovo={() => window.location.reload()}
      />
    </>
  );
}
