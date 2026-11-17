import { percentuaisNormalizados } from "../../../shared/contracts";
import {
  Button,
  ComAjuda,
  ComDica,
  EmptyState,
  Input,
} from "../../components/ui";
import { formatarData } from "../../lib/formatadores";
import {
  ID_MODELO_SANTO_ANDRE,
  LIMITE_PERIODOS,
  MODELO_SANTO_ANDRE,
  textoPercentual,
  type ErrosFormulario,
  type PeriodoFormulario,
  type PreviaCalendario,
} from "./formulario";
import { AJUDA, DICAS } from "./textos";

export type CampoPeriodo = "nome" | "dias" | "percentual";

/** Chave do campo no contrato (para erros e ids): o percentual vai como percentual_bp. */
export function campoNoContrato(campo: CampoPeriodo) {
  return campo === "percentual" ? "percentual_bp" : campo;
}

type Props = {
  periodos: PeriodoFormulario[];
  previa: PreviaCalendario;
  /** Percentuais em pontos-base; null se algum ainda não é válido. */
  percentuais: number[] | null;
  temDataInicio: boolean;
  erros: ErrosFormulario;
  idDoCampo: (chave: string) => string;
  /** Mensagem depois de usar o modelo de Santo André. */
  aviso: string | null;
  aoAlterar: (indice: number, campo: CampoPeriodo, valor: string) => void;
  aoAdicionar: () => void;
  aoRemover: (indice: number) => void;
  aoUsarModelo: () => void;
};

const DESCRICAO_MODELO = `${MODELO_SANTO_ANDRE.reduce(
  (total, periodo) => total + periodo.dias,
  0,
)} dias em ${MODELO_SANTO_ANDRE.length} períodos: ${juntar(
  MODELO_SANTO_ANDRE.map((periodo) => String(periodo.dias)),
)} dias, com ${juntar(
  MODELO_SANTO_ANDRE.map((periodo) => textoPercentual(periodo.percentual_bp)),
)}.`;

export function EditorPeriodos({
  periodos,
  previa,
  percentuais,
  temDataInicio,
  erros,
  idDoCampo,
  aviso,
  aoAlterar,
  aoAdicionar,
  aoRemover,
  aoUsarModelo,
}: Props) {
  const noLimite = periodos.length >= LIMITE_PERIODOS;
  return (
    <div className="campanha-periodos-area">
      <div className="campanha-periodos-topo">
        <div className="campanha-periodos-topo__textos">
          <ComAjuda
            texto={AJUDA.periodos}
            idDoTitulo="campanha-periodos-titulo"
          >
            <h3 id="campanha-periodos-titulo" className="campanha-subtitulo">
              Períodos
            </h3>
          </ComAjuda>
          <p className="campanha-texto-suave">
            As etapas da campanha, uma depois da outra, a partir da data de
            início. Cada uma tem a sua parte da meta e o seu ranking.
          </p>
        </div>
        <div className="campanha-modelo">
          <ComDica texto={DICAS.modeloSantoAndre}>
            <Button
              id={ID_MODELO_SANTO_ANDRE}
              variante="secundario"
              onClick={aoUsarModelo}
              aria-describedby="campanha-modelo-descricao"
            >
              Usar o modelo de Santo André
            </Button>
          </ComDica>
          <p id="campanha-modelo-descricao" className="campanha-texto-suave">
            {DESCRICAO_MODELO}
          </p>
        </div>
      </div>

      {aviso && (
        <p role="status" className="campanha-nota">
          {aviso}
        </p>
      )}
      {erros.periodos && (
        <p
          id={idDoCampo("periodos")}
          className="campanha-erro-campo"
          tabIndex={-1}
        >
          {erros.periodos}
        </p>
      )}

      {periodos.length === 0 ? (
        <EmptyState
          titulo="Nenhum período ainda"
          descricao="Adicione os períodos um a um ou use o modelo de Santo André."
        />
      ) : (
        <ol className="campanha-periodos">
          {periodos.map((periodo, indice) => {
            const numero = indice + 1;
            const idTitulo = `campanha-${periodo.chave}-titulo`;
            const datas = previa.periodos[indice];
            const campo = (nome: CampoPeriodo) => {
              const chave = `periodos.${indice}.${campoNoContrato(nome)}`;
              return { id: idDoCampo(chave), erro: erros[chave] };
            };
            return (
              <li key={periodo.chave}>
                <div
                  className="campanha-periodo"
                  role="group"
                  aria-labelledby={idTitulo}
                >
                  <div className="campanha-periodo__cabecalho">
                    <h4 id={idTitulo} className="campanha-periodo__titulo">
                      Período {numero}
                    </h4>
                    <p className="campanha-periodo__datas">
                      {datas
                        ? `${formatarData(datas.data_inicio)} a ${formatarData(datas.data_fim)}`
                        : temDataInicio
                          ? "Informe os dias para ver as datas"
                          : "Informe a data de início para ver as datas"}
                    </p>
                  </div>
                  <div className="campanha-periodo__campos">
                    <Input
                      {...campo("nome")}
                      ajuda={AJUDA.nomeDoPeriodo}
                      rotulo={<RotuloDoPeriodo texto="Nome" numero={numero} />}
                      value={periodo.nome}
                      autoComplete="off"
                      onChange={(evento) =>
                        aoAlterar(indice, "nome", evento.target.value)
                      }
                    />

                    <Input
                      {...campo("dias")}
                      ajuda={AJUDA.diasDoPeriodo}
                      rotulo={<RotuloDoPeriodo texto="Dias" numero={numero} />}
                      value={periodo.dias}
                      inputMode="numeric"
                      autoComplete="off"
                      onChange={(evento) =>
                        aoAlterar(indice, "dias", evento.target.value)
                      }
                    />

                    <Input
                      {...campo("percentual")}
                      ajuda={AJUDA.percentualDoPeriodo}
                      rotulo={
                        <RotuloDoPeriodo
                          texto="Percentual (%)"
                          numero={numero}
                        />
                      }
                      value={periodo.percentual}
                      inputMode="decimal"
                      autoComplete="off"
                      onChange={(evento) =>
                        aoAlterar(indice, "percentual", evento.target.value)
                      }
                    />
                  </div>
                  <div className="campanha-periodo__rodape">
                    <ComDica texto={DICAS.removerPeriodo}>
                      <Button
                        variante="discreto"
                        aria-label={`Remover o período ${numero}`}
                        onClick={() => aoRemover(indice)}
                      >
                        Remover
                      </Button>
                    </ComDica>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div>
        {/* No limite: aria-disabled (RIFA-047), no Tab e com a dica dizendo por quê, e o foco fica no botão (com o
            disabled, o clique que chegava ao limite jogava o foco no <body>); o clique é barrado aqui. */}
        <ComDica
          texto={
            noLimite
              ? DICAS.adicionarPeriodoNoLimite(LIMITE_PERIODOS)
              : DICAS.adicionarPeriodo
          }
        >
          <Button
            variante="secundario"
            aria-disabled={noLimite || undefined}
            onClick={() => {
              if (!noLimite) aoAdicionar();
            }}
          >
            Adicionar período
          </Button>
        </ComDica>
      </div>

      <ResumoPeriodos previa={previa} percentuais={percentuais} />
    </div>
  );
}

function RotuloDoPeriodo({ texto, numero }: { texto: string; numero: number }) {
  return (
    <>
      {texto}
      <span className="visualmente-oculto"> do período {numero}</span>
    </>
  );
}

function ResumoPeriodos({
  previa,
  percentuais,
}: {
  previa: PreviaCalendario;
  percentuais: number[] | null;
}) {
  const soma =
    percentuais && percentuais.length > 0
      ? percentuais.reduce((total, valor) => total + valor, 0)
      : null;
  const inicio = previa.periodos[0]?.data_inicio;
  return (
    <div className="campanha-resumo">
      <p>
        <strong>Data final:</strong>{" "}
        {previa.data_fim && inicio
          ? `${formatarData(previa.data_fim)} (${previa.total_dias} dias a partir de ${formatarData(inicio)})`
          : "—"}
      </p>
      <p>
        <strong>Soma dos percentuais:</strong>{" "}
        {soma === null ? "—" : textoPercentual(soma)}
      </p>
      {soma === 0 && (
        <p className="campanha-aviso">
          Pelo menos um período precisa ter percentual maior que zero.
        </p>
      )}
      {percentuais && soma !== null && soma > 0 && soma !== 10_000 && (
        <p className="campanha-aviso">
          A soma dá {textoPercentual(soma)}, e não 100%. Não tem problema: o
          sistema normaliza, isto é, divide cada percentual pela soma. Na
          prática, os períodos ficam com{" "}
          {juntar(percentuaisNormalizados(percentuais).map(textoPercentual))} da
          meta.
        </p>
      )}
    </div>
  );
}

/** ["10", "7", "7"] → "10, 7 e 7". */
function juntar(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;
}
