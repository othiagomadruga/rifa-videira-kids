import type { ReactNode } from "react";
import { juntarClasses } from "./classes";
import "./IndicadorSituacao.css";

export type TomSituacao = "sucesso" | "alerta" | "perigo" | "neutro";

type Props = {
  tom: TomSituacao;
  /** A situação em poucas palavras, que faz sentido sem a cor (ex.: "Em dia", "Abaixo do esperado"). */
  titulo: string;
  /** O quanto (ex.: "6 bilhetes acima do esperado"). */
  children?: ReactNode;
  /** Símbolo ao lado (só visual). Padrão: ✓ no sucesso, ! no alerta e no perigo, – no neutro. */
  icone?: string;
  className?: string;
};

const ICONE_PADRAO: Record<TomSituacao, string> = {
  sucesso: "✓",
  alerta: "!",
  perigo: "!",
  neutro: "–",
};

// Situação de um indicador (em dia, abaixo, sem meta...): ícone, título e detalhe. Não é região viva:
// numa tela que se atualiza sozinha, anunciar a cada consulta seria ruído.
export function IndicadorSituacao({
  tom,
  titulo,
  children,
  icone = ICONE_PADRAO[tom],
  className,
}: Props) {
  return (
    <div
      className={juntarClasses("ui-situacao", `ui-situacao--${tom}`, className)}
    >
      <span className="ui-situacao__icone" aria-hidden="true">
        {icone}
      </span>
      <div className="ui-situacao__textos">
        <p className="ui-situacao__titulo">{titulo}</p>
        {children && <p className="ui-situacao__detalhe">{children}</p>}
      </div>
    </div>
  );
}
