import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./Dica.css";

// Dica (tooltip, RIFA-045): uma explicação curta do que o controle faz e do que acontece ao usar, que aparece com o
// mouse parado em cima dele ou com o foco do teclado. Uso: <ComDica texto="...">{<Button>...</Button>}</ComDica>,
// em volta de qualquer botão, campo ou link (o envoltório põe os eventos e o `aria-describedby` no filho).
//
// - Aparece com o mouse parado por ATRASO_DA_DICA_MS e, na hora, com o foco que veio do teclado (Tab, setas, Home e
//   End); o foco de um clique ou de um toque não abre. No toque (celular), nada muda: o toque segue para o controle.
// - WCAG 1.4.13: dispensável (Esc fecha, sem mover o mouse nem o foco; esse Esc não chega ao diálogo nem ao menu,
//   que fecham no Esc seguinte), dá para passar o mouse por cima dela (há uma folga para ir do controle até ela) e
//   persistente (só some ao tirar o mouse, ao perder o foco, com Esc ou ao clicar no controle).
// - Acessível: role="tooltip" e, aberta, o id dela entra no `aria-describedby` do controle, depois da descrição que
//   ele já tinha (nos campos, o Campos põe a dica visível e o erro depois). Controles com `aria-disabled` continuam
//   com a dica (ela pode dizer por que estão indisponíveis).
// - Fica num portal no fim do <body>, acima do controle (ou abaixo, se não couber), sempre dentro da tela: nunca cria
//   rolagem lateral. A posição vem do JS pelo CSSOM (o CSP proíbe style="..." no HTML, não o CSSOM).
// - Uma dica por vez (RIFA-047): a que abre fecha a que estava aberta (ex.: a do foco do teclado, quando o mouse para
//   em outro controle). Sem isso, as duas ficavam na tela, uma por cima da outra.
// - Com `fixarNoBotao` (a ajuda dos títulos e rótulos, RIFA-066, `Ajuda.tsx`): o clique ou o toque no botão de ajuda
//   (`[data-ajuda-botao]`, dentro do filho) abre na hora e deixa a dica fixa (o mouse saindo não fecha); outro clique
//   nele, um toque fora, Esc ou o foco saindo fecham. É o jeito de abrir no celular, que não tem mouse.

/** Tempo com o mouse parado em cima do controle até a dica aparecer. */
export const ATRASO_DA_DICA_MS = 600;
/** Tempo para levar o mouse do controle até a dica (e de volta) sem ela sumir. */
export const FOLGA_DA_DICA_MS = 200;
/** Distância entre o controle e a dica, em px. */
const AFASTAMENTO_PX = 8;
/** Distância mínima entre a dica e a borda da tela, em px. */
const MARGEM_DA_TELA_PX = 8;
/** Um foco até este tempo depois de uma tecla de navegação veio do teclado. */
const JANELA_DO_TECLADO_MS = 1000;

const TECLAS_DE_NAVEGACAO = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** Só modificadoras: não mudam a marca (o Shift do Shift+Tab vem antes do Tab). */
const TECLAS_MODIFICADORAS = new Set(["Shift", "Control", "Alt", "Meta"]);

// De onde veio o último foco: guardado no módulo, uma escuta só para todas as dicas (na captura, antes de qualquer
// tela parar a propagação). Outra tecla (Esc, Enter...) e um ponteiro (mouse, toque, caneta) apagam a marca: o foco
// que um diálogo ou o menu devolve depois do Esc, ou que vai para dentro de um diálogo aberto com Enter, não abre.
let navegouPeloTecladoEm = Number.NEGATIVE_INFINITY;
let escutandoOTeclado = false;

function escutarOTeclado() {
  if (escutandoOTeclado) return;
  escutandoOTeclado = true;
  document.addEventListener(
    "keydown",
    (evento) => {
      if (TECLAS_MODIFICADORAS.has(evento.key)) return;
      navegouPeloTecladoEm = TECLAS_DE_NAVEGACAO.has(evento.key)
        ? performance.now()
        : Number.NEGATIVE_INFINITY;
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      navegouPeloTecladoEm = Number.NEGATIVE_INFINITY;
    },
    true,
  );
}

// A dica aberta agora (uma por vez): a que abre fecha esta antes, ainda antes de pintar.
let dicaAberta: { fechar: () => void } | null = null;

function focoVeioDoTeclado(): boolean {
  return performance.now() - navegouPeloTecladoEm <= JANELA_DO_TECLADO_MS;
}

/** Esquece a última tecla de navegação (o `afterEach` dos testes chama: cada teste começa do zero). */
export function esquecerTecladoDaDica() {
  navegouPeloTecladoEm = Number.NEGATIVE_INFINITY;
}

/** Junta ids de `aria-describedby`, sem os vazios; undefined se não sobrar nenhum. */
export function juntarIds(...ids: (string | false | null | undefined)[]) {
  const juntos = ids
    .flatMap((id) => (id ? id.split(/\s+/) : []))
    .filter(Boolean)
    .join(" ");
  return juntos || undefined;
}

type ManipuladorPonteiro = (evento: PointerEvent<HTMLElement>) => void;
type ManipuladorFoco = (evento: FocusEvent<HTMLElement>) => void;

/** O que o envoltório lê e troca no filho. */
type PropsDoAlvo = {
  "aria-describedby"?: string;
  onClick?: (evento: MouseEvent<HTMLElement>) => void;
  onPointerEnter?: ManipuladorPonteiro;
  onPointerMove?: ManipuladorPonteiro;
  onPointerLeave?: ManipuladorPonteiro;
  onPointerDown?: ManipuladorPonteiro;
  onFocus?: ManipuladorFoco;
  onBlur?: ManipuladorFoco;
};

type Props = {
  /**
   * Para que serve o controle e o que acontece ao usar, em 1 ou 2 frases curtas (sem repetir o rótulo). Vazio: o
   * filho fica como está, sem dica.
   */
  texto?: ReactNode;
  /** Um elemento só: botão, campo, link (Button, Input, Select, Textarea, Link, <button>, <input>...). */
  children: ReactElement<PropsDoAlvo>;
  /**
   * Id da dica, para quando o filho não é o próprio controle: o `<label>` que envolve uma caixa de marcar (o mouse
   * no texto também abre a dica). Aí o envoltório não mexe no `aria-describedby` do filho, e quem usa põe este id
   * no `aria-describedby` do controle (com a dica fechada, o id não aponta para nada e fica de fora da descrição).
   */
  id?: string;
  /** O clique ou o toque num `[data-ajuda-botao]` dentro do filho abre e fixa a dica (RIFA-066; veja o topo). */
  fixarNoBotao?: boolean;
};

/** Põe uma dica (tooltip) no controle filho. Veja o comentário do topo deste arquivo. */
export function ComDica({ texto, children, id, fixarNoBotao }: Props) {
  if (texto === undefined || texto === null || texto === "" || texto === false)
    return children;
  return (
    <DicaAtiva texto={texto} id={id} fixarNoBotao={fixarNoBotao}>
      {children}
    </DicaAtiva>
  );
}

/** O alvo do evento é o botão de ajuda (ou está dentro dele). */
function ehBotaoDeAjuda(alvo: EventTarget | null) {
  return alvo instanceof Element && alvo.closest("[data-ajuda-botao]") !== null;
}

type Pendencias = {
  mouse: boolean;
  foco: boolean;
  sobreADica: boolean;
  /** Aberta pelo clique ou pelo toque no botão de ajuda: só fecha com outro clique, toque fora, Esc ou o foco saindo. */
  fixada: boolean;
  abrir: ReturnType<typeof setTimeout> | undefined;
  fechar: ReturnType<typeof setTimeout> | undefined;
};

function DicaAtiva({
  texto,
  children,
  id: idDeFora,
  fixarNoBotao,
}: {
  texto: ReactNode;
  children: ReactElement<PropsDoAlvo>;
  id: string | undefined;
  fixarNoBotao: boolean | undefined;
}) {
  const idAutomatico = useId();
  const id = idDeFora ?? idAutomatico;
  const [aberta, setAberta] = useState(false);
  const refAlvo = useRef<HTMLElement | null>(null);
  const refDica = useRef<HTMLDivElement>(null);
  // Quem segura a dica aberta e os tempos pendentes (mudam nos eventos, sem renderizar de novo).
  const refPendencias = useRef<Pendencias>({
    mouse: false,
    foco: false,
    sobreADica: false,
    fixada: false,
    abrir: undefined,
    fechar: undefined,
  });

  useEffect(() => {
    escutarOTeclado();
    const pendencias = refPendencias.current;
    return () => {
      clearTimeout(pendencias.abrir);
      clearTimeout(pendencias.fechar);
    };
  }, []);

  // Esc fecha. A dica aberta é a camada de cima: este Esc (na captura, no document) só fecha a dica e não segue para
  // o diálogo nem para o menu, que fecham no Esc seguinte. Sem isso, o Esc para tirar a dica da frente fechava o
  // diálogo junto (perdendo o que foi digitado) e o foco saía do controle (WCAG 1.4.13: dispensável sem mover o foco).
  useEffect(() => {
    if (!aberta) return;
    const pendencias = refPendencias.current;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape" || evento.isComposing) return;
      evento.stopPropagation();
      clearTimeout(pendencias.abrir);
      clearTimeout(pendencias.fechar);
      pendencias.abrir = undefined;
      pendencias.fechar = undefined;
      pendencias.fixada = false;
      setAberta(false);
    };
    // Fixada (pelo toque no botão de ajuda): um toque ou clique fora dela e fora do alvo fecha (no iPhone, o toque não
    // tira o foco do botão, então o desfocar não basta).
    const aoTocarFora = (evento: globalThis.PointerEvent) => {
      const alvo = evento.target;
      if (
        !pendencias.fixada ||
        !(alvo instanceof Node) ||
        refAlvo.current?.contains(alvo) ||
        refDica.current?.contains(alvo)
      )
        return;
      pendencias.fixada = false;
      setAberta(false);
    };
    document.addEventListener("keydown", aoTeclar, true);
    document.addEventListener("pointerdown", aoTocarFora, true);
    return () => {
      document.removeEventListener("keydown", aoTeclar, true);
      document.removeEventListener("pointerdown", aoTocarFora, true);
    };
  }, [aberta]);

  // Uma dica por vez: ao abrir, fecha a que estava aberta (antes de pintar: as duas nunca aparecem juntas). A outra
  // esquece os tempos pendentes; o foco ou o mouse que a seguravam só a abrem de novo ao voltar (sair e entrar).
  useLayoutEffect(() => {
    if (!aberta) return;
    const pendencias = refPendencias.current;
    const esta = {
      fechar: () => {
        clearTimeout(pendencias.abrir);
        clearTimeout(pendencias.fechar);
        pendencias.abrir = undefined;
        pendencias.fechar = undefined;
        pendencias.fixada = false;
        setAberta(false);
      },
    };
    dicaAberta?.fechar();
    dicaAberta = esta;
    return () => {
      if (dicaAberta === esta) dicaAberta = null;
    };
  }, [aberta]);

  // Aberta: posiciona antes de pintar (a cada renderização: o texto pode mudar) e acompanha rolagem e tamanho da tela.
  useLayoutEffect(() => {
    const alvo = refAlvo.current;
    const dica = refDica.current;
    if (aberta && alvo && dica) posicionar(alvo, dica);
  });
  useEffect(() => {
    if (!aberta) return;
    const reposicionar = () => {
      const alvo = refAlvo.current;
      const dica = refDica.current;
      if (alvo && dica) posicionar(alvo, dica);
    };
    window.addEventListener("scroll", reposicionar, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", reposicionar);
    return () => {
      window.removeEventListener("scroll", reposicionar, { capture: true });
      window.removeEventListener("resize", reposicionar);
    };
  }, [aberta]);

  function cancelar(qual: "abrir" | "fechar") {
    const pendencias = refPendencias.current;
    clearTimeout(pendencias[qual]);
    pendencias[qual] = undefined;
  }

  function agendarAbertura() {
    const pendencias = refPendencias.current;
    cancelar("abrir");
    pendencias.abrir = setTimeout(() => {
      pendencias.abrir = undefined;
      setAberta(true);
    }, ATRASO_DA_DICA_MS);
  }

  function agendarFechamento() {
    const pendencias = refPendencias.current;
    cancelar("fechar");
    pendencias.fechar = setTimeout(() => {
      pendencias.fechar = undefined;
      if (
        !pendencias.mouse &&
        !pendencias.foco &&
        !pendencias.sobreADica &&
        !pendencias.fixada
      )
        setAberta(false);
    }, FOLGA_DA_DICA_MS);
  }

  function fecharJa() {
    cancelar("abrir");
    cancelar("fechar");
    refPendencias.current.fixada = false;
    setAberta(false);
  }

  const doFilho = children.props;

  function aoEntrar(evento: PointerEvent<HTMLElement>) {
    doFilho.onPointerEnter?.(evento);
    if (evento.pointerType === "touch") return;
    refAlvo.current = evento.currentTarget;
    refPendencias.current.mouse = true;
    cancelar("fechar");
    if (!aberta) agendarAbertura();
  }

  // "Mouse parado": enquanto espera, mexer o mouse recomeça a contagem.
  function aoMover(evento: PointerEvent<HTMLElement>) {
    doFilho.onPointerMove?.(evento);
    if (evento.pointerType === "touch") return;
    if (refPendencias.current.abrir !== undefined) agendarAbertura();
  }

  function aoSair(evento: PointerEvent<HTMLElement>) {
    doFilho.onPointerLeave?.(evento);
    if (evento.pointerType === "touch") return;
    refPendencias.current.mouse = false;
    cancelar("abrir");
    agendarFechamento();
  }

  // Clicou (ou tocou): a dica sai da frente do que vem depois e só volta com o mouse entrando de novo. No botão de
  // ajuda, quem decide é o clique (abre e fixa, ou fecha a fixada).
  function aoPressionar(evento: PointerEvent<HTMLElement>) {
    doFilho.onPointerDown?.(evento);
    if (fixarNoBotao && ehBotaoDeAjuda(evento.target)) return;
    fecharJa();
  }

  function aoClicar(evento: MouseEvent<HTMLElement>) {
    doFilho.onClick?.(evento);
    if (!fixarNoBotao || !ehBotaoDeAjuda(evento.target)) return;
    const pendencias = refPendencias.current;
    if (pendencias.fixada) {
      fecharJa();
      return;
    }
    refAlvo.current = evento.currentTarget;
    pendencias.fixada = true;
    cancelar("abrir");
    cancelar("fechar");
    setAberta(true);
  }

  function aoFocar(evento: FocusEvent<HTMLElement>) {
    doFilho.onFocus?.(evento);
    if (!focoVeioDoTeclado()) return;
    refAlvo.current = evento.currentTarget;
    refPendencias.current.foco = true;
    cancelar("abrir");
    cancelar("fechar");
    setAberta(true);
  }

  function aoDesfocar(evento: FocusEvent<HTMLElement>) {
    doFilho.onBlur?.(evento);
    const pendencias = refPendencias.current;
    pendencias.foco = false;
    if (!pendencias.mouse && !pendencias.sobreADica) fecharJa();
  }

  // O filho de novo, com as mesmas props e as da dica (o mesmo que um cloneElement, em JSX: os manipuladores leem
  // refs, e o React só os chama nos eventos). O `ref` do filho vai junto nas props (React 19).
  const Filho = children.type;
  return (
    <>
      <Filho
        {...doFilho}
        aria-describedby={
          idDeFora === undefined
            ? juntarIds(doFilho["aria-describedby"], aberta && id)
            : doFilho["aria-describedby"]
        }
        onPointerEnter={aoEntrar}
        onPointerMove={aoMover}
        onPointerLeave={aoSair}
        onPointerDown={aoPressionar}
        onClick={fixarNoBotao ? aoClicar : doFilho.onClick}
        onFocus={aoFocar}
        onBlur={aoDesfocar}
      />
      {aberta &&
        createPortal(
          <div
            ref={refDica}
            id={id}
            role="tooltip"
            className="ui-dica"
            onPointerEnter={() => {
              refPendencias.current.sobreADica = true;
              cancelar("fechar");
            }}
            onPointerLeave={() => {
              refPendencias.current.sobreADica = false;
              agendarFechamento();
            }}
          >
            {texto}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Põe a dica acima do controle (ou abaixo, se acima não couber e abaixo couber), centrada nele e presa dentro da
 * tela, com a seta apontando para o meio do controle.
 */
function posicionar(alvo: HTMLElement, dica: HTMLElement) {
  // Num campo com ajuda (RIFA-066), a dica aponta para o rótulo (a âncora) e, sem lugar acima, fica abaixo do campo
  // inteiro: não cobre o que se digita.
  const controle = (
    alvo.querySelector("[data-ajuda-ancora]") ?? alvo
  ).getBoundingClientRect();
  const base = alvo.getBoundingClientRect().bottom;
  const { width: largura, height: altura } = dica.getBoundingClientRect();
  const larguraTela = document.documentElement.clientWidth || window.innerWidth;
  const alturaTela =
    document.documentElement.clientHeight || window.innerHeight;

  const topoAcima = controle.top - AFASTAMENTO_PX - altura;
  const topoAbaixo = base + AFASTAMENTO_PX;
  const cabeAcima = topoAcima >= MARGEM_DA_TELA_PX;
  const cabeAbaixo = topoAbaixo + altura <= alturaTela - MARGEM_DA_TELA_PX;
  // Sem lugar inteiro nos dois lados (tela baixa): o lado com mais espaço, preso dentro da tela.
  const lado = cabeAcima
    ? "acima"
    : cabeAbaixo
      ? "abaixo"
      : controle.top >= alturaTela - base
        ? "acima"
        : "abaixo";
  const topo = Math.max(
    MARGEM_DA_TELA_PX,
    Math.min(
      lado === "acima" ? topoAcima : topoAbaixo,
      alturaTela - MARGEM_DA_TELA_PX - altura,
    ),
  );

  const meio = controle.left + controle.width / 2;
  const maximo = Math.max(
    MARGEM_DA_TELA_PX,
    larguraTela - MARGEM_DA_TELA_PX - largura,
  );
  const esquerda = Math.min(
    Math.max(meio - largura / 2, MARGEM_DA_TELA_PX),
    maximo,
  );
  const seta = Math.min(Math.max(meio - esquerda, 12), largura - 12);

  dica.style.top = `${Math.round(topo)}px`;
  dica.style.left = `${Math.round(esquerda)}px`;
  dica.style.setProperty("--dica-seta", `${Math.round(seta)}px`);
  dica.dataset.lado = lado;
}
