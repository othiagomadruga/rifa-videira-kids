import { useId } from "react";
import type { RespostaVisaoIndividual } from "../../../shared/contracts/api";
import { NOMES_DIVISAO } from "../../../shared/contracts/calculos";
import { Badge, Card } from "../../components/ui";
import {
  TEXTO_DO_CRITERIO,
  formatarPosicao,
  fraseSemCelulas,
  fraseSemVendas,
  textoDaColocacao,
  textoDaJanela,
  textoDoVizinho,
  textoDosPares,
  type PosicaoIndividual,
} from "./textos";

// A posição do alvo entre os pares (na divisão, que é a da premiação, e no geral), com o nome e a posição do
// vizinho de cima e do de baixo (sem a distância: D12), e os primeiros da divisão com o próprio alvo
// destacado. Antes da 1ª venda do alvo, uma frase de incentivo no lugar da posição; alvo sem células (fora do
// ranking, posições null), a explicação.
export function RankingIndividual({
  visao,
}: {
  visao: RespostaVisaoIndividual;
}) {
  const idPrimeiros = useId();
  const { ranking, alvo, referencia, desempenho } = visao;
  const divisao = NOMES_DIVISAO[alvo.divisao];
  const foraDoRanking = ranking.geral === null || ranking.divisao === null;
  const semVendas = desempenho.bilhetes.campanha === 0;

  return (
    <Card titulo="Ranking" className="minha-ranking">
      <div className="minha-ranking__corpo">
        <p className="minha-ranking__janela">
          {textoDaJanela(ranking.janela, referencia)}
        </p>
        {ranking.geral === null || ranking.divisao === null ? (
          <p className="minha-ranking__frase">{fraseSemCelulas(alvo.tipo)}</p>
        ) : semVendas ? (
          <p className="minha-ranking__frase" data-incentivo="">
            {fraseSemVendas(alvo.tipo, referencia)}
          </p>
        ) : (
          <div className="minha-posicoes">
            <Posicao
              titulo="Na sua divisão"
              pares={textoDosPares(ranking.nivel, alvo.divisao)}
              posicao={ranking.divisao}
            />
            <Posicao
              titulo="Geral"
              pares={textoDosPares(ranking.nivel, null)}
              posicao={ranking.geral}
            />
          </div>
        )}
        <section className="minha-primeiros" aria-labelledby={idPrimeiros}>
          <h3 id={idPrimeiros} className="minha-primeiros__titulo">
            Os primeiros dos {divisao}
          </h3>
          {ranking.primeiros.length === 0 ? (
            <p className="minha-ranking__nota">
              Ninguém vendeu ainda nesta disputa.
            </p>
          ) : (
            // role="list": com list-style none, o Safari deixaria de anunciar a lista.
            <ol className="minha-primeiros__lista" role="list">
              {ranking.primeiros.map((item, indice) => (
                <li
                  key={`${indice}-${item.nome}`}
                  className="minha-primeiros__item"
                  data-eu={item.eu ? "" : undefined}
                  aria-current={item.eu ? "true" : undefined}
                >
                  {/* Os espaços separam as palavras na leitura (o item é uma grade). */}
                  <span className="minha-primeiros__posicao">
                    {formatarPosicao(item.posicao)}
                  </span>{" "}
                  <span className="minha-primeiros__nome">{item.nome}</span>
                  {item.eu && (
                    <>
                      {" "}
                      <Badge tom="info">Você</Badge>
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
        {!foraDoRanking && (
          <p className="minha-ranking__nota">
            {TEXTO_DO_CRITERIO[ranking.criterio]}
          </p>
        )}
      </div>
    </Card>
  );
}

function Posicao({
  titulo,
  pares,
  posicao,
}: {
  titulo: string;
  pares: string;
  posicao: PosicaoIndividual;
}) {
  const id = useId();
  return (
    <section className="minha-posicao" aria-labelledby={id}>
      <h3 id={id} className="minha-posicao__titulo">
        {titulo}
      </h3>
      <p className="minha-posicao__numero">{textoDaColocacao(posicao)}</p>
      <p className="minha-posicao__pares">{pares}</p>
      <dl className="minha-vizinhos">
        <div>
          <dt>Logo acima</dt>
          <dd>
            {posicao.acima === null
              ? "Ninguém: é o 1º lugar"
              : textoDoVizinho(posicao.acima)}
          </dd>
        </div>
        <div>
          <dt>Logo abaixo</dt>
          <dd>{textoDoVizinho(posicao.abaixo)}</dd>
        </div>
      </dl>
    </section>
  );
}
