import type { ReactNode } from "react";
import "./Estados.css";

type Props = {
  titulo: string;
  descricao?: ReactNode;
  /** Botão ou link para o próximo passo. */
  acao?: ReactNode;
};

// Estado vazio: quando não há nada para mostrar (ainda).
export function EmptyState({ titulo, descricao, acao }: Props) {
  return (
    <div className="ui-estado ui-estado--vazio">
      <p className="ui-estado__titulo">{titulo}</p>
      {descricao && <p className="ui-estado__descricao">{descricao}</p>}
      {acao && <div className="ui-estado__acao">{acao}</div>}
    </div>
  );
}
