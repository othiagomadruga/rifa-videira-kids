// CA1 (RIFA-025, D16): GET /api/admin/pedidos no app real (exports.default.fetch), com a sessão da coordenação.
// Ordem (registrado mais novo primeiro, empate pelo id), cursor opaco sem repetir nem pular, filtros (status,
// célula resolvida pelo afiliado na leitura, sem célula, id), totais só na primeira página, suspeito, sem
// campanha ativa e 400 no cursor inválido. Toda resposta 200 passa pelo schema ESTRITO do contrato (nenhum
// campo a mais, logo nenhum dado do comprador além do DDD). Também: os três endpoints da RIFA-025 exigem a
// sessão da coordenação (sem sessão 401; líder, discipulador e rede 403).
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ROTAS,
  respostaPedidosSchema,
  type RespostaPedidos,
} from "../../shared/contracts";
import { codificarCursorPedidos } from "../db/lista-pedidos";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
  erro,
} from "../test/acesso-teste";

const db = env.DB;
let coordenacao: Record<string, string>;
let celulaA: number;
let celulaB: number;
let discipuladorId: number;
let redeId: number;

/** Todos os pedidos da campanha ativa, na ordem esperada da lista. */
const ORDEM = [
  "P-10",
  "P-09",
  "P-07",
  "P-06",
  "P-05",
  "P-04",
  "P-03",
  "P-02",
  "P-01",
];

async function limpar() {
  await db.batch(
    [
      "pedidos_suspeitos",
      "webhook_eventos",
      "pedidos",
      "afiliados",
      "campanha_periodos",
      "campanhas",
    ].map((tabela) => db.prepare(`DELETE FROM ${tabela}`)),
  );
}

async function semear() {
  await limpar();
  const [ativa, outra] = await db.batch<{ id: number }>([
    db.prepare(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
         meta_regra, meta_valor, ranking_criterio)
       VALUES ('Campanha dos pedidos', 'campanha-dos-pedidos', 1, '2026-11-23', 2000, 'bilhetes', 'por_pessoa',
         10, 'percentual_meta') RETURNING id`,
    ),
    db.prepare(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
         meta_regra, meta_valor, ranking_criterio)
       VALUES ('Outra edição', 'outra-edicao-dos-pedidos', 0, '2025-11-23', 2000, 'bilhetes', 'por_pessoa',
         10, 'percentual_meta') RETURNING id`,
    ),
  ]);
  const campanha = ativa.results[0].id;
  const outraCampanha = outra.results[0].id;
  // 9101 → célula A, 9102 → célula B, 9103 órfão (sem célula).
  await db.batch([
    db
      .prepare(
        `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em) VALUES
           (9101, ?1, 'manual', '2026-11-20T12:00:00.000Z'),
           (9102, ?2, 'manual', '2026-11-20T12:00:00.000Z'),
           (9103, NULL, 'webhook', NULL)`,
      )
      .bind(celulaA, celulaB),
    db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, ddd, pais,
           criado_em, aprovado_em, expirado_em, registrado_em, atualizado_em) VALUES
           ('P-01', ?1, 9101, 'approved', 1, 2000, '91', '55', '2026-11-24T09:59:00.000Z',
             '2026-11-24T10:05:00.000Z', NULL, '2026-11-24T10:00:00.000Z', '2026-11-24T10:05:00.000Z'),
           ('P-02', ?1, 9101, 'in_process', 2, 4000, NULL, NULL, NULL, NULL, NULL,
             '2026-11-24T11:00:00.000Z', '2026-11-24T11:00:00.000Z'),
           ('P-03', ?1, 9102, 'approved', 3, 6000, '11', '55', NULL, '2026-11-24T11:10:00.000Z', NULL,
             '2026-11-24T11:00:00.000Z', '2026-11-24T11:10:00.000Z'),
           ('P-04', ?1, NULL, 'expired', 4, 8000, NULL, '351', NULL, NULL, '2026-11-24T12:30:00.000Z',
             '2026-11-24T12:00:00.000Z', '2026-11-24T12:30:00.000Z'),
           ('P-05', ?1, 9103, 'approved', 5, 10000, '91', '55', NULL, '2026-11-24T13:05:00.000Z', NULL,
             '2026-11-24T13:00:00.000Z', '2026-11-24T13:05:00.000Z'),
           ('P-06', ?1, 9101, 'approved', 6, 12000, '91', '55', NULL, '2026-11-24T13:06:00.000Z', NULL,
             '2026-11-24T13:00:00.000Z', '2026-11-24T13:06:00.000Z'),
           ('P-07', ?1, 9102, 'expired', 7, 14000, NULL, NULL, NULL, NULL, '2026-11-24T14:30:00.000Z',
             '2026-11-24T14:00:00.000Z', '2026-11-24T14:30:00.000Z'),
           ('P-09', ?1, NULL, 'in_process', 9, 18000, NULL, NULL, NULL, NULL, NULL,
             '2026-11-24T15:00:00.000Z', '2026-11-24T15:00:00.000Z'),
           ('P-10', ?1, 9101, 'approved', 10, 900, '91', '55', '2026-11-24T14:59:00.000Z',
             '2026-11-24T15:01:00.000Z', NULL, '2026-11-24T15:00:00.000Z', '2026-11-24T15:01:00.000Z'),
           ('X-01', ?2, 9101, 'approved', 1, 2000, NULL, NULL, NULL, '2025-11-24T16:00:00.000Z', NULL,
             '2026-11-24T16:00:00.000Z', '2026-11-24T16:00:00.000Z')`,
      )
      .bind(campanha, outraCampanha),
    db.prepare(
      `INSERT INTO pedidos_suspeitos (pedido_id, qtd_bilhetes, total_centavos, esperado_centavos, motivos, marcado_em)
       VALUES ('P-10', 10, 900, 20000,
         '[{"caminho":["total"],"codigo":"total_abaixo_do_esperado","mensagem":"x","ocorrencias":1}]',
         '2026-11-24T15:01:00.000Z')`,
    ),
  ]);
}

async function chamar(consulta = "", cabecalhos = coordenacao) {
  return exports.default.fetch(
    `${ORIGEM}${ROTAS.listarPedidos.caminho}${consulta}`,
    { headers: cabecalhos },
  );
}

/** A resposta 200, conferida no schema estrito do contrato. */
async function listar(consulta = ""): Promise<RespostaPedidos> {
  const res = await chamar(consulta);
  expect(res.status).toBe(200);
  const corpo: unknown = await res.json();
  return respostaPedidosSchema.parse(corpo);
}

const ids = (resposta: RespostaPedidos) =>
  resposta.itens.map((item) => item.id);

/** Percorre a lista inteira pelo cursor; devolve os ids e as respostas de cada página. */
async function percorrer(consulta: string) {
  const paginas: RespostaPedidos[] = [];
  let antesDe: string | null = null;
  do {
    const sufixo: string =
      antesDe === null ? "" : `&antes_de=${encodeURIComponent(antesDe)}`;
    const pagina = await listar(`?${consulta}${sufixo}`);
    paginas.push(pagina);
    antesDe = pagina.proximo;
  } while (antesDe !== null && paginas.length < 50);
  return { ids: paginas.flatMap(ids), paginas };
}

beforeAll(async () => {
  coordenacao = await cabecalhosDeSessao("coordenacao");
  const [rede] = await db.batch<{ id: number }>([
    db.prepare(
      "INSERT INTO redes (nome, divisao) VALUES ('Rede Ficticia dos Pedidos', 'jovens') RETURNING id",
    ),
  ]);
  redeId = rede.results[0].id;
  const discipulador = await db
    .prepare(
      "INSERT INTO discipuladores (rede_id, nome) VALUES (?1, 'Discipulador Ficticio dos Pedidos') RETURNING id",
    )
    .bind(redeId)
    .first<{ id: number }>();
  discipuladorId = discipulador!.id;
  const [a, b] = await db.batch<{ id: number }>([
    db
      .prepare(
        `INSERT INTO celulas (discipulador_id, nome, qtd_pessoas, lider_nome, lider_email, lider_telefone)
         VALUES (?1, 'Célula Ágape dos Pedidos', 10, 'Lider Ficticio A', 'lider.a@example.com', '(91) 90000-0101')
         RETURNING id`,
      )
      .bind(discipuladorId),
    db
      .prepare(
        `INSERT INTO celulas (discipulador_id, nome, qtd_pessoas, lider_nome)
         VALUES (?1, 'Célula Betel dos Pedidos', 8, 'Lider Ficticio B') RETURNING id`,
      )
      .bind(discipuladorId),
  ]);
  celulaA = a.results[0].id;
  celulaB = b.results[0].id;
});

beforeEach(semear);

describe("ordem e campos", () => {
  it("do registrado mais novo para o mais antigo, empate pelo id (decrescente); só a campanha ativa", async () => {
    const resposta = await listar();
    expect(ids(resposta)).toEqual(ORDEM);
    expect(resposta.proximo).toBeNull();
  });

  it("cada item: a célula resolvida pelo afiliado (D7), o DDD, os instantes e suspeito; nada do líder nem do comprador", async () => {
    const res = await chamar();
    const texto = await res.text();
    const resposta = respostaPedidosSchema.parse(JSON.parse(texto));
    const porId = new Map(resposta.itens.map((item) => [item.id, item]));
    expect(porId.get("P-10")).toEqual({
      id: "P-10",
      status: "approved",
      qtd_bilhetes: 10,
      total_centavos: 900,
      affiliate_id: 9101,
      celula_id: celulaA,
      celula_nome: "Célula Ágape dos Pedidos",
      ddd: "91",
      criado_em: "2026-11-24T14:59:00.000Z",
      aprovado_em: "2026-11-24T15:01:00.000Z",
      expirado_em: null,
      registrado_em: "2026-11-24T15:00:00.000Z",
      atualizado_em: "2026-11-24T15:01:00.000Z",
      suspeito: true,
      // D20: o padrão do contrato até a API ler a desconsideração (migração 0008).
      desconsiderado: null,
    });
    // Sem afiliado e afiliado órfão: sem célula.
    expect(porId.get("P-04")).toMatchObject({
      affiliate_id: null,
      celula_id: null,
      celula_nome: null,
      ddd: null,
      expirado_em: "2026-11-24T12:30:00.000Z",
      suspeito: false,
    });
    expect(porId.get("P-05")).toMatchObject({
      affiliate_id: 9103,
      celula_id: null,
      celula_nome: null,
    });
    // O contato do líder da célula está no banco, mas não sai.
    for (const proibido of ["lider", "example.com", "90000-0101", "pais"])
      expect(texto).not.toContain(proibido);
  });
});

describe("cursor", () => {
  it.each([1, 2, 3, 4, 9, 10])(
    "com limite %i: percorre tudo sem repetir nem pular, e o último proximo é null",
    async (limite) => {
      const { ids: vistos, paginas } = await percorrer(`limite=${limite}`);
      expect(vistos).toEqual(ORDEM);
      expect(paginas).toHaveLength(
        Math.max(1, Math.ceil(ORDEM.length / limite)),
      );
      expect(paginas.at(-1)?.proximo).toBeNull();
    },
  );

  it("totais só na primeira página: com antes_de, null", async () => {
    const { paginas } = await percorrer("limite=4");
    expect(paginas[0].totais).not.toBeNull();
    expect(paginas.slice(1).map((pagina) => pagina.totais)).toEqual([
      null,
      null,
    ]);
  });

  it("com filtros: o cursor segue os mesmos filtros (status e célula)", async () => {
    expect((await percorrer("limite=2&status=approved")).ids).toEqual([
      "P-10",
      "P-06",
      "P-05",
      "P-03",
      "P-01",
    ]);
    expect((await percorrer(`limite=1&celula_id=${celulaA}`)).ids).toEqual([
      "P-10",
      "P-06",
      "P-02",
      "P-01",
    ]);
    expect((await percorrer("limite=2&sem_celula=true")).ids).toEqual([
      "P-09",
      "P-05",
      "P-04",
    ]);
  });

  it("estável: pedido novo e pedido alterado entre as páginas não repetem nem pulam linhas", async () => {
    const primeira = await listar("?limite=4");
    expect(ids(primeira)).toEqual(ORDEM.slice(0, 4));
    // Um pedido novo (registrado agora: vai para o topo) e uma mudança de status num da página 2 (registrado_em
    // não muda; D3/D4).
    await db.batch([
      db.prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, registrado_em,
           atualizado_em)
         SELECT 'P-11', id, NULL, 'in_process', 1, 2000, '2026-11-24T16:00:00.000Z', '2026-11-24T16:00:00.000Z'
         FROM campanhas WHERE ativa = 1`,
      ),
      db.prepare(
        `UPDATE pedidos SET status = 'expired', expirado_em = '2026-11-24T17:00:00.000Z',
           atualizado_em = '2026-11-24T17:00:00.000Z' WHERE id = 'P-04'`,
      ),
    ]);
    const segunda = await listar(
      `?limite=4&antes_de=${encodeURIComponent(primeira.proximo!)}`,
    );
    const terceira = await listar(
      `?limite=4&antes_de=${encodeURIComponent(segunda.proximo!)}`,
    );
    expect([...ids(segunda), ...ids(terceira)]).toEqual(ORDEM.slice(4));
    expect(terceira.proximo).toBeNull();
  });

  it("o proximo é o cursor do último item (base64url de [registrado_em, id])", async () => {
    const primeira = await listar("?limite=3");
    expect(primeira.proximo).toBe(
      codificarCursorPedidos({
        registrado_em: "2026-11-24T14:00:00.000Z",
        id: "P-07",
      }),
    );
    expect(primeira.proximo).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("id com acentos e caracteres de controle passa ida e volta no cursor", async () => {
    const id = "Pé-ção-\u0001-漢字-😀";
    await db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos, registrado_em, atualizado_em)
         SELECT ?1, id, 'in_process', 1, 2000, '2026-11-24T15:00:00.000Z', '2026-11-24T15:00:00.000Z'
         FROM campanhas WHERE ativa = 1`,
      )
      .bind(id)
      .run();
    // No empate de registrado_em com P-10 e P-09, o id decide ("Pé..." > "P-10" no binário).
    const { ids: vistos } = await percorrer("limite=1");
    expect(vistos).toEqual([id, ...ORDEM]);
  });
});

describe("filtros e totais", () => {
  it("status: só os do status, mas os totais continuam por status (sem o filtro de status)", async () => {
    const resposta = await listar("?status=approved");
    expect(ids(resposta)).toEqual(["P-10", "P-06", "P-05", "P-03", "P-01"]);
    expect(resposta.totais).toEqual({
      in_process: { pedidos: 2, bilhetes: 11, total_centavos: 22000 },
      approved: { pedidos: 5, bilhetes: 25, total_centavos: 30900 },
      expired: { pedidos: 2, bilhetes: 11, total_centavos: 22000 },
    });
  });

  it("célula: os pedidos dos afiliados dela, com os totais dela", async () => {
    const resposta = await listar(`?celula_id=${celulaA}`);
    expect(ids(resposta)).toEqual(["P-10", "P-06", "P-02", "P-01"]);
    expect(resposta.totais).toEqual({
      in_process: { pedidos: 1, bilhetes: 2, total_centavos: 4000 },
      approved: { pedidos: 3, bilhetes: 17, total_centavos: 14900 },
      expired: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
    });
    const comStatus = await listar(`?celula_id=${celulaB}&status=expired`);
    expect(ids(comStatus)).toEqual(["P-07"]);
    expect(comStatus.totais?.approved).toEqual({
      pedidos: 1,
      bilhetes: 3,
      total_centavos: 6000,
    });
  });

  it("sem célula: sem afiliado ou com afiliado não vinculado; celula_id inexistente dá lista vazia", async () => {
    const resposta = await listar("?sem_celula=true");
    expect(ids(resposta)).toEqual(["P-09", "P-05", "P-04"]);
    expect(resposta.totais).toEqual({
      in_process: { pedidos: 1, bilhetes: 9, total_centavos: 18000 },
      approved: { pedidos: 1, bilhetes: 5, total_centavos: 10000 },
      expired: { pedidos: 1, bilhetes: 4, total_centavos: 8000 },
    });
    expect(ids(await listar("?sem_celula=false"))).toEqual(ORDEM);
    const inexistente = await listar("?celula_id=999999");
    expect(inexistente.itens).toEqual([]);
    expect(inexistente.totais?.approved.pedidos).toBe(0);
  });

  it("D7: vincular o órfão leva os pedidos dele para a célula na hora (resolvida na leitura)", async () => {
    await db
      .prepare(
        "UPDATE afiliados SET celula_id = ?1, vinculado_em = '2026-11-25T12:00:00.000Z' WHERE affiliate_id = 9103",
      )
      .bind(celulaB)
      .run();
    expect(ids(await listar(`?celula_id=${celulaB}`))).toEqual([
      "P-07",
      "P-05",
      "P-03",
    ]);
    expect(ids(await listar("?sem_celula=true"))).toEqual(["P-09", "P-04"]);
    const item = (await listar("?id=P-05")).itens[0];
    expect(item).toMatchObject({
      celula_id: celulaB,
      celula_nome: "Célula Betel dos Pedidos",
    });
  });

  it("id: busca exata (com os espaços das pontas tirados), com os totais dele; combinado com os outros filtros", async () => {
    const resposta = await listar("?id=%20P-03%20");
    expect(ids(resposta)).toEqual(["P-03"]);
    expect(resposta.totais).toEqual({
      in_process: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
      approved: { pedidos: 1, bilhetes: 3, total_centavos: 6000 },
      expired: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
    });
    expect(ids(await listar("?id=P-0"))).toEqual([]);
    expect(ids(await listar("?id=p-03"))).toEqual([]);
    expect(ids(await listar(`?id=P-03&celula_id=${celulaB}`))).toEqual([
      "P-03",
    ]);
    expect(ids(await listar(`?id=P-03&celula_id=${celulaA}`))).toEqual([]);
    expect(ids(await listar("?id=P-03&sem_celula=true"))).toEqual([]);
    expect(ids(await listar("?id=P-04&sem_celula=true"))).toEqual(["P-04"]);
    expect(ids(await listar("?id=P-03&status=expired"))).toEqual([]);
    // De outra campanha: não aparece nem pelo id.
    const outra = await listar("?id=X-01");
    expect(outra.itens).toEqual([]);
    expect(outra.totais?.approved.pedidos).toBe(0);
  });

  it("suspeito: vem de pedidos_suspeitos", async () => {
    const antes = await listar();
    expect(
      antes.itens.filter((item) => item.suspeito).map((item) => item.id),
    ).toEqual(["P-10"]);
    await db.batch([
      db.prepare("DELETE FROM pedidos_suspeitos"),
      db.prepare(
        `INSERT INTO pedidos_suspeitos (pedido_id, qtd_bilhetes, total_centavos, esperado_centavos, motivos, marcado_em)
         VALUES ('P-03', 3, 6000, 6000,
           '[{"caminho":["numbers_count"],"codigo":"bilhetes_acima_do_teto","mensagem":"x","ocorrencias":1}]',
           '2026-11-24T11:10:00.000Z')`,
      ),
    ]);
    const depois = await listar();
    expect(
      depois.itens.filter((item) => item.suspeito).map((item) => item.id),
    ).toEqual(["P-03"]);
  });
});

describe("sem campanha ativa", () => {
  it("lista vazia e totais zerados (com antes_de, totais null)", async () => {
    await db.prepare("UPDATE campanhas SET ativa = 0").run();
    const resposta = await listar();
    expect(resposta).toEqual({
      itens: [],
      proximo: null,
      totais: {
        in_process: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
        approved: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
        expired: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
      },
    });
    for (const filtro of [
      `?celula_id=${celulaA}`,
      "?sem_celula=true",
      "?id=P-01",
      "?status=approved",
    ])
      expect((await listar(filtro)).itens).toEqual([]);
    const cursor = codificarCursorPedidos({
      registrado_em: "2026-11-24T15:00:00.000Z",
      id: "P-10",
    });
    expect(await listar(`?antes_de=${cursor}`)).toEqual({
      itens: [],
      proximo: null,
      totais: null,
    });
  });
});

describe("consulta inválida: 400 requisicao_invalida", () => {
  const base64url = (texto: string) =>
    btoa(texto).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const valido = codificarCursorPedidos({
    registrado_em: "2026-11-24T15:00:00.000Z",
    id: "P-10",
  });

  it.each([
    ["texto qualquer", "abc"],
    ["caractere fora do base64url", `${valido}!`],
    ["base64 com padding", `${valido}=`],
    ["base64 comum (+ e /)", btoa('["2026-11-24T15:00:00.000Z","P?>"]')],
    ["JSON que não é lista", base64url('{"registrado_em":"x","id":"P-10"}')],
    ["lista de 3", base64url('["2026-11-24T15:00:00.000Z","P-10",1]')],
    [
      "instante sem milissegundos",
      base64url('["2026-11-24T15:00:00Z","P-10"]'),
    ],
    [
      "instante com fuso",
      base64url('["2026-11-24T12:00:00.000-03:00","P-10"]'),
    ],
    ["id vazio", base64url('["2026-11-24T15:00:00.000Z",""]')],
    ["id numérico", base64url('["2026-11-24T15:00:00.000Z",10]')],
    [
      "id com 129 caracteres",
      base64url(`["2026-11-24T15:00:00.000Z","${"x".repeat(129)}"]`),
    ],
    [
      "JSON com espaço (não canônico)",
      base64url('["2026-11-24T15:00:00.000Z", "P-10"]'),
    ],
    ["bytes que não são UTF-8", base64url("\xff\xfe")],
  ])("cursor %s", async (_caso, cursor) => {
    const res = await chamar(`?antes_de=${encodeURIComponent(cursor)}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      erro: {
        codigo: "requisicao_invalida",
        mensagem: "Consulta inválida",
        detalhes: [
          {
            caminho: ["antes_de"],
            codigo: "cursor_invalido",
            mensagem: expect.any(String),
          },
        ],
      },
    });
  });

  it.each([
    ["celula_id junto com sem_celula", `?celula_id=${1}&sem_celula=true`],
    ["status fora do domínio", "?status=pago"],
    ["limite acima do teto", "?limite=201"],
    ["antes_de vazio", "?antes_de="],
    ["id só de espaços", "?id=%20%20"],
  ])("%s (schema da consulta)", async (_caso, consulta) => {
    const res = await chamar(consulta);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      erro: { codigo: "requisicao_invalida", mensagem: "Consulta inválida" },
    });
  });
});

describe("as três rotas da RIFA-025 só para a coordenação", () => {
  const caminhos = [
    ROTAS.listarPedidos.caminho,
    ROTAS.entregasWebhook.caminho,
    ROTAS.estadoWebhook.caminho,
  ];

  it("sem sessão: 401; líder, discipulador e rede: 403; admin e coordenação: 200", async () => {
    const hierarquia = {
      lider: await cabecalhosDeSessaoDaHierarquia("lider", celulaA),
      discipulador: await cabecalhosDeSessaoDaHierarquia(
        "discipulador",
        discipuladorId,
      ),
      rede: await cabecalhosDeSessaoDaHierarquia("rede", redeId),
    };
    const admin = await cabecalhosDeSessao("admin");
    for (const caminho of caminhos) {
      const pedir = (cabecalhos: Record<string, string>) =>
        exports.default.fetch(`${ORIGEM}${caminho}`, { headers: cabecalhos });
      const semSessao = await pedir({});
      expect({ caminho, status: semSessao.status }).toEqual({
        caminho,
        status: 401,
      });
      expect(await semSessao.json()).toEqual(erro("nao_autenticado"));
      for (const [papel, cabecalhos] of Object.entries(hierarquia)) {
        const res = await pedir(cabecalhos);
        expect({ caminho, papel, status: res.status }).toEqual({
          caminho,
          papel,
          status: 403,
        });
        expect(await res.json()).toEqual(erro("proibido"));
      }
      for (const cabecalhos of [admin, coordenacao]) {
        const res = await pedir(cabecalhos);
        expect({ caminho, status: res.status }).toEqual({
          caminho,
          status: 200,
        });
        expect(res.headers.get("Cache-Control")).toContain("no-store");
      }
    }
  });
});
