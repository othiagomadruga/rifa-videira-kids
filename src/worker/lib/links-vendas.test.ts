// RIFA-046 (D24, OBRIGATÓRIO 2): a montagem das respostas do link de vendas, sem banco (lib/links-vendas.ts é puro).
// A ordem das células (pelo caminho na hierarquia, em português) e a dos links de uma célula (do vínculo mais recente
// para o mais antigo), `configurado`, o afiliado sem link deixado de fora, a montagem só por montarLinkDeVendas e as
// respostas no schema estrito. A leitura do banco, o escopo e as rotas estão em db/links-vendas.test.ts e
// routes/links-vendas.test.ts.
import { describe, expect, it } from "vitest";
import {
  eLinkDeVendas,
  montarLinkDeVendas,
  respostaLinksVendasSchema,
  respostaMeusLinksVendasSchema,
} from "../../shared/contracts";
import type {
  AfiliadoDoEscopo,
  CelulaDoEscopo,
  LeituraLinksVendas,
} from "../db/links-vendas";
import {
  doVinculoMaisRecente,
  montarItensLinksVendas,
  montarRespostaLinksVendas,
  montarRespostaMeusLinksVendas,
  pelaHierarquia,
} from "./links-vendas";

const MODELO = "https://rifei.com.br/{slug}?afiliado={afiliado}";
const SLUG = "rifa-videira-kids";

const JOVEM = { rede_id: 1, rede_nome: "Rede Jovem", divisao: "jovens" };
const ADULTA = { rede_id: 2, rede_nome: "Rede Adulta", divisao: "adultos" };

function celula(
  celula_id: number,
  celula_nome: string,
  discipulador: { id: number; nome: string },
  rede: typeof JOVEM,
): CelulaDoEscopo {
  return {
    celula_id,
    celula_nome,
    lider_nome: `Líder ${celula_id}`,
    discipulador_id: discipulador.id,
    discipulador_nome: discipulador.nome,
    rede_id: rede.rede_id,
    rede_nome: rede.rede_nome,
    divisao: rede.divisao as CelulaDoEscopo["divisao"],
  };
}

const ABEL = { id: 10, nome: "Discipulador Abel" };
const ZACARIAS = { id: 11, nome: "Discipulador Zacarias" };
const ELIAS = { id: 20, nome: "Discipulador Élias" };

/** Fora de ordem de propósito (como o banco pode devolver). */
const CELULAS: CelulaDoEscopo[] = [
  celula(5, "Célula 10", ABEL, JOVEM),
  celula(1, "Célula Betel", ZACARIAS, JOVEM),
  celula(2, "Célula Ágape", ABEL, JOVEM),
  celula(3, "Célula 2", ABEL, JOVEM),
  celula(4, "Célula Canaã", ELIAS, ADULTA),
];

const vinculado = (
  affiliate_id: number,
  celula_id: number,
  vinculado_em: string,
): AfiliadoDoEscopo => ({ affiliate_id, celula_id, vinculado_em });

const AFILIADOS: AfiliadoDoEscopo[] = [
  vinculado(101, 2, "2026-11-20T12:00:00.000Z"),
  vinculado(150, 2, "2026-11-22T09:00:00.000Z"),
  // Mesmo instante do 150: o maior id primeiro.
  vinculado(160, 2, "2026-11-22T09:00:00.000Z"),
  vinculado(102, 1, "2026-11-20T12:00:00.000Z"),
  vinculado(104, 4, "2026-11-21T08:00:00.000Z"),
  // As células 3 e 5 ficam sem afiliado.
];

const leitura = (
  modelo: string | null,
  extras: Partial<LeituraLinksVendas> = {},
): LeituraLinksVendas => ({
  campanha: { id: 7, slug_rifei: SLUG, link_vendas_modelo: modelo },
  celulas: CELULAS,
  afiliados: AFILIADOS,
  ...extras,
});

const link = (affiliateId: number) =>
  `https://rifei.com.br/${SLUG}?afiliado=${affiliateId}`;

describe("a ordem", () => {
  it("células pelo caminho na hierarquia, em português: a rede, o discipulador e a célula (acento e número)", () => {
    const { itens } = montarItensLinksVendas(leitura(MODELO));
    expect(
      itens.map((item) => [
        item.rede_nome,
        item.discipulador_nome,
        item.celula_nome,
      ]),
    ).toEqual([
      // "Rede Adulta" antes de "Rede Jovem".
      ["Rede Adulta", "Discipulador Élias", "Célula Canaã"],
      // Abel antes de Zacarias; "Célula 2" antes de "Célula 10" (numérico) e "Ágape" antes de "Betel" (sem acento).
      ["Rede Jovem", "Discipulador Abel", "Célula 2"],
      ["Rede Jovem", "Discipulador Abel", "Célula 10"],
      ["Rede Jovem", "Discipulador Abel", "Célula Ágape"],
      ["Rede Jovem", "Discipulador Zacarias", "Célula Betel"],
    ]);
  });

  it("nomes iguais (sem diferenciar maiúsculas e acentos): pelo id", () => {
    const a = celula(9, "Célula Ágape", ABEL, JOVEM);
    const b = celula(3, "celula agape", ABEL, JOVEM);
    expect([a, b].sort(pelaHierarquia).map((item) => item.celula_id)).toEqual([
      3, 9,
    ]);
  });

  it("links de uma célula: do vínculo mais recente para o mais antigo; mesmo instante, o maior affiliate_id primeiro", () => {
    expect(
      [...AFILIADOS]
        .filter((afiliado) => afiliado.celula_id === 2)
        .sort(doVinculoMaisRecente)
        .map((afiliado) => afiliado.affiliate_id),
    ).toEqual([160, 150, 101]);
    const agape = montarItensLinksVendas(leitura(MODELO)).itens.find(
      (item) => item.celula_id === 2,
    );
    expect(agape?.links).toEqual([
      { affiliate_id: 160, url: link(160) },
      { affiliate_id: 150, url: link(150) },
      { affiliate_id: 101, url: link(101) },
    ]);
  });

  it("não depende da ordem em que o banco devolve as linhas", () => {
    const invertida = leitura(MODELO, {
      celulas: [...CELULAS].reverse(),
      afiliados: [...AFILIADOS].reverse(),
    });
    expect(montarItensLinksVendas(invertida)).toEqual(
      montarItensLinksVendas(leitura(MODELO)),
    );
  });
});

describe("os links", () => {
  it("cada afiliado ganha o link de montarLinkDeVendas; célula sem afiliado, links vazia", () => {
    const { configurado, itens } = montarItensLinksVendas(leitura(MODELO));
    expect(configurado).toBe(true);
    expect(
      Object.fromEntries(
        itens.map((item) => [
          item.celula_id,
          item.links.map((l) => l.affiliate_id),
        ]),
      ),
    ).toEqual({ 1: [102], 2: [160, 150, 101], 3: [], 4: [104], 5: [] });
    for (const item of itens)
      for (const { affiliate_id, url } of item.links) {
        expect(url).toBe(
          montarLinkDeVendas(MODELO, { slug: SLUG, affiliateId: affiliate_id }),
        );
        expect(eLinkDeVendas(url)).toBe(true);
      }
  });

  it("o slug entra codificado (encodeURIComponent) e o link sai na forma canônica", () => {
    const { itens } = montarItensLinksVendas(
      leitura("https://rifei.com.br/{slug}/afiliado/{afiliado}", {
        campanha: {
          id: 7,
          slug_rifei: "rifa kids?x=1#ágape",
          link_vendas_modelo: "https://rifei.com.br/{slug}/afiliado/{afiliado}",
        },
      }),
    );
    expect(itens.find((item) => item.celula_id === 1)?.links).toEqual([
      {
        affiliate_id: 102,
        url: "https://rifei.com.br/rifa%20kids%3Fx%3D1%23%C3%A1gape/afiliado/102",
      },
    ]);
  });

  it.each([
    ["sem modelo (o PO ainda não confirmou o formato)", null],
    [
      "modelo gravado à mão em outro endereço",
      "https://golpe.example/{afiliado}",
    ],
    ["modelo gravado à mão sem {afiliado}", "https://rifei.com.br/{slug}"],
    [
      "modelo gravado à mão com outro endereço depois",
      "https://rifei.com.br//golpe.example/{afiliado}",
    ],
    [
      "modelo gravado à mão com espaço",
      "https://rifei.com.br/{slug} ?a={afiliado}",
    ],
  ])(
    "%s: configurado false e nenhuma célula tem link (sem erro)",
    (_caso, modelo) => {
      const resposta = montarRespostaLinksVendas(leitura(modelo));
      expect(resposta.configurado).toBe(false);
      expect(resposta.modelo).toBe(modelo);
      expect(resposta.itens).toHaveLength(CELULAS.length);
      expect(resposta.itens.every((item) => item.links.length === 0)).toBe(
        true,
      );
      expect(respostaLinksVendasSchema.parse(resposta)).toEqual(resposta);
    },
  );

  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["um ponto (o URL apagaria o segmento)", "."],
    ["dois pontos", ".."],
    ["um surrogate solto (o encodeURIComponent recusa)", "rifa-\uD800"],
  ])(
    "slug que não forma um link (%s): o modelo serve, mas os afiliados ficam sem link (sem erro)",
    (_caso, slug) => {
      const resposta = montarRespostaLinksVendas(
        leitura(MODELO, {
          campanha: { id: 7, slug_rifei: slug, link_vendas_modelo: MODELO },
        }),
      );
      expect(resposta.configurado).toBe(true);
      expect(resposta.itens.every((item) => item.links.length === 0)).toBe(
        true,
      );
      expect(respostaLinksVendasSchema.parse(resposta)).toEqual(resposta);
    },
  );

  it("um afiliado com id fora do formato fica de fora; os outros da célula continuam", () => {
    const { itens } = montarItensLinksVendas(
      leitura(MODELO, {
        afiliados: [
          vinculado(0, 1, "2026-11-23T00:00:00.000Z"),
          vinculado(1.5, 1, "2026-11-23T00:00:00.000Z"),
          vinculado(102, 1, "2026-11-20T12:00:00.000Z"),
        ],
      }),
    );
    expect(itens.find((item) => item.celula_id === 1)?.links).toEqual([
      { affiliate_id: 102, url: link(102) },
    ]);
  });
});

describe("as respostas", () => {
  it("a da coordenação: o modelo como está gravado, configurado e todas as células, no schema estrito", () => {
    const resposta = montarRespostaLinksVendas(leitura(MODELO));
    expect(Object.keys(resposta).sort()).toEqual([
      "configurado",
      "itens",
      "modelo",
    ]);
    expect(resposta.modelo).toBe(MODELO);
    expect(respostaLinksVendasSchema.parse(resposta)).toEqual(resposta);
  });

  it("cada célula é montada campo a campo: uma coluna a mais na leitura (telefone, e-mail, rótulo) não chega à resposta", () => {
    const comExtras = leitura(MODELO, {
      celulas: CELULAS.map((item) => ({
        ...item,
        lider_telefone: "(91) 98888-7777",
        lider_email: "lider@example.com",
      })),
      afiliados: AFILIADOS.map((afiliado) => ({
        ...afiliado,
        rotulo: "nota interna",
        total_centavos: 123_456,
      })),
    });
    const texto = JSON.stringify(montarRespostaLinksVendas(comExtras));
    for (const proibido of [
      "98888",
      "lider@example.com",
      "nota interna",
      "123456",
      "vinculado_em",
      "2026-11-",
    ])
      expect(texto).not.toContain(proibido);
    expect(montarRespostaLinksVendas(comExtras)).toEqual(
      montarRespostaLinksVendas(leitura(MODELO)),
    );
  });

  it("a da hierarquia: o alvo campo a campo, sem o modelo, no schema estrito (o escopo conferido nele)", () => {
    const alvo = {
      tipo: "discipulador" as const,
      id: ABEL.id,
      nome: ABEL.nome,
      divisao: "jovens" as const,
    };
    const resposta = montarRespostaMeusLinksVendas(
      leitura(MODELO, {
        celulas: CELULAS.filter((item) => item.discipulador_id === ABEL.id),
      }),
      { ...alvo, extra: "não sai" } as typeof alvo,
    );
    expect(resposta.alvo).toEqual(alvo);
    expect(Object.keys(resposta).sort()).toEqual([
      "alvo",
      "configurado",
      "itens",
    ]);
    expect(respostaMeusLinksVendasSchema.parse(resposta)).toEqual(resposta);
    expect(resposta.itens.map((item) => item.celula_id)).toEqual([3, 5, 2]);
  });
});
