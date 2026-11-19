// GET /api/painel/bilhetes e /api/painel/bilhetes/:numero (RIFA-075, D35; docs/api.md, "Bilhetes") com o D1 dos
// testes e o relógio fixo. Toda resposta 200 passa pelo schema estrito do contrato (nenhum dado do comprador). O login
// (401 sem sessão, admin e coordenação passam, a hierarquia leva 403) é provado no app real em protecao.test.ts.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import {
  mapaDeBase64,
  respostaBilheteSchema,
  respostaBilhetesSchema,
  situacaoNoIndice,
  type RespostaBilhetes,
} from "../../shared/contracts";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  DADOS_CAMPANHA,
  limparBanco,
  semearCampanha,
  semearHierarquia,
} from "../test/painel-apoio";
import { PREFIXO_PAINEL, criarPainel } from "./painel";

const AGORA = new Date("2026-11-25T15:00:00.000Z");
const FUTURO = "2026-11-25T16:00:00.000Z";
const PASSADO = "2026-11-25T14:00:00.000Z";

const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.route(
  PREFIXO_PAINEL,
  criarPainel(() => AGORA),
);
app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

const pedir = (caminho: string) =>
  app.request(caminho, {}, env as unknown as Cloudflare.Env);

interface PedidoBilhete {
  id: string;
  status: "approved" | "in_process" | "expired";
  numeros: number[] | null;
  qtd?: number;
  affiliate_id?: number | null;
  expira_em?: string | null;
  desconsiderado?: boolean;
  registrado_em: string;
}

async function gravarPedidos(campanhaId: number, pedidos: PedidoBilhete[]) {
  await env.DB.batch(
    pedidos.map((p) =>
      env.DB.prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, numeros,
           aprovado_em, criado_em, expira_em, registrado_em, desconsiderado_em, desconsiderado_motivo)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
      ).bind(
        p.id,
        campanhaId,
        p.affiliate_id ?? null,
        p.status,
        p.qtd ?? p.numeros?.length ?? 0,
        2000 * (p.qtd ?? p.numeros?.length ?? 0),
        p.numeros === null ? null : JSON.stringify(p.numeros),
        p.status === "approved" ? "2026-11-24T12:00:00.000Z" : null,
        "2026-11-24T11:00:00.000Z",
        p.expira_em ?? null,
        p.registrado_em,
        p.desconsiderado ? "2026-11-24T13:00:00.000Z" : null,
        p.desconsiderado ? "teste" : null,
      ),
    ),
  );
}

const CENARIO: PedidoBilhete[] = [
  {
    id: "P1",
    status: "approved",
    numeros: [1, 2, 3],
    affiliate_id: 101,
    registrado_em: "2026-11-24T10:00:00.000Z",
  },
  {
    id: "P2",
    status: "in_process",
    numeros: [4, 5],
    expira_em: FUTURO,
    registrado_em: "2026-11-24T10:01:00.000Z",
  },
  {
    id: "P3",
    status: "in_process",
    numeros: [6],
    expira_em: PASSADO,
    registrado_em: "2026-11-24T10:02:00.000Z",
  },
  {
    id: "P4",
    status: "expired",
    numeros: [7],
    registrado_em: "2026-11-24T10:03:00.000Z",
  },
  {
    id: "P5",
    status: "approved",
    numeros: [8],
    desconsiderado: true,
    registrado_em: "2026-11-24T10:04:00.000Z",
  },
  {
    id: "P6",
    status: "approved",
    numeros: null,
    qtd: 2,
    registrado_em: "2026-11-24T10:05:00.000Z",
  },
  {
    id: "P7",
    status: "in_process",
    numeros: [3, 9],
    affiliate_id: 900,
    registrado_em: "2026-11-24T10:06:00.000Z",
  },
  {
    id: "P8",
    status: "approved",
    numeros: [25],
    registrado_em: "2026-11-24T10:07:00.000Z",
  },
];

async function semear(bilhetes: {
  quantidade: number;
  numero_inicial: 0 | 1 | null;
}) {
  await limparBanco();
  await semearHierarquia();
  const id = await semearCampanha(env.DB, { ...DADOS_CAMPANHA, bilhetes });
  await gravarPedidos(id, CENARIO);
  return id;
}

async function grade(): Promise<RespostaBilhetes> {
  const res = await pedir("/api/painel/bilhetes");
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const corpo: unknown = await res.json();
  return respostaBilhetesSchema.parse(corpo);
}

/** Os números de cada situação, pelos mapas da resposta. */
function numerosPorSituacao(r: RespostaBilhetes) {
  const pagos = mapaDeBase64(r.pagos);
  const reservados = mapaDeBase64(r.reservados);
  const saida = { pago: [] as number[], reservado: [] as number[] };
  for (let i = 0; i < r.quantidade; i += 1) {
    const s = situacaoNoIndice(pagos, reservados, i);
    if (s !== "livre") saida[s].push(r.numero_inicial + i);
  }
  return saida;
}

describe("GET /api/painel/bilhetes (RIFA-075)", () => {
  beforeEach(async () => {
    await semear({ quantidade: 20, numero_inicial: null });
  });

  it("sem campanha ativa: 404 nao_encontrado", async () => {
    await limparBanco();
    const res = await pedir("/api/painel/bilhetes");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      erro: { codigo: "nao_encontrado" },
    });
  });

  it("pago, reservado (não vencido) e livre; pago vence reservado; desconsiderado, vencido e expirado ficam livres", async () => {
    const r = await grade();
    expect(numerosPorSituacao(r)).toEqual({
      pago: [1, 2, 3],
      reservado: [4, 5, 9],
    });
    expect(r).toMatchObject({
      quantidade: 20,
      numero_inicial: 1,
      numero_inicial_automatico: true,
      contagem: { pagos: 3, reservados: 3, livres: 14 },
      vendido_bp: 1500,
      // O P6 (recuperado, sem números) fica no aviso; o 25 do P8 está fora da faixa de 1 a 20.
      sem_numeros: { pedidos: 1, bilhetes: 2 },
      fora_da_faixa: 1,
      atualizado_em: AGORA.toISOString(),
    });
    // 20 números = 3 bytes por mapa.
    expect(mapaDeBase64(r.pagos)).toHaveLength(3);
  });

  it("número inicial automático: um pedido com o número 0 faz a grade começar em 0", async () => {
    const campanha = await env.DB.prepare(
      "SELECT id FROM campanhas WHERE ativa = 1",
    ).first<{ id: number }>();
    await gravarPedidos(campanha!.id, [
      {
        id: "P9",
        status: "approved",
        numeros: [0],
        registrado_em: "2026-11-24T10:08:00.000Z",
      },
    ]);
    const r = await grade();
    expect(r.numero_inicial).toBe(0);
    expect(numerosPorSituacao(r).pago).toEqual([0, 1, 2, 3]);
  });

  it("número inicial configurado: o 0 de um pedido fica fora da faixa", async () => {
    const id = await semear({ quantidade: 30, numero_inicial: 1 });
    await gravarPedidos(id, [
      {
        id: "P9",
        status: "approved",
        numeros: [0],
        registrado_em: "2026-11-24T10:08:00.000Z",
      },
    ]);
    const r = await grade();
    expect(r).toMatchObject({
      numero_inicial: 1,
      numero_inicial_automatico: false,
      fora_da_faixa: 1,
      contagem: { pagos: 4, reservados: 3, livres: 23 },
    });
    expect(numerosPorSituacao(r).pago).toEqual([1, 2, 3, 25]);
  });

  it.each([
    { inicial: 1 as const, ultimo: 20, depois: 21 },
    { inicial: 0 as const, ultimo: 19, depois: 20 },
  ])(
    "último número (revisão): começando em $inicial, o $ultimo entra na grade e o $depois fica fora",
    async ({ inicial, ultimo, depois }) => {
      await limparBanco();
      const id = await semearCampanha(env.DB, {
        ...DADOS_CAMPANHA,
        bilhetes: { quantidade: 20, numero_inicial: inicial },
      });
      await gravarPedidos(id, [
        {
          id: "U1",
          status: "approved",
          numeros: [inicial, ultimo, depois],
          registrado_em: "2026-11-24T10:00:00.000Z",
        },
      ]);
      const r = await grade();
      expect(numerosPorSituacao(r).pago).toEqual([inicial, ultimo]);
      expect(r).toMatchObject({
        fora_da_faixa: 1,
        contagem: { pagos: 2, reservados: 0, livres: 18 },
      });
    },
  );

  it("número recomprado (revisão): expirado e depois pago fica pago; expirado e depois reservado fica reservado", async () => {
    const campanha = await env.DB.prepare(
      "SELECT id FROM campanhas WHERE ativa = 1",
    ).first<{ id: number }>();
    await gravarPedidos(campanha!.id, [
      {
        id: "R1",
        status: "approved",
        numeros: [7],
        registrado_em: "2026-11-24T10:10:00.000Z",
      },
      {
        id: "R2",
        status: "in_process",
        numeros: [6],
        expira_em: FUTURO,
        registrado_em: "2026-11-24T10:11:00.000Z",
      },
    ]);
    const r = await grade();
    // 7: P4 expirado e R1 pago; 6: P3 vencido e R2 reservado.
    expect(numerosPorSituacao(r)).toEqual({
      pago: [1, 2, 3, 7],
      reservado: [4, 5, 6, 9],
    });
    expect(await (await pedir("/api/painel/bilhetes/7")).json()).toMatchObject({
      situacao: "pago",
      pedidos: [
        { id: "R1", situacao: "pago" },
        { id: "P4", situacao: "expirado" },
      ],
    });
  });
});

describe("GET /api/painel/bilhetes/:numero (RIFA-075)", () => {
  beforeEach(async () => {
    await semear({ quantidade: 20, numero_inicial: null });
  });

  const buscar = async (numero: number) => {
    const res = await pedir(`/api/painel/bilhetes/${numero}`);
    expect(res.status).toBe(200);
    return respostaBilheteSchema.parse(await res.json());
  };

  it("o número pago mostra os pedidos dele (célula, situação, data), o mais recente primeiro, sem dado do comprador", async () => {
    expect(await buscar(3)).toEqual({
      numero: 3,
      situacao: "pago",
      pedidos: [
        {
          id: "P7",
          situacao: "reservado",
          celula: null,
          data: "2026-11-24T11:00:00.000Z",
          qtd_bilhetes: 2,
          desconsiderado: false,
        },
        {
          id: "P1",
          situacao: "pago",
          celula: "Célula Ágape",
          data: "2026-11-24T12:00:00.000Z",
          qtd_bilhetes: 3,
          desconsiderado: false,
        },
      ],
    });
  });

  it("vencido sem aviso da Rifei e expirado: livres, com o pedido como expirado; desconsiderado: livre e marcado", async () => {
    expect(await buscar(6)).toMatchObject({
      situacao: "livre",
      pedidos: [{ id: "P3", situacao: "expirado" }],
    });
    expect(await buscar(7)).toMatchObject({
      situacao: "livre",
      pedidos: [{ id: "P4", situacao: "expirado" }],
    });
    expect(await buscar(8)).toMatchObject({
      situacao: "livre",
      pedidos: [{ id: "P5", situacao: "pago", desconsiderado: true }],
    });
    expect(await buscar(4)).toMatchObject({ situacao: "reservado" });
    expect(await buscar(15)).toEqual({
      numero: 15,
      situacao: "livre",
      pedidos: [],
    });
  });

  it("número inválido: 400 requisicao_invalida", async () => {
    for (const caminho of ["abc", "-1", "1.5", "1000001"]) {
      const res = await pedir(`/api/painel/bilhetes/${caminho}`);
      expect({ caminho, status: res.status }).toEqual({ caminho, status: 400 });
    }
  });
});

describe("desempenho com 100.000 números (RIFA-075)", () => {
  it("20.000 pedidos de 5 números: a grade sai compacta e rápida, e a busca por número também", async () => {
    await limparBanco();
    const id = await semearCampanha(env.DB, {
      ...DADOS_CAMPANHA,
      bilhetes: { quantidade: 100_000, numero_inicial: 1 },
    });
    // Um pedido em cada 4 está reservado; os outros, pagos.
    await env.DB.prepare(
      `WITH RECURSIVE s(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM s WHERE i < 19999)
       INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, numeros, aprovado_em, expira_em)
       SELECT 'C' || i, ?1, CASE WHEN i % 4 = 0 THEN 'in_process' ELSE 'approved' END, 5, 10000,
         json_array(i * 5 + 1, i * 5 + 2, i * 5 + 3, i * 5 + 4, i * 5 + 5),
         CASE WHEN i % 4 = 0 THEN NULL ELSE '2026-11-24T12:00:00.000Z' END,
         CASE WHEN i % 4 = 0 THEN '2999-01-01T00:00:00.000Z' END
       FROM s`,
    )
      .bind(id)
      .run();

    const inicio = performance.now();
    const res = await pedir("/api/painel/bilhetes");
    const texto = await res.text();
    const tempo = performance.now() - inicio;
    expect(res.status).toBe(200);
    const r = respostaBilhetesSchema.parse(JSON.parse(texto));
    expect(r.contagem).toEqual({
      pagos: 75_000,
      reservados: 25_000,
      livres: 0,
    });
    expect(r.vendido_bp).toBe(7500);
    // Dois mapas de 12.500 bytes em base64 (~16,7 KB cada).
    expect(texto.length).toBeLessThan(40_000);

    const inicioBusca = performance.now();
    const busca = await pedir("/api/painel/bilhetes/99999");
    const tempoBusca = performance.now() - inicioBusca;
    expect(respostaBilheteSchema.parse(await busca.json())).toMatchObject({
      situacao: "pago",
      pedidos: [{ id: "C19999", situacao: "pago" }],
    });

    console.log(
      `bilhetes 100k: grade ${tempo.toFixed(0)} ms, ${texto.length} bytes; busca ${tempoBusca.toFixed(0)} ms`,
    );
    // Teto folgado (o relógio do workerd é de parede e a suíte roda em paralelo): só pega um desastre.
    expect(tempo).toBeLessThan(5_000);
    expect(tempoBusca).toBeLessThan(5_000);
  });
});
