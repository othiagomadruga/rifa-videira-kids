// RIFA-070 (D32): o cliente da API da Rifei sem rede (fetch falso): os cabeçalhos do painel, o caminho certo de cada
// chamada, os erros que param tudo (token, campanha, formato) e os que ficam num pedido só, a mensagem da Rifei
// cortada e a ordem do emLotes.
import { describe, expect, it, vi } from "vitest";
import { LIMITE_MENSAGEM_RIFEI } from "../../shared/contracts";
import {
  FalhaRifei,
  criarClienteRifei,
  emLotes,
  marcarPedidoNaRifei,
  mensagemDaRifei,
} from "./rifei-api";

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status });

function clienteCom(
  resposta: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return resposta(String(url), init ?? {});
  }) as unknown as typeof globalThis.fetch;
  return {
    cliente: criarClienteRifei("  token-x  ", { fetch, tempoLimiteMs: 50 }),
    chamadas,
  };
}

describe("criarClienteRifei", () => {
  it("manda os cabeçalhos do painel (Bearer sem espaços, x-rate-limit) para api.rifei.com.br", async () => {
    const { cliente, chamadas } = clienteCom(() =>
      json(200, { id: 7, version: 2 }),
    );
    expect(await cliente.buscarCampanha("projeto kids/1")).toEqual({
      id: "7",
      version: 2,
    });
    expect(chamadas[0].url).toBe(
      "https://api.rifei.com.br/raffles/projeto%20kids%2F1",
    );
    const cabecalhos = new Headers(chamadas[0].init.headers);
    expect(cabecalhos.get("Authorization")).toBe("Bearer token-x");
    expect(cabecalhos.get("x-rate-limit")).toBe("true");
  });

  it("401/403 = token_invalido; 429/5xx/rede/tempo = indisponivel; 404 da campanha; formato estranho", async () => {
    for (const [status, motivo] of [
      [401, "token_invalido"],
      [403, "token_invalido"],
      [429, "indisponivel"],
      [502, "indisponivel"],
    ] as const) {
      const { cliente } = clienteCom(() => json(status, {}));
      await expect(cliente.buscarCampanha("x")).rejects.toMatchObject({
        motivo,
      });
    }
    await expect(
      clienteCom(() => json(404, {})).cliente.buscarCampanha("x"),
    ).rejects.toMatchObject({ motivo: "campanha_nao_encontrada" });
    await expect(
      clienteCom(() => json(200, { sem: "id" })).cliente.buscarCampanha("x"),
    ).rejects.toMatchObject({ motivo: "resposta_inesperada" });
    await expect(
      clienteCom(() => {
        throw new TypeError("rede caiu");
      }).cliente.listarAfiliados(),
    ).rejects.toMatchObject({ motivo: "indisponivel" });
    await expect(
      clienteCom(
        (_url, init) =>
          new Promise((_, rejeitar) =>
            init.signal?.addEventListener("abort", () =>
              rejeitar(init.signal?.reason),
            ),
          ),
      ).cliente.listarAfiliados(),
    ).rejects.toBeInstanceOf(FalhaRifei);
  });

  it("aprovar usa o PUT em lote (que só aprova), um pedido por chamada", async () => {
    const { cliente, chamadas } = clienteCom(() => json(200, {}));
    expect(await cliente.aprovarPedido("ABC123")).toEqual({ tipo: "aprovado" });
    expect(chamadas[0].url).toBe(
      "https://api.rifei.com.br/raffles/orders/many",
    );
    expect(chamadas[0].init.method).toBe("PUT");
    expect(chamadas[0].init.body).toBe(JSON.stringify({ orders: ["ABC123"] }));
  });

  it("restaurar usa o prefixo v2/ só na campanha versão 2", async () => {
    const { cliente, chamadas } = clienteCom(() => json(200, {}));
    await cliente.restaurarExpirado({ id: "1", version: 1 }, "P1");
    await cliente.restaurarExpirado({ id: "1", version: 2 }, "P1");
    expect(chamadas.map((c) => c.url)).toEqual([
      "https://api.rifei.com.br/raffles/expired-orders/P1/restore",
      "https://api.rifei.com.br/v2/raffles/expired-orders/P1/restore",
    ]);
  });
});

describe("RIFA-091: vincularAfiliadoAoPedido (ligar a venda a um afiliado)", () => {
  it("PUT raffles/<raffleId>/orders/<pedido>/link-affiliate com { affiliate_id } e os cabeçalhos do painel", async () => {
    const { cliente, chamadas } = clienteCom((_url, init) =>
      json(200, {
        id: 1,
        affiliate_id: 1979669,
        code: "lider",
        affiliate: { id: 1979669, email: "a@example.com", name: "Nome" },
        corpo_recebido: init.body,
      }),
    );
    expect(
      await cliente.vincularAfiliadoAoPedido("1671784", "euzr/5wz", 1979669),
    ).toEqual({ tipo: "vinculado" });
    expect(chamadas).toHaveLength(1);
    const [chamada] = chamadas;
    expect(chamada.url).toBe(
      "https://api.rifei.com.br/raffles/1671784/orders/euzr%2F5wz/link-affiliate",
    );
    expect(chamada.init.method).toBe("PUT");
    // O corpo da captura do PO: Content-Length 24.
    expect(chamada.init.body).toBe('{"affiliate_id":1979669}');
    expect(String(chamada.init.body)).toHaveLength(24);
    const cabecalhos = new Headers(chamada.init.headers);
    expect(cabecalhos.get("Authorization")).toBe("Bearer token-x");
    expect(cabecalhos.get("x-rate-limit")).toBe("true");
    expect(cabecalhos.get("Content-Type")).toBe("application/json");
    expect(chamada.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("o affiliate_id da resposta pode vir como texto; outro afiliado ou sem ele: resposta_inesperada", async () => {
    expect(
      await clienteCom(() =>
        json(201, { affiliate_id: "77" }),
      ).cliente.vincularAfiliadoAoPedido("1", "P1", 77),
    ).toEqual({ tipo: "vinculado" });
    for (const corpo of [
      { affiliate_id: 78 },
      { id: 5 },
      null,
      [],
      { affiliate_id: "77a" },
    ])
      await expect(
        clienteCom(() => json(200, corpo)).cliente.vincularAfiliadoAoPedido(
          "1",
          "P1",
          77,
        ),
      ).rejects.toMatchObject({ motivo: "resposta_inesperada" });
  });

  it("outra resposta = recusado com a mensagem da Rifei cortada (ou null); 401/403/429/5xx/rede/tempo param", async () => {
    expect(
      await clienteCom(() =>
        json(422, { message: "  Pedido\n já tem afiliado " }),
      ).cliente.vincularAfiliadoAoPedido("1", "P1", 77),
    ).toEqual({ tipo: "recusado", mensagem: "Pedido já tem afiliado" });
    expect(
      await clienteCom(() => json(404, {})).cliente.vincularAfiliadoAoPedido(
        "1",
        "P1",
        77,
      ),
    ).toEqual({ tipo: "recusado", mensagem: null });
    const longa = await clienteCom(() =>
      json(400, { message: "x".repeat(900) }),
    ).cliente.vincularAfiliadoAoPedido("1", "P1", 77);
    expect(longa.tipo === "recusado" && longa.mensagem).toHaveLength(
      LIMITE_MENSAGEM_RIFEI,
    );
    for (const [status, motivo] of [
      [401, "token_invalido"],
      [403, "token_invalido"],
      [429, "indisponivel"],
      [500, "indisponivel"],
      [503, "indisponivel"],
    ] as const)
      await expect(
        clienteCom(() => json(status, {})).cliente.vincularAfiliadoAoPedido(
          "1",
          "P1",
          77,
        ),
      ).rejects.toMatchObject({ motivo });
    await expect(
      clienteCom(() => {
        throw new TypeError("rede caiu");
      }).cliente.vincularAfiliadoAoPedido("1", "P1", 77),
    ).rejects.toMatchObject({ motivo: "indisponivel" });
    // Tempo esgotado (o tempo limite do cliente nos testes é 50 ms).
    await expect(
      clienteCom(
        (_url, init) =>
          new Promise((_, rejeitar) =>
            init.signal?.addEventListener("abort", () =>
              rejeitar(init.signal?.reason),
            ),
          ),
      ).cliente.vincularAfiliadoAoPedido("1", "P1", 77),
    ).rejects.toMatchObject({ motivo: "indisponivel" });
  });
});

describe("marcarPedidoNaRifei", () => {
  it("a conferência sem o status aceita a aprovação; status de outro tipo vira recusa com o status", async () => {
    const semStatus = clienteCom((url) =>
      url.includes("/orders/P1") ? json(200, { outro: true }) : json(200, {}),
    );
    expect(
      await marcarPedidoNaRifei(
        semStatus.cliente,
        { id: "9", version: 1 },
        "P1",
      ),
    ).toEqual({ resultado: "marcado", mensagem: null });

    const reservado = clienteCom((url) =>
      url.includes("/orders/P1")
        ? json(200, { order: { status: "reserved" } })
        : json(200, {}),
    );
    expect(
      await marcarPedidoNaRifei(
        reservado.cliente,
        { id: "9", version: 1 },
        "P1",
      ),
    ).toEqual({
      resultado: "recusado_pela_rifei",
      mensagem: expect.stringContaining('"reserved"'),
    });
  });

  it("o token recusado no meio para tudo (não vira falha de um pedido)", async () => {
    const { cliente } = clienteCom(() => json(401, {}));
    await expect(
      marcarPedidoNaRifei(cliente, { id: "9", version: 1 }, "P1"),
    ).rejects.toMatchObject({ motivo: "token_invalido" });
  });
});

describe("mensagemDaRifei e emLotes", () => {
  it("a mensagem: message, errors[0].message, cortada; nada = null", () => {
    expect(mensagemDaRifei({ message: "  Pedido\n não encontrado " })).toBe(
      "Pedido não encontrado",
    );
    expect(mensagemDaRifei({ errors: [{ message: "Campo inválido" }] })).toBe(
      "Campo inválido",
    );
    expect(mensagemDaRifei({ message: "x".repeat(500) })).toHaveLength(
      LIMITE_MENSAGEM_RIFEI,
    );
    expect(mensagemDaRifei(null)).toBeNull();
    expect(mensagemDaRifei({ message: 42 })).toBeNull();
  });

  it("emLotes respeita o limite de paralelas e a ordem", async () => {
    let ativas = 0;
    let maximo = 0;
    const resultado = await emLotes([5, 1, 4, 2, 3], 2, async (n) => {
      ativas += 1;
      maximo = Math.max(maximo, ativas);
      await new Promise((r) => setTimeout(r, n));
      ativas -= 1;
      return n * 10;
    });
    expect(resultado).toEqual([50, 10, 40, 20, 30]);
    expect(maximo).toBe(2);
  });
});
