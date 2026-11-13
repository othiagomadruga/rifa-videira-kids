// RIFA-049 (P1.5, D25): a comemoração da meta batida. false → true comemora uma vez (o pulso e as partículas);
// true → true não; "ao-bater" não comemora no primeiro aparecimento já batido (só pulsa); com reduce (ou sem
// matchMedia), nenhum animate e nenhuma partícula no DOM; cada partícula anima só transform e opacity, até 450 ms,
// atraso até 300 ms, e sai do DOM no fim; umaVezPor "dia" guarda a data no sessionStorage.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  desfazerMovimento,
  espiarAnimate,
  simularPreferencia,
} from "../test/movimento";
import {
  ATRASO_PARTICULA_MAXIMO_MS,
  CLASSE_COMEMORA,
  DURACAO_COMEMORACAO_MS,
  PARTICULAS,
  PREFIXO_ARMAZENAMENTO,
  useComemoracao,
  type OpcoesComemoracao,
} from "./useComemoracao";
import { ATRASO_PULSO_MS } from "./usePulsoDaMeta";

type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const lerCss = (relativo: string) =>
  process
    .getBuiltinModule("node:fs")
    .readFileSync(
      decodeURIComponent(new URL(relativo, import.meta.url).pathname),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "");

function Pilula({
  batida,
  texto,
  opcoes = { quando: "ao-bater" },
}: {
  batida: boolean;
  texto: string;
  opcoes?: OpcoesComemoracao;
}) {
  const { ref, confete } = useComemoracao<HTMLSpanElement>(batida, opcoes);
  return (
    <span ref={ref} className={`pilula ${CLASSE_COMEMORA}`}>
      {texto}
      {confete}
    </span>
  );
}

const particulas = () => document.querySelectorAll(".mov-confete");
const camada = () => document.querySelector(".mov-comemoracao");

/** As chamadas do animate que são das partículas (o pulso anima o próprio elemento). */
function chamadasDasParticulas(animate: ReturnType<typeof espiarAnimate>) {
  return animate.mock.contexts
    .map((elemento, indice) => ({
      elemento: elemento as Element,
      quadros: animate.mock.calls[indice][0] as Keyframe[],
      opcoes: animate.mock.calls[indice][1] as KeyframeAnimationOptions,
    }))
    .filter(({ elemento }) => elemento.classList.contains("mov-confete"));
}

function chamadasDoPulso(animate: ReturnType<typeof espiarAnimate>) {
  return animate.mock.contexts.filter((elemento) =>
    (elemento as Element).classList.contains("pilula"),
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  desfazerMovimento();
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("useComemoracao: quando comemora", () => {
  it("false → true: o pulso e as partículas, uma vez; true → true não repete", () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    const { rerender } = render(<Pilula batida={false} texto="96%" />);
    expect(animate).not.toHaveBeenCalled();
    expect(camada()).toBeNull();

    rerender(<Pilula batida texto="104%" />);
    expect(chamadasDoPulso(animate)).toHaveLength(1);
    expect(animate.mock.calls[0][1]).toMatchObject({
      delay: ATRASO_PULSO_MS,
      iterations: 2,
    });
    expect(particulas()).toHaveLength(PARTICULAS.length);
    expect(chamadasDasParticulas(animate)).toHaveLength(PARTICULAS.length);
    // A camada fica dentro do elemento que comemora e é só visual.
    expect(document.querySelector(".pilula")).toContainElement(
      camada() as HTMLElement,
    );
    expect(camada()).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector(".pilula")).toHaveTextContent(/^104%$/);

    const chamadas = animate.mock.calls.length;
    rerender(<Pilula batida texto="118%" />);
    expect(animate).toHaveBeenCalledTimes(chamadas);
  });

  it("deixou de bater e bateu de novo: comemora de novo", () => {
    simularPreferencia(false);
    vi.useFakeTimers();
    const animate = espiarAnimate();
    const { rerender } = render(<Pilula batida={false} texto="96%" />);
    rerender(<Pilula batida texto="101%" />);
    act(() => vi.advanceTimersByTime(DURACAO_COMEMORACAO_MS));
    rerender(<Pilula batida={false} texto="99%" />);
    rerender(<Pilula batida texto="102%" />);
    expect(chamadasDoPulso(animate)).toHaveLength(2);
    expect(chamadasDasParticulas(animate)).toHaveLength(2 * PARTICULAS.length);
  });

  it('"ao-bater": aparecer já batida só pulsa (abrir a página não solta confete)', () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    const { rerender } = render(<Pilula batida texto="112%" />);
    expect(chamadasDoPulso(animate)).toHaveLength(1);
    expect(camada()).toBeNull();
    rerender(<Pilula batida texto="115%" />);
    expect(camada()).toBeNull();
    expect(chamadasDasParticulas(animate)).toHaveLength(0);
  });

  it('"ao-aparecer-e-ao-bater": aparecer já batida também comemora', () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    render(
      <Pilula
        batida
        texto="113%"
        opcoes={{ quando: "ao-aparecer-e-ao-bater" }}
      />,
    );
    expect(chamadasDoPulso(animate)).toHaveLength(1);
    expect(particulas()).toHaveLength(PARTICULAS.length);
  });

  it("pulso: false: só as partículas", () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    const { rerender } = render(
      <Pilula
        batida={false}
        texto="96%"
        opcoes={{ quando: "ao-bater", pulso: false }}
      />,
    );
    rerender(
      <Pilula
        batida
        texto="101%"
        opcoes={{ quando: "ao-bater", pulso: false }}
      />,
    );
    expect(chamadasDoPulso(animate)).toHaveLength(0);
    expect(chamadasDasParticulas(animate)).toHaveLength(PARTICULAS.length);
  });
});

describe("useComemoracao: sem movimento, nada", () => {
  it("com prefers-reduced-motion: reduce, nenhum animate e nenhuma partícula no DOM", () => {
    simularPreferencia(true);
    const animate = espiarAnimate();
    const { rerender } = render(
      <Pilula
        batida={false}
        texto="96%"
        opcoes={{ quando: "ao-aparecer-e-ao-bater" }}
      />,
    );
    rerender(
      <Pilula
        batida
        texto="104%"
        opcoes={{ quando: "ao-aparecer-e-ao-bater" }}
      />,
    );
    expect(animate).not.toHaveBeenCalled();
    expect(camada()).toBeNull();
    expect(particulas()).toHaveLength(0);
  });

  it("sem matchMedia (o navegador não diz a preferência): nada", () => {
    const animate = espiarAnimate();
    const { rerender } = render(<Pilula batida={false} texto="96%" />);
    rerender(<Pilula batida texto="104%" />);
    expect(animate).not.toHaveBeenCalled();
    expect(camada()).toBeNull();
  });
});

describe("useComemoracao: as partículas", () => {
  it("10 a 14, cada uma só com transform e opacity, até 450 ms, atraso até 300 ms, uma vez", () => {
    simularPreferencia(false);
    const animate = espiarAnimate();
    const { rerender } = render(<Pilula batida={false} texto="96%" />);
    rerender(<Pilula batida texto="104%" />);

    const chamadas = chamadasDasParticulas(animate);
    expect(chamadas.length).toBeGreaterThanOrEqual(10);
    expect(chamadas.length).toBeLessThanOrEqual(14);
    for (const { quadros, opcoes } of chamadas) {
      expect(opcoes.duration).toBeLessThanOrEqual(450);
      expect(opcoes.delay ?? 0).toBeLessThanOrEqual(300);
      expect(opcoes.iterations ?? 1).toBe(1);
      for (const quadro of quadros)
        for (const propriedade of Object.keys(quadro))
          expect(["transform", "opacity", "offset"]).toContain(propriedade);
      // Começa e termina invisível (sem piscar no lugar).
      expect(quadros[0].opacity).toBe(0);
      expect(quadros.at(-1)?.opacity).toBe(0);
    }
    expect(ATRASO_PARTICULA_MAXIMO_MS).toBe(
      Math.max(...PARTICULAS.map(({ atraso }) => atraso)),
    );
    expect(DURACAO_COMEMORACAO_MS).toBeLessThanOrEqual(300 + 450);
    // O amarelo do Kids e as cores da marca.
    expect(new Set(PARTICULAS.map(({ cor }) => cor))).toEqual(
      new Set(["amarelo", "verde-agua", "azul", "roxo"]),
    );
  });

  it("saem do DOM quando a última termina (o React tira os nós)", () => {
    simularPreferencia(false);
    vi.useFakeTimers();
    espiarAnimate();
    const { rerender } = render(<Pilula batida={false} texto="96%" />);
    rerender(<Pilula batida texto="104%" />);
    expect(particulas()).toHaveLength(PARTICULAS.length);

    act(() => vi.advanceTimersByTime(DURACAO_COMEMORACAO_MS - 1));
    expect(particulas()).toHaveLength(PARTICULAS.length);
    act(() => vi.advanceTimersByTime(1));
    expect(camada()).toBeNull();
  });

  it("sair da tela no meio: cancela as animações e nada fica pendente", () => {
    simularPreferencia(false);
    vi.useFakeTimers();
    const animate = espiarAnimate();
    const { rerender, unmount } = render(<Pilula batida={false} texto="96%" />);
    rerender(<Pilula batida texto="104%" />);
    const devolvidas = animate.mock.results
      .filter((_, indice) =>
        (animate.mock.contexts[indice] as Element).classList.contains(
          "mov-confete",
        ),
      )
      .map(({ value }) => value as { cancel: ReturnType<typeof vi.fn> });
    unmount();
    for (const animacao of devolvidas)
      expect(animacao.cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("CSS: a camada não recebe toque, cobre o elemento e não tem animação de CSS", () => {
    const css = lerCss("../components/movimento/Comemoracao.css");
    expect(css).toMatch(
      /\.mov-comemoracao\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*pointer-events:\s*none;/,
    );
    expect(css).toMatch(/\.mov-comemora\s*\{[^}]*position:\s*relative;/);
    // Fora da Web Animations API, a partícula fica invisível.
    expect(css).toMatch(/\.mov-confete\s*\{[^}]*opacity:\s*0;/);
    expect(css).not.toMatch(/animation|transition|@keyframes/);
  });
});

describe("useComemoracao: umaVezPor dia", () => {
  const MINHA: OpcoesComemoracao = {
    quando: "ao-aparecer-e-ao-bater",
    umaVezPor: "dia",
    chave: "minha",
  };

  it("comemora uma vez por dia nesta aba: abrir de novo no mesmo dia só pulsa; no dia seguinte, comemora", () => {
    simularPreferencia(false);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
    const animate = espiarAnimate();

    const primeira = render(<Pilula batida texto="113%" opcoes={MINHA} />);
    expect(particulas()).toHaveLength(PARTICULAS.length);
    expect(window.sessionStorage.getItem(`${PREFIXO_ARMAZENAMENTO}minha`)).toBe(
      "2026-11-13",
    );
    primeira.unmount();

    // Recarregou a página no mesmo dia.
    const segunda = render(<Pilula batida texto="113%" opcoes={MINHA} />);
    expect(camada()).toBeNull();
    expect(chamadasDoPulso(animate)).toHaveLength(2);
    segunda.unmount();

    // Outra comemoração (outra chave) não divide a vez.
    const outra = render(
      <Pilula batida texto="120%" opcoes={{ ...MINHA, chave: "outra" }} />,
    );
    expect(particulas()).toHaveLength(PARTICULAS.length);
    outra.unmount();

    // 23h59 em Belém ainda é o mesmo dia (UTC-3); 00h01 já é o seguinte.
    vi.setSystemTime(new Date("2026-11-14T02:59:00Z"));
    const noite = render(<Pilula batida texto="113%" opcoes={MINHA} />);
    expect(camada()).toBeNull();
    noite.unmount();
    vi.setSystemTime(new Date("2026-11-14T03:01:00Z"));
    render(<Pilula batida texto="113%" opcoes={MINHA} />);
    expect(particulas()).toHaveLength(PARTICULAS.length);
  });

  it("sem armazenamento (bloqueado): uma vez por montagem", () => {
    simularPreferencia(false);
    vi.useFakeTimers();
    espiarAnimate();
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
    });

    const { rerender, unmount } = render(
      <Pilula batida texto="113%" opcoes={MINHA} />,
    );
    expect(particulas()).toHaveLength(PARTICULAS.length);
    act(() => vi.advanceTimersByTime(DURACAO_COMEMORACAO_MS));
    rerender(<Pilula batida={false} texto="98%" opcoes={MINHA} />);
    rerender(<Pilula batida texto="101%" opcoes={MINHA} />);
    expect(camada()).toBeNull();
    unmount();

    render(<Pilula batida texto="113%" opcoes={MINHA} />);
    expect(particulas()).toHaveLength(PARTICULAS.length);
  });
});
