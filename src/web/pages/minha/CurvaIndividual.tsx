import type { RespostaVisaoIndividual } from "../../../shared/contracts/api";
import { Card, GraficoLinhas } from "../../components/ui";
import {
  formatarData,
  formatarNumero,
  formatarPercentual,
} from "../../lib/formatadores";
import { DICAS, dataCurta, descricaoDaCurva, AJUDA } from "./textos";

const percentual = (pontosBase: number) => formatarPercentual(pontosBase);

// A curva da campanha em % da meta (a mesma ideia da Visão geral da coordenação, em pontos-base): o esperado
// acumulado (tracejado) e o realizado acumulado do alvo (cheio), um ponto por dia. Sem meta, não há curva.
export function CurvaIndividual({ visao }: { visao: RespostaVisaoIndividual }) {
  const { curva, referencia } = visao;
  return (
    <Card
      titulo="Curva da campanha"
      ajuda={AJUDA.curva}
      className="minha-curva"
    >
      {curva.length === 0 ? (
        <p className="minha-curva__subtitulo">
          Ainda não há meta para desenhar a curva.
        </p>
      ) : (
        <>
          <p className="minha-curva__subtitulo">
            Acumulado por dia, em % da meta da campanha.
          </p>
          <GraficoLinhas
            titulo="Esperado e realizado acumulados por dia, em % da meta"
            descricao={descricaoDaCurva(visao)}
            rotulosX={curva.map((ponto) => dataCurta(ponto.data))}
            rotulosPonto={curva.map(
              (ponto) =>
                `Dia ${formatarNumero(ponto.dia)} · ${formatarData(ponto.data)}`,
            )}
            tituloColunaX="Dia"
            series={[
              {
                rotulo: "Realizado",
                estilo: "destaque",
                valores: curva.map((ponto) => ponto.realizado_bp),
              },
              {
                rotulo: "Esperado pela curva",
                estilo: "referencia",
                valores: curva.map((ponto) => ponto.esperado_bp),
                rotuloFinal: "Meta 100%",
              },
            ]}
            formatarValor={percentual}
            indiceAtual={
              referencia.fase === "durante" && referencia.dia_campanha !== null
                ? referencia.dia_campanha - 1
                : null
            }
            rotuloAtual="hoje"
            dicaDados={DICAS.dadosDaCurva}
          />
        </>
      )}
    </Card>
  );
}
