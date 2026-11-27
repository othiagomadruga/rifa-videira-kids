/**
 * Cache das respostas 200 das rotas abertas (/api/publico/*; RIFA-PAINEL). O link do ranking vai para
 * grupos de WhatsApp e fica aberto em muitos celulares, e cada resposta montada lê do D1 todos os pedidos
 * aprovados da campanha (o D1 cobra por linha lida). Com o cache, cada URL vai ao banco no máximo uma vez
 * a cada 30 s (TTL_CACHE_PUBLICO_MS) em cada nível.
 *
 * - Só respostas 200 entram. Erros (400, 404, 500) nunca: a requisição seguinte tenta de novo.
 * - Chave (`chaveDoCache`): a URL normalizada, com a origem, o caminho e os parâmetros da consulta JÁ
 *   validada pelo schema da rota (com os padrões aplicados), em ordem alfabética. Cookies, cabeçalhos do
 *   cliente e parâmetros fora do schema não entram: a resposta é a mesma para todos, e um `?x=1` não fura
 *   o cache.
 * - Dois níveis, com a mesma chave e o mesmo prazo, conferido com o relógio da rota (injetável):
 *   1. a memória do isolate: vale em qualquer domínio, mas é de cada isolate e some quando ele é
 *      reciclado;
 *   2. a Cache API (`caches.default`), compartilhada pelo data center. A Cloudflare documenta que, num
 *      *.workers.dev, ela não tem efeito: só passa a valer com o Worker num domínio próprio (rota ou
 *      custom domain). Por isso a memória vem primeiro.
 * - Uma falha da Cache API vai para o log e a requisição segue sem esse nível.
 *
 * - Prazo por rota (RIFA-094, D42): 30 s (TTL_CACHE_PUBLICO_MS) por padrão; os avisos de venda
 *   (/api/publico/vendas-recentes) usam 10 s (TTL_VENDAS_RECENTES_MS), para a venda aparecer logo. O mesmo prazo vai
 *   no `ler` e no `gravar` de cada rota (o `gravar` o usa no Cache-Control da cópia da Cache API).
 *
 * Só o sub-app de /api/publico usa este módulo: as rotas da coordenação nunca passam por cache
 * (src/worker/protecao.test.ts confere no app real).
 */

/** Prazo de uma resposta guardada. */
export const TTL_CACHE_PUBLICO_MS = 30_000;

/** Cache-Control das respostas 200 de um prazo (o da cópia guardada na Cache API também). */
export const cacheControlDoPrazo = (prazoMs: number) =>
  `public, max-age=${prazoMs / 1000}`;

/** Cache-Control das respostas 200 abertas; também dá o prazo da cópia guardada na Cache API. */
export const CACHE_PUBLICO = cacheControlDoPrazo(TTL_CACHE_PUBLICO_MS);

/** RIFA-094 (D42): o prazo curto dos avisos de venda (GET /api/publico/vendas-recentes). */
export const TTL_VENDAS_RECENTES_MS = 10_000;

/** Cache-Control dos avisos de venda. */
export const CACHE_VENDAS_RECENTES = cacheControlDoPrazo(
  TTL_VENDAS_RECENTES_MS,
);

/** Instante (ms) em que a resposta foi gerada: só na cópia da Cache API, nunca na resposta ao cliente. */
const CABECALHO_GERADO_EM = "X-Cache-Gerado-Em";

/** Chaves guardadas na memória do isolate (o ranking público tem 18 consultas; o bumbo, uma por data). */
const LIMITE_MEMORIA = 100;

export interface CacheDeRespostas {
  /**
   * A resposta guardada para a chave, se ainda estiver no prazo (`prazoMs`, padrão TTL_CACHE_PUBLICO_MS) em `agora`;
   * senão, null.
   */
  ler(chave: string, agora: Date, prazoMs?: number): Promise<Response | null>;
  /** Guarda a resposta, se for 200, como gerada em `agora` (lê o corpo de um clone), com o prazo da rota. */
  gravar(
    chave: string,
    resposta: Response,
    agora: Date,
    prazoMs?: number,
  ): Promise<void>;
}

interface Guardada {
  geradoEm: number;
  corpo: string;
  tipo: string | null;
}

function noPrazo(geradoEm: number, agora: Date, prazoMs: number): boolean {
  const idade = agora.getTime() - geradoEm;
  return idade >= 0 && idade < prazoMs;
}

/** A resposta como saiu da rota: o corpo e o Content-Type (o Cache-Control é posto pela rota). */
function paraResposta({ corpo, tipo }: Guardada): Response {
  return new Response(corpo, {
    status: 200,
    headers: tipo === null ? {} : { "Content-Type": tipo },
  });
}

/**
 * URL normalizada da consulta já validada: "https://h/api/publico/ranking?nivel=celula&periodo=atual".
 * Parâmetros ausentes (undefined) ficam de fora; os demais vão em ordem alfabética.
 */
export function chaveDoCache(
  url: string,
  consulta: Readonly<Record<string, string | undefined>>,
): string {
  const { origin, pathname } = new URL(url);
  const parametros = new URLSearchParams(
    Object.entries(consulta)
      .filter((par): par is [string, string] => par[1] !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  ).toString();
  return parametros === ""
    ? `${origin}${pathname}`
    : `${origin}${pathname}?${parametros}`;
}

/** Sem cache: toda requisição monta a resposta (testes que mudam o banco ou o relógio entre chamadas). */
export const SEM_CACHE: CacheDeRespostas = {
  ler: () => Promise.resolve(null),
  gravar: () => Promise.resolve(),
};

export interface OpcoesCacheDeRespostas {
  /** Guarda na memória do isolate. */
  memoria: boolean;
  /** A Cache API (em produção, `() => caches.default`), lida a cada uso; null = sem esse nível. */
  cacheApi: (() => Cache) | null;
}

export function criarCacheDeRespostas({
  memoria,
  cacheApi,
}: OpcoesCacheDeRespostas): CacheDeRespostas {
  const naMemoria = new Map<string, Guardada>();

  function guardarNaMemoria(chave: string, guardada: Guardada): void {
    if (!memoria) return;
    naMemoria.delete(chave);
    if (naMemoria.size >= LIMITE_MEMORIA) {
      const maisAntiga = naMemoria.keys().next();
      if (!maisAntiga.done) naMemoria.delete(maisAntiga.value);
    }
    naMemoria.set(chave, guardada);
  }

  async function lerDaCacheApi(
    chave: string,
    agora: Date,
    prazoMs: number,
  ): Promise<Guardada | null> {
    if (cacheApi === null) return null;
    try {
      const resposta = await cacheApi().match(new Request(chave));
      if (resposta === undefined) return null;
      const geradoEm = Number(resposta.headers.get(CABECALHO_GERADO_EM));
      if (!noPrazo(geradoEm, agora, prazoMs)) {
        await resposta.body?.cancel();
        return null;
      }
      return {
        geradoEm,
        corpo: await resposta.text(),
        tipo: resposta.headers.get("Content-Type"),
      };
    } catch (erro) {
      console.error("Cache das rotas abertas: falha ao ler da Cache API", erro);
      return null;
    }
  }

  async function gravarNaCacheApi(
    chave: string,
    guardada: Guardada,
    prazoMs: number,
  ): Promise<void> {
    if (cacheApi === null) return;
    const cabecalhos = new Headers({
      "Cache-Control": cacheControlDoPrazo(prazoMs),
      [CABECALHO_GERADO_EM]: String(guardada.geradoEm),
    });
    if (guardada.tipo !== null) cabecalhos.set("Content-Type", guardada.tipo);
    try {
      await cacheApi().put(
        new Request(chave),
        new Response(guardada.corpo, { headers: cabecalhos }),
      );
    } catch (erro) {
      console.error(
        "Cache das rotas abertas: falha ao gravar na Cache API",
        erro,
      );
    }
  }

  return {
    async ler(chave, agora, prazoMs = TTL_CACHE_PUBLICO_MS) {
      const daMemoria = naMemoria.get(chave);
      if (daMemoria !== undefined) {
        if (noPrazo(daMemoria.geradoEm, agora, prazoMs))
          return paraResposta(daMemoria);
        naMemoria.delete(chave);
      }
      const daCacheApi = await lerDaCacheApi(chave, agora, prazoMs);
      if (daCacheApi === null) return null;
      guardarNaMemoria(chave, daCacheApi);
      return paraResposta(daCacheApi);
    },

    async gravar(chave, resposta, agora, prazoMs = TTL_CACHE_PUBLICO_MS) {
      if (resposta.status !== 200) return;
      const guardada: Guardada = {
        geradoEm: agora.getTime(),
        corpo: await resposta.clone().text(),
        tipo: resposta.headers.get("Content-Type"),
      };
      guardarNaMemoria(chave, guardada);
      await gravarNaCacheApi(chave, guardada, prazoMs);
    },
  };
}

/** O cache de produção: memória do isolate e `caches.default`. */
export function cacheDeProducao(): CacheDeRespostas {
  return criarCacheDeRespostas({
    memoria: true,
    cacheApi: () => caches.default,
  });
}
