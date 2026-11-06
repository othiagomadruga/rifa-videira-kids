import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderizarRota, respostaJson } from "../../test/renderizar";

describe("StatusPage (/status)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("chama /api/health e mostra 'API ok'", async () => {
    const fetchMock = vi.fn(async () =>
      respostaJson({ ok: true, db: "ok", latenciaMs: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderizarRota("/status");

    expect(await screen.findByText("API ok")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("mostra erro claro quando a API responde com falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respostaJson({ ok: false, db: "erro" }, 503)),
    );

    renderizarRota("/status");

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

    renderizarRota("/status");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Erro na API: Não foi possível conectar à API.",
    );
  });

  it("mostra a mensagem do erro padrão da API e tenta de novo", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(
        respostaJson(
          {
            erro: {
              codigo: "BANCO_INDISPONIVEL",
              mensagem: "Falha ao consultar o banco de dados.",
            },
          },
          503,
        ),
      )
      .mockResolvedValueOnce(respostaJson({ ok: true, db: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    renderizarRota("/status");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Erro na API: Falha ao consultar o banco de dados.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByText("API ok")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
