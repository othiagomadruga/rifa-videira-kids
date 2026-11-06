import { useId, type ComponentProps, type ReactNode } from "react";
import { juntarClasses } from "./classes";
import "./Campos.css";

// Campos de formulário com rótulo, dica e mensagem de erro ligados ao controle
// (label/htmlFor, aria-describedby e aria-invalid).

type PropsDoCampo = {
  rotulo: ReactNode;
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
  dica,
  erro,
  id,
  className,
  "aria-describedby": descritoPor,
  ...resto
}: InputProps) {
  const campo = useCampo(id, dica, erro, descritoPor);
  return (
    <Moldura rotulo={rotulo} dica={dica} erro={erro} {...campo}>
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
  dica,
  erro,
  id,
  className,
  "aria-describedby": descritoPor,
  ...resto
}: SelectProps) {
  const campo = useCampo(id, dica, erro, descritoPor);
  return (
    <Moldura rotulo={rotulo} dica={dica} erro={erro} {...campo}>
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
  dica,
  erro,
  id,
  className,
  "aria-describedby": descritoPor,
  ...resto
}: TextareaProps) {
  const campo = useCampo(id, dica, erro, descritoPor);
  return (
    <Moldura rotulo={rotulo} dica={dica} erro={erro} {...campo}>
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
): IdsDoCampo {
  const idAutomatico = useId();
  const idCampo = id ?? idAutomatico;
  const idDica = `${idCampo}-dica`;
  const idErro = `${idCampo}-erro`;
  const ids = [
    descritoPorExterno,
    dica ? idDica : undefined,
    erro ? idErro : undefined,
  ].filter(Boolean);
  const descritoPor = ids.length > 0 ? ids.join(" ") : undefined;
  return { idCampo, idDica, idErro, descritoPor };
}

type PropsMoldura = PropsDoCampo &
  Omit<IdsDoCampo, "descritoPor"> & { children: ReactNode };

function Moldura({
  rotulo,
  dica,
  erro,
  idCampo,
  idDica,
  idErro,
  children,
}: PropsMoldura) {
  return (
    <div className="ui-campo" data-invalido={erro ? "" : undefined}>
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
      {children}
    </div>
  );
}
