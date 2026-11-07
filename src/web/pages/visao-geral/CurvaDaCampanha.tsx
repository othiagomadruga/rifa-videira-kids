import type { RespostaPainelResumo } from "../../../shared/contracts/calculos";
import { Card, GraficoLinhas } from "../../components/ui";
import { formatarData, formatarNumero } from "../../lib/formatadores";
import {
  NOME_DA_UNIDADE,
  dataCurta,
  descricaoDaCurva,
  valorCurto,
  valorDoEixo,
} from "./textos";

type Props = { resumo: RespostaPainelResumo };

// CA3: a curva da campanha, esperado acumulado (tracejado) × realizado acumulado (cheio), um ponto por dia.
export function CurvaDaCampanha({ resumo }: Props) {
  const { curva, referencia, unidade } = resumo;
  const nomeDaUnidade = NOME_DA_UNIDADE[unidade];
  const ultimo = curva.at(-1);
  return (
    <Card titulo="Curva: esperado × realizado" className="visao-curva">
      <p className="visao-curva__subtitulo">
        Acumulado por dia, em {nomeDaUnidade}.
      </p>
      <GraficoLinhas
        titulo={`Esperado e realizado acumulados por dia, em ${nomeDaUnidade}`}
        descricao={descricaoDaCurva(resumo)}
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
            valores: curva.map((ponto) => ponto.realizado),
          },
          {
            rotulo: "Esperado pela curva",
            estilo: "referencia",
            valores: curva.map((ponto) => ponto.esperado),
            rotuloFinal: ultimo
              ? `Meta ${valorCurto(ultimo.esperado, unidade)}`
              : null,
          },
        ]}
        extras={[
          {
            rotulo: "Vendido no dia",
            valores: curva.map((ponto) => ponto.realizado_no_dia),
          },
        ]}
        formatarValor={(valor) => valorCurto(valor, unidade)}
        formatarEixo={(valor) => valorDoEixo(valor, unidade)}
        indiceAtual={
          referencia.fase === "durante" && referencia.dia_campanha !== null
            ? referencia.dia_campanha - 1
            : null
        }
        rotuloAtual="hoje"
      />
    </Card>
  );
}
