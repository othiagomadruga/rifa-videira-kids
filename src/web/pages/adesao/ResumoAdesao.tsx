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
  /**
   * Celular: os três números numa linha de etiquetas, para a fila "Sem célula" ficar logo abaixo, dentro
   * da primeira tela. Computador: os três indicadores e a barra de adesão.
   */
  compacto: boolean;
};

// Os números da reunião em destaque: células vinculadas, células que já venderam e órfãos.
export function ResumoAdesao({ resumo, afiliadosSemCelula, compacto }: Props) {
  const idTitulo = useId();
  const vinculadas = `${formatarNumero(resumo.vinculadas)} de ${formatarNumero(resumo.celulas)}`;
  return (
    <section className="adesao-resumo" aria-labelledby={idTitulo}>
      <h2 id={idTitulo} className="visualmente-oculto">
        Resumo
      </h2>
      {compacto ? (
        <ul className="adesao-resumo-compacto">
          <li>
            <strong>{vinculadas}</strong> vinculadas
          </li>
          <li>
            <strong>{formatarNumero(resumo.com_venda)}</strong> já venderam
          </li>
          <li data-destaque={afiliadosSemCelula > 0 ? "" : undefined}>
            <strong>{formatarNumero(afiliadosSemCelula)}</strong> sem célula
          </li>
        </ul>
      ) : (
        <>
          {/* A cara única dos números (RIFA-051, P3.5): o chip do ícone no tom; o rótulo diz o que é. */}
          <div className="grade adesao-resumo__numeros">
            <Stat
              rotulo="Células vinculadas"
              valor={vinculadas}
              icone="link"
              tom="marca"
            />
            <Stat
              rotulo="Células que já venderam"
              valor={formatarNumero(resumo.com_venda)}
              icone="check"
              tom="sucesso"
            />
            <Stat
              rotulo="Afiliados sem célula"
              valor={formatarNumero(afiliadosSemCelula)}
              icone={afiliadosSemCelula > 0 ? "alerta" : "check"}
              tom={afiliadosSemCelula > 0 ? "alerta" : "neutro"}
            />
          </div>
          <ProgressBar
            rotulo="Adesão das células"
            valor={resumo.vinculadas}
            meta={resumo.celulas}
          />
        </>
      )}
    </section>
  );
}
