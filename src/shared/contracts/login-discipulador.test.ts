// RIFA-082 (D37): o contrato do login do discipulador com a senha padrão: a mesma regra da célula (normalização, "@" e
// "1234"), os nomes do pedido do PO, as colisões, o corpo do POST /api/sessao/discipulador, a rota no catálogo e a ação
// na trilha.
import { describe, expect, it } from "vitest";
import {
  LIMITE_CAMPO_LOGIN_CELULA,
  ROTAS_ACESSO,
  corpoEntrarComoDiscipuladorSchema,
  respostaSessaoSchema,
} from "./acesso";
import { ACOES_AUDITORIA, ROTAS } from "./api";
import * as contrato from "./index";
import {
  formaDaSenhaDigitada,
  normalizarNomeCelula,
  normalizarNomeLogin,
  senhaPadraoDaCelula,
} from "./login-celula";
import {
  problemasDoLoginDosDiscipuladores,
  senhaPadraoDoDiscipulador,
} from "./login-discipulador";

describe("RIFA-082: a senha padrão do discipulador", () => {
  it("os nomes do pedido do PO: '@' + o nome normalizado + '1234'", () => {
    expect(
      [
        "Alisson",
        "Edgard",
        "Elvis",
        "Euriano",
        "Fábio",
        "Notte",
        "Pr. Fábio",
        "William",
      ].map(senhaPadraoDoDiscipulador),
    ).toEqual([
      "@alisson1234",
      "@edgard1234",
      "@elvis1234",
      "@euriano1234",
      "@fabio1234",
      "@notte1234",
      "@prfabio1234",
      "@william1234",
    ]);
  });

  it("é a mesma regra da célula (a mesma normalização, o mesmo '@' e '1234'); sem letra nem dígito, null", () => {
    expect(normalizarNomeLogin).toBe(normalizarNomeCelula);
    for (const nome of ["Discipulador Abel", "  PR. FÁBIO ", "Ação 2", "!!!"])
      expect(senhaPadraoDoDiscipulador(nome)).toBe(senhaPadraoDaCelula(nome));
    expect(senhaPadraoDoDiscipulador("!!! ...")).toBeNull();
    expect(senhaPadraoDoDiscipulador("")).toBeNull();
    // A senha digitada pelo discipulador passa pela mesma forma da célula.
    expect(formaDaSenhaDigitada("  @Pr. Fábio 1234 ")).toBe(
      senhaPadraoDoDiscipulador("Pr. Fábio"),
    );
  });

  it("colisões: nomes iguais depois da normalização (ambíguos) e nomes sem letra nem dígito, na ordem em que vieram", () => {
    const lista = [
      { id: 1, nome: "Fábio" },
      { id: 2, nome: "Pr. Fábio" },
      { id: 3, nome: "Fabio" },
      { id: 4, nome: "..." },
      { id: 5, nome: "William" },
      { id: 6, nome: "FABIO!" },
    ];
    expect(problemasDoLoginDosDiscipuladores(lista)).toEqual({
      repetidas: [[lista[0], lista[2], lista[5]]],
      semSenha: [lista[3]],
    });
    // "Fábio" e "Pr. Fábio" não colidem: o "pr" fica no nome normalizado.
    expect(
      problemasDoLoginDosDiscipuladores([lista[0], lista[1], lista[4]]),
    ).toEqual({ repetidas: [], semSenha: [] });
  });
});

describe("RIFA-082: POST /api/sessao/discipulador no contrato", () => {
  it("a rota é aberta, com o corpo do discipulador e a resposta da sessão de sempre", () => {
    expect(ROTAS_ACESSO.entrarComoDiscipulador).toEqual({
      metodo: "POST",
      caminho: "/api/sessao/discipulador",
      grupo: "aberto",
      papeis: null,
      situacao: "detalhada",
      corpo: corpoEntrarComoDiscipuladorSchema,
      sucesso: { status: 200, corpo: respostaSessaoSchema },
    });
    // Não repete nenhuma rota de ROTAS nem de ROTAS_ACESSO.
    const todas = [...Object.values(ROTAS), ...Object.values(ROTAS_ACESSO)].map(
      (rota) => `${rota.metodo} ${rota.caminho}`,
    );
    expect(
      todas.filter((rota) => rota === "POST /api/sessao/discipulador"),
    ).toHaveLength(1);
  });

  it("o corpo: dois textos até o limite da célula; vazio passa (o 401 é da API); falta, não texto, campo a mais ou texto longo, não", () => {
    expect(
      corpoEntrarComoDiscipuladorSchema.parse({
        discipulador: "Pr. Fábio",
        senha: "@prfabio1234",
      }),
    ).toEqual({ discipulador: "Pr. Fábio", senha: "@prfabio1234" });
    expect(
      corpoEntrarComoDiscipuladorSchema.safeParse({
        discipulador: "",
        senha: "",
      }).success,
    ).toBe(true);
    const longo = "x".repeat(LIMITE_CAMPO_LOGIN_CELULA + 1);
    for (const corpo of [
      {},
      { discipulador: "Elvis" },
      { senha: "@elvis1234" },
      { discipulador: 1, senha: "@elvis1234" },
      { discipulador: "Elvis", senha: "@elvis1234", celula: "Betel" },
      { discipulador: longo, senha: "@elvis1234" },
      { discipulador: "Elvis", senha: longo },
    ])
      expect({
        corpo,
        ok: corpoEntrarComoDiscipuladorSchema.safeParse(corpo).success,
      }).toEqual({ corpo, ok: false });
  });

  it("a sessão aberta é a de um discipulador, com o alvo dele (o schema da resposta é o de sempre)", () => {
    const sessao = {
      usuario: {
        id: 9,
        nome: "Discipulador Fictício",
        papel: "discipulador",
        alvo: {
          tipo: "discipulador",
          id: 4,
          nome: "Discipulador Fictício",
          divisao: "adultos",
        },
      },
    };
    expect(respostaSessaoSchema.parse(sessao)).toEqual(sessao);
  });

  it("a trilha ganha a ação do login do discipulador por senha", () => {
    expect(ACOES_AUDITORIA).toContain("sessao.entrar_com_senha_discipulador");
  });

  it("o index exporta a senha padrão, as colisões e a normalização com o nome do login", () => {
    expect(contrato.senhaPadraoDoDiscipulador).toBe(senhaPadraoDoDiscipulador);
    expect(contrato.problemasDoLoginDosDiscipuladores).toBe(
      problemasDoLoginDosDiscipuladores,
    );
    expect(contrato.normalizarNomeLogin).toBe(normalizarNomeLogin);
  });
});
