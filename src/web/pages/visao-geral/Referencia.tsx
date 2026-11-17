import { Fragment, useId } from "react";
import type { RespostaPainelResumo } from "../../../shared/contracts/calculos";
import { ComAjuda } from "../../components/ui";
import { ajuda } from "./ajuda-sob-demanda";
import { ROTULO_DO_ESCOPO, textoDaFase } from "./textos";

type Props = { resumo: RespostaPainelResumo };

// CA1: em que dia e período a campanha está (ou a contagem regressiva, ou "encerrada") e o recorte.
export function Referencia({ resumo }: Props) {
  const idFase = useId();
  const { escopo } = resumo;
  const fase = textoDaFase(resumo.referencia);
  return (
    <section
      className="visao-referencia"
      aria-labelledby={idFase}
      data-fase={resumo.referencia.fase}
    >
      <p className="visao-referencia__escopo">
        <span className="visao-referencia__tipo">
          {ROTULO_DO_ESCOPO[escopo.tipo]}
          <span className="visualmente-oculto">:</span>
        </span>{" "}
        <strong>{escopo.nome}</strong>
      </p>
      <ComAjuda texto={ajuda("referencia")} idDoTitulo={idFase}>
        <h2 id={idFase} className="visao-referencia__fase">
          {/* Cada parte quebra de linha inteira, se couber: "Semana 2 (faltam 6 dias)" não se parte. */}
          {fase.partes.map((parte, indice) => (
            <Fragment key={indice}>
              {indice > 0 && " · "}
              <span className="visao-referencia__parte">{parte}</span>
            </Fragment>
          ))}
        </h2>
      </ComAjuda>
      <p className="visao-referencia__detalhe">{fase.detalhe}</p>
    </section>
  );
}
