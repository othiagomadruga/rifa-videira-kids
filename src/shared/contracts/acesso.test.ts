import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FORMATO_TOKEN_ACESSO,
  LIMITE_ALVOS_POR_LOTE,
  NOME_COOKIE_SESSAO,
  PAPEIS,
  PAPEIS_COORDENACAO,
  PAPEIS_HIERARQUIA,
  ROTAS_ACESSO,
  ROTAS_ACESSO_HIERARQUIA,
  TIPO_ALVO_DO_PAPEL,
  corpoGerarLinksHierarquiaSchema,
  detalhesIdsRecusadosSchema,
  respostaAcessosHierarquiaSchema,
  respostaGerarLinksHierarquiaSchema,
  VALIDADE_LINK_DIAS,
  VALIDADE_SESSAO_DIAS,
  corpoAtualizarUsuarioSchema,
  corpoCriarSessaoSchema,
  corpoCriarUsuarioSchema,
  linkAcessoSchema,
  respostaCriarLinkSchema,
  respostaCriarUsuarioSchema,
  respostaListaUsuariosSchema,
  respostaSessaoSchema,
  usuarioSchema,
} from "./acesso";
import { ROTAS } from "./api";
import { TIPOS_ALVO } from "./dominio";

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
      expira_em: "2026-12-21T18:00:00.000Z",
      revogado_em: null,
      ultimo_uso_em: "2026-11-06T18:05:00.000Z",
      situacao: "valido",
      // RIFA-043: o link que abriu a sessão de quem pediu a lista.
      desta_sessao: true,
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

  it("RIFA-043: o link da lista traz sempre desta_sessao, booleano (calculado pela API)", () => {
    const [link] = usuarioExemplo.links;
    expect(linkAcessoSchema.parse(link).desta_sessao).toBe(true);
    expect(
      linkAcessoSchema.parse({ ...link, desta_sessao: false }).desta_sessao,
    ).toBe(false);
    const semCampo: Partial<typeof link> = { ...link };
    delete semCampo.desta_sessao;
    expect(linkAcessoSchema.safeParse(semCampo).success).toBe(false);
    expect(
      linkAcessoSchema.safeParse({ ...link, desta_sessao: "sim" }).success,
    ).toBe(false);
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

  it("o cookie da sessão usa o prefixo __Host- (Secure, Path=/, sem Domain)", () => {
    expect(NOME_COOKIE_SESSAO).toBe("__Host-sessao");
  });

  it("link e sessão valem 45 dias (cobrem a campanha, de 23/11 a meados de dezembro)", () => {
    expect(VALIDADE_LINK_DIAS).toBe(45);
    expect(VALIDADE_SESSAO_DIAS).toBe(45);
  });
});

describe("RIFA-014 (D12): papéis e acessos da hierarquia", () => {
  const alvo = {
    tipo: "celula",
    id: 101,
    nome: "Célula Esperança",
    divisao: "jovens",
  } as const;

  it("PAPEIS junta a coordenação e a hierarquia, sem papel nos dois grupos, e cada papel da hierarquia tem um tipo de alvo", () => {
    expect([...PAPEIS]).toEqual([...PAPEIS_COORDENACAO, ...PAPEIS_HIERARQUIA]);
    const daHierarquia: readonly string[] = PAPEIS_HIERARQUIA;
    expect(
      PAPEIS_COORDENACAO.filter((papel) => daHierarquia.includes(papel)),
    ).toEqual([]);
    expect(Object.keys(TIPO_ALVO_DO_PAPEL).sort()).toEqual(
      [...PAPEIS_HIERARQUIA].sort(),
    );
    expect(Object.values(TIPO_ALVO_DO_PAPEL).sort()).toEqual(
      [...TIPOS_ALVO].sort(),
    );
  });

  it("o formulário de pessoa só cria papel da coordenação: a hierarquia nasce pelos links em lote", () => {
    for (const papel of PAPEIS_COORDENACAO)
      expect(
        corpoCriarUsuarioSchema.safeParse({ nome: "Fulano", papel }).success,
      ).toBe(true);
    for (const papel of PAPEIS_HIERARQUIA)
      expect(
        corpoCriarUsuarioSchema.safeParse({ nome: "Fulano", papel }).success,
      ).toBe(false);
  });

  it("sessão: o alvo vem nos papéis da hierarquia, pode faltar na coordenação e não aceita campo a mais", () => {
    const lider = respostaSessaoSchema.parse({
      usuario: { id: 5, nome: "Lucas Líder", papel: "lider", alvo },
    });
    expect(lider.usuario.alvo).toEqual(alvo);
    const coordenacao = respostaSessaoSchema.parse({
      usuario: { id: 1, nome: "Coordenadora", papel: "coordenacao" },
    });
    expect(coordenacao.usuario.alvo ?? null).toBeNull();
    expect(
      respostaSessaoSchema.safeParse({
        usuario: {
          id: 5,
          nome: "Lucas Líder",
          papel: "lider",
          alvo: { ...alvo, telefone: "(91) 90000-0001" },
        },
      }).success,
    ).toBe(false);
    expect(
      usuarioSchema.parse({ ...usuarioExemplo, papel: "lider", alvo }).alvo,
    ).toEqual(alvo);
  });

  it("o alvo combina com o papel: líder com célula, discipulador com discipulador, rede com rede; coordenação sem alvo", () => {
    const comAlvo = (papel: string, alvoDoUsuario: unknown) =>
      respostaSessaoSchema.safeParse({
        usuario: { id: 5, nome: "Fulano", papel, alvo: alvoDoUsuario },
      }).success;
    const de = (tipo: string) => ({ ...alvo, tipo });
    expect(comAlvo("lider", de("celula"))).toBe(true);
    expect(comAlvo("discipulador", de("discipulador"))).toBe(true);
    expect(comAlvo("rede", de("rede"))).toBe(true);
    expect(comAlvo("coordenacao", null)).toBe(true);
    for (const [papel, alvoDoUsuario] of [
      ["lider", null],
      ["lider", undefined],
      ["lider", de("rede")],
      ["discipulador", de("celula")],
      ["rede", de("discipulador")],
      ["coordenacao", de("celula")],
      ["admin", de("rede")],
    ] as const)
      expect({
        papel,
        alvoDoUsuario,
        ok: comAlvo(papel, alvoDoUsuario),
      }).toEqual({ papel, alvoDoUsuario, ok: false });
    expect(
      usuarioSchema.safeParse({ ...usuarioExemplo, papel: "rede", alvo })
        .success,
    ).toBe(false);
    expect(
      usuarioSchema.safeParse({ ...usuarioExemplo, papel: "lider" }).success,
    ).toBe(false);
  });

  it("404 e 409 do lote trazem os ids recusados", () => {
    expect(detalhesIdsRecusadosSchema.parse({ ids: [3, 7] })).toEqual({
      ids: [3, 7],
    });
    expect(detalhesIdsRecusadosSchema.safeParse({ ids: [] }).success).toBe(
      false,
    );
    expect(
      detalhesIdsRecusadosSchema.safeParse({ ids: [3], nomes: ["x"] }).success,
    ).toBe(false);
  });

  it("as rotas dos acessos da hierarquia são só de admin, no grupo da coordenação, sob /api/admin/acessos-hierarquia", () => {
    const definicoes = Object.values(ROTAS_ACESSO_HIERARQUIA);
    expect(
      definicoes.map((rota) => `${rota.metodo} ${rota.caminho}`).sort(),
    ).toEqual(
      [
        "GET /api/admin/acessos-hierarquia",
        "POST /api/admin/acessos-hierarquia/links",
      ].sort(),
    );
    for (const rota of definicoes) {
      expect(rota.papeis).toEqual(["admin"]);
      expect(rota.grupo).toBe("coordenacao");
    }
    expect(ROTAS_ACESSO_HIERARQUIA.gerarLinksHierarquia.sucesso.status).toBe(
      201,
    );
  });

  it("gerar links: papel da hierarquia, ids sem repetição e de 1 a LIMITE_ALVOS_POR_LOTE; revogar_anteriores é falso por padrão", () => {
    expect(
      corpoGerarLinksHierarquiaSchema.parse({ papel: "lider", ids: [3, 1] }),
    ).toEqual({ papel: "lider", ids: [3, 1], revogar_anteriores: false });
    const invalidos: unknown[] = [
      { papel: "lider", ids: [] },
      { papel: "lider", ids: [1, 1] },
      { papel: "lider", ids: [0] },
      { papel: "admin", ids: [1] },
      { papel: "coordenacao", ids: [1] },
      { papel: "lider", ids: [1], celula_id: 1 },
      {
        papel: "lider",
        ids: Array.from({ length: LIMITE_ALVOS_POR_LOTE + 1 }, (_, i) => i + 1),
      },
    ];
    for (const corpo of invalidos)
      expect(corpoGerarLinksHierarquiaSchema.safeParse(corpo).success).toBe(
        false,
      );
  });

  it("nenhuma resposta dos acessos da hierarquia tem campo de token ou hash: a URL do link recém-criado é a única saída", () => {
    for (const schema of [
      respostaAcessosHierarquiaSchema,
      respostaGerarLinksHierarquiaSchema,
    ])
      expect(
        nomesDeCampos(schema).filter((campo) => /token|hash/i.test(campo)),
      ).toEqual([]);
  });
});
