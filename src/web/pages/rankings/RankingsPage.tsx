import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  NOMES_DIVISAO,
  ORDEM_DIVISOES,
  type RespostaRanking,
} from "../../../shared/contracts/calculos";
import {
  Abas,
  ComDica,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Select,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import {
  formatarData,
  formatarHora,
  formatarNumero,
} from "../../lib/formatadores";
import {
  JANELAS,
  NIVEIS,
  lerDivisao,
  lerFiltros,
  lerJanela,
  parametrosDosFiltros,
} from "./filtros";
import {
  caminhoDoRanking,
  carregarRanking,
  ehSemCampanha,
  type FiltrosRanking,
} from "./rankings-api";
import { TabelaRanking } from "./TabelaRanking";
import {
  DICAS,
  TEXTO_CRITERIO,
  TEXTO_JANELA,
  TEXTO_NIVEL,
  textoDaReferencia,
} from "./textos";
import "./rankings.css";

const ID_ABAS = "rankings";

type Resultado =
  | { tipo: "ok"; resposta: RespostaRanking }
  | { tipo: "sem_campanha" }
  | { tipo: "erro"; erro: unknown };

/** O resultado de uma consulta: o caminho pedido à API identifica os filtros. */
type Carga = { caminho: string; resultado: Resultado };

// Rankings da coordenação: a disputa entre células, discipuladores e redes, por divisão e por janela
// (período atual ou campanha inteira), com posição (empates dividem a posição), % da meta, realizado e
// meta na unidade da campanha e situação. Os filtros ficam na URL; cada mudança consulta a API de novo.
export function RankingsPage() {
  const [parametros, setParametros] = useSearchParams();
  const filtros = lerFiltros(parametros);
  const caminho = caminhoDoRanking(filtros);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    carregarRanking(caminho, { signal: controle.signal }).then(
      (resposta) => setCarga({ caminho, resultado: { tipo: "ok", resposta } }),
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setCarga({
          caminho,
          resultado: ehSemCampanha(erro)
            ? { tipo: "sem_campanha" }
            : { tipo: "erro", erro },
        });
      },
    );
    return () => controle.abort();
  }, [caminho, tentativa]);

  // Até chegar a resposta dos filtros atuais, a tela mostra o carregando (nunca a lista de outro filtro).
  const resultado = carga?.caminho === caminho ? carga.resultado : null;

  function mudarFiltros(mudanca: Partial<FiltrosRanking>) {
    setParametros(parametrosDosFiltros({ ...filtros, ...mudanca }), {
      replace: true,
    });
  }

  function tentarDeNovo() {
    setCarga(null);
    setTentativa((atual) => atual + 1);
  }

  const painel = (
    <div className="pilha rankings-painel">
      <div className="rankings-filtros">
        <ComDica texto={DICAS.divisao}>
          <Select
            rotulo="Divisão"
            value={filtros.divisao ?? ""}
            onChange={(evento) =>
              mudarFiltros({ divisao: lerDivisao(evento.target.value) })
            }
          >
            <option value="">Todas</option>
            {ORDEM_DIVISOES.map((divisao) => (
              <option key={divisao} value={divisao}>
                {NOMES_DIVISAO[divisao]}
              </option>
            ))}
          </Select>
        </ComDica>
        <ComDica texto={DICAS.janela}>
          <Select
            rotulo="Janela"
            value={filtros.periodo}
            onChange={(evento) =>
              mudarFiltros({ periodo: lerJanela(evento.target.value) })
            }
          >
            {JANELAS.map((janela) => (
              <option key={janela} value={janela}>
                {TEXTO_JANELA[janela]}
              </option>
            ))}
          </Select>
        </ComDica>
      </div>
      <ConteudoDoRanking resultado={resultado} aoTentarDeNovo={tentarDeNovo} />
    </div>
  );

  return (
    <>
      <PageHeader
        titulo="Rankings"
        descricao="A disputa entre células, discipuladores e redes: posição, % da meta e quem está em dia."
      />
      {/* Região viva fixa: anuncia o resultado de cada troca de filtro. */}
      <p className="visualmente-oculto" role="status">
        {resultado?.tipo === "ok" ? anuncioDoResultado(resultado.resposta) : ""}
      </p>
      <Abas
        id={ID_ABAS}
        rotulo="Nível do ranking"
        abaAtiva={filtros.nivel}
        aoMudar={(nivel) => mudarFiltros({ nivel })}
        abas={NIVEIS.map((nivel) => ({
          id: nivel,
          rotulo: TEXTO_NIVEL[nivel].aba,
          dica: DICAS.aba[nivel],
          // Só o painel da aba atual tem conteúdo: os outros níveis não são consultados.
          conteudo: nivel === filtros.nivel ? painel : null,
        }))}
      />
    </>
  );
}

type PropsConteudo = {
  /** null = carregando. */
  resultado: Resultado | null;
  aoTentarDeNovo: () => void;
};

function ConteudoDoRanking({ resultado, aoTentarDeNovo }: PropsConteudo) {
  if (resultado === null) return <Loading texto="Carregando o ranking…" />;
  if (resultado.tipo === "erro") {
    return (
      <ErrorState
        titulo="Não foi possível carregar o ranking."
        mensagem={mensagemDoErro(resultado.erro)}
        conexao={ehFalhaDeConexao(resultado.erro)}
        aoTentarDeNovo={aoTentarDeNovo}
      />
    );
  }
  if (resultado.tipo === "sem_campanha") {
    return (
      <EmptyState
        titulo="Nenhuma campanha ativa."
        descricao={
          <>
            Os rankings aparecem quando houver uma campanha ativa. Configure em{" "}
            <Link to="/coordenacao/campanha">Campanha</Link>.
          </>
        }
      />
    );
  }

  const { resposta } = resultado;
  return (
    <>
      <ResumoDaJanela resposta={resposta} />
      {resposta.itens.length === 0 ? (
        <SemItens resposta={resposta} />
      ) : (
        <TabelaRanking resposta={resposta} />
      )}
    </>
  );
}

function ResumoDaJanela({ resposta }: { resposta: RespostaRanking }) {
  const { janela, referencia, criterio, atualizado_em } = resposta;
  return (
    <div className="rankings-resumo">
      <p className="rankings-resumo__janela">
        <strong>{janela.nome}</strong>: {formatarData(janela.data_inicio)} a{" "}
        {formatarData(janela.data_fim)}
      </p>
      <p className="rankings-resumo__detalhes">
        {textoDaReferencia(referencia)}. Classificação por{" "}
        {TEXTO_CRITERIO[criterio]}. Atualizado às {formatarHora(atualizado_em)}.
      </p>
    </div>
  );
}

function SemItens({ resposta }: { resposta: RespostaRanking }) {
  const textos = TEXTO_NIVEL[resposta.nivel];
  const onde = resposta.divisao
    ? `A divisão ${NOMES_DIVISAO[resposta.divisao]} ainda não tem ${textos.semItens}.`
    : `Ainda não há ${textos.semItens}.`;
  return (
    <EmptyState
      titulo={textos.vazio}
      descricao={
        <>
          {onde} Confira em <Link to="/coordenacao/hierarquia">Hierarquia</Link>
          .
        </>
      }
    />
  );
}

/** "36 células no ranking: Semana 2, Jovens." */
function anuncioDoResultado(resposta: RespostaRanking): string {
  const textos = TEXTO_NIVEL[resposta.nivel];
  const quantidade = resposta.itens.length;
  const nome = quantidade === 1 ? textos.singular : textos.plural;
  const divisao = resposta.divisao
    ? `, ${NOMES_DIVISAO[resposta.divisao]}`
    : "";
  return `${formatarNumero(quantidade)} ${nome} no ranking: ${resposta.janela.nome}${divisao}.`;
}
