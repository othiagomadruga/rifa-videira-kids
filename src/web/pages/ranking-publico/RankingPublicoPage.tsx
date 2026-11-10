import { useId } from "react";
import {
  NOMES_DIVISAO,
  type ItemRankingPublico,
} from "../../../shared/contracts/calculos";
import { TextoContado } from "../../components/movimento";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
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
import { usePulsoDaMeta } from "../../lib/usePulsoDaMeta";
import type { RankingDaDivisao, RankingPublico } from "./ranking-publico-api";
import { formatarPosicao, textoDaFase, textoDaJanela } from "./textos";
import { useRankingPublico } from "./useRankingPublico";
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
// desliza para o lugar novo, o % conta até o valor e a meta batida pulsa de leve.
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
        <ErrorState
          titulo="Não foi possível carregar o ranking."
          mensagem={`${mensagemDoErro(estado.erro)} A página tenta de novo sozinha a cada minuto.`}
          aoTentarDeNovo={tentarDeNovo}
        />
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

type PropsRanking = {
  ranking: RankingPublico;
  /** A última atualização automática falhou (a tela continua com os dados anteriores). */
  falhou: boolean;
};

function Ranking({ ranking, falhou }: PropsRanking) {
  const idDisputa = useId();
  const fase = textoDaFase(ranking.referencia);
  const semVendas = ranking.divisoes.every(({ itens }) => itens.length === 0);
  const comPercentual = ranking.divisoes.some(({ itens }) =>
    itens.some((item) => item.percentual_meta_bp !== undefined),
  );

  return (
    <>
      <div className="ranking-publico__fase">
        <p className="ranking-publico__fase-destaque">{fase.destaque}</p>
        <p className="ranking-publico__fase-detalhe">{fase.detalhe}</p>
      </div>
      {semVendas ? (
        <EmptyState
          titulo="O ranking aparece depois da primeira venda."
          descricao={
            ranking.referencia.fase === "antes"
              ? `As vendas começam em ${formatarData(ranking.referencia.data_inicio)}.`
              : `${ranking.janela.nome}: ainda sem vendas.`
          }
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
            <Item key={chave} chave={chave} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Item({ chave, item }: { chave: string; item: ItemRankingPublico }) {
  const metaBatida =
    item.percentual_meta_bp !== undefined &&
    item.percentual_meta_bp >= META_BATIDA_BP;
  const refPercentual = usePulsoDaMeta<HTMLSpanElement>(metaBatida);
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
      <span className="ranking-publico__nome">{item.nome}</span>
      {item.percentual_meta_bp !== undefined && (
        <>
          {" "}
          <span ref={refPercentual} className="ranking-publico__percentual">
            <TextoContado texto={formatarPercentual(item.percentual_meta_bp)} />{" "}
            <span className="visualmente-oculto">da meta</span>
          </span>
        </>
      )}
    </li>
  );
}
