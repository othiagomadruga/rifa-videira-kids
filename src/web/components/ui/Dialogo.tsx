import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import "./Dialogo.css";

type Props = {
  /** Aberto = na tela (num portal no fim do <body>); fechado = nada renderizado. */
  aberto: boolean;
  /** Título (<h2>); vira o nome do diálogo para leitores de tela. */
  titulo: ReactNode;
  /** Texto curto abaixo do título; vira a descrição do diálogo. */
  descricao?: ReactNode;
  /**
   * Pedido para fechar (Esc ou o botão ×). Quem usa decide: fecha mudando `aberto`, ou ignora
   * (ex.: enquanto salva). Clicar fora não fecha, para não perder o que foi digitado.
   */
  aoFechar: () => void;
  children?: ReactNode;
  /** Botões do rodapé (ex.: Cancelar e Salvar). O primeiro focável recebe o foco se o corpo não tiver nenhum. */
  rodape?: ReactNode;
  /**
   * Com `aoEnviar`, corpo e rodapé ficam num <form noValidate>: um Button type="submit" no rodapé envia
   * (e Enter num campo também). O envio padrão do navegador já vem cancelado.
   */
  aoEnviar?: (evento: FormEvent<HTMLFormElement>) => void;
  /** "alertdialog" para confirmações que pedem resposta (ex.: excluir). Padrão: "dialog". */
  papel?: "dialog" | "alertdialog";
  /** Recebe o foco ao abrir. Padrão: o primeiro focável do corpo, depois o do rodapé. */
  focoInicial?: RefObject<HTMLElement | null>;
  /** Recebe o foco ao fechar, se estiver na página. Padrão: o que estava focado antes de abrir. */
  focoAoFechar?: RefObject<HTMLElement | null>;
  /** Nome do botão × (padrão "Fechar"). */
  rotuloFechar?: string;
};

// Diálogo modal acessível: role="dialog" com aria-modal, nome (título) e descrição; o foco entra ao
// abrir, fica preso nele (Tab e Shift+Tab dão a volta), Esc pede para fechar e, ao fechar, o foco
// volta para quem abriu. O resto da página fica `inert` (nem foco, nem clique, nem leitor de tela) e
// sem rolagem enquanto ele está aberto.
export function Dialogo(props: Props) {
  return props.aberto ? <DialogoAberto {...props} /> : null;
}

function DialogoAberto({
  titulo,
  descricao,
  aoFechar,
  children,
  rodape,
  aoEnviar,
  papel = "dialog",
  focoInicial,
  focoAoFechar,
  rotuloFechar = "Fechar",
}: Props) {
  const idTitulo = useId();
  const idDescricao = useId();
  const refFundo = useRef<HTMLDivElement>(null);
  const refPainel = useRef<HTMLDivElement>(null);
  const refCorpo = useRef<HTMLDivElement>(null);
  const refRodape = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fundo = refFundo.current;
    const painel = refPainel.current;
    if (!fundo || !painel) return;
    const anterior =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const desfazerIsolamento = isolarDoResto(fundo);
    const inicial =
      focoInicial?.current ??
      focaveis(refCorpo.current)[0] ??
      focaveis(refRodape.current)[0] ??
      painel;
    inicial.focus();

    return () => {
      desfazerIsolamento();
      devolverFoco(focoAoFechar, anterior);
    };
  }, [focoInicial, focoAoFechar]);

  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>) {
    const painel = refPainel.current;
    // Teclas vindas de outro diálogo aberto por cima (portal filho na árvore do React) não são deste.
    if (
      !painel ||
      !(evento.target instanceof Node) ||
      !painel.contains(evento.target)
    ) {
      return;
    }
    if (evento.key === "Escape" && !evento.nativeEvent.isComposing) {
      evento.preventDefault();
      evento.stopPropagation();
      aoFechar();
    } else if (evento.key === "Tab") {
      prenderFoco(evento, painel);
    }
  }

  // Clique no véu (fora do painel) não tira o foco do diálogo.
  function aoPressionarFundo(evento: MouseEvent<HTMLDivElement>) {
    if (evento.target === evento.currentTarget) evento.preventDefault();
  }

  const conteudo = (
    <>
      <div ref={refCorpo} className="ui-dialogo__corpo">
        {children}
      </div>
      {rodape && (
        <div ref={refRodape} className="ui-dialogo__rodape">
          {rodape}
        </div>
      )}
    </>
  );

  return createPortal(
    <div ref={refFundo} className="ui-dialogo" onMouseDown={aoPressionarFundo}>
      <div
        ref={refPainel}
        className="ui-dialogo__painel"
        role={papel}
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={descricao ? idDescricao : undefined}
        tabIndex={-1}
        onKeyDown={aoTeclar}
      >
        <div className="ui-dialogo__cabecalho">
          <div className="ui-dialogo__textos">
            <h2 id={idTitulo} className="ui-dialogo__titulo">
              {titulo}
            </h2>
            {descricao && (
              <p id={idDescricao} className="ui-dialogo__descricao">
                {descricao}
              </p>
            )}
          </div>
          <button
            type="button"
            className="ui-dialogo__fechar"
            aria-label={rotuloFechar}
            onClick={aoFechar}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
        {aoEnviar ? (
          <form
            className="ui-dialogo__formulario"
            noValidate
            onSubmit={(evento) => {
              evento.preventDefault();
              aoEnviar(evento);
            }}
          >
            {conteudo}
          </form>
        ) : (
          conteudo
        )}
      </div>
    </div>,
    document.body,
  );
}

const SELETOR_FOCAVEL = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");

/** Elementos alcançáveis com Tab dentro de `raiz`, na ordem do documento. */
function focaveis(raiz: HTMLElement | null): HTMLElement[] {
  if (!raiz) return [];
  return Array.from(raiz.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)).filter(
    (elemento) =>
      elemento.tabIndex >= 0 && !elemento.closest("[hidden], [inert]"),
  );
}

/**
 * Ao fechar, vale o alvo de AGORA: quem usa pode apontar `focoAoFechar` para outro elemento logo antes de
 * fechar (ex.: depois de excluir, a linha que abriu o diálogo some). Sem alvo, volta para `anterior`.
 */
function devolverFoco(
  alvo: RefObject<HTMLElement | null> | undefined,
  anterior: HTMLElement | null,
) {
  const destino = alvo?.current ?? anterior;
  if (destino?.isConnected) destino.focus();
}

/** Tab no último focável volta ao primeiro; Shift+Tab no primeiro vai ao último. */
function prenderFoco(evento: KeyboardEvent, painel: HTMLElement) {
  const itens = focaveis(painel);
  const primeiro = itens[0];
  const ultimo = itens[itens.length - 1];
  if (!primeiro || !ultimo) {
    evento.preventDefault();
    painel.focus();
    return;
  }
  const atual = document.activeElement;
  if (evento.shiftKey && (atual === primeiro || atual === painel)) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && atual === ultimo) {
    evento.preventDefault();
    primeiro.focus();
  }
}

/**
 * Deixa `inert` tudo o que está no <body> fora do diálogo e trava a rolagem da página (compensando a
 * barra de rolagem, para nada pular). Devolve a função que desfaz só o que foi feito aqui, então
 * diálogos empilhados se desfazem na ordem certa.
 */
function isolarDoResto(fundo: HTMLElement): () => void {
  const inertes: Element[] = [];
  for (const elemento of Array.from(document.body.children)) {
    if (elemento !== fundo && !elemento.hasAttribute("inert")) {
      elemento.setAttribute("inert", "");
      inertes.push(elemento);
    }
  }
  const estilo = document.body.style;
  const { overflow, paddingRight } = estilo;
  const larguraJanela = document.documentElement.clientWidth;
  const larguraBarra =
    larguraJanela > 0 ? window.innerWidth - larguraJanela : 0;
  estilo.overflow = "hidden";
  if (larguraBarra > 0) estilo.paddingRight = `${larguraBarra}px`;

  return () => {
    for (const elemento of inertes) elemento.removeAttribute("inert");
    estilo.overflow = overflow;
    estilo.paddingRight = paddingRight;
  };
}
