// A Trilha usa cópias de valores do contrato (os valores de src/shared/contracts poriam o zod no pacote do site;
// veja trilha-api.ts). Este teste garante que as cópias continuam iguais ao contrato, que toda ação do contrato
// tem um texto em português e que a consulta que a tela monta passa pelo schema da rota.
import { describe, expect, it } from "vitest";
import {
  ACOES_AUDITORIA,
  PAGINA_AUDITORIA_MAXIMA,
  PAGINA_AUDITORIA_PADRAO,
  ROTAS,
  consultaAuditoriaSchema,
} from "../../../shared/contracts";
import { TELAS_COORDENACAO } from "../coordenacao/telas";
import { ROTULO_ACAO, rotuloDaAcao, textoDoAlvo } from "./textos";
import {
  CAMINHO_AUDITORIA,
  ITENS_POR_PAGINA,
  caminhoDaPagina,
} from "./trilha-api";

describe("cópias do contrato da trilha no site", () => {
  it("caminho e método da rota; a tela tem os mesmos papéis da rota (só admin)", () => {
    expect(ROTAS.auditoria).toMatchObject({
      metodo: "GET",
      caminho: CAMINHO_AUDITORIA,
      grupo: "coordenacao",
      papeis: ["admin"],
    });
    const tela = TELAS_COORDENACAO.find(
      ({ segmento }) => segmento === "trilha",
    );
    expect(tela?.papeis).toEqual(ROTAS.auditoria.papeis);
  });

  it("tamanho da página: o padrão da rota, dentro do máximo", () => {
    expect(ITENS_POR_PAGINA).toBe(PAGINA_AUDITORIA_PADRAO);
    expect(ITENS_POR_PAGINA).toBeLessThanOrEqual(PAGINA_AUDITORIA_MAXIMA);
  });

  it("as consultas da primeira página e das seguintes passam pelo schema da rota", () => {
    const consulta = (caminho: string) => {
      const url = new URL(caminho, "https://site.example");
      expect(url.pathname).toBe(CAMINHO_AUDITORIA);
      return consultaAuditoriaSchema.parse(
        Object.fromEntries(url.searchParams),
      );
    };
    expect(consulta(caminhoDaPagina(null))).toEqual({ limite: 50 });
    expect(consulta(caminhoDaPagina(42))).toEqual({
      limite: 50,
      antes_de: 42,
    });
  });
});

describe("toda ação do contrato tem rótulo", () => {
  it("um texto para cada ação de ACOES_AUDITORIA, nem a mais nem a menos", () => {
    expect(Object.keys(ROTULO_ACAO).sort()).toEqual(
      [...ACOES_AUDITORIA].sort(),
    );
  });

  it("textos em português, sem repetir e sem o código da API", () => {
    const textos = ACOES_AUDITORIA.map((acao) => rotuloDaAcao(acao));
    expect(new Set(textos).size).toBe(ACOES_AUDITORIA.length);
    for (const [acao, texto] of ACOES_AUDITORIA.map(
      (acao, i) => [acao, textos[i]] as const,
    )) {
      expect(texto, acao).toMatch(/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][^._]+$/);
      expect(texto, acao).not.toContain(acao);
    }
  });

  it("uma ação que o site ainda não conhece aparece como veio da API (nada some)", () => {
    expect(rotuloDaAcao("campanha.arquivar")).toBe("campanha.arquivar");
    expect(rotuloDaAcao("constructor")).toBe("constructor");
  });
});

describe("alvo legível", () => {
  it.each([
    ["campanha:1", "Campanha 1"],
    ["afiliado:1042", "Afiliado 1042"],
    ["hierarquia", "Hierarquia"],
    ["usuario:3", "Usuário 3"],
    ["link:12", "Link 12"],
    ["rede:2", "Rede 2"],
    ["discipulador:5", "Discipulador 5"],
    ["celula:7", "Célula 7"],
    ["papel:lider", "Papel: Líder"],
    ["papel:discipulador", "Papel: Discipulador"],
    ["papel:rede", "Papel: Rede"],
  ])("%s → %s", (alvo, texto) => {
    expect(textoDoAlvo(alvo)).toBe(texto);
  });

  it("tipo desconhecido (ou papel desconhecido) aparece como veio da API", () => {
    expect(textoDoAlvo("evento:9")).toBe("evento:9");
    expect(textoDoAlvo("papel:outro")).toBe("papel:outro");
    expect(textoDoAlvo("toString")).toBe("toString");
  });
});
