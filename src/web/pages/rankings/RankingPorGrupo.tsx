import { useEffect, useId, useState } from "react";
import type {
  GrupoRanking,
  JanelaRanking,
  NivelRankingGrupos,
  RespostaRankingGrupos,
} from "../../../shared/contracts/calculos";
import { ComAjuda, ErrorState } from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { ajuda } from "../ajuda-sob-demanda";
import {
  caminhoDoRankingGrupos,
  carregarRankingGrupos,
  ehSemCampanha,
} from "./rankings-api";
import { TabelaRanking } from "./TabelaRanking";
import { TEXTO_NIVEL } from "./textos";

type Resultado =
  | { tipo: "ok"; resposta: RespostaRankingGrupos }
  | { tipo: "erro"; erro: unknown };

/** O resultado de uma consulta: o caminho pedido à API identifica o nível e a janela. */
type Carga = { caminho: string; resultado: Resultado };

type Props = {
  nivel: NivelRankingGrupos;
  periodo: JanelaRanking;
  /** Uma rede só (RIFA-065, D30): o vínculo sem a rede. */
  redeUnica: boolean;
};

// RIFA-084 (D39): o ranking por grupo do discipulador (adultos da manhã, adultos da noite, jovens e adolescentes),
// embaixo do ranking de todas, no mesmo nível (células ou discipuladores) e na mesma janela, com a posição dentro do
// grupo. Só a coordenação vê (o ranking aberto não muda). Nenhum discipulador com grupo e com células: a seção não
// aparece (nem o carregando, para nada piscar). Sem campanha ativa, o ranking de cima já explica: aqui, nada.
export function RankingPorGrupo({ nivel, periodo, redeUnica }: Props) {
  const caminho = caminhoDoRankingGrupos(nivel, periodo);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const idTitulo = useId();

  useEffect(() => {
    const controle = new AbortController();
    carregarRankingGrupos(caminho, { signal: controle.signal }).then(
      (resposta) => {
        if (controle.signal.aborted) return;
        setCarga({ caminho, resultado: { tipo: "ok", resposta } });
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setCarga({ caminho, resultado: { tipo: "erro", erro } });
      },
    );
    return () => controle.abort();
  }, [caminho, tentativa]);

  // Até chegar a resposta do nível e da janela atuais, nada (nunca os grupos de outro filtro).
  const resultado = carga?.caminho === caminho ? carga.resultado : null;
  if (resultado === null) return null;
  if (resultado.tipo === "erro" && ehSemCampanha(resultado.erro)) return null;
  if (resultado.tipo === "ok" && resultado.resposta.grupos.length === 0)
    return null;

  return (
    <section className="rankings-grupos" aria-labelledby={idTitulo}>
      <ComAjuda texto={ajuda("rankingPorGrupo")} idDoTitulo={idTitulo}>
        <h2 id={idTitulo} className="rankings-grupos__titulo">
          Ranking por grupo
        </h2>
      </ComAjuda>
      {resultado.tipo === "erro" ? (
        <ErrorState
          titulo="Não foi possível carregar o ranking por grupo."
          mensagem={mensagemDoErro(resultado.erro)}
          conexao={ehFalhaDeConexao(resultado.erro)}
          aoTentarDeNovo={() => {
            setCarga(null);
            setTentativa((atual) => atual + 1);
          }}
        />
      ) : (
        <>
          <p className="rankings-grupos__descricao">
            A mesma disputa, separada pelo grupo do discipulador: a posição é
            dentro do grupo.
          </p>
          {resultado.resposta.grupos.map((grupo) => (
            <Grupo
              key={grupo.id}
              grupo={grupo}
              resposta={resultado.resposta}
              redeUnica={redeUnica}
            />
          ))}
        </>
      )}
    </section>
  );
}

function Grupo({
  grupo,
  resposta,
  redeUnica,
}: {
  grupo: GrupoRanking;
  resposta: RespostaRankingGrupos;
  redeUnica: boolean;
}) {
  const idGrupo = useId();
  return (
    <section className="rankings-grupos__grupo" aria-labelledby={idGrupo}>
      {/* O nome do grupo é o nome de um item da lista, não um título que precise de explicação (a da seção serve). */}
      <h3 id={idGrupo} className="rankings-grupos__nome" data-sem-ajuda="">
        {grupo.nome}
      </h3>
      {grupo.itens.length === 0 ? (
        <p className="rankings-grupos__vazio">
          {`Nenhum ${TEXTO_NIVEL[resposta.nivel].singular} neste grupo.`}
        </p>
      ) : (
        <TabelaRanking
          resposta={{
            nivel: resposta.nivel,
            // O grupo é outro recorte (D39): a divisão não entra na legenda nem no vínculo.
            divisao: null,
            por_divisao: false,
            unidade: resposta.unidade,
            janela: resposta.janela,
            itens: grupo.itens,
          }}
          redeUnica={redeUnica}
          grupo={grupo.nome}
        />
      )}
    </section>
  );
}
