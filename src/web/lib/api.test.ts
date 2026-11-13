import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { espiarDownloads } from "../test/download";
import { respostaJson } from "../test/renderizar";
import {
  aoReceber401,
  api,
  baixarArquivo,
  CODIGOS_CLIENTE,
  ehFalhaDeConexao,
  ErroApi,
  LIBERAR_ARQUIVO_DEPOIS_MS,
  MENSAGEM_SEM_CONEXAO,
  MENSAGEM_TEMPO_ESGOTADO,
  mensagemDoErro,
  requisitarJson,
  TAMANHO_MAXIMO_NOME_ARQUIVO,
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
      mensagem: MENSAGEM_SEM_CONEXAO,
      status: null,
    });
    expect(ehFalhaDeConexao(erro)).toBe(true);
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
      mensagem: MENSAGEM_TEMPO_ESGOTADO,
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

describe("cliente da API: arquivo para baixar (baixarArquivo, RIFA-038)", () => {
  const CSV = "\uFEFFCélula;Bilhetes\r\nÁgape;12\r\n";
  const NOME = "rifa-videira-kids-celulas-2026-12-04.csv";
  const arquivo = (disposicao: string | null, corpo = CSV) =>
    new Response(corpo, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        ...(disposicao === null ? {} : { "content-disposition": disposicao }),
      },
    });

  let downloads: ReturnType<typeof espiarDownloads> | null = null;
  const espiar = () => (downloads = espiarDownloads());
  // Relógio falso em todos: a liberação do object URL (60 s) nunca fica pendente no relógio de verdade depois do
  // teste (o useRealTimers do afterEach a descarta).
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    downloads?.desfazer();
    downloads = null;
  });

  it("GET na mesma origem, com o cookie: o Blob vira um link com o nome do Content-Disposition, clicado e removido; o arquivo chega inteiro, com o BOM", async () => {
    const espiao = espiar();
    const fetchMock = simularFetch(async () =>
      arquivo(`attachment; filename="${NOME}"`),
    );

    await expect(
      baixarArquivo("/api/painel/relatorio?tipo=celulas", {
        nomeReserva: "reserva.csv",
      }),
    ).resolves.toBe(NOME);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/painel/relatorio?tipo=celulas");
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin" });
    expect(init?.body).toBeUndefined();
    expect(espiao.cliques).toEqual([
      {
        endereco: "blob:http://localhost:3000/arquivo-1",
        nome: NOME,
        naPagina: true,
      },
    ]);
    expect(await espiao.texto()).toBe(CSV);
    // O link sai da página na hora; o endereço do arquivo só é liberado depois.
    expect(document.querySelector("a")).toBeNull();
    expect(espiao.liberados).toEqual([]);
  });

  it("o arquivo baixado tem os bytes da resposta, um por um: o BOM (EF BB BF) no começo e os acentos em UTF-8 (o corpo nunca passa por texto, que tiraria o BOM e o Excel quebraria os acentos)", async () => {
    const espiao = espiar();
    // Como o Worker manda: os bytes UTF-8 do CSV, com o BOM.
    const enviados = new TextEncoder().encode(CSV);
    expect([...enviados.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    simularFetch(
      async () =>
        new Response(enviados.slice(), {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${NOME}"`,
          },
        }),
    );

    await baixarArquivo("/api/x", { nomeReserva: "reserva.csv" });

    const baixados = await espiao.bytes();
    expect([...baixados.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect([...baixados]).toEqual([...enviados]);
    // "Célula": o "é" chega como C3 A9 (UTF-8), não como um byte só.
    expect([...baixados.slice(3, 6)]).toEqual([0x43, 0xc3, 0xa9]);
  });

  it(`libera o object URL ${LIBERAR_ARQUIVO_DEPOIS_MS / 1000} s depois do clique (o navegador lê o arquivo depois)`, async () => {
    const espiao = espiar();
    simularFetch(async () => arquivo(`attachment; filename="${NOME}"`));

    await baixarArquivo("/api/x", { nomeReserva: "reserva.csv" });
    await vi.advanceTimersByTimeAsync(LIBERAR_ARQUIVO_DEPOIS_MS - 1);
    expect(espiao.liberados).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(espiao.liberados).toEqual([espiao.cliques[0].endereco]);
  });

  it.each([
    ["sem o cabeçalho", null, "reserva.csv"],
    ["sem filename", "attachment", "reserva.csv"],
    ["com filename vazio", 'attachment; filename=""', "reserva.csv"],
    ["filename sem aspas", `attachment; filename=${NOME}`, NOME],
    [
      "filename* (UTF-8) antes do filename",
      `attachment; filename="relatorio.csv"; filename*=UTF-8''relat%C3%B3rio%20final.csv`,
      "relatório final.csv",
    ],
    [
      "filename* inválido: fica o filename",
      `attachment; filename*=UTF-8''%E0%A4%A; filename="${NOME}"`,
      NOME,
    ],
  ])("nome do arquivo %s: %s", async (_caso, disposicao, esperado) => {
    const espiao = espiar();
    simularFetch(async () => arquivo(disposicao));

    await expect(
      baixarArquivo("/api/x", { nomeReserva: "reserva.csv" }),
    ).resolves.toBe(esperado);
    expect(espiao.cliques.map((clique) => clique.nome)).toEqual([esperado]);
  });

  it.each([
    [
      "com pasta e ..: só o último trecho",
      'attachment; filename="../../relatorio.csv"',
      "relatorio.csv",
    ],
    [
      "filename* com / codificada",
      `attachment; filename*=UTF-8''..%2F..%2Fpasta%2Frelat%C3%B3rio.csv`,
      "relatório.csv",
    ],
    [
      "filename* com \\ do Windows",
      `attachment; filename*=UTF-8''C%3A%5CUsers%5Cx%5C..%5Crelatorio.csv`,
      "relatorio.csv",
    ],
    ["só ..: o de reserva", 'attachment; filename=".."', "reserva.csv"],
    [
      "filename* do qual nada sobra: fica o filename",
      `attachment; filename*=UTF-8''..%2F..; filename="${NOME}"`,
      NOME,
    ],
    ["oculto (ponto na frente)", 'attachment; filename=".bashrc"', "bashrc"],
    [
      "com o U+202E, que inverte o texto e disfarça a extensão",
      `attachment; filename*=UTF-8''relatorio%E2%80%AEvsc.exe`,
      "relatoriovsc.exe",
    ],
    [
      "com caracteres de controle (nulo, quebra de linha, tabulação)",
      `attachment; filename*=UTF-8''rela%00t%0D%0Aorio%09.csv`,
      "relatorio.csv",
    ],
    [
      "com os caracteres que o Windows recusa",
      'attachment; filename="a<b>c:d|e?f*g\\".csv"',
      "a_b_c_d_e_f_g_.csv",
    ],
    [
      "com espaços e pontos sobrando",
      'attachment; filename="  relatorio   final.csv. . "',
      "relatorio final.csv",
    ],
    [
      "comprido demais: corta e mantém a extensão",
      `attachment; filename="${"a".repeat(300)}.csv"`,
      `${"a".repeat(TAMANHO_MAXIMO_NOME_ARQUIVO - 4)}.csv`,
    ],
  ])("nome do arquivo saneado, %s: %s", async (_caso, disposicao, esperado) => {
    const espiao = espiar();
    simularFetch(async () => arquivo(disposicao));

    await expect(
      baixarArquivo("/api/x", { nomeReserva: "reserva.csv" }),
    ).resolves.toBe(esperado);
    expect(espiao.cliques.map((clique) => clique.nome)).toEqual([esperado]);
    expect(esperado.length).toBeLessThanOrEqual(TAMANHO_MAXIMO_NOME_ARQUIVO);
  });

  it("erros como no requisitarJson: o formato da API, ERRO_HTTP fora dele e SEM_CONEXAO; nada é baixado", async () => {
    const espiao = espiar();
    simularFetch(async () =>
      respostaJson(
        {
          erro: {
            codigo: "nao_encontrado",
            mensagem: "Nenhuma campanha ativa",
          },
        },
        404,
      ),
    );
    const semCampanha = await capturarErro(
      baixarArquivo("/api/x", { nomeReserva: "r.csv" }),
    );
    expect(semCampanha).toBeInstanceOf(ErroApi);
    expect(semCampanha).toMatchObject({
      codigo: "nao_encontrado",
      mensagem: "Nenhuma campanha ativa",
      status: 404,
    });

    simularFetch(
      async () => new Response("<html>falhou</html>", { status: 502 }),
    );
    await expect(
      baixarArquivo("/api/x", { nomeReserva: "r.csv" }),
    ).rejects.toMatchObject({ codigo: CODIGOS_CLIENTE.erroHttp, status: 502 });

    simularFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      baixarArquivo("/api/x", { nomeReserva: "r.csv" }),
    ).rejects.toMatchObject({
      codigo: CODIGOS_CLIENTE.semConexao,
      status: null,
    });

    expect(espiao.criar).not.toHaveBeenCalled();
    expect(espiao.cliques).toEqual([]);
  });

  it("o 401 avisa os ouvintes (a sessão leva para /entrar) antes de falhar", async () => {
    espiar();
    simularFetch(async () =>
      respostaJson(
        { erro: { codigo: "nao_autenticado", mensagem: "Sem sessão" } },
        401,
      ),
    );
    const ouvinte = vi.fn();
    const desligar = aoReceber401(ouvinte);
    try {
      await expect(
        baixarArquivo("/api/painel/relatorio?tipo=totais", {
          nomeReserva: "r.csv",
        }),
      ).rejects.toMatchObject({ status: 401, codigo: "nao_autenticado" });
    } finally {
      desligar();
    }
    expect(ouvinte).toHaveBeenCalledExactlyOnceWith(
      "/api/painel/relatorio?tipo=totais",
    );
  });

  it("tempo limite e cancelamento: TEMPO_ESGOTADO e CANCELADA, sem baixar nada", async () => {
    const espiao = espiar();
    simularFetchQueNaoResponde();
    const lenta = baixarArquivo("/api/x", {
      nomeReserva: "r.csv",
      tempoLimiteMs: 2_000,
    });
    const verificacao = expect(lenta).rejects.toMatchObject({
      codigo: CODIGOS_CLIENTE.tempoEsgotado,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await verificacao;

    const controle = new AbortController();
    const cancelada = baixarArquivo("/api/x", {
      nomeReserva: "r.csv",
      signal: controle.signal,
    });
    controle.abort();
    await expect(cancelada).rejects.toMatchObject({
      codigo: CODIGOS_CLIENTE.cancelada,
    });

    expect(espiao.cliques).toEqual([]);
  });

  it("cancelada depois de a resposta chegar, mas antes do clique: não baixa", async () => {
    const espiao = espiar();
    const controle = new AbortController();
    simularFetch(async () => {
      const resposta = arquivo(`attachment; filename="${NOME}"`);
      // A tela sai enquanto o corpo é lido.
      const lerBlob = resposta.blob.bind(resposta);
      resposta.blob = async () => {
        const blob = await lerBlob();
        controle.abort();
        return blob;
      };
      return resposta;
    });

    await expect(
      baixarArquivo("/api/x", {
        nomeReserva: "r.csv",
        signal: controle.signal,
      }),
    ).rejects.toMatchObject({ codigo: CODIGOS_CLIENTE.cancelada });
    expect(espiao.criar).not.toHaveBeenCalled();
    expect(espiao.cliques).toEqual([]);
  });

  it("recusa caminhos de outra origem sem chamar o fetch", async () => {
    espiar();
    const fetchMock = simularFetch(async () => arquivo(null));
    await expect(
      baixarArquivo("https://outro.example/relatorio.csv", {
        nomeReserva: "r.csv",
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// RIFA-049 (P1.12): as falhas sem resposta falam a língua de quem usa (o público e os líderes leem), sem "API".
describe("cliente da API: mensagens de falha sem jargão", () => {
  it("os textos combinados; os códigos não mudam", () => {
    expect(MENSAGEM_SEM_CONEXAO).toBe(
      "Sem conexão com a internet. Confira o sinal e tente de novo.",
    );
    expect(MENSAGEM_TEMPO_ESGOTADO).toBe(
      "O sistema demorou para responder. Tente de novo.",
    );
    expect(CODIGOS_CLIENTE).toMatchObject({
      semConexao: "SEM_CONEXAO",
      tempoEsgotado: "TEMPO_ESGOTADO",
    });
    for (const mensagem of [MENSAGEM_SEM_CONEXAO, MENSAGEM_TEMPO_ESGOTADO])
      expect(mensagem).not.toMatch(/\bAPI\b|HTTP/);
  });

  it("ehFalhaDeConexao: só sem conexão e tempo esgotado (a falha passageira), nunca a resposta de erro", () => {
    const erro = (codigo: string, status: number | null = null) =>
      new ErroApi({ codigo, mensagem: "x", status });
    expect(ehFalhaDeConexao(erro(CODIGOS_CLIENTE.semConexao))).toBe(true);
    expect(ehFalhaDeConexao(erro(CODIGOS_CLIENTE.tempoEsgotado))).toBe(true);
    for (const codigo of [
      CODIGOS_CLIENTE.cancelada,
      CODIGOS_CLIENTE.respostaInvalida,
      CODIGOS_CLIENTE.erroHttp,
      "nao_encontrado",
    ])
      expect(ehFalhaDeConexao(erro(codigo, 500)), codigo).toBe(false);
    expect(ehFalhaDeConexao(new Error(MENSAGEM_SEM_CONEXAO))).toBe(false);
    expect(ehFalhaDeConexao(null)).toBe(false);
  });
});
