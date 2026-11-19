import { useId, type ReactNode } from "react";
import { classesBotao } from "./Button";
import { ComDica } from "./Dica";
import "./Campos.css";
import "./SeletorArquivo.css";

type Props = {
  /** Rótulo do campo (acima do botão). */
  rotulo: ReactNode;
  dica?: ReactNode;
  /** Mensagem de erro; quando presente, o campo fica inválido. */
  erro?: ReactNode;
  /** Tipos aceitos (atributo `accept`), ex.: ".csv,text/csv". */
  aceitar?: string;
  /** Arquivo escolhido, controlado por quem usa: o nome aparece ao lado do botão. */
  arquivo: File | null;
  aoEscolher: (arquivo: File) => void;
  /**
   * Vários arquivos de uma vez (RIFA-074): o campo aceita mais de um (`multiple`) e entrega todos aqui (o
   * `aoEscolher` não é chamado). O texto ao lado do botão vem de `textoArquivo`.
   */
  aoEscolherVarios?: (arquivos: File[]) => void;
  /** O texto ao lado do botão no lugar do nome do arquivo (com vários, "3 arquivos: ..."). */
  textoArquivo?: ReactNode;
  textoBotao?: string;
  textoSemArquivo?: string;
  desabilitado?: boolean;
  /**
   * Dica (tooltip, RIFA-045) do botão de escolher: para que serve o arquivo e o que acontece ao escolher. Abre com
   * o mouse no botão e com o foco do teclado no campo (o `<input>` escondido), e entra na descrição do campo.
   */
  dicaEscolher?: ReactNode;
  id?: string;
};

// Escolha de arquivo com a cara dos outros campos: o <input type="file"> de verdade fica escondido só
// visualmente (continua focável e é ele que o teclado e o leitor de tela usam) e o botão é um <label>
// dele, então clicar no rótulo ou no botão abre o seletor sem JavaScript. O foco aparece no botão.
// Depois de cada escolha o campo é limpo: escolher de novo o mesmo arquivo (corrigido) também avisa.
export function SeletorArquivo({
  rotulo,
  dica,
  erro,
  aceitar,
  arquivo,
  aoEscolher,
  aoEscolherVarios,
  textoArquivo,
  textoBotao = "Escolher arquivo",
  textoSemArquivo = "Nenhum arquivo escolhido",
  desabilitado = false,
  dicaEscolher,
  id,
}: Props) {
  const idAutomatico = useId();
  const idCampo = id ?? idAutomatico;
  const idDica = `${idCampo}-dica`;
  const idErro = `${idCampo}-erro`;
  const idNome = `${idCampo}-nome`;
  const idDicaEscolher = `${idCampo}-dica-escolher`;
  // A dica do botão vai por último (fechada, o id não aponta para nada e fica de fora da descrição).
  const descritoPor = [
    dica && idDica,
    erro && idErro,
    idNome,
    dicaEscolher && idDicaEscolher,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="ui-campo ui-seletor-arquivo"
      data-invalido={erro ? "" : undefined}
    >
      <label className="ui-campo__rotulo" htmlFor={idCampo}>
        {rotulo}
      </label>
      {dica && (
        <p id={idDica} className="ui-campo__dica">
          {dica}
        </p>
      )}
      {erro && (
        <p id={idErro} className="ui-campo__erro">
          {erro}
        </p>
      )}
      <div className="ui-seletor-arquivo__linha">
        {/* O campo e o botão juntos: a dica abre com o mouse no botão e com o foco do teclado no campo. */}
        <ComDica id={idDicaEscolher} texto={dicaEscolher}>
          <span className="ui-seletor-arquivo__controle">
            <input
              id={idCampo}
              type="file"
              className="ui-seletor-arquivo__input"
              accept={aceitar}
              multiple={aoEscolherVarios ? true : undefined}
              disabled={desabilitado}
              aria-invalid={erro ? true : undefined}
              aria-describedby={descritoPor}
              onChange={(evento) => {
                const escolhidos = [...(evento.currentTarget.files ?? [])];
                evento.currentTarget.value = "";
                if (escolhidos.length === 0) return;
                if (aoEscolherVarios) aoEscolherVarios(escolhidos);
                else aoEscolher(escolhidos[0]);
              }}
            />
            <label
              htmlFor={idCampo}
              className={classesBotao(
                { variante: "secundario" },
                "ui-seletor-arquivo__botao",
              )}
            >
              {textoBotao}
            </label>
          </span>
        </ComDica>
        <span id={idNome} className="ui-seletor-arquivo__nome">
          {textoArquivo ?? (arquivo ? arquivo.name : textoSemArquivo)}
        </span>
      </div>
    </div>
  );
}
