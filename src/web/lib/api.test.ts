import { afterEach, describe, expect, it, vi } from "vitest";
import { respostaJson } from "../test/renderizar";
import {
  aoReceber401,
  api,
  CODIGOS_CLIENTE,
  ErroApi,
  mensagemDoErro,
  requisitarJson,
  TEMPO_LIMITE_PADRAO_MS,
} from "./api";

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

function simularFetch(implementacao: FetchMock) {
  const fetchMock = vi.fn(implementacao);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// fetch que nunca responde e só termina quando o signal aborta (como o de verdade).
function simularFetchQueNaoResponde() {
  return simularFetch(
    (_url, init) =>
      new Promise<Response>((_resolver, rejeitar) => {
        const abortar = () =>
          rejeitar(new DOMException("A operação foi abortada.", "AbortError"));
        if (init?.signal?.aborted) abortar();
        init?.signal?.addEventListener("abort", abortar);
      }),
  );
}

async function capturarErro(promessa: Promise<unknown>): Promise<unknown> {
  try {
    await promessa;
  } catch (erro) {
    return erro;
  }
  throw new Error("A promessa deveria ter falhado.");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("cliente da API: requisição", () => {
  it("faz GET na mesma origem pedindo JSON e devolve o corpo", async () => {
    const fetchMock = simularFetch(async () => respostaJson({ total: 3 }));

    await expect(api.get("/api/coisas")).resolves.toEqual({ total: 3 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/coisas");
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin" });
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    expect(init?.body).toBeUndefined();
  });

  it("envia o corpo como JSON", async () => {
    const fetchMock = simularFetch(async () => respostaJson({ id: 7 }, 201));

    await expect(
      api.post("/api/celulas", { nome: "Célula Ágape" }),
    ).resolves.toEqual({ id: 7 });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ nome: "Célula Ágape" }));
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("resposta sem corpo (204) devolve undefined", async () => {
    simularFetch(async () => new Response(null, { status: 204 }));

    await expect(api.delete("/api/celulas/7")).resolves.toBeUndefined();
  });

  it("recusa caminhos de outra origem sem chamar o fetch", async () => {
    const fetchMock = simularFetch(async () => respostaJson({}));

    for (const caminho of [
      "https://exemplo.com/api/x",
      "//exemplo.com/api/x",
      "/\\exemplo.com/api/x",
      "api/relativo",
    ]) {
      await expect(requisitarJson(caminho)).rejects.toThrow(TypeError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cliente da API: erros tipados", () => {
  it("erro no formato da API vira ErroApi com código, mensagem, status e detalhes", async () => {
    simularFetch(async () =>
      respostaJson(
        {
          erro: {
            codigo: "META_INVALIDA",
            mensagem: "A meta precisa ser maior que zero.",
            detalhes: { campo: "meta" },
          },
        },
        422,
      ),
    );

    const erro = await capturarErro(api.put("/api/campanha", { meta: 0 }));

    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro).toMatchObject({
      name: "ErroApi",
      codigo: "META_INVALIDA",
      mensagem: "A meta precisa ser maior que zero.",
      message: "A meta precisa ser maior que zero.",
      status: 422,
      detalhes: { campo: "meta" },
    });
  });

  it("erro HTTP fora do formato vira ERRO_HTTP com o status", async () => {
    simularFetch(async () => respostaJson({ ok: false, db: "erro" }, 503));

    const erro = await capturarErro(api.get("/api/health"));

    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro).toMatchObject({
      codigo: CODIGOS_CLIENTE.erroHttp,
      mensagem: "A API respondeu com falha (HTTP 503).",
      status: 503,
    });
  });

  it("erro HTTP com corpo que não é JSON também vira ERRO_HTTP", async () => {
    simularFetch(
      async () => new Response("<h1>Bad Gateway</h1>", { status: 502 }),
    );

    await expect(api.get("/api/x")).rejects.toMatchObject({
      codigo: CODIGOS_CLIENTE.erroHttp,
      status: 502,
    });
  });

  it("resposta de sucesso que não é JSON vira RESPOSTA_INVALIDA", async () => {
    simularFetch(async () => new Response("<!doctype html>", { status: 200 }));

    await expect(api.get("/api/x")).rejects.toMatchObject({
      codigo: CODIGOS_CLIENTE.respostaInvalida,
      status: 200,
    });
  });

  it("falha de rede vira SEM_CONEXAO, sem status", async () => {
    const falha = new TypeError("Failed to fetch");
    simularFetch(async () => {
      throw falha;
    });

    const erro = await capturarErro(api.get("/api/x"));

    expect(erro).toMatchObject({
      codigo: CODIGOS_CLIENTE.semConexao,
      mensagem: "Não foi possível conectar à API.",
      status: null,
    });
    expect((erro as ErroApi).cause).toBe(falha);
  });
});

describe("cliente da API: tempo limite e cancelamento", () => {
  it("estoura o tempo limite e vira TEMPO_ESGOTADO", async () => {
    vi.useFakeTimers();
    simularFetchQueNaoResponde();

    const promessa = api.get("/api/lenta", { tempoLimiteMs: 2_000 });
    const verificacao = expect(promessa).rejects.toMatchObject({
      codigo: CODIGOS_CLIENTE.tempoEsgotado,
      status: null,
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await verificacao;
  });

  it(`usa ${TEMPO_LIMITE_PADRAO_MS} ms de tempo limite por padrão`, async () => {
    vi.useFakeTimers();
    simularFetchQueNaoResponde();
    let terminou = false;

    const promessa = api.get("/api/lenta").finally(() => {
      terminou = true;
    });
    const verificacao = expect(promessa).rejects.toMatchObject({
      codigo: CODIGOS_CLIENTE.tempoEsgotado,
    });

    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_PADRAO_MS - 1);
    expect(terminou).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await verificacao;
  });

  it("cancelamento pelo signal vira CANCELADA", async () => {
    simularFetchQueNaoResponde();
    const controle = new AbortController();

    const promessa = api.get("/api/x", { signal: controle.signal });
    controle.abort();

    await expect(promessa).rejects.toMatchObject({
      codigo: CODIGOS_CLIENTE.cancelada,
    });
  });

  it("signal já cancelado falha na hora, sem chamar o fetch", async () => {
    const fetchMock = simularFetchQueNaoResponde();
    const controle = new AbortController();
    controle.abort();

    await expect(
      api.get("/api/x", { signal: controle.signal }),
    ).rejects.toMatchObject({ codigo: CODIGOS_CLIENTE.cancelada });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cliente da API: gancho de 401 (sessão)", () => {
  const SEM_SESSAO = () =>
    respostaJson(
      { erro: { codigo: "nao_autenticado", mensagem: "Sem sessão" } },
      401,
    );

  it("avisa cada ouvinte com o caminho pedido, antes de a chamada falhar com o 401", async () => {
    simularFetch(async () => SEM_SESSAO());
    const ordem: string[] = [];
    const primeiro = vi.fn((caminho: string) =>
      ordem.push(`ouvinte ${caminho}`),
    );
    const segundo = vi.fn();
    const desligarPrimeiro = aoReceber401(primeiro);
    const desligarSegundo = aoReceber401(segundo);

    try {
      await api.get("/api/admin/campanha").catch((erro: unknown) => {
        ordem.push("falhou");
        expect(erro).toMatchObject({ status: 401, codigo: "nao_autenticado" });
      });
    } finally {
      desligarPrimeiro();
      desligarSegundo();
    }

    expect(ordem).toEqual(["ouvinte /api/admin/campanha", "falhou"]);
    expect(segundo).toHaveBeenCalledExactlyOnceWith("/api/admin/campanha");
  });

  it("não avisa em outros erros (403, 404, 500, sem conexão) nem em sucesso", async () => {
    const ouvinte = vi.fn();
    const desligar = aoReceber401(ouvinte);
    try {
      for (const status of [403, 404, 500]) {
        simularFetch(async () => respostaJson({}, status));
        await expect(api.get("/api/x")).rejects.toMatchObject({ status });
      }
      simularFetch(async () => {
        throw new TypeError("Failed to fetch");
      });
      await expect(api.get("/api/x")).rejects.toMatchObject({
        codigo: CODIGOS_CLIENTE.semConexao,
      });
      simularFetch(async () => respostaJson({ ok: true }));
      await expect(api.get("/api/x")).resolves.toEqual({ ok: true });
    } finally {
      desligar();
    }

    expect(ouvinte).not.toHaveBeenCalled();
  });

  it("depois de desligado, o ouvinte não é mais chamado", async () => {
    simularFetch(async () => SEM_SESSAO());
    const ouvinte = vi.fn();
    aoReceber401(ouvinte)();

    await expect(api.post("/api/admin/redes", {})).rejects.toBeInstanceOf(
      ErroApi,
    );

    expect(ouvinte).not.toHaveBeenCalled();
  });
});

describe("mensagemDoErro", () => {
  it("usa a mensagem do ErroApi e um texto genérico para os outros erros", () => {
    expect(
      mensagemDoErro(new ErroApi({ codigo: "X", mensagem: "Sem permissão." })),
    ).toBe("Sem permissão.");
    expect(mensagemDoErro(new Error("stack interna"))).toBe(
      "Ocorreu um erro inesperado. Tente de novo.",
    );
  });
});
