// RIFA-086 (D40): o saldo da Efí com o binding mTLS SIMULADO (nenhuma chamada real à Efí): o token guardado até vencer,
// o saldo em centavos, as falhas viram "indisponível" e nada de segredo ou token nos logs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_SALDO_EFI_MS,
  respostaSaldoEfiSchema,
} from "../../shared/contracts";
import {
  FOLGA_TOKEN_EFI_MS,
  TEMPO_LIMITE_EFI_MS,
  URL_SALDO_EFI,
  URL_TOKEN_EFI,
  consultarSaldoEfi,
  esquecerEfi,
  saldoEmCentavos,
  type AmbienteEfi,
} from "./efi";

const CLIENT_ID = "Client_Id_ficticio_0123456789";
const CLIENT_SECRET = "Client_Secret_ficticio_abcdefghij";
const TOKEN = "token-de-acesso-ficticio-xyz";
const INICIO = Date.parse("2026-11-24T10:00:00.000Z");

type Resposta = { status: number; corpo: unknown } | Error;

/** Um binding mTLS falso: responde pela URL, na ordem das respostas dadas; guarda cada chamada. */
function efiFalsa(respostas: {
  token?: readonly Resposta[];
  saldo?: readonly Resposta[];
}) {
  const filas = {
    token: [...(respostas.token ?? [])],
    saldo: [...(respostas.saldo ?? [])],
  };
  const chamadas: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(
    async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(entrada);
      chamadas.push({ url, init });
      const fila = url === URL_TOKEN_EFI ? filas.token : filas.saldo;
      const resposta = fila.shift();
      if (resposta === undefined) throw new Error(`chamada inesperada: ${url}`);
      if (resposta instanceof Error) throw resposta;
      return new Response(
        typeof resposta.corpo === "string"
          ? resposta.corpo
          : JSON.stringify(resposta.corpo),
        { status: resposta.status },
      );
    },
  );
  const env: AmbienteEfi = {
    EFI_CERT: { fetch } as unknown as Fetcher,
    EFI_CLIENT_ID: CLIENT_ID,
    EFI_CLIENT_SECRET: CLIENT_SECRET,
  };
  return { env, fetch, chamadas };
}

const TOKEN_OK: Resposta = {
  status: 200,
  corpo: {
    access_token: TOKEN,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "gn.balance.read",
  },
};
const saldo = (valor: unknown): Resposta => ({
  status: 200,
  corpo: { saldo: valor },
});

let avisos: unknown[][];
const relogio = (ms: number) => ({
  agora: () => ms,
  avisar: (...args: unknown[]) => {
    avisos.push(args);
  },
});

beforeEach(() => {
  esquecerEfi();
  avisos = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consultarSaldoEfi", () => {
  it("sem o certificado ou sem os segredos: não configurado, sem chamada nenhuma", async () => {
    const { env, fetch } = efiFalsa({});
    for (const incompleto of [
      { ...env, EFI_CERT: undefined },
      { ...env, EFI_CLIENT_ID: undefined },
      { ...env, EFI_CLIENT_SECRET: "  " },
      {},
    ])
      expect(await consultarSaldoEfi(incompleto, relogio(INICIO))).toEqual({
        configurado: false,
        saldo_centavos: null,
        consultado_em: "2026-11-24T10:00:00.000Z",
      });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("token com Basic base64(client_id:client_secret) e o corpo da doc; saldo com o Bearer, convertido em centavos", async () => {
    const { env, chamadas } = efiFalsa({
      token: [TOKEN_OK],
      saldo: [saldo("12345.67")],
    });

    const resposta = await consultarSaldoEfi(env, relogio(INICIO));

    expect(resposta).toEqual({
      configurado: true,
      saldo_centavos: 1_234_567,
      consultado_em: "2026-11-24T10:00:00.000Z",
    });
    expect(respostaSaldoEfiSchema.parse(resposta)).toEqual(resposta);
    expect(chamadas.map((chamada) => chamada.url)).toEqual([
      URL_TOKEN_EFI,
      URL_SALDO_EFI,
    ]);
    const [token, consulta] = chamadas;
    expect(token.init.method).toBe("POST");
    expect(new Headers(token.init.headers).get("Authorization")).toBe(
      `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
    );
    expect(new Headers(token.init.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(token.init.body))).toEqual({
      grant_type: "client_credentials",
    });
    expect(consulta.init.method ?? "GET").toBe("GET");
    expect(new Headers(consulta.init.headers).get("Authorization")).toBe(
      `Bearer ${TOKEN}`,
    );
    // Tempo curto em toda chamada.
    for (const chamada of chamadas)
      expect(chamada.init.signal).toBeInstanceOf(AbortSignal);
    expect(TEMPO_LIMITE_EFI_MS).toBeLessThanOrEqual(10_000);
  });

  it("o saldo vale ~60 s: dentro disso, nenhuma chamada; depois, o saldo de novo com o MESMO token (guardado até vencer)", async () => {
    const { env, chamadas } = efiFalsa({
      token: [TOKEN_OK, TOKEN_OK],
      saldo: [saldo("10.00"), saldo("20.00"), saldo("30.00")],
    });

    await consultarSaldoEfi(env, relogio(INICIO));
    const doCache = await consultarSaldoEfi(
      env,
      relogio(INICIO + CACHE_SALDO_EFI_MS - 1),
    );
    const depois = await consultarSaldoEfi(
      env,
      relogio(INICIO + CACHE_SALDO_EFI_MS),
    );

    expect(doCache.saldo_centavos).toBe(1000);
    expect(doCache.consultado_em).toBe("2026-11-24T10:00:00.000Z");
    expect(depois.saldo_centavos).toBe(2000);
    expect(chamadas.map((chamada) => chamada.url)).toEqual([
      URL_TOKEN_EFI,
      URL_SALDO_EFI,
      URL_SALDO_EFI,
    ]);

    // O token vence em 3600 s menos a folga: aí vem um token novo.
    const vencido = INICIO + 3_600_000 - FOLGA_TOKEN_EFI_MS;
    expect(
      (await consultarSaldoEfi(env, relogio(vencido))).saldo_centavos,
    ).toBe(3000);
    expect(chamadas.map((chamada) => chamada.url).slice(3)).toEqual([
      URL_TOKEN_EFI,
      URL_SALDO_EFI,
    ]);
  });

  it.each([
    [
      "token recusado (401)",
      { token: [{ status: 401, corpo: {} }] },
      "autenticacao",
    ],
    [
      "token sem access_token",
      { token: [{ status: 200, corpo: { token_type: "Bearer" } }] },
      "resposta_invalida",
    ],
    [
      "saldo com erro da Efí (500)",
      { token: [TOKEN_OK], saldo: [{ status: 500, corpo: "erro" }] },
      "consulta",
    ],
    [
      "saldo recusado (403: sem o escopo gn.balance.read)",
      { token: [TOKEN_OK], saldo: [{ status: 403, corpo: {} }] },
      "autenticacao",
    ],
    [
      "saldo fora do formato",
      { token: [TOKEN_OK], saldo: [saldo(1234.5)] },
      "resposta_invalida",
    ],
    [
      "saldo que não é JSON",
      { token: [TOKEN_OK], saldo: [{ status: 200, corpo: "<html>" }] },
      "resposta_invalida",
    ],
    [
      "tempo esgotado no token",
      {
        token: [new DOMException("tempo", "TimeoutError")],
      },
      "tempo_esgotado",
    ],
    [
      "conexão caída no saldo",
      { token: [TOKEN_OK], saldo: [new TypeError("Network connection lost")] },
      "consulta",
    ],
  ] as const)(
    "%s: indisponível, com o erro, sem lançar",
    async (_caso, respostas, erro) => {
      const { env } = efiFalsa(respostas);

      const resposta = await consultarSaldoEfi(env, relogio(INICIO));

      expect(resposta).toEqual({
        configurado: true,
        saldo_centavos: null,
        consultado_em: "2026-11-24T10:00:00.000Z",
        erro,
      });
      expect(respostaSaldoEfiSchema.parse(resposta)).toEqual(resposta);
      expect(avisos).toHaveLength(1);
    },
  );

  it("a Efí recusou o token na consulta: o token guardado é descartado e a próxima consulta pede outro", async () => {
    const { env, chamadas } = efiFalsa({
      token: [TOKEN_OK, TOKEN_OK],
      saldo: [{ status: 401, corpo: {} }, saldo("5.00")],
    });

    expect((await consultarSaldoEfi(env, relogio(INICIO))).erro).toBe(
      "autenticacao",
    );
    expect(
      (await consultarSaldoEfi(env, relogio(INICIO + CACHE_SALDO_EFI_MS)))
        .saldo_centavos,
    ).toBe(500);
    expect(chamadas.map((chamada) => chamada.url)).toEqual([
      URL_TOKEN_EFI,
      URL_SALDO_EFI,
      URL_TOKEN_EFI,
      URL_SALDO_EFI,
    ]);
  });

  it("nada de segredo, token ou corpo da Efí nos logs (só o passo, o erro e o status)", async () => {
    const console_ = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "debug"),
    ];
    const casos: Parameters<typeof efiFalsa>[0][] = [
      { token: [{ status: 401, corpo: { erro: CLIENT_SECRET } }] },
      { token: [TOKEN_OK], saldo: [{ status: 500, corpo: TOKEN }] },
      { token: [TOKEN_OK], saldo: [new Error(`falhou com ${TOKEN}`)] },
    ];
    for (const caso of casos) {
      esquecerEfi();
      const { env } = efiFalsa(caso);
      // Sem o `avisar` dos testes: vai para o console de verdade.
      const resposta = await consultarSaldoEfi(env, { agora: () => INICIO });
      expect(JSON.stringify(resposta)).not.toMatch(
        new RegExp(`${CLIENT_ID}|${CLIENT_SECRET}|${TOKEN}`),
      );
    }
    const registrado = JSON.stringify(
      console_.flatMap((espiao) => espiao.mock.calls),
    );
    expect(registrado).toContain("Efí: saldo indisponível");
    for (const segredo of [
      CLIENT_ID,
      CLIENT_SECRET,
      TOKEN,
      btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
    ])
      expect(registrado).not.toContain(segredo);
    expect(console_[1].mock.calls).toEqual([
      [
        "Efí: saldo indisponível",
        { passo: "token", erro: "autenticacao", status: 401 },
      ],
      [
        "Efí: saldo indisponível",
        { passo: "saldo", erro: "consulta", status: 500 },
      ],
      [
        "Efí: saldo indisponível",
        { passo: "saldo", erro: "consulta", status: null },
      ],
    ]);
  });
});

describe("saldoEmCentavos", () => {
  it("texto com ponto da Efí → centavos, sem ponto flutuante; o resto, null", () => {
    expect(
      ["100.00", "0.5", "0.05", "100", "1234567.89", "-3.10", "0.00"].map(
        saldoEmCentavos,
      ),
    ).toEqual([10_000, 50, 5, 10_000, 123_456_789, -310, 0]);
    for (const invalido of [
      "1,00",
      "abc",
      "",
      "1.234",
      "1e3",
      100,
      null,
      undefined,
    ])
      expect({ invalido, centavos: saldoEmCentavos(invalido) }).toEqual({
        invalido,
        centavos: null,
      });
  });
});
