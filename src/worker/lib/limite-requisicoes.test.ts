// RIFA-013b, item 7 (unidade): a chave do cliente, a janela na memória do isolate (quando o binding falta),
// o uso do binding e a resposta 429. A integração com o binding do wrangler.jsonc está em
// src/worker/routes/limite-requisicoes.test.ts.
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { erroApiSchema } from "../../shared/contracts";
import {
  LIMITE_LOGIN,
  LIMITE_PUBLICO,
  MAXIMO_CHAVES_NA_MEMORIA,
  chaveDoCliente,
  criarLimitadorNaMemoria,
  dentroDoLimite,
  limitarRequisicoes,
  type RegraDeLimite,
} from "./limite-requisicoes";

const comIp = (ip: string | null) =>
  new Request("http://localhost/api/publico/ranking", {
    headers: ip === null ? {} : { "CF-Connecting-IP": ip },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chaveDoCliente: o IP do CF-Connecting-IP", () => {
  it("IPv4 inteiro; sem o cabeçalho (ou vazio), sem chave", () => {
    expect(chaveDoCliente(comIp("203.0.113.7"))).toBe("ipv4:203.0.113.7");
    expect(chaveDoCliente(comIp(" 203.0.113.7 "))).toBe("ipv4:203.0.113.7");
    expect(chaveDoCliente(comIp(null))).toBeNull();
    expect(chaveDoCliente(comIp(""))).toBeNull();
  });

  it("IPv6 pelo /64: mesmo prefixo, mesma chave, escrito por extenso ou abreviado, em qualquer caixa", () => {
    const chave = "ipv6:2001:db8:a:b::/64";
    for (const ip of [
      "2001:db8:a:b::1",
      "2001:0db8:000a:000b:ffff:ffff:ffff:ffff",
      "2001:DB8:A:B:1:2:3:4",
      "2001:db8:a:b::1%eth0",
    ])
      expect({ ip, chave: chaveDoCliente(comIp(ip)) }).toEqual({ ip, chave });
    expect(chaveDoCliente(comIp("2001:db8:a:c::1"))).toBe(
      "ipv6:2001:db8:a:c::/64",
    );
    expect(chaveDoCliente(comIp("::1"))).toBe("ipv6:0:0:0:0::/64");
    expect(chaveDoCliente(comIp("2001:db8::"))).toBe("ipv6:2001:db8:0:0::/64");
  });

  it("IPv4 escrito como IPv6 (::ffff:a.b.c.d) é o IPv4, e não um /64 de todos", () => {
    expect(chaveDoCliente(comIp("::ffff:203.0.113.7"))).toBe(
      "ipv4:203.0.113.7",
    );
    expect(chaveDoCliente(comIp("::FFFF:198.51.100.1"))).toBe(
      "ipv4:198.51.100.1",
    );
  });

  it("valor que não é IP vira uma chave só ('invalido'): não abre uma porta sem limite", () => {
    for (const lixo of [
      "abc",
      "1:2:3:4:5:6:7:8:9",
      "zzzz::1",
      "1::2::3",
      "999",
    ])
      expect({ lixo, chave: chaveDoCliente(comIp(lixo)) }).toEqual({
        lixo,
        chave: "invalido",
      });
  });
});

describe("janela fixa na memória do isolate (sem o binding)", () => {
  const regra: RegraDeLimite = {
    binding: "LIMITE_LOGIN",
    limite: 3,
    periodoSegundos: 60,
  };
  const inicioDaJanela = 1_800_000_000_000 - (1_800_000_000_000 % 60_000);

  it("conta até o limite na janela; na janela seguinte, recomeça", () => {
    const memoria = criarLimitadorNaMemoria();
    const permitir = (ms: number) =>
      memoria.permitir(regra, "ipv4:1.2.3.4", ms);

    expect([1, 2, 3, 4].map(() => permitir(inicioDaJanela + 10))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    // Ainda na mesma janela (último milissegundo): recusa.
    expect(permitir(inicioDaJanela + 59_999)).toBe(false);
    // Janela nova: recomeça a contar.
    expect(permitir(inicioDaJanela + 60_000)).toBe(true);
  });

  it("cada chave e cada regra contam à parte", () => {
    const memoria = criarLimitadorNaMemoria();
    for (let vez = 0; vez < regra.limite; vez++)
      memoria.permitir(regra, "ipv4:1.1.1.1", inicioDaJanela);

    expect(memoria.permitir(regra, "ipv4:1.1.1.1", inicioDaJanela)).toBe(false);
    expect(memoria.permitir(regra, "ipv4:2.2.2.2", inicioDaJanela)).toBe(true);
    expect(
      memoria.permitir(
        { ...regra, binding: "LIMITE_PUBLICO" },
        "ipv4:1.1.1.1",
        inicioDaJanela,
      ),
    ).toBe(true);
  });

  it("com muitas chaves, as janelas velhas saem e o limite das chaves da janela atual continua valendo", () => {
    const memoria = criarLimitadorNaMemoria();
    for (let i = 0; i < MAXIMO_CHAVES_NA_MEMORIA; i++)
      memoria.permitir(regra, `velha-${i}`, inicioDaJanela - 60_000);
    for (let vez = 0; vez < regra.limite; vez++)
      memoria.permitir(regra, "atual", inicioDaJanela);

    // A chave nova da janela atual entra (as velhas foram apagadas) e a "atual" segue no limite.
    expect(memoria.permitir(regra, "nova", inicioDaJanela)).toBe(true);
    expect(memoria.permitir(regra, "atual", inicioDaJanela)).toBe(false);
  });
});

describe("dentroDoLimite: binding quando existe, memória quando falta", () => {
  it("com o binding, pergunta a ele pela chave do cliente", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env = { LIMITE_LOGIN: { limit } } as unknown as Cloudflare.Env;

    await expect(
      dentroDoLimite(env, comIp("2001:db8:1:2::9"), LIMITE_LOGIN),
    ).resolves.toBe(false);
    expect(limit).toHaveBeenCalledExactlyOnceWith({
      key: "ipv6:2001:db8:1:2::/64",
    });
  });

  it("sem IP, nem pergunta: segue sem limite", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env = { LIMITE_PUBLICO: { limit } } as unknown as Cloudflare.Env;

    await expect(
      dentroDoLimite(env, comIp(null), LIMITE_PUBLICO),
    ).resolves.toBe(true);
    expect(limit).not.toHaveBeenCalled();
  });

  it("falha do binding vai para o log e deixa passar (o limite nunca derruba o site)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const env = {
      LIMITE_LOGIN: {
        limit: async () => {
          throw new Error("binding fora do ar");
        },
      },
    } as unknown as Cloudflare.Env;

    await expect(
      dentroDoLimite(env, comIp("203.0.113.9"), LIMITE_LOGIN),
    ).resolves.toBe(true);
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("sem o binding, usa a janela na memória com a regra", async () => {
    const memoria = criarLimitadorNaMemoria();
    const env = {} as Cloudflare.Env;
    const regra: RegraDeLimite = { ...LIMITE_LOGIN, limite: 2 };
    const resultados = [];
    for (let vez = 0; vez < 3; vez++)
      resultados.push(
        await dentroDoLimite(env, comIp("203.0.113.10"), regra, memoria),
      );

    expect(resultados).toEqual([true, true, false]);
  });
});

describe("limitarRequisicoes: 429 no formato único", () => {
  it("acima do limite, 429 com Retry-After do período e no-store; antes dele, a rota responde", async () => {
    const env = {
      LIMITE_LOGIN: { limit: vi.fn(async () => ({ success: false })) },
    } as unknown as Cloudflare.Env;
    const app = new Hono<{ Bindings: Cloudflare.Env }>();
    app.post("/", limitarRequisicoes(LIMITE_LOGIN), (c) => c.text("ok"));

    const res = await app.request(
      "/",
      { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.11" } },
      env,
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(erroApiSchema.parse(await res.json())).toEqual({
      erro: {
        codigo: "muitas_requisicoes",
        mensagem:
          "Muitas requisições em pouco tempo: espere um minuto e tente de novo",
      },
    });

    const liberado = await app.request(
      "/",
      { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.11" } },
      {
        LIMITE_LOGIN: { limit: async () => ({ success: true }) },
      } as unknown as Cloudflare.Env,
    );
    expect(await liberado.text()).toBe("ok");
  });

  it("as regras batem com o pedido: 60/min nas idas ao banco do público e 60/min no login (D12; eram 10)", () => {
    expect(LIMITE_PUBLICO).toEqual({
      binding: "LIMITE_PUBLICO",
      limite: 60,
      periodoSegundos: 60,
    });
    expect(LIMITE_LOGIN).toEqual({
      binding: "LIMITE_LOGIN",
      limite: 60,
      periodoSegundos: 60,
    });
  });
});
