// A tela Pedidos e o alerta usam cópias de valores do contrato (os valores de src/shared/contracts poriam o zod no
// pacote do site; veja pedidos-api.ts e alerta-webhook.ts). Este teste garante que as cópias continuam iguais ao
// contrato, que todo status, resultado e código de recusa tem texto em português, que os códigos de problema do zod
// e da D11 têm texto, e que as consultas que a tela monta passam pelos schemas das rotas.
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  CHAVES_REGRAS,
  LIMITE_OBSERVACAO_DESCONSIDERACAO,
  MOTIVOS_DESCONSIDERACAO as MOTIVOS_DO_CONTRATO,
  ROTAS_REGRAS_CAMPANHA,
  corpoDesconsiderarPedidoSchema,
  corpoReconsiderarPedidoSchema,
  observacaoTemContato as observacaoTemContatoDoContrato,
  CODIGOS_RECUSA_WEBHOOK,
  HORA_FIM_ALERTA as HORA_FIM_DO_CONTRATO,
  HORA_INICIO_ALERTA as HORA_INICIO_DO_CONTRATO,
  HORAS_SEM_ENTREGA_ALERTA as HORAS_DO_CONTRATO,
  MOTIVOS_PEDIDO_SUSPEITO,
  PAGINA_ENTREGAS_MAXIMA,
  PAGINA_ENTREGAS_PADRAO,
  PAGINA_PEDIDOS_MAXIMA,
  PAGINA_PEDIDOS_PADRAO,
  RESULTADOS_EVENTO_WEBHOOK,
  ROTAS,
  SITUACOES_WEBHOOK as SITUACOES_DO_CONTRATO,
  STATUS_PEDIDO as STATUS_DO_CONTRATO,
  consultaEntregasWebhookSchema,
  consultaPedidosSchema,
  consultaCompradoresSchema,
  formatarTelefoneBr,
  numeroWhatsApp,
} from "../../../shared/contracts";
import { numeroDoWhatsApp, telefoneLegivel } from "./comprador";
import { TELAS_COORDENACAO } from "../coordenacao/telas";
import {
  ABA_ENTREGAS,
  CAMINHO_CONFERENCIA,
  CAMINHO_ESTADO_WEBHOOK,
  CAMINHO_TELA_PEDIDOS,
  HORA_FIM_ALERTA,
  HORA_INICIO_ALERTA,
  HORAS_SEM_ENTREGA_ALERTA,
  PARAM_ABA,
  SITUACOES_WEBHOOK,
  linkDasEntregas,
} from "./alerta-webhook";
import { CAMINHO_PEDIDOS_SUSPEITOS } from "./ListaPedidos";
import { CAMINHO_CHAVE_NA_CAMPANHA } from "./Desconsiderar";
import {
  CAMINHO_CAMPANHA,
  CAMINHO_CELULAS,
  CAMINHO_COMPRADORES,
  CAMINHO_DESCONSIDERAR,
  CAMINHO_ENTREGAS,
  CAMINHO_PEDIDOS,
  CAMINHO_RECONSIDERAR,
  LIMITE_OBSERVACAO,
  MOTIVOS_DESCONSIDERACAO,
  observacaoTemContato,
  ENTREGAS_POR_PAGINA,
  PEDIDOS_POR_PAGINA,
  RESULTADOS_ENTREGA,
  SEM_FILTROS,
  STATUS_PEDIDO,
  TAMANHO_MAXIMO_ID,
  caminhoDasEntregas,
  caminhoDosPedidos,
  filtrosDasEntregas,
  filtrosDosPedidos,
  type FiltrosPedidos,
} from "./pedidos-api";
import {
  ROTULO_MOTIVO,
  RESULTADO,
  ROTULO_FILTRO_RESULTADO,
  ROTULO_RECUSA,
  ROTULO_STATUS,
  ROTULO_STATUS_PLURAL,
  TEXTO_DO_CODIGO,
} from "./textos";

/** Todos os códigos de problema do zod: o `satisfies` falha no typecheck se o zod ganhar ou perder um código. */
const CODIGOS_ZOD = {
  invalid_type: true,
  too_big: true,
  too_small: true,
  invalid_format: true,
  not_multiple_of: true,
  unrecognized_keys: true,
  invalid_union: true,
  invalid_key: true,
  invalid_element: true,
  invalid_value: true,
  custom: true,
} satisfies Record<z.core.$ZodIssueCode, true>;

describe("RIFA-076 (D36): cópias do contrato do comprador no site", () => {
  it("o caminho da planilha (só admin) e a consulta que a tela manda", () => {
    expect(CAMINHO_COMPRADORES).toBe(ROTAS.exportarCompradores.caminho);
    expect(ROTAS.exportarCompradores.papeis).toEqual(["admin"]);
    expect(consultaCompradoresSchema.parse({ so_pagou: "true" })).toEqual({
      so_pagou: true,
    });
  });

  it("telefone legível e número do WhatsApp: os mesmos do contrato", () => {
    for (const telefone of [
      "+5511987654321",
      "+559133334444",
      "+14155550100",
      "+5591",
    ]) {
      expect(telefoneLegivel(telefone)).toBe(formatarTelefoneBr(telefone));
      expect(numeroDoWhatsApp(telefone)).toBe(numeroWhatsApp(telefone));
    }
  });
});

describe("cópias do contrato dos pedidos, das entregas e do alerta no site", () => {
  it("caminhos e método das rotas (toda a coordenação, sem papel extra), e a tela para toda a coordenação", () => {
    for (const [rota, caminho] of [
      [ROTAS.listarPedidos, CAMINHO_PEDIDOS],
      [ROTAS.entregasWebhook, CAMINHO_ENTREGAS],
      [ROTAS.estadoWebhook, CAMINHO_ESTADO_WEBHOOK],
      [ROTAS.listarCelulas, CAMINHO_CELULAS],
    ] as const) {
      expect(rota).toMatchObject({
        metodo: "GET",
        caminho,
        grupo: "coordenacao",
      });
      expect(rota).not.toHaveProperty("papeis");
    }
    const tela = TELAS_COORDENACAO.find(
      ({ segmento }) => segmento === "pedidos",
    );
    expect(tela).toBeDefined();
    expect(tela?.papeis).toBeUndefined();
    expect(`/coordenacao/${tela?.segmento}`).toBe(CAMINHO_TELA_PEDIDOS);
    for (const segmento of ["pedidos-suspeitos", "conferencia"]) {
      expect(TELAS_COORDENACAO.map((t) => t.segmento)).toContain(segmento);
    }
    expect(CAMINHO_PEDIDOS_SUSPEITOS).toBe("/coordenacao/pedidos-suspeitos");
    expect(CAMINHO_CONFERENCIA).toBe("/coordenacao/conferencia");
  });

  it("tamanhos de página: o padrão das rotas, dentro do máximo; o id da busca no limite do schema", () => {
    expect(PEDIDOS_POR_PAGINA).toBe(PAGINA_PEDIDOS_PADRAO);
    expect(PEDIDOS_POR_PAGINA).toBeLessThanOrEqual(PAGINA_PEDIDOS_MAXIMA);
    expect(ENTREGAS_POR_PAGINA).toBe(PAGINA_ENTREGAS_PADRAO);
    expect(ENTREGAS_POR_PAGINA).toBeLessThanOrEqual(PAGINA_ENTREGAS_MAXIMA);
    const busca = (id: string) =>
      consultaPedidosSchema.safeParse({ id }).success;
    expect(busca("x".repeat(TAMANHO_MAXIMO_ID))).toBe(true);
    expect(busca("x".repeat(TAMANHO_MAXIMO_ID + 1))).toBe(false);
  });

  it("status, resultados e situações: as mesmas listas, na mesma ordem", () => {
    expect(STATUS_PEDIDO).toEqual(STATUS_DO_CONTRATO);
    expect(RESULTADOS_ENTREGA).toEqual(RESULTADOS_EVENTO_WEBHOOK);
    expect(SITUACOES_WEBHOOK).toEqual(SITUACOES_DO_CONTRATO);
  });

  it("constantes da janela do alerta", () => {
    expect([
      HORAS_SEM_ENTREGA_ALERTA,
      HORA_INICIO_ALERTA,
      HORA_FIM_ALERTA,
    ]).toEqual([
      HORAS_DO_CONTRATO,
      HORA_INICIO_DO_CONTRATO,
      HORA_FIM_DO_CONTRATO,
    ]);
  });
});

describe("as consultas que a tela monta passam pelos schemas das rotas", () => {
  const consulta = (caminho: string, rota: string) => {
    const url = new URL(caminho, "https://site.example");
    expect(url.pathname).toBe(rota);
    return Object.fromEntries(url.searchParams);
  };

  it.each<[string, FiltrosPedidos, string | null, object]>([
    ["sem filtro", SEM_FILTROS, null, { limite: 50 }],
    [
      "status, célula e busca, na página seguinte",
      {
        status: "approved",
        celula: { tipo: "id", id: 3 },
        id: "PED 1",
        desconsiderado: null,
      },
      "Y3Vyc29y",
      {
        limite: 50,
        status: "approved",
        celula_id: 3,
        id: "PED 1",
        antes_de: "Y3Vyc29y",
      },
    ],
    [
      "só os desconsiderados (D20)",
      { ...SEM_FILTROS, desconsiderado: true },
      null,
      { limite: 50, desconsiderado: true },
    ],
    [
      "só os que contam (D20)",
      { ...SEM_FILTROS, desconsiderado: false },
      null,
      { limite: 50, desconsiderado: false },
    ],
    [
      "só sem célula",
      { ...SEM_FILTROS, celula: { tipo: "sem_celula" } },
      null,
      { limite: 50, sem_celula: true },
    ],
  ])("pedidos: %s", (_caso, filtros, cursor, esperado) => {
    expect(
      consultaPedidosSchema.parse(
        consulta(caminhoDosPedidos(filtros, cursor), CAMINHO_PEDIDOS),
      ),
    ).toEqual(esperado);
  });

  it("entregas: sem filtro, com o resultado e na página seguinte", () => {
    const entregas = (caminho: string) =>
      consultaEntregasWebhookSchema.parse(consulta(caminho, CAMINHO_ENTREGAS));
    expect(entregas(caminhoDasEntregas({ resultado: null }, null))).toEqual({
      limite: 50,
    });
    expect(
      entregas(caminhoDasEntregas({ resultado: "erro_validacao" }, 42)),
    ).toEqual({ limite: 50, resultado: "erro_validacao", antes_de: 42 });
  });

  it("a URL da tela nunca vira uma consulta inválida (celula_id e sem_celula juntos, status ou resultado fora da lista)", () => {
    for (const busca of [
      "celula_id=3&sem_celula=true",
      "status=pago&celula_id=0&id=",
      "sem_celula=true&id=" + "x".repeat(200),
      "celula_id=12345678901&status=approved",
      "desconsiderado=sim",
    ]) {
      const filtros = filtrosDosPedidos(new URLSearchParams(busca));
      expect(
        consultaPedidosSchema.safeParse(
          consulta(caminhoDosPedidos(filtros, null), CAMINHO_PEDIDOS),
        ).success,
        busca,
      ).toBe(true);
    }
    expect(
      filtrosDosPedidos(new URLSearchParams("celula_id=3&sem_celula=true"))
        .celula,
    ).toEqual({ tipo: "id", id: 3 });
    expect(filtrosDasEntregas(new URLSearchParams("resultado=ok"))).toEqual({
      resultado: null,
    });
  });

  it("o link do alerta abre a aba das entregas com o filtro que a tela entende", () => {
    const url = new URL(
      linkDasEntregas("erro_validacao"),
      "https://site.example",
    );
    expect(url.pathname).toBe(CAMINHO_TELA_PEDIDOS);
    expect(url.searchParams.get(PARAM_ABA)).toBe(ABA_ENTREGAS);
    expect(filtrosDasEntregas(url.searchParams)).toEqual({
      resultado: "erro_validacao",
    });
  });
});

describe("todo valor do contrato tem texto em português", () => {
  const emPortugues = (texto: string) => {
    expect(texto).toMatch(/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][^_]*$/);
  };

  it("status (singular e plural), resultados (rótulo e filtro) e códigos de recusa: nem a mais nem a menos", () => {
    expect(Object.keys(ROTULO_STATUS).sort()).toEqual(
      [...STATUS_DO_CONTRATO].sort(),
    );
    expect(Object.keys(ROTULO_STATUS_PLURAL).sort()).toEqual(
      [...STATUS_DO_CONTRATO].sort(),
    );
    expect(Object.keys(RESULTADO).sort()).toEqual(
      [...RESULTADOS_EVENTO_WEBHOOK].sort(),
    );
    expect(Object.keys(ROTULO_FILTRO_RESULTADO).sort()).toEqual(
      [...RESULTADOS_EVENTO_WEBHOOK].sort(),
    );
    expect(Object.keys(ROTULO_RECUSA).sort()).toEqual(
      [...CODIGOS_RECUSA_WEBHOOK].sort(),
    );
    for (const texto of [
      ...Object.values(ROTULO_STATUS),
      ...Object.values(ROTULO_STATUS_PLURAL),
      ...Object.values(RESULTADO).map(({ rotulo }) => rotulo),
      ...Object.values(ROTULO_FILTRO_RESULTADO),
      ...Object.values(ROTULO_RECUSA),
    ])
      emPortugues(texto);
    expect(
      new Set(Object.values(RESULTADO).map(({ rotulo }) => rotulo)).size,
    ).toBe(RESULTADOS_EVENTO_WEBHOOK.length);
  });

  it("os códigos de problema: todos os do zod, os motivos da D11, os da recusa, a fração de centavo, o afiliado trocado e o corte da lista", () => {
    for (const codigo of [
      ...Object.keys(CODIGOS_ZOD),
      ...MOTIVOS_PEDIDO_SUSPEITO,
      ...CODIGOS_RECUSA_WEBHOOK,
      "fracao_de_centavo",
      // O aviso que o webhook grava quando o evento traz outro afiliado para um pedido existente
      // (worker/db/pedidos.ts).
      "afiliado_alterado",
      "itens_omitidos",
    ]) {
      expect(TEXTO_DO_CODIGO, codigo).toHaveProperty(codigo);
      expect(TEXTO_DO_CODIGO[codigo], codigo).not.toContain("_");
    }
  });
});

describe("cópias do contrato das regras da campanha (RIFA-028, D20)", () => {
  it("caminhos e papéis das rotas de desconsiderar e desfazer (só admin), e o da campanha", () => {
    expect(ROTAS_REGRAS_CAMPANHA.desconsiderarPedido).toMatchObject({
      metodo: "POST",
      caminho: CAMINHO_DESCONSIDERAR,
      papeis: ["admin"],
    });
    expect(ROTAS_REGRAS_CAMPANHA.reconsiderarPedido).toMatchObject({
      metodo: "POST",
      caminho: CAMINHO_RECONSIDERAR,
      papeis: ["admin"],
    });
    expect(ROTAS.obterCampanha.caminho).toBe(CAMINHO_CAMPANHA);
    expect(CAMINHO_CHAVE_NA_CAMPANHA).toMatch(/^\/coordenacao\/campanha#/);
    expect(CHAVES_REGRAS).toContain("pedidos.desconsiderar");
  });

  it("motivos (com texto em português), limite da observação e a trava do contato do comprador", () => {
    expect(MOTIVOS_DESCONSIDERACAO).toEqual(MOTIVOS_DO_CONTRATO);
    expect(Object.keys(ROTULO_MOTIVO)).toEqual([...MOTIVOS_DO_CONTRATO]);
    expect(LIMITE_OBSERVACAO).toBe(LIMITE_OBSERVACAO_DESCONSIDERACAO);
    for (const texto of [
      "compra de teste na reunião",
      "comprador@exemplo.com",
      "@",
      "(91) 98888-7777",
      "91 9888 87777",
      "123.456.789-00",
      "pedido 1234567 do dia 25",
      "12345678",
      "1234 5678",
      "1234/5678",
      "",
    ])
      expect(observacaoTemContato(texto), texto).toBe(
        observacaoTemContatoDoContrato(texto),
      );
  });

  it("os corpos que a tela manda passam nos schemas das rotas", () => {
    expect(
      corpoDesconsiderarPedidoSchema.parse({
        pedido_id: "PED-1",
        motivo: "teste",
        observacao: null,
      }),
    ).toEqual({ pedido_id: "PED-1", motivo: "teste", observacao: null });
    expect(corpoReconsiderarPedidoSchema.parse({ pedido_id: "PED-1" })).toEqual(
      { pedido_id: "PED-1" },
    );
  });
});
