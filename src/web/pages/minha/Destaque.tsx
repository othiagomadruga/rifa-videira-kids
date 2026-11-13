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
import {
  Card,
  Icone,
  IndicadorSituacao,
  ProgressBar,
} from "../../components/ui";
import { formatarNumero, formatarPercentual } from "../../lib/formatadores";
import { CLASSE_COMEMORA, useComemoracao } from "../../lib/useComemoracao";
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

/** A chave da comemoração da /minha no sessionStorage (uma por dia nesta aba). */
export const CHAVE_COMEMORACAO_MINHA = "minha";

// O destaque da tela (num Card "destaque", a borda roxa de 2 px): antes do início, a contagem regressiva; depois, o %
// da meta da campanha (grande, uma vez só: a barra não repete o número), a situação contra a curva, a projeção e a
// meta de HOJE ("faltam N bilhetes hoje"; com a meta em centavos, só o %). Com a meta batida (100% ou mais), o selo
// amarelo "Meta batida" ao lado do número e a comemoração (D25): o pulso e as partículas, ao aparecer já batida ou
// ao bater numa atualização, uma vez por dia nesta aba (recarregar não repete); com reduce, nada se mexe.
export function Destaque({ visao }: { visao: RespostaVisaoIndividual }) {
  const idTitulo = useId();
  const { referencia, desempenho, unidade } = visao;
  const fase = textoDaFase(referencia);
  const percentual = desempenho.campanha.percentual_meta_bp;
  const batida =
    referencia.fase !== "antes" && percentual !== null && percentual >= 10_000;
  const { ref: refNumero, confete } = useComemoracao<HTMLParagraphElement>(
    batida,
    {
      quando: "ao-aparecer-e-ao-bater",
      umaVezPor: "dia",
      chave: CHAVE_COMEMORACAO_MINHA,
    },
  );

  if (referencia.fase === "antes") {
    const meta = textoDaMetaAntes(desempenho.campanha, unidade);
    return (
      <section
        className="minha-destaque"
        aria-labelledby={idTitulo}
        data-fase="antes"
      >
        <Card variante="destaque" className="minha-destaque__cartao">
          <h2 id={idTitulo} className="minha-destaque__contagem">
            {fase.destaque}
          </h2>
          <p className="minha-destaque__detalhe">{fase.detalhe}</p>
          {meta && <p className="minha-destaque__meta">{meta}</p>}
        </Card>
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
      <Card variante="destaque" className="minha-destaque__cartao">
        <p className="minha-destaque__fase">
          <strong>{fase.destaque}</strong> · {fase.detalhe}
        </p>
        <h2 id={idTitulo} className="minha-destaque__rotulo">
          Meta da campanha
        </h2>
        <div className="minha-destaque__valor">
          <p
            ref={refNumero}
            className={`minha-destaque__numero ${CLASSE_COMEMORA}`}
          >
            {percentual === null ? "Sem meta" : formatarPercentual(percentual)}
            {confete}
          </p>
          {batida && (
            <p className="minha-destaque__selo">
              <Icone nome="trofeu" />
              Meta batida
            </p>
          )}
        </div>
        {percentual !== null && (
          <ProgressBar
            rotulo={rotuloDaBarra(desempenho, unidade)}
            valor={percentual}
            meta={10_000}
            mostrarValor={false}
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
      </Card>
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
        {texto.batida && <Icone nome="check" className="minha-hoje__icone" />}
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
