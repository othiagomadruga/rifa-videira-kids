import { useId, type ComponentProps, type ReactNode } from "react";
import {
  BotaoDeAjuda,
  temAjuda,
  useTextoDaAjuda,
  type TextoDeAjuda,
} from "./Ajuda";
import { juntarClasses } from "./classes";
import { ComDica } from "./Dica";
import "./Campos.css";

// Campos de formulário com rótulo, dica e mensagem de erro ligados ao controle
// (label/htmlFor, aria-describedby e aria-invalid). Com `ajuda` (RIFA-066), o campo inteiro é um grupo de ajuda: a
// explicação aparece com o mouse no rótulo ou no campo, no foco do teclado no campo (é a dica dele: não ponha
// ComDica em volta) e no toque do "?" ao lado do rótulo, apontando para o rótulo.

type PropsDoCampo = {
  rotulo: ReactNode;
  /**
   * A explicação do campo (RIFA-066): o que é, para que serve e um exemplo. Aparece com o mouse no rótulo ou no campo,
   * no foco do teclado e no toque do "?" ao lado do rótulo (veja Ajuda.tsx). É também a dica do campo: com `ajuda`,
   * o campo não leva ComDica em volta.
   */
  ajuda?: TextoDeAjuda;
  /** Texto de ajuda abaixo do rótulo. */
  dica?: ReactNode;
  /** Mensagem de erro; quando presente, o campo fica inválido. */
  erro?: ReactNode;
};

export type InputProps = ComponentProps<"input"> & PropsDoCampo;
export type SelectProps = ComponentProps<"select"> & PropsDoCampo;
export type TextareaProps = ComponentProps<"textarea"> & PropsDoCampo;

export function Input({
  rotulo,
  ajuda,
  dica,
  erro,
  id,
  className,
  "aria-describedby": descritoPor,
  ...resto
}: InputProps) {
  const campo = useCampo(id, dica, erro, descritoPor, ajuda);
  return (
    <Moldura rotulo={rotulo} ajuda={ajuda} dica={dica} erro={erro} {...campo}>
      <input
        id={campo.idCampo}
        className={juntarClasses("ui-campo__controle", className)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={campo.descritoPor}
        {...resto}
      />
    </Moldura>
  );
}

/** As opções vão como filhas: <Select rotulo="Célula"><option>...</option></Select>. */
export function Select({
  rotulo,
  ajuda,
  dica,
  erro,
  id,
  className,
  "aria-describedby": descritoPor,
  ...resto
}: SelectProps) {
  const campo = useCampo(id, dica, erro, descritoPor, ajuda);
  return (
    <Moldura rotulo={rotulo} ajuda={ajuda} dica={dica} erro={erro} {...campo}>
      <select
        id={campo.idCampo}
        className={juntarClasses(
          "ui-campo__controle ui-campo__controle--select",
          className,
        )}
        aria-invalid={erro ? true : undefined}
        aria-describedby={campo.descritoPor}
        {...resto}
      />
    </Moldura>
  );
}

export function Textarea({
  rotulo,
  ajuda,
  dica,
  erro,
  id,
  className,
  "aria-describedby": descritoPor,
  ...resto
}: TextareaProps) {
  const campo = useCampo(id, dica, erro, descritoPor, ajuda);
  return (
    <Moldura rotulo={rotulo} ajuda={ajuda} dica={dica} erro={erro} {...campo}>
      <textarea
        id={campo.idCampo}
        className={juntarClasses(
          "ui-campo__controle ui-campo__controle--textarea",
          className,
        )}
        aria-invalid={erro ? true : undefined}
        aria-describedby={campo.descritoPor}
        {...resto}
      />
    </Moldura>
  );
}

type IdsDoCampo = {
  idCampo: string;
  idDica: string;
  idErro: string;
  descritoPor: string | undefined;
};

function useCampo(
  id: string | undefined,
  dica: ReactNode,
  erro: ReactNode,
  descritoPorExterno: string | undefined,
  ajuda: TextoDeAjuda | undefined,
): IdsDoCampo {
  const idAutomatico = useId();
  const idCampo = id ?? idAutomatico;
  const idDica = `${idCampo}-dica`;
  const idErro = `${idCampo}-erro`;
  // A explicação (aberta) vai por último, como a dica dos controles; fechada, o id não aponta para nada.
  const ids = [
    descritoPorExterno,
    dica ? idDica : undefined,
    erro ? idErro : undefined,
    temAjuda(ajuda) ? `${idCampo}-ajuda` : undefined,
  ].filter(Boolean);
  const descritoPor = ids.length > 0 ? ids.join(" ") : undefined;
  return { idCampo, idDica, idErro, descritoPor };
}

type PropsMoldura = PropsDoCampo &
  Omit<IdsDoCampo, "descritoPor"> & { children: ReactNode };

function Moldura({
  rotulo,
  ajuda,
  dica,
  erro,
  idCampo,
  idDica,
  idErro,
  children,
}: PropsMoldura) {
  const lido = useTextoDaAjuda(ajuda);
  const comAjuda = temAjuda(ajuda);
  const idAjuda = `${idCampo}-ajuda`;
  const rotuloDoCampo = (
    <label
      id={`${idCampo}-rotulo`}
      className="ui-campo__rotulo"
      htmlFor={idCampo}
    >
      {rotulo}
    </label>
  );
  const campo = (
    <div
      className="ui-campo"
      data-invalido={erro ? "" : undefined}
      data-ajuda={comAjuda ? idAjuda : undefined}
    >
      {comAjuda ? (
        // A âncora da explicação: ela aponta para o rótulo (e, sem lugar acima, vai para baixo do campo inteiro).
        <div className="ui-ajuda" data-ajuda-ancora="">
          {rotuloDoCampo}
          <BotaoDeAjuda id={idAjuda} idDoTitulo={`${idCampo}-rotulo`} />
        </div>
      ) : (
        rotuloDoCampo
      )}
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
      {children}
    </div>
  );
  return comAjuda ? (
    <ComDica texto={lido} id={idAjuda} fixarNoBotao>
      {campo}
    </ComDica>
  ) : (
    campo
  );
}
