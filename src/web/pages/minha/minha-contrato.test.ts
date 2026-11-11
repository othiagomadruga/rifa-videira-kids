// A visão individual usa cópias de valores do contrato (importar os schemas ou o catálogo ROTAS poria o zod no
// pacote do site; veja minha-api.ts e lib/sessao.tsx): o caminho da rota e os papéis de cada área. Este teste
// garante que as cópias continuam iguais ao contrato, que a consulta montada pela tela passa no schema da rota
// e que as sessões e as respostas da API falsa dos testes também passam.
import { describe, expect, it } from "vitest";
import {
  PAPEIS,
  PAPEIS_COORDENACAO,
  PAPEIS_HIERARQUIA,
  ROTAS,
  TIPO_ALVO_DO_PAPEL,
  consultaVisaoIndividualSchema,
  respostaVisaoIndividualSchema,
  usuarioSessaoSchema,
} from "../../../shared/contracts";
import {
  INICIO_DA_AREA,
  PAPEIS_DA_HIERARQUIA,
  areaDoPapel,
  ehPapelDaHierarquia,
  inicioDoPapel,
} from "../../lib/sessao";
import { CAMINHO_VISAO, caminhoDaVisao, periodoDaFase } from "./minha-api";
import {
  SESSOES,
  sessaoDaVisao,
  todosOsCenarios,
  visaoDe,
} from "./teste-apoio";

describe("cópias do contrato na visão individual", () => {
  it("caminho, grupo e papéis da rota", () => {
    expect(CAMINHO_VISAO).toBe(ROTAS.visaoIndividual.caminho);
    expect(ROTAS.visaoIndividual.metodo).toBe("GET");
    expect(ROTAS.visaoIndividual.grupo).toBe("hierarquia");
    expect([...ROTAS.visaoIndividual.papeis].sort()).toEqual(
      [...PAPEIS_DA_HIERARQUIA].sort(),
    );
  });

  it("papéis da hierarquia (cópia) e a área de cada papel", () => {
    expect([...PAPEIS_DA_HIERARQUIA]).toEqual([...PAPEIS_HIERARQUIA]);
    for (const papel of PAPEIS) {
      const daHierarquia = (PAPEIS_HIERARQUIA as readonly string[]).includes(
        papel,
      );
      expect(ehPapelDaHierarquia(papel)).toBe(daHierarquia);
      expect(areaDoPapel(papel)).toBe(
        daHierarquia ? "hierarquia" : "coordenacao",
      );
    }
    for (const papel of PAPEIS_HIERARQUIA)
      expect(inicioDoPapel(papel)).toBe("/minha");
    for (const papel of PAPEIS_COORDENACAO)
      expect(inicioDoPapel(papel)).toBe("/coordenacao");
    expect(INICIO_DA_AREA).toEqual({
      coordenacao: "/coordenacao",
      hierarquia: "/minha",
    });
  });

  it.each(["atual", "campanha"] as const)(
    "a consulta periodo=%s passa no schema da rota",
    (periodo) => {
      const url = new URL(caminhoDaVisao(periodo), "https://site.example");
      expect(url.pathname).toBe(CAMINHO_VISAO);
      expect(
        consultaVisaoIndividualSchema.parse(
          Object.fromEntries(url.searchParams),
        ),
      ).toEqual({ periodo });
    },
  );

  it("a janela do ranking: o período atual antes e durante; a campanha depois do fim", () => {
    expect(periodoDaFase(null)).toBe("atual");
    expect(periodoDaFase("antes")).toBe("atual");
    expect(periodoDaFase("durante")).toBe("atual");
    expect(periodoDaFase("encerrada")).toBe("campanha");
  });
});

describe("a API falsa dos testes segue o contrato", () => {
  it("as sessões de líder, discipulador e rede passam no schema, com o alvo do papel", () => {
    for (const [papel, sessao] of Object.entries(SESSOES)) {
      expect(usuarioSessaoSchema.parse(sessao)).toEqual(sessao);
      expect(sessao.alvo?.tipo).toBe(
        TIPO_ALVO_DO_PAPEL[papel as keyof typeof TIPO_ALVO_DO_PAPEL],
      );
    }
  });

  it.each(todosOsCenarios())(
    "%s: a resposta e a sessão passam nos schemas",
    (_nome, cenario) => {
      const visao = visaoDe(cenario);
      expect(() => respostaVisaoIndividualSchema.parse(visao)).not.toThrow();
      expect(() =>
        usuarioSessaoSchema.parse(sessaoDaVisao(visao)),
      ).not.toThrow();
      expect(visao.unidade).toBe(cenario.unidade ?? "bilhetes");
    },
  );
});
