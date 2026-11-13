import { juntarClasses } from "./classes";
import { ICONES, type NomeIcone } from "./icones";
import "./Icone.css";

type Props = {
  /** Qual desenho (a chave de icones.ts), ex.: "copiar". */
  nome: NomeIcone;
  /** Lado do ícone (um tamanho do CSS, ex.: "1rem"). Padrão: 1.25em, que acompanha o texto em volta. */
  tamanho?: string;
  className?: string;
};

// Ícone SVG próprio (RIFA-049, D25): traço de 2 em currentColor (a cor do texto em volta), só visual. O nome
// acessível fica no botão ou no texto ao lado (o ícone é aria-hidden, sem <title>, e não recebe foco). Os desenhos
// são só dados (icones.ts), desenhados com elementos do React (nada de HTML em texto).
export function Icone({ nome, tamanho, className }: Props) {
  return (
    <svg
      className={juntarClasses("ui-icone", className)}
      data-icone={nome}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={tamanho ? { width: tamanho, height: tamanho } : undefined}
    >
      <path d={ICONES[nome]} />
    </svg>
  );
}
