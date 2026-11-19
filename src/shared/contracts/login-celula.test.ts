// RIFA-064 (D29): o contrato do login da célula com a senha padrão: a normalização do nome, a senha derivada, a forma
// da senha digitada, as colisões, o corpo do POST /api/sessao/senha, a rota no catálogo, a chave na campanha e a ação
// na trilha.
import { describe, expect, it } from "vitest";
import {
  LIMITE_CAMPO_LOGIN_CELULA,
  ROTAS_ACESSO,
  corpoEntrarComSenhaSchema,
  respostaSessaoSchema,
} from "./acesso";
import { ACOES_AUDITORIA, ROTAS } from "./api";
import { campanhaEntradaSchema, campanhaSchema } from "./dominio";
import * as contrato from "./index";
import {
  PREFIXO_SENHA_CELULA,
  SUFIXO_SENHA_CELULA,
  formaDaSenhaDigitada,
  normalizarNomeCelula,
  problemasDoLoginDasCelulas,
  senhaPadraoDaCelula,
} from "./login-celula";
import { ACESSO_PADRAO } from "./regras";

describe("RIFA-064: a senha padrão da célula", () => {
  it("os exemplos do pedido: '@' + o nome normalizado + '1234'", () => {
    expect(senhaPadraoDaCelula("Geração que Clama")).toBe(
      "@geracaoqueclama1234",
    );
    expect(senhaPadraoDaCelula("Kairós1")).toBe("@kairos11234");
    expect(senhaPadraoDaCelula("Pão Vivo")).toBe("@paovivo1234");
    expect(PREFIXO_SENHA_CELULA).toBe("@");
    expect(SUFIXO_SENHA_CELULA).toBe("1234");
  });

  it("normaliza: minúsculas, sem acentos (inclusive ç, ã, ü), sem espaços e sem pontuação", () => {
    for (const [nome, esperado] of [
      ["Célula Ágape", "celulaagape"],
      ["  CANAÃ  ", "canaa"],
      ["Ação & Graça", "acaograca"],
      ["Betel-2", "betel2"],
      ["São João (Jovens)", "saojoaojovens"],
      ["Müller's", "mullers"],
      ["Célula 10", "celula10"],
      ["Vida\tNova\n", "vidanova"],
      ["Ágape", "agape"],
      // Composto (é = e + acento) e pré-composto (é) dão o mesmo.
      ["Café", "cafe"],
      ["Café", "cafe"],
    ])
      expect({ nome, normalizado: normalizarNomeCelula(nome) }).toEqual({
        nome,
        normalizado: esperado,
      });
  });

  it("nome sem letra nem dígito: sem senha padrão (null); a normalização dá vazio", () => {
    for (const nome of ["!!!", "   ", "—", "✝"]) {
      expect(normalizarNomeCelula(nome)).toBe("");
      expect(senhaPadraoDaCelula(nome)).toBeNull();
    }
  });

  it("a senha digitada: '@' obrigatório no começo; o resto tolera maiúsculas, acentos, espaços e os espaços das pontas", () => {
    const esperada = senhaPadraoDaCelula("Geração que Clama");
    for (const digitada of [
      "@geracaoqueclama1234",
      "@Geração que Clama1234",
      "  @GERAÇÃO QUE CLAMA 1234 ",
      "@geração-que-clama 1234",
    ])
      expect({ digitada, forma: formaDaSenhaDigitada(digitada) }).toEqual({
        digitada,
        forma: esperada,
      });
    // Sem o "@" do começo, ou com outra coisa no lugar, nunca confere.
    for (const digitada of [
      "geracaoqueclama1234",
      "#geracaoqueclama1234",
      "geracaoqueclama1234@",
      "",
      "   ",
    ])
      expect({ digitada, forma: formaDaSenhaDigitada(digitada) }).toEqual({
        digitada,
        forma: "",
      });
    // Sem o "1234" (ou com outro número), a forma não é a senha.
    expect(formaDaSenhaDigitada("@geracaoqueclama")).not.toBe(esperada);
    expect(formaDaSenhaDigitada("@geracaoqueclama4321")).not.toBe(esperada);
    // Só o "@" não é senha de célula nenhuma.
    expect(formaDaSenhaDigitada("@")).toBe("@");
  });

  it("colisão: nomes que ficam iguais na normalização vão para o mesmo grupo; o nome sem letra nem dígito, para semSenha", () => {
    const celulas = [
      { id: 1, nome: "Pão Vivo" },
      { id: 2, nome: "Betel" },
      { id: 3, nome: "Pao Vivo" },
      { id: 4, nome: "Kairós 1" },
      { id: 5, nome: "kairos-1" },
      { id: 6, nome: "Pão-Vivo!" },
      { id: 7, nome: "!!!" },
      { id: 8, nome: "Ágape" },
    ];
    expect(problemasDoLoginDasCelulas(celulas)).toEqual({
      repetidas: [
        [celulas[0], celulas[2], celulas[5]],
        [celulas[3], celulas[4]],
      ],
      semSenha: [celulas[6]],
    });
    expect(
      problemasDoLoginDasCelulas([
        { nome: "Ágape" },
        { nome: "Betel" },
        { nome: "Celula 2" },
        { nome: "Celula 20" },
      ]),
    ).toEqual({ repetidas: [], semSenha: [] });
  });
});

describe("RIFA-064: POST /api/sessao/senha no contrato", () => {
  it("rota aberta (sem sessão), no catálogo do acesso, com o corpo e a resposta da sessão", () => {
    const rota = ROTAS_ACESSO.entrarComSenha;
    expect({
      metodo: rota.metodo,
      caminho: rota.caminho,
      grupo: rota.grupo,
      papeis: rota.papeis,
      sucesso: rota.sucesso.status,
    }).toEqual({
      metodo: "POST",
      caminho: "/api/sessao/senha",
      grupo: "aberto",
      papeis: null,
      sucesso: 200,
    });
    expect(rota.corpo).toBe(corpoEntrarComSenhaSchema);
    expect(rota.sucesso.corpo).toBe(respostaSessaoSchema);
    // Não repete rota de ROTAS.
    expect(
      Object.values(ROTAS).map((outra) => `${outra.metodo} ${outra.caminho}`),
    ).not.toContain(`${rota.metodo} ${rota.caminho}`);
  });

  it("corpo: os dois campos são texto livre até o limite (vazio passa: é o 401 da rota, não um 400)", () => {
    expect(
      corpoEntrarComSenhaSchema.parse({ celula: "Betel", senha: "@betel1234" }),
    ).toEqual({ celula: "Betel", senha: "@betel1234" });
    expect(corpoEntrarComSenhaSchema.parse({ celula: "", senha: "" })).toEqual({
      celula: "",
      senha: "",
    });
    const longo = "x".repeat(LIMITE_CAMPO_LOGIN_CELULA);
    expect(
      corpoEntrarComSenhaSchema.safeParse({ celula: longo, senha: longo })
        .success,
    ).toBe(true);
    for (const corpo of [
      {},
      { celula: "Betel" },
      { senha: "@betel1234" },
      { celula: 1, senha: "@betel1234" },
      { celula: "Betel", senha: null },
      { celula: `${longo}x`, senha: "@betel1234" },
      { celula: "Betel", senha: `${longo}x` },
    ])
      expect({
        corpo,
        valido: corpoEntrarComSenhaSchema.safeParse(corpo).success,
      }).toEqual({ corpo, valido: false });
  });

  it("a sessão aberta é a de um líder, com o alvo da célula (o schema da resposta é o de sempre)", () => {
    const sessao = {
      usuario: {
        id: 7,
        nome: "Líder Fictício",
        papel: "lider",
        alvo: { tipo: "celula", id: 3, nome: "Betel", divisao: "jovens" },
      },
    };
    expect(respostaSessaoSchema.parse(sessao)).toEqual(sessao);
  });

  it("a trilha ganha a ação do login por senha", () => {
    expect(ACOES_AUDITORIA).toContain("sessao.entrar_com_senha");
  });

  it("o index exporta a normalização, a senha padrão e as colisões", () => {
    expect(contrato.normalizarNomeCelula).toBe(normalizarNomeCelula);
    expect(contrato.senhaPadraoDaCelula).toBe(senhaPadraoDaCelula);
    expect(contrato.formaDaSenhaDigitada).toBe(formaDaSenhaDigitada);
    expect(contrato.problemasDoLoginDasCelulas).toBe(
      problemasDoLoginDasCelulas,
    );
  });
});

describe("RIFA-064: a chave acesso.celulas_senha na campanha", () => {
  const corpoDeHoje = {
    nome: "Campanha Fictícia",
    slug_rifei: "campanha-ficticia",
    data_inicio: "2026-11-23",
    preco_bilhete_centavos: 2000,
    meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
    periodos: [{ nome: "Período 1", dias: 21, percentual_bp: 10000 }],
    ranking: { criterio: "percentual_meta" },
  };

  it("padrão: ligada, como os outros acessos", () => {
    expect(ACESSO_PADRAO).toEqual({
      discipuladores: true,
      redes: true,
      celulas_senha: true,
    });
  });

  it("entrada: a chave é opcional dentro de `acesso` (ausente mantém o gravado); presente, só booleano", () => {
    expect(
      campanhaEntradaSchema.parse({
        ...corpoDeHoje,
        acesso: { discipuladores: true, redes: true },
      }).acesso,
    ).toEqual({ discipuladores: true, redes: true });
    expect(
      campanhaEntradaSchema.parse({
        ...corpoDeHoje,
        acesso: { discipuladores: true, redes: true, celulas_senha: false },
      }).acesso,
    ).toEqual({ discipuladores: true, redes: true, celulas_senha: false });
    expect(
      campanhaEntradaSchema.safeParse({
        ...corpoDeHoje,
        acesso: { discipuladores: true, redes: true, celulas_senha: "sim" },
      }).success,
    ).toBe(false);
  });

  it("resposta: sem a chave (antes da 0013), sai ligada; gravada, sai como está", () => {
    const campanha = {
      id: 1,
      nome: "Campanha Fictícia",
      slug_rifei: "campanha-ficticia",
      fuso_horario: "America/Belem",
      data_inicio: "2026-11-23",
      data_fim: "2026-12-13",
      preco_bilhete_centavos: 2000,
      meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
      periodos: [
        {
          ordem: 1,
          nome: "Período 1",
          dias: 21,
          percentual_bp: 10000,
          data_inicio: "2026-11-23",
          data_fim: "2026-12-13",
        },
      ],
      soma_percentuais_bp: 10000,
      ranking: { criterio: "percentual_meta" },
      publico: { mostra_percentual_meta: false, limite_ranking: 3 },
      criado_em: "2026-11-06T18:00:00.000Z",
      atualizado_em: "2026-11-06T18:00:00.000Z",
    };
    expect(
      campanhaSchema.parse({
        ...campanha,
        acesso: { discipuladores: false, redes: true },
      }).acesso,
    ).toEqual({ discipuladores: false, redes: true, celulas_senha: true });
    expect(
      campanhaSchema.parse({
        ...campanha,
        acesso: { discipuladores: true, redes: true, celulas_senha: false },
      }).acesso,
    ).toEqual({ discipuladores: true, redes: true, celulas_senha: false });
    expect(campanhaSchema.parse(campanha).acesso).toEqual(ACESSO_PADRAO);
  });
});
