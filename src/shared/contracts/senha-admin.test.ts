// RIFA-073 (D33): o contrato do login do admin com usuário e senha: as rotas (login aberto; a senha do próprio admin
// só para o papel admin), as regras da senha (mínimo de 10 caracteres, diferente do usuário), o formato do usuário e
// a resposta, que nunca traz a senha nem o hash.
import { describe, expect, it } from "vitest";
import {
  ROTAS_ACESSO,
  corpoDefinirSenhaAdminSchema,
  corpoEntrarComoAdminSchema,
  respostaSenhaAdminSchema,
} from "./acesso";
import { ACOES_AUDITORIA } from "./api";
import {
  FORMATO_USUARIO_ADMIN,
  MINIMO_SENHA_ADMIN,
  normalizarUsuarioAdmin,
  problemaDaSenhaAdmin,
} from "./senha-admin";

describe("RIFA-073: rotas do login do admin com senha", () => {
  it("o login é aberto (POST /api/sessao/admin); a senha do admin é só do papel admin, sob /api/admin", () => {
    expect(ROTAS_ACESSO.entrarComoAdmin).toMatchObject({
      metodo: "POST",
      caminho: "/api/sessao/admin",
      grupo: "aberto",
      papeis: null,
    });
    for (const rota of [
      ROTAS_ACESSO.obterMinhaSenhaAdmin,
      ROTAS_ACESSO.definirMinhaSenhaAdmin,
      ROTAS_ACESSO.removerMinhaSenhaAdmin,
    ]) {
      expect(rota.caminho).toBe("/api/admin/minha-senha");
      expect(rota.grupo).toBe("coordenacao");
      expect(rota.papeis).toEqual(["admin"]);
    }
    expect(ACOES_AUDITORIA).toEqual(
      expect.arrayContaining([
        "sessao.entrar_como_admin",
        "senha_admin.definir",
        "senha_admin.trocar",
        "senha_admin.remover",
      ]),
    );
  });

  it("o corpo do login aceita qualquer texto (a recusa é o 401); só a falta do campo e o texto enorme dão 400", () => {
    expect(
      corpoEntrarComoAdminSchema.safeParse({ usuario: "", senha: "" }).success,
    ).toBe(true);
    expect(corpoEntrarComoAdminSchema.safeParse({ usuario: "x" }).success).toBe(
      false,
    );
    expect(
      corpoEntrarComoAdminSchema.safeParse({
        usuario: "x",
        senha: "a".repeat(201),
      }).success,
    ).toBe(false);
  });
});

describe("RIFA-073: regras da senha e do usuário", () => {
  it("senha forte: no mínimo 10 caracteres e diferente do usuário", () => {
    expect(MINIMO_SENHA_ADMIN).toBe(10);
    expect(problemaDaSenhaAdmin("123456789", "pastor")).toBe("curta");
    expect(problemaDaSenhaAdmin("1234567890", "pastor")).toBeNull();
    expect(problemaDaSenhaAdmin("x".repeat(129), "pastor")).toBe("longa");
    expect(problemaDaSenhaAdmin("Pastor.Joao", " pastor.joao ")).toBe(
      "igual_ao_usuario",
    );
    // Caracteres contados como a pessoa vê (o emoji conta 1).
    expect(problemaDaSenhaAdmin("😀".repeat(9), "pastor")).toBe("curta");
  });

  it("o usuário é gravado sem espaços nas pontas e em minúsculas, no formato combinado", () => {
    expect(normalizarUsuarioAdmin("  Pastor.Joao ")).toBe("pastor.joao");
    for (const ok of ["pastor", "admin2", "pr.joao-silva", "a_b"])
      expect(FORMATO_USUARIO_ADMIN.test(ok)).toBe(true);
    for (const ruim of ["ab", ".pastor", "joão", "pas tor", "x".repeat(41)])
      expect(FORMATO_USUARIO_ADMIN.test(ruim)).toBe(false);

    const ok = corpoDefinirSenhaAdminSchema.safeParse({
      usuario: " Pastor.Joao ",
      senha: "uma senha longa",
    });
    expect(ok.success && ok.data).toEqual({
      usuario: "pastor.joao",
      senha: "uma senha longa",
    });
    for (const corpo of [
      { usuario: "joão", senha: "uma senha longa" },
      { usuario: "pastor", senha: "curta" },
      { usuario: "pastorjoao", senha: "PastorJoao" },
      { usuario: "pastor" },
    ])
      expect(corpoDefinirSenhaAdminSchema.safeParse(corpo).success).toBe(false);
  });

  it("a resposta nunca traz a senha nem o hash (schema estrito)", () => {
    expect(
      respostaSenhaAdminSchema.safeParse({
        definida: true,
        usuario: "pastor",
        atualizada_em: "2026-11-19T12:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      respostaSenhaAdminSchema.safeParse({
        definida: true,
        usuario: "pastor",
        atualizada_em: "2026-11-19T12:00:00.000Z",
        hash: "x",
      }).success,
    ).toBe(false);
  });
});
