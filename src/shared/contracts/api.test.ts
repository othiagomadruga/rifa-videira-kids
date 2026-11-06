import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  COLUNAS_CSV_HIERARQUIA,
  ROTAS,
  consultaAfiliadosSchema,
  consultaPainelResumoSchema,
  corpoImportarHierarquiaSchema,
  corpoSalvarAfiliadoSchema,
  linhaCsvHierarquiaSchema,
  parametroAffiliateIdSchema,
  parametroIdSchema,
  respostaRankingPublicoSchema,
  respostaRankingSchema,
  respostaWebhookRifeiSchema,
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
  it("traz todas as rotas detalhadas das Sprints 1–2", () => {
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
      ].sort(),
    );
  });

  it("marca como rascunho exatamente as 5 rotas das Sprints 3–4", () => {
    const rascunhos = rotas
      .filter(([, rota]) => rota.situacao === "rascunho")
      .map(([, rota]) => `${rota.metodo} ${rota.caminho}`);
    expect(rascunhos.sort()).toEqual(
      [
        "GET /api/painel/resumo",
        "GET /api/painel/ranking",
        "GET /api/publico/ranking",
        "GET /api/publico/bumbo",
        "POST /api/admin/reconciliacao",
      ].sort(),
    );
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

  it("o ranking público é estrito: um valor a mais invalida a resposta", () => {
    const resposta = {
      nivel: "celula",
      divisao: null,
      janela: {
        tipo: "atual",
        ordem: 1,
        nome: "Semana 1",
        data_inicio: "2026-12-01",
        data_fim: "2026-12-10",
      },
      itens: [{ posicao: 1, nome: "Célula Ficticia 01", divisao: "jovens" }],
      atualizado_em: "2026-12-02T15:00:00.000Z",
    };
    expect(respostaRankingPublicoSchema.safeParse(resposta).success).toBe(true);
    const comValor = {
      ...resposta,
      itens: [{ ...resposta.itens[0], total_centavos: 6000 }],
    };
    expect(respostaRankingPublicoSchema.safeParse(comValor).success).toBe(
      false,
    );
  });

  it("o ranking da coordenação, ao contrário, traz os valores", () => {
    expect(nomesDeCampos(respostaRankingSchema)).toEqual(
      expect.arrayContaining(["total_centavos", "bilhetes"]),
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

  it("painel (rascunho): escopos rede, discipulador e célula exigem id; divisão exige a divisão", () => {
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
});
