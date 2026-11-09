import { useId } from "react";
import type {
  DesempenhoIndividual,
  RespostaVisaoIndividual,
  RitmoIndividual,
} from "../../../shared/contracts/api";
import type {
  PeriodoDaReferencia,
  UnidadeMeta,
} from "../../../shared/contracts/calculos";
import { Card, IndicadorSituacao, ProgressBar } from "../../components/ui";
import { formatarNumero, formatarPercentual } from "../../lib/formatadores";
import {
  bilhetes,
  dataCurta,
  emBilhetes,
  situacaoDaCampanha,
  situacaoDoPeriodo,
  textoDaFase,
  textoDaMetaAntes,
  textoDaProjecao,
  textoDeHoje,
  textoDoPeriodo,
  type TextoSituacao,
} from "./textos";

function Situacao({ situacao }: { situacao: TextoSituacao }) {
  return (
    <IndicadorSituacao
      tom={situacao.tom}
      titulo={situacao.titulo}
      icone={situacao.icone}
    >
      {situacao.detalhe || undefined}
    </IndicadorSituacao>
  );
}

/** Rótulo da barra da campanha: com a meta em bilhetes, "Vendidos: 42 de 120 bilhetes". */
function rotuloDaBarra(
  desempenho: DesempenhoIndividual,
  unidade: UnidadeMeta,
): string {
  const meta = emBilhetes(desempenho.campanha.meta, unidade);
  const realizado = emBilhetes(desempenho.campanha.realizado, unidade);
  return meta !== null && realizado !== null
    ? `Vendidos: ${formatarNumero(realizado)} de ${bilhetes(meta)}`
    : `Bilhetes vendidos: ${formatarNumero(desempenho.bilhetes.campanha)}`;
}

// O destaque da tela: antes do início, a contagem regressiva; depois, o % da meta da campanha (grande), a
// situação contra a curva, a projeção e a meta de HOJE ("faltam N bilhetes hoje"; com a meta em centavos,
// só o %).
export function Destaque({ visao }: { visao: RespostaVisaoIndividual }) {
  const idTitulo = useId();
  const { referencia, desempenho, unidade } = visao;
  const fase = textoDaFase(referencia);

  if (referencia.fase === "antes") {
    const meta = textoDaMetaAntes(desempenho.campanha, unidade);
    return (
      <section
        className="minha-destaque"
        aria-labelledby={idTitulo}
        data-fase="antes"
      >
        <h2 id={idTitulo} className="minha-destaque__contagem">
          {fase.destaque}
        </h2>
        <p className="minha-destaque__detalhe">{fase.detalhe}</p>
        {meta && <p className="minha-destaque__meta">{meta}</p>}
      </section>
    );
  }

  const { campanha, hoje } = desempenho;
  const situacao = situacaoDaCampanha(campanha, referencia, unidade);
  const projecao = textoDaProjecao(campanha, referencia);
  return (
    <section
      className="minha-destaque"
      aria-labelledby={idTitulo}
      data-fase={referencia.fase}
    >
      <p className="minha-destaque__fase">
        <strong>{fase.destaque}</strong> · {fase.detalhe}
      </p>
      <h2 id={idTitulo} className="minha-destaque__rotulo">
        Meta da campanha
      </h2>
      <p className="minha-destaque__numero">
        {campanha.percentual_meta_bp === null
          ? "Sem meta"
          : formatarPercentual(campanha.percentual_meta_bp)}
      </p>
      {campanha.percentual_meta_bp !== null && (
        <ProgressBar
          rotulo={rotuloDaBarra(desempenho, unidade)}
          valor={campanha.percentual_meta_bp}
          meta={10_000}
        />
      )}
      {situacao && <Situacao situacao={situacao} />}
      {projecao && <p className="minha-destaque__nota">{projecao}</p>}
      {hoje && (
        <Hoje
          hoje={hoje}
          bilhetesHoje={desempenho.bilhetes.hoje}
          unidade={unidade}
          semMeta={campanha.situacao === "sem_meta"}
        />
      )}
    </section>
  );
}

function Hoje({
  hoje,
  bilhetesHoje,
  unidade,
  semMeta,
}: {
  hoje: NonNullable<DesempenhoIndividual["hoje"]>;
  bilhetesHoje: number | null;
  unidade: UnidadeMeta;
  semMeta: boolean;
}) {
  const idHoje = useId();
  const texto = textoDeHoje(hoje, bilhetesHoje, unidade, semMeta);
  return (
    <section
      className="minha-hoje"
      aria-labelledby={idHoje}
      data-batida={texto.batida ? "" : undefined}
    >
      <h3 id={idHoje} className="minha-hoje__titulo">
        Hoje <span className="minha-hoje__data">· {dataCurta(hoje.data)}</span>
      </h3>
      <p className="minha-hoje__destaque">
        {texto.batida && (
          <span className="minha-hoje__icone" aria-hidden="true">
            ✓
          </span>
        )}
        {texto.destaque}
      </p>
      {texto.detalhe && <p className="minha-hoje__detalhe">{texto.detalhe}</p>}
    </section>
  );
}

type PropsPeriodo = {
  periodo: RitmoIndividual;
  info: PeriodoDaReferencia;
  unidade: UnidadeMeta;
};

// O período atual (ex.: Semana 2): o dia dentro dele, a situação contra a curva do período e o % da meta dele.
export function CartaoPeriodo({ periodo, info, unidade }: PropsPeriodo) {
  const meta = emBilhetes(periodo.meta, unidade);
  const realizado = emBilhetes(periodo.realizado, unidade);
  return (
    <Card titulo={info.nome} className="minha-periodo">
      <div className="minha-periodo__corpo">
        <p className="minha-periodo__subtitulo">{textoDoPeriodo(info)}</p>
        <Situacao situacao={situacaoDoPeriodo(periodo, info, unidade)} />
        {periodo.percentual_meta_bp !== null && (
          <ProgressBar
            rotulo={
              meta === null
                ? "Meta do período"
                : `Meta do período: ${bilhetes(meta)}`
            }
            valor={periodo.percentual_meta_bp}
            meta={10_000}
          />
        )}
        {realizado !== null && (
          <p className="minha-periodo__nota">
            Vendidos no período: {bilhetes(realizado)}.
          </p>
        )}
      </div>
    </Card>
  );
}
