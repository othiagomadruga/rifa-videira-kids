// Cache das respostas 200 das rotas abertas (lib/cache-publico.ts) sozinho: chave, prazo, o que vai para a
// Cache API e o que volta ao cliente. As rotas com cache estão em routes/publico.test.ts e o app real, em
// protecao.test.ts.
import { describe, expect, it } from "vitest";
import {
  CACHE_PUBLICO,
  SEM_CACHE,
  TTL_CACHE_PUBLICO_MS,
  chaveDoCache,
  criarCacheDeRespostas,
} from "./cache-publico";

const AGORA = new Date("2026-12-01T15:00:00.000Z");
const depois = (ms: number) => new Date(AGORA.getTime() + ms);

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function cacheApiNova(): Promise<Cache> {
  return caches.open(`cache-publico-teste-${crypto.randomUUID()}`);
}

describe("chaveDoCache", () => {
  it("origem, caminho e os parâmetros da consulta validada em ordem alfabética, sem os ausentes", () => {
    expect(
      chaveDoCache(
        "https://rifa.example/api/publico/ranking?x=1&periodo=campanha",
        { periodo: "atual", nivel: "celula", divisao: undefined },
      ),
    ).toBe(
      "https://rifa.example/api/publico/ranking?nivel=celula&periodo=atual",
    );
    expect(
      chaveDoCache("https://rifa.example/api/publico/bumbo?data=x", {
        data: undefined,
      }),
    ).toBe("https://rifa.example/api/publico/bumbo");
    expect(
      chaveDoCache("http://localhost/api/publico/bumbo", {
        data: "2026-11-30",
      }),
    ).toBe("http://localhost/api/publico/bumbo?data=2026-11-30");
  });
});

describe("criarCacheDeRespostas", () => {
  const CHAVE =
    "http://localhost/api/publico/ranking?nivel=celula&periodo=atual";

  it("a cópia na Cache API leva o prazo da plataforma (max-age=30); ao cliente volta só o corpo e o Content-Type", async () => {
    const cacheApi = await cacheApiNova();
    const cache = criarCacheDeRespostas({
      memoria: false,
      cacheApi: () => cacheApi,
    });

    await cache.gravar(CHAVE, json({ itens: [1] }), AGORA);

    const copia = await cacheApi.match(new Request(CHAVE));
    expect(copia?.headers.get("Cache-Control")).toBe(CACHE_PUBLICO);
    expect(copia?.headers.get("X-Cache-Gerado-Em")).toBe(
      String(AGORA.getTime()),
    );
    const lida = await cache.ler(CHAVE, depois(1));
    expect(lida?.status).toBe(200);
    expect([...lida!.headers]).toEqual([["content-type", "application/json"]]);
    expect(await lida!.json()).toEqual({ itens: [1] });
  });

  it.each([
    ["memória", false],
    ["Cache API", true],
  ])(
    "%s: vale até 30 s depois de gerada (exclusive), nunca antes dela, e só guarda 200",
    async (_nivel, comCacheApi) => {
      const cacheApi = comCacheApi ? await cacheApiNova() : null;
      const cache = criarCacheDeRespostas({
        memoria: !comCacheApi,
        cacheApi: cacheApi === null ? null : () => cacheApi,
      });

      await cache.gravar(CHAVE, json({ ok: 1 }), AGORA);
      expect(
        await cache.ler(CHAVE, depois(TTL_CACHE_PUBLICO_MS - 1)),
      ).not.toBeNull();
      // Relógio para trás (outro isolate, outro relógio): não confia.
      expect(await cache.ler(CHAVE, depois(-1))).toBeNull();
      expect(await cache.ler(CHAVE, depois(TTL_CACHE_PUBLICO_MS))).toBeNull();

      for (const status of [201, 400, 404, 500])
        await cache.gravar(`${CHAVE}&s=${status}`, json({}, status), AGORA);
      for (const status of [201, 400, 404, 500])
        expect(await cache.ler(`${CHAVE}&s=${status}`, AGORA)).toBeNull();
    },
  );

  it("a memória guarda no máximo 100 chaves: a mais antiga sai primeiro", async () => {
    const cache = criarCacheDeRespostas({ memoria: true, cacheApi: null });

    for (let n = 0; n <= 100; n++)
      await cache.gravar(`${CHAVE}&n=${n}`, json({ n }), AGORA);

    expect(await cache.ler(`${CHAVE}&n=0`, AGORA)).toBeNull();
    expect(await (await cache.ler(`${CHAVE}&n=1`, AGORA))?.json()).toEqual({
      n: 1,
    });
    expect(await (await cache.ler(`${CHAVE}&n=100`, AGORA))?.json()).toEqual({
      n: 100,
    });
  });

  it("SEM_CACHE não guarda nada", async () => {
    await SEM_CACHE.gravar(CHAVE, json({}), AGORA);
    expect(await SEM_CACHE.ler(CHAVE, AGORA)).toBeNull();
  });
});
