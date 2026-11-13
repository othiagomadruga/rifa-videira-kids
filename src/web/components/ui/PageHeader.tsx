import type { ReactNode } from "react";
import { tituloDaAba } from "../../tema/marca";
import { juntarClasses } from "./classes";
import { IconeDaTela } from "./IconeDaTela";
import type { NomeIcone } from "./icones";
import "./PageHeader.css";

type Props = {
  /** Título da tela: vira o <h1> e o título da aba do navegador. */
  titulo: string;
  descricao?: ReactNode;
  /** Botões ou links à direita do título (embaixo dele no celular). */
  acoes?: ReactNode;
  /**
   * O ícone grande da tela (o IconeDaTela), à esquerda do traço e do título, só visual (RIFA-053): a 404 e o erro de
   * rota. As telas de trabalho ficam sem.
   */
  icone?: NomeIcone;
};

// Cabeçalho de toda tela: um <h1> por página. O <title> é levado ao <head> pelo React.
export function PageHeader({ titulo, descricao, acoes, icone }: Props) {
  return (
    <header
      className={juntarClasses(
        "ui-page-header",
        icone && "ui-page-header--com-icone",
      )}
    >
      <title>{tituloDaAba(titulo)}</title>
      <div className="ui-page-header__textos">
        {icone && <IconeDaTela nome={icone} />}
        <h1 className="ui-page-header__titulo">{titulo}</h1>
        {descricao && <p className="ui-page-header__descricao">{descricao}</p>}
      </div>
      {acoes && <div className="ui-page-header__acoes">{acoes}</div>}
    </header>
  );
}
