import { useId } from "react";
import {
  NOMES_DIVISAO,
  type ItemRankingPublico,
} from "../../../shared/contracts/calculos";
import { TextoContado } from "../../components/movimento";
import { Marca } from "../../components/ui";
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
import { MARCA, tituloDaAba } from "../../tema/marca";
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
/** 100% da meta, em pontos-base: a meta batida ganha o destaque de comemoração. */
const META_BATIDA_BP = 10_000;

// Modo telão (culto, 1920×1080, lido a ~8 m): tela cheia, tema escuro de alto contraste, sem rolagem,
// sem navegação e sem cursor com o mouse parado. Mostra a disputa das células como o ranking público
// ("/"), dos mesmos dados e com a mesma atualização a cada minuto (useRankingPublico): jovens e adultos
// lado a lado, só posições e nomes (e o % da meta, quando a campanha permite). Tela pública: nunca
// valores em dinheiro nem quantidades (regra em docs/frontend.md, conferida em rotas.test.tsx e em
// guarda-telao.test.ts) e só a rota aberta do ranking. Sem botões: falhas se resolvem sozinhas.
// Marca (RIFA-020): o logo da Videira num selo claro no canto e um selo pequeno do Kids ao lado do relógio.
// Movimento só quando os dados mudam (e o fundo ambiente, lento): os itens entram em sequência, quem troca
// de posição desliza (FLIP) e o % conta até o valor. Nada disso com prefers-reduced-motion.
export function TelaoPage() {
  const { estado } = useRankingPublico();
  const hora = useRelogio();
  const cursorEscondido = useCursorEscondidoParado();
  const ranking = estado.tipo === "ok" ? estado.ranking : null;
  // A última atualização automática falhou: a tela continua com os dados anteriores.
  const falhou = estado.tipo === "ok" && estado.falha !== null;
  const fase = ranking ? faseDoTelao(ranking.referencia) : null;
  const { kids } = MARCA;

  return (
    <div
      className="telao"
      data-tema="telao"
      data-cursor={cursorEscondido ? "escondido" : undefined}
    >
      <div className="telao__ambiente" aria-hidden="true" />
      <title>{tituloDaAba("Telão")}</title>
      <header className="telao__topo">
        <div className="telao__marca">
          <Marca />
        </div>
        {/* O lugar da fase existe desde o início (vazio até os dados chegarem): o topo não muda de tamanho. */}
        <div className="telao__fase">
          {fase && (
            <>
              <p
                key={`destaque-${fase.destaque}`}
                className="telao__fase-destaque"
              >
                {fase.destaque}
              </p>
              <p
                key={`detalhe-${fase.detalhe}`}
                className="telao__fase-detalhe"
              >
                {fase.detalhe}
              </p>
            </>
          )}
        </div>
        <div className="telao__hora">
          <img
            className="telao__kids"
            src={kids.src}
            alt={kids.alt}
            width={kids.largura}
            height={kids.altura}
            decoding="async"
          />
          <div className="telao__hora-textos">
            <p className="telao__relogio">
              <span className="visualmente-oculto">Agora são </span>
              {hora}
            </p>
            {/* A linha da atualização também tem lugar desde o início. */}
            <p
              className="telao__atualizado"
              data-falhou={falhou ? "" : undefined}
            >
              {ranking && (
                <>
                  Atualizado às {formatarHora(ranking.atualizadoEm)}
                  {/* Região viva fixa: avisa quando uma atualização automática falha. */}
                  <span role="status">{falhou ? " · sem conexão" : ""}</span>
                </>
              )}
            </p>
          </div>
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
  const comChaves = chavesPorNome(lista.itens);
  // A ordem das chaves muda quando alguém troca de lugar, entra ou sai: só aí a lista se mexe.
  const refLista = useListaAnimada<HTMLOListElement>(
    comChaves.map(({ chave }) => chave).join("|"),
  );
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
          <ol ref={refLista} className="telao__lista" role="list">
            {comChaves.map(({ chave, item }) => (
              <Item key={chave} chave={chave} item={item} />
            ))}
          </ol>
          {lista.resto && <p className="telao__resto">{lista.resto}</p>}
        </>
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
      className="telao__item"
      {...{ [ATRIBUTO_CHAVE]: chave }}
      data-destaque={item.posicao <= POSICOES_EM_DESTAQUE ? "" : undefined}
      data-primeiro={item.posicao === 1 ? "" : undefined}
      data-meta-batida={metaBatida ? "" : undefined}
    >
      {/* Os espaços entre as partes não aparecem (o item é uma grade), mas separam as palavras na leitura. */}
      <span className="telao__posicao">{formatarPosicao(item.posicao)}</span>{" "}
      <span className="telao__nome">{item.nome}</span>
      {item.percentual_meta_bp !== undefined && (
        <>
          {" "}
          <span ref={refPercentual} className="telao__percentual">
            <TextoContado texto={formatarPercentual(item.percentual_meta_bp)} />{" "}
            <span className="visualmente-oculto">da meta</span>
          </span>
        </>
      )}
    </li>
  );
}
