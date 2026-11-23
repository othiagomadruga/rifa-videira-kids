// Contrato do grupo do discipulador e do ranking por grupo (RIFA-084, D39): a entrada e a saída do discipulador com o
// grupo, a lista dos grupos e o ranking por grupo da coordenação (só atrás do login: o ranking aberto não muda). E o
// grupo próprio da célula (RIFA-085, adendo da D39), que vale no lugar do grupo do discipulador.
import { describe, expect, it } from "vitest";
import {
  LIMITE_NOME_GRUPO,
  NIVEIS_RANKING_GRUPOS,
  ROTAS,
  celulaEntradaSchema,
  celulaSchema,
  consultaRankingGruposSchema,
  discipuladorEntradaSchema,
  discipuladorSchema,
  grupoSchema,
  respostaListaGruposSchema,
  respostaRankingGruposSchema,
} from "./index";

const INSTANTE = "2026-11-23T12:00:00.000Z";

const discipulador = {
  id: 7,
  rede_id: 1,
  nome: "Discipulador Ficticio",
  rede_nome: "Rede Ficticia",
  divisao: "adultos",
  grupo_id: 2,
  grupo_nome: "Adultos da noite",
  criado_em: INSTANTE,
  atualizado_em: INSTANTE,
} as const;

const itemRanking = {
  posicao: 1,
  id: 3,
  nome: "Célula Ficticia",
  divisao: "adultos",
  discipulador: { id: 7, nome: "Discipulador Ficticio" },
  rede: { id: 1, nome: "Rede Ficticia" },
  meta: 100,
  esperado: 10,
  realizado: 20,
  diferenca: 10,
  situacao: "em_dia",
  percentual_meta_bp: 2000,
  vendas: { pedidos_aprovados: 2, bilhetes: 20, total_centavos: 40_000 },
  acima: null,
  abaixo: null,
} as const;

const resposta = {
  nivel: "celula",
  janela: {
    tipo: "atual",
    ordem: 1,
    nome: "Semana 1",
    data_inicio: "2026-11-23",
    data_fim: "2026-11-29",
  },
  criterio: "percentual_meta",
  unidade: "bilhetes",
  referencia: {
    data: "2026-11-23",
    fase: "durante",
    data_inicio: "2026-11-23",
    data_fim: "2026-12-13",
    duracao_dias: 21,
    dia_campanha: 1,
    dias_restantes: 21,
    dias_para_inicio: null,
    periodo: {
      ordem: 1,
      nome: "Semana 1",
      data_inicio: "2026-11-23",
      data_fim: "2026-11-29",
      dias: 7,
      dia_no_periodo: 1,
      dias_restantes: 7,
    },
  },
  grupos: [{ id: 2, nome: "Adultos da noite", ordem: 2, itens: [itemRanking] }],
  atualizado_em: INSTANTE,
} as const;

describe("RIFA-084 (D39): o grupo do discipulador", () => {
  it("a entrada aceita o grupo (id), null (sem grupo) e a ausência (POST: sem grupo; PUT: mantém)", () => {
    const base = { rede_id: 1, nome: "Discipulador Ficticio" };
    expect(discipuladorEntradaSchema.parse({ ...base, grupo_id: 3 })).toEqual({
      ...base,
      grupo_id: 3,
    });
    expect(
      discipuladorEntradaSchema.parse({ ...base, grupo_id: null }),
    ).toEqual({ ...base, grupo_id: null });
    expect(discipuladorEntradaSchema.parse(base)).not.toHaveProperty(
      "grupo_id",
    );
    for (const grupo_id of [0, -1, 1.5, "2", true])
      expect({
        grupo_id,
        ok: discipuladorEntradaSchema.safeParse({ ...base, grupo_id }).success,
      }).toEqual({ grupo_id, ok: false });
  });

  it("a saída traz o grupo e o nome dele, ou os dois null", () => {
    expect(discipuladorSchema.parse(discipulador)).toEqual(discipulador);
    expect(
      discipuladorSchema.safeParse({
        ...discipulador,
        grupo_id: null,
        grupo_nome: null,
      }).success,
    ).toBe(true);
    const semGrupo: Record<string, unknown> = { ...discipulador };
    delete semGrupo.grupo_id;
    expect(discipuladorSchema.safeParse(semGrupo).success).toBe(false);
  });

  it("a lista dos grupos: id, nome de 1 a 60 caracteres e a ordem", () => {
    const grupo = { id: 1, nome: "Adultos da manhã", ordem: 1 };
    expect(respostaListaGruposSchema.parse({ itens: [grupo] })).toEqual({
      itens: [grupo],
    });
    expect(LIMITE_NOME_GRUPO).toBe(60);
    for (const nome of ["", "x".repeat(61)])
      expect(grupoSchema.safeParse({ ...grupo, nome }).success).toBe(false);
    expect(grupoSchema.safeParse({ ...grupo, ordem: 1.5 }).success).toBe(false);
  });
});

describe("RIFA-084 (D39): o ranking por grupo, só da coordenação", () => {
  it("as rotas novas são da coordenação (admin e coordenacao), sem papel a mais; nenhuma rota aberta nova", () => {
    expect(ROTAS.painelRankingGrupos).toMatchObject({
      metodo: "GET",
      caminho: "/api/painel/ranking-grupos",
      grupo: "coordenacao",
    });
    expect(ROTAS.listarGrupos).toMatchObject({
      metodo: "GET",
      caminho: "/api/admin/grupos",
      grupo: "coordenacao",
    });
    expect("papeis" in ROTAS.painelRankingGrupos).toBe(false);
    expect("papeis" in ROTAS.listarGrupos).toBe(false);
    // Decisão do PO (23/11): o ranking aberto fica como está; nada de grupo nas rotas abertas.
    const abertas = Object.values(ROTAS)
      .filter((rota) => rota.grupo === "aberto")
      .map((rota) => rota.caminho);
    expect(abertas.filter((caminho) => caminho.includes("grupo"))).toEqual([]);
  });

  it("a consulta: janela atual (padrão) ou campanha; nível célula (padrão) ou discipulador; a rede não", () => {
    expect(consultaRankingGruposSchema.parse({})).toEqual({
      janela: "atual",
      nivel: "celula",
    });
    expect(
      consultaRankingGruposSchema.parse({
        janela: "campanha",
        nivel: "discipulador",
      }),
    ).toEqual({ janela: "campanha", nivel: "discipulador" });
    expect(NIVEIS_RANKING_GRUPOS).toEqual(["celula", "discipulador"]);
    for (const consulta of [
      { nivel: "rede" },
      { janela: "semana" },
      { janela: "" },
    ])
      expect(consultaRankingGruposSchema.safeParse(consulta).success).toBe(
        false,
      );
  });

  it("a resposta é estrita: o item completo do ranking em cada grupo e nenhum campo a mais", () => {
    expect(respostaRankingGruposSchema.parse(resposta)).toEqual(resposta);
    expect(
      respostaRankingGruposSchema.safeParse({ ...resposta, grupos: [] })
        .success,
    ).toBe(true);
    const quebradas = [
      { ...resposta, por_divisao: false },
      { ...resposta, nivel: "rede" },
      {
        ...resposta,
        grupos: [{ ...resposta.grupos[0], divisao: "adultos" }],
      },
      {
        ...resposta,
        grupos: [{ ...resposta.grupos[0], nome: "x".repeat(61) }],
      },
      {
        ...resposta,
        grupos: [
          {
            ...resposta.grupos[0],
            itens: [{ ...itemRanking, grupo: "Adultos da noite" }],
          },
        ],
      },
    ];
    for (const quebrada of quebradas)
      expect(respostaRankingGruposSchema.safeParse(quebrada).success).toBe(
        false,
      );
  });
});

describe("RIFA-085 (adendo da D39): o grupo próprio da célula", () => {
  const entrada = {
    discipulador_id: 7,
    nome: "Célula Ficticia",
    qtd_pessoas: 10,
    lider_nome: "Líder Ficticio",
  };
  const celula = {
    id: 3,
    discipulador_id: 7,
    nome: "Célula Ficticia",
    qtd_pessoas: 10,
    lider_nome: "Líder Ficticio",
    lider_email: null,
    lider_telefone: null,
    discipulador_nome: "Discipulador Ficticio",
    rede_id: 1,
    rede_nome: "Rede Ficticia",
    divisao: "jovens",
    grupo_id: 4,
    grupo_nome: "Adolescentes",
    grupo_efetivo_id: 4,
    grupo_efetivo_nome: "Adolescentes",
    criado_em: INSTANTE,
    atualizado_em: INSTANTE,
  } as const;

  it("a entrada aceita o grupo (id), null (herda o do discipulador) e a ausência (POST: herda; PUT: mantém)", () => {
    const comuns = { lider_email: null, lider_telefone: null };
    expect(celulaEntradaSchema.parse({ ...entrada, grupo_id: 4 })).toEqual({
      ...entrada,
      ...comuns,
      grupo_id: 4,
    });
    expect(celulaEntradaSchema.parse({ ...entrada, grupo_id: null })).toEqual({
      ...entrada,
      ...comuns,
      grupo_id: null,
    });
    expect(celulaEntradaSchema.parse(entrada)).not.toHaveProperty("grupo_id");
    for (const grupo_id of [0, -1, 1.5, "4", true])
      expect({
        grupo_id,
        ok: celulaEntradaSchema.safeParse({ ...entrada, grupo_id }).success,
      }).toEqual({ grupo_id, ok: false });
  });

  it("a saída traz o grupo próprio e o efetivo (o próprio, o do discipulador ou null), com os nomes", () => {
    expect(celulaSchema.parse(celula)).toEqual(celula);
    // Herda o do discipulador.
    expect(
      celulaSchema.safeParse({
        ...celula,
        grupo_id: null,
        grupo_nome: null,
        grupo_efetivo_id: 3,
        grupo_efetivo_nome: "Jovens",
      }).success,
    ).toBe(true);
    // Sem grupo nenhum.
    expect(
      celulaSchema.safeParse({
        ...celula,
        grupo_id: null,
        grupo_nome: null,
        grupo_efetivo_id: null,
        grupo_efetivo_nome: null,
      }).success,
    ).toBe(true);
    for (const campo of [
      "grupo_id",
      "grupo_nome",
      "grupo_efetivo_id",
      "grupo_efetivo_nome",
    ]) {
      const sem: Record<string, unknown> = { ...celula };
      delete sem[campo];
      expect({ campo, ok: celulaSchema.safeParse(sem).success }).toEqual({
        campo,
        ok: false,
      });
    }
    expect(
      celulaSchema.safeParse({ ...celula, grupo_nome: "x".repeat(61) }).success,
    ).toBe(false);
  });

  it("o PUT e o POST da célula usam a mesma entrada, e as rotas continuam só da coordenação", () => {
    expect(ROTAS.criarCelula.corpo).toBe(celulaEntradaSchema);
    expect(ROTAS.atualizarCelula.corpo).toBe(celulaEntradaSchema);
    expect(ROTAS.atualizarCelula.sucesso.corpo).toBe(celulaSchema);
    for (const rota of [ROTAS.criarCelula, ROTAS.atualizarCelula])
      expect(rota.grupo).toBe("coordenacao");
  });
});
