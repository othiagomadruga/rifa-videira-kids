// CA5: desempenho das quatro rotas no workerd com volume sintético (36 células × 24 dias), com ~7 mil e com 259
// mil pedidos. As rotas abertas vão sem o cache de 30 s (lib/cache-publico.ts): aqui se mede a resposta montada.
// - Travas exatas, que não dependem da máquina: as idas ao D1 por requisição (a campanha e um lote, sem N+1), as
//   linhas lidas no D1 por pedido (o que o plano do D1 cobra) e o TRABALHO de cada requisição: quantas vezes ela
//   chama os montadores de calculos.ts e quantas linhas de venda e células passa a eles. O custo de um montador
//   cresce com as linhas e as células que recebe (~1,5 µs por linha), e a leitura agrega os pedidos por célula e
//   dia (D10) justamente para que ele não cresça com o volume: a requisição que passar do dobro do trabalho medido
//   falha, em qualquer máquina (desfazer a agregação, um pedido por linha, passa muito do teto). A contagem usa os
//   montadores injetáveis das rotas (criarPainel e criarPublico), embrulhados: o vi.mock de módulo não roda no
//   workerd (o mocker do Vitest chama AsyncLocalStorage.disable(), que ele não implementa).
// - A CPU fica só no log: o tempo total, o tempo esperando o D1 e a diferença (o trabalho do Worker: validação,
//   montador e JSON), além do montador sozinho. O relógio do workerd anda de 1 em 1 ms e é de parede: com a máquina
//   cheia (a suíte em paralelo), ele mede a disputa pelos núcleos, e um teto pelo tempo derrubava a suíte.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ROTAS,
  campanhaEntradaSchema,
  montarBumbo,
  montarRankingPainel,
  montarRankingPublico,
  montarResumoPainel,
  type EntradaCalculo,
  type EscopoResolvido,
} from "../../shared/contracts";
import { lerEntradaDoCalculo } from "../db/painel";
import { SEM_CACHE } from "../lib/cache-publico";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  bancoQueConta,
  limparBanco,
  semearCampanha,
} from "../test/painel-apoio";
import { PREFIXO_PAINEL, criarPainel, type MontadoresDoPainel } from "./painel";
import { PREFIXO_PUBLICO, criarPublico, type OpcoesPublico } from "./publico";

const DIAS = 24;
const TOTAL_CELULAS = 36;
/** Dia 20 de 24, às 12:00 em Belém: 19 dias fechados e o de hoje. */
const AGORA = new Date("2026-12-12T15:00:00.000Z");
/**
 * Linhas lidas no D1 por pedido aprovado, por requisição. Medido: ~1,3 com ~7 mil pedidos e ~1,0 com
 * 259 mil (1 por pedido, pelo índice da migração 0003, e ~2 por grupo afiliado × dia). Pela view
 * vendas_aprovadas eram ~6; sem o índice, ~2,3.
 */
const LIMITE_LINHAS_POR_PEDIDO = 1.5;

/** O trabalho de uma requisição: as chamadas aos montadores e o que elas receberam, somado. */
interface Trabalho {
  chamadas: number;
  /** Linhas de venda (vendas por célula e dia) passadas aos montadores. */
  linhas: number;
  /** Células passadas aos montadores (cada uma ganha uma série diária no montador). */
  celulas: number;
}

/**
 * O trabalho de cada uma das cinco requisições, igual nos dois volumes (o banco agrega por célula e dia), medido em
 * 2026-11-10: uma chamada ao montador, com 927 linhas de venda (uma por célula e dia local com venda: 36 × 25, o
 * último já depois do fim; mais 24 das vendas sem célula e 3 de antes do início) e as 36 células. O teto é o dobro:
 * passar dele falha. Se o trabalho cair (ou o cenário mudar), atualize o medido.
 */
const TRABALHO_MEDIDO: Trabalho = { chamadas: 1, linhas: 927, celulas: 36 };
const FOLGA_DO_TRABALHO = 2;

const relogio = () => AGORA;

/** Os montadores do painel e das rotas abertas, embrulhados para contar o trabalho (fazem o mesmo que os do contrato). */
function montadoresQueContam() {
  const trabalho: Trabalho = { chamadas: 0, linhas: 0, celulas: 0 };
  const contar =
    <A extends unknown[], R>(
      montar: (entrada: EntradaCalculo, ...resto: A) => R,
    ) =>
    (entrada: EntradaCalculo, ...resto: A): R => {
      trabalho.chamadas += 1;
      trabalho.linhas += entrada.vendas.length;
      trabalho.celulas += entrada.celulas.length;
      return montar(entrada, ...resto);
    };
  const painel: MontadoresDoPainel = {
    montarResumoPainel: contar(montarResumoPainel),
    montarRankingPainel: contar(montarRankingPainel),
  };
  const publico: OpcoesPublico["montadores"] = {
    montarRankingPublico: contar(montarRankingPublico),
    montarBumbo: contar(montarBumbo),
  };
  return { trabalho, painel, publico };
}

/** O painel e as rotas abertas (sem o cache de 30 s) com os montadores dados. */
function appCom(
  painel: MontadoresDoPainel,
  publico: OpcoesPublico["montadores"],
) {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.route(PREFIXO_PAINEL, criarPainel(relogio, painel));
  app.route(
    PREFIXO_PUBLICO,
    criarPublico({ relogio, cache: SEM_CACHE, montadores: publico }),
  );
  app.notFound(rotaInexistente);
  app.onError(erroNaoTratado);
  return app;
}

const CAMPANHA = campanhaEntradaSchema.parse({
  nome: "Rifa Videira Kids",
  slug_rifei: "rifa-videira-kids-carga",
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

/** 2 redes, 6 discipuladores e 36 células (5 a 20 pessoas), cada uma com um afiliado. */
async function semearHierarquia(db: D1Database) {
  await db.batch([
    db.prepare(
      "INSERT INTO redes (id, nome, divisao) VALUES (1, 'Rede Jovem de Carga', 'jovens'), (2, 'Rede Adulta de Carga', 'adultos')",
    ),
    db.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 6)
       INSERT INTO discipuladores (id, rede_id, nome)
       SELECT i, CASE WHEN i <= 3 THEN 1 ELSE 2 END, 'Discipulador de Carga ' || i FROM n`,
    ),
    db.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${TOTAL_CELULAS})
       INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
       SELECT i, 1 + (i - 1) % 6, 'Célula de Carga ' || i, 5 + i % 16, 'Líder ' || i FROM n`,
    ),
    db.prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
       SELECT 1000 + id, id, 'manual', '2026-11-20T12:00:00.000Z' FROM celulas`,
    ),
  ]);
}

/**
 * `porCelulaPorDia` pedidos aprovados por célula em cada um dos 24 dias, espalhados pelo dia local
 * (de 03:00Z a 02:59Z do dia seguinte), mais 1 pedido por dia sem afiliado e 3 antes do início.
 */
async function semearPedidos(
  db: D1Database,
  campanhaId: number,
  porCelulaPorDia: number,
) {
  const total = TOTAL_CELULAS * DIAS * porCelulaPorDia;
  const segundosEntrePedidos = Math.floor(86_400 / porCelulaPorDia);
  await db.batch([
    db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?1 - 1)
         INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos,
           aprovado_em)
         SELECT 'CARGA-' || i, ?2, 1001 + i % ${TOTAL_CELULAS}, 'approved', 1 + i % 4,
           (1 + i % 4) * 2000,
           strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-23T03:00:00.000Z',
             '+' || ((i / ${TOTAL_CELULAS}) / ?3) || ' days',
             '+' || (((i / ${TOTAL_CELULAS}) % ?3) * ?4) || ' seconds')
         FROM n`,
      )
      .bind(total, campanhaId, porCelulaPorDia, segundosEntrePedidos),
    db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ${DIAS - 1})
         INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos,
           aprovado_em)
         SELECT 'CARGA-SEM-' || i, ?1, NULL, 'approved', 2, 4000,
           strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-23T15:00:00.000Z', '+' || i || ' days')
         FROM n`,
      )
      .bind(campanhaId),
    db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos,
           aprovado_em)
         VALUES ('CARGA-ANTES-1', ?1, 1001, 'approved', 1, 2000, '2026-11-20T15:00:00.000Z'),
                ('CARGA-ANTES-2', ?1, 1002, 'approved', 1, 2000, '2026-11-21T15:00:00.000Z'),
                ('CARGA-ANTES-3', ?1, NULL, 'approved', 1, 2000, '2026-11-22T15:00:00.000Z')`,
      )
      .bind(campanhaId),
  ]);
  return total + DIAS + 3;
}

const ESCOPO_CAMPANHA: EscopoResolvido = {
  tipo: "campanha",
  id: null,
  divisao: null,
  nome: CAMPANHA.nome,
};

/** As rotas medidas, com o montador correspondente (para medir o montador sozinho). */
const ROTAS_MEDIDAS: {
  nome: string;
  caminho: string;
  schema: { parse: (valor: unknown) => unknown };
  montar: (entrada: EntradaCalculo) => unknown;
}[] = [
  {
    nome: "painel/resumo (campanha)",
    caminho: "/api/painel/resumo",
    schema: ROTAS.painelResumo.sucesso.corpo,
    montar: (entrada) =>
      montarResumoPainel(entrada, { escopo: ESCOPO_CAMPANHA }, AGORA),
  },
  {
    nome: "painel/resumo (célula)",
    caminho: "/api/painel/resumo?escopo=celula&id=7",
    schema: ROTAS.painelResumo.sucesso.corpo,
    montar: (entrada) =>
      montarResumoPainel(
        entrada,
        {
          escopo: {
            tipo: "celula",
            id: 7,
            divisao: "jovens",
            nome: "Célula de Carga 7",
          },
        },
        AGORA,
      ),
  },
  {
    nome: "painel/ranking (célula, atual)",
    caminho: "/api/painel/ranking",
    schema: ROTAS.painelRanking.sucesso.corpo,
    montar: (entrada) =>
      montarRankingPainel(
        entrada,
        { nivel: "celula", periodo: "atual" },
        AGORA,
      ),
  },
  {
    nome: "publico/ranking (célula, campanha)",
    caminho: "/api/publico/ranking?periodo=campanha",
    schema: ROTAS.rankingPublico.sucesso.corpo,
    montar: (entrada) =>
      montarRankingPublico(
        entrada,
        { nivel: "celula", periodo: "campanha" },
        AGORA,
      ),
  },
  {
    nome: "publico/bumbo",
    caminho: "/api/publico/bumbo",
    schema: ROTAS.bumbo.sucesso.corpo,
    montar: (entrada) => montarBumbo(entrada, {}, AGORA),
  },
];

const mediana = (valores: number[]) =>
  [...valores].sort((a, b) => a - b)[Math.floor(valores.length / 2)];
const ms = (valor: number) => valor.toFixed(1).padStart(6);

/** O trabalho da requisição abaixo do dobro do medido (e a contagem viu a chamada ao montador). */
function esperarTrabalhoNoTeto(rota: string, trabalho: Trabalho): void {
  expect({ rota, chamou: trabalho.chamadas >= 1 }).toEqual({
    rota,
    chamou: true,
  });
  for (const medida of ["chamadas", "linhas", "celulas"] as const)
    expect({
      rota,
      medida,
      valor: trabalho[medida],
      dentroDoTeto:
        trabalho[medida] <= FOLGA_DO_TRABALHO * TRABALHO_MEDIDO[medida],
    }).toEqual({ rota, medida, valor: trabalho[medida], dentroDoTeto: true });
}

async function medir(pedidos: number) {
  // Desfazer a agregação da leitura (um pedido por linha de venda) passaria do teto do trabalho neste volume.
  expect(pedidos).toBeGreaterThan(FOLGA_DO_TRABALHO * TRABALHO_MEDIDO.linhas);
  const linhas: string[] = [];
  const leitura = await lerEntradaDoCalculo(env.DB, relogio);
  if (!leitura.ok) throw new Error(leitura.mensagem);

  for (const rota of ROTAS_MEDIDAS) {
    const totais: number[] = [];
    const banco: number[] = [];
    let linhasLidas = 0;
    let trabalhoMedido: Trabalho | undefined;
    for (let rodada = 0; rodada < 3; rodada++) {
      const { trabalho, painel, publico } = montadoresQueContam();
      const app = appCom(painel, publico);
      const { db, contagem } = bancoQueConta();
      const inicio = performance.now();
      const res = await app.request(rota.caminho, {}, { ...env, DB: db });
      const corpo: unknown = await res.json();
      const total = performance.now() - inicio;

      expect({ rota: rota.nome, status: res.status }).toEqual({
        rota: rota.nome,
        status: 200,
      });
      rota.schema.parse(corpo);
      // Sem N+1: a campanha e um batch, com qualquer volume.
      expect({ rota: rota.nome, idas: contagem.idas }).toEqual({
        rota: rota.nome,
        idas: 2,
      });
      esperarTrabalhoNoTeto(rota.nome, trabalho);
      trabalhoMedido = trabalho;
      // A 1ª rodada aquece o isolate (formatadores do Intl, dias conferidos do fuso).
      if (rodada > 0) {
        totais.push(total);
        banco.push(contagem.ms);
      }
      linhasLidas = contagem.linhasLidas;
    }

    const inicioMontador = performance.now();
    for (let vez = 0; vez < 10; vez++) rota.montar(leitura.entrada);
    const montador = (performance.now() - inicioMontador) / 10;

    const worker = mediana(
      totais.map((total, indice) => total - banco[indice]),
    );
    const porPedido = linhasLidas / pedidos;
    expect({
      rota: rota.nome,
      porPedido,
      dentroDoLimite: porPedido <= LIMITE_LINHAS_POR_PEDIDO,
    }).toEqual({ rota: rota.nome, porPedido, dentroDoLimite: true });
    linhas.push(
      `${rota.nome.padEnd(36)} total ${ms(mediana(totais))} ms | D1 ${ms(mediana(banco))} ms | Worker ${ms(worker)} ms | montador ${ms(montador)} ms | linhas lidas no D1 ${linhasLidas.toLocaleString("pt-BR")} (${porPedido.toFixed(2)} por pedido) | trabalho ${JSON.stringify(trabalhoMedido)}`,
    );
  }
  console.log(
    [
      `CA5: ${pedidos.toLocaleString("pt-BR")} pedidos aprovados (${TOTAL_CELULAS} células × ${DIAS} dias)`,
      ...linhas,
    ].join("\n"),
  );
}

describe("CA5: desempenho com volume sintético", () => {
  let campanhaId: number;

  beforeAll(async () => {
    await limparBanco();
    await semearHierarquia(env.DB);
    campanhaId = await semearCampanha(env.DB, CAMPANHA);
  });

  it("≈300 pedidos por dia no total (8 por célula por dia): o trabalho de cada rota no teto, e o D1 no orçamento", async () => {
    await env.DB.prepare("DELETE FROM pedidos").run();
    const pedidos = await semearPedidos(env.DB, campanhaId, 8);

    await medir(pedidos);
  }, 60_000);

  it("D20: o pedido desconsiderado sai do índice: cada um é EXATAMENTE uma linha lida a menos em cada rota (nenhuma a mais pelo filtro)", async () => {
    await env.DB.prepare("DELETE FROM pedidos").run();
    await semearPedidos(env.DB, campanhaId, 8);
    /** Linhas lidas (o lote; a campanha é a mesma nas duas medidas) e os bilhetes do resumo da campanha. */
    const medirRotas = async () => {
      const medidas: Record<string, number> = {};
      for (const rota of ROTAS_MEDIDAS) {
        const { painel, publico } = montadoresQueContam();
        const { db, contagem } = bancoQueConta();
        const res = await appCom(painel, publico).request(
          rota.caminho,
          {},
          { ...env, DB: db },
        );
        expect({ rota: rota.nome, status: res.status }).toEqual({
          rota: rota.nome,
          status: 200,
        });
        rota.schema.parse(await res.json());
        medidas[rota.nome] = contagem.linhasLidas;
      }
      return medidas;
    };
    const antes = await medirRotas();

    // 1 de cada 10 pedidos com afiliado: cada célula continua com venda em todo dia (os grupos não mudam).
    const { meta } = await env.DB.prepare(
      `UPDATE pedidos SET desconsiderado_em = '2026-12-01T12:00:00.000Z', desconsiderado_motivo = 'teste'
       WHERE id GLOB 'CARGA-*0' AND affiliate_id IS NOT NULL`,
    ).run();
    const desconsiderados = meta.changes;
    expect(desconsiderados).toBeGreaterThan(600);
    const depois = await medirRotas();

    expect(depois).toEqual(
      Object.fromEntries(
        Object.entries(antes).map(([rota, linhas]) => [
          rota,
          linhas - desconsiderados,
        ]),
      ),
    );
  }, 60_000);

  it("300 pedidos por dia POR célula (259.200): o banco agrega, e o trabalho de cada rota é o mesmo", async () => {
    await env.DB.prepare("DELETE FROM pedidos").run();
    const pedidos = await semearPedidos(env.DB, campanhaId, 300);
    const { results } = await env.DB.prepare(
      "SELECT count(*) AS total FROM vendas_aprovadas",
    ).all<{ total: number }>();
    expect(results[0].total).toBe(pedidos);

    await medir(pedidos);
  }, 120_000);
});
