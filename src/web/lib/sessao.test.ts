// Para onde voltar depois de entrar (guarda da área → /entrar → link pessoal): só caminhos das áreas com
// sessão (/coordenacao e /minha), uma vez só e por uma hora, e só na área do papel de quem entrou; e o
// `state` de /entrar, que vem do histórico, é conferido.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VALIDADE_DESTINO_MS,
  destinoDoPapel,
  destinoSeguro,
  esquecerDestino,
  guardarDestino,
  lerEstadoEntrar,
  retirarDestino,
} from "./sessao";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("destinoSeguro", () => {
  it.each([
    "/coordenacao",
    "/coordenacao/",
    "/coordenacao/pedidos",
    "/coordenacao/acessos",
    "/coordenacao/pedidos?pagina=2&celula=10",
    "/minha",
    "/minha?periodo=campanha",
  ])("aceita %s", (caminho) => {
    expect(destinoSeguro(caminho)).toBe(caminho);
  });

  it.each([
    "https://site-malicioso.example/coordenacao",
    "//site-malicioso.example/coordenacao",
    "/coordenacao//site-malicioso.example",
    "/\\site-malicioso.example",
    "javascript:alert(1)",
    "%2F%2Fsite-malicioso.example",
    "/coordenacao/%2F%2Fsite-malicioso.example",
    "/coordenacao/../entrar",
    "/coordenacaox",
    "/entrar",
    "/acesso/abc",
    "/",
    "",
    "coordenacao",
    "/coordenacao#topo",
    "/minhax",
    "/minha//site-malicioso.example",
    "/minha/../coordenacao",
    "/minha#topo",
    "https://site-malicioso.example/minha",
  ])("recusa %j", (caminho) => {
    expect(destinoSeguro(caminho)).toBeNull();
  });

  it("recusa o que não é texto", () => {
    for (const valor of [null, undefined, 1, {}, ["/coordenacao"]]) {
      expect(destinoSeguro(valor)).toBeNull();
    }
  });
});

describe("destino guardado", () => {
  it("vale uma vez só: retirar devolve e apaga", () => {
    guardarDestino("/coordenacao/hierarquia");

    expect(retirarDestino()).toBe("/coordenacao/hierarquia");
    expect(retirarDestino()).toBeNull();
  });

  it("vence depois de uma hora", () => {
    vi.useFakeTimers({ now: new Date("2026-11-10T22:00:00.000Z") });
    guardarDestino("/coordenacao/adesao");
    vi.setSystemTime(Date.now() + VALIDADE_DESTINO_MS - 1);
    expect(retirarDestino()).toBe("/coordenacao/adesao");

    guardarDestino("/coordenacao/adesao");
    vi.setSystemTime(Date.now() + VALIDADE_DESTINO_MS);
    expect(retirarDestino()).toBeNull();
  });

  it("não guarda caminho de fora da coordenação e ignora o que foi gravado à mão", () => {
    guardarDestino("//site-malicioso.example");
    expect(retirarDestino()).toBeNull();

    localStorage.setItem(
      "rifa-videira-kids:voltar-para",
      JSON.stringify({ caminho: "https://x.example", ate: Date.now() + 1000 }),
    );
    expect(retirarDestino()).toBeNull();
    localStorage.setItem("rifa-videira-kids:voltar-para", "{não é json");
    expect(retirarDestino()).toBeNull();
  });

  it("esquecerDestino apaga", () => {
    guardarDestino("/coordenacao/pedidos");
    esquecerDestino();
    expect(retirarDestino()).toBeNull();
  });

  it("com o armazenamento bloqueado, nada quebra (só não volta para a tela)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });

    expect(() => guardarDestino("/coordenacao/pedidos")).not.toThrow();
    expect(retirarDestino()).toBeNull();
    expect(() => esquecerDestino()).not.toThrow();
  });
});

describe("destinoDoPapel: o destino só vale na área do papel", () => {
  it.each([
    ["/coordenacao/pedidos", "admin", "/coordenacao/pedidos"],
    ["/coordenacao/pedidos", "coordenacao", "/coordenacao/pedidos"],
    ["/minha", "lider", "/minha"],
    ["/minha?periodo=campanha", "rede", "/minha?periodo=campanha"],
    // Da outra área: o início da área do papel.
    ["/coordenacao/pedidos", "lider", "/minha"],
    ["/coordenacao", "discipulador", "/minha"],
    ["/minha", "coordenacao", "/coordenacao"],
    ["/minha", "admin", "/coordenacao"],
    // Sem destino ou fora das áreas: o início.
    [null, "admin", "/coordenacao"],
    [undefined, "rede", "/minha"],
    ["//site-malicioso.example", "lider", "/minha"],
    ["/entrar", "coordenacao", "/coordenacao"],
  ] as const)("%j para %s vai a %s", (destino, papel, esperado) => {
    expect(destinoDoPapel(destino, papel)).toBe(esperado);
  });

  it("o destino da visão individual é guardado e retirado como o da coordenação", () => {
    guardarDestino("/minha");
    expect(retirarDestino()).toBe("/minha");
    expect(retirarDestino()).toBeNull();
  });
});

describe("lerEstadoEntrar (state de /entrar, vindo do histórico)", () => {
  it("lê o destino e o motivo válidos", () => {
    expect(
      lerEstadoEntrar({ de: "/coordenacao/pedidos", motivo: "expirou" }),
    ).toEqual({ de: "/coordenacao/pedidos", motivo: "expirou" });
    expect(lerEstadoEntrar({ de: "/minha", motivo: "sem_sessao" })).toEqual({
      de: "/minha",
      motivo: "sem_sessao",
    });
    expect(lerEstadoEntrar({ motivo: "saiu" })).toEqual({ motivo: "saiu" });
  });

  it("descarta destino de fora da coordenação, motivo desconhecido e state que não é objeto", () => {
    expect(
      lerEstadoEntrar({ de: "https://x.example", motivo: "qualquer" }),
    ).toEqual({});
    for (const state of [null, undefined, "texto", 3]) {
      expect(lerEstadoEntrar(state)).toEqual({});
    }
  });
});
