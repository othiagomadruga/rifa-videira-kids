import { useEffect, useId, useState } from "react";
import type {
  JanelaRanking,
  NivelRankingGrupos,
} from "../../../shared/contracts/calculos";
import type { Alvo, TipoAlvo } from "../../../shared/contracts/dominio";
import type {
  ItemCelulaTodasAsRedes,
  ItemDiscipuladorTodasAsRedes,
  RespostaTodasAsRedes,
} from "../../../shared/contracts/todas-as-redes";
import {
  Badge,
  Button,
  Card,
  ComAjuda,
  ComDica,
  ErrorState,
  Loading,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { formatarPercentual } from "../../lib/formatadores";
import { carregarTodasAsRedes } from "./todas-as-redes-api";
import {
  TEXTO_DO_CRITERIO,
  TEXTO_JANELA_COMPRADORES,
  bilhetes,
  formatarPosicao,
  textoDaJanela,
} from "./textos";
import {
  AJUDA_TODAS_AS_REDES,
  DICAS_TODAS_AS_REDES,
  LINHAS_VISIVEIS_TODAS_AS_REDES,
  TITULO_DA_LISTA,
  TITULO_TODAS_AS_REDES,
  listaVazia,
  seloDaLinha,
  textoVerMenos,
  textoVerTodas,
} from "./textos-todas-as-redes";
import "./minha-todas-as-redes.css";

const JANELAS: readonly JanelaRanking[] = ["atual", "campanha"];

type Resultado =
  | { tipo: "ok"; resposta: RespostaTodasAsRedes }
  | { tipo: "erro"; erro: unknown };

/** O resultado da janela pedida (a troca de janela nunca mostra o ranking da outra). */
type Carga = { janela: JanelaRanking; resultado: Resultado };

// O ranking geral (RIFA-090, adendo da D12), embaixo de tudo o que o discipulador (e a rede) já vê na /minha: todos os
// discipuladores e todas as células, com a posição, o % da meta e os bilhetes, e as linhas dele em destaque. A mesma
// troca "Esta semana" / "Campanha toda" dos maiores compradores; as 10 primeiras de cada lista e o "Ver todas" (as linhas
// dele que ficam abaixo das 10 primeiras aparecem mesmo assim). Nunca dinheiro nem comprador (a rota não devolve;
// guarda-minha.test.ts confere o código). Acompanha a atualização da visão (a cada minuto): `atualizadoEm` muda e o
// ranking é pedido de novo, sem sumir da tela enquanto chega; se essa atualização falha, o de antes fica.
export function TodasAsRedes({
  alvo,
  atualizadoEm,
}: {
  alvo: Alvo;
  atualizadoEm: string;
}) {
  const [janela, setJanela] = useState<JanelaRanking>("atual");
  const [carga, setCarga] = useState<Carga | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    carregarTodasAsRedes(janela, { signal: controle.signal }).then(
      (resposta) => {
        if (controle.signal.aborted) return;
        setCarga({ janela, resultado: { tipo: "ok", resposta } });
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setCarga((anterior) =>
          anterior?.janela === janela && anterior.resultado.tipo === "ok"
            ? anterior
            : { janela, resultado: { tipo: "erro", erro } },
        );
      },
    );
    return () => controle.abort();
  }, [janela, atualizadoEm, tentativa]);

  const resultado = carga?.janela === janela ? carga.resultado : null;

  return (
    <Card
      titulo={TITULO_TODAS_AS_REDES}
      ajuda={AJUDA_TODAS_AS_REDES.titulo}
      className="minha-todas"
    >
      <div className="minha-todas__corpo">
        <div
          className="minha-todas__janelas"
          role="group"
          aria-label="Período do ranking geral"
        >
          {JANELAS.map((opcao) => (
            <ComDica key={opcao} texto={DICAS_TODAS_AS_REDES.janela[opcao]}>
              <Button
                variante={opcao === janela ? "primario" : "secundario"}
                tamanho="pequeno"
                aria-pressed={opcao === janela}
                onClick={() => setJanela(opcao)}
              >
                {TEXTO_JANELA_COMPRADORES[opcao]}
              </Button>
            </ComDica>
          ))}
        </div>
        {resultado === null ? (
          <Loading texto="Carregando o ranking geral…" />
        ) : resultado.tipo === "erro" ? (
          <ErrorState
            titulo="Não foi possível carregar o ranking geral."
            mensagem={mensagemDoErro(resultado.erro)}
            conexao={ehFalhaDeConexao(resultado.erro)}
            aoTentarDeNovo={() => {
              setCarga(null);
              setTentativa((atual) => atual + 1);
            }}
          />
        ) : (
          <Quadro resposta={resultado.resposta} tipo={alvo.tipo} />
        )}
      </div>
    </Card>
  );
}

function Quadro({
  resposta,
  tipo,
}: {
  resposta: RespostaTodasAsRedes;
  tipo: TipoAlvo;
}) {
  return (
    <>
      <p className="minha-todas__janela">
        {textoDaJanela(resposta.janela, resposta.referencia)}
      </p>
      <Lista
        nivel="discipulador"
        itens={resposta.discipuladores}
        tipo={tipo}
        ajuda={AJUDA_TODAS_AS_REDES.discipuladores}
      />
      <Lista
        nivel="celula"
        itens={resposta.celulas}
        tipo={tipo}
        ajuda={AJUDA_TODAS_AS_REDES.celulas}
      />
      <p className="minha-todas__nota">
        {TEXTO_DO_CRITERIO[resposta.criterio]}
      </p>
    </>
  );
}

type Item = ItemDiscipuladorTodasAsRedes | ItemCelulaTodasAsRedes;

/** "35% da meta" ou "Sem meta". */
function percentual(percentualBp: number | null): string {
  return percentualBp === null
    ? "Sem meta"
    : `${formatarPercentual(percentualBp)} da meta`;
}

/**
 * As linhas que aparecem: todas, ou as primeiras e, abaixo delas, as de quem vê que ficaram fora (a primeira dessas
 * marca o corte). `indice` é a posição na lista inteira (a chave da linha).
 */
function linhasVisiveis(itens: readonly Item[], todas: boolean) {
  const comIndice = itens.map((item, indice) => ({
    item,
    indice,
    depoisDoCorte: false,
  }));
  if (todas || itens.length <= LINHAS_VISIVEIS_TODAS_AS_REDES) return comIndice;
  const suasAbaixo = comIndice
    .slice(LINHAS_VISIVEIS_TODAS_AS_REDES)
    .filter(({ item }) => item.eu);
  return [
    ...comIndice.slice(0, LINHAS_VISIVEIS_TODAS_AS_REDES),
    ...suasAbaixo.map((linha, posicao) => ({
      ...linha,
      depoisDoCorte: posicao === 0,
    })),
  ];
}

function Lista({
  nivel,
  itens,
  tipo,
  ajuda,
}: {
  nivel: NivelRankingGrupos;
  itens: readonly Item[];
  tipo: TipoAlvo;
  /** A explicação do título (RIFA-066). */
  ajuda: string;
}) {
  const idTitulo = useId();
  const idLista = useId();
  const [todas, setTodas] = useState(false);
  const longa = itens.length > LINHAS_VISIVEIS_TODAS_AS_REDES;

  return (
    <section className="minha-todas__secao" aria-labelledby={idTitulo}>
      <ComAjuda texto={ajuda} idDoTitulo={idTitulo}>
        <h3 id={idTitulo} className="minha-todas__titulo">
          {TITULO_DA_LISTA[nivel]}
        </h3>
      </ComAjuda>
      {itens.length === 0 ? (
        <p className="minha-todas__vazio">{listaVazia(nivel)}</p>
      ) : (
        <>
          {/* role="list": com list-style none, o Safari deixaria de anunciar a lista. */}
          <ol id={idLista} className="minha-todas__lista" role="list">
            {linhasVisiveis(itens, todas).map(
              ({ item, indice, depoisDoCorte }) => (
                <li
                  key={indice}
                  className="minha-todas__item"
                  data-eu={item.eu ? "" : undefined}
                  data-depois-do-corte={depoisDoCorte ? "" : undefined}
                  aria-current={item.eu ? "true" : undefined}
                >
                  {/* Os espaços separam as palavras na leitura (o item é uma grade). */}
                  <span className="minha-todas__posicao">
                    {formatarPosicao(item.posicao)}
                  </span>{" "}
                  <span className="minha-todas__quem">
                    <span className="minha-todas__nome">
                      {item.nome}
                      {item.eu && (
                        <>
                          {" "}
                          <Badge tom="info">{seloDaLinha(tipo, nivel)}</Badge>
                        </>
                      )}
                    </span>
                    {"discipulador" in item && (
                      <>
                        {" "}
                        <span className="minha-todas__discipulador">
                          {item.discipulador}
                        </span>
                      </>
                    )}
                  </span>{" "}
                  <span className="minha-todas__numeros">
                    <span className="minha-todas__percentual">
                      {percentual(item.percentual_meta_bp)}
                    </span>{" "}
                    <span className="minha-todas__bilhetes">
                      {bilhetes(item.bilhetes)}
                    </span>
                  </span>
                </li>
              ),
            )}
          </ol>
          {longa && (
            <ComDica
              texto={
                todas
                  ? DICAS_TODAS_AS_REDES.verMenos
                  : DICAS_TODAS_AS_REDES.verTodas
              }
            >
              <Button
                variante="secundario"
                tamanho="pequeno"
                aria-expanded={todas}
                aria-controls={idLista}
                onClick={() => setTodas((atual) => !atual)}
              >
                {todas
                  ? textoVerMenos(nivel, LINHAS_VISIVEIS_TODAS_AS_REDES)
                  : textoVerTodas(nivel, itens.length)}
              </Button>
            </ComDica>
          )}
        </>
      )}
    </section>
  );
}
