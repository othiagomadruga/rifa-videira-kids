import type { ReactNode } from "react";
import { tituloDaAba } from "../../tema/marca";
import "./PageHeader.css";

type Props = {
  /** Título da tela: vira o <h1> e o título da aba do navegador. */
  titulo: string;
  descricao?: ReactNode;
  /** Botões ou links à direita do título (embaixo dele no celular). */
  acoes?: ReactNode;
};

// Cabeçalho de toda tela: um <h1> por página. O <title> é levado ao <head> pelo React.
export function PageHeader({ titulo, descricao, acoes }: Props) {
  return (
    <header className="ui-page-header">
      <title>{tituloDaAba(titulo)}</title>
      <div className="ui-page-header__textos">
        <h1 className="ui-page-header__titulo">{titulo}</h1>
        {descricao && <p className="ui-page-header__descricao">{descricao}</p>}
      </div>
      {acoes && <div className="ui-page-header__acoes">{acoes}</div>}
    </header>
  );
}
