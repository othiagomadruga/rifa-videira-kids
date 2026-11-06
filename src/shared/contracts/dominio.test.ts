import { describe, expect, it } from "vitest";
import expiredOrder from "../../../test/fixtures/rifei/expired_order.json";
import newOrderAfiliado from "../../../test/fixtures/rifei/new_order.afiliado.json";
import paidOrderAfiliado from "../../../test/fixtures/rifei/paid_order.afiliado.json";
import paidOrderAposExpirado from "../../../test/fixtures/rifei/paid_order.apos_expirado.json";
import paidOrderOficial from "../../../test/fixtures/rifei/paid_order.oficial.json";
import {
  afiliadoSchema,
  campanhaEntradaSchema,
  campanhaSchema,
  celulaEntradaSchema,
  decidirTransicaoPedido,
  discipuladorEntradaSchema,
  eventoWebhookSchema,
  pedidoSchema,
  redeEntradaSchema,
  RESULTADOS_EVENTO_WEBHOOK,
  STATUS_PEDIDO,
  type StatusPedido,
} from "./dominio";
import { payloadRifeiSchema, redigirPayloadRifei } from "./rifei";

const AGORA = "2026-11-06T18:00:00.000Z";

const campanhaDaAta = {
  nome: "Rifa Videira Kids",
  slug_rifei: "videira-kids-teste",
  data_inicio: "2026-11-23",
  preco_bilhete_centavos: 2000,
  meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
  periodos: [
    { nome: "Semana 1", dias: 10, percentual_bp: 3500 },
    { nome: "Semana 2", dias: 7, percentual_bp: 2500 },
    { nome: "Semana 3", dias: 7, percentual_bp: 4500 },
  ],
  ranking: { criterio: "percentual_meta" },
};

describe("CA2: campanha (configuração)", () => {
  it("aceita 3 períodos de 10/7/7 dias com 35%/25%/45% (soma 105%) e aplica os padrões", () => {
    const campanha = campanhaEntradaSchema.parse(campanhaDaAta);
    expect(campanha.fuso_horario).toBe("America/Belem");
    expect(campanha.publico).toEqual({
      mostra_percentual_meta: false,
      limite_ranking: 3,
    });
    expect(campanha.periodos.map((periodo) => periodo.percentual_bp)).toEqual([
      3500, 2500, 4500,
    ]);
  });

  it.each([
    [
      "percentual acima de 100%",
      { periodos: [{ nome: "Única", dias: 7, percentual_bp: 10_001 }] },
    ],
    [
      "percentual com casas decimais",
      { periodos: [{ nome: "Única", dias: 7, percentual_bp: 35.5 }] },
    ],
    [
      "todos os percentuais zerados",
      { periodos: [{ nome: "Única", dias: 7, percentual_bp: 0 }] },
    ],
    ["nenhum período", { periodos: [] }],
    [
      "período sem dias",
      { periodos: [{ nome: "Única", dias: 0, percentual_bp: 10_000 }] },
    ],
    ["data impossível", { data_inicio: "2026-02-30" }],
    ["fuso inválido", { fuso_horario: "Belem" }],
    ["preço em reais", { preco_bilhete_centavos: 20.5 }],
    [
      "regra de meta desconhecida",
      { meta: { unidade: "bilhetes", regra: "por_celula", valor: 10 } },
    ],
    ["critério de ranking desconhecido", { ranking: { criterio: "pedidos" } }],
  ])("rejeita %s", (_caso, alteracao) => {
    expect(
      campanhaEntradaSchema.safeParse({ ...campanhaDaAta, ...alteracao })
        .success,
    ).toBe(false);
  });

  it("a resposta traz as datas de cada período, o fim da campanha e a soma dos percentuais", () => {
    const resposta = {
      ...campanhaDaAta,
      id: 1,
      fuso_horario: "America/Belem",
      data_fim: "2026-12-16",
      periodos: [
        {
          ordem: 1,
          nome: "Semana 1",
          dias: 10,
          percentual_bp: 3500,
          data_inicio: "2026-11-23",
          data_fim: "2026-12-02",
        },
        {
          ordem: 2,
          nome: "Semana 2",
          dias: 7,
          percentual_bp: 2500,
          data_inicio: "2026-12-03",
          data_fim: "2026-12-09",
        },
        {
          ordem: 3,
          nome: "Semana 3",
          dias: 7,
          percentual_bp: 4500,
          data_inicio: "2026-12-10",
          data_fim: "2026-12-16",
        },
      ],
      soma_percentuais_bp: 10_500,
      publico: { mostra_percentual_meta: false, limite_ranking: 3 },
      criado_em: AGORA,
      atualizado_em: AGORA,
    };
    expect(campanhaSchema.safeParse(resposta).success).toBe(true);
    expect(
      campanhaSchema.safeParse({
        ...resposta,
        atualizado_em: "2026-11-06T15:00:00.000-03:00",
      }).success,
    ).toBe(false);
  });
});

describe("CA2: hierarquia e afiliado", () => {
  it("rede: divisão é jovens ou adultos", () => {
    expect(
      redeEntradaSchema.parse({ nome: " Rede Jovem ", divisao: "jovens" }),
    ).toEqual({
      nome: "Rede Jovem",
      divisao: "jovens",
      responsavel_nome: null,
    });
    expect(
      redeEntradaSchema.safeParse({ nome: "Rede Kids", divisao: "kids" })
        .success,
    ).toBe(false);
  });

  it("discipulador pertence a uma rede", () => {
    expect(
      discipuladorEntradaSchema.safeParse({
        rede_id: 1,
        nome: "Discipulador Ficticio",
      }).success,
    ).toBe(true);
    expect(
      discipuladorEntradaSchema.safeParse({ nome: "Discipulador Ficticio" })
        .success,
    ).toBe(false);
  });

  it("célula: qtd_pessoas inteiro positivo, líder obrigatório, contato opcional", () => {
    const celula = {
      discipulador_id: 1,
      nome: "Célula Ficticia 01",
      qtd_pessoas: 12,
      lider_nome: "Lider Ficticio",
    };
    expect(celulaEntradaSchema.parse(celula)).toEqual({
      ...celula,
      lider_email: null,
      lider_telefone: null,
    });
    expect(
      celulaEntradaSchema.safeParse({
        ...celula,
        lider_email: "lider@example.com",
      }).success,
    ).toBe(true);
    expect(
      celulaEntradaSchema.safeParse({ ...celula, qtd_pessoas: 0 }).success,
    ).toBe(false);
    expect(
      celulaEntradaSchema.safeParse({ ...celula, qtd_pessoas: 7.5 }).success,
    ).toBe(false);
    expect(
      celulaEntradaSchema.safeParse({ ...celula, lider_email: "sem-arroba" })
        .success,
    ).toBe(false);
    expect(
      celulaEntradaSchema.safeParse({ ...celula, lider_nome: "  " }).success,
    ).toBe(false);
  });

  it("afiliado: affiliate_id da Rifei e celula_id nulo quando não vinculado", () => {
    const orfao = {
      affiliate_id: 1043,
      celula_id: null,
      rotulo: null,
      origem: "webhook",
      criado_em: AGORA,
      vinculado_em: null,
      atualizado_em: AGORA,
    };
    expect(afiliadoSchema.safeParse(orfao).success).toBe(true);
    expect(
      afiliadoSchema.safeParse({
        ...orfao,
        celula_id: 7,
        vinculado_em: AGORA,
        origem: "manual",
      }).success,
    ).toBe(true);
    expect(afiliadoSchema.safeParse({ ...orfao, origem: "csv" }).success).toBe(
      false,
    );
    expect(
      afiliadoSchema.safeParse({ ...orfao, affiliate_id: 0 }).success,
    ).toBe(false);
  });
});

describe("CA2: pedido e evento de webhook", () => {
  const pedido = {
    id: "PEDTESTE0001",
    campanha_id: 1,
    affiliate_id: 1042,
    status: "approved",
    status_rifei: "approved",
    status_detail_rifei: "accredited",
    qtd_bilhetes: 3,
    numeros: [101, 202, 303],
    subtotal_centavos: 6000,
    total_centavos: 6000,
    desconto_promocao_centavos: null,
    desconto_cupom_centavos: null,
    cupom_id: null,
    metodo_pagamento: "pix",
    rifinha: false,
    ddd: "91",
    pais: "55",
    utm: {
      source: "whatsapp",
      campaign: "videira-kids",
      medium: "afiliado",
      content: null,
      term: null,
    },
    criado_em: "2026-12-01T12:15:00.000Z",
    expira_em: "2026-12-01T12:45:00.000Z",
    aprovado_em: "2026-12-01T12:20:31.512Z",
    expirado_em: null,
    registrado_em: AGORA,
    atualizado_em: AGORA,
  };

  it("pedido: status in_process|approved|expired, valores em centavos inteiros, ddd e país", () => {
    expect(pedidoSchema.safeParse(pedido).success).toBe(true);
    expect(STATUS_PEDIDO).toEqual(["in_process", "approved", "expired"]);
    expect(pedidoSchema.safeParse({ ...pedido, status: "paid" }).success).toBe(
      false,
    );
    expect(
      pedidoSchema.safeParse({ ...pedido, total_centavos: 60.5 }).success,
    ).toBe(false);
    expect(pedidoSchema.safeParse({ ...pedido, ddd: "091" }).success).toBe(
      false,
    );
    expect(pedidoSchema.safeParse({ ...pedido, pais: "+55" }).success).toBe(
      false,
    );
  });

  it("pedido: campos informativos podem ser null (payload tolerado); essenciais não", () => {
    const informativosNulos = {
      ...pedido,
      status_rifei: null,
      status_detail_rifei: null,
      subtotal_centavos: null,
      metodo_pagamento: null,
      rifinha: null,
      expira_em: null,
    };
    expect(pedidoSchema.safeParse(informativosNulos).success).toBe(true);
    for (const essencial of ["total_centavos", "qtd_bilhetes", "criado_em"]) {
      expect(
        pedidoSchema.safeParse({ ...pedido, [essencial]: null }).success,
      ).toBe(false);
    }
  });

  it("pedido: nenhum campo de dado pessoal do comprador", () => {
    const proibidos =
      /nome|name|email|document|cpf|nascimento|birth|endereco|address|telefone|phone|observation|fbp|fbc/;
    expect(
      Object.keys(pedidoSchema.shape).filter((campo) => proibidos.test(campo)),
    ).toEqual([]);
  });

  it("evento de webhook: cinco resultados possíveis e payload sempre redigido", () => {
    expect(RESULTADOS_EVENTO_WEBHOOK).toEqual([
      "processado",
      "duplicado",
      "ignorado_outra_campanha",
      "ignorado_transicao",
      "erro_validacao",
    ]);
    const processado = {
      id: 1,
      recebido_em: AGORA,
      evento: "paid_order",
      pedido_id: "PEDTESTE0001",
      slug: "videira-kids-teste",
      resultado: "processado",
      status_anterior: "in_process",
      status_resultante: "approved",
      payload_redigido: redigirPayloadRifei(
        payloadRifeiSchema.parse(paidOrderAfiliado),
      ),
      erro: null,
      avisos: null,
    };
    expect(eventoWebhookSchema.safeParse(processado).success).toBe(true);
    expect(
      eventoWebhookSchema.safeParse({
        ...processado,
        payload_redigido: paidOrderAfiliado,
      }).success,
    ).toBe(false);
    const invalido = {
      ...processado,
      evento: "order_refunded",
      pedido_id: null,
      resultado: "erro_validacao",
      status_anterior: null,
      status_resultante: null,
      payload_redigido: null,
      erro: [
        { caminho: ["id"], codigo: "invalid_type", mensagem: "Invalid input" },
      ],
    };
    expect(eventoWebhookSchema.safeParse(invalido).success).toBe(true);
    const comAvisos = {
      ...processado,
      avisos: [
        {
          caminho: ["status"],
          codigo: "invalid_type",
          mensagem: "Invalid input",
        },
      ],
    };
    expect(eventoWebhookSchema.safeParse(comAvisos).success).toBe(true);
    expect(
      eventoWebhookSchema.safeParse({ ...processado, avisos: "texto" }).success,
    ).toBe(false);
  });
});

describe("D4: máquina de estados do pedido", () => {
  it.each([
    [null, "new_order", "processado", "in_process"],
    [null, "paid_order", "processado", "approved"],
    [null, "expired_order", "processado", "expired"],
    ["in_process", "new_order", "duplicado", "in_process"],
    ["in_process", "paid_order", "processado", "approved"],
    ["in_process", "expired_order", "processado", "expired"],
    ["expired", "new_order", "ignorado_transicao", "expired"],
    ["expired", "paid_order", "processado", "approved"],
    ["expired", "expired_order", "duplicado", "expired"],
    ["approved", "new_order", "ignorado_transicao", "approved"],
    ["approved", "paid_order", "duplicado", "approved"],
    ["approved", "expired_order", "ignorado_transicao", "approved"],
  ] as const)(
    "%s + %s → %s (%s)",
    (atual, evento, resultado, statusResultante) => {
      expect(decidirTransicaoPedido(atual, evento)).toEqual({
        resultado,
        status_resultante: statusResultante,
      });
    },
  );

  function aplicar(sequencia: readonly unknown[]): string[] {
    let status: StatusPedido | null = null;
    return sequencia.map((fixture) => {
      const { event } = payloadRifeiSchema.parse(fixture);
      const decisao = decidirTransicaoPedido(status, event);
      status = decisao.status_resultante;
      return `${event}:${decisao.resultado}:${status}`;
    });
  }

  it("fixtures: novo → pago → reentrega do pago → novo atrasado", () => {
    expect(
      aplicar([
        newOrderAfiliado,
        paidOrderAfiliado,
        paidOrderAfiliado,
        newOrderAfiliado,
      ]),
    ).toEqual([
      "new_order:processado:in_process",
      "paid_order:processado:approved",
      "paid_order:duplicado:approved",
      "new_order:ignorado_transicao:approved",
    ]);
  });

  it("fixtures: expirado → pago depois de expirar → expired tardio é ignorado", () => {
    expect(
      aplicar([expiredOrder, paidOrderAposExpirado, expiredOrder]),
    ).toEqual([
      "expired_order:processado:expired",
      "paid_order:processado:approved",
      "expired_order:ignorado_transicao:approved",
    ]);
  });

  it("fixtures: pago chega antes do novo (fora de ordem) e cria o pedido já aprovado", () => {
    expect(aplicar([paidOrderOficial])).toEqual([
      "paid_order:processado:approved",
    ]);
    expect(aplicar([paidOrderAfiliado, newOrderAfiliado])).toEqual([
      "paid_order:processado:approved",
      "new_order:ignorado_transicao:approved",
    ]);
  });
});
