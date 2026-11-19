// RIFA-056: o "Recuperar" da conferência pelo CSV marca como pago o pedido do "Pagamento não registrado" (pago na
// Rifei; no sistema pendente ou expirado, porque o "Pedido novo" chegou e o "Pedido pago" não: o Pix manual marcado
// à mão no painel da Rifei, ou o webhook fora do ar entre os dois avisos). Só o admin; com o mesmo cuidado da venda
// perdida. Com o D1 dos testes, o relógio fixo e o cenário de conferencia-apoio.ts (o R-0005 está pendente no
// sistema e pago no arquivo; o R-0009, expirado). Todo dado é fictício.
import { env, exports } from "cloudflare:workers";
import { Hono } from "hono";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import expiredOrder from "../../../test/fixtures/rifei/expired_order.json";
import paidOrderAfiliado from "../../../test/fixtures/rifei/paid_order.afiliado.json";
import {
  respostaAnaliseReconciliacaoSchema,
  respostaListaRecuperacoesSchema,
  respostaPainelResumoSchema,
  respostaRankingSchema,
  respostaRecuperarReconciliacaoSchema,
  type CorpoConferencia,
  type Divergencia,
  type PedidoRecuperado,
  type RespostaAnalisePorPedido,
  type UsuarioSessao,
} from "../../shared/contracts";
import { gravarRecuperacao } from "../db/reconciliacao";
import { ORIGEM, cabecalhosDeSessao } from "../test/acesso-teste";
import {
  AGORA_CONFERENCIA,
  LINHAS_DO_CENARIO,
  corpoDe,
  criarAdminDaConferencia,
  criarAppDaConferencia,
  criarPessoaDaCoordenacao,
  csvDoCenario,
  obter,
  postar,
  semearConferencia,
  type AppDaConferencia,
  type LinhaRifei,
} from "../test/conferencia-apoio";
import { DADOS_CAMPANHA } from "../test/painel-apoio";
import { webhookRifei } from "./webhook-rifei";

const ANALISAR = "/api/admin/reconciliacao/analisar";
const RECUPERAR = "/api/admin/reconciliacao/recuperar";
const RECUPERACOES = "/api/admin/reconciliacao/recuperacoes";

/** 26/11/2026 10:00 em Belém: a data do pagamento do R-0005 no arquivo do cenário. */
const PAGO_EM_R0005 = "2026-11-26T13:00:00.000Z";

let admin: UsuarioSessao;
let coordenacao: UsuarioSessao;
const comoAdmin = criarAppDaConferencia(() => admin);
const comoCoordenacao = criarAppDaConferencia(() => coordenacao);

beforeAll(async () => {
  admin = await criarAdminDaConferencia();
  coordenacao = await criarPessoaDaCoordenacao(
    "Coordenadora Ficticia do Pagamento",
  );
});

beforeEach(async () => {
  await semearConferencia();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** As linhas do cenário com as trocas dadas por código do pedido. */
function linhasCom(trocas: Record<string, Partial<LinhaRifei>>): LinhaRifei[] {
  return LINHAS_DO_CENARIO.map((linha) => ({
    ...linha,
    ...trocas[linha.pedido],
  }));
}

async function corpo(
  linhas: readonly LinhaRifei[] = LINHAS_DO_CENARIO,
): Promise<CorpoConferencia> {
  return (await corpoDe(csvDoCenario(linhas))).corpo;
}

async function analisar(
  enviado: CorpoConferencia,
  app: AppDaConferencia = comoAdmin,
): Promise<RespostaAnalisePorPedido> {
  const resposta = await postar(app, ANALISAR, enviado);
  expect(resposta.status).toBe(200);
  const analise = respostaAnaliseReconciliacaoSchema.parse(resposta.corpo);
  if (analise.modo !== "por_pedido")
    throw new Error("esperava o modo por pedido");
  return analise;
}

async function recuperar(enviado: object, app: AppDaConferencia = comoAdmin) {
  const resposta = await postar(app, RECUPERAR, enviado);
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status: 200,
  });
  return respostaRecuperarReconciliacaoSchema.parse(resposta.corpo);
}

const naoRegistrados = (analise: RespostaAnalisePorPedido): Divergencia[] =>
  analise.divergencias.find(
    (grupo) => grupo.tipo === "pagamento_nao_registrado",
  )!.itens;

/** O pedido inteiro, como está no banco. */
const linhaDoPedido = (id: string) =>
  env.DB.prepare("SELECT * FROM pedidos WHERE id = ?1")
    .bind(id)
    .first<Record<string, unknown>>();

async function contar(tabela: string, onde = "1 = 1"): Promise<number> {
  const linha = await env.DB.prepare(
    `SELECT count(*) AS total FROM ${tabela} WHERE ${onde}`,
  ).first<{ total: number }>();
  return linha?.total ?? -1;
}

const resumoDoPainel = async () =>
  respostaPainelResumoSchema.parse(
    (await obter(comoAdmin, "/api/painel/resumo")).corpo,
  ).vendas;

const vendasDaCelula = async (id: number) =>
  respostaRankingSchema
    .parse(
      (await obter(comoAdmin, "/api/painel/ranking?periodo=campanha")).corpo,
    )
    .itens.find((item) => item.id === id)!.vendas;

/**
 * Um evento do webhook (o exemplo `modelo`) para o pedido, com os dados do cenário (o afiliado 101 e 2 bilhetes de
 * R$ 20,00) e as trocas dadas.
 */
async function eventoDoWebhook(modelo: object, trocas: object) {
  const webhook = new Hono<{ Bindings: Cloudflare.Env }>();
  webhook.route("/", webhookRifei);
  const res = await webhook.request(
    "/api/webhooks/rifei",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RIFEI_WEBHOOK_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...modelo,
        slug: DADOS_CAMPANHA.slug_rifei,
        affiliate_id: 101,
        numbers: [501, 502],
        numbers_count: 2,
        subtotal: 40,
        total: 40,
        ...trocas,
      }),
    },
    env,
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { resultado: string }).resultado;
}

/** Um "Pedido pago" do webhook para o pedido. */
const pedidoPagoPeloWebhook = (id: string, aprovadoEm: string) =>
  eventoDoWebhook(paidOrderAfiliado, { id, approved_at: aprovadoEm });

/** Um "Pedido expirado" do webhook para o pedido (o prazo do Pix acabou na Rifei). */
const pedidoExpiradoPeloWebhook = (id: string) =>
  eventoDoWebhook(expiredOrder, {
    id,
    coupon_id: null,
    coupon_discount: null,
  });

/** Tira do pedido o que a correção muda (status, data do pagamento, atualização e a ligação com a recuperação). */
const QUE_MUDAM = new Set([
  "status",
  "aprovado_em",
  "atualizado_em",
  "pagamento_recuperacao_id",
]);
function semOQueMuda(linha: Record<string, unknown> | null) {
  return Object.fromEntries(
    Object.entries(linha ?? {}).filter(([coluna]) => !QUE_MUDAM.has(coluna)),
  );
}

describe("RIFA-056: a análise oferece o pagamento não registrado para corrigir", () => {
  it("pendente no sistema e pago no arquivo, com tudo confirmado: recuperável, sem observação (também na análise da coordenação)", async () => {
    for (const app of [comoAdmin, comoCoordenacao]) {
      const itens = naoRegistrados(await analisar(await corpo(), app));
      expect(
        itens.map((item) => [
          item.pedido_id,
          item.recuperavel,
          item.observacoes,
        ]),
      ).toEqual([["R-0005", true, []]]);
      expect(itens[0].sistema).toMatchObject({
        status: "in_process",
        aprovado_em: null,
      });
    }
  });

  it("as observações que impedem: quantidade, valor ou afiliado diferentes do gravado, sem valor, sem quantidade e data no futuro", async () => {
    const casos: [Partial<LinhaRifei>, string[]][] = [
      [{ valor: "R$ 50,00" }, ["valor_diferente"]],
      [{ quantidade: "3", bilhetes: "" }, ["quantidade_diferente"]],
      [{ afiliado: "102" }, ["afiliado_diferente"]],
      // Vazio no arquivo é "sem afiliado": diferente do 101 gravado.
      [{ afiliado: "" }, ["afiliado_diferente"]],
      [{ valor: "" }, ["sem_valor"]],
      [{ quantidade: "", bilhetes: "" }, ["sem_quantidade"]],
      [{ data: "05/12/2026 10:00" }, ["data_no_futuro"]],
      [
        { quantidade: "3", bilhetes: "", valor: "R$ 60,00", afiliado: "102" },
        ["quantidade_diferente", "valor_diferente", "afiliado_diferente"],
      ],
    ];
    for (const [troca, observacoes] of casos) {
      const enviado = await corpo(linhasCom({ "R-0005": troca }));
      const [item] = naoRegistrados(await analisar(enviado));
      expect({
        troca,
        recuperavel: item.recuperavel,
        observacoes: item.observacoes,
      }).toEqual({
        troca,
        recuperavel: false,
        observacoes,
      });
      // O Recuperar do admin também não o marca: o primeiro motivo, e nada muda no banco.
      const antes = await linhaDoPedido("R-0005");
      const resultado = await recuperar({ ...enviado, pedidos: ["R-0005"] });
      expect(resultado.recuperados).toEqual([]);
      expect(resultado.nao_recuperados).toEqual([
        { pedido_id: "R-0005", motivo: observacoes[0] },
      ]);
      expect(await linhaDoPedido("R-0005")).toEqual(antes);
    }
    expect(await contar("recuperacoes")).toBe(0);
  });

  it("o afiliado sem a coluna ou não reconhecido não compara: recuperável, e o pedido fica com o afiliado gravado", async () => {
    const naoReconhecido = await corpo(
      linhasCom({ "R-0005": { afiliado: "lider.desconhecido" } }),
    );
    expect(naoRegistrados(await analisar(naoReconhecido))[0]).toMatchObject({
      recuperavel: true,
      observacoes: [],
    });
    const previa = await recuperar({
      ...naoReconhecido,
      pedidos: ["R-0005"],
      simular: true,
    });
    expect(previa.recuperados).toEqual([
      expect.objectContaining({
        tipo: "pagamento_nao_registrado",
        afiliado: "nao_reconhecido",
        affiliate_id: 101,
        celula: { id: 1, nome: "Célula Ágape" },
      }),
    ]);

    const semColuna = (await corpoDe(csvDoCenario())).arquivo;
    const enviado = (
      await corpoDe(csvDoCenario(), {
        ...semColuna.mapeamentoDetectado,
        afiliado: null,
      })
    ).corpo;
    expect(naoRegistrados(await analisar(enviado))[0]).toMatchObject({
      recuperavel: true,
      observacoes: [],
    });
    const resultado = await recuperar({ ...enviado, pedidos: ["R-0005"] });
    expect(resultado.recuperados[0]).toMatchObject({
      afiliado: "sem_coluna",
      affiliate_id: 101,
    });
    // "Uma venda recuperada entra sem afiliado" não vale para o pagamento registrado: sem o aviso.
    expect(resultado.avisos.map((aviso) => aviso.codigo)).not.toContain(
      "sem_coluna_afiliado",
    );
    expect(await linhaDoPedido("R-0005")).toMatchObject({
      status: "approved",
      affiliate_id: 101,
    });
  });
});

describe("RIFA-056: o admin marca como pago", () => {
  it("pendente → pago: a prévia não grava; a gravação muda só o status, a data do pagamento e a ligação com a recuperação", async () => {
    const enviado = { ...(await corpo()), pedidos: ["R-0005"] };
    const antes = await linhaDoPedido("R-0005");

    const previa = await recuperar({ ...enviado, simular: true });
    const esperado: PedidoRecuperado = {
      pedido_id: "R-0005",
      tipo: "pagamento_nao_registrado",
      qtd_bilhetes: 2,
      total_centavos: 4000,
      afiliado: "reconhecido",
      affiliate_id: 101,
      celula: { id: 1, nome: "Célula Ágape" },
      aprovado_em: PAGO_EM_R0005,
      origem_data: "arquivo",
    };
    expect(previa).toMatchObject({
      simulado: true,
      aplicado: false,
      recuperacao_id: null,
      recuperados: [esperado],
      nao_recuperados: [],
      totais: { pedidos_aprovados: 1, bilhetes: 2, total_centavos: 4000 },
    });
    expect(await linhaDoPedido("R-0005")).toEqual(antes);
    expect(await contar("recuperacoes")).toBe(0);

    const resultado = await recuperar(enviado);
    expect(resultado).toMatchObject({
      simulado: false,
      aplicado: true,
      recuperacao_id: expect.any(Number),
      recuperados: [esperado],
      nao_recuperados: [],
    });
    const depois = await linhaDoPedido("R-0005");
    expect(depois).toMatchObject({
      status: "approved",
      aprovado_em: PAGO_EM_R0005,
      atualizado_em: AGORA_CONFERENCIA.toISOString(),
      pagamento_recuperacao_id: resultado.recuperacao_id,
      // O pedido continua do webhook: não vira "recuperado na conferência".
      origem: "webhook",
      recuperacao_id: null,
      qtd_bilhetes: 2,
      total_centavos: 4000,
      affiliate_id: 101,
    });
    // Nada mais muda (nem a quantidade, o valor, o afiliado, os dados do webhook ou `registrado_em`).
    expect(semOQueMuda(depois)).toEqual(semOQueMuda(antes));
  });

  it("expirado → pago, com o dia do arquivo (meio-dia em Belém) quando o arquivo não traz a hora", async () => {
    const enviado = await corpo(
      linhasCom({ "R-0009": { status: "Pago", data: "27/11/2026" } }),
    );
    expect(
      naoRegistrados(await analisar(enviado)).map((item) => [
        item.pedido_id,
        item.sistema?.status,
        item.recuperavel,
      ]),
    ).toEqual([
      ["R-0005", "in_process", true],
      ["R-0009", "expired", true],
    ]);
    const antes = await linhaDoPedido("R-0009");

    const resultado = await recuperar({ ...enviado, pedidos: ["R-0009"] });

    expect(resultado.recuperados).toEqual([
      expect.objectContaining({
        pedido_id: "R-0009",
        tipo: "pagamento_nao_registrado",
        aprovado_em: "2026-11-27T15:00:00.000Z",
        origem_data: "dia_do_arquivo",
      }),
    ]);
    const depois = await linhaDoPedido("R-0009");
    expect(depois).toMatchObject({
      status: "approved",
      aprovado_em: "2026-11-27T15:00:00.000Z",
      pagamento_recuperacao_id: resultado.recuperacao_id,
    });
    expect(semOQueMuda(depois)).toEqual(semOQueMuda(antes));
  });

  it("já pago não muda: o pedido pago do webhook e a venda perdida já recuperada ficam como estão (ja_existe)", async () => {
    const enviado = { ...(await corpo()), pedidos: ["R-0101"] };
    await recuperar(enviado);
    const antes = await Promise.all(["R-0001", "R-0101"].map(linhaDoPedido));

    const resultado = await recuperar({
      ...enviado,
      pedidos: ["R-0001", "R-0101"],
    });

    expect(resultado).toMatchObject({ aplicado: false, recuperados: [] });
    expect(resultado.nao_recuperados).toEqual([
      { pedido_id: "R-0001", motivo: "ja_existe" },
      { pedido_id: "R-0101", motivo: "ja_existe" },
    ]);
    expect(await Promise.all(["R-0001", "R-0101"].map(linhaDoPedido))).toEqual(
      antes,
    );
  });

  it("o desconsiderado (D20) nunca volta sozinho: fica no grupo à parte e o Recuperar não o marca, nem se a desconsideração vem no meio", async () => {
    await env.DB.prepare(
      `UPDATE pedidos SET desconsiderado_em = '2026-11-30T12:00:00.000Z', desconsiderado_motivo = 'teste'
       WHERE id = 'R-0005'`,
    ).run();
    const enviado = await corpo();
    const analise = await analisar(enviado);
    expect(naoRegistrados(analise)).toEqual([]);
    expect(analise.desconsiderados.itens.map((item) => item.pedido_id)).toEqual(
      ["R-0005"],
    );
    const antes = await linhaDoPedido("R-0005");
    const resultado = await recuperar({ ...enviado, pedidos: ["R-0005"] });
    expect(resultado.nao_recuperados).toEqual([
      { pedido_id: "R-0005", motivo: "ja_existe" },
    ]);
    expect(await linhaDoPedido("R-0005")).toEqual(antes);

    // A desconsideração entre a prévia e a gravação: o lote confere de novo e não muda nada.
    const campanha = await env.DB.prepare(
      "SELECT id FROM campanhas WHERE ativa = 1",
    ).first<{ id: number }>();
    const gravacao = await gravarRecuperacao(env.DB, {
      campanhaId: campanha!.id,
      usuarioId: admin.id,
      executadoEm: AGORA_CONFERENCIA.toISOString(),
      pedidosSolicitados: 1,
      linhasArquivo: 1,
      arquivoSha256: "0".repeat(64),
      colunas: enviado.colunas,
      pedidos: [
        {
          pedido_id: "R-0005",
          tipo: "pagamento_nao_registrado",
          qtd_bilhetes: 2,
          total_centavos: 4000,
          afiliado: "reconhecido",
          affiliate_id: 101,
          celula: null,
          aprovado_em: PAGO_EM_R0005,
          origem_data: "arquivo",
        },
      ],
      precoBilheteCentavos: DADOS_CAMPANHA.preco_bilhete_centavos,
    });
    expect(gravacao).toEqual({ recuperacaoId: null, gravados: new Set() });
    expect(await linhaDoPedido("R-0005")).toEqual(antes);
    expect(await contar("recuperacoes")).toBe(0);
    expect(await contar("auditoria")).toBe(0);
  });

  it("o pedido de outra campanha nunca é tocado: pendente lá e pago no arquivo, fica como está (ja_existe), nem pelo lote", async () => {
    await env.DB.prepare(
      "UPDATE pedidos SET status = 'in_process', aprovado_em = NULL WHERE id = 'R-OUTRA'",
    ).run();
    const enviado = await corpo();
    expect(
      naoRegistrados(await analisar(enviado)).map((item) => item.pedido_id),
    ).toEqual(["R-0005"]);
    const antes = await linhaDoPedido("R-OUTRA");

    // Nem a prévia o oferece, nem a gravação o muda.
    for (const simular of [true, false])
      expect(
        await recuperar({ ...enviado, pedidos: ["R-OUTRA"], simular }),
      ).toMatchObject({
        aplicado: false,
        recuperados: [],
        nao_recuperados: [{ pedido_id: "R-OUTRA", motivo: "ja_existe" }],
      });
    expect(await linhaDoPedido("R-OUTRA")).toEqual(antes);

    // O lote também confere a campanha: um plano com o pedido de outra campanha não muda nada.
    const campanha = await env.DB.prepare(
      "SELECT id FROM campanhas WHERE ativa = 1",
    ).first<{ id: number }>();
    const gravacao = await gravarRecuperacao(env.DB, {
      campanhaId: campanha!.id,
      usuarioId: admin.id,
      executadoEm: AGORA_CONFERENCIA.toISOString(),
      pedidosSolicitados: 1,
      linhasArquivo: 1,
      arquivoSha256: "0".repeat(64),
      colunas: enviado.colunas,
      pedidos: [
        {
          pedido_id: "R-OUTRA",
          tipo: "pagamento_nao_registrado",
          qtd_bilhetes: 1,
          total_centavos: 2000,
          afiliado: "reconhecido",
          affiliate_id: 101,
          celula: null,
          aprovado_em: PAGO_EM_R0005,
          origem_data: "arquivo",
        },
      ],
      precoBilheteCentavos: DADOS_CAMPANHA.preco_bilhete_centavos,
    });
    expect(gravacao).toEqual({ recuperacaoId: null, gravados: new Set() });
    expect(await linhaDoPedido("R-OUTRA")).toEqual(antes);
    expect(await contar("recuperacoes")).toBe(0);
  });

  it("idempotente: recuperar duas vezes é igual a uma (a segunda não grava, não cria recuperação nem trilha)", async () => {
    const conferido = await corpo();
    const enviado = { ...conferido, pedidos: ["R-0005"] };
    await recuperar(enviado);
    const depoisDaPrimeira = await linhaDoPedido("R-0005");
    const painel = await resumoDoPainel();

    const segunda = await recuperar(enviado);

    expect(segunda).toMatchObject({
      aplicado: false,
      recuperacao_id: null,
      recuperados: [],
      nao_recuperados: [{ pedido_id: "R-0005", motivo: "ja_existe" }],
    });
    expect(await linhaDoPedido("R-0005")).toEqual(depoisDaPrimeira);
    expect(await resumoDoPainel()).toEqual(painel);
    expect(await contar("recuperacoes")).toBe(1);
    expect(await contar("auditoria", "acao = 'conferencia.recuperar'")).toBe(1);
    // Na conferência de novo, ele deixa de ser "Pagamento não registrado" e confere.
    const analise = await analisar(conferido);
    expect(naoRegistrados(analise)).toEqual([]);
    expect(analise.resumo.conferem).toBe(2);
  });

  it('passa a contar nas contas e no ranking (o mesmo que o "Pedido pago" faria)', async () => {
    expect(await resumoDoPainel()).toEqual({
      pedidos_aprovados: 6,
      bilhetes: 14,
      total_centavos: 28000,
    });
    expect(await vendasDaCelula(1)).toEqual({
      pedidos_aprovados: 2,
      bilhetes: 5,
      total_centavos: 10000,
    });

    await recuperar({ ...(await corpo()), pedidos: ["R-0005"] });

    expect(await resumoDoPainel()).toEqual({
      pedidos_aprovados: 7,
      bilhetes: 16,
      total_centavos: 32000,
    });
    // O R-0005 é do afiliado 101 (Célula Ágape).
    expect(await vendasDaCelula(1)).toEqual({
      pedidos_aprovados: 3,
      bilhetes: 7,
      total_centavos: 14000,
    });
    // Na conferência, ele entra nos pagos do sistema.
    const analise = await analisar(await corpo());
    expect(analise.resumo.aprovados_no_sistema).toEqual({
      pedidos_aprovados: 8,
      bilhetes: 17,
      total_centavos: 34000,
    });
  });

  it('pedido fora do padrão (D11) que vira pago entra nos suspeitos, como no "Pedido pago" do webhook', async () => {
    await env.DB.prepare(
      `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos)
       SELECT 'R-0500', id, 101, 'in_process', 201, 402000 FROM campanhas WHERE ativa = 1`,
    ).run();
    const linhas: LinhaRifei[] = [
      {
        pedido: "R-0500",
        status: "Pago",
        quantidade: "201",
        bilhetes: "",
        valor: "R$ 4.020,00",
        afiliado: "101",
        data: "29/11/2026 10:00",
      },
    ];
    await recuperar({ ...(await corpo(linhas)), pedidos: ["R-0500"] });
    const suspeito = await env.DB.prepare(
      "SELECT qtd_bilhetes, total_centavos, motivos, marcado_em FROM pedidos_suspeitos WHERE pedido_id = 'R-0500'",
    ).first<{ motivos: string }>();
    expect(suspeito).toMatchObject({
      qtd_bilhetes: 201,
      total_centavos: 402000,
      marcado_em: AGORA_CONFERENCIA.toISOString(),
    });
    expect(
      (JSON.parse(suspeito!.motivos) as { codigo: string }[]).map(
        (motivo) => motivo.codigo,
      ),
    ).toEqual(["quantidade_acima_do_teto"]);
  });
});

describe('RIFA-056: a corrida com o webhook (o "Pedido pago" antes ou depois dá o mesmo, sem duplicar)', () => {
  it('o "Pedido pago" chega DEPOIS da correção: duplicado, e o pedido não muda', async () => {
    await recuperar({ ...(await corpo()), pedidos: ["R-0005"] });
    const corrigido = await linhaDoPedido("R-0005");

    expect(
      await pedidoPagoPeloWebhook("R-0005", "2026-11-26T10:05:00.000-03:00"),
    ).toBe("duplicado");

    // RIFA-076 (D36): o evento que não muda o pedido só completa o contato do comprador.
    expect(await linhaDoPedido("R-0005")).toEqual({
      ...corrigido,
      comprador_nome: "Comprador Ficticio Um",
      comprador_telefone: "+5591900000001",
    });
    expect(await resumoDoPainel()).toEqual({
      pedidos_aprovados: 7,
      bilhetes: 16,
      total_centavos: 32000,
    });
  });

  it('o "Pedido expirado" que chega depois da correção é ignorado (approved é terminal, D4): o pedido continua pago e contando', async () => {
    await recuperar({ ...(await corpo()), pedidos: ["R-0005"] });
    const corrigido = await linhaDoPedido("R-0005");
    expect(corrigido).toMatchObject({ status: "approved" });

    expect(await pedidoExpiradoPeloWebhook("R-0005")).toBe(
      "ignorado_transicao",
    );

    // RIFA-076 (D36): o evento que não muda o pedido só completa o contato do comprador.
    expect(await linhaDoPedido("R-0005")).toEqual({
      ...corrigido,
      comprador_nome: "Compradora Ficticia Dois",
      comprador_telefone: "+351910000002",
    });
    expect(await resumoDoPainel()).toEqual({
      pedidos_aprovados: 7,
      bilhetes: 16,
      total_centavos: 32000,
    });
  });

  it('o "Pedido pago" chega ANTES (depois da conferência): o Recuperar não muda nada (ja_existe) e as contas são as mesmas', async () => {
    const conferido = await corpo();
    const enviado = { ...conferido, pedidos: ["R-0005"] };
    // A conferência foi feita com o pedido pendente...
    expect(naoRegistrados(await analisar(conferido))).toHaveLength(1);
    // ... e o "Pedido pago" chegou antes da gravação.
    expect(
      await pedidoPagoPeloWebhook("R-0005", "2026-11-26T10:05:00.000-03:00"),
    ).toBe("processado");
    const pago = await linhaDoPedido("R-0005");

    const resultado = await recuperar(enviado);

    expect(resultado.nao_recuperados).toEqual([
      { pedido_id: "R-0005", motivo: "ja_existe" },
    ]);
    expect(await linhaDoPedido("R-0005")).toEqual(pago);
    expect(pago).toMatchObject({
      status: "approved",
      pagamento_recuperacao_id: null,
    });
    expect(await resumoDoPainel()).toEqual({
      pedidos_aprovados: 7,
      bilhetes: 16,
      total_centavos: 32000,
    });
    expect(await contar("recuperacoes")).toBe(0);
  });

  it('o "Pedido pago" entre a prévia e o lote, ou o pedido que mudou nesse meio tempo: o lote confere de novo e não muda nada', async () => {
    const campanha = await env.DB.prepare(
      "SELECT id FROM campanhas WHERE ativa = 1",
    ).first<{ id: number }>();
    const gravar = (pedido: PedidoRecuperado) =>
      gravarRecuperacao(env.DB, {
        campanhaId: campanha!.id,
        usuarioId: admin.id,
        executadoEm: AGORA_CONFERENCIA.toISOString(),
        pedidosSolicitados: 1,
        linhasArquivo: 1,
        arquivoSha256: "0".repeat(64),
        colunas: {
          pedido_id: "Pedido",
          status: null,
          qtd_bilhetes: null,
          bilhetes: null,
          valor: null,
          afiliado: null,
          data: null,
        },
        pedidos: [pedido],
        precoBilheteCentavos: DADOS_CAMPANHA.preco_bilhete_centavos,
      });
    const plano: PedidoRecuperado = {
      pedido_id: "R-0005",
      tipo: "pagamento_nao_registrado",
      qtd_bilhetes: 2,
      total_centavos: 4000,
      afiliado: "reconhecido",
      affiliate_id: 101,
      celula: null,
      aprovado_em: PAGO_EM_R0005,
      origem_data: "arquivo",
    };
    // O plano leu outra quantidade, outro valor ou outro afiliado (o pedido mudou depois): nada muda.
    const antes = await linhaDoPedido("R-0005");
    for (const diferente of [
      { qtd_bilhetes: 3 },
      { total_centavos: 6000 },
      { affiliate_id: 102 },
      { affiliate_id: null },
    ])
      expect(await gravar({ ...plano, ...diferente })).toEqual({
        recuperacaoId: null,
        gravados: new Set(),
      });
    expect(await linhaDoPedido("R-0005")).toEqual(antes);

    // O "Pedido pago" chegou entre a leitura do plano e o lote.
    await pedidoPagoPeloWebhook("R-0005", "2026-11-26T10:05:00.000-03:00");
    const pago = await linhaDoPedido("R-0005");
    expect(await gravar(plano)).toEqual({
      recuperacaoId: null,
      gravados: new Set(),
    });
    expect(await linhaDoPedido("R-0005")).toEqual(pago);
    expect(await contar("recuperacoes")).toBe(0);
    expect(await contar("auditoria")).toBe(0);
    expect(await contar("pedidos_suspeitos")).toBe(0);
  });
});

describe("RIFA-056: a trilha e o histórico das recuperações mostram o tipo", () => {
  it("só o pagamento registrado: a trilha diz o que foi marcado como pago; o histórico o lista em pagamentos_registrados", async () => {
    const resultado = await recuperar({
      ...(await corpo()),
      pedidos: ["R-0005"],
    });
    const campanha = await env.DB.prepare(
      "SELECT id FROM campanhas WHERE ativa = 1",
    ).first<{ id: number }>();

    expect(
      (
        await env.DB.prepare(
          "SELECT usuario_id, em, acao, alvo, resumo FROM auditoria",
        ).all()
      ).results,
    ).toEqual([
      {
        usuario_id: admin.id,
        em: AGORA_CONFERENCIA.toISOString(),
        acao: "conferencia.recuperar",
        alvo: `campanha:${campanha!.id}`,
        resumo: `Recuperação ${resultado.recuperacao_id} (conferência pelo CSV): 1 pedido pendente ou expirado (2 bilhetes) marcado como pago`,
      },
    ]);
    const lista = respostaListaRecuperacoesSchema.parse(
      (await obter(comoAdmin, RECUPERACOES)).corpo,
    );
    expect(lista.itens).toEqual([
      expect.objectContaining({
        id: resultado.recuperacao_id,
        usuario: { id: admin.id, nome: admin.nome },
        pedidos_solicitados: 1,
        pedidos_recuperados: 1,
        bilhetes: 2,
        total_centavos: 4000,
        pedidos: ["R-0005"],
        pagamentos_registrados: ["R-0005"],
      }),
    ]);
  });

  it("venda perdida e pagamento registrado juntos: uma recuperação, as contagens dos dois e a trilha com as duas partes", async () => {
    const enviado = await corpo(
      linhasCom({ "R-0009": { status: "Pago", data: "27/11/2026 09:00" } }),
    );
    const resultado = await recuperar({
      ...enviado,
      pedidos: ["R-0101", "R-0005", "R-0009", "R-0102"],
    });

    expect(
      resultado.recuperados.map((pedido) => [pedido.pedido_id, pedido.tipo]),
    ).toEqual([
      ["R-0101", "venda_perdida"],
      ["R-0005", "pagamento_nao_registrado"],
      ["R-0009", "pagamento_nao_registrado"],
      ["R-0102", "venda_perdida"],
    ]);
    expect(resultado.totais).toEqual({
      pedidos_aprovados: 4,
      bilhetes: 8,
      total_centavos: 16000,
    });
    expect(
      (await env.DB.prepare("SELECT resumo FROM auditoria").all()).results,
    ).toEqual([
      {
        resumo: `Recuperação ${resultado.recuperacao_id} (conferência pelo CSV): 2 pedidos e 5 bilhetes gravados como vendas aprovadas; 2 pedidos pendentes ou expirados (3 bilhetes) marcados como pagos`,
      },
    ]);
    expect(
      await env.DB.prepare(
        "SELECT pedidos_solicitados, pedidos_recuperados, bilhetes, total_centavos FROM recuperacoes",
      ).first(),
    ).toEqual({
      pedidos_solicitados: 4,
      pedidos_recuperados: 4,
      bilhetes: 8,
      total_centavos: 16000,
    });
    const [item] = respostaListaRecuperacoesSchema.parse(
      (await obter(comoAdmin, RECUPERACOES)).corpo,
    ).itens;
    expect(item).toMatchObject({
      pedidos: ["R-0005", "R-0009", "R-0101", "R-0102"],
      pagamentos_registrados: ["R-0005", "R-0009"],
    });
    // A venda perdida continua "recuperada na conferência"; o pagamento registrado continua do webhook.
    expect(
      (
        await env.DB.prepare(
          `SELECT id, origem, recuperacao_id IS NOT NULL AS venda, pagamento_recuperacao_id IS NOT NULL AS pagamento
           FROM pedidos WHERE id IN ('R-0005', 'R-0009', 'R-0101', 'R-0102') ORDER BY id`,
        ).all()
      ).results,
    ).toEqual([
      { id: "R-0005", origem: "webhook", venda: 0, pagamento: 1 },
      { id: "R-0009", origem: "webhook", venda: 0, pagamento: 1 },
      { id: "R-0101", origem: "conferencia", venda: 1, pagamento: 0 },
      { id: "R-0102", origem: "conferencia", venda: 1, pagamento: 0 },
    ]);
  });
});

describe("RIFA-056: só o admin", () => {
  it("a coordenação recupera a venda perdida como antes, mas o pendente fica como está (ja_existe), sem recuperação nem trilha", async () => {
    const enviado = { ...(await corpo()), pedidos: ["R-0005"] };
    const antes = await linhaDoPedido("R-0005");

    for (const simular of [true, false]) {
      const resultado = await recuperar(
        { ...enviado, simular },
        comoCoordenacao,
      );
      expect(resultado).toMatchObject({
        aplicado: false,
        recuperados: [],
        nao_recuperados: [{ pedido_id: "R-0005", motivo: "ja_existe" }],
      });
    }
    expect(await linhaDoPedido("R-0005")).toEqual(antes);
    expect(await contar("recuperacoes")).toBe(0);
    expect(await contar("auditoria")).toBe(0);

    const venda = await recuperar(
      { ...enviado, pedidos: ["R-0101", "R-0005"] },
      comoCoordenacao,
    );
    expect(
      venda.recuperados.map((pedido) => [pedido.pedido_id, pedido.tipo]),
    ).toEqual([["R-0101", "venda_perdida"]]);
    expect(venda.nao_recuperados).toEqual([
      { pedido_id: "R-0005", motivo: "ja_existe" },
    ]);
    expect(await linhaDoPedido("R-0005")).toEqual(antes);
  });

  it("pelo Worker de verdade (o login do index.ts põe o papel da sessão): a coordenação não marca; o admin marca", async () => {
    // Sem a coluna da data: o Worker de verdade usa o relógio do sistema, e as datas do cenário podem estar no futuro.
    const { arquivo } = await corpoDe(csvDoCenario());
    const { corpo: semData } = await corpoDe(csvDoCenario(), {
      ...arquivo.mapeamentoDetectado,
      data: null,
    });
    const enviado = { ...semData, pedidos: ["R-0005"] };
    const recuperarComo = async (papel: "admin" | "coordenacao") => {
      const res = await exports.default.fetch(`${ORIGEM}${RECUPERAR}`, {
        method: "POST",
        headers: {
          ...(await cabecalhosDeSessao(papel)),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(enviado),
      });
      expect(res.status).toBe(200);
      return respostaRecuperarReconciliacaoSchema.parse(await res.json());
    };
    const antes = await linhaDoPedido("R-0005");

    expect(await recuperarComo("coordenacao")).toMatchObject({
      aplicado: false,
      recuperados: [],
      nao_recuperados: [{ pedido_id: "R-0005", motivo: "ja_existe" }],
    });
    expect(await linhaDoPedido("R-0005")).toEqual(antes);
    expect(await contar("recuperacoes")).toBe(0);

    const doAdmin = await recuperarComo("admin");
    expect(doAdmin).toMatchObject({
      aplicado: true,
      recuperados: [
        {
          pedido_id: "R-0005",
          tipo: "pagamento_nao_registrado",
          origem_data: "recuperacao",
        },
      ],
    });
    expect(await linhaDoPedido("R-0005")).toMatchObject({
      status: "approved",
      origem: "webhook",
      pagamento_recuperacao_id: doAdmin.recuperacao_id,
    });
  });
});
