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
  type SituacaoRota,
} from "./api";
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
        "GET /api/painel/resumo",
        "GET /api/painel/ranking",
        "GET /api/publico/ranking",
        "GET /api/publico/bumbo",
        // Sprint 4 (RIFA-012): conferência pelo CSV da Rifei.
        "POST /api/admin/reconciliacao/analisar",
        "POST /api/admin/reconciliacao/recuperar",
        "GET /api/admin/reconciliacao/recuperacoes",
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
