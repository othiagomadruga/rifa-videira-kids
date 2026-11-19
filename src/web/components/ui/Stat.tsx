import { useId, type ReactNode } from "react";
import { TextoContado } from "../movimento";
import { ComAjuda, type TextoDeAjuda } from "./Ajuda";
import { juntarClasses } from "./classes";
import { Icone } from "./Icone";
import type { NomeIcone } from "./icones";
import "./Stat.css";

export type SentidoVariacao = "subiu" | "caiu" | "estavel";
export type TomVariacao = "positivo" | "negativo" | "neutro";
/** O tom do chip do ícone (RIFA-049). Nunca é só cor: o rótulo diz o que é. */
export type TomStat = "neutro" | "marca" | "sucesso" | "alerta";

type Props = {
  rotulo: string;
  /** O que o número quer dizer e de onde ele vem (RIFA-066): no rótulo e no "?" ao lado (Ajuda.tsx). */
  ajuda?: TextoDeAjuda;
  /** Valor já formatado (use lib/formatadores). */
  valor: ReactNode;
  variacao?: {
    /** Texto da variação, ex.: "+12% na semana". */
    texto: string;
    sentido: SentidoVariacao;
    /** Cor da variação. Padrão: subiu = positivo, caiu = negativo. */
    tom?: TomVariacao;
  };
  /** "grande": o número em destaque (ex.: o total da campanha). Padrão: "normal". */
  tamanho?: "normal" | "grande";
  /** Ícone num chip ao lado do rótulo (só visual), ex.: "pedidos". */
  icone?: NomeIcone;
  /** A cor do chip do ícone (só com `icone`). Padrão: "neutro". */
  tom?: TomStat;
};

const ICONE_DO_SENTIDO: Record<SentidoVariacao, NomeIcone> = {
  subiu: "subiu",
  caiu: "caiu",
  estavel: "estavel",
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
// ("1.234", "35%", "R$ 1.234,56") conta até o valor ao aparecer e ao mudar (sem prefers-reduced-motion). Com `icone`,
// o rótulo ganha um chip com o ícone no `tom` (RIFA-049: um jeito só de mostrar um número, no lugar das bordas
// coloridas de cada tela).
export function Stat({
  rotulo,
  ajuda,
  valor,
  variacao,
  tamanho = "normal",
  icone,
  tom = "neutro",
}: Props) {
  const idRotulo = useId();
  const textoDoRotulo = (
    <ComAjuda texto={ajuda} idDoTitulo={idRotulo}>
      <p id={idRotulo} className="ui-stat__rotulo">
        {rotulo}
      </p>
    </ComAjuda>
  );
  return (
    <div
      className={juntarClasses(
        "ui-stat",
        tamanho === "grande" && "ui-stat--grande",
      )}
    >
      {icone ? (
        <div className="ui-stat__topo">
          <span
            className={`ui-stat__icone ui-stat__icone--${tom}`}
            aria-hidden="true"
          >
            <Icone nome={icone} />
          </span>
          {textoDoRotulo}
        </div>
      ) : (
        textoDoRotulo
      )}
      <p className="ui-stat__valor">
        {typeof valor === "string" ? <TextoContado texto={valor} /> : valor}
      </p>
      {variacao && (
        <p
          className={`ui-stat__variacao ui-stat__variacao--${
            variacao.tom ?? TOM_PADRAO[variacao.sentido]
          }`}
        >
          <Icone nome={ICONE_DO_SENTIDO[variacao.sentido]} />
          <span className="visualmente-oculto">
            {SENTIDO_LIDO[variacao.sentido]}:
          </span>{" "}
          {variacao.texto}
        </p>
      )}
    </div>
  );
}
