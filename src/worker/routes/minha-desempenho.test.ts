// RIFA-014, CA8: CPU e idas ao D1 da visão individual (GET /api/minha/visao) no workerd, com 36 células, 12
// discipuladores, 4 redes e ~7 mil pedidos aprovados. Mede como a RIFA-012 mediu (a conferência por CSV): por
// requisição, o tempo total, o tempo esperando o D1 (bancoQueConta) e a diferença, que é o trabalho do Worker
// (sessão, montador, schema e JSON); 1 rodada de aquecimento e 15 medidas, com a mediana e o pior caso, no log.
// O que é exato fica preso aqui: as idas ao D1 por requisição (sessão, campanha e um lote; com a base em cache,
// só a sessão) e as linhas lidas por pedido (o orçamento do painel). A CPU, não: o relógio do workerd anda de 1 em
// 1 ms e é de parede, e dentro da suíte (vitest em paralelo, na máquina e no CI) ele mede também a disputa pelos
// núcleos (na suíte inteira já se viu a mediana dobrar e um pico de 84 ms). Por isso, como na RIFA-012 e no
// painel, o teste só barra a regressão grosseira (N+1, laço quadrático) com uma mediana folgada; a meta do plano
// Free (10 ms de CPU por requisição) é conferida rodando este arquivo sozinho, e os números vão para o relatório
// da tarefa e para docs/decisions.md (D14).
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ROTAS,
  campanhaEntradaSchema,
  type PapelHierarquia,
} from "../../shared/contracts";
import { SEM_CACHE_DA_BASE, criarCacheDaBase } from "../db/visao-individual";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import { cabecalhosSeguranca } from "../middleware/cabecalhos-seguranca";
import { exigirSessao } from "../middleware/sessao";
import { ORIGEM, cabecalhosDeSessaoDaHierarquia } from "../test/acesso-teste";
import {
  bancoQueConta,
  limparBanco,
  semearCampanha,
} from "../test/painel-apoio";
import { PREFIXO_MINHA, criarMinha } from "./minha";

const DIAS = 24;
const TOTAL_CELULAS = 36;
const TOTAL_DISCIPULADORES = 12;
const TOTAL_REDES = 4;
/** Dia 20 de 24, às 12:00 em Belém: 19 dias fechados e o de hoje. */
const AGORA = new Date("2026-12-12T15:00:00.000Z");
/**
 * Teto da mediana do Worker: folgado de propósito (a máquina do CI e os testes em paralelo variam), como o
 * LIMITE_WORKER_MS da RIFA-012. Medido sozinho, fica bem abaixo dos 10 ms do plano Free.
 */
const LIMITE_FOLGADO_MS = 30;
/** Linhas lidas no D1 por pedido aprovado: o orçamento do painel (painel-desempenho.test.ts). */
const LIMITE_LINHAS_POR_PEDIDO = 1.5;
const RODADAS = 15;

const CAMPANHA = campanhaEntradaSchema.parse({
  nome: "Rifa Videira Kids",
  slug_rifei: "rifa-videira-kids-carga-visao",
  data_inicio: "2026-11-23",
  preco_bilhete_centavos: 2000,
  meta: { unidade: "bilhetes", regra: "total_proporcional", valor: 20000 },
  periodos: [
    { nome: "Semana 1", dias: 10, percentual_bp: 3500 },
    { nome: "Semana 2", dias: 7, percentual_bp: 2500 },
    { nome: "Semana 3", dias: 7, percentual_bp: 4500 },
  ],
  ranking: { criterio: "percentual_meta" },
  publico: { mostra_percentual_meta: true, limite_ranking: 3 },
});

/** O app como o index.ts monta /api/minha (login dos papéis da hierarquia antes da rota). */
function appDaVisao(cache = SEM_CACHE_DA_BASE) {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.use("*", cabecalhosSeguranca);
  app.use("/api/minha/*", exigirSessao(["lider", "discipulador", "rede"]));
  app.route(PREFIXO_MINHA, criarMinha({ relogio: () => AGORA, cache }));
  app.notFound(rotaInexistente);
  app.onError(erroNaoTratado);
  return app;
}

/** 4 redes (2 por divisão), 3 discipuladores por rede, 3 células por discipulador, um afiliado por célula. */
async function semearHierarquia(db: D1Database) {
  await db.batch([
    db.prepare(
      `INSERT INTO redes (id, nome, divisao) VALUES
         (1, 'Rede Jovem 1', 'jovens'), (2, 'Rede Jovem 2', 'jovens'),
         (3, 'Rede Adulta 1', 'adultos'), (4, 'Rede Adulta 2', 'adultos')`,
    ),
    db.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${TOTAL_DISCIPULADORES})
       INSERT INTO discipuladores (id, rede_id, nome)
       SELECT i, 1 + (i - 1) / 3, 'Discipulador de Carga ' || i FROM n`,
    ),
    db.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${TOTAL_CELULAS})
       INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
       SELECT i, 1 + (i - 1) / 3, 'Célula de Carga ' || i, 5 + i % 16, 'Líder ' || i FROM n`,
    ),
    db.prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
       SELECT 1000 + id, id, 'manual', '2026-11-20T12:00:00.000Z' FROM celulas`,
    ),
  ]);
}

/** 8 pedidos aprovados por célula por dia nos 24 dias, mais 1 por dia sem afiliado: 6.936 pedidos. */
async function semearPedidos(db: D1Database, campanhaId: number) {
  const porCelulaPorDia = 8;
  const total = TOTAL_CELULAS * DIAS * porCelulaPorDia;
  await db.batch([
    db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?1 - 1)
         INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos,
           aprovado_em)
         SELECT 'VISAO-' || i, ?2, 1001 + i % ${TOTAL_CELULAS}, 'approved', 1 + i % 4,
           (1 + i % 4) * 2000,
           strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-23T03:00:00.000Z',
             '+' || ((i / ${TOTAL_CELULAS}) / ?3) || ' days',
             '+' || (((i / ${TOTAL_CELULAS}) % ?3) * ?4) || ' seconds')
         FROM n`,
      )
      .bind(total, campanhaId, porCelulaPorDia, Math.floor(86_400 / 8)),
    db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ${DIAS - 1})
         INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos,
           aprovado_em)
         SELECT 'VISAO-SEM-' || i, ?1, NULL, 'approved', 2, 4000,
           strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-23T15:00:00.000Z', '+' || i || ' days')
         FROM n`,
      )
      .bind(campanhaId),
  ]);
  return total + DIAS;
}

const mediana = (valores: number[]) =>
  [...valores].sort((a, b) => a - b)[Math.floor(valores.length / 2)];
const ms = (valor: number) => valor.toFixed(1).padStart(5);

interface Medida {
  worker: number[];
  banco: number[];
  idas: number[];
  linhasLidas: number;
}

/** 1 rodada de aquecimento e RODADAS medidas da visão com a sessão dada. */
async function medir(
  app: ReturnType<typeof appDaVisao>,
  sessao: Record<string, string>,
): Promise<Medida> {
  const medida: Medida = { worker: [], banco: [], idas: [], linhasLidas: 0 };
  for (let rodada = 0; rodada <= RODADAS; rodada++) {
    const { db, contagem } = bancoQueConta();
    const inicio = performance.now();
    const res = await app.request(
      `${ORIGEM}${ROTAS.visaoIndividual.caminho}`,
      { headers: sessao },
      { ...env, DB: db },
    );
    const corpo: unknown = await res.json();
    const total = performance.now() - inicio;
    expect(res.status).toBe(200);
    ROTAS.visaoIndividual.sucesso.corpo.parse(corpo);
    if (rodada === 0) continue;
    medida.worker.push(total - contagem.ms);
    medida.banco.push(contagem.ms);
    medida.idas.push(contagem.idas);
    medida.linhasLidas = Math.max(medida.linhasLidas, contagem.linhasLidas);
  }
  return medida;
}

/** A mediana abaixo do teto folgado (o pior caso só vai para o log: na suíte em paralelo, ele mede a disputa). */
function esperarDentroDoLimite(papel: PapelHierarquia, medida: Medida): void {
  const valor = mediana(medida.worker);
  expect({ papel, mediana: valor, ok: valor < LIMITE_FOLGADO_MS }).toEqual({
    papel,
    mediana: valor,
    ok: true,
  });
}

describe("CA8: CPU e idas ao D1 da visão individual", () => {
  const sessoes: Record<PapelHierarquia, Record<string, string>> = {
    lider: {},
    discipulador: {},
    rede: {},
  };
  let pedidos = 0;

  beforeAll(async () => {
    await limparBanco();
    await semearHierarquia(env.DB);
    const campanhaId = await semearCampanha(env.DB, CAMPANHA);
    pedidos = await semearPedidos(env.DB, campanhaId);
    // A célula 7, o discipulador 3 (células 7 a 9) e a rede 1 (discipuladores 1 a 3, células 1 a 9).
    sessoes.lider = await cabecalhosDeSessaoDaHierarquia("lider", 7);
    sessoes.discipulador = await cabecalhosDeSessaoDaHierarquia(
      "discipulador",
      3,
    );
    sessoes.rede = await cabecalhosDeSessaoDaHierarquia("rede", 1);
  });

  it("sem o cache da base (toda requisição lê o D1): sessão, campanha e um lote, ~1,3 linha lida por pedido; a CPU no log", async () => {
    const app = appDaVisao();
    const linhas: string[] = [];
    for (const papel of ["lider", "discipulador", "rede"] as const) {
      const medida = await medir(app, sessoes[papel]);
      // Sessão (1), campanha (1) e o lote com as células, as vendas e os dados da visão (1): o orçamento do
      // painel no app real, sem N+1 com qualquer equipe.
      expect({ papel, idas: [...new Set(medida.idas)] }).toEqual({
        papel,
        idas: [3],
      });
      esperarDentroDoLimite(papel, medida);
      const porPedido = medida.linhasLidas / pedidos;
      expect({
        papel,
        porPedido,
        ok: porPedido <= LIMITE_LINHAS_POR_PEDIDO,
      }).toEqual({
        papel,
        porPedido,
        ok: true,
      });
      linhas.push(
        `${papel.padEnd(13)} Worker mediana ${ms(mediana(medida.worker))} ms, pior ${ms(Math.max(...medida.worker))} ms | D1 mediana ${ms(mediana(medida.banco))} ms | linhas lidas no D1 ${medida.linhasLidas.toLocaleString("pt-BR")} (${(medida.linhasLidas / pedidos).toFixed(2)} por pedido)`,
      );
    }
    console.log(
      [
        `CA8 sem cache: ${pedidos.toLocaleString("pt-BR")} pedidos, ${TOTAL_CELULAS} células, ${TOTAL_DISCIPULADORES} discipuladores, ${TOTAL_REDES} redes`,
        ...linhas,
      ].join("\n"),
    );
  }, 120_000);

  it("com o cache da base (30 s): depois da 1ª, só a sessão vai ao D1; a CPU no log", async () => {
    const app = appDaVisao(criarCacheDaBase());
    const linhas: string[] = [];
    for (const papel of ["lider", "discipulador", "rede"] as const) {
      const medida = await medir(app, sessoes[papel]);
      expect({ papel, idas: [...new Set(medida.idas)] }).toEqual({
        papel,
        idas: [1],
      });
      esperarDentroDoLimite(papel, medida);
      linhas.push(
        `${papel.padEnd(13)} Worker mediana ${ms(mediana(medida.worker))} ms, pior ${ms(Math.max(...medida.worker))} ms | D1 mediana ${ms(mediana(medida.banco))} ms (só a sessão)`,
      );
    }
    console.log(["CA8 com o cache da base:", ...linhas].join("\n"));
  }, 120_000);
});
