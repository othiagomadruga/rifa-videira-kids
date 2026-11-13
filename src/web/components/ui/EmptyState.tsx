import type { ReactNode } from "react";
import { Icone } from "./Icone";
import type { NomeIcone } from "./icones";
import "./Estados.css";

type Props = {
  titulo: string;
  descricao?: ReactNode;
  /** Botão ou link para o próximo passo. */
  acao?: ReactNode;
  /** Ícone num círculo de marca acima do título (só visual), ex.: "trofeu" no ranking vazio. */
  icone?: NomeIcone;
};

// Estado vazio: quando não há nada para mostrar (ainda).
export function EmptyState({ titulo, descricao, acao, icone }: Props) {
  return (
    <div className="ui-estado ui-estado--vazio">
      {icone && (
        <span className="ui-estado__icone" aria-hidden="true">
          <Icone nome={icone} />
        </span>
      )}
      <p className="ui-estado__titulo">{titulo}</p>
      {descricao && <p className="ui-estado__descricao">{descricao}</p>}
      {acao && <div className="ui-estado__acao">{acao}</div>}
    </div>
  );
}
