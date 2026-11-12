// Regras do admin na campanha (Sprint 6, D20; contrato em ROTAS_REGRAS_CAMPANHA e no PUT da campanha), pelas rotas,
// com o login e os papéis como no index.ts, o relógio fixo e sem os caches de 30 s (D10 e D14), para cada leitura
// ver o banco na hora:
// - CA1: um pedido desconsiderado sai de TODAS as contas (painel, rankings, público, bumbo, /minha, mapa, afiliados,
//   adesão, totais da lista e conferência): o mesmo cenário passa por cada rota e dá o mesmo que sem o pedido; o
//   reconsiderar devolve tudo como era;
// - CA2: um webhook depois não o devolve às contas; repetir a ação dá 200 sem linha nova na trilha;
// - CA3: chave desligada: 409 nos dois; desligar não devolve o que já foi desconsiderado; a ordem dos erros;
// - CA5: remover afiliado (204, 404, 409 com a lista, os desconsiderados sem afiliado no mesmo lote, a trilha);
// - CA6: as mensagens no PUT da campanha e um modelo gravado fora das regras que não derruba as leituras;
// - RIFA-042: pedidos, acesso e mensagens só do admin (403 da coordenação) e o {link} colado ou outro endereço (400);
// - CA7: desconsiderar e reconsiderar leem menos de 10 linhas; remover lê os pedidos do afiliado.
// O acesso de discipuladores e redes (CA4) está em src/worker/protecao.test.ts e routes/admin-usuarios.test.ts.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import newOrderAfiliado from "../../../test/fixtures/rifei/new_order.afiliado.json";
import paidOrderAfiliado from "../../../test/fixtures/rifei/paid_order.afiliado.json";
import {
  LIMITE_PEDIDOS_NO_DETALHE,
  MENSAGENS_PADRAO,
  ROTAS,
  ROTAS_REGRAS_CAMPANHA,
  campanhaSchema,
  detalhesAcaoDesligadaSchema,
  detalhesAfiliadoComPedidosSchema,
  erroApiSchema,
  itemPedidoSchema,
  respostaAnalisePorPedidoSchema,
  type Campanha,
  type CampanhaEntrada,
} from "../../shared/contracts";
import { montarCsv } from "../../shared/conferencia/teste-csv";
import { SEM_CACHE_DA_BASE } from "../db/visao-individual";
import { SEM_CACHE } from "../lib/cache-publico";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import { cabecalhosSeguranca } from "../middleware/cabecalhos-seguranca";
import { exigirSessao } from "../middleware/sessao";
import { buscarLinkValido } from "../db/acessos";
import { sha256Hex } from "../lib/cripto";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
  criarAcessoDaHierarquiaNoBanco,
} from "../test/acesso-teste";
import { corpoDe } from "../test/conferencia-apoio";
import {
  AGORA,
  DADOS_CAMPANHA,
  aprovado,
  bancoQueConta,
  semearCenario,
  semearPedidos,
} from "../test/painel-apoio";
import { PREFIXO_AFILIADOS_ADESAO, afiliadosAdesao } from "./afiliados-adesao";
import { PREFIXO_AUDITORIA, auditoria } from "./auditoria";
import { PREFIXO_CAMPANHA, campanha } from "./campanha";
import { PREFIXO_MINHA, criarMinha } from "./minha";
import { PREFIXO_PAINEL, criarPainel } from "./painel";
import { PREFIXO_PEDIDOS, pedidos } from "./pedidos";
import { PREFIXO_PUBLICO, criarPublico } from "./publico";
import { PREFIXO_RECONCILIACAO, criarReconciliacao } from "./reconciliacao";
import { webhookRifei } from "./webhook-rifei";

const db = env.DB;
const relogio = () => AGORA;
/** As linhas lidas pela sessão do admin (a sessão e o usuário; o admin não lê a chave de acesso). */
const LINHAS_DA_SESSAO = 2;
const { desconsiderarPedido, reconsiderarPedido, removerAfiliado } =
  ROTAS_REGRAS_CAMPANHA;
const DESCONSIDERAR = desconsiderarPedido.caminho;
const RECONSIDERAR = reconsiderarPedido.caminho;
const removerCaminho = (id: number | string) =>
  removerAfiliado.caminho.replace(":affiliateId", String(id));

/** As rotas montadas como no index.ts (login e papéis), com o relógio fixo e sem os caches de 30 s. */
function criarApp() {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.use("*", cabecalhosSeguranca);
  app.use("/api/admin/*", exigirSessao(["admin", "coordenacao"]));
  app.use("/api/painel/*", exigirSessao(["admin", "coordenacao"]));
  app.use(
    "/api/minha/*",
    exigirSessao(["lider", "discipulador", "rede"], { acessoDaCampanha: true }),
  );
  app.route(PREFIXO_AUDITORIA, auditoria);
  app.route("/", webhookRifei);
  app.route(PREFIXO_CAMPANHA, campanha);
  app.route(PREFIXO_PEDIDOS, pedidos);
  app.route(PREFIXO_AFILIADOS_ADESAO, afiliadosAdesao);
  app.route(PREFIXO_RECONCILIACAO, criarReconciliacao(relogio));
  app.route(PREFIXO_PAINEL, criarPainel(relogio));
  app.route(PREFIXO_PUBLICO, criarPublico({ relogio, cache: SEM_CACHE }));
  app.route(PREFIXO_MINHA, criarMinha({ relogio, cache: SEM_CACHE_DA_BASE }));
  app.notFound(rotaInexistente);
  app.onError(erroNaoTratado);
  return app;
}
const app = criarApp();

interface Resposta {
  status: number;
  corpo: unknown;
}

async function chamar(
  metodo: "GET" | "POST" | "PUT" | "DELETE",
  caminho: string,
  cabecalhos: Record<string, string>,
  corpo?: unknown,
  banco: D1Database = db,
): Promise<Resposta> {
  const headers = new Headers(cabecalhos);
  if (corpo !== undefined) headers.set("Content-Type", "application/json");
  const res = await app.request(
    `${ORIGEM}${caminho}`,
    {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    },
    { ...env, DB: banco },
  );
  const texto = await res.text();
  return { status: res.status, corpo: texto === "" ? null : JSON.parse(texto) };
}

const erro = (codigo: string, detalhes?: unknown) => ({
  erro: {
    codigo,
    mensagem: expect.any(String),
    ...(detalhes === undefined ? {} : { detalhes }),
  },
});

async function webhook(payload: object) {
  const res = await app.request(
    "/api/webhooks/rifei",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RIFEI_WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify({ ...payload, slug: DADOS_CAMPANHA.slug_rifei }),
    },
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { resultado: string };
}

const ligarChave = (ligada: boolean) =>
  db
    .prepare("UPDATE campanhas SET pedidos_desconsiderar = ?1 WHERE ativa = 1")
    .bind(ligada ? 1 : 0)
    .run();

const contarTrilha = async (acao: string) =>
  (await db
    .prepare("SELECT count(*) AS n FROM auditoria WHERE acao = ?1")
    .bind(acao)
    .first<{ n: number }>())!.n;

const ultimaDaTrilha = (acao: string) =>
  db
    .prepare(
      "SELECT usuario_id, acao, alvo, resumo FROM auditoria WHERE acao = ?1 ORDER BY id DESC LIMIT 1",
    )
    .bind(acao)
    .first<{
      usuario_id: number;
      acao: string;
      alvo: string;
      resumo: string;
    }>();

// Cenário: Ágape (101), Betel (102) e um sem afiliado contam; a Canaã (103) tem um pedido só, o ALVO, do DDD 91.
const A = aprovado(101, "2026-11-24T15:00:00.000Z", 2);
const B = aprovado(102, "2026-11-25T15:00:00.000Z", 3);
const C = aprovado(null, "2026-11-25T16:00:00.000Z", 1);
const ALVO = {
  ...aprovado(103, "2026-11-26T15:00:00.000Z", 7),
  id: "PED-ALVO-0001",
  pais: "55",
  ddd: "91",
};

let admin: Record<string, string>;
let adminId: number;
let coordenacao: Record<string, string>;
let hierarquia: Record<
  "lider" | "discipulador" | "rede",
  Record<string, string>
>;

/** O arquivo da Rifei com os quatro pedidos, pagos (a conferência pelo CSV). */
async function corpoDaConferencia() {
  const linha = (pedido: typeof A, afiliado: string) => [
    pedido.id,
    "Pago",
    String(pedido.qtd_bilhetes),
    (pedido.total_centavos / 100).toFixed(2).replace(".", ","),
    afiliado,
    "26/11/2026 12:00",
  ];
  return (
    await corpoDe(
      montarCsv([
        [
          "Pedido",
          "Status",
          "Quantidade",
          "Valor",
          "Afiliado",
          "Data do pagamento",
        ],
        linha(A, "101"),
        linha(B, "102"),
        linha(C, ""),
        linha(ALVO, "103"),
      ]),
    )
  ).corpo;
}

/**
 * Tudo o que soma pedidos, pelas rotas: o painel (resumo da campanha e da célula da Canaã, rankings de células e
 * de discipuladores), o público (ranking e bumbo do dia seguinte ao do ALVO), o mapa por DDD, os afiliados, a
 * adesão, os totais da lista de pedidos, a visão individual (líder, discipulador e rede da Canaã) e o total do
 * sistema na conferência pelo CSV.
 */
async function contas() {
  const ler = async (caminho: string, quem = admin) => {
    const resposta = await chamar("GET", caminho, quem);
    expect({ caminho, status: resposta.status }).toEqual({
      caminho,
      status: 200,
    });
    return resposta.corpo;
  };
  const lista = ROTAS.listarPedidos.sucesso.corpo.parse(
    await ler(ROTAS.listarPedidos.caminho),
  );
  const conferencia = await chamar(
    "POST",
    ROTAS.analisarReconciliacao.caminho,
    admin,
    await corpoDaConferencia(),
  );
  expect(conferencia.status).toBe(200);
  const analise = respostaAnalisePorPedidoSchema.parse(conferencia.corpo);
  return {
    resumo: await ler("/api/painel/resumo"),
    resumoDaCanaa: await ler("/api/painel/resumo?escopo=celula&id=3"),
    rankingCelulas: await ler("/api/painel/ranking?periodo=campanha"),
    rankingDiscipuladores: await ler(
      "/api/painel/ranking?nivel=discipulador&periodo=campanha",
    ),
    rankingPublico: await ler("/api/publico/ranking?periodo=campanha"),
    bumbo: await ler("/api/publico/bumbo?data=2026-11-27"),
    mapa: await ler("/api/painel/mapa-ddd"),
    afiliados: await ler("/api/admin/afiliados"),
    adesao: await ler("/api/admin/adesao"),
    totaisDaLista: lista.totais,
    minhaLider: await ler(
      "/api/minha/visao?periodo=campanha",
      hierarquia.lider,
    ),
    minhaDiscipulador: await ler(
      "/api/minha/visao?periodo=campanha",
      hierarquia.discipulador,
    ),
    minhaRede: await ler("/api/minha/visao?periodo=campanha", hierarquia.rede),
    conferenciaSistema: analise.resumo.aprovados_no_sistema,
  };
}

/** O cenário com os pedidos dados (a campanha com a chave ligada) e as sessões da hierarquia da Canaã. */
async function semear(pedidosDoCenario = [A, B, C, ALVO]) {
  const { campanhaId } = await semearCenario({ pedidos: pedidosDoCenario });
  await ligarChave(true);
  // A hierarquia é recriada pelo cenário (e os usuários dela caem em cascata): sessões novas.
  hierarquia = {
    lider: await cabecalhosDeSessaoDaHierarquia("lider", 3),
    discipulador: await cabecalhosDeSessaoDaHierarquia("discipulador", 20),
    rede: await cabecalhosDeSessaoDaHierarquia("rede", 1),
  };
  return campanhaId;
}

beforeAll(async () => {
  admin = await cabecalhosDeSessao("admin");
  coordenacao = await cabecalhosDeSessao("coordenacao");
  adminId = (await db
    .prepare(
      "SELECT id FROM usuarios WHERE papel = 'admin' ORDER BY id DESC LIMIT 1",
    )
    .first<{ id: number }>())!.id;
});

// ---------------------------------------------------------------------------------------------------
// CA1: sai de todas as contas e volta ao reconsiderar
// ---------------------------------------------------------------------------------------------------

describe("CA1: o desconsiderado sai de TODAS as contas e volta ao reconsiderar (o mesmo cenário em cada rota)", () => {
  it("desconsiderado, cada rota dá o mesmo que sem o pedido; reconsiderado, o mesmo de antes", async () => {
    // Sem o ALVO: a referência de "fora das contas".
    const campanhaId = await semear([A, B, C]);
    const semEle = await contas();
    await semearPedidos(db, [ALVO], { ativa: campanhaId });
    const comEle = await contas();
    // O ALVO conta (a referência não é a mesma coisa).
    expect(comEle.resumo).not.toEqual(semEle.resumo);
    expect(comEle.conferenciaSistema.bilhetes).toBe(
      semEle.conferenciaSistema.bilhetes + 7,
    );
    // A API manda sempre o grupo dos desconsiderados (o `.optional()` do contrato é só da transição, D20).
    const semNenhum = await chamar(
      "POST",
      ROTAS.analisarReconciliacao.caminho,
      admin,
      await corpoDaConferencia(),
    );
    expect(semNenhum.corpo).toMatchObject({
      desconsiderados: { quantidade: 0, itens: [], itens_omitidos: 0 },
    });

    const desconsiderado = await chamar("POST", DESCONSIDERAR, admin, {
      pedido_id: ` ${ALVO.id} `,
      motivo: "teste",
      observacao: "  compra de teste na reunião ",
    });
    expect(desconsiderado.status).toBe(200);
    const item = itemPedidoSchema.parse(desconsiderado.corpo);
    expect(item).toMatchObject({
      id: ALVO.id,
      status: "approved",
      celula_id: 3,
      origem: "webhook",
      desconsiderado: {
        motivo: "teste",
        observacao: "compra de teste na reunião",
        em: expect.stringMatching(/Z$/),
      },
    });

    // Fora de tudo o que soma: exatamente como sem ele.
    expect(await contas()).toEqual(semEle);
    // Continua na lista, com o selo, e na conferência, à parte.
    const lista = ROTAS.listarPedidos.sucesso.corpo.parse(
      (await chamar("GET", "/api/admin/pedidos?desconsiderado=true", admin))
        .corpo,
    );
    expect(lista.itens).toEqual([item]);
    const conferencia = respostaAnalisePorPedidoSchema.parse(
      (
        await chamar(
          "POST",
          ROTAS.analisarReconciliacao.caminho,
          admin,
          await corpoDaConferencia(),
        )
      ).corpo,
    );
    expect(conferencia.desconsiderados).toMatchObject({
      quantidade: 1,
      itens: [{ pedido_id: ALVO.id, desconsiderado: item.desconsiderado }],
    });

    const reconsiderado = await chamar("POST", RECONSIDERAR, admin, {
      pedido_id: ALVO.id,
    });
    expect(reconsiderado.status).toBe(200);
    expect(itemPedidoSchema.parse(reconsiderado.corpo)).toEqual({
      ...item,
      desconsiderado: null,
    });
    expect(await contas()).toEqual(comEle);
  });

  it("a trilha: o id em JSON, o status, os bilhetes, a célula e o motivo; da observação, só que foi informada", async () => {
    await semear();
    await chamar("POST", DESCONSIDERAR, admin, {
      pedido_id: ALVO.id,
      motivo: "fraude",
      observacao: "anotação qualquer",
    });
    expect(await ultimaDaTrilha("pedido.desconsiderar")).toEqual({
      usuario_id: adminId,
      acao: "pedido.desconsiderar",
      alvo: `pedido:${ALVO.id}`,
      resumo: `Pedido "${ALVO.id}" desconsiderado (motivo fraude): approved, 7 bilhetes, célula 3; observação informada`,
    });
    const em = (await db
      .prepare("SELECT desconsiderado_em FROM pedidos WHERE id = ?1")
      .bind(ALVO.id)
      .first<{ desconsiderado_em: string }>())!.desconsiderado_em;
    await chamar("POST", RECONSIDERAR, admin, { pedido_id: ALVO.id });
    expect(await ultimaDaTrilha("pedido.reconsiderar")).toEqual({
      usuario_id: adminId,
      acao: "pedido.reconsiderar",
      alvo: `pedido:${ALVO.id}`,
      resumo: `Pedido "${ALVO.id}" volta a contar (era desconsiderado por fraude em ${em}): approved, 7 bilhetes, célula 3`,
    });
  });

  it("id com aspas e longo (o alvo vira só `pedido`, e o id vai inteiro no resumo); pedido de teste ainda não pago também sai", async () => {
    const campanhaId = await semear();
    const longo = `PED"${"x".repeat(100)}`;
    await db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, status, qtd_bilhetes, total_centavos)
         VALUES (?1, ?2, 'in_process', 1, 2000)`,
      )
      .bind(longo, campanhaId)
      .run();
    const resposta = await chamar("POST", DESCONSIDERAR, admin, {
      pedido_id: longo,
      motivo: "teste",
    });
    expect(resposta.status).toBe(200);
    expect(itemPedidoSchema.parse(resposta.corpo)).toMatchObject({
      id: longo,
      status: "in_process",
      desconsiderado: { motivo: "teste", observacao: null },
    });
    expect(await ultimaDaTrilha("pedido.desconsiderar")).toMatchObject({
      alvo: "pedido",
      resumo: `Pedido ${JSON.stringify(longo)} desconsiderado (motivo teste): in_process, 1 bilhete, célula nenhuma`,
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// CA2: o webhook depois não reativa; repetir não muda nada
// ---------------------------------------------------------------------------------------------------

describe("CA2: o webhook depois não devolve o pedido às contas; repetir dá 200 sem linha nova na trilha", () => {
  it("pedido de teste in_process desconsiderado: o paid_order o aprova, mas ele continua fora de todas as contas", async () => {
    await semear();
    expect(await webhook(newOrderAfiliado)).toMatchObject({
      resultado: "processado",
    });
    const id = newOrderAfiliado.id;
    const primeiro = await chamar("POST", DESCONSIDERAR, admin, {
      pedido_id: id,
      motivo: "teste",
    });
    expect(primeiro.status).toBe(200);
    const antes = await contas();

    expect(await webhook(paidOrderAfiliado)).toMatchObject({
      resultado: "processado",
    });
    expect(await webhook(paidOrderAfiliado)).toMatchObject({
      resultado: "duplicado",
    });

    expect(await contas()).toEqual(antes);
    const lista = ROTAS.listarPedidos.sucesso.corpo.parse(
      (await chamar("GET", `/api/admin/pedidos?id=${id}`, admin)).corpo,
    );
    expect(lista.itens).toHaveLength(1);
    expect(lista.itens[0]).toMatchObject({
      status: "approved",
      desconsiderado: itemPedidoSchema.parse(primeiro.corpo).desconsiderado,
    });
  });

  it("repetir: desconsiderar o desconsiderado e reconsiderar o que conta dão 200 como está, sem trilha (o motivo e a data da primeira vez)", async () => {
    await semear();
    const primeiro = await chamar("POST", DESCONSIDERAR, admin, {
      pedido_id: ALVO.id,
      motivo: "teste",
    });
    const trilha = await contarTrilha("pedido.desconsiderar");
    const repetido = await chamar("POST", DESCONSIDERAR, admin, {
      pedido_id: ALVO.id,
      motivo: "estorno",
      observacao: "outra",
    });
    expect(repetido).toEqual(primeiro);
    expect(await contarTrilha("pedido.desconsiderar")).toBe(trilha);

    await chamar("POST", RECONSIDERAR, admin, { pedido_id: ALVO.id });
    const reconsideracoes = await contarTrilha("pedido.reconsiderar");
    const deNovo = await chamar("POST", RECONSIDERAR, admin, {
      pedido_id: ALVO.id,
    });
    expect(deNovo.status).toBe(200);
    expect(itemPedidoSchema.parse(deNovo.corpo).desconsiderado).toBeNull();
    expect(await contarTrilha("pedido.reconsiderar")).toBe(reconsideracoes);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA3: a chave e a ordem dos erros
// ---------------------------------------------------------------------------------------------------

describe("CA3: a chave pedidos.desconsiderar e a ordem dos erros", () => {
  beforeEach(async () => {
    await semear();
  });

  it("chave desligada: 409 acao_desligada com a chave em desconsiderar e reconsiderar, e nada muda", async () => {
    await chamar("POST", DESCONSIDERAR, admin, {
      pedido_id: A.id,
      motivo: "teste",
    });
    await ligarChave(false);
    const trilha = await contarTrilha("pedido.desconsiderar");
    for (const [caminho, corpo] of [
      [DESCONSIDERAR, { pedido_id: ALVO.id, motivo: "teste" }],
      [RECONSIDERAR, { pedido_id: A.id }],
    ] as const) {
      const resposta = await chamar("POST", caminho, admin, corpo);
      expect(resposta).toEqual({
        status: 409,
        corpo: erro("acao_desligada", { chave: "pedidos.desconsiderar" }),
      });
      detalhesAcaoDesligadaSchema.parse(
        erroApiSchema.parse(resposta.corpo).erro.detalhes,
      );
    }
    expect(await contarTrilha("pedido.desconsiderar")).toBe(trilha);
    const linhas = await db
      .prepare(
        "SELECT id, desconsiderado_em IS NOT NULL AS fora FROM pedidos WHERE id IN (?1, ?2) ORDER BY id",
      )
      .bind(A.id, ALVO.id)
      .all();
    expect(linhas.results).toEqual([
      { id: ALVO.id, fora: 0 },
      { id: A.id, fora: 1 },
    ]);
  });

  it("desligar a chave (pelo PUT da campanha) não devolve às contas o que já foi desconsiderado", async () => {
    await chamar("POST", DESCONSIDERAR, admin, {
      pedido_id: ALVO.id,
      motivo: "teste",
    });
    const antes = await contas();
    // A chave é só do admin (RIFA-042).
    const salvo = await chamar("PUT", ROTAS.salvarCampanha.caminho, admin, {
      ...DADOS_CAMPANHA,
      pedidos: { desconsiderar: false },
    });
    expect(salvo.status).toBe(200);
    expect(campanhaSchema.parse(salvo.corpo).pedidos).toEqual({
      desconsiderar: false,
    });
    expect(await contas()).toEqual(antes);
  });

  it("a ordem: 400 (corpo) → 404 sem campanha ativa → 409 chave desligada → 404 pedido fora da campanha ativa", async () => {
    // 400 antes de tudo, mesmo com a chave desligada.
    await ligarChave(false);
    for (const corpo of [
      {},
      { pedido_id: "", motivo: "teste" },
      { pedido_id: ALVO.id, motivo: "erro" },
      { pedido_id: ALVO.id, motivo: "teste", observacao: "x".repeat(141) },
      {
        pedido_id: ALVO.id,
        motivo: "teste",
        observacao: "falar com fulano@exemplo.com",
      },
      {
        pedido_id: ALVO.id,
        motivo: "teste",
        observacao: "telefone (91) 99988-7766",
      },
      { pedido_id: ALVO.id, motivo: "teste", campo: 1 },
      { pedido_id: "x".repeat(129), motivo: "teste" },
    ])
      expect(await chamar("POST", DESCONSIDERAR, admin, corpo)).toMatchObject({
        status: 400,
        corpo: { erro: { codigo: "requisicao_invalida" } },
      });
    expect(
      await chamar("POST", RECONSIDERAR, admin, {
        pedido_id: ALVO.id,
        motivo: "teste",
      }),
    ).toMatchObject({ status: 400 });
    // Pedido inexistente com a chave desligada: o 409 vem antes do 404 do pedido.
    expect(
      await chamar("POST", DESCONSIDERAR, admin, {
        pedido_id: "NAO-EXISTE",
        motivo: "teste",
      }),
    ).toMatchObject({ status: 409 });
    // Sem campanha ativa: 404, antes da chave.
    await db.prepare("UPDATE campanhas SET ativa = 0 WHERE ativa = 1").run();
    expect(
      await chamar("POST", RECONSIDERAR, admin, { pedido_id: ALVO.id }),
    ).toEqual({ status: 404, corpo: erro("nao_encontrado") });
    // A campanha de volta, com a chave ligada: o pedido inexistente e o de outra campanha dão 404.
    await db
      .prepare(
        "UPDATE campanhas SET ativa = 1, pedidos_desconsiderar = 1 WHERE slug_rifei = ?1",
      )
      .bind(DADOS_CAMPANHA.slug_rifei)
      .run();
    const outra = await db
      .prepare(
        `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
           meta_regra, meta_valor, ranking_criterio)
         VALUES ('Outra', 'outra-edicao-regras', 0, '2025-11-23', 2000, 'bilhetes', 'por_pessoa', 10,
           'percentual_meta')
         RETURNING id`,
      )
      .first<{ id: number }>();
    await db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em)
         VALUES ('PED-OUTRA', ?1, 101, 'approved', 1, 2000, '2025-11-24T15:00:00.000Z')`,
      )
      .bind(outra!.id)
      .run();
    for (const pedido_id of ["NAO-EXISTE", "PED-OUTRA"])
      expect(
        await chamar("POST", DESCONSIDERAR, admin, {
          pedido_id,
          motivo: "teste",
        }),
      ).toEqual({ status: 404, corpo: erro("nao_encontrado") });
  });

  it("só admin: a coordenação leva 403 antes de o corpo ser lido", async () => {
    for (const caminho of [DESCONSIDERAR, RECONSIDERAR])
      expect(await chamar("POST", caminho, coordenacao, {})).toEqual({
        status: 403,
        corpo: erro("proibido"),
      });
  });
});

// ---------------------------------------------------------------------------------------------------
// CA5: remover afiliado de teste
// ---------------------------------------------------------------------------------------------------

describe("CA5: DELETE /api/admin/afiliados/:affiliateId (só admin)", () => {
  beforeEach(async () => {
    await semear();
  });

  const afiliado = (id: number) =>
    db
      .prepare(
        "SELECT affiliate_id, celula_id, origem FROM afiliados WHERE affiliate_id = ?1",
      )
      .bind(id)
      .first();

  it("sem nenhum pedido: 204, o afiliado sai e a trilha registra", async () => {
    await db
      .prepare(
        "INSERT INTO afiliados (affiliate_id, origem) VALUES (777, 'manual')",
      )
      .run();
    expect(await chamar("DELETE", removerCaminho(777), admin)).toEqual({
      status: 204,
      corpo: null,
    });
    expect(await afiliado(777)).toBeNull();
    expect(await ultimaDaTrilha("afiliado.remover")).toEqual({
      usuario_id: adminId,
      acao: "afiliado.remover",
      alvo: "afiliado:777",
      resumo: "Afiliado removido (sem célula); nenhum pedido dele",
    });
    expect(await chamar("DELETE", removerCaminho(777), admin)).toEqual({
      status: 404,
      corpo: erro("nao_encontrado"),
    });
  });

  it("com pedido que conta: 409 afiliado_com_pedidos com quantos e os ids dos mais recentes (até 20), e nada muda", async () => {
    // 22 pedidos que contam da Dorcas (104), um por minuto, e um desconsiderado (que não entra na lista).
    await db.batch([
      db.prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em,
           registrado_em)
         WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 22)
         SELECT printf('DORCAS-%02d', i), (SELECT id FROM campanhas WHERE ativa = 1), 104,
           CASE WHEN i % 2 = 0 THEN 'approved' ELSE 'in_process' END, 1, 2000,
           CASE WHEN i % 2 = 0 THEN '2026-11-27T15:00:00.000Z' END,
           strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-27T12:00:00.000Z', '+' || i || ' minutes')
         FROM n`,
      ),
      db.prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos,
           registrado_em, desconsiderado_em, desconsiderado_motivo)
         VALUES ('DORCAS-TESTE', (SELECT id FROM campanhas WHERE ativa = 1), 104, 'in_process', 1, 2000,
           '2026-11-28T12:00:00.000Z', '2026-11-28T12:01:00.000Z', 'teste')`,
      ),
    ]);
    const trilha = await contarTrilha("afiliado.remover");
    const resposta = await chamar("DELETE", removerCaminho(104), admin);
    const esperados = Array.from(
      { length: LIMITE_PEDIDOS_NO_DETALHE },
      (_, i) => `DORCAS-${String(22 - i).padStart(2, "0")}`,
    );
    expect(resposta).toEqual({
      status: 409,
      corpo: erro("afiliado_com_pedidos", {
        pedidos_que_contam: 22,
        pedidos: esperados,
      }),
    });
    const { erro: corpoErro } = erroApiSchema.parse(resposta.corpo);
    detalhesAfiliadoComPedidosSchema.parse(corpoErro.detalhes);
    // Todos da campanha ativa: dá para desconsiderar daqui (a tela Pedidos), e a mensagem diz isso.
    expect(corpoErro.mensagem).toBe(
      "O afiliado tem 22 pedidos que contam: desconsidere os pedidos (teste) na tela Pedidos antes de remover",
    );
    expect(await afiliado(104)).toMatchObject({ celula_id: 4 });
    expect(await contarTrilha("afiliado.remover")).toBe(trilha);
  });

  it("um pedido que conta noutra campanha também segura o afiliado (não se desconsidera daqui)", async () => {
    const outra = await db
      .prepare(
        `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
           meta_regra, meta_valor, ranking_criterio)
         VALUES ('Outra', 'outra-edicao-afiliado', 0, '2025-11-23', 2000, 'bilhetes', 'por_pessoa', 10,
           'percentual_meta')
         RETURNING id`,
      )
      .first<{ id: number }>();
    await db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em)
         VALUES ('EFESO-2025', ?1, 105, 'approved', 1, 2000, '2025-11-24T15:00:00.000Z')`,
      )
      .bind(outra!.id)
      .run();
    const resposta = await chamar("DELETE", removerCaminho(105), admin);
    expect(resposta).toEqual({
      status: 409,
      corpo: erro("afiliado_com_pedidos", {
        pedidos_que_contam: 1,
        pedidos: ["EFESO-2025"],
      }),
    });
    // RIFA-040: a mensagem não manda desconsiderar (daqui não se faz): o afiliado não é de teste e fica.
    expect(erroApiSchema.parse(resposta.corpo).erro.mensagem).toBe(
      "O afiliado tem 1 pedido que conta, fora da campanha ativa: pedido fora da campanha ativa não se desconsidera daqui, então este afiliado não é de teste e não pode ser removido",
    );
    expect(
      await chamar("POST", DESCONSIDERAR, admin, {
        pedido_id: "EFESO-2025",
        motivo: "teste",
      }),
    ).toMatchObject({ status: 404 });
  });

  it("RIFA-040: a mensagem do 409 diferencia os pedidos da campanha ativa (desconsidere) dos de fora dela (o afiliado fica)", async () => {
    const outra = await db
      .prepare(
        `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
           meta_regra, meta_valor, ranking_criterio)
         VALUES ('Outra', 'outra-edicao-mensagem', 0, '2025-11-23', 2000, 'bilhetes', 'por_pessoa', 10,
           'percentual_meta')
         RETURNING id`,
      )
      .first<{ id: number }>();
    // O afiliado 105 com 2 pedidos que contam na campanha ativa e 1 noutra campanha.
    await db.batch([
      db
        .prepare(
          `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em,
             registrado_em)
           VALUES ('EFESO-2025', ?1, 105, 'approved', 1, 2000, '2025-11-24T15:00:00.000Z', '2025-11-24T15:00:00.000Z')`,
        )
        .bind(outra!.id),
      db.prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em,
           registrado_em)
         SELECT 'EFESO-' || n, (SELECT id FROM campanhas WHERE ativa = 1), 105, 'approved', 1, 2000,
           '2026-11-27T15:00:00.000Z', '2026-11-27T15:0' || n || ':00.000Z'
         FROM (SELECT 1 AS n UNION ALL SELECT 2)`,
      ),
    ]);
    const mensagem = async () => {
      const resposta = await chamar("DELETE", removerCaminho(105), admin);
      expect(resposta.status).toBe(409);
      return erroApiSchema.parse(resposta.corpo).erro.mensagem;
    };
    const FICA =
      ": pedido fora da campanha ativa não se desconsidera daqui, então este afiliado não é de teste e não pode ser removido";

    // Misturados: desconsiderar os da ativa não basta, e a mensagem não manda desconsiderar.
    expect(await mensagem()).toBe(
      `O afiliado tem 3 pedidos que contam, 1 fora da campanha ativa${FICA}`,
    );
    // Os da ativa desconsiderados: sobra o de outra campanha, que segura o afiliado.
    for (const pedido_id of ["EFESO-1", "EFESO-2"])
      expect(
        (
          await chamar("POST", DESCONSIDERAR, admin, {
            pedido_id,
            motivo: "teste",
          })
        ).status,
      ).toBe(200);
    expect(await mensagem()).toBe(
      `O afiliado tem 1 pedido que conta, fora da campanha ativa${FICA}`,
    );
    // Os da ativa de volta e o de outra campanha sem contar (desconsiderado à mão, como faria o SQL): só a ativa.
    for (const pedido_id of ["EFESO-1", "EFESO-2"])
      await chamar("POST", RECONSIDERAR, admin, { pedido_id });
    await db
      .prepare(
        "UPDATE pedidos SET desconsiderado_em = '2026-11-28T12:00:00.000Z', desconsiderado_motivo = 'teste' WHERE id = 'EFESO-2025'",
      )
      .run();
    expect(await mensagem()).toBe(
      "O afiliado tem 2 pedidos que contam: desconsidere os pedidos (teste) na tela Pedidos antes de remover",
    );
    // Sem campanha ativa, nenhum pedido se desconsidera daqui: todos ficam fora.
    await db.prepare("UPDATE campanhas SET ativa = 0").run();
    expect(await mensagem()).toBe(
      `O afiliado tem 2 pedidos que contam, todos fora da campanha ativa${FICA}`,
    );
    expect(await afiliado(105)).not.toBeNull();
  });

  it("só com desconsiderados: 204; eles ficam sem afiliado (e desconsiderados) no mesmo lote; a trilha guarda quantos e os ids; um evento depois o traz de volta como não vinculado", async () => {
    await chamar("POST", DESCONSIDERAR, admin, {
      pedido_id: ALVO.id,
      motivo: "teste",
    });
    const antes = await contas();
    expect(await chamar("DELETE", removerCaminho(103), admin)).toEqual({
      status: 204,
      corpo: null,
    });
    expect(await afiliado(103)).toBeNull();
    expect(
      await db
        .prepare(
          "SELECT affiliate_id, desconsiderado_motivo FROM pedidos WHERE id = ?1",
        )
        .bind(ALVO.id)
        .first(),
    ).toEqual({ affiliate_id: null, desconsiderado_motivo: "teste" });
    expect(await ultimaDaTrilha("afiliado.remover")).toEqual({
      usuario_id: adminId,
      acao: "afiliado.remover",
      alvo: "afiliado:103",
      resumo: `Afiliado removido (célula 3); 1 pedido desconsiderado ficou sem afiliado: ["${ALVO.id}"]`,
    });
    // As contas não mudam (ele já não contava). Mudam só os afiliados e a adesão (o afiliado 103 saiu) e a visão
    // individual, que mostra quantos afiliados a célula tem vinculados (D14).
    const depois = await contas();
    const mudaram = (Object.keys(depois) as (keyof typeof depois)[]).filter(
      (chave) => JSON.stringify(depois[chave]) !== JSON.stringify(antes[chave]),
    );
    expect(mudaram).toEqual([
      "afiliados",
      "adesao",
      "minhaLider",
      "minhaDiscipulador",
      "minhaRede",
    ]);

    // A Rifei manda um evento do pedido com o affiliate_id removido: o afiliado volta, não vinculado (D7), e o
    // pedido continua desconsiderado (o afiliado tardio só preenche o afiliado).
    expect(
      await webhook({
        ...paidOrderAfiliado,
        id: ALVO.id,
        affiliate_id: 103,
      }),
    ).toMatchObject({ resultado: "duplicado" });
    expect(await afiliado(103)).toEqual({
      affiliate_id: 103,
      celula_id: null,
      origem: "webhook",
    });
    expect(
      await db
        .prepare(
          "SELECT affiliate_id, desconsiderado_motivo FROM pedidos WHERE id = ?1",
        )
        .bind(ALVO.id)
        .first(),
    ).toEqual({ affiliate_id: 103, desconsiderado_motivo: "teste" });
  });

  it("só admin no DELETE: a coordenação leva 403, e o PUT do mesmo caminho continua da coordenação", async () => {
    expect(await chamar("DELETE", removerCaminho(101), coordenacao)).toEqual({
      status: 403,
      corpo: erro("proibido"),
    });
    expect(
      await chamar("PUT", removerCaminho(101), coordenacao, { celula_id: 2 }),
    ).toMatchObject({
      status: 200,
      corpo: { affiliate_id: 101, celula_id: 2 },
    });
    expect(await chamar("DELETE", removerCaminho("abc"), admin)).toMatchObject({
      status: 400,
      corpo: { erro: { codigo: "requisicao_invalida" } },
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// CA6: as mensagens do WhatsApp no PUT da campanha
// ---------------------------------------------------------------------------------------------------

describe("CA6: os modelos das mensagens no PUT da campanha", () => {
  beforeEach(async () => {
    await semear();
  });

  // As mensagens são só do admin (RIFA-042): a coordenação está no bloco seguinte.
  const salvar = (corpo: Partial<CampanhaEntrada>) =>
    chamar("PUT", ROTAS.salvarCampanha.caminho, admin, {
      ...DADOS_CAMPANHA,
      ...corpo,
    });

  it("recusa marcador desconhecido, marcador fora do tipo e a falta do {link}, com a mensagem em português", async () => {
    for (const [tipo, modelo, mensagem] of [
      [
        "link_lider",
        "Oi {Nome}, entre: {link}",
        "Marcador {Nome} não existe nesta mensagem. Use: {nome}, {saudacao}, {alvo}, {link}.",
      ],
      [
        "link_coordenacao",
        "{saudacao} da {alvo}: {link}",
        "Marcador {alvo} não existe nesta mensagem. Use: {nome}, {saudacao}, {link}.",
      ],
      [
        "link_rede",
        "{saudacao} Entre pelo link de sempre",
        "A mensagem precisa ter {link}: é por ele que a pessoa entra.",
      ],
    ] as const) {
      const resposta = await salvar({
        mensagens: { ...MENSAGENS_PADRAO, [tipo]: modelo },
      });
      expect(resposta).toMatchObject({
        status: 400,
        corpo: {
          erro: {
            codigo: "requisicao_invalida",
            detalhes: expect.arrayContaining([
              expect.objectContaining({
                caminho: ["mensagens", tipo],
                mensagem,
              }),
            ]),
          },
        },
      });
    }
    // Nada gravado.
    expect(
      campanhaSchema.parse(
        (await chamar("GET", ROTAS.obterCampanha.caminho, admin)).corpo,
      ).mensagens,
    ).toEqual(MENSAGENS_PADRAO);
  });

  it("grava o modelo válido e a trilha diz as chaves (antes e depois) e o nome do modelo alterado", async () => {
    const mensagens = {
      ...MENSAGENS_PADRAO,
      link_lider: "{saudacao} O link da célula {alvo}:\n{link}",
    };
    const resposta = await salvar({
      acesso: { discipuladores: false, redes: true },
      mensagens,
    });
    expect(resposta.status).toBe(200);
    expect(campanhaSchema.parse(resposta.corpo)).toMatchObject({
      acesso: { discipuladores: false, redes: true },
      mensagens,
    });
    expect((await ultimaDaTrilha("campanha.salvar"))?.resumo).toBe(
      "Alterado: acesso.discipuladores: ligado → desligado, mensagens.link_lider",
    );
  });

  it("um modelo gravado fora das regras (SQL à mão) não derruba o painel, as rotas abertas, a campanha nem a visão", async () => {
    await db
      .prepare(
        "UPDATE campanhas SET mensagem_link_lider = 'Oi {Nome}, sem o link' WHERE ativa = 1",
      )
      .run();
    for (const [caminho, quem] of [
      [ROTAS.obterCampanha.caminho, admin],
      ["/api/painel/resumo", admin],
      ["/api/publico/ranking", admin],
      ["/api/publico/bumbo", admin],
      ["/api/minha/visao", hierarquia.lider],
    ] as const)
      expect({
        caminho,
        status: (await chamar("GET", caminho, quem)).status,
      }).toEqual({ caminho, status: 200 });
    expect(
      campanhaSchema.parse(
        (await chamar("GET", ROTAS.obterCampanha.caminho, admin)).corpo,
      ).mensagens.link_lider,
    ).toBe("Oi {Nome}, sem o link");
  });

  it("RIFA-042 (CA3): recusa o {link} colado (?u={link}, x{link}) e outro endereço (400, nada gravado); os quatro padrões passam", async () => {
    const COLADO = "Deixe o {link} no começo da mensagem";
    const ENDERECO = "Tire o outro endereço da mensagem";
    for (const [tipo, modelo, trecho] of [
      [
        "link_coordenacao",
        "{saudacao} Seu acesso: https://outro.site/?u={link}",
        COLADO,
      ],
      ["link_coordenacao", "{saudacao} Seu acesso: ?u={link}", COLADO],
      ["link_lider", "{saudacao} A {alvo} entra por x{link}", COLADO],
      ["link_rede", "{saudacao} Veja www.outro.site antes:\n{link}", ENDERECO],
      [
        "link_discipulador",
        "{saudacao} Veja https://outro.site antes:\n{link}",
        ENDERECO,
      ],
    ] as const) {
      const resposta = await salvar({
        mensagens: { ...MENSAGENS_PADRAO, [tipo]: modelo },
      });
      expect({ modelo, resposta }).toMatchObject({
        modelo,
        resposta: {
          status: 400,
          corpo: {
            erro: {
              codigo: "requisicao_invalida",
              detalhes: expect.arrayContaining([
                expect.objectContaining({
                  caminho: ["mensagens", tipo],
                  mensagem: expect.stringContaining(trecho),
                }),
              ]),
            },
          },
        },
      });
    }
    const trilha = await contarTrilha("campanha.salvar");
    expect(
      campanhaSchema.parse(
        (await chamar("GET", ROTAS.obterCampanha.caminho, admin)).corpo,
      ).mensagens,
    ).toEqual(MENSAGENS_PADRAO);
    // Os quatro padrões, mandados por inteiro, continuam válidos.
    expect((await salvar({ mensagens: { ...MENSAGENS_PADRAO } })).status).toBe(
      200,
    );
    expect(await contarTrilha("campanha.salvar")).toBe(trilha + 1);
  });
});

// ---------------------------------------------------------------------------------------------------
// RIFA-042 (CA1): os grupos pedidos, acesso e mensagens da campanha são só do admin (adendo da D20)
// ---------------------------------------------------------------------------------------------------

/**
 * O banco dos testes com uma escrita de outra pessoa logo antes do lote da gravação (depois de a rota ler a
 * campanha): a corrida "um admin muda os grupos enquanto a coordenação salva".
 */
function bancoComEscritaAntesDoLote(sql: string): D1Database {
  return new Proxy(db, {
    get(alvo, nome) {
      if (nome === "batch")
        return async (comandos: D1PreparedStatement[]) => {
          await alvo.prepare(sql).run();
          return alvo.batch(comandos);
        };
      const valor: unknown = Reflect.get(alvo, nome, alvo);
      return typeof valor === "function" ? valor.bind(alvo) : valor;
    },
  });
}

describe("RIFA-042 (CA1): pedidos, acesso e mensagens da campanha são só do admin", () => {
  beforeEach(async () => {
    // A campanha do cenário com a chave de desconsiderar ligada; acesso e mensagens com os padrões.
    await semear();
  });

  const lerCampanha = async () =>
    campanhaSchema.parse(
      (await chamar("GET", ROTAS.obterCampanha.caminho, admin)).corpo,
    );
  const salvarComo = (
    quem: Record<string, string>,
    corpo: Partial<CampanhaEntrada>,
    banco?: D1Database,
  ) =>
    chamar(
      "PUT",
      ROTAS.salvarCampanha.caminho,
      quem,
      { ...DADOS_CAMPANHA, ...corpo },
      banco,
    );
  const gruposDe = ({ pedidos, acesso, mensagens }: Campanha) => ({
    pedidos,
    acesso,
    mensagens,
  });

  it("a coordenação que manda um dos três diferente do gravado leva 403 proibido, e nada é gravado (nem o resto do corpo, nem a trilha)", async () => {
    const antes = await lerCampanha();
    const trilha = await contarTrilha("campanha.salvar");
    for (const [grupo, mudanca] of [
      ["pedidos", { pedidos: { desconsiderar: false } }],
      ["acesso", { acesso: { discipuladores: true, redes: false } }],
      [
        "mensagens",
        {
          mensagens: {
            ...MENSAGENS_PADRAO,
            link_rede: "{saudacao} A rede {alvo} entra por aqui:\n{link}",
          },
        },
      ],
    ] as const) {
      const resposta = await salvarComo(coordenacao, {
        ...gruposDe(antes),
        ...mudanca,
        nome: "Nome que não pode entrar",
      });
      expect({ grupo, resposta }).toEqual({
        grupo,
        resposta: { status: 403, corpo: erro("proibido") },
      });
      expect(erroApiSchema.parse(resposta.corpo).erro.mensagem).toMatch(
        new RegExp(
          `^Só o admin muda os grupos pedidos, acesso e mensagens da campanha \\(este salvamento mudava: ${grupo}\\)\\. Nada foi salvo`,
        ),
      );
    }
    // Os três de uma vez: a mensagem diz todos.
    const todos = await salvarComo(coordenacao, {
      pedidos: { desconsiderar: false },
      acesso: { discipuladores: false, redes: false },
      mensagens: { ...MENSAGENS_PADRAO, link_lider: "{link}" },
    });
    expect(erroApiSchema.parse(todos.corpo).erro.mensagem).toContain(
      "(este salvamento mudava: pedidos, acesso, mensagens)",
    );
    expect(await lerCampanha()).toEqual(antes);
    expect(await contarTrilha("campanha.salvar")).toBe(trilha);
  });

  it("ausentes ou iguais ao gravado passam: o resto é gravado e os três continuam como estavam", async () => {
    // Um modelo editado e um acesso desligado pelo admin, para "igual ao gravado" não ser só o padrão.
    const doAdmin = {
      pedidos: { desconsiderar: true },
      acesso: { discipuladores: true, redes: false },
      mensagens: {
        ...MENSAGENS_PADRAO,
        link_coordenacao: "{saudacao} Seu acesso à rifa:\n{link}",
      },
    };
    expect((await salvarComo(admin, doAdmin)).status).toBe(200);

    const ausentes = await salvarComo(coordenacao, {
      nome: "Rifa da coordenação",
    });
    expect(ausentes.status).toBe(200);
    expect(campanhaSchema.parse(ausentes.corpo)).toMatchObject({
      nome: "Rifa da coordenação",
      ...doAdmin,
    });

    // Iguais: como uma aba antiga do site, que mandava sempre os três.
    const iguais = await salvarComo(coordenacao, {
      nome: "Rifa da coordenação de novo",
      ...doAdmin,
    });
    expect(iguais.status).toBe(200);
    expect(await lerCampanha()).toMatchObject({
      nome: "Rifa da coordenação de novo",
      ...doAdmin,
    });
    expect(await ultimaDaTrilha("campanha.salvar")).toMatchObject({
      resumo: "Alterado: nome",
    });
  });

  it("o admin muda os três (e a trilha diz quem e o quê)", async () => {
    const mudanca = {
      pedidos: { desconsiderar: false },
      acesso: { discipuladores: false, redes: false },
      mensagens: {
        ...MENSAGENS_PADRAO,
        link_rede: "{saudacao} A rede {alvo} entra por aqui:\n{link}",
      },
    };
    const resposta = await salvarComo(admin, mudanca);
    expect(resposta.status).toBe(200);
    expect(campanhaSchema.parse(resposta.corpo)).toMatchObject(mudanca);
    expect(await lerCampanha()).toMatchObject(mudanca);
    expect(await ultimaDaTrilha("campanha.salvar")).toMatchObject({
      usuario_id: adminId,
      resumo:
        "Alterado: pedidos.desconsiderar: ligado → desligado, acesso.discipuladores: ligado → desligado, acesso.redes: ligado → desligado, mensagens.link_rede",
    });
  });

  it("sem campanha ativa, o gravado é o padrão: a coordenação cria com os padrões (ou sem os grupos); fora deles, 403", async () => {
    await db.prepare("UPDATE campanhas SET ativa = 0 WHERE ativa = 1").run();
    const nova = { slug_rifei: "rifa-nova-da-coordenacao" };
    const recusada = await salvarComo(coordenacao, {
      ...nova,
      acesso: { discipuladores: true, redes: false },
    });
    expect(recusada).toEqual({ status: 403, corpo: erro("proibido") });
    expect(
      (await chamar("GET", ROTAS.obterCampanha.caminho, admin)).status,
    ).toBe(404);

    const criada = await salvarComo(coordenacao, {
      ...nova,
      pedidos: { desconsiderar: false },
      acesso: { discipuladores: true, redes: true },
      mensagens: { ...MENSAGENS_PADRAO },
    });
    expect(criada.status).toBe(200);
    expect(gruposDe(campanhaSchema.parse(criada.corpo))).toEqual({
      pedidos: { desconsiderar: false },
      acesso: { discipuladores: true, redes: true },
      mensagens: MENSAGENS_PADRAO,
    });
  });

  it("a gravação da coordenação não escreve os três: um admin que os muda entre a leitura e o lote não é desfeito", async () => {
    const antes = await lerCampanha();
    const modeloDoAdmin = "{saudacao} Rede {alvo}, o seu link:\n{link}";
    const banco = bancoComEscritaAntesDoLote(
      `UPDATE campanhas SET pedidos_desconsiderar = 0, acesso_redes = 0,
         mensagem_link_rede = '${modeloDoAdmin}' WHERE ativa = 1`,
    );

    // A coordenação manda os três iguais ao que leu (como estavam antes do admin).
    const resposta = await salvarComo(
      coordenacao,
      { nome: "Rifa da coordenação", ...gruposDe(antes) },
      banco,
    );

    expect(resposta.status).toBe(200);
    expect(gruposDe(campanhaSchema.parse(resposta.corpo))).toEqual({
      pedidos: { desconsiderar: false },
      acesso: { discipuladores: true, redes: false },
      mensagens: { ...MENSAGENS_PADRAO, link_rede: modeloDoAdmin },
    });
    expect((await lerCampanha()).nome).toBe("Rifa da coordenação");
  });
});

// ---------------------------------------------------------------------------------------------------
// CA7: orçamento do D1 (D10)
// ---------------------------------------------------------------------------------------------------

describe("CA7: desconsiderar e reconsiderar: um lote (e a leitura curta só sem mudança), 10 linhas lidas no máximo", () => {
  it("as idas e as linhas lidas exatas: ao mudar, o lote (trilha, UPDATE e item); sem mudança e no 409, o lote e a leitura curta", async () => {
    await semear();
    // Uma sessão nova: o toque do último uso (uma escrita por minuto) não entra na conta.
    const sessao = await cabecalhosDeSessao("admin");
    const medir = async (caminho: string, corpo: object) => {
      const { db: contado, contagem } = bancoQueConta();
      const resposta = await chamar("POST", caminho, sessao, corpo, contado);
      return { status: resposta.status, ...contagem };
    };
    // A sessão (1 comando, 5 linhas com a do admin) e o lote (3 comandos); sem mudança, mais a leitura curta.
    // Medido: ao desconsiderar, 10 linhas no lote (a trilha 4, com a chave estrangeira do autor; o UPDATE 3; o
    // item 3); ao reconsiderar, 9; sem mudança, 5 no lote e 4 na leitura curta.
    const casos = [
      [
        "desconsiderar",
        DESCONSIDERAR,
        { pedido_id: ALVO.id, motivo: "teste" },
        200,
        2,
        4,
        10,
      ],
      [
        "repetido",
        DESCONSIDERAR,
        { pedido_id: ALVO.id, motivo: "teste" },
        200,
        3,
        5,
        9,
      ],
      ["reconsiderar", RECONSIDERAR, { pedido_id: ALVO.id }, 200, 2, 4, 9],
      ["repetido", RECONSIDERAR, { pedido_id: ALVO.id }, 200, 3, 5, 9],
    ] as const;
    for (const [
      nome,
      caminho,
      corpo,
      status,
      idas,
      comandos,
      linhas,
    ] of casos) {
      const { linhasLidasTotal, linhasLidas, ...medida } = await medir(
        caminho,
        corpo,
      );
      expect({
        nome,
        ...medida,
        linhas: linhasLidasTotal - LINHAS_DA_SESSAO,
      }).toMatchObject({
        nome,
        status,
        idas,
        comandos,
        linhas,
      });
      expect(linhasLidas).toBeLessThanOrEqual(10);
    }
    await ligarChave(false);
    const { linhasLidasTotal, ...recusado } = await medir(DESCONSIDERAR, {
      pedido_id: ALVO.id,
      motivo: "teste",
    });
    expect(recusado).toMatchObject({ status: 409, idas: 3, comandos: 5 });
    expect(linhasLidasTotal - LINHAS_DA_SESSAO).toBeLessThanOrEqual(10);
  });
});

describe("CA7: a chave de acesso custa +1 linha (a campanha ativa) no login de discipulador e rede, na mesma consulta", () => {
  it("POST /api/sessao: a busca do link lê, exatas, as linhas de hoje (+1 no discipulador e na rede), numa ida só", async () => {
    await semear();
    const medidas: Record<string, { idas: number; linhas: number }> = {};
    for (const [papel, alvo] of [
      ["lider", 3],
      ["discipulador", 20],
      ["rede", 1],
    ] as const) {
      const { token } = await criarAcessoDaHierarquiaNoBanco(papel, alvo);
      const { db: contado, contagem } = bancoQueConta();
      const link = await buscarLinkValido(
        contado,
        await sha256Hex(token),
        new Date().toISOString(),
      );
      expect(link).toMatchObject({ acessoLigado: true, usuario: { papel } });
      medidas[papel] = {
        idas: contagem.idas,
        linhas: contagem.linhasLidasTotal,
      };
    }
    // Medido: o link e o usuário (2) e o alvo com a hierarquia (líder 3, discipulador 2, rede 1), mais a campanha
    // da chave no discipulador e na rede.
    expect(medidas).toEqual({
      lider: { idas: 1, linhas: 2 + 3 },
      discipulador: { idas: 1, linhas: 2 + 2 + 1 },
      rede: { idas: 1, linhas: 2 + 1 + 1 },
    });
  });
});
