import type {
  MetaDoDia,
  PeriodoDaReferencia,
  RespostaPainelResumo,
  Ritmo,
  UnidadeMeta,
} from "../../../shared/contracts/calculos";
import {
  Card,
  IndicadorSituacao,
  ProgressBar,
  Stat,
} from "../../components/ui";
import { formatarNumero, formatarPercentual } from "../../lib/formatadores";
import {
  dataCurta,
  explicacaoDaMetaDoDia,
  faltam,
  quantidade,
  situacaoDaCampanha,
  situacaoDoPeriodo,
  textoDaProjecao,
  textoDasVendas,
  textoDoRitmo,
  valorCurto,
  type TextoSituacao,
} from "./textos";

function Situacao({ situacao }: { situacao: TextoSituacao }) {
  return (
    <IndicadorSituacao
      tom={situacao.tom}
      titulo={situacao.titulo}
      icone={situacao.icone}
    >
      {situacao.detalhe}
    </IndicadorSituacao>
  );
}

type PropsHoje = {
  hoje: MetaDoDia;
  unidade: UnidadeMeta;
  /** No último dia, a meta de hoje é tudo o que falta. */
  ultimoDia: boolean;
};

// Hoje: quanto vender hoje (a meta do dia já soma o que faltou ou desconta o que sobrou até ontem) e
// quanto já foi vendido hoje.
export function CartaoHoje({ hoje, unidade, ultimoDia }: PropsHoje) {
  return (
    <Card
      className="visao-cartao"
      icone="calendario"
      titulo={
        <>
          Hoje{" "}
          <span className="visao-cartao__data">· {dataCurta(hoje.data)}</span>
        </>
      }
    >
      <div className="visao-cartao__corpo">
        {/* O número do dia com a cara única dos números (o Stat, RIFA-051), sem a moldura dele: o cartão já é. */}
        <div className="visao-cartao__numero">
          <Stat
            rotulo="Meta de hoje"
            valor={quantidade(hoje.meta, unidade)}
            tamanho="grande"
          />
          <p className="visao-cartao__nota">
            {explicacaoDaMetaDoDia(hoje, unidade, ultimoDia)}
          </p>
        </div>
        {hoje.meta > 0 && hoje.percentual_meta_bp !== null ? (
          <ProgressBar
            rotulo={`Vendido hoje até agora: ${quantidade(hoje.realizado, unidade)}`}
            valor={hoje.percentual_meta_bp}
            meta={10_000}
          />
        ) : (
          <p>Vendido hoje até agora: {quantidade(hoje.realizado, unidade)}</p>
        )}
        {hoje.meta > 0 &&
          (hoje.batida ? (
            <IndicadorSituacao tom="sucesso" titulo="Meta de hoje batida">
              {hoje.realizado > hoje.meta
                ? `${quantidade(hoje.realizado - hoje.meta, unidade)} além da meta de hoje`
                : undefined}
            </IndicadorSituacao>
          ) : (
            <p className="visao-cartao__falta">
              {faltam(hoje.falta, unidade)} para a meta de hoje.
            </p>
          ))}
      </div>
    </Card>
  );
}

// Campanha: em dia ou abaixo (e quanto), o realizado contra a meta, o ritmo e para onde vai.
export function CartaoCampanha({ resumo }: { resumo: RespostaPainelResumo }) {
  const { campanha, referencia, unidade, vendas } = resumo;
  const { fase } = referencia;
  const ritmo = fase === "durante" ? textoDoRitmo(campanha.ritmo_bp) : null;
  return (
    <Card titulo="Campanha" icone="campanha" className="visao-cartao">
      <div className="visao-cartao__corpo">
        <p className="visao-cartao__subtitulo">
          {fase === "antes"
            ? `Começa em ${dataCurta(referencia.data_inicio)}`
            : fase === "encerrada"
              ? "Do 1º ao último dia"
              : "Do 1º dia até agora"}
        </p>
        <Situacao situacao={situacaoDaCampanha(resumo)} />
        {fase !== "antes" && campanha.percentual_meta_bp !== null && (
          <ProgressBar
            rotulo={`Realizado: ${valorCurto(campanha.realizado, unidade)} de ${quantidade(campanha.meta, unidade)}`}
            valor={campanha.percentual_meta_bp}
            meta={10_000}
          />
        )}
        <dl className="visao-dados">
          {fase === "durante" && referencia.dia_campanha !== 1 && (
            <div>
              <dt>Esperado até ontem</dt>
              <dd>
                {quantidade(campanha.esperado, unidade)}
                {campanha.percentual_esperado_bp !== null &&
                  ` (${formatarPercentual(campanha.percentual_esperado_bp)} da meta)`}
              </dd>
            </div>
          )}
          {ritmo && (
            <div>
              <dt>Ritmo</dt>
              <dd>{ritmo}</dd>
            </div>
          )}
          <div>
            <dt>{fase === "encerrada" ? "Resultado" : "Projeção"}</dt>
            <dd>{textoDaProjecao(resumo)}</dd>
          </div>
          {fase !== "antes" && (
            <div>
              <dt>Vendas aprovadas</dt>
              <dd>{textoDasVendas(vendas)}</dd>
            </div>
          )}
        </dl>
      </div>
    </Card>
  );
}

type PropsPeriodo = {
  periodo: Ritmo;
  info: PeriodoDaReferencia;
  unidade: UnidadeMeta;
};

// Período atual (ex.: Semana 2): esperado até ontem × realizado, situação, meta e ritmo do período.
export function CartaoPeriodo({ periodo, info, unidade }: PropsPeriodo) {
  const ritmo = textoDoRitmo(periodo.ritmo_bp);
  return (
    <Card titulo={info.nome} icone="trilha" className="visao-cartao">
      <div className="visao-cartao__corpo">
        <p className="visao-cartao__subtitulo">
          Dia {formatarNumero(info.dia_no_periodo)} de{" "}
          {formatarNumero(info.dias)} · {dataCurta(info.data_inicio)} a{" "}
          {dataCurta(info.data_fim)}
        </p>
        <Situacao situacao={situacaoDoPeriodo(periodo, info, unidade)} />
        <dl className="visao-comparacao">
          <div>
            <dt>Esperado até ontem</dt>
            <dd>{quantidade(periodo.esperado, unidade)}</dd>
          </div>
          <div>
            <dt>Realizado</dt>
            <dd>{quantidade(periodo.realizado, unidade)}</dd>
          </div>
        </dl>
        {periodo.percentual_meta_bp !== null && (
          <ProgressBar
            rotulo={`Meta do período: ${quantidade(periodo.meta, unidade)}`}
            valor={periodo.percentual_meta_bp}
            meta={10_000}
          />
        )}
        <p className="visao-cartao__nota">
          {ritmo
            ? `Ritmo do período: ${ritmo}.`
            : "O ritmo do período aparece depois do 1º dia dele."}
        </p>
      </div>
    </Card>
  );
}
