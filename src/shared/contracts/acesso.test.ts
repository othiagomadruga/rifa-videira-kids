import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FORMATO_TOKEN_ACESSO,
  PAPEIS,
  ROTAS_ACESSO,
  VALIDADE_LINK_DIAS,
  VALIDADE_SESSAO_DIAS,
  corpoAtualizarUsuarioSchema,
  corpoCriarSessaoSchema,
  corpoCriarUsuarioSchema,
  respostaCriarLinkSchema,
  respostaCriarUsuarioSchema,
  respostaListaUsuariosSchema,
  respostaSessaoSchema,
  usuarioSchema,
} from "./acesso";
import { ROTAS } from "./api";

const rotas = Object.entries(ROTAS_ACESSO);

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

const usuarioExemplo = {
  id: 1,
  nome: "Coordenadora Ficticia",
  email: null,
  papel: "coordenacao",
  ativo: true,
  criado_em: "2026-11-06T18:00:00.000Z",
  sessoes_ativas: 1,
  links: [
    {
      id: 3,
      criado_em: "2026-11-06T18:00:00.000Z",
      expira_em: "2026-12-06T18:00:00.000Z",
      revogado_em: null,
      ultimo_uso_em: "2026-11-06T18:05:00.000Z",
      situacao: "valido",
    },
  ],
};

describe("contrato do acesso (RIFA-007): catálogo", () => {
  it("traz as 8 rotas de sessão e de administração", () => {
    expect(
      rotas.map(([, rota]) => `${rota.metodo} ${rota.caminho}`).sort(),
    ).toEqual(
      [
        "POST /api/sessao",
        "GET /api/sessao",
        "POST /api/sessao/sair",
        "POST /api/admin/usuarios",
        "GET /api/admin/usuarios",
        "PATCH /api/admin/usuarios/:id",
        "POST /api/admin/usuarios/:id/links",
        "DELETE /api/admin/links/:id",
      ].sort(),
    );
  });

  it("não repete nenhuma rota de ROTAS", () => {
    const existentes = new Set(
      Object.values(ROTAS).map((rota) => `${rota.metodo} ${rota.caminho}`),
    );
    for (const [, rota] of rotas) {
      expect(existentes.has(`${rota.metodo} ${rota.caminho}`)).toBe(false);
    }
  });

  it("papéis: usuários e links só admin; GET /api/sessao, a equipe toda; os POST de sessão, abertos", () => {
    for (const [nome, rota] of rotas) {
      const esperado =
        rota.caminho.startsWith("/api/admin/usuarios") ||
        rota.caminho.startsWith("/api/admin/links")
          ? ["admin"]
          : rota.metodo === "GET"
            ? [...PAPEIS]
            : null;
      expect({ nome, papeis: rota.papeis }).toEqual({ nome, papeis: esperado });
      expect({ nome, grupo: rota.grupo }).toEqual({
        nome,
        grupo: rota.papeis === null ? "aberto" : "coordenacao",
      });
    }
  });

  it("usa corpo de resposta só fora do 204", () => {
    for (const [, rota] of rotas) {
      expect(rota.sucesso.status === 204).toBe(rota.sucesso.corpo === null);
    }
  });
});

describe("contrato do acesso: o link só sai na criação", () => {
  const SEGREDO = /^(url|token|token_hash|id_hash|hash|segredo)$/;

  it("listagem, usuário e sessão não têm campo de URL, token ou hash", () => {
    for (const schema of [
      respostaListaUsuariosSchema,
      usuarioSchema,
      respostaSessaoSchema,
    ]) {
      expect(
        nomesDeCampos(schema).filter((campo) => SEGREDO.test(campo)),
      ).toEqual([]);
    }
  });

  it("as respostas de criação trazem a URL do link (e nenhum outro segredo)", () => {
    for (const schema of [
      respostaCriarUsuarioSchema,
      respostaCriarLinkSchema,
    ]) {
      expect(
        nomesDeCampos(schema).filter((campo) => SEGREDO.test(campo)),
      ).toEqual(["url"]);
    }
  });

  it("a listagem aceita o formato documentado", () => {
    expect(
      respostaListaUsuariosSchema.safeParse({ itens: [usuarioExemplo] })
        .success,
    ).toBe(true);
    expect(
      respostaCriarUsuarioSchema.safeParse({
        usuario: usuarioExemplo,
        link: {
          ...usuarioExemplo.links[0],
          url: "https://rifa.example.org/acesso/x",
        },
      }).success,
    ).toBe(true);
  });
});

describe("contrato do acesso: corpos", () => {
  it("POST /api/sessao: só o campo token, em texto (o formato é conferido pela API, com 401)", () => {
    expect(corpoCriarSessaoSchema.parse({ token: "qualquer" })).toEqual({
      token: "qualquer",
    });
    expect(corpoCriarSessaoSchema.safeParse({}).success).toBe(false);
    expect(corpoCriarSessaoSchema.safeParse({ token: 123 }).success).toBe(
      false,
    );
  });

  it("FORMATO_TOKEN_ACESSO: 43 caracteres base64url", () => {
    expect(FORMATO_TOKEN_ACESSO.test("A".repeat(43))).toBe(true);
    expect(FORMATO_TOKEN_ACESSO.test("aZ09-_".repeat(7) + "x")).toBe(true);
    for (const invalido of [
      "A".repeat(42),
      "A".repeat(44),
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)}+`,
    ])
      expect(FORMATO_TOKEN_ACESSO.test(invalido)).toBe(false);
  });

  it("criar usuário: nome sem espaços nas pontas, e-mail opcional (null) e papel do catálogo", () => {
    expect(
      corpoCriarUsuarioSchema.parse({ nome: "  Fulano  ", papel: "admin" }),
    ).toEqual({
      nome: "Fulano",
      email: null,
      papel: "admin",
    });
    for (const invalido of [
      { nome: "Fulano", papel: "pastor" },
      { nome: " ", papel: "admin" },
      { nome: "Fulano", papel: "admin", email: "sem-arroba" },
      { papel: "coordenacao" },
    ]) {
      expect(corpoCriarUsuarioSchema.safeParse(invalido).success).toBe(false);
    }
  });

  it("PATCH do usuário aceita só { ativo }", () => {
    expect(corpoAtualizarUsuarioSchema.parse({ ativo: false })).toEqual({
      ativo: false,
    });
    expect(
      corpoAtualizarUsuarioSchema.safeParse({ ativo: true, papel: "admin" })
        .success,
    ).toBe(false);
    expect(
      corpoAtualizarUsuarioSchema.safeParse({ ativo: "false" }).success,
    ).toBe(false);
  });

  it("link e sessão valem 30 dias", () => {
    expect(VALIDADE_LINK_DIAS).toBe(30);
    expect(VALIDADE_SESSAO_DIAS).toBe(30);
  });
});
