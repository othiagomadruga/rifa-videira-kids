// GET /api/admin/afiliados, PUT /api/admin/afiliados/:affiliateId e GET /api/admin/adesao (docs/api.md),
// com o D1 dos testes. O banco é do arquivo de teste (compartilhado entre os testes dele): o beforeEach
// limpa as tabelas.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  afiliadoResumoSchema,
  erroApiSchema,
  respostaAdesaoSchema,
  respostaListaAfiliadosSchema,
  type CodigoErro,
} from "../../shared/contracts";
import { PREFIXO_AFILIADOS_ADESAO, afiliadosAdesao } from "./afiliados-adesao";

// O sub-app montado como o index.ts vai montar: sob /api/admin (o login da coordenação fica na frente).
const app = new Hono<{ Bindings: Cloudflare.Env }>().route(
  PREFIXO_AFILIADOS_ADESAO,
  afiliadosAdesao,
);
const db = env.DB;

interface Resposta {
  status: number;
  corpo: unknown;
}

async function chamar(
  metodo: "GET" | "PUT",
  caminho: string,
  corpo?: unknown,
  opcoes: {
    /** Corpo enviado como está (sem JSON.stringify). */
    corpoBruto?: string;
    /** null = sem Content-Type. Padrão: application/json quando há corpo. */
    contentType?: string | null;
    db?: D1Database;
  } = {},
): Promise<Resposta> {
  const headers = new Headers();
  const temCorpo = corpo !== undefined || opcoes.corpoBruto !== undefined;
  const contentType =
    opcoes.contentType === undefined ? "application/json" : opcoes.contentType;
  if (temCorpo && contentType !== null)
    headers.set("Content-Type", contentType);
  const resposta = await app.request(
    caminho,
    {
      method: metodo,
      headers,
      body:
        opcoes.corpoBruto ??
        (corpo === undefined ? undefined : JSON.stringify(corpo)),
    },
    { ...env, DB: opcoes.db ?? db },
  );
  const texto = await resposta.text();
  return {
    status: resposta.status,
    corpo: texto === "" ? null : JSON.parse(texto),
  };
}

/** Confere o corpo com o schema do contrato, sem campos a mais, e devolve o valor tipado. */
function conforme<S extends z.ZodType>(schema: S, corpo: unknown): z.output<S> {
  const valor = schema.parse(corpo);
  expect(corpo).toEqual(valor);
  return valor;
}

/** Confere status e código no formato único de erro e devolve o erro. */
function esperarErro(resposta: Resposta, status: number, codigo: CodigoErro) {
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status,
    corpo: { erro: { codigo } },
  });
  return erroApiSchema.parse(resposta.corpo).erro;
}

async function listarAfiliados(consulta = "") {
  const resposta = await chamar("GET", `/api/admin/afiliados${consulta}`);
  expect(resposta.status).toBe(200);
  return conforme(respostaListaAfiliadosSchema, resposta.corpo);
}

async function salvarAfiliado(affiliateId: number, corpo: unknown) {
  const resposta = await chamar(
    "PUT",
    `/api/admin/afiliados/${affiliateId}`,
    corpo,
  );
  expect(resposta.status).toBe(200);
  return conforme(afiliadoResumoSchema, resposta.corpo);
}

async function obterAdesao() {
  const resposta = await chamar("GET", "/api/admin/adesao");
  expect(resposta.status).toBe(200);
  return conforme(respostaAdesaoSchema, resposta.corpo);
}

// ---------------------------------------------------------------------------------------------------
// Cenário (direto no banco, como o webhook e a hierarquia gravariam)
// ---------------------------------------------------------------------------------------------------

async function limparBanco() {
  await db.batch(
    [
      "webhook_eventos",
      "pedidos",
      "afiliados",
      "celulas",
      "discipuladores",
      "redes",
      "campanha_periodos",
      "campanhas",
    ].map((tabela) => db.prepare(`DELETE FROM ${tabela}`)),
  );
}

async function inserir(sql: string, ...valores: (string | number | null)[]) {
  const linha = await db
    .prepare(`${sql} RETURNING id`)
    .bind(...valores)
    .first<{ id: number }>();
  if (!linha) throw new Error(`sem id: ${sql}`);
  return linha.id;
}

async function criarCampanha() {
  return inserir(
    `INSERT INTO campanhas (nome, slug_rifei, data_inicio, preco_bilhete_centavos, meta_unidade,
       meta_regra, meta_valor, ranking_criterio)
     VALUES ('Rifa de teste', 'rifa-de-teste', '2026-11-23', 1800, 'bilhetes', 'por_pessoa', 10,
       'percentual_meta')`,
  );
}

async function criarHierarquia() {
  const jovens = await inserir(
    "INSERT INTO redes (nome, divisao) VALUES ('Rede Jovem Ficticia', 'jovens')",
  );
  const adultos = await inserir(
    "INSERT INTO redes (nome, divisao) VALUES ('Rede Adulta Ficticia', 'adultos')",
  );
  const discipuladorA = await inserir(
    "INSERT INTO discipuladores (rede_id, nome) VALUES (?, 'Discipulador Ficticio A')",
    jovens,
  );
  const discipuladorB = await inserir(
    "INSERT INTO discipuladores (rede_id, nome) VALUES (?, 'Discipulador Ficticio B')",
    adultos,
  );
  const celula = (
    discipulador: number,
    nome: string,
    pessoas: number,
    telefone: string | null,
  ) =>
    inserir(
      `INSERT INTO celulas (discipulador_id, nome, qtd_pessoas, lider_nome, lider_telefone)
       VALUES (?, ?, ?, ?, ?)`,
      discipulador,
      nome,
      pessoas,
      `Lider da ${nome}`,
      telefone,
    );
  return {
    redes: { jovens, adultos },
    discipuladores: { a: discipuladorA, b: discipuladorB },
    celulas: {
      betel: await celula(discipuladorA, "Célula Betel", 12, "(91) 90000-0002"),
      agape: await celula(discipuladorA, "Célula Ágape", 9, "(91) 90000-0001"),
      dez: await celula(discipuladorB, "Célula 10", 15, "(91) 90000-0010"),
      dois: await celula(discipuladorB, "Célula 2", 7, null),
    },
  };
}

async function criarAfiliado(
  affiliateId: number,
  dados: {
    celulaId?: number | null;
    origem?: "webhook" | "manual";
    criadoEm: string;
    vinculadoEm?: string | null;
    rotulo?: string | null;
  },
) {
  await db
    .prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, rotulo, origem, criado_em, vinculado_em,
         atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      affiliateId,
      dados.celulaId ?? null,
      dados.rotulo ?? null,
      dados.origem ?? "webhook",
      dados.criadoEm,
      dados.vinculadoEm ?? null,
      dados.criadoEm,
    )
    .run();
}

async function criarPedido(
  id: string,
  dados: {
    campanhaId: number;
    affiliateId: number | null;
    status: "in_process" | "approved" | "expired";
    bilhetes: number;
    totalCentavos: number;
    aprovadoEm?: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos,
         aprovado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      dados.campanhaId,
      dados.affiliateId,
      dados.status,
      dados.bilhetes,
      dados.totalCentavos,
      dados.aprovadoEm ?? null,
    )
    .run();
}

async function linhaDoAfiliado(affiliateId: number) {
  return db
    .prepare("SELECT * FROM afiliados WHERE affiliate_id = ?")
    .bind(affiliateId)
    .first();
}

async function vendasNaView() {
  const { results } = await db
    .prepare(
      "SELECT pedido_id, affiliate_id, celula_id FROM vendas_aprovadas ORDER BY pedido_id",
    )
    .all();
  return results;
}

const SEM_VENDAS = { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 };

/** O instante (ISO, UTC) está entre `antes` e `depois`, inclusive: a ordem alfabética é a cronológica. */
function entre(instante: string | null, antes: string, depois: string) {
  return instante !== null && instante >= antes && instante <= depois;
}

beforeEach(limparBanco);
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------
// CA1: GET /api/admin/afiliados
// ---------------------------------------------------------------------------------------------------

describe("CA1: GET /api/admin/afiliados", () => {
  it("lista os afiliados com as vendas aprovadas e soma as vendas sem afiliado (formato do contrato)", async () => {
    const campanhaId = await criarCampanha();
    const { celulas } = await criarHierarquia();
    await criarAfiliado(1001, {
      celulaId: celulas.agape,
      origem: "manual",
      criadoEm: "2026-11-11T21:00:00.000Z",
      vinculadoEm: "2026-11-11T21:00:00.000Z",
      rotulo: "usuário Rifei do líder",
    });
    await criarAfiliado(1043, { criadoEm: "2026-11-11T22:30:00.000Z" });
    await criarAfiliado(1044, { criadoEm: "2026-11-11T22:31:00.000Z" });
    // 1001: duas vendas aprovadas e uma expirada (não conta).
    await criarPedido("P-1", {
      campanhaId,
      affiliateId: 1001,
      status: "approved",
      bilhetes: 2,
      totalCentavos: 3600,
      aprovadoEm: "2026-11-23T13:41:09.877Z",
    });
    await criarPedido("P-2", {
      campanhaId,
      affiliateId: 1001,
      status: "approved",
      bilhetes: 3,
      totalCentavos: 5400,
      aprovadoEm: "2026-11-24T10:00:00.000Z",
    });
    await criarPedido("P-3", {
      campanhaId,
      affiliateId: 1001,
      status: "expired",
      bilhetes: 10,
      totalCentavos: 18000,
    });
    // 1043: a compra de teste da reunião (sem pagar) não é venda.
    await criarPedido("P-4", {
      campanhaId,
      affiliateId: 1043,
      status: "in_process",
      bilhetes: 1,
      totalCentavos: 1800,
    });
    // Sem afiliado: uma aprovada (entra em sem_afiliado) e uma em processo (não entra).
    await criarPedido("P-5", {
      campanhaId,
      affiliateId: null,
      status: "approved",
      bilhetes: 4,
      totalCentavos: 7200,
      aprovadoEm: "2026-11-23T15:00:00.000Z",
    });
    await criarPedido("P-6", {
      campanhaId,
      affiliateId: null,
      status: "in_process",
      bilhetes: 5,
      totalCentavos: 9000,
    });

    const lista = await listarAfiliados();

    // Órfãos primeiro (o mais recente no topo), depois os vinculados.
    expect(lista.itens.map((item) => item.affiliate_id)).toEqual([
      1044, 1043, 1001,
    ]);
    expect(lista.itens[1]).toEqual({
      affiliate_id: 1043,
      celula_id: null,
      celula_nome: null,
      rotulo: null,
      origem: "webhook",
      criado_em: "2026-11-11T22:30:00.000Z",
      vinculado_em: null,
      atualizado_em: "2026-11-11T22:30:00.000Z",
      vendas: SEM_VENDAS,
      primeira_venda_em: null,
      ultima_venda_em: null,
    });
    expect(lista.itens[2]).toEqual({
      affiliate_id: 1001,
      celula_id: celulas.agape,
      celula_nome: "Célula Ágape",
      rotulo: "usuário Rifei do líder",
      origem: "manual",
      criado_em: "2026-11-11T21:00:00.000Z",
      vinculado_em: "2026-11-11T21:00:00.000Z",
      atualizado_em: "2026-11-11T21:00:00.000Z",
      vendas: { pedidos_aprovados: 2, bilhetes: 5, total_centavos: 9000 },
      primeira_venda_em: "2026-11-23T13:41:09.877Z",
      ultima_venda_em: "2026-11-24T10:00:00.000Z",
    });
    expect(lista.sem_afiliado).toEqual({
      pedidos_aprovados: 1,
      bilhetes: 4,
      total_centavos: 7200,
    });
  });

  it("?vinculado=false é a fila de órfãos (o mais recente no topo); ?vinculado=true, só os vinculados", async () => {
    const { celulas } = await criarHierarquia();
    await criarAfiliado(2001, { criadoEm: "2026-11-11T22:00:00.000Z" });
    await criarAfiliado(2003, { criadoEm: "2026-11-11T22:10:00.000Z" });
    // Mesmo instante: o affiliate_id maior (o que chegou depois na Rifei) vem antes.
    await criarAfiliado(2002, { criadoEm: "2026-11-11T22:10:00.000Z" });
    await criarAfiliado(3001, {
      celulaId: celulas.betel,
      criadoEm: "2026-11-11T21:00:00.000Z",
      vinculadoEm: "2026-11-11T21:05:00.000Z",
    });
    await criarAfiliado(3002, {
      celulaId: celulas.dez,
      criadoEm: "2026-11-11T21:30:00.000Z",
      vinculadoEm: "2026-11-11T21:35:00.000Z",
    });

    const orfaos = await listarAfiliados("?vinculado=false");
    expect(orfaos.itens.map((item) => item.affiliate_id)).toEqual([
      2003, 2002, 2001,
    ]);
    expect(orfaos.itens.every((item) => item.celula_id === null)).toBe(true);

    const vinculados = await listarAfiliados("?vinculado=true");
    expect(
      vinculados.itens.map((item) => [item.affiliate_id, item.celula_nome]),
    ).toEqual([
      [3002, "Célula 10"],
      [3001, "Célula Betel"],
    ]);
  });

  it("banco vazio: lista vazia e totais zerados", async () => {
    expect(await listarAfiliados()).toEqual({
      itens: [],
      sem_afiliado: SEM_VENDAS,
    });
  });

  it("consulta inválida: 400 requisicao_invalida com os problemas em detalhes", async () => {
    const erro = esperarErro(
      await chamar("GET", "/api/admin/afiliados?vinculado=talvez"),
      400,
      "requisicao_invalida",
    );
    expect(erro.detalhes).toEqual([
      expect.objectContaining({ caminho: ["vinculado"] }),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA1: PUT /api/admin/afiliados/:affiliateId
// ---------------------------------------------------------------------------------------------------

describe("CA1: PUT /api/admin/afiliados/:affiliateId", () => {
  it("vincula um órfão: célula e vinculado_em = agora; origem, criado_em e rótulo continuam", async () => {
    const { celulas } = await criarHierarquia();
    await criarAfiliado(1043, {
      criadoEm: "2026-11-11T22:30:00.000Z",
      rotulo: "conta do líder",
    });
    const antes = new Date().toISOString();

    const afiliado = await salvarAfiliado(1043, { celula_id: celulas.agape });

    const depois = new Date().toISOString();
    expect(afiliado).toEqual({
      affiliate_id: 1043,
      celula_id: celulas.agape,
      celula_nome: "Célula Ágape",
      rotulo: "conta do líder",
      origem: "webhook",
      criado_em: "2026-11-11T22:30:00.000Z",
      vinculado_em: expect.any(String),
      atualizado_em: afiliado.vinculado_em,
      vendas: SEM_VENDAS,
      primeira_venda_em: null,
      ultima_venda_em: null,
    });
    expect(entre(afiliado.vinculado_em, antes, depois)).toBe(true);
    expect((await listarAfiliados("?vinculado=false")).itens).toEqual([]);
  });

  it("troca de célula: vinculado_em passa a ser o da troca", async () => {
    const { celulas } = await criarHierarquia();
    await criarAfiliado(1001, {
      celulaId: celulas.agape,
      criadoEm: "2026-11-11T21:00:00.000Z",
      vinculadoEm: "2026-11-11T21:00:00.000Z",
    });

    const antes = new Date().toISOString();

    const afiliado = await salvarAfiliado(1001, { celula_id: celulas.betel });

    const depois = new Date().toISOString();
    expect(afiliado).toMatchObject({
      celula_id: celulas.betel,
      celula_nome: "Célula Betel",
      criado_em: "2026-11-11T21:00:00.000Z",
    });
    expect(entre(afiliado.vinculado_em, antes, depois)).toBe(true);
    expect(afiliado.vinculado_em).toBe(afiliado.atualizado_em);
  });

  it("a mesma célula de novo não muda vinculado_em (só o rótulo e atualizado_em)", async () => {
    const { celulas } = await criarHierarquia();
    await criarAfiliado(1001, {
      celulaId: celulas.agape,
      criadoEm: "2026-11-11T21:00:00.000Z",
      vinculadoEm: "2026-11-11T21:05:00.000Z",
    });

    const antes = new Date().toISOString();

    const afiliado = await salvarAfiliado(1001, {
      celula_id: celulas.agape,
      rotulo: "segunda conta do líder",
    });

    expect(afiliado).toMatchObject({
      celula_id: celulas.agape,
      vinculado_em: "2026-11-11T21:05:00.000Z",
      rotulo: "segunda conta do líder",
    });
    expect(afiliado.atualizado_em >= antes).toBe(true);
  });

  it("desvincula com celula_id null: o afiliado volta para a fila de órfãos", async () => {
    const { celulas } = await criarHierarquia();
    await criarAfiliado(1001, {
      celulaId: celulas.agape,
      criadoEm: "2026-11-11T21:00:00.000Z",
      vinculadoEm: "2026-11-11T21:00:00.000Z",
    });

    const afiliado = await salvarAfiliado(1001, { celula_id: null });

    expect(afiliado).toMatchObject({
      affiliate_id: 1001,
      celula_id: null,
      celula_nome: null,
      vinculado_em: null,
    });
    expect(
      (await listarAfiliados("?vinculado=false")).itens.map(
        (item) => item.affiliate_id,
      ),
    ).toEqual([1001]);
  });

  it("pré-cadastra um affiliate_id que ainda não vendeu (origem manual), já vinculado", async () => {
    const { celulas } = await criarHierarquia();
    const antes = new Date().toISOString();

    const afiliado = await salvarAfiliado(5005, {
      celula_id: celulas.dez,
      rotulo: "  líder informou na reunião  ",
    });

    expect(afiliado).toEqual({
      affiliate_id: 5005,
      celula_id: celulas.dez,
      celula_nome: "Célula 10",
      rotulo: "líder informou na reunião",
      origem: "manual",
      criado_em: expect.any(String),
      vinculado_em: afiliado.criado_em,
      atualizado_em: afiliado.criado_em,
      vendas: SEM_VENDAS,
      primeira_venda_em: null,
      ultima_venda_em: null,
    });
    expect(afiliado.criado_em >= antes).toBe(true);
    expect(await linhaDoAfiliado(5005)).toMatchObject({
      origem: "manual",
      celula_id: celulas.dez,
    });
  });

  it("pré-cadastro com celula_id null cria o afiliado não vinculado", async () => {
    const afiliado = await salvarAfiliado(5006, { celula_id: null });

    expect(afiliado).toMatchObject({
      affiliate_id: 5006,
      celula_id: null,
      origem: "manual",
      vinculado_em: null,
    });
  });

  it("rótulo: ausente mantém, null apaga e texto é gravado sem os espaços das pontas", async () => {
    const { celulas } = await criarHierarquia();
    await criarAfiliado(1001, {
      criadoEm: "2026-11-11T21:00:00.000Z",
      rotulo: "rótulo antigo",
    });

    expect(
      (await salvarAfiliado(1001, { celula_id: celulas.agape })).rotulo,
    ).toBe("rótulo antigo");
    expect(
      (await salvarAfiliado(1001, { celula_id: celulas.agape, rotulo: null }))
        .rotulo,
    ).toBeNull();
    expect(
      (
        await salvarAfiliado(1001, {
          celula_id: celulas.agape,
          rotulo: " novo ",
        })
      ).rotulo,
    ).toBe("novo");
  });

  it("célula inexistente: 400 referencia_invalida e nada muda (nem cria o afiliado)", async () => {
    const { celulas } = await criarHierarquia();
    await criarAfiliado(1001, {
      celulaId: celulas.agape,
      criadoEm: "2026-11-11T21:00:00.000Z",
      vinculadoEm: "2026-11-11T21:00:00.000Z",
    });
    const antes = await linhaDoAfiliado(1001);

    const erro = esperarErro(
      await chamar("PUT", "/api/admin/afiliados/1001", {
        celula_id: 999_999,
      }),
      400,
      "referencia_invalida",
    );
    expect(erro).toEqual({
      codigo: "referencia_invalida",
      mensagem: "A célula 999999 não existe",
      detalhes: [
        {
          caminho: ["celula_id"],
          codigo: "referencia_invalida",
          mensagem: "A célula 999999 não existe",
        },
      ],
    });
    expect(await linhaDoAfiliado(1001)).toEqual(antes);

    esperarErro(
      await chamar("PUT", "/api/admin/afiliados/7007", { celula_id: 999_999 }),
      400,
      "referencia_invalida",
    );
    expect(await linhaDoAfiliado(7007)).toBeNull();
  });

  it("parâmetro ou corpo fora do schema: 400 requisicao_invalida, sem gravar nada", async () => {
    const { celulas } = await criarHierarquia();

    for (const affiliateId of [
      "abc",
      "0",
      "-3",
      "1.5",
      "99999999999999999999",
    ]) {
      const erro = esperarErro(
        await chamar("PUT", `/api/admin/afiliados/${affiliateId}`, {
          celula_id: celulas.agape,
        }),
        400,
        "requisicao_invalida",
      );
      expect(erro.detalhes).toEqual([
        expect.objectContaining({ caminho: ["affiliateId"] }),
      ]);
    }

    const corposInvalidos: [unknown, string][] = [
      [{}, "celula_id"],
      [{ celula_id: String(celulas.agape) }, "celula_id"],
      [{ celula_id: 0 }, "celula_id"],
      [{ celula_id: 1.5 }, "celula_id"],
      [{ celula_id: celulas.agape, rotulo: "" }, "rotulo"],
      [{ celula_id: celulas.agape, rotulo: "   " }, "rotulo"],
      [{ celula_id: celulas.agape, rotulo: "x".repeat(121) }, "rotulo"],
      [{ celula_id: celulas.agape, rotulo: 7 }, "rotulo"],
    ];
    for (const [corpo, campo] of corposInvalidos) {
      const erro = esperarErro(
        await chamar("PUT", "/api/admin/afiliados/1043", corpo),
        400,
        "requisicao_invalida",
      );
      expect(erro.detalhes).toEqual([
        expect.objectContaining({ caminho: [campo] }),
      ]);
    }
    expect(await linhaDoAfiliado(1043)).toBeNull();
  });

  it("corpo que não é JSON: 400 json_invalido (malformado, vazio ou sem Content-Type)", async () => {
    const malformado = esperarErro(
      await chamar("PUT", "/api/admin/afiliados/1043", undefined, {
        corpoBruto: '{"celula_id": ',
      }),
      400,
      "json_invalido",
    );
    expect(malformado.mensagem).toBe(
      "O corpo da requisição não é um JSON válido",
    );
    esperarErro(
      await chamar("PUT", "/api/admin/afiliados/1043", undefined, {
        corpoBruto: "",
      }),
      400,
      "json_invalido",
    );
    esperarErro(
      await chamar(
        "PUT",
        "/api/admin/afiliados/1043",
        { celula_id: null },
        { contentType: null },
      ),
      400,
      "json_invalido",
    );
    expect(await linhaDoAfiliado(1043)).toBeNull();
  });

  it("falha inesperada do banco: 500 erro_interno no formato único, com registro no log", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const dbComFalha = {
      prepare: () => {
        throw new Error("D1 indisponível");
      },
    } as unknown as D1Database;

    for (const [metodo, caminho, corpo] of [
      ["GET", "/api/admin/afiliados", undefined],
      ["PUT", "/api/admin/afiliados/1043", { celula_id: null }],
      ["GET", "/api/admin/adesao", undefined],
    ] as const) {
      const erro = esperarErro(
        await chamar(metodo, caminho, corpo, { db: dbComFalha }),
        500,
        "erro_interno",
      );
      expect(erro).toEqual({
        codigo: "erro_interno",
        mensagem: "Erro interno",
      });
    }
    expect(consoleError).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA2: vincular reatribui as vendas na hora (view vendas_aprovadas, D7)
// ---------------------------------------------------------------------------------------------------

describe("CA2: vincular, trocar e desvincular reatribuem as vendas na hora", () => {
  it("as vendas aprovadas do afiliado seguem a célula dele pela view, sem mudar os pedidos", async () => {
    const campanhaId = await criarCampanha();
    const { celulas } = await criarHierarquia();
    // O líder vendeu antes de ser vinculado: as vendas ficam "sem célula".
    await criarAfiliado(1043, { criadoEm: "2026-11-23T12:00:00.000Z" });
    await criarPedido("V-1", {
      campanhaId,
      affiliateId: 1043,
      status: "approved",
      bilhetes: 2,
      totalCentavos: 3600,
      aprovadoEm: "2026-11-23T13:00:00.000Z",
    });
    await criarPedido("V-2", {
      campanhaId,
      affiliateId: 1043,
      status: "approved",
      bilhetes: 1,
      totalCentavos: 1800,
      aprovadoEm: "2026-11-23T12:30:00.000Z",
    });
    await criarPedido("V-3", {
      campanhaId,
      affiliateId: 1043,
      status: "expired",
      bilhetes: 3,
      totalCentavos: 5400,
    });
    const pedidos = async () =>
      (await db.prepare("SELECT * FROM pedidos ORDER BY id").all()).results;
    const pedidosAntes = await pedidos();
    expect(pedidosAntes).toHaveLength(3);
    const celulaNaAdesao = async (celulaId: number) =>
      (await obterAdesao()).itens.find((item) => item.celula_id === celulaId);

    expect(await vendasNaView()).toEqual([
      { pedido_id: "V-1", affiliate_id: 1043, celula_id: null },
      { pedido_id: "V-2", affiliate_id: 1043, celula_id: null },
    ]);
    expect(await celulaNaAdesao(celulas.agape)).toMatchObject({
      pedidos_aprovados: 0,
      primeira_venda_em: null,
    });

    // Vincular: as duas vendas aprovadas passam para a Ágape na hora.
    const vinculado = await salvarAfiliado(1043, { celula_id: celulas.agape });
    expect(vinculado).toMatchObject({
      celula_nome: "Célula Ágape",
      vendas: { pedidos_aprovados: 2, bilhetes: 3, total_centavos: 5400 },
      primeira_venda_em: "2026-11-23T12:30:00.000Z",
      ultima_venda_em: "2026-11-23T13:00:00.000Z",
    });
    expect(await vendasNaView()).toEqual([
      { pedido_id: "V-1", affiliate_id: 1043, celula_id: celulas.agape },
      { pedido_id: "V-2", affiliate_id: 1043, celula_id: celulas.agape },
    ]);
    expect(await celulaNaAdesao(celulas.agape)).toMatchObject({
      afiliados: [1043],
      vinculada: true,
      pedidos_aprovados: 2,
      primeira_venda_em: "2026-11-23T12:30:00.000Z",
    });

    // Trocar: as vendas vão junto para a Betel e saem da Ágape.
    await salvarAfiliado(1043, { celula_id: celulas.betel });
    expect((await vendasNaView()).map((venda) => venda.celula_id)).toEqual([
      celulas.betel,
      celulas.betel,
    ]);
    expect(await celulaNaAdesao(celulas.betel)).toMatchObject({
      afiliados: [1043],
      pedidos_aprovados: 2,
      primeira_venda_em: "2026-11-23T12:30:00.000Z",
    });
    expect(await celulaNaAdesao(celulas.agape)).toMatchObject({
      afiliados: [],
      vinculada: false,
      pedidos_aprovados: 0,
      primeira_venda_em: null,
    });

    // Desvincular: as vendas voltam a ficar sem célula.
    await salvarAfiliado(1043, { celula_id: null });
    expect((await vendasNaView()).map((venda) => venda.celula_id)).toEqual([
      null,
      null,
    ]);
    expect((await obterAdesao()).resumo).toMatchObject({
      vinculadas: 0,
      com_venda: 0,
      afiliados_nao_vinculados: 1,
    });

    // A célula é resolvida na leitura: nenhum pedido foi alterado.
    expect(await pedidos()).toEqual(pedidosAntes);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA1: GET /api/admin/adesao
// ---------------------------------------------------------------------------------------------------

describe("CA1: GET /api/admin/adesao", () => {
  it("resumo e uma linha por célula, em ordem de nome (pt-BR), no formato do contrato", async () => {
    const campanhaId = await criarCampanha();
    const { celulas, discipuladores, redes } = await criarHierarquia();
    // Betel: dois afiliados (o líder tem duas contas); as vendas dos dois somam na célula.
    await criarAfiliado(1002, {
      celulaId: celulas.betel,
      criadoEm: "2026-11-11T21:00:00.000Z",
      vinculadoEm: "2026-11-11T21:00:00.000Z",
    });
    await criarAfiliado(1001, {
      celulaId: celulas.betel,
      criadoEm: "2026-11-11T21:01:00.000Z",
      vinculadoEm: "2026-11-11T21:01:00.000Z",
    });
    // Ágape: vinculada, mas só com a compra de teste (não é venda).
    await criarAfiliado(1003, {
      celulaId: celulas.agape,
      criadoEm: "2026-11-11T21:02:00.000Z",
      vinculadoEm: "2026-11-11T21:02:00.000Z",
    });
    // Dois órfãos.
    await criarAfiliado(1043, { criadoEm: "2026-11-11T22:30:00.000Z" });
    await criarAfiliado(1044, { criadoEm: "2026-11-11T22:31:00.000Z" });
    await criarPedido("A-1", {
      campanhaId,
      affiliateId: 1001,
      status: "approved",
      bilhetes: 2,
      totalCentavos: 3600,
      aprovadoEm: "2026-11-23T15:00:00.000Z",
    });
    await criarPedido("A-2", {
      campanhaId,
      affiliateId: 1002,
      status: "approved",
      bilhetes: 1,
      totalCentavos: 1800,
      aprovadoEm: "2026-11-23T14:00:00.000Z",
    });
    await criarPedido("A-3", {
      campanhaId,
      affiliateId: 1003,
      status: "in_process",
      bilhetes: 1,
      totalCentavos: 1800,
    });
    // Venda de órfão: não conta para nenhuma célula.
    await criarPedido("A-4", {
      campanhaId,
      affiliateId: 1043,
      status: "approved",
      bilhetes: 1,
      totalCentavos: 1800,
      aprovadoEm: "2026-11-23T13:00:00.000Z",
    });

    const adesao = await obterAdesao();

    expect(adesao.resumo).toEqual({
      celulas: 4,
      vinculadas: 2,
      com_venda: 1,
      afiliados_nao_vinculados: 2,
    });
    expect(adesao.itens.map((item) => item.celula_nome)).toEqual([
      "Célula 2",
      "Célula 10",
      "Célula Ágape",
      "Célula Betel",
    ]);
    expect(adesao.itens[0]).toEqual({
      celula_id: celulas.dois,
      celula_nome: "Célula 2",
      qtd_pessoas: 7,
      lider_nome: "Lider da Célula 2",
      lider_telefone: null,
      discipulador_id: discipuladores.b,
      discipulador_nome: "Discipulador Ficticio B",
      rede_id: redes.adultos,
      rede_nome: "Rede Adulta Ficticia",
      divisao: "adultos",
      afiliados: [],
      vinculada: false,
      primeira_venda_em: null,
      pedidos_aprovados: 0,
    });
    expect(adesao.itens[2]).toMatchObject({
      celula_nome: "Célula Ágape",
      afiliados: [1003],
      vinculada: true,
      primeira_venda_em: null,
      pedidos_aprovados: 0,
    });
    expect(adesao.itens[3]).toEqual({
      celula_id: celulas.betel,
      celula_nome: "Célula Betel",
      qtd_pessoas: 12,
      lider_nome: "Lider da Célula Betel",
      lider_telefone: "(91) 90000-0002",
      discipulador_id: discipuladores.a,
      discipulador_nome: "Discipulador Ficticio A",
      rede_id: redes.jovens,
      rede_nome: "Rede Jovem Ficticia",
      divisao: "jovens",
      afiliados: [1001, 1002],
      vinculada: true,
      primeira_venda_em: "2026-11-23T14:00:00.000Z",
      pedidos_aprovados: 2,
    });
  });

  it("sem células: resumo zerado, mas conta os afiliados não vinculados", async () => {
    await criarAfiliado(1043, { criadoEm: "2026-11-11T22:30:00.000Z" });

    expect(await obterAdesao()).toEqual({
      resumo: {
        celulas: 0,
        vinculadas: 0,
        com_venda: 0,
        afiliados_nao_vinculados: 1,
      },
      itens: [],
    });
  });
});
