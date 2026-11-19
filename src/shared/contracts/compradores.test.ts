import { describe, expect, it } from "vitest";
import {
  BOM_UTF8,
  COLUNAS_COMPRADORES,
  ROTAS,
  agruparCompradores,
  cabecalhosDosCompradores,
  compradorPedidoSchema,
  consultaCompradoresSchema,
  extrairContatoComprador,
  formatarTelefoneBr,
  itemPedidoSchema,
  montarCsvCompradores,
  normalizarNomeComprador,
  normalizarTelefoneE164,
  numeroWhatsApp,
  type PedidoDoComprador,
} from ".";

// Dados fictícios (nenhum dado real).
const pedido = (extra: Partial<PedidoDoComprador>): PedidoDoComprador => ({
  nome: "Maria Teste",
  telefone: "+5511987654321",
  status: "approved",
  qtd_bilhetes: 2,
  total_centavos: 2000,
  celula_nome: "Célula Alfa",
  reservado_em: "2026-11-23T13:05:00.000Z",
  ...extra,
});

describe("RIFA-076 (D36): contato do comprador", () => {
  it("normaliza o nome: espaços juntados, controle tirado, corte em 120, vazio vira null", () => {
    expect(normalizarNomeComprador("  Maria \n  Teste\t ")).toBe("Maria Teste");
    expect(normalizarNomeComprador("   ")).toBeNull();
    expect(normalizarNomeComprador(null)).toBeNull();
    expect(normalizarNomeComprador("a".repeat(300))).toHaveLength(120);
  });

  it("normaliza o telefone para E.164; fora do formato, null", () => {
    expect(normalizarTelefoneE164("+55 (11) 98765-4321")).toBe(
      "+5511987654321",
    );
    expect(normalizarTelefoneE164("11987654321")).toBeNull();
    expect(normalizarTelefoneE164("+0123")).toBeNull();
    expect(normalizarTelefoneE164(undefined)).toBeNull();
  });

  it("extrai só nome e telefone do buyer", () => {
    expect(
      extrairContatoComprador({
        buyer: {
          name: "Maria Teste",
          phone: "+5511987654321",
          email: "x@example.com",
          document: "000",
          date_of_birth: null,
          address: null,
        },
      }),
    ).toEqual({ nome: "Maria Teste", telefone: "+5511987654321" });
  });

  it("o item do pedido aceita o comprador (admin) e a ausência (os outros papéis)", () => {
    expect(
      compradorPedidoSchema.parse({ nome: null, telefone: "+5511987654321" }),
    ).toEqual({ nome: null, telefone: "+5511987654321" });
    expect(
      compradorPedidoSchema.safeParse({ nome: "x", telefone: "1198765" })
        .success,
    ).toBe(false);
    const base = {
      id: "PED1",
      status: "approved",
      qtd_bilhetes: 1,
      total_centavos: 1000,
      affiliate_id: null,
      celula_id: null,
      celula_nome: null,
      ddd: "11",
      criado_em: null,
      aprovado_em: "2026-11-23T13:05:00.000Z",
      expirado_em: null,
      registrado_em: "2026-11-23T13:05:00.000Z",
      atualizado_em: "2026-11-23T13:05:00.000Z",
      suspeito: false,
      desconsiderado: null,
      origem: "webhook",
    };
    expect("comprador" in itemPedidoSchema.parse(base)).toBe(false);
    expect(
      itemPedidoSchema.parse({
        ...base,
        comprador: { nome: "Maria", telefone: null },
      }).comprador,
    ).toEqual({ nome: "Maria", telefone: null });
  });

  it("a rota da exportação é GET, só admin, em CSV", () => {
    expect(ROTAS.exportarCompradores).toMatchObject({
      metodo: "GET",
      caminho: "/api/admin/pedidos/compradores",
      grupo: "coordenacao",
      papeis: ["admin"],
    });
    expect(consultaCompradoresSchema.parse({ so_pagou: "true" })).toEqual({
      so_pagou: true,
    });
    expect(consultaCompradoresSchema.safeParse({ so_pagou: "1" }).success).toBe(
      false,
    );
  });
});

describe("RIFA-076 (D36): planilha de compradores", () => {
  it("telefone legível no Brasil e link do WhatsApp", () => {
    expect(formatarTelefoneBr("+5511987654321")).toBe("(11) 98765-4321");
    expect(formatarTelefoneBr("+559133334444")).toBe("(91) 3333-4444");
    expect(formatarTelefoneBr("+14155550100")).toBe("+14155550100");
    expect(formatarTelefoneBr(null)).toBe("");
    expect(numeroWhatsApp("+5511987654321")).toBe("5511987654321");
    expect(numeroWhatsApp(null)).toBeNull();
  });

  it("junta pelo telefone; sem telefone, pelo nome (sem acento e maiúsculas); sem os dois, fica de fora", () => {
    const linhas = agruparCompradores([
      pedido({ reservado_em: "2026-11-23T10:00:00.000Z" }),
      pedido({
        nome: "Maria T.",
        status: "in_process",
        qtd_bilhetes: 3,
        total_centavos: 3000,
        celula_nome: "Célula Beta",
        reservado_em: "2026-11-24T10:00:00.000Z",
      }),
      pedido({ nome: "João Sem Fone", telefone: null, status: "expired" }),
      pedido({ nome: "joao  sem fone", telefone: null, status: "expired" }),
      pedido({ nome: null, telefone: null }),
    ]);
    expect(linhas).toEqual([
      {
        nome: "João Sem Fone",
        telefone: null,
        celulas: ["Célula Alfa"],
        pedidos: 2,
        bilhetes: 4,
        pago_centavos: 0,
        primeira: "2026-11-23T13:05:00.000Z",
        ultima: "2026-11-23T13:05:00.000Z",
        pagou: false,
      },
      {
        // O nome do pedido mais recente.
        nome: "Maria T.",
        telefone: "+5511987654321",
        celulas: ["Célula Alfa", "Célula Beta"],
        pedidos: 2,
        bilhetes: 5,
        pago_centavos: 2000,
        primeira: "2026-11-23T10:00:00.000Z",
        ultima: "2026-11-24T10:00:00.000Z",
        pagou: true,
      },
    ]);
    expect(
      agruparCompradores(
        [pedido({}), pedido({ telefone: "+5591988887777", status: "expired" })],
        { soPagou: true },
      ).map((linha) => linha.telefone),
    ).toEqual(["+5511987654321"]);
  });

  it("o CSV: BOM, ';', CRLF, telefone legível, R$ com vírgula, data no fuso e proteção contra fórmula", () => {
    const csv = montarCsvCompradores(
      agruparCompradores([
        pedido({ total_centavos: 123456 }),
        pedido({ nome: "=HYPERLINK(1)", telefone: null, status: "in_process" }),
      ]),
      "America/Sao_Paulo",
    );
    expect(csv.startsWith(BOM_UTF8)).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      COLUNAS_COMPRADORES.join(";"),
      "'=HYPERLINK(1);;Célula Alfa;1;2;0,00;23/11/2026 10:05;23/11/2026 10:05;Só reservou",
      "Maria Teste;(11) 98765-4321;Célula Alfa;1;2;1234,56;23/11/2026 10:05;23/11/2026 10:05;Pagou",
      "",
    ]);
    expect(cabecalhosDosCompradores("2026-11-23")).toEqual({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="rifa-videira-kids-compradores-2026-11-23.csv"',
      "Cache-Control": "no-store",
    });
  });
});
