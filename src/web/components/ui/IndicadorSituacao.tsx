import type { ReactNode } from "react";
import { juntarClasses } from "./classes";
import { Icone } from "./Icone";
import { ehNomeDeIcone, type NomeIcone } from "./icones";
import "./IndicadorSituacao.css";

export type TomSituacao = "sucesso" | "alerta" | "perigo" | "neutro";

type Props = {
  tom: TomSituacao;
  /** A situação em poucas palavras, que faz sentido sem a cor (ex.: "Em dia", "Abaixo do esperado"). */
  titulo: string;
  /** O quanto (ex.: "6 bilhetes acima do esperado"). */
  children?: ReactNode;
  /**
   * O ícone do chip (só visual): um nome de icones.ts (ex.: "caiu"). Padrão: check no sucesso, alerta no alerta e no
   * perigo, menos no neutro. Os caracteres de antes (↓ ↑ ✓ ! –) viram o ícone equivalente; outro caractere aparece
   * como texto.
   */
  icone?: string;
  className?: string;
};

const ICONE_PADRAO: Record<TomSituacao, NomeIcone> = {
  sucesso: "check",
  alerta: "alerta",
  perigo: "alerta",
  neutro: "menos",
};

/**
 * Os caracteres que as telas passavam antes dos ícones (RIFA-049): o desenho não muda de celular para celular. Um Map,
 * e não um objeto: num objeto comum, "toString" ou "constructor" achariam o protótipo e virariam um "ícone" (RIFA-053).
 */
const ICONE_DO_CARACTERE: ReadonlyMap<string, NomeIcone> = new Map([
  ["↓", "caiu"],
  ["↑", "subiu"],
  ["→", "estavel"],
  ["✓", "check"],
  ["!", "alerta"],
  ["–", "menos"],
]);

function desenhoDoIcone(icone: string): ReactNode {
  const nome = ehNomeDeIcone(icone) ? icone : ICONE_DO_CARACTERE.get(icone);
  return nome ? <Icone nome={nome} /> : icone;
}

// Situação de um indicador (em dia, abaixo, sem meta...): o chip do ícone, o título e o detalhe, num bloco de fundo
// suave (o Aviso, que é alerta, fica com a faixa). Não é região viva: numa tela que se atualiza sozinha, anunciar a
// cada consulta seria ruído.
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
        {desenhoDoIcone(icone)}
      </span>
      <div className="ui-situacao__textos">
        <p className="ui-situacao__titulo">{titulo}</p>
        {children && <p className="ui-situacao__detalhe">{children}</p>}
      </div>
    </div>
  );
}
