import { useId } from "react";
import {
  NOMES_DIVISAO,
  type ItemRankingPublico,
} from "../../../shared/contracts/calculos";
import { Marca } from "../../components/ui";
import {
  formatarData,
  formatarHora,
  formatarPercentual,
} from "../../lib/formatadores";
import { tituloDaAba } from "../../tema/marca";
import type {
  RankingDaDivisao,
  RankingPublico,
} from "../ranking-publico/ranking-publico-api";
import { formatarPosicao, textoDaJanela } from "../ranking-publico/textos";
import { useRankingPublico } from "../ranking-publico/useRankingPublico";
import { faseDoTelao, listaDoTelao } from "./textos";
import { useCursorEscondidoParado, useRelogio } from "./useTelao";
import "./telao.css";

/** Posições até esta ganham destaque (empatados no 3º lugar também), como no ranking público. */
const POSICOES_EM_DESTAQUE = 3;

// Modo telão (culto, 1920×1080, lido a ~8 m): tela cheia, tema escuro de alto contraste, sem rolagem,
// sem navegação e sem cursor com o mouse parado. Mostra a disputa das células como o ranking público
// ("/"), dos mesmos dados e com a mesma atualização a cada minuto (useRankingPublico): jovens e adultos
// lado a lado, só posições e nomes (e o % da meta, quando a campanha permite). Tela pública: nunca
// valores em dinheiro nem quantidades (regra em docs/frontend.md, conferida em rotas.test.tsx e em
// guarda-telao.test.ts) e só a rota aberta do ranking. Sem botões: falhas se resolvem sozinhas.
export function TelaoPage() {
  const { estado } = useRankingPublico();
  const hora = useRelogio();
  const cursorEscondido = useCursorEscondidoParado();
  const ranking = estado.tipo === "ok" ? estado.ranking : null;
  // A última atualização automática falhou: a tela continua com os dados anteriores.
  const falhou = estado.tipo === "ok" && estado.falha !== null;
  const fase = ranking ? faseDoTelao(ranking.referencia) : null;

  return (
    <div
      className="telao"
      data-tema="telao"
      data-cursor={cursorEscondido ? "escondido" : undefined}
    >
      <title>{tituloDaAba("Telão")}</title>
      <header className="telao__topo">
        <div className="telao__marca">
          <Marca />
        </div>
        {fase && (
          <div className="telao__fase">
            <p className="telao__fase-destaque">{fase.destaque}</p>
            <p className="telao__fase-detalhe">{fase.detalhe}</p>
          </div>
        )}
        <div className="telao__hora">
          <p className="telao__relogio">
            <span className="visualmente-oculto">Agora são </span>
            {hora}
          </p>
          {ranking && (
            <p
              className="telao__atualizado"
              data-falhou={falhou ? "" : undefined}
            >
              Atualizado às {formatarHora(ranking.atualizadoEm)}
              {/* Região viva fixa: avisa quando uma atualização automática falha. */}
              <span role="status">{falhou ? " · sem conexão" : ""}</span>
            </p>
          )}
        </div>
      </header>
      <main className="telao__conteudo">
        <h1 className="visualmente-oculto">Telão</h1>
        {estado.tipo === "carregando" && (
          <p className="telao__mensagem telao__mensagem-detalhe" role="status">
            Carregando o ranking…
          </p>
        )}
        {estado.tipo === "erro" && (
          <div className="telao__mensagem" role="alert">
            <p className="telao__mensagem-titulo">
              Não foi possível carregar o ranking.
            </p>
            <p className="telao__mensagem-detalhe">
              A tela tenta de novo sozinha a cada minuto.
            </p>
          </div>
        )}
        {estado.tipo === "sem_campanha" && (
          <div className="telao__mensagem">
            <p className="telao__mensagem-titulo">
              O ranking ainda não está disponível.
            </p>
            <p className="telao__mensagem-detalhe">
              Ele aparece aqui quando a campanha estiver ativa.
            </p>
          </div>
        )}
        {ranking && <Disputa ranking={ranking} />}
      </main>
    </div>
  );
}

function Disputa({ ranking }: { ranking: RankingPublico }) {
  const idJanela = useId();
  const semVendas = ranking.divisoes.every(({ itens }) => itens.length === 0);
  const comPercentual = ranking.divisoes.some(({ itens }) =>
    itens.some((item) => item.percentual_meta_bp !== undefined),
  );

  if (semVendas)
    return (
      <div className="telao__mensagem">
        <p className="telao__mensagem-titulo">
          O ranking aparece aqui depois da primeira venda.
        </p>
        <p className="telao__mensagem-detalhe">
          {ranking.referencia.fase === "antes"
            ? `As vendas começam em ${formatarData(ranking.referencia.data_inicio)}.`
            : `${ranking.janela.nome}: ainda sem vendas.`}
        </p>
      </div>
    );

  return (
    <section className="telao__disputa" aria-labelledby={idJanela}>
      <h2 id={idJanela} className="telao__janela">
        {textoDaJanela(ranking.janela, ranking.referencia)}
      </h2>
      <div className="telao__divisoes">
        {ranking.divisoes.map((divisao) => (
          <Divisao
            key={divisao.divisao}
            {...divisao}
            comPercentual={comPercentual}
          />
        ))}
      </div>
    </section>
  );
}

function Divisao({
  divisao,
  itens,
  comPercentual,
}: RankingDaDivisao & { comPercentual: boolean }) {
  const idTitulo = useId();
  const lista = listaDoTelao(itens);
  return (
    <section className="telao__divisao" aria-labelledby={idTitulo}>
      <div className="telao__divisao-topo">
        <h3 id={idTitulo} className="telao__divisao-titulo">
          {NOMES_DIVISAO[divisao]}
        </h3>
        {comPercentual && (
          <p className="telao__legenda" aria-hidden="true">
            % da meta
          </p>
        )}
      </div>
      {itens.length === 0 ? (
        <p className="telao__sem-vendas">Ainda sem vendas nesta divisão.</p>
      ) : (
        <>
          {/* role="list": com list-style none, o Safari deixaria de anunciar a lista. */}
          <ol className="telao__lista" role="list">
            {lista.itens.map((item, indice) => (
              <Item key={`${indice}-${item.nome}`} item={item} />
            ))}
          </ol>
          {lista.resto && <p className="telao__resto">{lista.resto}</p>}
        </>
      )}
    </section>
  );
}

function Item({ item }: { item: ItemRankingPublico }) {
  return (
    <li
      className="telao__item"
      data-destaque={item.posicao <= POSICOES_EM_DESTAQUE ? "" : undefined}
    >
      {/* Os espaços entre as partes não aparecem (o item é uma grade), mas separam as palavras na leitura. */}
      <span className="telao__posicao">{formatarPosicao(item.posicao)}</span>{" "}
      <span className="telao__nome">{item.nome}</span>
      {item.percentual_meta_bp !== undefined && (
        <>
          {" "}
          <span className="telao__percentual">
            {formatarPercentual(item.percentual_meta_bp)}{" "}
            <span className="visualmente-oculto">da meta</span>
          </span>
        </>
      )}
    </li>
  );
}
