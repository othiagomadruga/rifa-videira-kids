import type { ReactNode } from "react";
import { TextoContado } from "../movimento";
import "./Stat.css";

export type SentidoVariacao = "subiu" | "caiu" | "estavel";
export type TomVariacao = "positivo" | "negativo" | "neutro";

type Props = {
  rotulo: string;
  /** Valor já formatado (use lib/formatadores). */
  valor: ReactNode;
  variacao?: {
    /** Texto da variação, ex.: "+12% na semana". */
    texto: string;
    sentido: SentidoVariacao;
    /** Cor da variação. Padrão: subiu = positivo, caiu = negativo. */
    tom?: TomVariacao;
  };
};

const SETAS: Record<SentidoVariacao, string> = {
  subiu: "↑",
  caiu: "↓",
  estavel: "→",
};

const SENTIDO_LIDO: Record<SentidoVariacao, string> = {
  subiu: "Subiu",
  caiu: "Caiu",
  estavel: "Estável",
};

const TOM_PADRAO: Record<SentidoVariacao, TomVariacao> = {
  subiu: "positivo",
  caiu: "negativo",
  estavel: "neutro",
};

// Indicador: rótulo, valor em destaque e, opcionalmente, a variação. Um valor que é só um número formatado
// ("1.234", "35%", "R$ 1.234,56") conta até o valor ao aparecer e ao mudar (sem prefers-reduced-motion).
export function Stat({ rotulo, valor, variacao }: Props) {
  return (
    <div className="ui-stat">
      <p className="ui-stat__rotulo">{rotulo}</p>
      <p className="ui-stat__valor">
        {typeof valor === "string" ? <TextoContado texto={valor} /> : valor}
      </p>
      {variacao && (
        <p
          className={`ui-stat__variacao ui-stat__variacao--${
            variacao.tom ?? TOM_PADRAO[variacao.sentido]
          }`}
        >
          <span aria-hidden="true">{SETAS[variacao.sentido]}</span>
          <span className="visualmente-oculto">
            {SENTIDO_LIDO[variacao.sentido]}:
          </span>{" "}
          {variacao.texto}
        </p>
      )}
    </div>
  );
}
