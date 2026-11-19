// RIFA-046 (docs/decisions.md D24): o link de vendas de cada célula (o link de afiliado da Rifei, montado pelo modelo
// que só o admin grava) e o QR code dele. Um teste por critério do contrato; o banco (migração 0010), as rotas e as
// telas são das tarefas -db, -api e -web.
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { ROTAS_ACESSO, ROTAS_ACESSO_HIERARQUIA } from "./acesso";
import {
  ROTAS,
  ROTAS_LINK_VENDAS,
  ROTAS_REGRAS_CAMPANHA,
  ROTAS_RELATORIO,
  ROTAS_TOKEN_WEBHOOK,
  celulaLinksVendasSchema,
  corpoSalvarModeloLinkVendasSchema,
  respostaLinksVendasSchema,
  respostaMeusLinksVendasSchema,
  type CorpoSalvarModeloLinkVendas,
  type DefinicaoRota,
} from "./api";
import * as contrato from "./index";
import {
  HOSTS_LINK_VENDAS,
  LIMITE_CARACTERES_LINK_VENDAS,
  LIMITE_CARACTERES_MODELO_LINK_VENDAS,
  MARCADORES_LINK_VENDAS,
  MARGEM_QR_LINK_VENDAS_MODULOS,
  NIVEL_CORRECAO_QR_LINK_VENDAS,
  eLinkDeVendas,
  modeloLinkVendasValido,
  montarLinkDeVendas,
  nomeDoArquivoQrLinkVendas,
  problemasDoModeloLinkVendas,
} from "./link-vendas";
import fonteLinkVendas from "./link-vendas.ts?raw";

/** Um modelo plausível (o formato real ainda não foi confirmado com a Rifei: integracao-rifei.md 12.3). */
const MODELO = "https://rifei.com.br/{slug}?afiliado={afiliado}";
const SLUG = "videira-kids";

const aceita = (schema: z.ZodType, valor: unknown) =>
  schema.safeParse(valor).success;

/** Nomes de todos os campos que o schema pode devolver (pelo JSON Schema do zod). */
function campos(schema: z.ZodType): string[] {
  const nomes = new Set<string>();
  const visitar = (no: unknown): void => {
    if (Array.isArray(no)) return no.forEach(visitar);
    if (typeof no !== "object" || no === null) return;
    for (const [chave, valor] of Object.entries(no)) {
      if (chave === "properties" && typeof valor === "object" && valor !== null)
        for (const nome of Object.keys(valor)) nomes.add(nome);
      visitar(valor);
    }
  };
  visitar(z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }));
  return [...nomes].sort();
}

/** Uma célula da lista, com os links montados pelo modelo de exemplo. */
function celula(
  id: number,
  afiliados: number[],
  hierarquia: Partial<{
    discipulador_id: number;
    rede_id: number;
    divisao: "jovens" | "adultos";
  }> = {},
) {
  return {
    celula_id: id,
    celula_nome: `Célula Ficticia ${id}`,
    lider_nome: `Lider Ficticio ${id}`,
    discipulador_id: hierarquia.discipulador_id ?? 10,
    discipulador_nome: "Discipulador Ficticio",
    rede_id: hierarquia.rede_id ?? 1,
    rede_nome: "Rede Jovem Ficticia",
    divisao: hierarquia.divisao ?? "jovens",
    links: afiliados.map((affiliateId) => ({
      affiliate_id: affiliateId,
      url: montarLinkDeVendas(MODELO, { slug: SLUG, affiliateId }),
    })),
  };
}

describe("D24: o modelo do link de vendas", () => {
  it("marcadores {slug} e {afiliado}; só o endereço da Rifei; limites", () => {
    expect(MARCADORES_LINK_VENDAS).toEqual(["slug", "afiliado", "codigo"]);
    expect(HOSTS_LINK_VENDAS).toEqual(["rifei.com.br"]);
    expect(LIMITE_CARACTERES_MODELO_LINK_VENDAS).toBe(300);
    expect(LIMITE_CARACTERES_LINK_VENDAS).toBe(2048);
  });

  it("aceita os formatos plausíveis do link de afiliado (com ou sem o slug, no caminho ou na consulta)", () => {
    for (const modelo of [
      MODELO,
      "https://rifei.com.br/{slug}?ref={afiliado}",
      "https://rifei.com.br/{slug}/a/{afiliado}",
      "https://rifei.com.br/u/videira/afiliados/{afiliado}",
      "https://rifei.com.br/{slug}?a={afiliado}&utm_source=celula",
      "https://rifei.com.br/videira-kids?a={afiliado}",
      "https://rifei.com.br/{afiliado}",
    ])
      expect({
        modelo,
        problemas: problemasDoModeloLinkVendas(modelo),
      }).toEqual({ modelo, problemas: [] });
  });

  it("recusa outro endereço, mesmo parecido com o da Rifei (phishing), e o que não é https", () => {
    for (const modelo of [
      "http://rifei.com.br/{slug}?a={afiliado}",
      "https://www.rifei.com.br/{slug}?a={afiliado}",
      "https://app.rifei.com.br/{slug}?a={afiliado}",
      "https://rifei.com.br.golpe.example/{afiliado}",
      "https://rifei.com.br@golpe.example/{afiliado}",
      "https://rifei.com.br:8443/{afiliado}",
      "https://RIFEI.COM.BR/{afiliado}",
      "HTTPS://rifei.com.br/{afiliado}",
      "https://golpe.example/?volta=https://rifei.com.br/{afiliado}",
      "//rifei.com.br/{afiliado}",
      "rifei.com.br/{slug}?a={afiliado}",
      "javascript:alert(1)//https://rifei.com.br/{afiliado}",
      "https://rifei.com.br",
    ]) {
      const problemas = problemasDoModeloLinkVendas(modelo);
      expect({ modelo, problemas }).toEqual({
        modelo,
        problemas: expect.arrayContaining([
          "O link de vendas começa com https://rifei.com.br/, o endereço da Rifei.",
        ]),
      });
      expect(modeloLinkVendasValido(modelo)).toBe(false);
    }
  });

  it("exige {afiliado} ou {codigo}; recusa marcador desconhecido, chave solta e espaço, com a mensagem em português", () => {
    expect(problemasDoModeloLinkVendas("https://rifei.com.br/{slug}")).toEqual([
      "O modelo precisa ter {afiliado} ou {codigo}: é o afiliado que faz a venda contar para a célula.",
    ]);
    expect(
      problemasDoModeloLinkVendas(
        "https://rifei.com.br/{slug}?a={cod}&b={Afiliado}&c={cod}",
      ),
    ).toEqual([
      "Marcador {cod} não existe no link de vendas. Use: {slug}, {afiliado} e {codigo}.",
      "Marcador {Afiliado} não existe no link de vendas. Use: {slug}, {afiliado} e {codigo}.",
      "O modelo precisa ter {afiliado} ou {codigo}: é o afiliado que faz a venda contar para a célula.",
    ]);
    for (const modelo of [
      "https://rifei.com.br/{slug}?a={afiliado",
      "https://rifei.com.br/{slug}?a={afiliado}}",
      "https://rifei.com.br/{ afiliado }{afiliado}",
      "https://rifei.com.br/{}{afiliado}",
    ])
      expect(problemasDoModeloLinkVendas(modelo)).toContain(
        "Há uma chave solta no modelo: as chaves só aparecem em {slug}, {afiliado} e {codigo}.",
      );
    for (const modelo of [
      "https://rifei.com.br/{slug} ?a={afiliado}",
      "https://rifei.com.br/{slug}?a={afiliado}\nhttps://golpe.example/",
      "https://rifei.com.br/{slug}?a=\t{afiliado}",
      "https://rifei.com.br/{slug}?a={afiliado}\u0000",
      // Invisíveis (vêm junto ao copiar um link): espaço de largura zero, marcas e inversão de direção, BOM.
      "https://rifei.com.br/{slug}​?a={afiliado}",
      "https://rifei.com.br/{slug}?a={afiliado}‎",
      "https://rifei.com.br/‮{slug}?a={afiliado}",
      "https://rifei.com.br/{slug}?a=⁠{afiliado}",
      "https://rifei.com.br/{slug}﻿?a={afiliado}",
    ]) {
      expect(problemasDoModeloLinkVendas(modelo)).toContain(
        "Tire os espaços, as quebras de linha e os caracteres invisíveis: o link é um endereço só.",
      );
      expect(modeloLinkVendasValido(modelo)).toBe(false);
    }
  });

  it("recusa outro endereço depois do da Rifei (//, \\ ou www.), mesmo com o site de destino na Rifei (revisão)", () => {
    for (const modelo of [
      "https://rifei.com.br//golpe.example/{afiliado}",
      "https://rifei.com.br/\\golpe.example/{afiliado}",
      "https://rifei.com.br/..//golpe.example/{afiliado}",
      "https://rifei.com.br/{slug}?a={afiliado}&volta=https://golpe.example/",
      "https://rifei.com.br/{slug}?a={afiliado}&volta=//golpe.example/",
      "https://rifei.com.br/{slug}?a={afiliado}&volta=\\\\golpe.example",
      "https://rifei.com.br/{slug}?a={afiliado}&volta=WWW.golpe.example",
      "https://rifei.com.br/{slug}?a={afiliado}#https://golpe.example",
    ]) {
      expect({
        modelo,
        problemas: problemasDoModeloLinkVendas(modelo),
      }).toEqual({
        modelo,
        problemas: [
          "Tire do modelo o outro endereço (//, \\ ou www.): o link de vendas leva só à Rifei.",
        ],
      });
      expect(modeloLinkVendasValido(modelo)).toBe(false);
    }
  });

  it("modeloLinkVendasValido: null, acima do limite ou com problema não servem", () => {
    expect(modeloLinkVendasValido(MODELO)).toBe(true);
    expect(modeloLinkVendasValido(null)).toBe(false);
    expect(modeloLinkVendasValido("https://rifei.com.br/{slug}")).toBe(false);
    const comprido = `https://rifei.com.br/${"x".repeat(LIMITE_CARACTERES_MODELO_LINK_VENDAS)}{afiliado}`;
    expect(problemasDoModeloLinkVendas(comprido)).toEqual([]);
    expect(modeloLinkVendasValido(comprido)).toBe(false);
  });
});

describe("D24: a montagem do link (montarLinkDeVendas) e a conferência do domínio (eLinkDeVendas)", () => {
  it("preenche o slug e o affiliate_id e devolve a forma canônica", () => {
    expect(montarLinkDeVendas(MODELO, { slug: SLUG, affiliateId: 1042 })).toBe(
      "https://rifei.com.br/videira-kids?afiliado=1042",
    );
    expect(
      montarLinkDeVendas("https://rifei.com.br/{slug}/{afiliado}", {
        slug: ` ${SLUG} `,
        affiliateId: 7,
      }),
    ).toBe("https://rifei.com.br/videira-kids/7");
    // Caractere fora do ASCII no modelo sai codificado (URL.href), e o resultado continua passando na conferência.
    const comAcento = montarLinkDeVendas(
      "https://rifei.com.br/{slug}?a={afiliado}&c=célula",
      { slug: SLUG, affiliateId: 3 },
    );
    expect(comAcento).toBe(
      "https://rifei.com.br/videira-kids?a=3&c=c%C3%A9lula",
    );
    expect(eLinkDeVendas(comAcento ?? "")).toBe(true);
  });

  it("o slug vai codificado e numa passada só: nenhum valor muda o endereço, o caminho ou o afiliado", () => {
    for (const slug of [
      "a/b?afiliado=999#x",
      "@golpe.example",
      "{afiliado}",
      "...",
      "%2e%2e",
      "slug com espaço",
      "ação",
    ]) {
      const url = montarLinkDeVendas(MODELO, { slug, affiliateId: 1042 });
      expect(url).not.toBeNull();
      const lida = new URL(url ?? "");
      expect({ slug, host: lida.hostname }).toEqual({
        slug,
        host: "rifei.com.br",
      });
      expect(lida.searchParams.getAll("afiliado")).toEqual(["1042"]);
      expect(decodeURIComponent(lida.pathname.slice(1))).toBe(slug);
    }
  });

  it("null sem modelo, com modelo inválido, slug vazio ou affiliate_id que não é inteiro positivo", () => {
    const valores = { slug: SLUG, affiliateId: 1042 };
    expect(montarLinkDeVendas(null, valores)).toBeNull();
    expect(
      montarLinkDeVendas("https://golpe.example/{afiliado}", valores),
    ).toBeNull();
    expect(
      montarLinkDeVendas("https://rifei.com.br/{slug}", valores),
    ).toBeNull();
    expect(
      montarLinkDeVendas(MODELO, { slug: "  ", affiliateId: 1 }),
    ).toBeNull();
    // "." e ".." seriam segmentos de ponto, que o URL apaga do caminho (o link iria para outra página da Rifei).
    for (const slug of [".", "..", " .. "])
      expect(montarLinkDeVendas(MODELO, { slug, affiliateId: 1 })).toBeNull();
    // Surrogate solto: o encodeURIComponent lança URIError; sai null, nunca um 500 (revisão).
    for (const slug of ["\ud800", "videira\udc00kids"])
      expect(montarLinkDeVendas(MODELO, { slug, affiliateId: 1 })).toBeNull();
    for (const affiliateId of [0, -1, 1.5, Number.NaN, 2 ** 53])
      expect(
        montarLinkDeVendas(MODELO, { slug: SLUG, affiliateId }),
      ).toBeNull();
  });

  it("eLinkDeVendas: só https://rifei.com.br/..., canônico, sem usuário, senha ou porta, até o limite", () => {
    for (const url of [
      "https://rifei.com.br/videira-kids?afiliado=1042",
      "https://rifei.com.br/",
      "https://rifei.com.br/u/videira/afiliados/1042#topo",
    ])
      expect({ url, ok: eLinkDeVendas(url) }).toEqual({ url, ok: true });
    for (const url of [
      "http://rifei.com.br/videira-kids",
      "https://www.rifei.com.br/videira-kids",
      "https://rifei.com.br.golpe.example/x",
      "https://usuario:senha@rifei.com.br/x",
      "https://rifei.com.br:443/x",
      "https://rifei.com.br:8443/x",
      "https://rifei.com.br",
      "https://RIFEI.com.br/x",
      "https://rifei.com.br/a b",
      "javascript:alert(1)",
      "data:text/html,oi",
      "/videira-kids",
      "",
      `https://rifei.com.br/${"x".repeat(LIMITE_CARACTERES_LINK_VENDAS)}`,
    ])
      expect({ url, ok: eLinkDeVendas(url) }).toEqual({ url, ok: false });
  });
});

describe("D24: o QR code", () => {
  it("correção M, margem de 4 módulos", () => {
    expect(NIVEL_CORRECAO_QR_LINK_VENDAS).toBe("M");
    expect(MARGEM_QR_LINK_VENDAS_MODULOS).toBe(4);
  });

  it("nome do arquivo da imagem: link-de-vendas-<nome em ASCII>.png", () => {
    expect(nomeDoArquivoQrLinkVendas("Célula Ágape")).toBe(
      "link-de-vendas-celula-agape.png",
    );
    expect(nomeDoArquivoQrLinkVendas("  Célula 10 — Ação & Vida!  ")).toBe(
      "link-de-vendas-celula-10-acao-vida.png",
    );
    expect(nomeDoArquivoQrLinkVendas("../../etc/passwd")).toBe(
      "link-de-vendas-etc-passwd.png",
    );
    for (const vazio of ["", "   ", "!!!", "日本"])
      expect(nomeDoArquivoQrLinkVendas(vazio)).toBe(
        "link-de-vendas-celula.png",
      );
    const longo = nomeDoArquivoQrLinkVendas(`Célula ${"a ".repeat(80)}`);
    expect(longo).toMatch(/^link-de-vendas-[a-z0-9-]+\.png$/);
    expect(longo).not.toMatch(/--|-\.png$/);
    expect(longo.length).toBeLessThanOrEqual(
      "link-de-vendas-".length + 60 + ".png".length,
    );
  });
});

describe("D24: PUT /api/admin/links-vendas/modelo (corpo)", () => {
  it("o modelo sem os espaços das pontas; vazio ou null apagam", () => {
    expect(
      corpoSalvarModeloLinkVendasSchema.parse({ modelo: `  ${MODELO}\n` }),
    ).toEqual({ modelo: MODELO });
    expect(corpoSalvarModeloLinkVendasSchema.parse({ modelo: "   " })).toEqual({
      modelo: null,
    });
    expect(corpoSalvarModeloLinkVendasSchema.parse({ modelo: null })).toEqual({
      modelo: null,
    });
    expectTypeOf<CorpoSalvarModeloLinkVendas>().toEqualTypeOf<{
      modelo: string | null;
    }>();
  });

  it("recusa com os problemas do modelo em português; sem `modelo`, campo a mais ou acima do limite: 400", () => {
    const resultado = corpoSalvarModeloLinkVendasSchema.safeParse({
      modelo: "https://golpe.example/{slug}",
    });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues.map((issue) => issue.message)).toEqual(
      problemasDoModeloLinkVendas("https://golpe.example/{slug}"),
    );
    for (const corpo of [
      {},
      { modelo: MODELO, slug: SLUG },
      { modelo: 42 },
      {
        modelo: `https://rifei.com.br/{afiliado}${"x".repeat(LIMITE_CARACTERES_MODELO_LINK_VENDAS)}`,
      },
    ])
      expect({
        corpo,
        ok: aceita(corpoSalvarModeloLinkVendasSchema, corpo),
      }).toEqual({ corpo, ok: false });
  });
});

describe("D24: as respostas", () => {
  it("coordenação: o modelo, `configurado` e todas as células (a sem afiliado com `links` vazia)", () => {
    const resposta = {
      modelo: MODELO,
      configurado: true,
      itens: [celula(1, [1043, 1042]), celula(2, [])],
    };
    expect(respostaLinksVendasSchema.parse(resposta)).toEqual(resposta);
    expect(
      respostaLinksVendasSchema.parse({
        modelo: null,
        configurado: false,
        itens: [celula(1, []), celula(2, [])],
      }).configurado,
    ).toBe(false);
    // Um modelo gravado fora das regras (SQL à mão) não derruba a rota: sai com configurado false e sem links.
    expect(
      aceita(respostaLinksVendasSchema, {
        modelo: "https://golpe.example/{afiliado}",
        configurado: false,
        itens: [celula(1, [])],
      }),
    ).toBe(true);
  });

  it("coordenação: `configurado` acompanha o modelo; sem modelo, nenhum link; célula e afiliado uma vez só", () => {
    for (const errada of [
      { modelo: null, configurado: true, itens: [] },
      { modelo: MODELO, configurado: false, itens: [] },
      {
        modelo: "https://golpe.example/{afiliado}",
        configurado: true,
        itens: [],
      },
      { modelo: null, configurado: false, itens: [celula(1, [1042])] },
      {
        modelo: MODELO,
        configurado: true,
        itens: [celula(1, []), celula(1, [])],
      },
      {
        modelo: MODELO,
        configurado: true,
        itens: [celula(1, [1042]), celula(2, [1042])],
      },
      {
        modelo: MODELO,
        configurado: true,
        itens: [celula(1, [1042, 1042])],
      },
    ])
      expect(aceita(respostaLinksVendasSchema, errada)).toBe(false);
  });

  it("o link de cada afiliado é só https://rifei.com.br/... (nenhum outro endereço sai da API)", () => {
    const comLink = (url: string) => ({
      modelo: MODELO,
      configurado: true,
      itens: [{ ...celula(1, []), links: [{ affiliate_id: 1042, url }] }],
    });
    expect(
      aceita(
        respostaLinksVendasSchema,
        comLink("https://rifei.com.br/videira-kids?afiliado=1042"),
      ),
    ).toBe(true);
    for (const url of [
      "https://golpe.example/videira-kids?afiliado=1042",
      "http://rifei.com.br/videira-kids?afiliado=1042",
      "https://rifei.com.br.golpe.example/x",
    ]) {
      expect(aceita(respostaLinksVendasSchema, comLink(url))).toBe(false);
      expect(
        aceita(respostaMeusLinksVendasSchema, {
          alvo: {
            tipo: "celula",
            id: 1,
            nome: "Célula Ficticia 1",
            divisao: "jovens",
          },
          configurado: true,
          itens: comLink(url).itens,
        }),
      ).toBe(false);
    }
  });

  it("/minha: o líder recebe só a célula dele; o discipulador, as dele; a rede, as dela (alvo da sessão)", () => {
    const lider = {
      tipo: "celula",
      id: 1,
      nome: "Célula Ficticia 1",
      divisao: "jovens",
    } as const;
    const discipulador = {
      tipo: "discipulador",
      id: 10,
      nome: "Discipulador Ficticio",
      divisao: "jovens",
    } as const;
    const rede = {
      tipo: "rede",
      id: 1,
      nome: "Rede Jovem Ficticia",
      divisao: "jovens",
    } as const;
    const resposta = (
      alvo: typeof lider | typeof discipulador | typeof rede,
      itens: ReturnType<typeof celula>[],
    ) => ({ alvo, configurado: true, itens });

    expect(
      aceita(
        respostaMeusLinksVendasSchema,
        resposta(lider, [celula(1, [1042])]),
      ),
    ).toBe(true);
    expect(
      aceita(
        respostaMeusLinksVendasSchema,
        resposta(discipulador, [celula(1, [1042]), celula(2, [])]),
      ),
    ).toBe(true);
    expect(
      aceita(
        respostaMeusLinksVendasSchema,
        resposta(rede, [
          celula(1, [1042]),
          celula(3, [1050], { discipulador_id: 11 }),
        ]),
      ),
    ).toBe(true);
    // Discipulador sem células: lista vazia.
    expect(
      aceita(respostaMeusLinksVendasSchema, resposta(discipulador, [])),
    ).toBe(true);

    for (const errada of [
      resposta(lider, []),
      resposta(lider, [celula(1, []), celula(2, [])]),
      resposta(lider, [celula(2, [1042])]),
      resposta(discipulador, [
        celula(1, []),
        celula(3, [], { discipulador_id: 11 }),
      ]),
      resposta(rede, [celula(4, [], { rede_id: 2 })]),
      resposta(rede, [celula(5, [], { divisao: "adultos" })]),
      { ...resposta(lider, [celula(1, [1042])]), configurado: false },
      { ...resposta(lider, [celula(1, [])]), modelo: MODELO },
    ])
      expect(aceita(respostaMeusLinksVendasSchema, errada)).toBe(false);
  });

  it("lista fechada de campos: só nomes da hierarquia e os links; nada de contato, rótulo, modelo na /minha ou dinheiro", () => {
    expect(campos(celulaLinksVendasSchema)).toEqual(
      [
        "affiliate_id",
        "celula_id",
        "celula_nome",
        "discipulador_id",
        "discipulador_nome",
        "divisao",
        "lider_nome",
        "links",
        "rede_id",
        "rede_nome",
        "url",
      ].sort(),
    );
    expect(campos(respostaMeusLinksVendasSchema)).toEqual(
      [
        ...campos(celulaLinksVendasSchema),
        "alvo",
        "configurado",
        "id",
        "itens",
        "nome",
        "tipo",
      ].sort(),
    );
    expect(campos(respostaLinksVendasSchema)).toEqual(
      [
        ...campos(celulaLinksVendasSchema),
        "configurado",
        "itens",
        "modelo",
      ].sort(),
    );
    for (const schema of [
      respostaLinksVendasSchema,
      respostaMeusLinksVendasSchema,
    ])
      for (const campo of campos(schema))
        expect(campo).not.toMatch(
          /telefone|email|rotulo|centavos|total|bilhetes|pedidos|vendas$/,
        );
  });
});

describe("D24: o catálogo à parte", () => {
  const definicoes = Object.values(ROTAS_LINK_VENDAS);

  it("as três rotas: a da hierarquia, a lista da coordenação e o PUT só de admin", () => {
    expect(
      definicoes.map((rota) => [
        `${rota.metodo} ${rota.caminho}`,
        rota.grupo,
        "papeis" in rota ? rota.papeis : "admin e coordenacao",
      ]),
    ).toEqual([
      [
        "GET /api/minha/links-vendas",
        "hierarquia",
        ["lider", "discipulador", "rede"],
      ],
      ["GET /api/admin/links-vendas", "coordenacao", "admin e coordenacao"],
      ["PUT /api/admin/links-vendas/modelo", "coordenacao", ["admin"]],
    ]);
    for (const rota of definicoes) {
      expect(rota.situacao).toBe("detalhada");
      expect(rota.sucesso.status).toBe(200);
      expectTypeOf(rota).toExtend<DefinicaoRota>();
    }
    expect(ROTAS_LINK_VENDAS.meusLinksVendas.sucesso.corpo).toBe(
      respostaMeusLinksVendasSchema,
    );
    expect(ROTAS_LINK_VENDAS.linksVendas.sucesso.corpo).toBe(
      respostaLinksVendasSchema,
    );
    expect(ROTAS_LINK_VENDAS.salvarModeloLinkVendas.corpo).toBe(
      corpoSalvarModeloLinkVendasSchema,
    );
    expect(ROTAS_LINK_VENDAS.salvarModeloLinkVendas.sucesso.corpo).toBe(
      respostaLinksVendasSchema,
    );
  });

  it("a rota da hierarquia não aceita id de nada (o alvo vem só da sessão, D12): sem parâmetros, consulta nem corpo", () => {
    const rota: DefinicaoRota = ROTAS_LINK_VENDAS.meusLinksVendas;
    expect(rota.caminho).not.toContain(":");
    expect(rota.parametros).toBeUndefined();
    expect(rota.consulta).toBeUndefined();
    expect(rota.corpo).toBeUndefined();
  });

  it("não repete rota de nenhum outro catálogo, e ROTAS continua com só a visão em /api/minha", () => {
    const existentes = new Set(
      [
        ...Object.values(ROTAS),
        ...Object.values(ROTAS_ACESSO),
        ...Object.values(ROTAS_ACESSO_HIERARQUIA),
        ...Object.values(ROTAS_REGRAS_CAMPANHA),
        ...Object.values(ROTAS_TOKEN_WEBHOOK),
        ...Object.values(ROTAS_RELATORIO),
      ].map((rota) => `${rota.metodo} ${rota.caminho}`),
    );
    for (const rota of definicoes)
      expect(existentes.has(`${rota.metodo} ${rota.caminho}`)).toBe(false);
    expect(
      Object.values(ROTAS)
        .filter((rota) => rota.caminho.startsWith("/api/minha"))
        .map((rota) => rota.caminho),
    ).toEqual(["/api/minha/visao"]);
  });

  it("o index exporta o catálogo, os schemas e as regras", () => {
    expect(contrato.ROTAS_LINK_VENDAS).toBe(ROTAS_LINK_VENDAS);
    expect(contrato.respostaMeusLinksVendasSchema).toBe(
      respostaMeusLinksVendasSchema,
    );
    expect(contrato.montarLinkDeVendas).toBe(montarLinkDeVendas);
    expect(contrato.problemasDoModeloLinkVendas).toBe(
      problemasDoModeloLinkVendas,
    );
    expect(contrato.nomeDoArquivoQrLinkVendas).toBe(nomeDoArquivoQrLinkVendas);
  });

  it("link-vendas.ts não carrega o zod nem outro módulo do contrato (o site importa daqui)", () => {
    const declaracoes =
      fonteLinkVendas
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
        .match(/^(?:import|export)\b[^;]*?\bfrom\s+"[^"]+";/gms) ?? [];
    for (const declaracao of declaracoes)
      expect(declaracao).toMatch(/^import type\b/);
  });
});

describe("RIFA-070 (D32): o marcador {codigo}, o ref do link de vendas da Rifei", () => {
  const MODELO_REF = "https://rifei.com.br/{slug}?ref={codigo}";

  it("o modelo com {codigo} e sem {afiliado} é válido", () => {
    expect(problemasDoModeloLinkVendas(MODELO_REF)).toEqual([]);
    expect(modeloLinkVendasValido(MODELO_REF)).toBe(true);
  });

  it("monta o link com o código codificado; sem código, sem link", () => {
    expect(
      montarLinkDeVendas(MODELO_REF, {
        slug: "projeto-kids-1",
        affiliateId: 1978217,
        codigo: "thiago",
      }),
    ).toBe("https://rifei.com.br/projeto-kids-1?ref=thiago");
    expect(
      montarLinkDeVendas(MODELO_REF, {
        slug: "projeto-kids-1",
        affiliateId: 1,
        codigo: "célula 7",
      }),
    ).toBe("https://rifei.com.br/projeto-kids-1?ref=c%C3%A9lula%207");
    for (const codigo of [null, undefined, "", "  "])
      expect(
        montarLinkDeVendas(MODELO_REF, {
          slug: "projeto-kids-1",
          affiliateId: 1,
          codigo,
        }),
      ).toBeNull();
  });

  it("o código nunca muda o endereço de destino", () => {
    const url = montarLinkDeVendas(MODELO_REF, {
      slug: "x",
      affiliateId: 1,
      codigo: "a/../../golpe.example?b=",
    });
    expect(url).not.toBeNull();
    expect(new URL(url ?? "").hostname).toBe("rifei.com.br");
  });
});
