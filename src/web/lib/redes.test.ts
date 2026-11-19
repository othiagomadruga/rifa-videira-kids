// RIFA-065 (D30): o que o site sabe de quantas redes a hierarquia tem. A tela que recebeu a lista toda informa; a
// que não recebe pergunta à API uma vez por página aberta; sem saber, nada muda na tela.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROTAS } from "../../shared/contracts";
import { respostaRedes } from "../test/redes";
import { respostaJson } from "../test/renderizar";
import {
  CAMINHO_REDES,
  contarRedes,
  esquecerRedes,
  informarRedes,
  useBuscarRedes,
  useRedes,
} from "./redes";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Troca o fetch: cada chamada recebe a próxima resposta da lista (a última se repete). */
function simularFetch(...respostas: (() => Promise<Response>)[]) {
  const chamadas: string[] = [];
  const fetchMock = vi.fn(async (caminho: string) => {
    chamadas.push(caminho);
    const responder =
      respostas[Math.min(chamadas.length, respostas.length) - 1];
    return responder ? responder() : respostaRedes(2);
  });
  vi.stubGlobal("fetch", fetchMock);
  return chamadas;
}

/** O hook que lê, com o que pergunta à API junto (como as telas sem a hierarquia). */
function useRedesBuscando() {
  useBuscarRedes();
  return useRedes();
}

describe("contarRedes e o caminho", () => {
  it("conta as redes diferentes; o caminho é o de ROTAS.listarRedes", () => {
    expect(contarRedes([])).toBe(0);
    expect(contarRedes([7, 7, 7])).toBe(1);
    expect(contarRedes([1, 2, 1])).toBe(2);
    expect(CAMINHO_REDES).toBe(ROTAS.listarRedes.caminho);
  });
});

describe("useRedes", () => {
  it("sem saber: a tela como sempre foi (nada some) e os textos sem citar a rede", () => {
    const { result } = renderHook(() => useRedes());
    expect(result.current).toEqual({ unica: false, citar: false });
  });

  it("uma rede só: some; o que a tela contou avisa o resto do site", () => {
    const { result } = renderHook(() => ({
      daTela: useRedes(1),
      doSite: useRedes(),
    }));
    expect(result.current.daTela).toEqual({ unica: true, citar: false });
    expect(result.current.doSite).toEqual({ unica: true, citar: false });
  });

  it("duas redes (ou nenhuma ainda): nada some e os textos citam a rede", () => {
    const { result, rerender } = renderHook(
      ({ quantidade }: { quantidade: number }) => useRedes(quantidade),
      { initialProps: { quantidade: 2 } },
    );
    expect(result.current).toEqual({ unica: false, citar: true });
    rerender({ quantidade: 0 });
    expect(result.current).toEqual({ unica: false, citar: true });
  });

  it("o que a tela recebeu vale antes do que o site guardou", () => {
    informarRedes(2);
    const { result } = renderHook(() => useRedes(1));
    expect(result.current.unica).toBe(true);
  });

  it("acompanha o site: outra tela que informa muda a que está aberta", () => {
    const { result } = renderHook(() => useRedes());
    act(() => informarRedes(1));
    expect(result.current.unica).toBe(true);
    act(() => informarRedes(3));
    expect(result.current).toEqual({ unica: false, citar: true });
  });
});

describe("useBuscarRedes", () => {
  it("sem saber, pergunta à API uma vez, mesmo com duas telas abertas", async () => {
    const chamadas = simularFetch(() => Promise.resolve(respostaRedes(1)));
    const primeira = renderHook(useRedesBuscando);
    renderHook(useRedesBuscando);
    await waitFor(() => expect(primeira.result.current.unica).toBe(true));
    expect(chamadas).toEqual([CAMINHO_REDES]);
  });

  it("já sabendo, não pergunta", () => {
    informarRedes(1);
    const chamadas = simularFetch();
    const { result } = renderHook(useRedesBuscando);
    expect(result.current.unica).toBe(true);
    expect(chamadas).toEqual([]);
  });

  it("uma resposta fora do formato da lista não ensina nada e não é pedida de novo", async () => {
    const chamadas = simularFetch(() =>
      Promise.resolve(respostaJson({ nome: "outra coisa" })),
    );
    const primeira = renderHook(useRedesBuscando);
    await waitFor(() => expect(chamadas).toHaveLength(1));
    await act(async () => {});
    primeira.unmount();
    const { result } = renderHook(useRedesBuscando);
    expect(result.current).toEqual({ unica: false, citar: false });
    expect(chamadas).toHaveLength(1);
  });

  it("uma falha deixa a próxima tela perguntar de novo", async () => {
    const chamadas = simularFetch(
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Promise.resolve(respostaRedes(1)),
    );
    const primeira = renderHook(useRedesBuscando);
    await waitFor(() => expect(chamadas).toHaveLength(1));
    await act(async () => {});
    expect(primeira.result.current.unica).toBe(false);
    primeira.unmount();
    const { result } = renderHook(useRedesBuscando);
    await waitFor(() => expect(result.current.unica).toBe(true));
    expect(chamadas).toHaveLength(2);
  });

  it("depois de esquecer (outro teste), a resposta que chega tarde não vale", async () => {
    let responder: (resposta: Response) => void = () => {};
    simularFetch(
      () =>
        new Promise<Response>((resolver) => {
          responder = resolver;
        }),
    );
    renderHook(useRedesBuscando);
    act(() => esquecerRedes());
    await act(async () => responder(respostaRedes(1)));
    const { result } = renderHook(() => useRedes());
    expect(result.current.unica).toBe(false);
  });
});
