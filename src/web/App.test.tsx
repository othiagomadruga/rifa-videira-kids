import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function respostaJson(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("App: página de status", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("chama /api/health e mostra 'API ok'", async () => {
    const fetchMock = vi.fn(async () =>
      respostaJson({ ok: true, db: "ok", latenciaMs: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("API ok")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("mostra erro claro quando a API responde com falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respostaJson({ ok: false, db: "erro" }, 503)),
    );

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Erro na API: A API respondeu com falha (HTTP 503).",
    );
    expect(screen.queryByText("API ok")).not.toBeInTheDocument();
  });

  it("mostra erro claro quando não consegue conectar à API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Erro na API: Não foi possível conectar à API.",
    );
  });
});
