import type { ReactNode } from "react";
import { juntarClasses } from "./classes";
import { Icone } from "./Icone";
import type { NomeIcone } from "./icones";
import "./Card.css";

type Props = {
  /** Título do cartão (<h2>). */
  titulo?: ReactNode;
  /** Ícone antes do título (RIFA-049; só visual: o nome do título não muda). */
  icone?: NomeIcone;
  /** "destaque": a borda roxa de 2 px (o destaque da /minha). */
  variante?: "destaque";
  /** Botões ou links no canto do cabeçalho. */
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Card({
  titulo,
  icone,
  variante,
  acoes,
  children,
  className,
}: Props) {
  return (
    <div
      className={juntarClasses(
        "ui-card",
        variante && `ui-card--${variante}`,
        className,
      )}
    >
      {(titulo || acoes) && (
        <div className="ui-card__cabecalho">
          {titulo && (
            <h2 className="ui-card__titulo">
              {icone && <Icone nome={icone} className="ui-card__icone" />}
              {titulo}
            </h2>
          )}
          {acoes && <div className="ui-card__acoes">{acoes}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
