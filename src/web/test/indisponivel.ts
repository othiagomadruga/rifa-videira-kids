// Ajudantes do botão indisponível (RIFA-045): o botão cuja dica explica por que ele está indisponível usa
// aria-disabled, e não disabled. O disabled sai do Tab (e um botão focado que vira disabled perde o foco, que cai no
// <body>, até de dentro de um diálogo), então pelo teclado a dica nunca abria. Com aria-disabled, o botão continua no
// Tab, a dica abre com o foco do teclado, a tela barra a ação no handler e o Button.css dá a cara de desabilitado (a
// regra .ui-button[aria-disabled="true"], RIFA-047; a tela não a repete).
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
  /**
   * As folhas de estilo que valem no botão (`lerCss`), na ordem em que a página as carrega: o Button.css (onde está a
   * cara de indisponível) e o CSS da tela (que não pode desfazê-la).
   */
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
    "sem a cara de indisponível no CSS (ou a tela a desfaz)",
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
 * A cara de indisponível que o CSS dá a `elemento`: a opacidade e o cursor que valem nele pela cascata, entre as regras
 * das `folhas` (na ordem em que a página as carrega) cujo seletor casa com ele. Cada propriedade fica com a regra de
 * seletor mais específico e, no empate, com a que vem depois; null se faltar uma das duas (ex.: o botão disponível só
 * tem o `cursor: pointer` do .ui-button). Assim, a regra geral do Button.css (RIFA-047) vale, e a tela que a
 * sobrepõe (ex.: o cursor de espera de um "Carregando…") também aparece aqui. O jsdom não aplica o CSS: o seletor é
 * conferido com `matches`, e o que está dentro de um @media conta como se valesse sempre.
 */
export function caraDeIndisponivel(
  elemento: Element,
  ...folhas: string[]
): Cara | null {
  const vencedoras: Partial<Record<keyof Cara, Declarada>> = {};
  for (const css of folhas) {
    for (const [, seletores, corpo] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const casam = separarSeletores(seletores).filter((seletor) =>
        casaCom(elemento, seletor),
      );
      if (casam.length === 0) continue;
      const peso = casam
        .map(especificidade)
        .reduce((maior, atual) =>
          compararEspecificidade(atual, maior) > 0 ? atual : maior,
        );
      for (const propriedade of ["opacity", "cursor"] as const) {
        const valor = new RegExp(
          `(?:^|;)\\s*${propriedade}\\s*:\\s*([^;]+?)\\s*(?:;|$)`,
        ).exec(corpo)?.[1];
        const atual = vencedoras[propriedade];
        // Mesma especificidade: a que vem depois vence (o laço anda na ordem das folhas e das regras).
        if (
          valor !== undefined &&
          (!atual || compararEspecificidade(peso, atual.peso) >= 0)
        )
          vencedoras[propriedade] = { valor, peso };
      }
    }
  }
  const { opacity, cursor } = vencedoras;
  return opacity && cursor
    ? { opacity: opacity.valor, cursor: cursor.valor }
    : null;
}

/** Uma declaração que venceu até aqui: o valor e a especificidade do seletor que a trouxe. */
type Declarada = { valor: string; peso: Especificidade };

/** Especificidade de um seletor: [ids, classes + atributos + pseudo-classes, tipos + pseudo-elementos]. */
export type Especificidade = [number, number, number];

function compararEspecificidade(a: Especificidade, b: Especificidade): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** A lista de seletores ("a, b:not(c, d)") separada nas vírgulas de fora dos parênteses. */
function separarSeletores(lista: string): string[] {
  const partes: string[] = [];
  let profundidade = 0;
  let atual = "";
  for (const caractere of lista) {
    if (caractere === "(") profundidade += 1;
    if (caractere === ")") profundidade -= 1;
    if (caractere === "," && profundidade === 0) {
      partes.push(atual);
      atual = "";
    } else atual += caractere;
  }
  partes.push(atual);
  return partes.map((parte) => parte.trim()).filter(Boolean);
}

/** Onde termina o nome que começa em `inicio` (letras, números, - e _). */
function fimDoNome(seletor: string, inicio: number): number {
  let fim = inicio;
  while (fim < seletor.length && /[\w-]/.test(seletor[fim])) fim += 1;
  return fim;
}

/** O índice do ")" que fecha o "(" em `abre`. */
function fechamento(seletor: string, abre: number): number {
  let profundidade = 0;
  for (let indice = abre; indice < seletor.length; indice += 1) {
    if (seletor[indice] === "(") profundidade += 1;
    if (seletor[indice] === ")" && --profundidade === 0) return indice;
  }
  return seletor.length;
}

/**
 * A especificidade de um seletor (Selectors 4): :not(), :is() e :has() valem pelo argumento mais específico; :where(),
 * nada. Basta para o CSS do site (sem escapes nem "]" dentro de atributo).
 */
export function especificidade(seletor: string): Especificidade {
  const peso: Especificidade = [0, 0, 0];
  let indice = 0;
  while (indice < seletor.length) {
    const caractere = seletor[indice];
    if (caractere === "#" || caractere === ".") {
      peso[caractere === "#" ? 0 : 1] += 1;
      indice = fimDoNome(seletor, indice + 1);
    } else if (caractere === "[") {
      peso[1] += 1;
      indice = seletor.indexOf("]", indice) + 1 || seletor.length;
    } else if (caractere === ":" && seletor[indice + 1] === ":") {
      peso[2] += 1;
      indice = fimDoNome(seletor, indice + 2);
    } else if (caractere === ":") {
      const fimNome = fimDoNome(seletor, indice + 1);
      const nome = seletor.slice(indice + 1, fimNome);
      indice = fimNome;
      if (seletor[fimNome] === "(") {
        const fim = fechamento(seletor, fimNome);
        if (["not", "is", "has"].includes(nome)) {
          const maior = separarSeletores(seletor.slice(fimNome + 1, fim))
            .map(especificidade)
            .reduce<Especificidade>(
              (anterior, atual) =>
                compararEspecificidade(atual, anterior) > 0 ? atual : anterior,
              [0, 0, 0],
            );
          peso[0] += maior[0];
          peso[1] += maior[1];
          peso[2] += maior[2];
        } else if (nome !== "where") peso[1] += 1;
        indice = fim + 1;
      } else peso[1] += 1;
    } else if (/[a-z]/i.test(caractere)) {
      // Um nome solto (no começo ou depois de um combinador) é um tipo: button, input...
      peso[2] += 1;
      indice = fimDoNome(seletor, indice);
    } else indice += 1;
  }
  return peso;
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
