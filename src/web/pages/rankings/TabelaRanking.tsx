import {
  NOMES_DIVISAO,
  type ItemRanking,
  type RespostaRanking,
  type UnidadeMeta,
} from "../../../shared/contracts/calculos";
import { useId, type ReactNode } from "react";
import {
  Badge,
  ComAjuda,
  ProgressBar,
  type TextoDeAjuda,
} from "../../components/ui";
import {
  TEXTO_COLUNA_VALORES,
  TEXTO_NIVEL,
  TEXTO_SITUACAO,
  formatarPosicao,
  realizadoEMeta,
  textoDaFalta,
} from "./textos";
import { ajuda } from "../ajuda-sob-demanda";

/** Posições até esta ganham destaque (empatados no 3º lugar também). */
export const POSICOES_EM_DESTAQUE = 3;

type Props = {
  resposta: RespostaRanking;
  /** Uma rede só (RIFA-065, D30): o vínculo sem a rede. */
  redeUnica?: boolean;
};

// O ranking da coordenação: tabela no computador (a partir de 48rem) e, no celular, um cartão compacto
// por linha (posição, nome e situação no topo; a barra do % da meta e realizado/meta embaixo), com o
// mesmo HTML. Os papéis ARIA explícitos mantêm a semântica de tabela quando o CSS muda o display.
export function TabelaRanking({ resposta, redeUnica = false }: Props) {
  const { nivel, divisao, unidade, janela, itens } = resposta;
  const textos = TEXTO_NIVEL[nivel];
  // Sem ranking por divisão (D27), a legenda não fala de divisão.
  const legenda = [
    `Ranking: ${textos.plural}`,
    janela.nome,
    ...(resposta.por_divisao === false
      ? []
      : [divisao ? NOMES_DIVISAO[divisao] : "todas as divisões"]),
  ].join(" · ");

  return (
    <div className="rankings-tabela">
      <table className="rankings-tabela__tabela" role="table">
        <caption className="visualmente-oculto">{legenda}</caption>
        <thead className="rankings-tabela__cabecalho" role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              Posição
            </th>
            <th scope="col" role="columnheader">
              {textos.coluna}
            </th>
            <ColunaComAjuda texto={ajuda("colunaPercentual")}>
              % da meta
            </ColunaComAjuda>
            <th scope="col" role="columnheader" data-alinhamento="fim">
              {TEXTO_COLUNA_VALORES[unidade]}
            </th>
            <ColunaComAjuda texto={ajuda("colunaSituacao")}>
              Situação
            </ColunaComAjuda>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {itens.map((item) => (
            <Linha
              key={item.id}
              item={item}
              unidade={unidade}
              vinculo={vinculoDoItem(item, resposta, redeUnica)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type PropsLinha = {
  item: ItemRanking;
  unidade: UnidadeMeta;
  vinculo: string;
};

function Linha({ item, unidade, vinculo }: PropsLinha) {
  const situacao = TEXTO_SITUACAO[item.situacao];
  const falta = item.situacao === "abaixo" && item.diferenca < 0;
  return (
    <tr
      role="row"
      className="rankings-linha"
      data-destaque={item.posicao <= POSICOES_EM_DESTAQUE ? "" : undefined}
    >
      <td role="cell" className="rankings-linha__posicao">
        <span className="rankings-posicao">
          {formatarPosicao(item.posicao)}
        </span>
      </td>
      <th role="rowheader" scope="row" className="rankings-linha__nome">
        <span className="rankings-linha__titulo">{item.nome}</span>
        {vinculo && (
          <>
            {/* A vírgula (só para o leitor de tela) separa o nome do vínculo, que fica na linha de baixo. */}
            <span className="visualmente-oculto">,</span>{" "}
            <span className="rankings-linha__vinculo">{vinculo}</span>
          </>
        )}
      </th>
      <td role="cell" className="rankings-linha__percentual">
        {item.percentual_meta_bp === null ? (
          <span className="rankings-linha__sem-meta">
            <span aria-hidden="true">—</span>
            <span className="visualmente-oculto">Sem meta</span>
          </span>
        ) : (
          <ProgressBar
            rotulo="% da meta"
            valor={item.percentual_meta_bp}
            meta={10_000}
          />
        )}
      </td>
      <td
        role="cell"
        className="rankings-linha__valores"
        data-alinhamento="fim"
      >
        {realizadoEMeta(item.realizado, item.meta, unidade)}
      </td>
      <td role="cell" className="rankings-linha__situacao">
        <Badge tom={situacao.tom}>{situacao.texto}</Badge>
        {falta && (
          <>
            {" "}
            <span className="rankings-linha__falta">
              {textoDaFalta(-item.diferenca, unidade)}
            </span>
          </>
        )}
      </td>
    </tr>
  );
}

/**
 * A quem o item pertence: célula → discipulador e rede; discipulador → rede; rede → a divisão. Com
 * "todas as divisões", a divisão vem na frente em todos os níveis. Sem ranking por divisão (D27), a divisão não
 * aparece (a rede fica sem vínculo). Com uma rede só (D30), a rede não aparece.
 */
function vinculoDoItem(
  item: ItemRanking,
  resposta: RespostaRanking,
  redeUnica: boolean,
): string {
  const partes: string[] = [];
  if (
    resposta.por_divisao !== false &&
    (resposta.divisao === null || resposta.nivel === "rede")
  ) {
    partes.push(NOMES_DIVISAO[item.divisao]);
  }
  if (item.discipulador) partes.push(item.discipulador.nome);
  if (item.rede && !redeUnica) partes.push(item.rede.nome);
  return partes.join(" · ");
}

/**
 * Cabeçalho de coluna com a ajuda (RIFA-066): o "?" fica dentro do <th>, que se chama só pelo texto (aria-labelledby;
 * sem isso, o nome da coluna levaria o "Ajuda: ..." do botão).
 */
function ColunaComAjuda({
  texto,
  children,
}: {
  texto: TextoDeAjuda;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <th scope="col" role="columnheader" aria-labelledby={id}>
      <ComAjuda texto={texto} idDoTitulo={id}>
        <span id={id}>{children}</span>
      </ComAjuda>
    </th>
  );
}
