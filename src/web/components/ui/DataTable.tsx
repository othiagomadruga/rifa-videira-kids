import { useId, type ReactNode } from "react";
import { ComAjuda, type TextoDeAjuda } from "./Ajuda";
import { EmptyState } from "./EmptyState";
import "./DataTable.css";

export type ColunaTabela<T> = {
  /** Identificador único da coluna. */
  chave: string;
  /** Cabeçalho da coluna; no celular, vira o rótulo do valor no cartão. */
  titulo: string;
  /**
   * O que a coluna mostra (RIFA-066): no cabeçalho e no "?" ao lado (Ajuda.tsx). No celular o cabeçalho some (cada
   * valor leva o rótulo no cartão), e a ajuda vai junto: use nas colunas cujo nome não basta.
   */
  ajuda?: TextoDeAjuda;
  /** Conteúdo da célula (já formatado). */
  celula: (linha: T) => ReactNode;
  /** "fim" alinha à direita no computador (números e valores). */
  alinhamento?: "inicio" | "fim";
  /** No celular, vira o título do cartão (sem rótulo). Use em uma coluna só. */
  principal?: boolean;
};

type Props<T> = {
  colunas: readonly ColunaTabela<T>[];
  linhas: readonly T[];
  /** Chave estável de cada linha (ex.: o id do registro). */
  chaveDaLinha: (linha: T, indice: number) => string | number;
  /** Nome da tabela para leitores de tela (<caption>). */
  legenda: string;
  /** Mostra a legenda na tela (por padrão ela fica só para leitores de tela). */
  mostrarLegenda?: boolean;
  /** O que mostrar quando não há linhas. */
  vazio?: ReactNode;
};

// Tabela no computador e cartões empilhados no celular (abaixo de 48rem), com o
// mesmo HTML. Os papéis ARIA explícitos mantêm a semântica de tabela mesmo quando
// o CSS muda o display das células.
export function DataTable<T>({
  colunas,
  linhas,
  chaveDaLinha,
  legenda,
  mostrarLegenda = false,
  vazio,
}: Props<T>) {
  const idTabela = useId();
  if (linhas.length === 0) {
    return vazio ?? <EmptyState titulo="Nenhum registro para mostrar." />;
  }

  return (
    <div className="ui-data-table">
      <table className="ui-data-table__tabela" role="table">
        <caption
          className={
            mostrarLegenda ? "ui-data-table__legenda" : "visualmente-oculto"
          }
        >
          {legenda}
        </caption>
        <thead className="ui-data-table__cabecalho" role="rowgroup">
          <tr role="row">
            {colunas.map((coluna) => (
              <th
                key={coluna.chave}
                scope="col"
                role="columnheader"
                data-alinhamento={coluna.alinhamento}
              >
                {coluna.ajuda ? (
                  <ComAjuda
                    texto={coluna.ajuda}
                    idDoTitulo={`${idTabela}-${coluna.chave}`}
                  >
                    <span id={`${idTabela}-${coluna.chave}`}>
                      {coluna.titulo}
                    </span>
                  </ComAjuda>
                ) : (
                  coluna.titulo
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {linhas.map((linha, indice) => (
            <tr key={chaveDaLinha(linha, indice)} role="row">
              {colunas.map((coluna) => (
                <td
                  key={coluna.chave}
                  role="cell"
                  data-rotulo={coluna.titulo}
                  data-alinhamento={coluna.alinhamento}
                  data-principal={coluna.principal ? "" : undefined}
                >
                  {coluna.celula(linha)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
