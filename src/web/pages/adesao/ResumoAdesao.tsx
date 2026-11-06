import { useId } from "react";
import { ProgressBar, Stat } from "../../components/ui";
import { formatarNumero } from "../../lib/formatadores";
import type { RespostaAdesao } from "./adesao-api";

type Props = {
  resumo: RespostaAdesao["resumo"];
  /**
   * Tamanho da fila de órfãos que a tela mostra (mesma consulta da seção "Sem célula"), para os dois
   * números baterem mesmo que um afiliado chegue entre as duas consultas.
   */
  afiliadosSemCelula: number;
};

// Os números da reunião em destaque: células vinculadas, células que já venderam e órfãos.
export function ResumoAdesao({ resumo, afiliadosSemCelula }: Props) {
  const idTitulo = useId();
  return (
    <section className="adesao-resumo" aria-labelledby={idTitulo}>
      <h2 id={idTitulo} className="visualmente-oculto">
        Resumo
      </h2>
      <div className="grade adesao-resumo__numeros">
        <Stat
          rotulo="Células vinculadas"
          valor={`${formatarNumero(resumo.vinculadas)} de ${formatarNumero(resumo.celulas)}`}
        />
        <Stat
          rotulo="Células que já venderam"
          valor={formatarNumero(resumo.com_venda)}
        />
        <Stat
          rotulo="Afiliados sem célula"
          valor={formatarNumero(afiliadosSemCelula)}
        />
      </div>
      <ProgressBar
        rotulo="Adesão das células"
        valor={resumo.vinculadas}
        meta={resumo.celulas}
      />
    </section>
  );
}
