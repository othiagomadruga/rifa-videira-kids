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
  ROTAS_LINK_VENDAS,
  PAGINA_QUEM_COMPROU_PADRAO,
  ROTAS_MAIORES_COMPRADORES,
  ROTAS_QUEM_COMPROU,
  TIPO_ALVO_DO_PAPEL,
  consultaMaioresCompradoresSchema,
  consultaQuemComprouSchema,
  ROTAS_TODAS_AS_REDES,
  consultaTodasAsRedesSchema,
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
import { CAMINHO_MEUS_LINKS_VENDAS } from "./links-vendas-api";
import {
  CAMINHO_MEUS_MAIORES_COMPRADORES,
  caminhoDosMeusMaioresCompradores,
} from "./maiores-compradores-api";
import { CAMINHO_VISAO, caminhoDaVisao, periodoDaFase } from "./minha-api";
import {
  CAMINHO_QUEM_COMPROU,
  VENDAS_POR_PAGINA,
  caminhoDeQuemComprou,
} from "./quem-comprou-api";
import {
  CAMINHO_TODAS_AS_REDES,
  caminhoDeTodasAsRedes,
} from "./todas-as-redes-api";
import {
  SESSOES,
  meusLinksDe,
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

  it("o link de vendas (RIFA-046): caminho, grupo e papéis da rota", () => {
    expect(CAMINHO_MEUS_LINKS_VENDAS).toBe(
      ROTAS_LINK_VENDAS.meusLinksVendas.caminho,
    );
    expect(ROTAS_LINK_VENDAS.meusLinksVendas.metodo).toBe("GET");
    expect(ROTAS_LINK_VENDAS.meusLinksVendas.grupo).toBe("hierarquia");
    expect([...ROTAS_LINK_VENDAS.meusLinksVendas.papeis].sort()).toEqual(
      [...PAPEIS_DA_HIERARQUIA].sort(),
    );
  });

  it("os maiores compradores (RIFA-083): caminho, grupo, só o discipulador, e a consulta passa no schema", () => {
    const rota = ROTAS_MAIORES_COMPRADORES.meusMaioresCompradores;
    expect(CAMINHO_MEUS_MAIORES_COMPRADORES).toBe(rota.caminho);
    expect(rota.metodo).toBe("GET");
    expect(rota.grupo).toBe("hierarquia");
    expect(rota.papeis).toEqual(["discipulador"]);
    for (const janela of ["atual", "campanha"] as const) {
      const url = new URL(
        caminhoDosMeusMaioresCompradores(janela),
        "https://site.example",
      );
      expect(url.pathname).toBe(CAMINHO_MEUS_MAIORES_COMPRADORES);
      expect(
        consultaMaioresCompradoresSchema.parse(
          Object.fromEntries(url.searchParams),
        ),
      ).toEqual({ janela, limite: 10 });
    }
  });

  it("quem comprou (RIFA-089): caminho, grupo, só o líder, o tamanho da página e a consulta passa no schema", () => {
    const rota = ROTAS_QUEM_COMPROU.quemComprou;
    expect(CAMINHO_QUEM_COMPROU).toBe(rota.caminho);
    expect(rota.metodo).toBe("GET");
    expect(rota.grupo).toBe("hierarquia");
    expect(rota.papeis).toEqual(["lider"]);
    expect(VENDAS_POR_PAGINA).toBe(PAGINA_QUEM_COMPROU_PADRAO);
    for (const antesDe of [null, "abc_-1"]) {
      const url = new URL(
        caminhoDeQuemComprou(antesDe),
        "https://site.example",
      );
      expect(url.pathname).toBe(CAMINHO_QUEM_COMPROU);
      expect(
        consultaQuemComprouSchema.parse(Object.fromEntries(url.searchParams)),
      ).toEqual({
        limite: PAGINA_QUEM_COMPROU_PADRAO,
        ...(antesDe === null ? {} : { antes_de: antesDe }),
      });
    }
  });

  it("o ranking geral (RIFA-090): caminho, grupo, discipulador e rede, e a consulta passa no schema", () => {
    const rota = ROTAS_TODAS_AS_REDES.todasAsRedes;
    expect(CAMINHO_TODAS_AS_REDES).toBe(rota.caminho);
    expect(rota.metodo).toBe("GET");
    expect(rota.grupo).toBe("hierarquia");
    expect(rota.papeis).toEqual(["discipulador", "rede"]);
    for (const janela of ["atual", "campanha"] as const) {
      const url = new URL(
        caminhoDeTodasAsRedes(janela),
        "https://site.example",
      );
      expect(url.pathname).toBe(CAMINHO_TODAS_AS_REDES);
      expect(
        consultaTodasAsRedesSchema.parse(Object.fromEntries(url.searchParams)),
      ).toEqual({ janela });
    }
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

  it("os links de vendas de cada alvo passam no schema (escopo do papel, configurado ou não, vários códigos)", () => {
    for (const cenario of todosOsCenarios()) {
      const { alvo } = visaoDe(cenario[1]);
      for (const configurado of [true, false]) {
        const links = meusLinksDe(alvo, { configurado });
        expect(links.alvo).toEqual(alvo);
        if (alvo.tipo === "celula") expect(links.itens).toHaveLength(1);
      }
    }
    expect(
      meusLinksDe(SESSOES.lider.alvo!, { afiliadosDoLider: [1077, 1042] })
        .itens[0].links,
    ).toHaveLength(2);
    expect(meusLinksDe(SESSOES.rede.alvo!).itens).toHaveLength(4);
    expect(meusLinksDe(SESSOES.discipulador.alvo!).itens).toHaveLength(3);
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
