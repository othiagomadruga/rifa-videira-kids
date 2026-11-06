import type { ReactNode } from "react";
import { Button } from "./Button";
import "./Estados.css";

type Props = {
  titulo?: string;
  /** Detalhe para o usuário. Com ErroApi, use mensagemDoErro(erro) de lib/api. */
  mensagem?: ReactNode;
  /** Mostra o botão "Tentar de novo". */
  aoTentarDeNovo?: () => void;
};

// Estado de erro, anunciado aos leitores de tela (role="alert").
export function ErrorState({
  titulo = "Não foi possível carregar os dados.",
  mensagem,
  aoTentarDeNovo,
}: Props) {
  return (
    <div className="ui-estado ui-estado--erro" role="alert">
      <p className="ui-estado__titulo">{titulo}</p>
      {mensagem && <p className="ui-estado__descricao">{mensagem}</p>}
      {aoTentarDeNovo && (
        <div className="ui-estado__acao">
          <Button variante="secundario" onClick={aoTentarDeNovo}>
            Tentar de novo
          </Button>
        </div>
      )}
    </div>
  );
}
