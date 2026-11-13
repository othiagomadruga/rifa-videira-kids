import { useId } from "react";
import { formatarPercentual } from "../../lib/formatadores";
import { Icone } from "./Icone";
import "./ProgressBar.css";

type Props = {
  rotulo: string;
  /** Quanto já foi alcançado, na mesma unidade da meta (centavos, bilhetes, pontos-base...). */
  valor: number;
  /** A meta (100%). */
  meta: number;
  /** Texto do valor ao lado do rótulo (e lido pelo leitor de tela). Padrão: o percentual, ex.: "35%". */
  textoValor?: string;
  /**
   * Mostra o valor ao lado do rótulo (padrão: true). false onde o número grande já está na tela (a /minha): o
   * percentual continua no aria-valuetext da barra, então o leitor de tela ouve.
   */
  mostrarValor?: boolean;
};

// Barra de progresso da meta. Para leitores de tela expõe só o percentual (aria-valuenow de 0 a 100), nunca o valor
// bruto. Passou da meta: a barra fica cheia (no degradê da marca), o texto mostra o percentual real (ex.: "120%") na
// pílula amarela do Kids e o fim do trilho ganha o selo do troféu (RIFA-049), com um brilho único que atravessa a barra.
export function ProgressBar({
  rotulo,
  valor,
  meta,
  textoValor,
  mostrarValor = true,
}: Props) {
  const idRotulo = useId();
  // Multiplica antes de dividir: com inteiros a conta fica exata (35/100 dá 3500,
  // não 3499,99...), e o truncamento não erra o percentual para baixo.
  const pontosBase =
    meta > 0 && Number.isFinite(valor)
      ? Math.max(0, Math.trunc((valor * 10_000) / meta))
      : 0;
  const preenchido = Math.min(100, pontosBase / 100);
  const texto = textoValor ?? formatarPercentual(pontosBase);
  const completa = pontosBase >= 10_000;

  return (
    <div className="ui-progress" data-completa={completa ? "" : undefined}>
      <div className="ui-progress__cabecalho">
        <span id={idRotulo} className="ui-progress__rotulo">
          {rotulo}
        </span>
        {mostrarValor && (
          <span className="ui-progress__valor" aria-hidden="true">
            {texto}
          </span>
        )}
      </div>
      <div className="ui-progress__pista">
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
        {completa && (
          <span className="ui-progress__trofeu" aria-hidden="true">
            <Icone nome="trofeu" />
          </span>
        )}
      </div>
    </div>
  );
}
