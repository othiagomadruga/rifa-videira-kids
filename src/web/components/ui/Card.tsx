import type { ReactNode } from "react";
import { juntarClasses } from "./classes";
import "./Card.css";

type Props = {
  /** Título do cartão (<h2>). */
  titulo?: ReactNode;
  /** Botões ou links no canto do cabeçalho. */
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Card({ titulo, acoes, children, className }: Props) {
  return (
    <div className={juntarClasses("ui-card", className)}>
      {(titulo || acoes) && (
        <div className="ui-card__cabecalho">
          {titulo && <h2 className="ui-card__titulo">{titulo}</h2>}
          {acoes && <div className="ui-card__acoes">{acoes}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
