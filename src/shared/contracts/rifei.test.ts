import { describe, expect, expectTypeOf, it } from "vitest";
import expiredOrder from "../../../test/fixtures/rifei/expired_order.json";
import malformado from "../../../test/fixtures/rifei/malformado.json";
import newOrderAfiliado from "../../../test/fixtures/rifei/new_order.afiliado.json";
import newOrderMinimo from "../../../test/fixtures/rifei/new_order.minimo.json";
import paidOrderAfiliado from "../../../test/fixtures/rifei/paid_order.afiliado.json";
import paidOrderAposExpirado from "../../../test/fixtures/rifei/paid_order.apos_expirado.json";
import paidOrderOficial from "../../../test/fixtures/rifei/paid_order.oficial.json";
import paidOrderOutraCampanha from "../../../test/fixtures/rifei/paid_order.outra_campanha.json";
import paidOrderTiposEstranhos from "../../../test/fixtures/rifei/paid_order.tipos_estranhos.json";
import { LIMITE_DETALHES, resumirDetalhes } from "./erros";
import {
  CAMPOS_DESCARTADOS_NA_REDACAO,
  analisarPayloadRifei,
  avisosParaGravar,
  derivarTelefone,
  identificarPayloadInvalido,
  payloadRifeiDocSchema,
  payloadRifeiRedigidoSchema,
  payloadRifeiSchema,
  reaisParaCentavos,
  redigirPayloadRifei,
  textoDecimalParaCentavos,
  type AnalisePayloadRifei,
  type PayloadRifeiRedigido,
} from "./rifei";

/** Fixtures que seguem a documentação: aceitas e sem avisos. */
const FIXTURES_DA_DOC: ReadonlyArray<readonly [string, unknown]> = [
  ["paid_order.oficial", paidOrderOficial],
  ["new_order.afiliado", newOrderAfiliado],
  ["paid_order.afiliado", paidOrderAfiliado],
  ["expired_order", expiredOrder],
  ["paid_order.apos_expirado", paidOrderAposExpirado],
  ["paid_order.outra_campanha", paidOrderOutraCampanha],
  ["new_order.minimo", newOrderMinimo],
];

/** Todas as fixtures aceitas, inclusive a que tem tipos estranhos nos campos informativos. */
const FIXTURES_ACEITAS: ReadonlyArray<readonly [string, unknown]> = [
  ...FIXTURES_DA_DOC,
  ["paid_order.tipos_estranhos", paidOrderTiposEstranhos],
];

function aceita(corpo: unknown) {
  const analise = analisarPayloadRifei(corpo);
  if (!analise.aceito) {
    throw new Error(`deveria aceitar: ${JSON.stringify(analise.problemas)}`);
  }
  return analise;
}

function recusa(corpo: unknown) {
  const analise = analisarPayloadRifei(corpo);
  if (analise.aceito) throw new Error("deveria recusar");
  return analise;
}

/** Primeiro trecho do caminho de cada aviso ou problema ("buyer", "total"...). */
const campos = (lista: { caminho: (string | number)[] }[]) =>
  lista.map((item) => String(item.caminho[0]));

/** Textos pessoais do corpo bruto (buyer, observation, fbp, fbc), com 5+ caracteres, de qualquer tipo. */
function textosPessoais(corpo: unknown): string[] {
  const textos: string[] = [];
  const coletar = (valor: unknown): void => {
    if (typeof valor === "string" || typeof valor === "number") {
      const texto = String(valor);
      if (texto.length >= 5) textos.push(texto, texto.replace("+", ""));
    } else if (Array.isArray(valor)) {
      valor.forEach(coletar);
    } else if (typeof valor === "object" && valor !== null) {
      Object.values(valor).forEach(coletar);
    }
  };
  const objeto = corpo as Record<string, unknown>;
  for (const campo of ["buyer", "observation", "fbp", "fbc"]) {
    coletar(objeto[campo]);
  }
  return textos;
}

describe("CA1: payload do webhook da Rifei (doc oficial e tolerância)", () => {
  it.each(FIXTURES_DA_DOC)("aceita %s sem nenhum aviso", (_nome, fixture) => {
    expect(aceita(fixture).avisos).toEqual([]);
    expect(payloadRifeiDocSchema.safeParse(fixture).success).toBe(true);
  });

  it("exemplo oficial: os campos ausentes (expired_at, fbp, fbc) viram null", () => {
    for (const campo of ["expired_at", "fbp", "fbc"]) {
      expect(paidOrderOficial).not.toHaveProperty(campo);
    }
    expect(aceita(paidOrderOficial).payload).toMatchObject({
      event: "paid_order",
      id: "XXXXXXXXXXX",
      slug: "demonstracao",
      status: "approved",
      subtotal: 2.5,
      total: 1.25,
      affiliate_id: null,
      expired_at: null,
      fbp: null,
      fbc: null,
    });
  });

  it("todo campo que a doc marca como null aceita null e também a ausência, sem aviso", () => {
    expect(aceita(newOrderMinimo).payload).toMatchObject({
      buyer: {
        email: null,
        document: null,
        date_of_birth: null,
        address: null,
      },
      numbers: null,
      lucky_numbers: null,
      promotion_discount: null,
      coupon_discount: null,
      coupon_id: null,
      affiliate_id: null,
      approved_at: null,
      expired_at: null,
      observation: null,
      fbp: null,
      fbc: null,
      utm: {
        source: null,
        campaign: null,
        medium: null,
        content: null,
        term: null,
      },
    });
    const tudoNulo = {
      ...paidOrderOficial,
      buyer: {
        ...paidOrderOficial.buyer,
        email: null,
        document: null,
        date_of_birth: null,
        address: null,
      },
      numbers: null,
      lucky_numbers: null,
      promotion_discount: null,
      coupon_discount: null,
      coupon_id: null,
      affiliate_id: null,
      approved_at: null,
      expired_at: null,
      observation: null,
      fbp: null,
      fbc: null,
      utm: {
        source: null,
        campaign: null,
        medium: null,
        content: null,
        term: null,
      },
    };
    expect(aceita(tudoNulo).avisos).toEqual([]);
  });

  it("tolera campos desconhecidos e os descarta", () => {
    const { payload, avisos } = aceita({
      ...paidOrderOficial,
      campo_novo_da_rifei: { qualquer: "coisa" },
      buyer: { ...paidOrderOficial.buyer, instagram: "@ficticio" },
    });
    expect(payload).not.toHaveProperty("campo_novo_da_rifei");
    expect(payload.buyer).not.toHaveProperty("instagram");
    expect(avisos).toEqual([]);
  });

  it.each([
    ["id", undefined],
    ["id", null],
    ["id", ""],
    ["id", 1.5],
    ["id", true],
    ["id", { numero: 1 }],
    ["id", "x".repeat(129)],
    ["event", "refunded_order"],
    ["event", undefined],
    ["slug", null],
    ["slug", ""],
    ["slug", "   "],
    ["numbers_count", null],
    ["numbers_count", 1_000_001],
    ["numbers_count", 2.5],
    ["numbers_count", "12.5"],
    ["numbers_count", -1],
    ["total", undefined],
    ["total", "1,25"],
    ["total", "abc"],
    ["total", -1],
    ["total", 10_000_000.01],
    ["total", 1e20],
    ["total", "100000000"],
  ])("recusa (400) quando o essencial falha: %s = %j", (campo, valor) => {
    const { problemas } = recusa({ ...paidOrderOficial, [campo]: valor });
    expect(campos(problemas)).toContain(campo);
  });

  it.each([
    ["id", 12345, "12345"],
    ["slug", " videira-kids-teste ", "videira-kids-teste"],
    ["numbers_count", "12", 12],
    ["numbers_count", "12.0", 12],
    ["total", "1.005", 1.01],
    ["total", "19.90", 19.9],
    ["total", " 20 ", 20],
    ["affiliate_id", "1042", 1042],
  ])(
    "converte número em texto (%s = %j) com aviso",
    (campo, valor, esperado) => {
      const { payload, avisos } = aceita({
        ...paidOrderOficial,
        [campo]: valor,
      });
      expect(payload[campo as keyof typeof payload]).toBe(esperado);
      expect(campos(avisos)).toContain(campo);
    },
  );

  it.each([
    ["is_rifinha", "false"],
    ["status", 42],
    ["status", ""],
    ["status_detail", null],
    ["payment_method", 7],
    ["subtotal", -1],
    ["subtotal", "2,50"],
    ["promotion_discount", "x"],
    ["coupon_id", "abc"],
    ["affiliate_id", "abc"],
    ["affiliate_id", 0],
    ["affiliate_id", -3],
    ["affiliate_id", 10.5],
    ["created_at", "23/08/2024 11:28"],
    ["approved_at", "2024-08-23 12:09:29"],
    ["expires_at", 1724426864],
    ["expired_at", ""],
    ["upsells", null],
    ["upsells", "nenhum"],
    ["numbers", ["1"]],
    ["lucky_numbers", "nenhum"],
    ["observation", 42],
    ["fbp", {}],
    ["fbc", []],
    ["subtotal", 1e20],
    ["status", "x".repeat(101)],
    ["upsells", Array.from({ length: 51 }, () => "Upsell")],
    ["numbers", Array.from({ length: 10_001 }, (_, i) => i)],
  ])("tolera %s = %j: vira null e gera aviso", (campo, valor) => {
    const { payload, avisos } = aceita({ ...paidOrderOficial, [campo]: valor });
    expect(payload[campo as keyof typeof payload]).toBeNull();
    expect(campos(avisos)).toContain(campo);
  });

  it("tolera buyer e utm de qualquer tipo (o buyer é descartado na redação)", () => {
    const vazio = {
      name: null,
      phone: null,
      email: null,
      document: null,
      date_of_birth: null,
      address: null,
    };
    const semBuyer = aceita({ ...paidOrderOficial, buyer: "Fulano" });
    expect(semBuyer.payload.buyer).toEqual(vazio);
    expect(campos(semBuyer.avisos)).toEqual(["buyer"]);

    const buyerEstranho = aceita({
      ...paidOrderOficial,
      buyer: {
        ...paidOrderOficial.buyer,
        name: 123,
        address: "Rua de exemplo, 1000",
      },
    });
    expect(buyerEstranho.payload.buyer).toMatchObject({
      name: null,
      address: null,
      phone: "+5599999999999",
    });
    expect(
      buyerEstranho.avisos.map((aviso) => aviso.caminho.join(".")),
    ).toEqual(expect.arrayContaining(["buyer.name", "buyer.address"]));

    const utmEstranho = aceita({ ...paidOrderOficial, utm: "facebook" });
    expect(utmEstranho.payload.utm).toEqual({
      source: null,
      campaign: null,
      medium: null,
      content: null,
      term: null,
    });
    expect(campos(utmEstranho.avisos)).toEqual(["utm"]);
  });

  it("fixture com tipos estranhos nos campos informativos é ACEITA e gera avisos sem dado pessoal", () => {
    const { payload, avisos } = aceita(paidOrderTiposEstranhos);
    expect(payload).toMatchObject({
      event: "paid_order",
      id: "PEDTESTE0004",
      slug: "videira-kids-teste",
      numbers_count: 2,
      total: 40,
      affiliate_id: 1042,
      is_rifinha: null,
      subtotal: null,
      numbers: null,
      status: null,
      created_at: null,
      expires_at: null,
      approved_at: "2026-12-01T12:20:31Z",
      utm: {
        source: null,
        campaign: null,
        medium: null,
        content: null,
        term: null,
      },
    });
    expect(Object.values(payload.buyer).every((valor) => valor === null)).toBe(
      true,
    );
    expect(new Set(campos(avisos))).toEqual(
      new Set([
        "is_rifinha",
        "buyer",
        "numbers",
        "numbers_count",
        "lucky_numbers",
        "subtotal",
        "total",
        "promotion_discount",
        "coupon_discount",
        "payment_method",
        "status",
        "status_detail",
        "coupon_id",
        "affiliate_id",
        "created_at",
        "expires_at",
        "expired_at",
        "upsells",
        "observation",
        "fbp",
        "fbc",
        "utm",
      ]),
    );
    const json = JSON.stringify(avisos);
    for (const texto of textosPessoais(paidOrderTiposEstranhos)) {
      expect(json).not.toContain(texto);
    }
  });

  it("recusa a fixture malformada apontando exatamente os campos com erro, sem dado pessoal", () => {
    const { problemas } = recusa(malformado);
    expect(campos(problemas).sort()).toEqual([
      "event",
      "id",
      "numbers_count",
      "slug",
      "total",
    ]);
    // Problemas também vêm agrupados e limitados (formato DetalheResumido).
    expect(problemas.every((problema) => problema.ocorrencias === 1)).toBe(
      true,
    );
    const json = JSON.stringify(problemas);
    for (const texto of textosPessoais(malformado)) {
      expect(json).not.toContain(texto);
    }
  });

  it("recusa corpos que nem são objeto", () => {
    for (const corpo of [null, "texto", 42, [paidOrderOficial]]) {
      expect(analisarPayloadRifei(corpo).aceito).toBe(false);
    }
  });

  it("de um corpo recusado só aproveita os textos de event, id e slug", () => {
    expect(identificarPayloadInvalido(malformado)).toEqual({
      evento: "order_refunded",
      pedido_id: null,
      slug: null,
    });
    expect(
      identificarPayloadInvalido({
        id: "PED1",
        slug: "videira-kids-teste",
        event: 7,
      }),
    ).toEqual({
      evento: null,
      pedido_id: "PED1",
      slug: "videira-kids-teste",
    });
    expect(identificarPayloadInvalido("não é objeto")).toEqual({
      evento: null,
      pedido_id: null,
      slug: null,
    });
    expect(identificarPayloadInvalido({ id: "x".repeat(500) }).pedido_id).toBe(
      "x".repeat(128),
    );
    expect(identificarPayloadInvalido({ id: 12345 }).pedido_id).toBe("12345");
  });

  it("limites com mensagem clara: total acima de R$ 10 mi e mais de 1 milhão de bilhetes", () => {
    const valor = recusa({ ...paidOrderOficial, total: 1e20 });
    expect(JSON.stringify(valor.problemas)).toContain("R$ 10.000.000,00");
    const bilhetes = recusa({ ...paidOrderOficial, numbers_count: 1_000_001 });
    expect(JSON.stringify(bilhetes.problemas)).toContain("1.000.000");
    expect(
      aceita({ ...paidOrderOficial, total: 10_000_000 }).payload.total,
    ).toBe(10_000_000);
  });

  const tamanhoEmBytes = (valor: unknown) =>
    new TextEncoder().encode(JSON.stringify(valor)).length;

  it("20.000 bilhetes inválidos: aceito, numbers vira null e os avisos ficam pequenos (< 10 KB)", () => {
    const numeros = Array.from({ length: 20_000 }, (_, i) => String(i));
    const { payload, avisos } = aceita({
      ...paidOrderOficial,
      numbers: numeros,
      lucky_numbers: numeros,
      numbers_count: 20_000,
    });
    expect(payload.numbers).toBeNull();
    expect(payload.lucky_numbers).toBeNull();
    expect(payload.numbers_count).toBe(20_000);
    // Acima de LIMITE_NUMEROS_GUARDADOS o zod nem olha os elementos: um aviso too_big por campo.
    expect(
      avisos
        .map((aviso) => `${aviso.caminho.join(".")}:${aviso.codigo}`)
        .sort(),
    ).toEqual(["lucky_numbers:too_big", "numbers:too_big"]);
    expect(tamanhoEmBytes(avisos)).toBeLessThan(10_000);
  });

  it("10.000 bilhetes inválidos (no limite): UM aviso agrupado em numbers[*] com 10.000 ocorrências", () => {
    const numeros = Array.from({ length: 10_000 }, (_, i) => String(i));
    const { payload, avisos } = aceita({
      ...paidOrderOficial,
      numbers: numeros,
    });
    expect(payload.numbers).toBeNull();
    expect(avisos).toEqual([
      {
        caminho: ["numbers", "*"],
        codigo: "invalid_type",
        mensagem: expect.any(String),
        ocorrencias: 10_000,
      },
    ]);
    expect(tamanhoEmBytes(avisos)).toBeLessThan(10_000);
  });

  it("agrupa os avisos por caminho sem índice e limita a lista com um aviso final", () => {
    const problema = (caminho: (string | number)[]) => ({
      caminho,
      codigo: "invalid_type",
      mensagem: "Invalid input",
    });
    expect(
      resumirDetalhes([problema(["numbers", 0]), problema(["numbers", 1])]),
    ).toEqual([
      {
        caminho: ["numbers", "*"],
        codigo: "invalid_type",
        mensagem: "Invalid input",
        ocorrencias: 2,
      },
    ]);
    const muitos = Array.from({ length: 60 }, (_, i) =>
      problema([`campo_${i}`]),
    );
    const resumo = resumirDetalhes([...muitos, problema(["campo_59"])]);
    expect(resumo).toHaveLength(LIMITE_DETALHES + 1);
    expect(resumo.at(-1)).toEqual({
      caminho: [],
      codigo: "itens_omitidos",
      mensagem: "10 itens omitidos (limite de 50)",
      ocorrencias: 11,
    });
  });

  it("sem avisos grava NULL (a coluna nunca guarda [])", () => {
    expect(avisosParaGravar(aceita(paidOrderOficial).avisos)).toBeNull();
    const comAviso = aceita({ ...paidOrderOficial, status: 42 }).avisos;
    expect(avisosParaGravar(comAviso)).toEqual(comAviso);
  });

  it("fração de centavo é arredondada meio para cima, de forma exata, e gera aviso", () => {
    const numero = aceita({ ...paidOrderOficial, total: 1.005 });
    expect(reaisParaCentavos(numero.payload.total)).toBe(101);
    expect(numero.avisos.map((aviso) => aviso.codigo)).toEqual([
      "fracao_de_centavo",
    ]);
    const texto = aceita({ ...paidOrderOficial, total: "1.005" });
    expect(reaisParaCentavos(texto.payload.total)).toBe(101);
    expect(texto.avisos.map((aviso) => aviso.codigo).sort()).toEqual([
      "fracao_de_centavo",
      "invalid_type",
    ]);
    expect(textoDecimalParaCentavos("19.90")).toBe(1990);
    expect(textoDecimalParaCentavos("1234567.0049999999999")).toBe(123456700);
    expect(textoDecimalParaCentavos("19,90")).toBeNull();
  });

  it("o tipo da análise obriga a tratar recusa e aceite", () => {
    expectTypeOf<
      Extract<AnalisePayloadRifei, { aceito: true }>
    >().toHaveProperty("avisos");
    expectTypeOf<
      Extract<AnalisePayloadRifei, { aceito: false }>
    >().toHaveProperty("problemas");
    expectTypeOf(
      payloadRifeiSchema.parse(paidOrderOficial).total,
    ).toEqualTypeOf<number>();
    expectTypeOf(
      payloadRifeiSchema.parse(paidOrderOficial).status,
    ).toEqualTypeOf<string | null>();
  });
});

describe("CA1/CA6: payload redigido (D1)", () => {
  it("o tipo redigido não contém campos pessoais", () => {
    expectTypeOf<PayloadRifeiRedigido>().not.toHaveProperty("buyer");
    expectTypeOf<PayloadRifeiRedigido>().not.toHaveProperty("observation");
    expectTypeOf<PayloadRifeiRedigido>().not.toHaveProperty("fbp");
    expectTypeOf<PayloadRifeiRedigido>().not.toHaveProperty("fbc");
    expectTypeOf<PayloadRifeiRedigido["comprador"]>().toEqualTypeOf<{
      ddd: string | null;
      pais: string | null;
    }>();

    const chaves = Object.keys(payloadRifeiRedigidoSchema.shape);
    for (const campo of CAMPOS_DESCARTADOS_NA_REDACAO) {
      expect(chaves).not.toContain(campo.split(".")[0]);
    }
    expect(
      Object.keys(payloadRifeiRedigidoSchema.shape.comprador.shape).sort(),
    ).toEqual(["ddd", "pais"]);
  });

  it.each(FIXTURES_ACEITAS)(
    "redige %s: passa no schema estrito e não sobra nenhum valor pessoal",
    (_nome, fixture) => {
      const { payload } = aceita(fixture);
      const redigido = redigirPayloadRifei(payload);
      expect(payloadRifeiRedigidoSchema.parse(redigido)).toEqual(redigido);

      const json = JSON.stringify(redigido);
      const pessoais = textosPessoais(fixture);
      expect(pessoais.length).toBeGreaterThan(0);
      for (const texto of pessoais) {
        expect(json).not.toContain(texto);
      }
      expect(redigido.comprador).toEqual(derivarTelefone(payload.buyer.phone));
    },
  );

  it("o schema redigido recusa qualquer campo a mais", () => {
    const redigido = redigirPayloadRifei(aceita(paidOrderOficial).payload);
    expect(
      payloadRifeiRedigidoSchema.safeParse({
        ...redigido,
        buyer: paidOrderOficial.buyer,
      }).success,
    ).toBe(false);
    expect(
      payloadRifeiRedigidoSchema.safeParse({
        ...redigido,
        observation: "texto",
      }).success,
    ).toBe(false);
    expect(
      payloadRifeiRedigidoSchema.safeParse({
        ...redigido,
        comprador: {
          ...redigido.comprador,
          phone: paidOrderOficial.buyer.phone,
        },
      }).success,
    ).toBe(false);
  });

  it("guarda do comprador só DDD e país: exemplo oficial e fixtures", () => {
    const comprador = (fixture: unknown) =>
      redigirPayloadRifei(aceita(fixture).payload).comprador;
    expect(comprador(paidOrderOficial)).toEqual({ ddd: "99", pais: "55" });
    expect(comprador(newOrderAfiliado)).toEqual({ ddd: "91", pais: "55" });
    expect(comprador(expiredOrder)).toEqual({ ddd: null, pais: "351" });
    expect(comprador(paidOrderTiposEstranhos)).toEqual({
      ddd: null,
      pais: null,
    });
  });

  it.each([
    ["+5591988887777", { ddd: "91", pais: "55" }],
    ["+55 (91) 98888-7777", { ddd: "91", pais: "55" }],
    ["+559133334444", { ddd: "91", pais: "55" }],
    ["+5501988887777", { ddd: null, pais: "55" }],
    ["+55919888", { ddd: null, pais: "55" }],
    ["+351910000002", { ddd: null, pais: "351" }],
    ["+12025550123", { ddd: null, pais: "1" }],
    ["+447911123456", { ddd: null, pais: "44" }],
    ["91988887777", { ddd: null, pais: null }],
    ["", { ddd: null, pais: null }],
    ["sem telefone", { ddd: null, pais: null }],
  ])("deriva DDD e país de %j", (telefone, esperado) => {
    expect(derivarTelefone(telefone)).toEqual(esperado);
  });

  it.each([
    [1.25, 125],
    [2.5, 250],
    [60, 6000],
    [19.99, 1999],
    [0.1 + 0.2, 30],
    [0, 0],
    [1.005, 101],
    [2.675, 268],
    [1.004, 100],
    [10_000_000, 1_000_000_000],
  ])("D2: R$ %d vira %d centavos", (reais, centavos) => {
    expect(reaisParaCentavos(reais)).toBe(centavos);
  });
});
