// RIFA-095 (D43): o Web Push sem biblioteca, no workerd. A cifra `aes128gcm` contra o exemplo da RFC 8291 (seção 5 e
// apêndice A), a ida e volta com um aparelho fictício, o JWT ES256 do VAPID (RFC 8292) conferido com a chave pública,
// as chaves do ambiente e o envio para um serviço de push falso (nenhuma requisição sai do teste).
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import {
  ambienteComVapid,
  criarAparelho,
  decifrarAes128gcm,
  gerarChavesVapid,
  servicoDePushFalso,
} from "../test/push-apoio";
import {
  SUB_VAPID_PADRAO,
  VALIDADE_JWT_VAPID_SEGUNDOS,
  assinarJwtVapid,
  base64UrlParaBytes,
  bytesParaBase64Url,
  chavesVapidDoAmbiente,
  cifrarAes128gcm,
  enviarPush,
  importarChavePrivada,
  type ContextoDoEnvio,
} from "./web-push";

/** O exemplo da RFC 8291 (seção 5; os valores intermediários no apêndice A). */
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  // Seção 5: o corpo do push (cabeçalho de 86 bytes + o conteúdo cifrado).
  corpo:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  // Apêndice A: o cabeçalho e o conteúdo cifrado, separados.
  cabecalho:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  cifrado:
    "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
} as const;

/** O par ECDH do servidor do exemplo (privada pelo JWK, pública crua). */
async function parDoExemplo(): Promise<CryptoKeyPair> {
  return {
    privateKey: await importarChavePrivada(RFC.asPublic, RFC.asPrivate, "ECDH"),
    publicKey: await crypto.subtle.importKey(
      "raw",
      base64UrlParaBytes(RFC.asPublic),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    ),
  };
}

describe("base64url", () => {
  it("ida e volta, com e sem `=`", () => {
    const bytes = Uint8Array.from([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(bytesParaBase64Url(bytes)).toBe("AAH6-_z9_v8");
    expect([...base64UrlParaBytes("AAH6-_z9_v8")]).toEqual([...bytes]);
    expect([...base64UrlParaBytes("AAH6-_z9_v8=")]).toEqual([...bytes]);
  });
});

describe("aes128gcm (RFC 8291)", () => {
  it("com o par e o sal do exemplo, o corpo é o da RFC, byte a byte", async () => {
    const corpo = await cifrarAes128gcm(
      new TextEncoder().encode(RFC.plaintext),
      RFC.uaPublic,
      RFC.authSecret,
      { par: await parDoExemplo(), sal: base64UrlParaBytes(RFC.salt) },
    );
    expect(bytesParaBase64Url(corpo)).toBe(RFC.corpo);
    // O apêndice A, em partes: o cabeçalho de 86 bytes (sal, rs = 4096, idlen = 65, a pública) e o cifrado.
    expect(corpo.length).toBe(86 + base64UrlParaBytes(RFC.cifrado).length);
    expect(bytesParaBase64Url(corpo.subarray(0, 86))).toBe(RFC.cabecalho);
    expect(bytesParaBase64Url(corpo.subarray(86))).toBe(RFC.cifrado);
  });

  it("o aparelho do exemplo (a chave privada dele) decifra o texto", async () => {
    const corpo = await cifrarAes128gcm(
      new TextEncoder().encode(RFC.plaintext),
      RFC.uaPublic,
      RFC.authSecret,
    );
    const privada = await importarChavePrivada(
      RFC.uaPublic,
      RFC.uaPrivate,
      "ECDH",
    );
    expect(
      await decifrarAes128gcm(
        corpo,
        privada,
        base64UrlParaBytes(RFC.uaPublic),
        base64UrlParaBytes(RFC.authSecret),
      ),
    ).toBe(RFC.plaintext);
  });

  it("par e sal novos a cada mensagem: dois corpos do mesmo texto são diferentes, e os dois decifram", async () => {
    const aparelho = await criarAparelho();
    const conteudo = new TextEncoder().encode(
      "🎟️ A célula Betel vendeu 3 bilhetes!",
    );
    const um = await cifrarAes128gcm(conteudo, aparelho.p256dh, aparelho.auth);
    const outro = await cifrarAes128gcm(
      conteudo,
      aparelho.p256dh,
      aparelho.auth,
    );
    expect(bytesParaBase64Url(um.subarray(0, 16))).not.toBe(
      bytesParaBase64Url(outro.subarray(0, 16)),
    );
    expect(bytesParaBase64Url(um.subarray(21, 86))).not.toBe(
      bytesParaBase64Url(outro.subarray(21, 86)),
    );
    expect(await aparelho.ler(um)).toBe("🎟️ A célula Betel vendeu 3 bilhetes!");
    expect(await aparelho.ler(outro)).toBe(
      "🎟️ A célula Betel vendeu 3 bilhetes!",
    );
  });

  it("recusa o conteúdo que não cabe num registro de 4096 bytes", async () => {
    const aparelho = await criarAparelho();
    await expect(
      cifrarAes128gcm(new Uint8Array(4080), aparelho.p256dh, aparelho.auth),
    ).rejects.toThrow(RangeError);
  });
});

describe("VAPID (RFC 8292)", () => {
  it("o JWT ES256 tem o cabeçalho, o aud, o exp em 12 h e o sub, e confere com a chave pública", async () => {
    const { publica, privada } = await gerarChavesVapid();
    const agora = new Date("2026-11-27T15:00:00.000Z");
    const jwt = await assinarJwtVapid(
      await importarChavePrivada(publica, privada, "ECDSA"),
      { aud: "https://fcm.googleapis.com", sub: SUB_VAPID_PADRAO, agora },
    );
    const [cabecalho, claims, assinatura] = jwt.split(".");
    const ler = (parte: string) =>
      JSON.parse(
        new TextDecoder().decode(base64UrlParaBytes(parte)),
      ) as unknown;
    expect(ler(cabecalho)).toEqual({ typ: "JWT", alg: "ES256" });
    expect(ler(claims)).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: agora.getTime() / 1000 + VALIDADE_JWT_VAPID_SEGUNDOS,
      sub: "https://projetokidsbelem.com.br",
    });
    expect(VALIDADE_JWT_VAPID_SEGUNDOS).toBeLessThanOrEqual(24 * 60 * 60);
    expect(base64UrlParaBytes(assinatura)).toHaveLength(64);
    const chavePublica = await crypto.subtle.importKey(
      "raw",
      base64UrlParaBytes(publica),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        chavePublica,
        base64UrlParaBytes(assinatura),
        new TextEncoder().encode(`${cabecalho}.${claims}`),
      ),
    ).toBe(true);
  });

  it("as chaves do ambiente: sem uma delas, vazia ou fora do formato, o recurso fica desligado", async () => {
    const { publica, privada } = await gerarChavesVapid();
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    // O env dos testes tem a pública do wrangler.jsonc (vazia = desligado, ou a de produção: não é segredo) e nunca a
    // privada (o vitest.config.ts a força vazia, mesmo com um .dev.vars): o recurso fica desligado.
    expect(env.VAPID_PUBLIC_KEY).toMatch(/^(|B[A-Za-z0-9_-]{86})$/);
    expect(env.VAPID_PRIVATE_KEY ?? "").toBe("");
    expect(chavesVapidDoAmbiente(env)).toBeNull();
    for (const [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] of [
      [publica, undefined],
      [undefined, privada],
      ["", privada],
      [publica, "  "],
    ])
      expect(
        chavesVapidDoAmbiente({ ...env, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY }),
      ).toBeNull();
    expect(erro).not.toHaveBeenCalled();
    expect(
      chavesVapidDoAmbiente({
        ...env,
        VAPID_PUBLIC_KEY: publica.slice(1),
        VAPID_PRIVATE_KEY: privada,
      }),
    ).toBeNull();
    // O aviso não leva o valor.
    expect(JSON.stringify(erro.mock.calls)).not.toContain(privada);
    expect(
      chavesVapidDoAmbiente({
        ...env,
        VAPID_PUBLIC_KEY: ` ${publica} `,
        VAPID_PRIVATE_KEY: privada,
        VAPID_SUBJECT: undefined,
      }),
    ).toEqual({ publica, privada, sub: SUB_VAPID_PADRAO });
    erro.mockRestore();
  });
});

describe("enviarPush", () => {
  async function contexto(buscar: typeof fetch): Promise<ContextoDoEnvio> {
    const ambiente = await ambienteComVapid(env);
    const chaves = chavesVapidDoAmbiente(ambiente)!;
    return {
      chaves,
      chaveVapid: await importarChavePrivada(
        chaves.publica,
        chaves.privada,
        "ECDSA",
      ),
      jwts: new Map(),
      ttlSegundos: 3600,
      tempoLimiteMs: 50,
      agora: new Date("2026-11-27T15:00:00.000Z"),
      fetch: buscar,
    };
  }

  it("POST cifrado com os cabeçalhos do Web Push; o aparelho lê o conteúdo; um JWT por serviço", async () => {
    const servico = servicoDePushFalso();
    const ctx = await contexto(servico.buscar);
    const fcm = await criarAparelho();
    const outroFcm = await criarAparelho();
    const mozilla = await criarAparelho("updates.push.services.mozilla.com");
    const conteudo = new TextEncoder().encode('{"titulo":"x"}');
    for (const aparelho of [fcm, outroFcm, mozilla])
      expect(await enviarPush(aparelho, conteudo, ctx)).toBe("aceito");
    expect(servico.recebidos.map((r) => r.endpoint)).toEqual([
      fcm.endpoint,
      outroFcm.endpoint,
      mozilla.endpoint,
    ]);
    const [primeiro] = servico.recebidos;
    expect(Object.fromEntries(primeiro.cabecalhos)).toEqual({
      authorization: expect.stringMatching(
        new RegExp(
          `^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${ctx.chaves.publica}$`,
        ),
      ),
      ttl: "3600",
      urgency: "normal",
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
    });
    expect(await fcm.ler(primeiro.corpo)).toBe('{"titulo":"x"}');
    // Os dois do FCM usam o mesmo JWT (aud = a origem do serviço); o da Mozilla, outro.
    expect([...ctx.jwts.keys()]).toEqual([
      "https://fcm.googleapis.com",
      "https://updates.push.services.mozilla.com",
    ]);
    const autorizacao = (indice: number) =>
      servico.recebidos[indice].cabecalhos.get("Authorization");
    expect(autorizacao(1)).toBe(autorizacao(0));
    expect(autorizacao(2)).not.toBe(autorizacao(0));
  });

  it.each([
    [201, "aceito"],
    [200, "aceito"],
    [202, "aceito"],
    [404, "expirado"],
    [410, "expirado"],
    [400, "falhou"],
    [403, "falhou"],
    [413, "falhou"],
    [429, "falhou"],
    [500, "falhou"],
    [503, "falhou"],
    [301, "falhou"],
  ] as const)("o serviço responde %i: %s", async (status, esperado) => {
    const servico = servicoDePushFalso(
      () => new Response("corpo do serviço", { status }),
    );
    const aparelho = await criarAparelho();
    expect(
      await enviarPush(
        aparelho,
        new Uint8Array(1),
        await contexto(servico.buscar),
      ),
    ).toBe(esperado);
  });

  it("não segue redirect (SSRF), e a rede e o tempo esgotado contam como falha", async () => {
    let init: RequestInit | undefined;
    const aparelho = await criarAparelho();
    const ctxRedirect = await contexto((async (_url, opcoes) => {
      init = opcoes;
      return new Response(null, { status: 307 });
    }) as typeof fetch);
    expect(await enviarPush(aparelho, new Uint8Array(1), ctxRedirect)).toBe(
      "falhou",
    );
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    const rede = await contexto((() =>
      Promise.reject(
        new TypeError("Network connection lost"),
      )) as typeof fetch);
    expect(await enviarPush(aparelho, new Uint8Array(1), rede)).toBe("falhou");

    // Um serviço que nunca responde: o sinal do tempo limite (50 ms) cancela.
    const lento = await contexto(
      ((_url, opcoes?: RequestInit) =>
        new Promise((_resolver, rejeitar) => {
          opcoes?.signal?.addEventListener("abort", () =>
            rejeitar(opcoes.signal?.reason),
          );
        })) as typeof fetch,
    );
    expect(await enviarPush(aparelho, new Uint8Array(1), lento)).toBe("falhou");
  });
});
