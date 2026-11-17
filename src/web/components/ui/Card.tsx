import { useId, type ReactNode } from "react";
import { ComAjuda, type TextoDeAjuda } from "./Ajuda";
import { juntarClasses } from "./classes";
import { Icone } from "./Icone";
import type { NomeIcone } from "./icones";
import "./Card.css";

type Props = {
  /** Título do cartão (<h2>). */
  titulo?: ReactNode;
  /**
   * A explicação do título (RIFA-066): o que é a seção, para que serve e, se há escolha, um exemplo. Aparece com o
   * mouse no título e no "?" ao lado, no foco e no toque do "?" (veja Ajuda.tsx). Todo cartão com título tem.
   */
  ajuda?: TextoDeAjuda;
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
  ajuda,
  icone,
  variante,
  acoes,
  children,
  className,
}: Props) {
  const idTitulo = useId();
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
            <ComAjuda texto={ajuda} idDoTitulo={idTitulo}>
              <h2 id={idTitulo} className="ui-card__titulo">
                {icone && <Icone nome={icone} className="ui-card__icone" />}
                {titulo}
              </h2>
            </ComAjuda>
          )}
          {acoes && <div className="ui-card__acoes">{acoes}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
