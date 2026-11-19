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
  ComAjuda,
} from "../../components/ui";
import { formatarNumero } from "../../lib/formatadores";
import {
  formatarPosicao,
  percentualDaMeta,
  situacaoCurta,
  tituloSemAdesao,
  AJUDA,
} from "./textos";

type Referencia = RespostaVisaoIndividual["referencia"];

// A equipe de quem responde por mais de uma célula: o discipulador vê as células dele; a rede, os
// discipuladores dela, cada um com as células dele. Números de cada um (sem dinheiro), a posição na divisão (sem
// ranking por divisão, D27, a posição entre todos) e o aviso de quem ainda não aderiu (célula sem nenhum afiliado da Rifei vinculado). O líder não tem equipe.
export function Equipe({ visao }: { visao: RespostaVisaoIndividual }) {
  const idTitulo = useId();
  const { equipe, alvo, referencia } = visao;
  const celulas = equipe.filter((item) => item.tipo === "celula");
  const semAdesao = celulas.filter((item) => item.afiliados_vinculados === 0);
  // Sem ranking por divisão (D27), a posição é entre todos: o título da coluna não fala de divisão.
  const porDivisao = visao.ranking.por_divisao !== false;
  const divisao = NOMES_DIVISAO[alvo.divisao];
  const titulo = porDivisao ? `Posição nos ${divisao}` : "Posição";
  const entre = porDivisao
    ? {
        rede: `entre os do mesmo nível (discipuladores ou células) dos ${divisao}`,
        celulas: `entre as células dos ${divisao}`,
      }
    : {
        rede: "entre todos os do mesmo nível (discipuladores ou células)",
        celulas: "entre todas as células",
      };

  return (
    <section className="minha-equipe" aria-labelledby={idTitulo}>
      <div className="minha-equipe__cabecalho">
        <ComAjuda
          texto={alvo.tipo === "rede" ? AJUDA.equipeRede : AJUDA.equipeCelulas}
          idDoTitulo={idTitulo}
        >
          <h2 id={idTitulo} className="minha-equipe__titulo">
            {alvo.tipo === "rede" ? "Sua rede" : "Suas células"}
          </h2>
        </ComAjuda>
        <p className="minha-equipe__descricao">
          {alvo.tipo === "rede"
            ? `Os discipuladores da rede e as células de cada um. A posição é a de cada um ${entre.rede}, no mesmo período do seu ranking.`
            : `As células que você acompanha. A posição é a de cada célula ${entre.celulas}, no mesmo período do seu ranking.`}
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
        <EquipeDaRede equipe={equipe} referencia={referencia} titulo={titulo} />
      ) : celulas.length === 0 ? (
        <p className="minha-equipe__vazia">
          Ainda não há células ligadas a você.
        </p>
      ) : (
        <TabelaCelulas
          celulas={celulas}
          legenda={`Células de ${alvo.nome}`}
          referencia={referencia}
          titulo={titulo}
        />
      )}
    </section>
  );
}

type PropsGrupo = {
  equipe: ItemEquipe[];
  referencia: Referencia;
  /** O título da posição: "Posição nos Jovens" (sem ranking por divisão, "Posição"). */
  titulo: string;
};

function EquipeDaRede({ equipe, referencia, titulo }: PropsGrupo) {
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
          titulo={titulo}
        />
      ))}
    </div>
  );
}

function GrupoDoDiscipulador({
  discipulador,
  celulas,
  referencia,
  titulo,
}: {
  discipulador: ItemEquipe;
  celulas: ItemEquipe[];
  referencia: Referencia;
  titulo: string;
}) {
  const idGrupo = useId();
  const { desempenho, posicao_divisao: posicao } = discipulador;
  const situacao = situacaoCurta(desempenho, referencia);
  return (
    <section className="minha-grupo" aria-labelledby={idGrupo}>
      <h3
        id={idGrupo}
        className="minha-grupo__titulo"
        // O nome do discipulador, não um título de seção (RIFA-066).
        data-sem-ajuda="nome do discipulador"
      >
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
          <dt>{titulo}</dt>
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
          titulo={titulo}
        />
      )}
    </section>
  );
}

function TabelaCelulas({
  celulas,
  legenda,
  referencia,
  titulo,
}: {
  celulas: ItemEquipe[];
  legenda: string;
  referencia: Referencia;
  titulo: string;
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
      titulo,
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
