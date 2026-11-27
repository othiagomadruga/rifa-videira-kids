// RIFA-094 (D42): GET /api/publico/vendas-recentes, os avisos de venda do ranking aberto e da /minha, com o D1 dos
// testes e o relógio fixo. Só as vendas que contam (aprovadas, sem desconsiderar, da campanha ativa e dos dias dela,
// com a célula EFETIVA da D41) dos últimos 3 minutos, da mais recente para a mais antiga, até 30; cada item só com a
// chave opaca, o nome da célula, os bilhetes e o instante; a opção da campanha desligada dá a lista vazia; o cache
// (10 s) e o limite por IP como nas outras rotas abertas (D10); o plano da consulta no índice da aprovação.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JANELA_VENDAS_RECENTES_MS,
  LIMITE_VENDAS_RECENTES,
  ROTAS,
  STATUS_HTTP_DO_ERRO,
  campanhaEntradaSchema,
  respostaVendasRecentesSchema,
} from "../../shared/contracts";
import {
  CACHE_VENDAS_RECENTES,
  SEM_CACHE,
  TTL_VENDAS_RECENTES_MS,
  criarCacheDeRespostas,
} from "../lib/cache-publico";
import { LIMITE_PUBLICO } from "../lib/limite-requisicoes";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  AGORA,
  DADOS_CAMPANHA,
  aprovado,
  desconsiderado,
  limparBanco,
  semearCenario,
  type PedidoTeste,
} from "../test/painel-apoio";
import {
  SELECIONAR_VENDAS_RECENTES,
  chaveDaVenda,
} from "../db/vendas-recentes";
import { PREFIXO_PUBLICO, criarPublico, type OpcoesPublico } from "./publico";

const CAMINHO = ROTAS.vendasRecentes.caminho;
let agora = AGORA;

function montarApp(opcoes: OpcoesPublico = {}) {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.route(
    PREFIXO_PUBLICO,
    criarPublico({ relogio: () => agora, cache: SEM_CACHE, ...opcoes }),
  );
  app.notFound(rotaInexistente);
  app.onError(erroNaoTratado);
  return app;
}

const app = montarApp();

async function consultar(aplicacao = app, caminho: string = CAMINHO) {
  const res = await aplicacao.request(caminho, {}, env);
  const texto = await res.text();
  return {
    status: res.status,
    cacheControl: res.headers.get("Cache-Control"),
    texto,
    corpo: respostaVendasRecentesSchema.parse(JSON.parse(texto)),
  };
}

/** `segundos` antes do AGORA, no formato do banco. */
const antes = (segundos: number) =>
  new Date(AGORA.getTime() - segundos * 1000).toISOString();

/**
 * As vendas do cenário perto do AGORA (01/12/2026 12:00 em Belém, dia 9). Afiliados: 101 → Ágape, 102 → Betel,
 * 103 → Canaã, 104 → Dorcas; 900 não vinculado.
 */
const RECENTES = {
  agape: { ...aprovado(101, antes(10), 3), id: "PEDIDO-AGAPE-10S" },
  betel: { ...aprovado(102, antes(60), 5), id: "PEDIDO-BETEL-60S" },
  agape2: { ...aprovado(101, antes(120), 1), id: "PEDIDO-AGAPE-120S" },
  /** No limite da janela (3 min exatos): entra. */
  canaaNoLimite: { ...aprovado(103, antes(180), 2), id: "PEDIDO-CANAA-180S" },
  /** Sem afiliado, atribuída à mão à Dorcas (D41): entra com a Dorcas. */
  atribuida: { ...aprovado(null, antes(30), 4), id: "PEDIDO-ATRIBUIDO" },
} satisfies Record<string, PedidoTeste>;

const FORA = [
  // Mais de 3 minutos atrás.
  { ...aprovado(101, antes(181), 7), id: "PEDIDO-VELHO" },
  // Depois do "agora" do servidor.
  { ...aprovado(101, antes(-5), 7), id: "PEDIDO-FUTURO" },
  // Sem célula: sem afiliado e sem atribuição; afiliado não vinculado.
  { ...aprovado(null, antes(20), 7), id: "PEDIDO-SEM-CELULA" },
  { ...aprovado(900, antes(20), 7), id: "PEDIDO-ORFAO" },
  // Desconsiderado pelo admin (D20).
  { ...desconsiderado(aprovado(104, antes(15), 7)), id: "PEDIDO-DESCONS" },
  // Não aprovado (sem aprovado_em) e de outra campanha.
  {
    id: "PEDIDO-PROCESSO",
    affiliate_id: 101,
    status: "in_process",
    aprovado_em: null,
    qtd_bilhetes: 7,
    total_centavos: 14000,
  },
  {
    ...aprovado(101, antes(25), 7),
    id: "PEDIDO-OUTRA",
    campanha: "outra",
  },
] satisfies PedidoTeste[];

async function semear(
  pedidos: readonly PedidoTeste[] = [...Object.values(RECENTES), ...FORA],
  publico?: object,
) {
  const { campanhaId } = await semearCenario({
    campanha: campanhaEntradaSchema.parse({
      ...DADOS_CAMPANHA,
      ...(publico ? { publico } : {}),
    }),
    pedidos,
  });
  // D41: a atribuída à mão (Dorcas, id 4).
  await env.DB.prepare(
    `UPDATE pedidos SET celula_atribuida_id = 4, celula_atribuida_em = '2026-12-01T14:00:00.000Z',
       celula_atribuida_por = 1
     WHERE id = 'PEDIDO-ATRIBUIDO'`,
  ).run();
  return campanhaId;
}

beforeEach(() => {
  agora = AGORA;
});

describe("GET /api/publico/vendas-recentes (RIFA-094, D42)", () => {
  it("está no contrato como rota aberta, sem consulta própria", () => {
    expect(ROTAS.vendasRecentes).toMatchObject({
      metodo: "GET",
      caminho: "/api/publico/vendas-recentes",
      grupo: "aberto",
      situacao: "detalhada",
    });
  });

  it("só as vendas que contam dos últimos 3 minutos, da mais recente para a mais antiga, com a célula efetiva", async () => {
    await semear();

    const { status, cacheControl, corpo } = await consultar();

    expect(status).toBe(200);
    expect(cacheControl).toBe(CACHE_VENDAS_RECENTES);
    expect(corpo.agora).toBe(AGORA.toISOString());
    expect(corpo.ligados).toBe(true);
    expect(
      corpo.itens.map(({ celula, bilhetes, em }) => [celula, bilhetes, em]),
    ).toEqual([
      ["Célula Ágape", 3, antes(10)],
      ["Célula Dorcas", 4, antes(30)],
      ["Célula Betel", 5, antes(60)],
      ["Célula Ágape", 1, antes(120)],
      ["Célula Canaã", 2, antes(180)],
    ]);
  });

  it("cada item só com k, celula, bilhetes e em: nada do comprador, do bilhete, do valor nem o id do pedido", async () => {
    await semear();

    const { corpo, texto } = await consultar();

    expect(Object.keys(corpo)).toEqual(["ligados", "itens", "agora"]);
    for (const item of corpo.itens)
      expect(Object.keys(item).sort()).toEqual([
        "bilhetes",
        "celula",
        "em",
        "k",
      ]);
    // Nenhum id de pedido (nem pedaço dele) e nenhum valor no texto da resposta.
    expect(texto).not.toMatch(/PEDIDO|centavos|R\$|affiliate|telefone|nome/i);
    expect(corpo.itens.every(({ k }) => /^[0-9a-f]{16}$/.test(k))).toBe(true);
  });

  it("a chave é estável (a mesma venda, a mesma chave em toda resposta) e diferente para cada venda", async () => {
    const campanhaId = await semear();

    const primeira = (await consultar()).corpo.itens.map(({ k }) => k);
    agora = new Date(AGORA.getTime() + 30_000);
    const segunda = (await consultar()).corpo.itens.map(({ k }) => k);

    expect(new Set(primeira).size).toBe(primeira.length);
    // 30 s depois, a da Canaã (no limite) saiu e a venda que era "do futuro" entrou no topo; as outras seguem com a
    // mesma chave.
    expect(segunda.slice(1)).toEqual(primeira.slice(0, -1));
    expect(primeira).not.toContain(segunda[0]);
    // É o resumo do id com o sal da campanha (o `criado_em` dela), não o id.
    const { criado_em } = (await env.DB.prepare(
      "SELECT criado_em FROM campanhas WHERE id = ?1",
    )
      .bind(campanhaId)
      .first<{ criado_em: string }>())!;
    expect(primeira[0]).toBe(
      await chaveDaVenda({ id: campanhaId, criado_em }, RECENTES.agape.id),
    );
  });

  it(`no máximo ${LIMITE_VENDAS_RECENTES} vendas, as mais recentes`, async () => {
    const muitas = Array.from(
      { length: LIMITE_VENDAS_RECENTES + 5 },
      (_, i) => ({
        ...aprovado(101, antes(i + 1), 1 + (i % 3)),
        id: `PEDIDO-MUITAS-${String(i).padStart(2, "0")}`,
      }),
    );
    await semear(muitas);

    const { corpo } = await consultar();

    expect(corpo.itens).toHaveLength(LIMITE_VENDAS_RECENTES);
    expect(corpo.itens.map(({ em }) => em)).toEqual(
      muitas.slice(0, LIMITE_VENDAS_RECENTES).map((p) => p.aprovado_em),
    );
  });

  it("a opção publico.avisos_de_venda desligada: ligados false e a lista vazia, sem ler os pedidos", async () => {
    await semear(undefined, {
      mostra_percentual_meta: false,
      limite_ranking: 3,
      avisos_de_venda: false,
    });
    const prepare = vi.spyOn(env.DB, "prepare");

    const { status, cacheControl, corpo } = await consultar();

    expect({ status, cacheControl, corpo }).toEqual({
      status: 200,
      cacheControl: CACHE_VENDAS_RECENTES,
      corpo: { ligados: false, itens: [], agora: AGORA.toISOString() },
    });
    expect(
      prepare.mock.calls.some(([sql]) => sql === SELECIONAR_VENDAS_RECENTES),
    ).toBe(false);
    prepare.mockRestore();
  });

  it("sem campanha ativa: 200 com ligados false e a lista vazia", async () => {
    await limparBanco();

    expect((await consultar()).corpo).toEqual({
      ligados: false,
      itens: [],
      agora: AGORA.toISOString(),
    });
  });

  it("só os dias da campanha: a compra de teste de antes do início não vira aviso", async () => {
    // A campanha começa amanhã (02/12): a venda de agora é de antes do início.
    await semearCenario({
      campanha: campanhaEntradaSchema.parse({
        ...DADOS_CAMPANHA,
        data_inicio: "2026-12-02",
      }),
      pedidos: [RECENTES.agape],
    });

    expect((await consultar()).corpo).toMatchObject({
      ligados: true,
      itens: [],
    });
  });

  it("venda aprovada com 0 bilhetes (o webhook aceita numbers_count 0) não vira aviso nem derruba a resposta", async () => {
    // Sem o filtro, o item `bilhetes: 0` reprovava o schema estrito (positivo) e a rota dava 500 para todo mundo
    // durante os 3 minutos da janela.
    await semear([
      RECENTES.agape,
      { ...aprovado(102, antes(20), 0, 0), id: "PEDIDO-ZERO" },
    ]);

    const res = await app.request(CAMINHO, {}, env);
    expect(res.status).toBe(200);
    const corpo = respostaVendasRecentesSchema.parse(await res.json());
    expect(
      corpo.itens.map(({ celula, bilhetes }) => [celula, bilhetes]),
    ).toEqual([["Célula Ágape", 3]]);
  });

  it("uma consulta qualquer na URL é ignorada (não muda a resposta nem a chave do cache)", async () => {
    await semear();
    const app = montarApp({
      cache: criarCacheDeRespostas({ memoria: true, cacheApi: null }),
    });

    const sem = await consultar(app);
    const prepare = vi.spyOn(env.DB, "prepare");
    const com = await consultar(app, `${CAMINHO}?x=1&celula=2`);

    expect(com.texto).toBe(sem.texto);
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
  });

  it("cache de 10 s (e não de 30): dentro do prazo não lê o banco; passado o prazo, monta de novo", async () => {
    await semear();
    const app = montarApp({
      cache: criarCacheDeRespostas({ memoria: true, cacheApi: null }),
    });

    const primeira = await consultar(app);
    const prepare = vi.spyOn(env.DB, "prepare");
    agora = new Date(AGORA.getTime() + TTL_VENDAS_RECENTES_MS - 1);
    const guardada = await consultar(app);
    expect(guardada.texto).toBe(primeira.texto);
    expect(guardada.cacheControl).toBe("public, max-age=10");
    expect(prepare).not.toHaveBeenCalled();

    agora = new Date(AGORA.getTime() + TTL_VENDAS_RECENTES_MS);
    const nova = await consultar(app);
    expect(prepare).toHaveBeenCalled();
    expect(nova.corpo.agora).toBe(agora.toISOString());
    prepare.mockRestore();
  });

  it("limite por IP como as outras abertas: sem cache, a 61ª ida ao banco do mesmo IP leva 429 sem ler o banco", async () => {
    await semear();
    // A janela do binding é fixa, alinhada ao relógio: a sequência cabe inteira numa janela só.
    const periodoMs = LIMITE_PUBLICO.periodoSegundos * 1000;
    const resta = periodoMs - (Date.now() % periodoMs);
    if (resta < 5000)
      await new Promise((resolve) => setTimeout(resolve, resta + 50));
    const n = crypto.getRandomValues(new Uint8Array(3));
    const ip = `198.${n[0]}.${n[1]}.${n[2]}`;
    const pedir = () =>
      app.request(CAMINHO, { headers: { "CF-Connecting-IP": ip } }, env);

    for (let vez = 1; vez <= LIMITE_PUBLICO.limite; vez++)
      expect({ vez, status: (await pedir()).status }).toEqual({
        vez,
        status: 200,
      });
    const prepare = vi.spyOn(env.DB, "prepare");
    const res = await pedir();
    expect(res.status).toBe(STATUS_HTTP_DO_ERRO.muitas_requisicoes);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
  }, 60_000);

  it("a consulta usa o índice da aprovação (status, aprovado_em): lê só a janela, com qualquer tamanho de campanha", async () => {
    const campanhaId = await semear();
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN ${SELECIONAR_VENDAS_RECENTES}`,
    )
      .bind(
        campanhaId,
        new Date(AGORA.getTime() - JANELA_VENDAS_RECENTES_MS).toISOString(),
        AGORA.toISOString(),
        LIMITE_VENDAS_RECENTES,
      )
      .all<{ detail: string }>();
    const plano = results.map((linha) => linha.detail);

    expect(plano).toContainEqual(
      expect.stringMatching(
        /^SEARCH p USING INDEX pedidos_por_status_aprovacao \(status=\? AND aprovado_em>\? AND aprovado_em<\?\)$/,
      ),
    );
    expect(plano.some((passo) => /SCAN p\b/.test(passo))).toBe(false);
  });
});
