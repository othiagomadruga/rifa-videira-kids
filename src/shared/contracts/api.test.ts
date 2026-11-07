import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  COLUNAS_CSV_HIERARQUIA,
  ROTAS,
  consultaAfiliadosSchema,
  consultaBumboSchema,
  consultaPainelResumoSchema,
  consultaRankingPublicoSchema,
  consultaRankingSchema,
  corpoImportarHierarquiaSchema,
  corpoSalvarAfiliadoSchema,
  linhaCsvHierarquiaSchema,
  parametroAffiliateIdSchema,
  parametroIdSchema,
  respostaBumboSchema,
  respostaPainelResumoSchema,
  respostaRankingPublicoSchema,
  respostaRankingSchema,
  respostaWebhookRifeiSchema,
  detalhesCsvInvalidoSchema,
  detalhesErroWebhookSchema,
  CAMINHOS_WEBHOOK_RIFEI,
  LIMITE_CARACTERES_CSV_HIERARQUIA,
  LIMITE_CORPO_WEBHOOK_BYTES,
  avisoImportacaoSchema,
  normalizarEspacos,
  respostaImportarHierarquiaSchema,
  consultaVisaoIndividualSchema,
  desempenhoIndividualSchema,
  pontoCurvaIndividualSchema,
  rankingIndividualSchema,
  respostaVisaoIndividualSchema,
  vizinhoIndividualSchema,
  type SituacaoRota,
} from "./api";
import { PAPEIS_HIERARQUIA } from "./acesso";
import {
  CODIGOS_ERRO,
  STATUS_HTTP_DO_ERRO,
  criarErroApi,
  erroApiSchema,
} from "./erros";

const rotas = Object.entries(ROTAS);

/** Nomes de todos os campos que um schema pode devolver (percorre o JSON Schema gerado pelo zod). */
function nomesDeCampos(schema: z.ZodType): string[] {
  const nomes: string[] = [];
  const visitar = (no: unknown): void => {
    if (Array.isArray(no)) {
      no.forEach(visitar);
      return;
    }
    if (typeof no !== "object" || no === null) return;
    for (const [chave, valor] of Object.entries(no)) {
      if (chave === "properties" && typeof valor === "object" && valor !== null)
        nomes.push(...Object.keys(valor));
      visitar(valor);
    }
  };
  visitar(z.toJSONSchema(schema));
  return nomes;
}

describe("CA3: catálogo de rotas", () => {
  it("traz todas as rotas detalhadas das Sprints 1–4", () => {
    const detalhadas = rotas
      .filter(([, rota]) => rota.situacao === "detalhada")
      .map(([, rota]) => `${rota.metodo} ${rota.caminho}`);
    expect(detalhadas.sort()).toEqual(
      [
        "POST /api/webhooks/rifei",
        "GET /api/health",
        "GET /api/admin/campanha",
        "PUT /api/admin/campanha",
        ...["redes", "discipuladores", "celulas"].flatMap((recurso) => [
          `GET /api/admin/${recurso}`,
          `POST /api/admin/${recurso}`,
          `GET /api/admin/${recurso}/:id`,
          `PUT /api/admin/${recurso}/:id`,
          `DELETE /api/admin/${recurso}/:id`,
        ]),
        "POST /api/admin/hierarquia/importar",
        "GET /api/admin/afiliados",
        "PUT /api/admin/afiliados/:affiliateId",
        "GET /api/admin/adesao",
        // Sprint 4 (RIFA-013b): pedidos marcados pelo webhook e trilha de auditoria.
        "GET /api/admin/pedidos/suspeitos",
        "GET /api/admin/auditoria",
        "GET /api/painel/resumo",
        "GET /api/painel/ranking",
        "GET /api/publico/ranking",
        "GET /api/publico/bumbo",
        // Sprint 4 (RIFA-012): conferência pelo CSV da Rifei.
        "POST /api/admin/reconciliacao/analisar",
        "POST /api/admin/reconciliacao/recuperar",
        "GET /api/admin/reconciliacao/recuperacoes",
        // Sprint 5 (RIFA-014): visão individual do líder, do discipulador e da rede.
        "GET /api/minha/visao",
      ].sort(),
    );
  });

  it("nenhuma rota fica em rascunho (a reconciliação da Sprint 4 foi detalhada na RIFA-012)", () => {
    const rascunhos = rotas
      .filter(([, rota]) => (rota.situacao as SituacaoRota) === "rascunho")
      .map(([, rota]) => `${rota.metodo} ${rota.caminho}`);
    expect(rascunhos).toEqual([]);
  });

  it("o grupo de autorização de cada rota bate com o prefixo do caminho", () => {
    for (const [nome, rota] of rotas) {
      const esperado = rota.caminho.startsWith("/api/webhooks/")
        ? "rifei_bearer"
        : rota.caminho.startsWith("/api/admin/") ||
            rota.caminho.startsWith("/api/painel/")
          ? "coordenacao"
          : rota.caminho.startsWith("/api/minha/")
            ? "hierarquia"
            : "aberto";
      expect({ nome, grupo: rota.grupo }).toEqual({ nome, grupo: esperado });
    }
    const abertas = rotas
      .filter(([, rota]) => rota.grupo === "aberto")
      .map(([, rota]) => rota.caminho);
    expect(
      abertas.every(
        (caminho) =>
          caminho === "/api/health" || caminho.startsWith("/api/publico/"),
      ),
    ).toBe(true);
  });

  it("não repete método + caminho e usa corpo de resposta só fora do 204", () => {
    const chaves = rotas.map(([, rota]) => `${rota.metodo} ${rota.caminho}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const [, rota] of rotas) {
      expect(rota.sucesso.status === 204).toBe(rota.sucesso.corpo === null);
    }
  });
});

describe("CA3: formato único de erro", () => {
  it("aceita { erro: { codigo, mensagem, detalhes? } }", () => {
    expect(
      erroApiSchema.safeParse(
        criarErroApi("nao_encontrado", "Rede não encontrada"),
      ).success,
    ).toBe(true);
    const comDetalhes = criarErroApi("requisicao_invalida", "Dados inválidos", [
      { caminho: ["nome"], codigo: "too_small", mensagem: "Obrigatório" },
    ]);
    expect(erroApiSchema.parse(comDetalhes).erro.detalhes).toHaveLength(1);
    expect(criarErroApi("em_uso", "Rede com discipuladores")).toEqual({
      erro: { codigo: "em_uso", mensagem: "Rede com discipuladores" },
    });
  });

  it("recusa outros formatos", () => {
    for (const corpo of [
      { error: "x" },
      { erro: "x" },
      { erro: { codigo: "x" } },
      { erro: { mensagem: "x" } },
    ]) {
      expect(erroApiSchema.safeParse(corpo).success).toBe(false);
    }
  });

  it("todo código de erro tem um status HTTP 4xx ou 5xx", () => {
    for (const codigo of CODIGOS_ERRO) {
      expect(STATUS_HTTP_DO_ERRO[codigo]).toBeGreaterThanOrEqual(400);
    }
    expect(STATUS_HTTP_DO_ERRO.nao_autenticado).toBe(401);
    expect(STATUS_HTTP_DO_ERRO.nao_configurado).toBe(503);
    expect(STATUS_HTTP_DO_ERRO.payload_invalido).toBe(400);
    expect(STATUS_HTTP_DO_ERRO.corpo_muito_grande).toBe(413);
    // Limite de requisições por IP (RIFA-013b), no catálogo desde a revisão.
    expect(CODIGOS_ERRO).toContain("muitas_requisicoes");
    expect(STATUS_HTTP_DO_ERRO.muitas_requisicoes).toBe(429);
  });
});

describe("CA3: rotas abertas nunca devolvem valores financeiros", () => {
  const FINANCEIRO =
    /centavos|valor|reais|total|preco|arrecad|vendas|realizado|bilhetes/i;

  it.each(rotas.filter(([, rota]) => rota.grupo === "aberto"))(
    "%s não tem campo financeiro",
    (_nome, rota) => {
      const corpo = rota.sucesso.corpo;
      expect(corpo).not.toBeNull();
      if (corpo)
        expect(
          nomesDeCampos(corpo).filter((campo) => FINANCEIRO.test(campo)),
        ).toEqual([]);
    },
  );

  const referencia = {
    data: "2026-12-02",
    fase: "durante",
    data_inicio: "2026-12-01",
    data_fim: "2026-12-24",
    duracao_dias: 24,
    dia_campanha: 2,
    dias_restantes: 23,
    dias_para_inicio: null,
    periodo: {
      ordem: 1,
      nome: "Semana 1",
      data_inicio: "2026-12-01",
      data_fim: "2026-12-10",
      dias: 10,
      dia_no_periodo: 2,
      dias_restantes: 9,
    },
  };
  const rankingPublico = {
    nivel: "celula",
    divisao: null,
    janela: {
      tipo: "atual",
      ordem: 1,
      nome: "Semana 1",
      data_inicio: "2026-12-01",
      data_fim: "2026-12-10",
    },
    criterio: "percentual_meta",
    referencia,
    itens: [{ posicao: 1, nome: "Célula Ficticia 01", divisao: "jovens" }],
    atualizado_em: "2026-12-02T15:00:00.000Z",
  };

  it("o ranking público é estrito: um valor a mais invalida a resposta, em qualquer nível", () => {
    expect(respostaRankingPublicoSchema.safeParse(rankingPublico).success).toBe(
      true,
    );
    const comValor = [
      { ...rankingPublico, total_centavos: 6000 },
      {
        ...rankingPublico,
        itens: [{ ...rankingPublico.itens[0], total_centavos: 6000 }],
      },
      {
        ...rankingPublico,
        janela: { ...rankingPublico.janela, bilhetes: 10 },
      },
      {
        ...rankingPublico,
        referencia: { ...referencia, realizado: 10 },
      },
      {
        ...rankingPublico,
        referencia: {
          ...referencia,
          periodo: { ...referencia.periodo, meta: 10 },
        },
      },
    ];
    for (const resposta of comValor)
      expect(respostaRankingPublicoSchema.safeParse(resposta).success).toBe(
        false,
      );
  });

  it("o bumbo é estrito: só data, referência, texto e gerado_em", () => {
    const bumbo = {
      data: "2026-12-02",
      referencia,
      texto: "*Rifa Videira Kids · Dia 2 de 24*",
      gerado_em: "2026-12-02T12:00:00.000Z",
    };
    expect(respostaBumboSchema.safeParse(bumbo).success).toBe(true);
    expect(
      respostaBumboSchema.safeParse({ ...bumbo, total_centavos: 1 }).success,
    ).toBe(false);
    expect(
      respostaBumboSchema.safeParse({ ...bumbo, texto: "x".repeat(4001) })
        .success,
    ).toBe(false);
  });

  it("as rotas abertas só têm campos de uma lista fechada (campo novo exige revisar este teste)", () => {
    const PERMITIDOS = [
      // ranking público
      "nivel",
      "divisao",
      "janela",
      "tipo",
      "ordem",
      "nome",
      "data_inicio",
      "data_fim",
      "criterio",
      "itens",
      "posicao",
      "percentual_meta_bp",
      "atualizado_em",
      // referência (fase, dia e período)
      "referencia",
      "data",
      "fase",
      "duracao_dias",
      "dia_campanha",
      "dias_restantes",
      "dias_para_inicio",
      "periodo",
      "dias",
      "dia_no_periodo",
      // bumbo
      "texto",
      "gerado_em",
      // health
      "ok",
      "db",
      "latenciaMs",
    ];
    const abertas = rotas.filter(([, rota]) => rota.grupo === "aberto");
    for (const [nome, rota] of abertas) {
      const corpo = rota.sucesso.corpo;
      if (!corpo) continue;
      const fora = nomesDeCampos(corpo).filter(
        (campo) => !PERMITIDOS.includes(campo),
      );
      expect({ nome, fora }).toEqual({ nome, fora: [] });
    }
  });

  it("o ranking e o resumo da coordenação, ao contrário, trazem os valores", () => {
    expect(nomesDeCampos(respostaRankingSchema)).toEqual(
      expect.arrayContaining([
        "total_centavos",
        "bilhetes",
        "meta",
        "realizado",
        "acima",
        "abaixo",
      ]),
    );
    expect(nomesDeCampos(respostaPainelResumoSchema)).toEqual(
      expect.arrayContaining([
        "total_centavos",
        "vendas_sem_celula",
        "vendas_fora_da_janela",
        "projecao",
        "curva",
      ]),
    );
  });
});

describe("CA3: parâmetros, consultas e corpos", () => {
  it("parâmetros da URL viram números", () => {
    expect(parametroIdSchema.parse({ id: "12" })).toEqual({ id: 12 });
    expect(parametroAffiliateIdSchema.parse({ affiliateId: "1042" })).toEqual({
      affiliateId: 1042,
    });
    expect(parametroIdSchema.safeParse({ id: "abc" }).success).toBe(false);
    expect(
      parametroAffiliateIdSchema.safeParse({ affiliateId: "0" }).success,
    ).toBe(false);
  });

  it("afiliados: vinculado=false é false (sem coerção ingênua de texto)", () => {
    expect(consultaAfiliadosSchema.parse({ vinculado: "false" })).toEqual({
      vinculado: false,
    });
    expect(consultaAfiliadosSchema.parse({ vinculado: "true" })).toEqual({
      vinculado: true,
    });
    expect(consultaAfiliadosSchema.parse({})).toEqual({});
  });

  it("afiliado: vincula com celula_id, desvincula com null", () => {
    expect(corpoSalvarAfiliadoSchema.parse({ celula_id: 7 })).toEqual({
      celula_id: 7,
    });
    expect(
      corpoSalvarAfiliadoSchema.parse({ celula_id: null, rotulo: null }),
    ).toEqual({
      celula_id: null,
      rotulo: null,
    });
    expect(corpoSalvarAfiliadoSchema.safeParse({}).success).toBe(false);
  });

  it("webhook: corpo até 1 MiB, URL com ou sem barra no fim, problemas resumidos no erro", () => {
    expect(LIMITE_CORPO_WEBHOOK_BYTES).toBe(1024 * 1024);
    expect(CAMINHOS_WEBHOOK_RIFEI).toEqual([
      "/api/webhooks/rifei",
      "/api/webhooks/rifei/",
    ]);
    const problema = {
      caminho: ["numbers_count"],
      codigo: "too_big",
      mensagem: "Quantidade de bilhetes acima do limite de 1.000.000",
      ocorrencias: 1,
    };
    expect(
      detalhesErroWebhookSchema.safeParse({
        evento_id: 7,
        problemas: [problema],
      }).success,
    ).toBe(true);
    const { ocorrencias: _ocorrencias, ...semContagem } = problema;
    expect(_ocorrencias).toBe(1);
    expect(
      detalhesErroWebhookSchema.safeParse({
        evento_id: 7,
        problemas: [semContagem],
      }).success,
    ).toBe(false);
  });

  it("webhook: a resposta 200 nunca é erro_validacao", () => {
    expect(
      respostaWebhookRifeiSchema.safeParse({
        resultado: "duplicado",
        evento_id: 5,
      }).success,
    ).toBe(true);
    expect(
      respostaWebhookRifeiSchema.safeParse({
        resultado: "erro_validacao",
        evento_id: 5,
      }).success,
    ).toBe(false);
  });

  it("painel: escopos rede, discipulador e célula exigem id; divisão exige a divisão", () => {
    expect(consultaPainelResumoSchema.parse({})).toEqual({
      escopo: "campanha",
    });
    expect(
      consultaPainelResumoSchema.parse({ escopo: "celula", id: "3" }),
    ).toEqual({
      escopo: "celula",
      id: 3,
    });
    expect(
      consultaPainelResumoSchema.safeParse({ escopo: "rede" }).success,
    ).toBe(false);
    expect(
      consultaPainelResumoSchema.safeParse({ escopo: "divisao" }).success,
    ).toBe(false);
    expect(
      consultaPainelResumoSchema.safeParse({
        escopo: "divisao",
        divisao: "adultos",
      }).success,
    ).toBe(true);
  });

  it("ranking: padrão célula e período atual; níveis célula, discipulador e rede; data válida", () => {
    expect(consultaRankingSchema.parse({})).toEqual({
      nivel: "celula",
      periodo: "atual",
    });
    expect(
      consultaRankingSchema.parse({
        nivel: "rede",
        divisao: "jovens",
        periodo: "campanha",
        data: "2026-12-09",
      }),
    ).toEqual({
      nivel: "rede",
      divisao: "jovens",
      periodo: "campanha",
      data: "2026-12-09",
    });
    for (const consulta of [
      { nivel: "divisao" },
      { periodo: "semana" },
      { divisao: "kids" },
      { data: "2026-02-30" },
    ])
      expect(consultaRankingSchema.safeParse(consulta).success).toBe(false);
  });

  it("público: sem data (é sempre hoje); bumbo: data opcional", () => {
    expect(
      consultaRankingPublicoSchema.parse({
        nivel: "discipulador",
        data: "2026-12-01",
      }),
    ).toEqual({ nivel: "discipulador", periodo: "atual" });
    expect(consultaBumboSchema.parse({})).toEqual({});
    expect(consultaBumboSchema.parse({ data: "2026-12-08" })).toEqual({
      data: "2026-12-08",
    });
    expect(consultaBumboSchema.safeParse({ data: "08/12/2026" }).success).toBe(
      false,
    );
  });

  it("importação: corpo com o CSV e simular opcional", () => {
    expect(
      corpoImportarHierarquiaSchema.parse({ csv: "rede,divisao" }),
    ).toEqual({
      csv: "rede,divisao",
      simular: false,
    });
    expect(corpoImportarHierarquiaSchema.safeParse({ csv: "" }).success).toBe(
      false,
    );
  });

  it("importação: as colunas documentadas são as do schema da linha", () => {
    expect(Object.keys(linhaCsvHierarquiaSchema.shape).sort()).toEqual(
      [...COLUNAS_CSV_HIERARQUIA].sort(),
    );
  });

  it("importação: a linha do CSV normaliza espaços, divisão, número e vazios", () => {
    const linha = {
      rede: " Rede Jovem Norte ",
      divisao: "Jovens",
      rede_responsavel: "",
      discipulador: "Discipulador Ficticio",
      celula: "Célula Ficticia 01",
      qtd_pessoas: " 12 ",
      lider_nome: "Lider Ficticio",
      lider_email: " lider@example.com ",
      lider_telefone: "",
    };
    expect(linhaCsvHierarquiaSchema.parse(linha)).toEqual({
      rede: "Rede Jovem Norte",
      divisao: "jovens",
      rede_responsavel: null,
      discipulador: "Discipulador Ficticio",
      celula: "Célula Ficticia 01",
      qtd_pessoas: 12,
      lider_nome: "Lider Ficticio",
      lider_email: "lider@example.com",
      lider_telefone: null,
    });
    const semOpcionais = {
      rede: "R",
      divisao: "adultos",
      discipulador: "D",
      celula: "C",
      qtd_pessoas: "8",
      lider_nome: "L",
    };
    expect(linhaCsvHierarquiaSchema.parse(semOpcionais)).not.toHaveProperty(
      "lider_email",
    );
    for (const erro of [
      { qtd_pessoas: "12.5" },
      { qtd_pessoas: "0" },
      { divisao: "kids" },
      { lider_email: "sem-arroba" },
      { celula: " " },
    ]) {
      expect(
        linhaCsvHierarquiaSchema.safeParse({ ...semOpcionais, ...erro })
          .success,
      ).toBe(false);
    }
  });
  it("csv_invalido: detalhes dizem o motivo (sem cabeçalho, colunas faltando, linhas demais)", () => {
    for (const detalhes of [
      { motivo: "sem_cabecalho" },
      { motivo: "colunas_faltando", colunas: ["qtd_pessoas", "lider_nome"] },
      { motivo: "linhas_demais", limite: 2000, total_linhas: 2500 },
    ]) {
      expect(detalhesCsvInvalidoSchema.safeParse(detalhes).success).toBe(true);
    }
    for (const detalhes of [
      { motivo: "colunas_faltando", colunas: [] },
      { motivo: "outro" },
      { motivo: "linhas_demais", limite: 2000 },
    ]) {
      expect(detalhesCsvInvalidoSchema.safeParse(detalhes).success).toBe(false);
    }
  });

  it("csv_invalido: também arquivo grande, coluna repetida, aspas abertas e codificação", () => {
    for (const detalhes of [
      {
        motivo: "arquivo_grande",
        limite_caracteres: LIMITE_CARACTERES_CSV_HIERARQUIA,
      },
      { motivo: "coluna_repetida", coluna: "rede" },
      { motivo: "aspas_abertas", linha: 7 },
      { motivo: "codificacao_invalida", linha: 2 },
    ]) {
      expect(detalhesCsvInvalidoSchema.safeParse(detalhes).success).toBe(true);
    }
    for (const detalhes of [
      { motivo: "arquivo_grande" },
      { motivo: "coluna_repetida", coluna: "" },
      { motivo: "aspas_abertas", linha: 0 },
      { motivo: "codificacao_invalida" },
    ]) {
      expect(detalhesCsvInvalidoSchema.safeParse(detalhes).success).toBe(false);
    }
    expect(
      corpoImportarHierarquiaSchema.safeParse({
        csv: "x".repeat(LIMITE_CARACTERES_CSV_HIERARQUIA + 1),
      }).success,
    ).toBe(false);
  });

  it("nomes: espaços em sequência (inclusive tab e espaço não separável) viram um só", () => {
    expect(normalizarEspacos("  Rede \t\u00A0 Jovem\r\n ")).toBe("Rede Jovem");
    const linha = linhaCsvHierarquiaSchema.parse({
      rede: "Rede  Jovem",
      divisao: " jovens ",
      rede_responsavel: "\u00A0",
      discipulador: "Discipulador\tA",
      celula: " Célula \u00A0 01 ",
      qtd_pessoas: " 12 ",
      lider_nome: "Líder   Um",
      lider_telefone: "(91)  90000-0001",
    });
    expect(linha).toEqual({
      rede: "Rede Jovem",
      divisao: "jovens",
      rede_responsavel: null,
      discipulador: "Discipulador A",
      celula: "Célula 01",
      qtd_pessoas: 12,
      lider_nome: "Líder Um",
      lider_telefone: "(91) 90000-0001",
    });
  });

  it("importação: a resposta sempre traz avisos (lista, possivelmente vazia)", () => {
    const resposta = {
      aplicado: true,
      simulado: false,
      total_linhas: 2,
      criados: { redes: 1, discipuladores: 1, celulas: 1 },
      atualizados: { redes: 0, discipuladores: 0, celulas: 0 },
      inalterados: { redes: 0, discipuladores: 0, celulas: 0 },
      erros: [],
      avisos: [
        {
          tipo: "linha_repetida",
          linha: 3,
          mensagem: "Linha igual à linha 2: foi ignorada",
        },
        { tipo: "coluna_ignorada", linha: 1, mensagem: "Coluna ignorada" },
      ],
    };
    expect(respostaImportarHierarquiaSchema.safeParse(resposta).success).toBe(
      true,
    );
    expect(
      respostaImportarHierarquiaSchema.safeParse({ ...resposta, avisos: [] })
        .success,
    ).toBe(true);
    const semAvisos: Record<string, unknown> = { ...resposta };
    delete semAvisos.avisos;
    expect(respostaImportarHierarquiaSchema.safeParse(semAvisos).success).toBe(
      false,
    );
    for (const aviso of [
      { tipo: "outro", linha: 2, mensagem: "x" },
      { tipo: "linha_repetida", linha: 0, mensagem: "x" },
      { tipo: "coluna_ignorada", linha: 1, mensagem: "" },
    ]) {
      expect(avisoImportacaoSchema.safeParse(aviso).success).toBe(false);
    }
  });
});

describe("RIFA-014 (D12): visão individual sem dinheiro e com o alvo só da sessão", () => {
  const referencia = {
    data: "2026-11-25",
    fase: "durante",
    data_inicio: "2026-11-23",
    data_fim: "2026-12-16",
    duracao_dias: 24,
    dia_campanha: 3,
    dias_restantes: 22,
    dias_para_inicio: null,
    periodo: {
      ordem: 1,
      nome: "Semana 1",
      data_inicio: "2026-11-23",
      data_fim: "2026-12-02",
      dias: 10,
      dia_no_periodo: 3,
      dias_restantes: 8,
    },
  };
  const ritmo = {
    meta: 40,
    esperado: 8,
    realizado: 9,
    diferenca: 1,
    situacao: "em_dia",
    percentual_meta_bp: 2250,
    percentual_esperado_bp: 2000,
  };
  const desempenho = {
    hoje: {
      data: "2026-11-25",
      meta: 4,
      realizado: 1,
      falta: 3,
      percentual_meta_bp: 2500,
      batida: false,
    },
    periodo: ritmo,
    campanha: {
      ...ritmo,
      meta: 120,
      percentual_meta_bp: 750,
      percentual_esperado_bp: 666,
      projecao_percentual_meta_bp: 9000,
    },
    bilhetes: { campanha: 9, hoje: 1 },
  };
  const semQuantidade = {
    meta: null,
    esperado: null,
    realizado: null,
    diferenca: null,
  };
  /** O mesmo desempenho com meta em centavos: só os percentuais. */
  const desempenhoEmCentavos = {
    ...desempenho,
    hoje: { ...desempenho.hoje, meta: null, realizado: null, falta: null },
    periodo: { ...ritmo, ...semQuantidade },
    campanha: { ...desempenho.campanha, ...semQuantidade },
  };
  const celulaDaEquipe = {
    tipo: "celula",
    id: 101,
    nome: "Célula Esperança",
    discipulador_id: 11,
    lider_nome: "Lucas Líder",
    afiliados_vinculados: 1,
    desempenho,
    posicao_divisao: 3,
  };
  const ranking = {
    nivel: "discipulador",
    janela: {
      tipo: "atual",
      ordem: 1,
      nome: "Semana 1",
      data_inicio: "2026-11-23",
      data_fim: "2026-12-02",
    },
    criterio: "percentual_meta",
    geral: {
      posicao: 2,
      participantes: 12,
      acima: { nome: "Bruno Discipulador", posicao: 1, diferenca: null },
      abaixo: { nome: "Carla Discipuladora", posicao: 3, diferenca: null },
    },
    divisao: { posicao: 1, participantes: 6, acima: null, abaixo: null },
    primeiros: [{ posicao: 1, nome: "Ana Discipuladora", eu: true }],
  };
  /** Um ponto por dia (24); hoje é o dia 3, e o ponto de hoje é o % da meta da campanha (750). */
  const curva = Array.from({ length: 24 }, (_, indice) => ({
    dia: indice + 1,
    data: new Date(Date.UTC(2026, 10, 23 + indice)).toISOString().slice(0, 10),
    esperado_bp: (indice + 1) * 300,
    realizado_bp: [250, 700, 750][indice] ?? null,
  }));
  /** Visão do discipulador 11, com a célula 101 na equipe. */
  const visao = {
    alvo: {
      tipo: "discipulador",
      id: 11,
      nome: "Ana Discipuladora",
      divisao: "jovens",
    },
    pessoa: "Ana Discipuladora",
    referencia,
    unidade: "bilhetes",
    desempenho,
    afiliados_vinculados: null,
    curva,
    ranking,
    equipe: [celulaDaEquipe],
    atualizado_em: "2026-11-25T15:00:00.000Z",
  };
  const visaoDoLider = {
    ...visao,
    alvo: {
      tipo: "celula",
      id: 101,
      nome: "Célula Esperança",
      divisao: "jovens",
    },
    pessoa: "Lucas Líder",
    afiliados_vinculados: 1,
    ranking: { ...ranking, nivel: "celula" },
    equipe: [],
  };
  const visaoDaRede = {
    ...visao,
    alvo: { tipo: "rede", id: 1, nome: "Rede Jovem Norte", divisao: "jovens" },
    pessoa: "Pastor Fictício",
    ranking: { ...ranking, nivel: "rede" },
    equipe: [
      {
        ...celulaDaEquipe,
        tipo: "discipulador",
        id: 11,
        nome: "Ana Discipuladora",
        discipulador_id: null,
        lider_nome: null,
        afiliados_vinculados: null,
        posicao_divisao: 1,
      },
      celulaDaEquipe,
    ],
  };
  const valida = (resposta: unknown) =>
    respostaVisaoIndividualSchema.safeParse(resposta).success;

  it("nenhum campo da resposta fala de dinheiro, e os campos são os de uma lista fechada", () => {
    const DINHEIRO = /centavos|reais|preco|arrecad|valor|total|vendas/i;
    const campos = nomesDeCampos(respostaVisaoIndividualSchema);
    expect(campos.filter((campo) => DINHEIRO.test(campo))).toEqual([]);
    expect([...new Set(campos)].sort()).toEqual(
      [
        "abaixo",
        "acima",
        "afiliados_vinculados",
        "alvo",
        "atualizado_em",
        "batida",
        "bilhetes",
        "campanha",
        "criterio",
        "curva",
        "data",
        "data_fim",
        "data_inicio",
        "desempenho",
        "dia",
        "dia_campanha",
        "dia_no_periodo",
        "dias",
        "dias_para_inicio",
        "dias_restantes",
        "diferenca",
        "discipulador_id",
        "divisao",
        "duracao_dias",
        "equipe",
        "esperado",
        "esperado_bp",
        "eu",
        "falta",
        "fase",
        "geral",
        "hoje",
        "id",
        "janela",
        "lider_nome",
        "meta",
        "nivel",
        "nome",
        "ordem",
        "participantes",
        "percentual_esperado_bp",
        "percentual_meta_bp",
        "periodo",
        "pessoa",
        "posicao",
        "posicao_divisao",
        "primeiros",
        "projecao_percentual_meta_bp",
        "ranking",
        "realizado",
        "realizado_bp",
        "referencia",
        "situacao",
        "tipo",
        "unidade",
      ].sort(),
    );
  });

  it("a rota não recebe id: sem parâmetros nem corpo, e a consulta só tem o período (o resto é descartado)", () => {
    const rota = ROTAS.visaoIndividual;
    expect(rota.grupo).toBe("hierarquia");
    expect(rota.papeis).toEqual([...PAPEIS_HIERARQUIA]);
    expect("parametros" in rota).toBe(false);
    expect("corpo" in rota).toBe(false);
    expect(Object.keys(consultaVisaoIndividualSchema.shape)).toEqual([
      "periodo",
    ]);
    expect(
      consultaVisaoIndividualSchema.parse({ id: "7", celula_id: "3" }),
    ).toEqual({ periodo: "atual" });
    expect(
      consultaVisaoIndividualSchema.safeParse({ periodo: "semana" }).success,
    ).toBe(false);
  });

  it("aceita as visões do líder, do discipulador e da rede, com meta em bilhetes ou em centavos", () => {
    expect(valida(visaoDoLider)).toBe(true);
    expect(valida(visao)).toBe(true);
    expect(valida(visaoDaRede)).toBe(true);
    expect(
      valida({
        ...visao,
        unidade: "centavos",
        desempenho: desempenhoEmCentavos,
        ranking: { ...ranking, criterio: "arrecadacao" },
        equipe: [{ ...celulaDaEquipe, desempenho: desempenhoEmCentavos }],
      }),
    ).toBe(true);
  });

  it("discipulador sem células: fora do ranking (posições null, R8) e sem equipe", () => {
    expect(
      valida({
        ...visao,
        ranking: { ...ranking, geral: null, divisao: null, primeiros: [] },
        equipe: [],
      }),
    ).toBe(true);
    expect(
      valida({
        ...visaoDaRede,
        equipe: [{ ...visaoDaRede.equipe[0], posicao_divisao: null }],
      }),
    ).toBe(true);
  });

  it("meta em centavos ou critério arrecadação: recusa qualquer quantidade que seria dinheiro", () => {
    const emCentavos = { ...visao, unidade: "centavos" };
    expect(
      valida({
        ...emCentavos,
        equipe: [{ ...celulaDaEquipe, desempenho: desempenhoEmCentavos }],
      }),
    ).toBe(false);
    expect(valida({ ...emCentavos, desempenho: desempenhoEmCentavos })).toBe(
      false,
    );
    for (const janela of ["hoje", "periodo", "campanha"] as const)
      expect(
        valida({
          ...emCentavos,
          desempenho: {
            ...desempenhoEmCentavos,
            [janela]: { ...desempenhoEmCentavos[janela], meta: 240000 },
          },
          equipe: [{ ...celulaDaEquipe, desempenho: desempenhoEmCentavos }],
        }),
      ).toBe(false);
    expect(
      valida({
        ...visao,
        ranking: {
          ...ranking,
          criterio: "arrecadacao",
          geral: {
            ...ranking.geral,
            acima: { ...ranking.geral.acima, diferenca: 35000 },
          },
        },
      }),
    ).toBe(false);
  });

  it("a equipe é só de quem está abaixo do alvo, e o resto da visão combina com o alvo", () => {
    const invalidas: unknown[] = [
      { ...visaoDoLider, equipe: [celulaDaEquipe] },
      { ...visaoDoLider, afiliados_vinculados: null },
      { ...visao, afiliados_vinculados: 2 },
      { ...visao, equipe: [{ ...celulaDaEquipe, discipulador_id: 12 }] },
      { ...visao, equipe: [visaoDaRede.equipe[0]] },
      {
        ...visaoDaRede,
        equipe: [
          visaoDaRede.equipe[0],
          { ...celulaDaEquipe, discipulador_id: 12 },
        ],
      },
      { ...visao, equipe: [{ ...celulaDaEquipe, lider_nome: null }] },
      {
        ...visaoDaRede,
        equipe: [{ ...visaoDaRede.equipe[0], afiliados_vinculados: 0 }],
      },
      { ...visao, ranking: { ...ranking, nivel: "celula" } },
      {
        ...visao,
        ranking: {
          ...ranking,
          primeiros: [
            { posicao: 1, nome: "Ana Discipuladora", eu: true },
            { posicao: 1, nome: "Outra", eu: true },
          ],
        },
      },
      {
        ...visao,
        desempenho: { ...desempenho, hoje: null },
      },
      {
        ...visao,
        curva: curva.map((ponto) =>
          ponto.dia === 24 ? { ...ponto, esperado_bp: 10_001 } : ponto,
        ),
      },
    ];
    for (const resposta of invalidas)
      expect({ resposta, ok: valida(resposta) }).toEqual({
        resposta,
        ok: false,
      });
  });

  it("recusa campo a mais em TODO objeto da resposta (schemas estritos em todos os níveis)", () => {
    const caminhos: (string | number)[][] = [];
    const visitar = (no: unknown, caminho: (string | number)[]) => {
      if (Array.isArray(no)) {
        no.forEach((item, indice) => visitar(item, [...caminho, indice]));
        return;
      }
      if (typeof no !== "object" || no === null) return;
      caminhos.push(caminho);
      for (const [chave, valor] of Object.entries(no))
        visitar(valor, [...caminho, chave]);
    };
    visitar(visaoDaRede, []);
    expect(caminhos.length).toBeGreaterThan(30);
    for (const caminho of caminhos) {
      const copia: unknown = structuredClone(visaoDaRede);
      let alvo = copia as Record<string | number, unknown>;
      for (const parte of caminho)
        alvo = alvo[parte] as Record<string | number, unknown>;
      alvo.total_centavos = 1;
      expect({ caminho, ok: valida(copia) }).toEqual({ caminho, ok: false });
    }
  });

  it("meta em centavos: cada quantidade de cada janela, no alvo e na equipe, é recusada (e a lista acompanha o schema)", () => {
    const QUANTIDADES = {
      hoje: ["falta", "meta", "realizado"],
      periodo: ["diferenca", "esperado", "meta", "realizado"],
      campanha: ["diferenca", "esperado", "meta", "realizado"],
    } as const;
    const naUnidadeDaMeta = (schema: z.ZodObject) =>
      Object.keys(schema.shape)
        .filter((campo) => !/_bp$|^(situacao|batida|data)$/.test(campo))
        .sort();
    const janelas = desempenhoIndividualSchema.shape;
    expect(naUnidadeDaMeta(janelas.hoje.unwrap())).toEqual(QUANTIDADES.hoje);
    expect(naUnidadeDaMeta(janelas.periodo.unwrap())).toEqual(
      QUANTIDADES.periodo,
    );
    expect(naUnidadeDaMeta(janelas.campanha)).toEqual(QUANTIDADES.campanha);
    const base = {
      ...visao,
      unidade: "centavos",
      desempenho: desempenhoEmCentavos,
      equipe: [{ ...celulaDaEquipe, desempenho: desempenhoEmCentavos }],
    };
    expect(valida(base)).toBe(true);
    for (const janela of ["hoje", "periodo", "campanha"] as const)
      for (const campo of QUANTIDADES[janela]) {
        const comValor = {
          ...desempenhoEmCentavos,
          [janela]: { ...desempenhoEmCentavos[janela], [campo]: 6000 },
        };
        expect({
          janela,
          campo,
          ok: valida({ ...base, desempenho: comValor }),
        }).toEqual({
          janela,
          campo,
          ok: false,
        });
        expect({
          janela,
          campo,
          naEquipe: true,
          ok: valida({
            ...base,
            equipe: [{ ...celulaDaEquipe, desempenho: comValor }],
          }),
        }).toEqual({ janela, campo, naEquipe: true, ok: false });
      }
  });

  it("distância até os vizinhos: null nos dois rankings e nos dois vizinhos, em qualquer critério (D12; na arrecadação, sempre)", () => {
    const posicao = {
      posicao: 2,
      participantes: 12,
      acima: { nome: "Vizinho de cima", posicao: 1, diferenca: null },
      abaixo: { nome: "Vizinho de baixo", posicao: 3, diferenca: null },
    };
    for (const criterio of ["arrecadacao", "bilhetes", "percentual_meta"])
      for (const escopo of ["geral", "divisao"] as const)
        for (const lado of ["acima", "abaixo"] as const) {
          const ok = (diferenca: number | null) =>
            valida({
              ...visao,
              ranking: {
                ...ranking,
                criterio,
                [escopo]: {
                  ...posicao,
                  [lado]: { ...posicao[lado], diferenca },
                },
              },
            });
          expect({ criterio, escopo, lado, ok: ok(null) }).toEqual({
            criterio,
            escopo,
            lado,
            ok: true,
          });
          expect({ criterio, escopo, lado, ok: ok(35000) }).toEqual({
            criterio,
            escopo,
            lado,
            ok: false,
          });
        }
  });

  it("dos pares, só nome e posição (e a distância); a curva, só pontos-base", () => {
    expect(Object.keys(vizinhoIndividualSchema.shape).sort()).toEqual([
      "diferenca",
      "nome",
      "posicao",
    ]);
    expect(
      Object.keys(rankingIndividualSchema.shape.primeiros.element.shape).sort(),
    ).toEqual(["eu", "nome", "posicao"]);
    expect(Object.keys(pontoCurvaIndividualSchema.shape).sort()).toEqual([
      "data",
      "dia",
      "esperado_bp",
      "realizado_bp",
    ]);
  });

  it("aceita a visão antes do início e depois do fim (sem hoje, sem período e sem bilhetes de hoje)", () => {
    const foraDaCampanha = {
      ...desempenho,
      hoje: null,
      periodo: null,
      bilhetes: { campanha: 0, hoje: null },
      campanha: {
        ...desempenho.campanha,
        esperado: 0,
        realizado: 0,
        diferenca: 0,
        percentual_meta_bp: 0,
        percentual_esperado_bp: 0,
        projecao_percentual_meta_bp: null,
      },
    };
    const antes = {
      ...visao,
      referencia: {
        ...referencia,
        data: "2026-11-15",
        fase: "antes",
        dia_campanha: null,
        dias_restantes: 24,
        dias_para_inicio: 8,
        periodo: null,
      },
      desempenho: foraDaCampanha,
      curva: visao.curva.map((ponto) => ({ ...ponto, realizado_bp: null })),
      ranking: { ...ranking, primeiros: [] },
      equipe: [{ ...celulaDaEquipe, desempenho: foraDaCampanha }],
    };
    expect(valida(antes)).toBe(true);
    expect(
      valida({
        ...antes,
        referencia: {
          ...antes.referencia,
          data: "2026-12-20",
          fase: "encerrada",
          dias_restantes: 0,
          dias_para_inicio: null,
        },
        curva: visao.curva.map((ponto) => ({ ...ponto, realizado_bp: 0 })),
      }),
    ).toBe(true);
  });

  it("ranking e curva coerentes: fora do ranking nos dois juntos, célula sempre no ranking, curva até hoje e o ponto de hoje igual ao % da campanha", () => {
    const semMeta = {
      ...desempenho,
      campanha: {
        ...desempenho.campanha,
        meta: 0,
        situacao: "sem_meta",
        percentual_meta_bp: null,
        percentual_esperado_bp: null,
      },
    };
    expect(valida({ ...visao, desempenho: semMeta, curva: [] })).toBe(true);
    const invalidas: unknown[] = [
      { ...visao, ranking: { ...ranking, geral: null } },
      { ...visao, ranking: { ...ranking, divisao: null } },
      { ...visao, equipe: [{ ...celulaDaEquipe, posicao_divisao: null }] },
      { ...visao, desempenho: semMeta },
      { ...visao, curva: curva.slice(0, 23) },
      {
        ...visao,
        curva: curva.map((ponto) =>
          ponto.dia === 4 ? { ...ponto, realizado_bp: 800 } : ponto,
        ),
      },
      {
        ...visao,
        curva: curva.map((ponto) =>
          ponto.dia === 2 ? { ...ponto, realizado_bp: null } : ponto,
        ),
      },
      {
        ...visao,
        curva: curva.map((ponto) =>
          ponto.dia === 3 ? { ...ponto, realizado_bp: 749 } : ponto,
        ),
      },
    ];
    for (const resposta of invalidas)
      expect({ resposta, ok: valida(resposta) }).toEqual({
        resposta,
        ok: false,
      });
  });

  it("curva: vazia sem meta (mesmo antes do início), dias de 1 a N com as datas da campanha e, depois do fim, o último ponto igual ao % da campanha", () => {
    const foraDaCampanha = {
      ...desempenho,
      hoje: null,
      periodo: null,
      bilhetes: { campanha: 0, hoje: null },
    };
    const antes = {
      ...visao,
      referencia: {
        ...referencia,
        data: "2026-11-15",
        fase: "antes",
        dia_campanha: null,
        dias_restantes: 24,
        dias_para_inicio: 8,
        periodo: null,
      },
      curva: curva.map((ponto) => ({ ...ponto, realizado_bp: null })),
      ranking: { ...ranking, primeiros: [] },
      equipe: [],
    };
    const semMeta = {
      ...foraDaCampanha,
      campanha: {
        ...desempenho.campanha,
        meta: 0,
        situacao: "sem_meta",
        percentual_meta_bp: null,
        percentual_esperado_bp: null,
      },
    };
    expect(valida({ ...antes, desempenho: semMeta, curva: [] })).toBe(true);
    expect(valida({ ...antes, desempenho: semMeta })).toBe(false);
    const encerrada = {
      ...antes,
      referencia: {
        ...antes.referencia,
        data: "2026-12-17",
        fase: "encerrada",
        dias_restantes: 0,
        dias_para_inicio: null,
      },
      desempenho: {
        ...foraDaCampanha,
        campanha: { ...desempenho.campanha, percentual_meta_bp: 4083 },
      },
      curva: curva.map((ponto) => ({ ...ponto, realizado_bp: 4083 })),
    };
    expect(valida(encerrada)).toBe(true);
    const invalidas: unknown[] = [
      {
        ...encerrada,
        curva: encerrada.curva.map((ponto) =>
          ponto.dia === 24 ? { ...ponto, realizado_bp: 4082 } : ponto,
        ),
      },
      {
        ...visao,
        curva: curva.map((ponto) =>
          ponto.dia === 5 ? { ...ponto, dia: 6 } : ponto,
        ),
      },
      {
        ...visao,
        curva: curva.map((ponto) =>
          ponto.dia === 5 ? { ...ponto, data: "2026-11-28" } : ponto,
        ),
      },
    ];
    for (const resposta of invalidas)
      expect({ resposta, ok: valida(resposta) }).toEqual({
        resposta,
        ok: false,
      });
  });
});
