import { useId } from "react";
import { formatarPercentual } from "../../lib/formatadores";
import "./ProgressBar.css";

type Props = {
  rotulo: string;
  /** Quanto já foi alcançado, na mesma unidade da meta (centavos, bilhetes, pontos-base...). */
  valor: number;
  /** A meta (100%). */
  meta: number;
  /** Texto do valor ao lado do rótulo (e lido pelo leitor de tela). Padrão: o percentual, ex.: "35%". */
  textoValor?: string;
};

// Barra de progresso da meta. Para leitores de tela expõe só o percentual
// (aria-valuenow de 0 a 100), nunca o valor bruto. Passou da meta: a barra fica
// cheia, o texto mostra o percentual real (ex.: "120%") e a cor muda.
export function ProgressBar({ rotulo, valor, meta, textoValor }: Props) {
  const idRotulo = useId();
  // Multiplica antes de dividir: com inteiros a conta fica exata (35/100 dá 3500,
  // não 3499,99...), e o truncamento não erra o percentual para baixo.
  const pontosBase =
    meta > 0 && Number.isFinite(valor)
      ? Math.max(0, Math.trunc((valor * 10_000) / meta))
      : 0;
  const preenchido = Math.min(100, pontosBase / 100);
  const texto = textoValor ?? formatarPercentual(pontosBase);

  return (
    <div
      className="ui-progress"
      data-completa={pontosBase >= 10_000 ? "" : undefined}
    >
      <div className="ui-progress__cabecalho">
        <span id={idRotulo} className="ui-progress__rotulo">
          {rotulo}
        </span>
        <span className="ui-progress__valor" aria-hidden="true">
          {texto}
        </span>
      </div>
      <div
        className="ui-progress__trilho"
        role="progressbar"
        aria-labelledby={idRotulo}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.trunc(preenchido)}
        aria-valuetext={texto}
      >
        <div
          className="ui-progress__barra"
          style={{ width: `${preenchido}%` }}
        />
      </div>
    </div>
  );
}
