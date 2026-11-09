import { useId } from "react";
import type {
  ItemEquipe,
  RespostaVisaoIndividual,
} from "../../../shared/contracts/api";
import { NOMES_DIVISAO } from "../../../shared/contracts/calculos";
import {
  Aviso,
  Badge,
  DataTable,
  type ColunaTabela,
} from "../../components/ui";
import { formatarNumero } from "../../lib/formatadores";
import {
  formatarPosicao,
  percentualDaMeta,
  situacaoCurta,
  tituloSemAdesao,
} from "./textos";

type Referencia = RespostaVisaoIndividual["referencia"];

// A equipe de quem responde por mais de uma célula: o discipulador vê as células dele; a rede, os
// discipuladores dela, cada um com as células dele. Números de cada um (sem dinheiro), a posição na divisão
// e o aviso de quem ainda não aderiu (célula sem nenhum afiliado da Rifei vinculado). O líder não tem equipe.
export function Equipe({ visao }: { visao: RespostaVisaoIndividual }) {
  const idTitulo = useId();
  const { equipe, alvo, referencia } = visao;
  const celulas = equipe.filter((item) => item.tipo === "celula");
  const semAdesao = celulas.filter((item) => item.afiliados_vinculados === 0);
  const divisao = NOMES_DIVISAO[alvo.divisao];

  return (
    <section className="minha-equipe" aria-labelledby={idTitulo}>
      <div className="minha-equipe__cabecalho">
        <h2 id={idTitulo} className="minha-equipe__titulo">
          {alvo.tipo === "rede" ? "Sua rede" : "Suas células"}
        </h2>
        <p className="minha-equipe__descricao">
          {alvo.tipo === "rede"
            ? `Os discipuladores da rede e as células de cada um. A posição é a de cada um entre os do mesmo nível (discipuladores ou células) dos ${divisao}, no mesmo período do seu ranking.`
            : `As células que você acompanha. A posição é a de cada célula entre as células dos ${divisao}, no mesmo período do seu ranking.`}
        </p>
      </div>
      {semAdesao.length > 0 && (
        <Aviso tom="alerta" titulo={tituloSemAdesao(semAdesao.length)}>
          <p>
            Nenhum link de afiliado da Rifei está ligado a{" "}
            {semAdesao
              .map((celula) => `${celula.nome} (líder: ${celula.lider_nome})`)
              .join(", ")}
            . Sem isso, as vendas pelo link não aparecem na célula: fale com o
            líder e com a coordenação.
          </p>
        </Aviso>
      )}
      {alvo.tipo === "rede" ? (
        <EquipeDaRede
          equipe={equipe}
          referencia={referencia}
          divisao={divisao}
        />
      ) : celulas.length === 0 ? (
        <p className="minha-equipe__vazia">
          Ainda não há células ligadas a você.
        </p>
      ) : (
        <TabelaCelulas
          celulas={celulas}
          legenda={`Células de ${alvo.nome}`}
          referencia={referencia}
          divisao={divisao}
        />
      )}
    </section>
  );
}

type PropsGrupo = {
  equipe: ItemEquipe[];
  referencia: Referencia;
  /** Nome da divisão do alvo ("Jovens"). */
  divisao: string;
};

function EquipeDaRede({ equipe, referencia, divisao }: PropsGrupo) {
  const discipuladores = equipe.filter((item) => item.tipo === "discipulador");
  if (discipuladores.length === 0) {
    return (
      <p className="minha-equipe__vazia">
        Ainda não há discipuladores nesta rede.
      </p>
    );
  }
  return (
    <div className="minha-equipe__grupos">
      {discipuladores.map((discipulador) => (
        <GrupoDoDiscipulador
          key={discipulador.id}
          discipulador={discipulador}
          celulas={equipe.filter(
            (item) =>
              item.tipo === "celula" &&
              item.discipulador_id === discipulador.id,
          )}
          referencia={referencia}
          divisao={divisao}
        />
      ))}
    </div>
  );
}

function GrupoDoDiscipulador({
  discipulador,
  celulas,
  referencia,
  divisao,
}: {
  discipulador: ItemEquipe;
  celulas: ItemEquipe[];
  referencia: Referencia;
  divisao: string;
}) {
  const idGrupo = useId();
  const { desempenho, posicao_divisao: posicao } = discipulador;
  const situacao = situacaoCurta(desempenho, referencia);
  return (
    <section className="minha-grupo" aria-labelledby={idGrupo}>
      <h3 id={idGrupo} className="minha-grupo__titulo">
        {discipulador.nome}
      </h3>
      <dl className="minha-grupo__resumo">
        <div>
          <dt>Meta da campanha</dt>
          <dd>{percentualDaMeta(desempenho.campanha.percentual_meta_bp)}</dd>
        </div>
        <div>
          <dt>Situação</dt>
          <dd>
            <Badge tom={situacao.tom}>{situacao.texto}</Badge>
          </dd>
        </div>
        <div>
          <dt>Bilhetes</dt>
          <dd>{formatarNumero(desempenho.bilhetes.campanha)}</dd>
        </div>
        <div>
          <dt>Posição nos {divisao}</dt>
          <dd>
            {posicao === null
              ? "Fora do ranking (sem células)"
              : formatarPosicao(posicao)}
          </dd>
        </div>
      </dl>
      {celulas.length === 0 ? (
        <p className="minha-equipe__vazia">
          Ainda não há células com este discipulador.
        </p>
      ) : (
        <TabelaCelulas
          celulas={celulas}
          legenda={`Células de ${discipulador.nome}`}
          referencia={referencia}
          divisao={divisao}
        />
      )}
    </section>
  );
}

function TabelaCelulas({
  celulas,
  legenda,
  referencia,
  divisao,
}: {
  celulas: ItemEquipe[];
  legenda: string;
  referencia: Referencia;
  divisao: string;
}) {
  const colunas: ColunaTabela<ItemEquipe>[] = [
    {
      chave: "celula",
      titulo: "Célula",
      principal: true,
      celula: (item) => item.nome,
    },
    { chave: "lider", titulo: "Líder", celula: (item) => item.lider_nome },
    {
      chave: "meta",
      titulo: "Meta da campanha",
      alinhamento: "fim",
      celula: (item) =>
        percentualDaMeta(item.desempenho.campanha.percentual_meta_bp),
    },
    {
      chave: "situacao",
      titulo: "Situação",
      celula: (item) => {
        const situacao = situacaoCurta(item.desempenho, referencia);
        return <Badge tom={situacao.tom}>{situacao.texto}</Badge>;
      },
    },
    {
      chave: "bilhetes",
      titulo: "Bilhetes",
      alinhamento: "fim",
      celula: (item) => formatarNumero(item.desempenho.bilhetes.campanha),
    },
    // Os bilhetes de hoje só existem durante a campanha.
    ...(referencia.fase === "durante"
      ? [
          {
            chave: "hoje",
            titulo: "Vendidos hoje",
            alinhamento: "fim" as const,
            celula: (item: ItemEquipe) =>
              formatarNumero(item.desempenho.bilhetes.hoje ?? 0),
          },
        ]
      : []),
    {
      chave: "posicao",
      titulo: `Posição nos ${divisao}`,
      alinhamento: "fim",
      celula: (item) =>
        item.posicao_divisao === null
          ? "Fora do ranking"
          : formatarPosicao(item.posicao_divisao),
    },
    {
      chave: "adesao",
      titulo: "Adesão",
      celula: (item) =>
        item.afiliados_vinculados === 0 ? (
          <Badge tom="alerta">Não aderiu</Badge>
        ) : (
          <Badge tom="sucesso">Aderiu</Badge>
        ),
    },
  ];
  return (
    <DataTable
      colunas={colunas}
      linhas={celulas}
      chaveDaLinha={(item) => item.id}
      legenda={legenda}
    />
  );
}
