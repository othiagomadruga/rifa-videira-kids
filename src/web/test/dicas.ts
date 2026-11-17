// Ajudantes de teste das dicas (RIFA-045): abrir e fechar uma dica pelo mouse e pelo teclado, e a varredura que
// passa o mouse em cada botão e campo de uma tela e diz quais ficaram sem dica (a fase 2 reaproveita nas telas dela).
import { act, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import {
  ATRASO_DA_DICA_MS,
  CARREGANDO_A_AJUDA,
  FOLGA_DA_DICA_MS,
  ajudasCarregadas,
} from "../components/ui";

/** O que precisa de dica: botões, campos, abas, links com cara de botão, os links do menu e o "abrir" de um <details>. */
export const SELETOR_COM_DICA = [
  "button",
  "summary",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "a.ui-button",
  "[role='tab']",
  "nav a",
].join(", ");

/** A dica ligada ao controle pelo `aria-describedby` (role="tooltip"), ou null. */
export function dicaDe(controle: Element): HTMLElement | null {
  const ids = (controle.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  for (const id of ids) {
    const elemento = document.getElementById(id);
    if (elemento?.getAttribute("role") === "tooltip") return elemento;
  }
  return null;
}

/** Mouse entra no controle (sem esperar o tempo da dica). */
export function passarOMouse(controle: Element) {
  fireEvent.pointerEnter(controle, { pointerType: "mouse" });
}

/** Mouse sai do controle (sem esperar a folga). */
export function tirarOMouse(controle: Element) {
  fireEvent.pointerLeave(controle, { pointerType: "mouse" });
}

/** Foco que veio do teclado (como o Tab): a tecla de navegação e o foco logo depois. */
export function focarPeloTeclado(controle: HTMLElement) {
  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => controle.focus());
}

/** Visível para a varredura: fora de painel oculto (`hidden`) e fora do que um diálogo deixou `inert`. */
function participa(controle: HTMLElement): boolean {
  return !controle.closest("[hidden], [inert]");
}

/** Um nome legível do controle para a mensagem de falha. */
function nomeDoControle(controle: HTMLElement): string {
  const rotulo =
    controle.getAttribute("aria-label") ??
    (controle instanceof HTMLInputElement ||
    controle instanceof HTMLSelectElement ||
    controle instanceof HTMLTextAreaElement
      ? controle.labels?.[0]?.textContent
      : null) ??
    controle.textContent;
  const papel =
    controle.getAttribute("role") ??
    (controle instanceof HTMLInputElement
      ? `input ${controle.type}`
      : controle.tagName.toLowerCase());
  return `${papel} "${(rotulo ?? "").replace(/\s+/g, " ").trim()}"`;
}

/**
 * Passa o mouse em cada botão e campo visível de `raiz` (padrão: o <body>, com os diálogos abertos), espera o tempo
 * da dica, confere a dica (role="tooltip" com texto, no `aria-describedby`), tira o mouse e confere que ela some.
 * Devolve os controles que falharam (vazio: todos têm dica). Usa o relógio falso só durante a varredura: chame
 * depois de a tela carregar. Num teste que já usa o relógio falso, usa o dele e o deixa ligado (avançar o tempo
 * também roda os timers da tela).
 */
export function controlesSemDica(raiz: ParentNode = document.body): string[] {
  // O "?" da ajuda (RIFA-066) fica para a varredura das ajudas (`titulosSemAjuda`), que passa o mouse no título do
  // mesmo grupo e toca nele: conferir de novo aqui só dobrava o tempo da varredura.
  const controles = Array.from(
    raiz.querySelectorAll<HTMLElement>(SELETOR_COM_DICA),
  ).filter(
    (controle) =>
      participa(controle) && !controle.matches("[data-ajuda-botao]"),
  );
  const falhas: string[] = [];
  const relogioJaFalso = vi.isFakeTimers();
  if (!relogioJaFalso) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }
  try {
    for (const controle of controles) {
      passarOMouse(controle);
      act(() => vi.advanceTimersByTime(ATRASO_DA_DICA_MS));
      const dica = dicaDe(controle);
      if (!dica || !dica.textContent?.trim()) {
        falhas.push(`${nomeDoControle(controle)}: sem dica`);
      }
      tirarOMouse(controle);
      act(() => vi.advanceTimersByTime(FOLGA_DA_DICA_MS));
      if (dica?.isConnected) {
        falhas.push(`${nomeDoControle(controle)}: a dica não sumiu`);
      }
    }
  } finally {
    if (!relogioJaFalso) vi.useRealTimers();
  }
  return falhas;
}

/**
 * Quantos controles há em `raiz` (para o teste garantir que a varredura achou o que devia). Conta também o "?" das
 * ajudas, que é um botão (o telão, sem controles, continua com 0).
 */
export function contarControles(raiz: ParentNode = document.body): number {
  return Array.from(
    raiz.querySelectorAll<HTMLElement>(SELETOR_COM_DICA),
  ).filter(participa).length;
}

// ---------------------------------------------------------------------------------------------------
// Ajuda dos títulos e rótulos (RIFA-066, D31): a varredura que prova que todo título de seção e todo rótulo de campo
// da tela tem explicação ao passar o mouse nele e ao tocar no "?" ao lado (o foco do teclado no "?" é o mesmo da
// dica dos botões, conferido em components/ui/Ajuda.test.tsx).
// ---------------------------------------------------------------------------------------------------

/**
 * O que precisa de ajuda: o título da tela e os de seção (h1, h2, h3: o Card com título, os subtítulos como
 * "Períodos"), os rótulos de campo (os do Input, Select, Textarea e SeletorArquivo, as caixas de marcar e a legenda
 * de um grupo de campos) e os rótulos dos números (Stat).
 */
export const SELETOR_COM_AJUDA = [
  "h1",
  "h2",
  "h3",
  "label",
  "legend",
  ".ui-stat__rotulo",
].join(", ");

/**
 * Fica de fora: o título de um diálogo (o diálogo já tem a descrição dele), o que é só para o leitor de tela, o
 * botão do SeletorArquivo (um <label> com cara de botão, que já tem dica), a opção de um grupo de rádio (a ajuda
 * fica na legenda do grupo) e o que a tela marca com `data-sem-ajuda`
 * (o nome de um item numa lista, como a célula, a pessoa ou o afiliado: não é título de seção). Fora de painel
 * oculto e do que um diálogo deixou `inert`, como na varredura dos botões.
 */
function precisaDeAjuda(elemento: HTMLElement): boolean {
  if (!participa(elemento)) return false;
  if (elemento.closest(".visualmente-oculto, [data-sem-ajuda]")) return false;
  if (elemento.matches(".ui-seletor-arquivo__botao")) return false;
  // Uma opção de um grupo de rádio é uma escolha, não um campo: a ajuda fica na legenda do grupo.
  if (
    elemento.matches("label") &&
    elemento.querySelector("input[type='radio']")
  )
    return false;
  if (
    elemento.matches("h1, h2, h3") &&
    elemento.closest("[role='dialog'], [role='alertdialog']")
  )
    return false;
  return true;
}

/** Os títulos e rótulos que a varredura de ajuda confere em `raiz`. */
function alvosDeAjuda(raiz: ParentNode): HTMLElement[] {
  return Array.from(
    raiz.querySelectorAll<HTMLElement>(SELETOR_COM_AJUDA),
  ).filter(precisaDeAjuda);
}

/** Quantos títulos e rótulos a varredura de ajuda confere em `raiz`. */
export function contarAjudas(raiz: ParentNode = document.body): number {
  return alvosDeAjuda(raiz).length;
}

function nomeDoAlvo(alvo: HTMLElement): string {
  return `${alvo.tagName.toLowerCase()} "${(alvo.textContent ?? "").replace(/\s+/g, " ").trim()}"`;
}

/** A ajuda aberta (role="tooltip" com o id do grupo), ou null. */
function ajudaAberta(grupo: HTMLElement): HTMLElement | null {
  const id = grupo.dataset.ajuda;
  const ajuda = id ? document.getElementById(id) : null;
  return ajuda?.getAttribute("role") === "tooltip" ? ajuda : null;
}

/**
 * Confere cada título e rótulo de `raiz` (padrão: o <body>, com os diálogos abertos; veja `SELETOR_COM_AJUDA`):
 * está num grupo de ajuda, o mouse parado nele abre a explicação (role="tooltip", com texto e já carregada) e ela
 * some ao tirar o mouse; o "?" ao lado tem o nome "Ajuda: <o título>", com a explicação no aria-describedby, e o
 * toque nele abre e o toque seguinte fecha. Com `semBotao` (o telão), só o mouse. Espera antes os textos sob demanda.
 * Devolve o que falhou (vazio: todos têm). Como `controlesSemDica`, usa o relógio falso só durante a varredura.
 */
export async function titulosSemAjuda(
  raiz: ParentNode = document.body,
  { semBotao = false }: { semBotao?: boolean } = {},
): Promise<string[]> {
  await act(() => ajudasCarregadas());
  const falhas: string[] = [];
  const relogioJaFalso = vi.isFakeTimers();
  if (!relogioJaFalso) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }
  try {
    for (const alvo of alvosDeAjuda(raiz)) {
      const nome = nomeDoAlvo(alvo);
      // O grupo fica em volta do título; na legenda (que tem de ser a primeira filha do <fieldset>), dentro dela.
      const grupo =
        alvo.closest<HTMLElement>("[data-ajuda]") ??
        alvo.querySelector<HTMLElement>(":scope > [data-ajuda]");
      if (!grupo) {
        falhas.push(`${nome}: sem ajuda`);
        continue;
      }
      // O mouse no texto do título (na legenda, o grupo fica dentro dela: o texto é o primeiro filho dele).
      const texto =
        grupo === alvo || !alvo.contains(grupo)
          ? alvo
          : (grupo.firstElementChild ?? grupo);
      passarOMouse(texto);
      act(() => vi.advanceTimersByTime(ATRASO_DA_DICA_MS));
      const pelaMouse = ajudaAberta(grupo);
      const explicacao = pelaMouse?.textContent?.trim();
      if (!explicacao) falhas.push(`${nome}: o mouse não abre a explicação`);
      else if (explicacao === CARREGANDO_A_AJUDA)
        falhas.push(`${nome}: a explicação não chegou`);
      tirarOMouse(texto);
      act(() => vi.advanceTimersByTime(FOLGA_DA_DICA_MS));
      if (ajudaAberta(grupo)) falhas.push(`${nome}: a explicação não sumiu`);

      const botao = grupo.querySelector<HTMLElement>("[data-ajuda-botao]");
      if (!botao) {
        if (!semBotao) falhas.push(`${nome}: sem o "?" ao lado`);
        continue;
      }
      const nomeDoBotao = botao.getAttribute("aria-label") ?? "";
      const tituloNoNome = (alvo.textContent ?? "").replace(/\s+/g, " ").trim();
      if (nomeDoBotao !== `Ajuda: ${tituloNoNome}`)
        falhas.push(`${nome}: o "?" se chama "${nomeDoBotao}"`);
      fireEvent.click(botao);
      const peloToque = ajudaAberta(grupo);
      if (!peloToque?.textContent?.trim())
        falhas.push(`${nome}: o toque no "?" não abre a explicação`);
      else if (
        !(botao.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .includes(peloToque.id)
      )
        falhas.push(`${nome}: a explicação fora do aria-describedby do "?"`);
      fireEvent.click(botao);
      if (ajudaAberta(grupo))
        falhas.push(`${nome}: o segundo toque no "?" não fecha`);
    }
  } finally {
    if (!relogioJaFalso) vi.useRealTimers();
  }
  return falhas;
}
