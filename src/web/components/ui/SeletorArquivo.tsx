import { useId, type ReactNode } from "react";
import { classesBotao } from "./Button";
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
  textoBotao?: string;
  textoSemArquivo?: string;
  desabilitado?: boolean;
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
  textoBotao = "Escolher arquivo",
  textoSemArquivo = "Nenhum arquivo escolhido",
  desabilitado = false,
  id,
}: Props) {
  const idAutomatico = useId();
  const idCampo = id ?? idAutomatico;
  const idDica = `${idCampo}-dica`;
  const idErro = `${idCampo}-erro`;
  const idNome = `${idCampo}-nome`;
  const descritoPor = [dica && idDica, erro && idErro, idNome]
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
        <input
          id={idCampo}
          type="file"
          className="ui-seletor-arquivo__input"
          accept={aceitar}
          disabled={desabilitado}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descritoPor}
          onChange={(evento) => {
            const escolhido = evento.currentTarget.files?.[0];
            evento.currentTarget.value = "";
            if (escolhido) aoEscolher(escolhido);
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
        <span id={idNome} className="ui-seletor-arquivo__nome">
          {arquivo ? arquivo.name : textoSemArquivo}
        </span>
      </div>
    </div>
  );
}
