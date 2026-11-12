// Ajudantes do botão indisponível (RIFA-045): o botão cuja dica explica por que ele está indisponível usa
// aria-disabled, e não disabled. O disabled sai do Tab (e um botão focado que vira disabled perde o foco, que cai no
// <body>, até de dentro de um diálogo), então pelo teclado a dica nunca abria. Com aria-disabled, o botão continua no
// Tab, a dica abre com o foco do teclado, a tela barra a ação no handler e o CSS da tela dá a cara de desabilitado.
import { act, fireEvent } from "@testing-library/react";
import { expect } from "vitest";
import { dicaDe } from "./dicas";

/**
 * O que o Tab percorre, na ordem do documento. O jsdom não anda com o Tab: segue a regra do navegador (tabindex 0 ou
 * mais, sem desabilitado, sem `hidden` nem `inert`, nada de dentro de um `<details>` fechado além do `<summary>`).
 */
export function ordemDoTab(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea, summary, [tabindex]",
    ),
  ].filter(
    (elemento) =>
      elemento.tabIndex >= 0 &&
      !elemento.matches(":disabled") &&
      !elemento.closest("[hidden], [inert]") &&
      !elemento.closest("details:not([open]) > :not(summary)"),
  );
}

/**
 * Tab (ou Shift+Tab, com `voltar`) como no navegador: a tecla vai para quem tem o foco e, se ninguém a cancelou (a
 * trava de foco de um diálogo cancela na ponta e leva o foco ela mesma), o foco vai ao próximo da ordem do Tab.
 * Devolve quem ficou com o foco.
 */
export function tab(voltar = false): HTMLElement {
  const atual =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : document.body;
  const seguiu = fireEvent.keyDown(atual, { key: "Tab", shiftKey: voltar });
  if (seguiu) {
    const ordem = ordemDoTab();
    const indice = ordem.indexOf(atual);
    const proximo =
      indice === -1
        ? voltar
          ? ordem.at(-1)
          : ordem[0]
        : ordem[indice + (voltar ? -1 : 1)];
    if (!proximo) throw new Error("o Tab saiu da página");
    act(() => proximo.focus());
  }
  return document.activeElement as HTMLElement;
}

/** Foca o que vem antes de `controle` na ordem do Tab e dá um Tab: o foco (do teclado) chega nele. */
export function chegarPeloTab(controle: HTMLElement) {
  const ordem = ordemDoTab();
  const indice = ordem.indexOf(controle);
  expect(indice, "o controle não está na ordem do Tab").toBeGreaterThanOrEqual(
    0,
  );
  const antes = ordem[indice - 1];
  if (antes) act(() => antes.focus());
  else act(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(tab()).toBe(controle);
}

/**
 * Enter ou espaço no botão focado, como o navegador faz (o jsdom não transforma tecla em clique): o Enter clica no
 * keydown; o espaço, no keyup. Se a tela cancelar a tecla, não há clique.
 */
export function ativarPeloTeclado(botao: HTMLElement, tecla: "Enter" | " ") {
  const code = tecla === "Enter" ? "Enter" : "Space";
  const desceu = fireEvent.keyDown(botao, { key: tecla, code });
  if (tecla === "Enter") {
    if (desceu) fireEvent.click(botao, { detail: 0 });
    return;
  }
  const subiu = fireEvent.keyUp(botao, { key: tecla, code });
  if (desceu && subiu) fireEvent.click(botao, { detail: 0 });
}

/** Indisponível do jeito certo: aria-disabled="true" e sem `disabled` (continua focável e com a dica). */
export function esperarIndisponivel(controle: HTMLElement) {
  expect(controle).toHaveAttribute("aria-disabled", "true");
  expect(controle).not.toBeDisabled();
}

/** Disponível: nem `disabled`, nem aria-disabled. */
export function esperarDisponivel(controle: HTMLElement) {
  expect(controle).toBeEnabled();
  expect(controle).not.toHaveAttribute("aria-disabled");
}

/** Deixa as promessas e os timers de 0 ms andarem (o que um clique dispararia chega à API falsa). Relógio de verdade. */
async function deixarAndar() {
  await act(() => new Promise<void>((resolver) => setTimeout(resolver, 0)));
}

type Conferencia = {
  /** O texto da dica (o motivo de estar indisponível). */
  dica: string;
  /** Confere que nada aconteceu (ex.: nenhuma chamada nova à API, o diálogo continua aberto). */
  semEfeito: () => void;
  /** As folhas de estilo da tela (`lerCss`), onde a cara de indisponível tem de estar. */
  css: string[];
};

/**
 * A correção dos indisponíveis (RIFA-045), num botão: recebe o foco pelo Tab, mostra a dica e não faz nada com o
 * clique, o Enter nem o espaço (`semEfeito` confere depois de cada tentativa; o foco fica no botão o tempo todo); e
 * tem a mesma cara do `disabled` (a opacidade e o cursor do :disabled do Button.css; o hover e o pressionar o Button.css
 * já pulam, `ui-css.test.ts`).
 */
export async function conferirIndisponivel(
  controle: HTMLElement,
  { dica, semEfeito, css }: Conferencia,
) {
  esperarIndisponivel(controle);
  expect(
    caraDeIndisponivel(controle, ...css),
    "sem a cara de indisponível no CSS da tela",
  ).toEqual(caraDoDesabilitado());
  chegarPeloTab(controle);
  expect(dicaDe(controle), "a dica não abriu pelo teclado").toHaveTextContent(
    dica,
  );
  const tentativas: [string, () => void][] = [
    ["clique", () => fireEvent.click(controle)],
    ["Enter", () => ativarPeloTeclado(controle, "Enter")],
    ["espaço", () => ativarPeloTeclado(controle, " ")],
  ];
  for (const [nome, tentar] of tentativas) {
    tentar();
    await deixarAndar();
    semEfeito();
    expect(controle, `o foco saiu do botão depois do ${nome}`).toHaveFocus();
    esperarIndisponivel(controle);
  }
}

// O Vitest esvazia todo import de CSS (até com ?raw): o texto vem do disco, pelo fs do Node.
type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};

/** O CSS de um arquivo de src/web (ex.: "components/ui/Button.css"), sem os comentários. */
export function lerCss(deSrcWeb: string): string {
  // O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
  const relativo = `../${deSrcWeb}`;
  return process
    .getBuiltinModule("node:fs")
    .readFileSync(
      decodeURIComponent(new URL(relativo, import.meta.url).pathname),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** A cara de indisponível: a opacidade e o cursor. */
export type Cara = { opacity: string; cursor: string };

/**
 * A cara de indisponível que o CSS dá a `elemento`: a opacidade e o cursor da primeira regra de `css` que casa com ele
 * e declara os dois (null se nenhuma). O jsdom não aplica o CSS: aqui, o seletor é conferido com `matches`.
 */
export function caraDeIndisponivel(
  elemento: Element,
  ...folhas: string[]
): Cara | null {
  for (const css of folhas) {
    for (const [, seletores, corpo] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const opacity = /(?:^|;)\s*opacity\s*:\s*([^;]+?)\s*(?:;|$)/.exec(corpo);
      const cursor = /(?:^|;)\s*cursor\s*:\s*([^;]+?)\s*(?:;|$)/.exec(corpo);
      if (!opacity || !cursor) continue;
      const casa = seletores
        .split(",")
        .map((seletor) => seletor.trim())
        .some((seletor) => casaCom(elemento, seletor));
      if (casa) return { opacity: opacity[1], cursor: cursor[1] };
    }
  }
  return null;
}

/** `matches` que diz não ao que não é seletor (ex.: o "from" de um @keyframes). */
function casaCom(elemento: Element, seletor: string): boolean {
  try {
    return elemento.matches(seletor);
  } catch {
    return false;
  }
}

/** A cara do botão `disabled` (Button.css), a mesma que o indisponível com aria-disabled tem de manter. */
export function caraDoDesabilitado(): Cara {
  const botao = document.createElement("button");
  botao.className = "ui-button";
  botao.disabled = true;
  const cara = caraDeIndisponivel(botao, lerCss("components/ui/Button.css"));
  if (!cara) throw new Error("o Button.css não tem mais a cara do :disabled");
  return cara;
}
