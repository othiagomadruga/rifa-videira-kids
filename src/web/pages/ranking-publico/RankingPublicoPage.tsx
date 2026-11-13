import { useId } from "react";
import {
  NOMES_DIVISAO,
  type ItemRankingPublico,
} from "../../../shared/contracts/calculos";
import { TextoContado } from "../../components/movimento";
import {
  EmptyState,
  ErrorState,
  Icone,
  Loading,
  PageHeader,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import {
  formatarData,
  formatarHora,
  formatarPercentual,
} from "../../lib/formatadores";
import {
  ATRIBUTO_CHAVE,
  chavesPorNome,
  useListaAnimada,
} from "../../lib/useListaAnimada";
import { CLASSE_COMEMORA, useComemoracao } from "../../lib/useComemoracao";
import type { RankingDaDivisao, RankingPublico } from "./ranking-publico-api";
import {
  formatarPosicao,
  linhaDoTempo,
  textoDaFase,
  textoDaJanela,
} from "./textos";
import { useRankingPublico } from "./useRankingPublico";
import { useSubiu } from "./useSubiu";
import "./ranking-publico.css";

/** Posições até esta ganham destaque (empatados no 3º lugar também). */
const POSICOES_EM_DESTAQUE = 3;
/** 100% da meta, em pontos-base: a meta batida ganha o destaque de comemoração. */
const META_BATIDA_BP = 10_000;

// Tela pública (link do grupo de WhatsApp): o ranking das células por divisão, só com posições e nomes
// (e o % da meta, quando a campanha permite). Nunca valores em dinheiro nem quantidades: a rota aberta não
// os devolve e esta pasta não os formata (regra em docs/frontend.md, conferida em rotas.test.tsx e em
// guarda-publico.test.ts). Atualiza sozinha a cada minuto e não chama nenhuma rota da coordenação.
// Movimento (RIFA-020, sem prefers-reduced-motion): os itens entram em sequência, quem muda de posição
// desliza para o lugar novo, o % conta até o valor e a meta batida pulsa de leve (e comemora, quando passa a
// ser batida numa atualização: RIFA-050). RIFA-050 (A-07, A-18, A-19): a linha do tempo da campanha na faixa
// da fase, a falha de conexão neutra, o vazio com o convite do primeiro dia e o "↑ subiu" (como no telão: até a
// próxima atualização que muda a ordem).
export function RankingPublicoPage() {
  const { estado, tentarDeNovo } = useRankingPublico();
  return (
    <>
      <PageHeader titulo="Ranking da campanha" />
      {estado.tipo === "carregando" && (
        <div className="ranking-publico__carregando">
          <Loading texto="Carregando o ranking…" />
          <Esqueleto />
        </div>
      )}
      {estado.tipo === "erro" && (
        <Falha erro={estado.erro} aoTentarDeNovo={tentarDeNovo} />
      )}
      {estado.tipo === "sem_campanha" && (
        <EmptyState
          titulo="O ranking ainda não está disponível."
          descricao="Ele aparece aqui quando a campanha estiver ativa."
        />
      )}
      {estado.tipo === "ok" && (
        <Ranking ranking={estado.ranking} falhou={estado.falha !== null} />
      )}
    </>
  );
}

/**
 * A primeira carga falhou. Sem conexão (o comum num celular com sinal fraco, e passageiro): o estado neutro "Sem
 * conexão agora", sem o vermelho; outra falha, o erro de verdade.
 */
function Falha({
  erro,
  aoTentarDeNovo,
}: {
  erro: unknown;
  aoTentarDeNovo: () => void;
}) {
  const conexao = ehFalhaDeConexao(erro);
  // O invólucro segura a altura da tela (ranking-publico.css), como o carregando: o rodapé não sobe quando a falha
  // chega.
  return (
    <div className="ranking-publico__falhou">
      <ErrorState
        conexao={conexao}
        titulo={conexao ? undefined : "Não foi possível carregar o ranking."}
        mensagem={`${mensagemDoErro(erro)} A página tenta de novo sozinha a cada minuto.`}
        aoTentarDeNovo={aoTentarDeNovo}
      />
    </div>
  );
}

/** O desenho do que vai chegar (a fase e duas divisões), com o brilho do carregando. Só visual. */
function Esqueleto() {
  return (
    <div className="ranking-publico__esqueleto" aria-hidden="true">
      <div className="mov-esqueleto ranking-publico__esqueleto-fase" />
      <div className="ranking-publico__divisoes">
        {[0, 1].map((divisao) => (
          <div key={divisao} className="ranking-publico__divisao">
            <div className="mov-esqueleto ranking-publico__esqueleto-titulo" />
            {[0, 1, 2].map((linha) => (
              <div
                key={linha}
                className="mov-esqueleto ranking-publico__esqueleto-item"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * O texto do vazio (ninguém vendeu na janela). A data do início vem da campanha (`referencia`), nunca do código. Antes
 * do início e durante, o convite do primeiro dia; depois do fim não há primeira venda a esperar, só o aviso.
 */
function descricaoSemVendas({ referencia, janela }: RankingPublico): string {
  const semVendas = `${janela.nome}: ainda sem vendas.`;
  if (referencia.fase === "encerrada") return semVendas;
  const contexto =
    referencia.fase === "antes"
      ? `As vendas começam em ${formatarData(referencia.data_inicio)}.`
      : semVendas;
  return `${contexto} Qual célula vai ser a primeira?`;
}

type PropsRanking = {
  ranking: RankingPublico;
  /** A última atualização automática falhou (a tela continua com os dados anteriores). */
  falhou: boolean;
};

function Ranking({ ranking, falhou }: PropsRanking) {
  const idDisputa = useId();
  const fase = textoDaFase(ranking.referencia);
  const linha = linhaDoTempo(ranking.referencia);
  const semVendas = ranking.divisoes.every(({ itens }) => itens.length === 0);
  const comPercentual = ranking.divisoes.some(({ itens }) =>
    itens.some((item) => item.percentual_meta_bp !== undefined),
  );

  return (
    <>
      <div className="ranking-publico__fase">
        <p className="ranking-publico__fase-destaque">{fase.destaque}</p>
        <p className="ranking-publico__fase-detalhe">{fase.detalhe}</p>
        {/* Os dias passados da campanha: decorativa (o texto acima já diz "Dia 12 de 24"). */}
        {linha && (
          <div className="ranking-publico__linha-do-tempo" aria-hidden="true">
            <div className="ranking-publico__trilho">
              <div
                className="ranking-publico__percorrido"
                style={{ width: `${linha.percorrido}%` }}
              />
            </div>
            <span>{linha.inicio}</span>
            <span>{linha.fim}</span>
          </div>
        )}
      </div>
      {semVendas ? (
        <EmptyState
          icone="trofeu"
          titulo="O ranking aparece com a primeira venda."
          descricao={descricaoSemVendas(ranking)}
        />
      ) : (
        <section
          className="ranking-publico__disputa"
          aria-labelledby={idDisputa}
        >
          <h2 id={idDisputa} className="ranking-publico__janela">
            {textoDaJanela(ranking.janela, ranking.referencia)}
          </h2>
          {comPercentual && (
            <p className="ranking-publico__legenda">
              O % é quanto cada célula já fez da própria meta.
            </p>
          )}
          <div className="ranking-publico__divisoes">
            {ranking.divisoes.map((divisao) => (
              <Divisao key={divisao.divisao} {...divisao} />
            ))}
          </div>
        </section>
      )}
      <div className="ranking-publico__rodape">
        <p>
          Atualizado às {formatarHora(ranking.atualizadoEm)}. A página se
          atualiza sozinha a cada minuto.
        </p>
        {/* Região viva fixa: avisa quando uma atualização automática falha. */}
        <p className="ranking-publico__falha" role="status">
          {falhou
            ? "Não foi possível atualizar agora. A página tenta de novo em 1 minuto."
            : ""}
        </p>
      </div>
    </>
  );
}

function Divisao({ divisao, itens }: RankingDaDivisao) {
  const idTitulo = useId();
  const comChaves = chavesPorNome(itens);
  // A ordem das chaves muda quando alguém troca de lugar, entra ou sai: aí a lista anima.
  const refLista = useListaAnimada<HTMLOListElement>(
    comChaves.map(({ chave }) => chave).join("|"),
  );
  const subiram = useSubiu(
    comChaves.map(({ chave, item }) => ({ chave, posicao: item.posicao })),
  );
  return (
    <section className="ranking-publico__divisao" aria-labelledby={idTitulo}>
      <h3 id={idTitulo} className="ranking-publico__divisao-titulo">
        {NOMES_DIVISAO[divisao]}
      </h3>
      {itens.length === 0 ? (
        <p className="ranking-publico__sem-vendas">
          Ainda sem vendas nesta divisão.
        </p>
      ) : (
        // role="list": com list-style none, o Safari deixaria de anunciar a lista.
        <ol ref={refLista} className="ranking-publico__lista" role="list">
          {comChaves.map(({ chave, item }) => (
            <Item
              key={chave}
              chave={chave}
              item={item}
              subiu={subiram.has(chave)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

type PropsItem = {
  chave: string;
  item: ItemRankingPublico;
  /** Subiu de posição na última atualização que mudou a ordem (useSubiu). */
  subiu: boolean;
};

function Item({ chave, item, subiu }: PropsItem) {
  const metaBatida =
    item.percentual_meta_bp !== undefined &&
    item.percentual_meta_bp >= META_BATIDA_BP;
  // Quem passa a bater a meta numa atualização comemora (pulso e partículas); quem já chega batido só pulsa.
  const { ref: refPercentual, confete } = useComemoracao<HTMLSpanElement>(
    metaBatida,
    { quando: "ao-bater" },
  );
  return (
    <li
      className="ranking-publico__item"
      {...{ [ATRIBUTO_CHAVE]: chave }}
      data-destaque={item.posicao <= POSICOES_EM_DESTAQUE ? "" : undefined}
      data-primeiro={item.posicao === 1 ? "" : undefined}
      data-meta-batida={metaBatida ? "" : undefined}
    >
      {/* Os espaços entre as partes não aparecem (o item é uma grade), mas separam as palavras na leitura. */}
      <span className="ranking-publico__posicao">
        {formatarPosicao(item.posicao)}
      </span>{" "}
      <span className="ranking-publico__celula">
        <span className="ranking-publico__nome">{item.nome}</span>
        {/* Só visual: a lista já diz a posição de cada um. */}
        {subiu && (
          <span className="ranking-publico__subiu" aria-hidden="true">
            <Icone nome="subiu" />
            subiu
          </span>
        )}
      </span>
      {item.percentual_meta_bp !== undefined && (
        <>
          {" "}
          <span
            ref={refPercentual}
            className={`ranking-publico__percentual ${CLASSE_COMEMORA}`}
          >
            <TextoContado texto={formatarPercentual(item.percentual_meta_bp)} />{" "}
            <span className="visualmente-oculto">da meta</span>
            {confete}
          </span>
        </>
      )}
    </li>
  );
}
