import type { ReactNode } from "react";
import { Button } from "./Button";
import { juntarClasses } from "./classes";
import { ComDica } from "./Dica";
import { Icone } from "./Icone";
import "./Estados.css";

/** Título padrão da falha de conexão (RIFA-049): passageira, sem cara de erro. */
export const TITULO_SEM_CONEXAO = "Sem conexão agora";

type Props = {
  titulo?: string;
  /** Detalhe para o usuário. Com ErroApi, use mensagemDoErro(erro) de lib/api. */
  mensagem?: ReactNode;
  /** Mostra o botão "Tentar de novo". */
  aoTentarDeNovo?: () => void;
  /**
   * A falha é da conexão (sem internet, tempo esgotado: `ehFalhaDeConexao(erro)` de lib/api): cartão neutro, com o
   * ícone de sem conexão e o título "Sem conexão agora". Sem ela, a falha de verdade, em vermelho.
   */
  conexao?: boolean;
};

// Estado de erro, anunciado aos leitores de tela (role="alert"). A falha de conexão (comum e passageira num celular
// com sinal fraco) não usa o vermelho: o vermelho fica para a falha de verdade.
export function ErrorState({
  titulo,
  mensagem,
  aoTentarDeNovo,
  conexao = false,
}: Props) {
  return (
    <div
      className={juntarClasses(
        "ui-estado",
        conexao ? "ui-estado--conexao" : "ui-estado--erro",
      )}
      role="alert"
    >
      {conexao && (
        <span className="ui-estado__icone" aria-hidden="true">
          <Icone nome="sem-conexao" />
        </span>
      )}
      <p className="ui-estado__titulo">
        {titulo ??
          (conexao
            ? TITULO_SEM_CONEXAO
            : "Não foi possível carregar os dados.")}
      </p>
      {mensagem && <p className="ui-estado__descricao">{mensagem}</p>}
      {aoTentarDeNovo && (
        <div className="ui-estado__acao">
          <ComDica texto="Busca de novo o que não carregou. Se continuar falhando, confira a internet.">
            <Button variante="secundario" onClick={aoTentarDeNovo}>
              {conexao && <Icone nome="atualizar" />}
              Tentar de novo
            </Button>
          </ComDica>
        </div>
      )}
    </div>
  );
}
