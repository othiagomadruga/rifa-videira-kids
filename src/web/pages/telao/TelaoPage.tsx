import { useId } from "react";
import {
  NOMES_DIVISAO,
  type ItemRankingPublico,
} from "../../../shared/contracts/calculos";
import { TextoContado } from "../../components/movimento";
import { Icone, Marca, TITULO_SEM_CONEXAO } from "../../components/ui";
import { ehFalhaDeConexao } from "../../lib/api";
import { formatarHora, formatarPercentual } from "../../lib/formatadores";
import {
  ATRIBUTO_CHAVE,
  chavesPorNome,
  useListaAnimada,
} from "../../lib/useListaAnimada";
import { CLASSE_COMEMORA, useComemoracao } from "../../lib/useComemoracao";
import { MARCA, tituloDaAba } from "../../tema/marca";
import type {
  RankingDaDivisao,
  RankingPublico,
} from "../ranking-publico/ranking-publico-api";
import {
  descricaoSemVendas,
  formatarPosicao,
  textoDaJanela,
} from "../ranking-publico/textos";
import { useRankingPublico } from "../ranking-publico/useRankingPublico";
import { useSubiu } from "../ranking-publico/useSubiu";
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
// de posição desliza (FLIP), o % conta até o valor, quem passa a bater a meta comemora e quem subiu ganha
// o "↑ subiu" até a próxima mudança de ordem. Nada disso com prefers-reduced-motion (o "↑ subiu" fica, parado).
// RIFA-050 (A-24): a lista cresce para ocupar a altura (escala pela quantidade de itens, data-itens) e o
// carregando mostra o esqueleto da disputa no lugar exato dela.
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
        {/*
         * O lugar da fase existe desde o início (vazio até os dados chegarem): o topo não muda de tamanho. data-fase
         * dá o tamanho do destaque: "Campanha encerrada" e "Começa em 28 dias" são mais longos que "Dia 12 de 24"
         * e ficam menores, para caber entre a marca e a hora (telao.css, RIFA-057).
         */}
        <div className="telao__fase" data-fase={ranking?.referencia.fase}>
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
        {/*
         * A hora: o selo do Kids e o relógio numa linha; embaixo, a linha da atualização, que passa por baixo do selo
         * (a coluna fica com a largura dela, e não com a soma do selo e dos textos: sobra lugar para a fase).
         */}
        <div className="telao__hora">
          <div className="telao__hora-linha">
            <img
              className="telao__kids"
              src={kids.src}
              alt={kids.alt}
              width={kids.largura}
              height={kids.altura}
              decoding="async"
            />
            <p className="telao__relogio">
              <span className="visualmente-oculto">Agora são </span>
              {hora}
            </p>
          </div>
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
      </header>
      <main className="telao__conteudo">
        <h1 className="visualmente-oculto">Telão</h1>
        {estado.tipo === "carregando" && <EsqueletoDaDisputa />}
        {estado.tipo === "erro" && (
          <div className="telao__mensagem" role="alert">
            <span className="telao__mensagem-icone" aria-hidden="true">
              <Icone
                nome={ehFalhaDeConexao(estado.erro) ? "sem-conexao" : "alerta"}
              />
            </span>
            {/* Sem conexão, o título neutro, como no ranking (RIFA-053); as outras falhas, o de sempre. */}
            <p className="telao__mensagem-titulo">
              {ehFalhaDeConexao(estado.erro)
                ? TITULO_SEM_CONEXAO
                : "Não foi possível carregar o ranking."}
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

/**
 * O carregando: o desenho da disputa (o período e as duas divisões com 3 linhas, o limite público), na mesma
 * grade dela, com o brilho do tema (só sem prefers-reduced-motion). Nada pula quando os dados chegam.
 */
function EsqueletoDaDisputa() {
  return (
    <>
      <p className="visualmente-oculto" role="status">
        Carregando o ranking…
      </p>
      <div className="telao__disputa" data-itens={3} aria-hidden="true">
        <div className="mov-esqueleto telao__esqueleto-janela" />
        <div className="telao__divisoes">
          {[0, 1].map((divisao) => (
            <div key={divisao} className="telao__divisao">
              <div className="mov-esqueleto telao__esqueleto-topo" />
              <div className="telao__lista">
                {[0, 1, 2].map((linha) => (
                  <div
                    key={linha}
                    className="mov-esqueleto telao__esqueleto-item"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
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
        {/* O mesmo texto do ranking público, com o convite do primeiro dia (RIFA-053); depois do fim, sem convite. */}
        <p className="telao__mensagem-detalhe">{descricaoSemVendas(ranking)}</p>
      </div>
    );

  // A lista escala pela maior divisão (telao.css): até 3 itens (o limite público), letras bem maiores.
  const itensDaMaior = Math.max(
    ...ranking.divisoes.map(({ itens }) => itens.length),
  );

  return (
    <section
      className="telao__disputa"
      aria-labelledby={idJanela}
      data-itens={itensDaMaior}
    >
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
  const subiram = useSubiu(
    comChaves.map(({ chave, item }) => ({ chave, posicao: item.posicao })),
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
              <Item
                key={chave}
                chave={chave}
                item={item}
                subiu={subiram.has(chave)}
              />
            ))}
          </ol>
          {lista.resto && <p className="telao__resto">{lista.resto}</p>}
        </>
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
      className="telao__item"
      {...{ [ATRIBUTO_CHAVE]: chave }}
      data-destaque={item.posicao <= POSICOES_EM_DESTAQUE ? "" : undefined}
      data-primeiro={item.posicao === 1 ? "" : undefined}
      data-meta-batida={metaBatida ? "" : undefined}
    >
      {/* Os espaços entre as partes não aparecem (o item é uma grade), mas separam as palavras na leitura. */}
      <span className="telao__posicao">{formatarPosicao(item.posicao)}</span>{" "}
      <span className="telao__celula">
        <span className="telao__nome">{item.nome}</span>
        {/* Só visual: a lista já diz a posição de cada um. */}
        {subiu && (
          <span className="telao__subiu" aria-hidden="true">
            <Icone nome="subiu" />
            <span className="telao__subiu-texto">subiu</span>
          </span>
        )}
      </span>
      {item.percentual_meta_bp !== undefined && (
        <>
          {" "}
          <span
            ref={refPercentual}
            className={`telao__percentual ${CLASSE_COMEMORA}`}
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
