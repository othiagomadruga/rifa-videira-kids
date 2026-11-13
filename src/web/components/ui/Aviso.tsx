import type { ReactNode } from "react";
import { juntarClasses } from "./classes";
import { ComDica } from "./Dica";
import { Icone } from "./Icone";
import type { NomeIcone } from "./icones";
import "./Aviso.css";

export type TomAviso = "info" | "sucesso" | "alerta" | "perigo";
export type AnuncioAviso = "alerta" | "status" | "nenhum";

type Props = {
  tom?: TomAviso;
  /** Primeira linha, em destaque. Precisa fazer sentido sem a cor (ex.: "Planilha com erros"). */
  titulo?: ReactNode;
  children?: ReactNode;
  /**
   * Como o leitor de tela anuncia: "alerta" (role="alert", interrompe), "status" (role="status",
   * espera a vez) ou "nenhum". Padrão: "alerta" nos tons alerta e perigo, "status" em info e sucesso.
   * Um role="status" que já entra com o texto pode não ser lido: para anunciar com certeza, mantenha
   * uma região viva fixa na tela e use "nenhum" aqui.
   */
  anuncio?: AnuncioAviso;
  /** Botão ou link para o próximo passo, abaixo do texto. */
  acao?: ReactNode;
  /** Mostra o botão × para fechar o aviso. */
  aoFechar?: () => void;
  rotuloFechar?: string;
  /** Dica do botão × (RIFA-045). */
  dicaFechar?: ReactNode;
  id?: string;
  className?: string;
};

const ANUNCIO_PADRAO: Record<TomAviso, AnuncioAviso> = {
  info: "status",
  sucesso: "status",
  alerta: "alerta",
  perigo: "alerta",
};

const PAPEL: Record<AnuncioAviso, "alert" | "status" | undefined> = {
  alerta: "alert",
  status: "status",
  nenhum: undefined,
};

const ICONE: Record<TomAviso, NomeIcone> = {
  info: "info",
  sucesso: "check",
  alerta: "alerta",
  perigo: "alerta",
};

// Mensagem na própria tela (não flutua nem some sozinha): resultado de uma ação, aviso ou erro.
export function Aviso({
  tom = "info",
  titulo,
  children,
  anuncio = ANUNCIO_PADRAO[tom],
  acao,
  aoFechar,
  rotuloFechar = "Fechar aviso",
  dicaFechar = "Tira este aviso da tela. Ele não volta sozinho.",
  id,
  className,
}: Props) {
  return (
    <div
      id={id}
      role={PAPEL[anuncio]}
      className={juntarClasses("ui-aviso", `ui-aviso--${tom}`, className)}
    >
      <span className="ui-aviso__icone" aria-hidden="true">
        <Icone nome={ICONE[tom]} />
      </span>
      <div className="ui-aviso__textos">
        {titulo && <p className="ui-aviso__titulo">{titulo}</p>}
        {children && <div className="ui-aviso__conteudo">{children}</div>}
        {acao && <div className="ui-aviso__acao">{acao}</div>}
      </div>
      {aoFechar && (
        <ComDica texto={dicaFechar}>
          <button
            type="button"
            className="ui-aviso__fechar"
            aria-label={rotuloFechar}
            onClick={aoFechar}
          >
            <Icone nome="fechar" tamanho="1rem" />
          </button>
        </ComDica>
      )}
    </div>
  );
}
