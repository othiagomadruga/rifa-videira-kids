import { useRouteError } from "react-router";
import { ErrorState, PageHeader } from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { IconeDaTela } from "../entrar/IconeDaTela";

// Mostrado quando uma tela quebra ao renderizar (ErrorBoundary das rotas), no
// lugar da tela padrão de erro do React Router.
export function ErroRota() {
  const erro = useRouteError();
  return (
    <>
      {/* O alerta acima do título (RIFA-050). */}
      <IconeDaTela nome="alerta" />
      <PageHeader titulo="Algo deu errado" />
      <ErrorState
        titulo="Esta tela encontrou um erro inesperado."
        mensagem={mensagemDoErro(erro)}
        aoTentarDeNovo={() => window.location.reload()}
      />
    </>
  );
}
