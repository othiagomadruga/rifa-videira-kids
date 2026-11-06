import type { ReactNode } from "react";
import "./Badge.css";

export type TomBadge = "neutro" | "info" | "sucesso" | "alerta" | "perigo";

type Props = {
  /** Cor do status. O texto precisa fazer sentido sozinho (a cor só reforça). */
  tom?: TomBadge;
  children: ReactNode;
};

export function Badge({ tom = "neutro", children }: Props) {
  return <span className={`ui-badge ui-badge--${tom}`}>{children}</span>;
}
