// CA4 (RIFA-020): a lista que se mexe com os dados. Itens entram em sequência (stagger) e, quando a ordem muda,
// deslizam do lugar antigo para o novo (FLIP). Com prefers-reduced-motion: nada anima, nem a entrada nem a troca.
// O jsdom não faz layout: o lugar de cada item é simulado (50 px por linha).
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  desfazerMovimento,
  espiarAnimate,
  simularPreferencia,
} from "../test/movimento";
import {
  ATRASO_SEQUENCIA_MS,
  DURACAO_ENTRADA_MS,
  DURACAO_REORDENAR_MS,
} from "./movimento";
import {
  ATRIBUTO_CHAVE,
  chavesPorNome,
  useListaAnimada,
} from "./useListaAnimada";

const ALTURA_DA_LINHA = 50;

function Lista({ nomes }: { nomes: string[] }) {
  const comChaves = chavesPorNome(nomes.map((nome) => ({ nome })));
  const ref = useListaAnimada<HTMLOListElement>(
    comChaves.map(({ chave }) => chave).join("|"),
  );
  return (
    <ol ref={ref}>
      {comChaves.map(({ chave, item }) => (
        <li key={chave} {...{ [ATRIBUTO_CHAVE]: chave }}>
          {item.nome}
        </li>
      ))}
    </ol>
  );
}

// Layout simulado: cada <li> fica na linha do seu índice; a lista é o offsetParent dos itens.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.tagName !== "LI" || !this.parentElement) return 0;
      return [...this.parentElement.children].indexOf(this) * ALTURA_DA_LINHA;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
    configurable: true,
    get: () => 0,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});

afterEach(() => {
  desfazerMovimento();
  for (const propriedade of ["offsetTop", "offsetLeft", "offsetParent"])
    Reflect.deleteProperty(HTMLElement.prototype, propriedade);
});

/** As chamadas do element.animate: o item, os quadros e as opções. */
function chamadas(animate: ReturnType<typeof espiarAnimate>) {
  return animate.mock.contexts.map((elemento, indice) => {
    const [quadros, opcoes] = animate.mock.calls[indice] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    return { item: (elemento as Element).textContent, quadros, opcoes };
  });
}

describe("useListaAnimada com prefers-reduced-motion: reduce", () => {
  it("stagger e FLIP não animam: a lista aparece e troca de ordem na hora", () => {
    simularPreferencia(true);
    const animate = espiarAnimate();
    const { rerender, container } = render(
      <Lista nomes={["Ágape", "Betel", "Canaã"]} />,
    );
    rerender(<Lista nomes={["Betel", "Ágape", "Canaã"]} />);
    rerender(<Lista nomes={["Betel", "Ágape", "Canaã", "Dorcas"]} />);

    expect(animate).not.toHaveBeenCalled();
    expect(
      [...container.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["Betel", "Ágape", "Canaã", "Dorcas"]);
  });
});

describe("useListaAnimada com movimento", () => {
  beforeEach(() => {
    simularPreferencia(false);
  });

  it("a lista aparece: cada item entra (fade e deslize curto), em sequência", () => {
    const animate = espiarAnimate();
    render(<Lista nomes={["Ágape", "Betel", "Canaã"]} />);

    const feitas = chamadas(animate);
    expect(feitas.map(({ item }) => item)).toEqual(["Ágape", "Betel", "Canaã"]);
    expect(feitas.map(({ opcoes }) => opcoes.delay)).toEqual([
      0,
      ATRASO_SEQUENCIA_MS,
      2 * ATRASO_SEQUENCIA_MS,
    ]);
    for (const { quadros, opcoes } of feitas) {
      expect(quadros[0]).toMatchObject({ opacity: 0 });
      expect(quadros.at(-1)).toMatchObject({ opacity: 1, transform: "none" });
      expect(opcoes.duration).toBe(DURACAO_ENTRADA_MS);
      expect(opcoes.fill).toBe("backwards");
    }
  });

  it("uma atualização com a mesma ordem não mexe em nada", () => {
    const animate = espiarAnimate();
    const { rerender } = render(<Lista nomes={["Ágape", "Betel"]} />);
    animate.mockClear();

    rerender(<Lista nomes={["Ágape", "Betel"]} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("quem troca de lugar desliza do lugar antigo para o novo (FLIP); quem ficou, fica", () => {
    const animate = espiarAnimate();
    const { rerender } = render(<Lista nomes={["Ágape", "Betel", "Canaã"]} />);
    animate.mockClear();

    rerender(<Lista nomes={["Betel", "Ágape", "Canaã"]} />);
    const feitas = chamadas(animate);
    expect(feitas.map(({ item, quadros }) => [item, quadros])).toEqual([
      // Betel estava na linha 2 (50 px) e foi para a 1: começa 50 px abaixo e sobe, por cima de quem desce.
      [
        "Betel",
        [
          { transform: `translate(0px, ${ALTURA_DA_LINHA}px)`, zIndex: "1" },
          { transform: "none", zIndex: "1" },
        ],
      ],
      [
        "Ágape",
        [
          { transform: `translate(0px, ${-ALTURA_DA_LINHA}px)` },
          { transform: "none" },
        ],
      ],
    ]);
    for (const { opcoes } of feitas)
      expect(opcoes.duration).toBe(DURACAO_REORDENAR_MS);
  });

  it("quem entra numa atualização entra com fade; os outros abrem espaço deslizando", () => {
    const animate = espiarAnimate();
    const { rerender } = render(<Lista nomes={["Ágape", "Betel"]} />);
    animate.mockClear();

    rerender(<Lista nomes={["Canaã", "Ágape", "Betel"]} />);
    const feitas = chamadas(animate);
    expect(feitas.map(({ item }) => item)).toEqual(["Canaã", "Ágape", "Betel"]);
    expect(feitas[0].quadros[0]).toMatchObject({ opacity: 0 });
    expect(feitas[1].quadros[0]).toEqual({
      transform: `translate(0px, ${-ALTURA_DA_LINHA}px)`,
    });
  });
});

describe("chavesPorNome", () => {
  it("a chave é o nome; nomes repetidos ganham #2, #3", () => {
    expect(
      chavesPorNome([
        { nome: "Ágape" },
        { nome: "Betel" },
        { nome: "Ágape" },
        { nome: "Ágape" },
      ]).map(({ chave }) => chave),
    ).toEqual(["Ágape", "Betel", "Ágape#2", "Ágape#3"]);
  });
});
