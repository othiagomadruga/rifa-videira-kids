// RIFA-046 (D24, OBRIGATÓRIO 3 a 5): o link de vendas de cada célula no app REAL (exports.default.fetch), com o D1
// local e o cenário do painel (2 redes, 4 discipuladores, 5 células com um afiliado cada), mais:
// - a Célula Ágape (1) com três afiliados: o 101 (o de sempre) e o 150 e o 160, vinculados depois, no mesmo instante;
// - a Célula Ebenézer (6), do Discipulador Boaz, sem afiliado;
// - o telefone e o e-mail de todo líder e o `rotulo` de todo afiliado preenchidos, com valores inconfundíveis.
// Os critérios de aceite:
// - CA1: o PUT do modelo só do admin (a coordenação leva 403 antes do corpo), o 400 com os problemas do modelo, o
//   vazio que desliga, a trilha com quem e quando (o mesmo modelo de novo não registra), 404 sem campanha ativa;
// - CA2: o PUT da campanha (coordenação e admin) não apaga o modelo, e trocar o slug muda os links na hora;
// - CA3: o escopo da /minha (o líder, só a célula dele; o discipulador e a rede, só as do alvo; um id na consulta é
//   ignorado) e o acesso desligado (D20), 403 como o resto da /minha;
// - CA4: célula com mais de um código (todos, do mais recente ao mais antigo), sem código (lista vazia), sem modelo e
//   com um modelo gravado à mão fora das regras (`configurado: false`, sem 500), vincular vale na hora;
// - CA5: a varredura das respostas (nenhum telefone, e-mail, rótulo ou valor; todo link em `eLinkDeVendas`).
// O orçamento do D1 (CA6) está em db/links-vendas.test.ts; a migração (CA7), em test/migrations.test.ts; a montagem
// pura, em lib/links-vendas.test.ts; a proteção das rotas, em src/worker/protecao.test.ts.
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  MENSAGENS_PADRAO,
  ROTAS_LINK_VENDAS,
  eLinkDeVendas,
  erroApiSchema,
  problemasDoModeloLinkVendas,
  respostaLinksVendasSchema,
  respostaMeusLinksVendasSchema,
  respostaSessaoSchema,
  type CelulaLinksVendas,
} from "../../shared/contracts";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
} from "../test/acesso-teste";
import {
  DADOS_CAMPANHA,
  camposDe,
  semearCenario,
  textosDe,
} from "../test/painel-apoio";

const db = env.DB;
const {
  linksVendas: LISTAR,
  salvarModeloLinkVendas: SALVAR,
  meusLinksVendas: MEUS,
} = ROTAS_LINK_VENDAS;
const MODELO = "https://rifei.com.br/{slug}?afiliado={afiliado}";
const OUTRO_MODELO = "https://rifei.com.br/{slug}/afiliado/{afiliado}";
const SLUG = DADOS_CAMPANHA.slug_rifei;

/** O link de um afiliado com o MODELO e o slug dado (o formato que o contrato monta). */
const link = (affiliateId: number, slug = SLUG) =>
  `https://rifei.com.br/${slug}?afiliado=${affiliateId}`;

/** Os dados pessoais e as notas internas gravados no banco, que nenhuma resposta pode trazer. */
const telefone = (celula: number) =>
  `(91) 98765-43${String(celula).padStart(2, "0")}`;
const email = (celula: number) => `lider${celula}@exemplo-privado.test`;
const rotulo = (afiliado: number) => `Nota interna do afiliado ${afiliado}`;

/** As células na ordem da hierarquia: Rede Adulta (Caleb: Dorcas, Éfeso), Rede Jovem (Abel: Ágape, Betel; Boaz: Canaã, Ebenézer). */
const ORDEM_DAS_CELULAS = [4, 5, 1, 2, 3, 6];
/** Os afiliados de cada célula, do vínculo mais recente para o mais antigo. */
const AFILIADOS_DA_CELULA: Record<number, number[]> = {
  1: [160, 150, 101],
  2: [102],
  3: [103],
  4: [104],
  5: [105],
  6: [],
};

type Metodo = "GET" | "PUT";

interface OpcoesRequisicao {
  /** Corpo: objeto vira JSON; texto vai cru. */
  corpo?: unknown;
  /** Content-Type do corpo; padrão application/json. null = sem o cabeçalho. */
  contentType?: string | null;
}

function requisitar(
  metodo: Metodo,
  caminho: string,
  cabecalhos: Record<string, string>,
  opcoes: OpcoesRequisicao = {},
): Promise<Response> {
  const headers = new Headers(cabecalhos);
  let body: string | undefined;
  if (opcoes.corpo !== undefined) {
    const tipo =
      opcoes.contentType === undefined
        ? "application/json"
        : opcoes.contentType;
    if (tipo !== null) headers.set("Content-Type", tipo);
    body =
      typeof opcoes.corpo === "string"
        ? opcoes.corpo
        : JSON.stringify(opcoes.corpo);
  }
  return exports.default.fetch(`${ORIGEM}${caminho}`, {
    method: metodo,
    headers,
    body,
  });
}

let admin: Record<string, string>;
let adminId: number;
let coordenacao: Record<string, string>;
let campanhaId: number;
/** Sessões da hierarquia: o líder da Ágape (1) e o da Ebenézer (6), os discipuladores Abel (10) e Boaz (20) e as redes. */
const sessoes = {} as Record<
  | "liderAgape"
  | "liderEbenezer"
  | "discipuladorAbel"
  | "discipuladorBoaz"
  | "redeJovem"
  | "redeAdulta",
  Record<string, string>
>;

beforeAll(async () => {
  ({ campanhaId } = await semearCenario());
  await db.batch([
    db.prepare(
      `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
       VALUES (6, 20, 'Célula Ebenézer', 9, 'Líder da Célula Ebenézer')`,
    ),
    db.prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em) VALUES
       (150, 1, 'manual', '2026-11-22T09:00:00.000Z'),
       (160, 1, 'manual', '2026-11-22T09:00:00.000Z')`,
    ),
    ...[1, 2, 3, 4, 5, 6].map((celula) =>
      db
        .prepare(
          "UPDATE celulas SET lider_telefone = ?2, lider_email = ?3 WHERE id = ?1",
        )
        .bind(celula, telefone(celula), email(celula)),
    ),
    db.prepare(
      "UPDATE afiliados SET rotulo = 'Nota interna do afiliado ' || affiliate_id",
    ),
  ]);
  const acessoAdmin = await cabecalhosDeSessao("admin");
  admin = acessoAdmin;
  const sessao = await requisitar("GET", "/api/sessao", admin);
  adminId = respostaSessaoSchema.parse(await sessao.json()).usuario.id;
  coordenacao = await cabecalhosDeSessao("coordenacao");
  sessoes.liderAgape = await cabecalhosDeSessaoDaHierarquia("lider", 1);
  sessoes.liderEbenezer = await cabecalhosDeSessaoDaHierarquia("lider", 6);
  sessoes.discipuladorAbel = await cabecalhosDeSessaoDaHierarquia(
    "discipulador",
    10,
  );
  sessoes.discipuladorBoaz = await cabecalhosDeSessaoDaHierarquia(
    "discipulador",
    20,
  );
  sessoes.redeJovem = await cabecalhosDeSessaoDaHierarquia("rede", 1);
  sessoes.redeAdulta = await cabecalhosDeSessaoDaHierarquia("rede", 2);
});

beforeEach(async () => {
  await db.batch([
    db
      .prepare(
        `UPDATE campanhas SET link_vendas_modelo = NULL, slug_rifei = ?2, acesso_discipuladores = 1, acesso_redes = 1,
           ativa = 1
         WHERE id = ?1`,
      )
      .bind(campanhaId, SLUG),
    db.prepare("DELETE FROM auditoria"),
  ]);
});

/** O modelo gravado direto no banco (como um admin teria salvo, ou à mão). */
async function gravarModelo(modelo: string | null): Promise<void> {
  await db
    .prepare("UPDATE campanhas SET link_vendas_modelo = ?2 WHERE id = ?1")
    .bind(campanhaId, modelo)
    .run();
}

async function modeloGravado(): Promise<string | null> {
  const linha = await db
    .prepare("SELECT link_vendas_modelo FROM campanhas WHERE id = ?1")
    .bind(campanhaId)
    .first<{ link_vendas_modelo: string | null }>();
  return linha?.link_vendas_modelo ?? null;
}

async function trilha() {
  return (
    await db
      .prepare(
        "SELECT usuario_id, em, acao, alvo, resumo FROM auditoria ORDER BY id",
      )
      .all<{
        usuario_id: number;
        em: string;
        acao: string;
        alvo: string;
        resumo: string;
      }>()
  ).results;
}

async function esperarErro(res: Response, status: number, codigo: string) {
  expect({ status: res.status, corpo: await res.json() }).toEqual({
    status,
    corpo: { erro: { codigo, mensagem: expect.any(String) } },
  });
}

/** 200 da coordenação no schema estrito, com no-store: devolve o corpo e o texto cru. */
async function lista(res: Response) {
  const texto = await res.text();
  expect({
    status: res.status,
    cache: res.headers.get("Cache-Control"),
  }).toEqual({ status: 200, cache: "no-store" });
  const corpo: unknown = JSON.parse(texto);
  const lida = respostaLinksVendasSchema.parse(corpo);
  expect(lida).toEqual(corpo);
  return { corpo: lida, texto };
}

/** 200 da /minha no schema estrito (que confere o escopo), com no-store. */
async function meus(res: Response) {
  const texto = await res.text();
  expect({
    status: res.status,
    cache: res.headers.get("Cache-Control"),
  }).toEqual({ status: 200, cache: "no-store" });
  const corpo: unknown = JSON.parse(texto);
  const lida = respostaMeusLinksVendasSchema.parse(corpo);
  expect(lida).toEqual(corpo);
  return { corpo: lida, texto };
}

const listar = (cabecalhos = admin) =>
  requisitar("GET", LISTAR.caminho, cabecalhos);
const salvar = (
  corpo: unknown,
  cabecalhos = admin,
  opcoes: OpcoesRequisicao = {},
) => requisitar("PUT", SALVAR.caminho, cabecalhos, { corpo, ...opcoes });
const verMeus = (cabecalhos: Record<string, string>, consulta = "") =>
  requisitar("GET", `${MEUS.caminho}${consulta}`, cabecalhos);

/** Célula → affiliate_ids dos links, na ordem. */
const linksPorCelula = (itens: readonly CelulaLinksVendas[]) =>
  Object.fromEntries(
    itens.map((item) => [
      item.celula_id,
      item.links.map((l) => l.affiliate_id),
    ]),
  );

// ---------------------------------------------------------------------------------------------------
// CA1: o PUT do modelo, só do admin
// ---------------------------------------------------------------------------------------------------

describe("CA1: PUT /api/admin/links-vendas/modelo, só do admin", () => {
  it("coordenação: 403 proibido ANTES do corpo (válido, inválido, que não é JSON ou sem Content-Type), e nada muda", async () => {
    const tentativas: [unknown, OpcoesRequisicao][] = [
      [{ modelo: MODELO }, {}],
      [{ modelo: "http://golpe.example/{afiliado}" }, {}],
      [{ modelo: MODELO, outro: 1 }, {}],
      ["isto não é json", {}],
      [{ modelo: MODELO }, { contentType: null }],
      [{ modelo: MODELO }, { contentType: "text/plain" }],
    ];
    for (const [corpo, opcoes] of tentativas)
      await esperarErro(
        await salvar(corpo, coordenacao, opcoes),
        403,
        "proibido",
      );
    expect(await modeloGravado()).toBeNull();
    expect(await trilha()).toEqual([]);
    // O GET continua da coordenação.
    expect((await lista(await listar(coordenacao))).corpo.modelo).toBeNull();
  });

  it("hierarquia: 403 no PUT e no GET da coordenação (e nada muda)", async () => {
    for (const sessao of [
      sessoes.liderAgape,
      sessoes.discipuladorAbel,
      sessoes.redeJovem,
    ]) {
      await esperarErro(
        await salvar({ modelo: MODELO }, sessao),
        403,
        "proibido",
      );
      await esperarErro(await listar(sessao), 403, "proibido");
    }
    expect(await modeloGravado()).toBeNull();
  });

  it.each([
    ["http (não https)", "http://rifei.com.br/{slug}?afiliado={afiliado}"],
    ["outro site", "https://golpe.example/{slug}?afiliado={afiliado}"],
    [
      "subdomínio da Rifei",
      "https://www.rifei.com.br/{slug}?afiliado={afiliado}",
    ],
    [
      "outro site depois do endereço",
      "https://rifei.com.br.golpe.example/{afiliado}",
    ],
    ["usuário no endereço", "https://rifei.com.br@golpe.example/{afiliado}"],
    [
      "outro endereço depois (//)",
      "https://rifei.com.br//golpe.example/{afiliado}",
    ],
    [
      "redirecionamento na consulta",
      "https://rifei.com.br/{slug}?afiliado={afiliado}&volta=https://golpe.example",
    ],
    ["sem {afiliado}", "https://rifei.com.br/{slug}"],
    [
      "marcador desconhecido",
      "https://rifei.com.br/{slug}?afiliado={afiliado}&n={nome}",
    ],
    ["chave solta", "https://rifei.com.br/{slug}?afiliado={afiliado}}"],
    ["espaço no meio", "https://rifei.com.br/{slug} ?afiliado={afiliado}"],
    ["invisível colado", "https://rifei.com.br/{slug}?afiliado={afiliado}​"],
  ])(
    "modelo inválido (%s): 400 requisicao_invalida com os problemas do contrato nos detalhes, e nada muda",
    async (_caso, modelo) => {
      const res = await salvar({ modelo });
      expect(res.status).toBe(400);
      const { erro } = erroApiSchema.parse(await res.json());
      expect(erro.codigo).toBe("requisicao_invalida");
      const problemas = problemasDoModeloLinkVendas(modelo.trim());
      expect(problemas.length).toBeGreaterThan(0);
      expect(
        (erro.detalhes as { caminho: unknown[]; mensagem: string }[]).map(
          (detalhe) => [detalhe.caminho, detalhe.mensagem],
        ),
      ).toEqual(problemas.map((problema) => [["modelo"], problema]));
      expect(await modeloGravado()).toBeNull();
      expect(await trilha()).toEqual([]);
    },
  );

  it("corpo fora do formato: 400 (campo a mais, sem modelo, tipo errado, longo demais); não JSON ou sem Content-Type JSON: 400 json_invalido", async () => {
    for (const corpo of [
      { modelo: MODELO, outro: 1 },
      {},
      { modelo: 42 },
      [],
      {
        modelo: `https://rifei.com.br/{slug}?afiliado={afiliado}&x=${"a".repeat(300)}`,
      },
    ]) {
      const res = await salvar(corpo);
      expect({
        status: res.status,
        codigo: erroApiSchema.parse(await res.json()).erro.codigo,
      }).toEqual({ status: 400, codigo: "requisicao_invalida" });
    }
    await esperarErro(await salvar("isto não é json"), 400, "json_invalido");
    await esperarErro(
      await salvar({ modelo: MODELO }, admin, { contentType: null }),
      400,
      "json_invalido",
    );
    await esperarErro(
      await salvar({ modelo: MODELO }, admin, { contentType: "text/plain" }),
      400,
      "json_invalido",
    );
    expect(await modeloGravado()).toBeNull();
    expect(await trilha()).toEqual([]);
  });

  it("o admin grava: 200 com a lista já montada; a trilha (campanha.salvar) registra quem e quando, com o antes e o depois; atualizado_em é o mesmo instante", async () => {
    const antes = new Date().toISOString();
    const { corpo } = await lista(await salvar({ modelo: MODELO }));
    const depois = new Date().toISOString();
    expect(corpo.modelo).toBe(MODELO);
    expect(corpo.configurado).toBe(true);
    expect(linksPorCelula(corpo.itens)).toEqual(AFILIADOS_DA_CELULA);
    expect(corpo.itens.find((item) => item.celula_id === 2)?.links).toEqual([
      { affiliate_id: 102, url: link(102) },
    ]);
    expect(await modeloGravado()).toBe(MODELO);

    const [registro] = await trilha();
    expect(registro).toEqual({
      usuario_id: adminId,
      em: expect.any(String),
      acao: "campanha.salvar",
      alvo: `campanha:${campanhaId}`,
      resumo: `Modelo do link de vendas: (vazio) → ${MODELO}`,
    });
    expect(registro.em >= antes && registro.em <= depois).toBe(true);
    const campanha = await db
      .prepare("SELECT atualizado_em FROM campanhas WHERE id = ?1")
      .bind(campanhaId)
      .first<{ atualizado_em: string }>();
    expect(campanha?.atualizado_em).toBe(registro.em);

    // Trocar: o antes e o depois.
    expect(
      (await lista(await salvar({ modelo: OUTRO_MODELO }))).corpo.modelo,
    ).toBe(OUTRO_MODELO);
    expect((await trilha()).map((linha) => linha.resumo)).toEqual([
      `Modelo do link de vendas: (vazio) → ${MODELO}`,
      `Modelo do link de vendas: ${MODELO} → ${OUTRO_MODELO}`,
    ]);
  });

  it("o mesmo modelo de novo (também com espaços nas pontas): 200 com a lista e sem linha nova na trilha", async () => {
    await lista(await salvar({ modelo: MODELO }));
    const { corpo } = await lista(await salvar({ modelo: `  ${MODELO}\n` }));
    expect(corpo.modelo).toBe(MODELO);
    await lista(await salvar({ modelo: MODELO }));
    expect(await trilha()).toHaveLength(1);
  });

  it('vazio desliga: "", só espaços e null gravam NULL; configurado false e nenhuma célula tem link; a trilha diz (vazio)', async () => {
    await lista(await salvar({ modelo: MODELO }));
    const { corpo } = await lista(await salvar({ modelo: "" }));
    expect(corpo).toMatchObject({ modelo: null, configurado: false });
    expect(corpo.itens).toHaveLength(ORDEM_DAS_CELULAS.length);
    expect(corpo.itens.every((item) => item.links.length === 0)).toBe(true);
    expect(await modeloGravado()).toBeNull();
    // Já vazio: nada muda nem registra.
    await lista(await salvar({ modelo: "   " }));
    await lista(await salvar({ modelo: null }));
    expect((await trilha()).map((linha) => linha.resumo)).toEqual([
      `Modelo do link de vendas: (vazio) → ${MODELO}`,
      `Modelo do link de vendas: ${MODELO} → (vazio)`,
    ]);
    // E a /minha diz que ainda não foi liberado.
    const { corpo: doLider } = await meus(await verMeus(sessoes.liderAgape));
    expect(doLider.configurado).toBe(false);
    expect(doLider.itens[0].links).toEqual([]);
  });

  it("sem campanha ativa: 404 no GET e no PUT (nada é gravado nem registrado) e na /minha", async () => {
    await db
      .prepare("UPDATE campanhas SET ativa = 0 WHERE id = ?1")
      .bind(campanhaId)
      .run();
    await esperarErro(await listar(), 404, "nao_encontrado");
    await esperarErro(await listar(coordenacao), 404, "nao_encontrado");
    await esperarErro(await salvar({ modelo: MODELO }), 404, "nao_encontrado");
    // O 400 vem antes do 404; o 403 da coordenação, antes de tudo.
    const invalido = await salvar({ modelo: "x" });
    expect({
      status: invalido.status,
      codigo: erroApiSchema.parse(await invalido.json()).erro.codigo,
    }).toEqual({ status: 400, codigo: "requisicao_invalida" });
    await esperarErro(
      await salvar({ modelo: MODELO }, coordenacao),
      403,
      "proibido",
    );
    for (const sessao of [
      sessoes.liderAgape,
      sessoes.discipuladorAbel,
      sessoes.redeJovem,
    ])
      await esperarErro(await verMeus(sessao), 404, "nao_encontrado");
    expect(await trilha()).toEqual([]);
    const modelos = await db
      .prepare(
        "SELECT count(*) AS n FROM campanhas WHERE link_vendas_modelo IS NOT NULL",
      )
      .first<{ n: number }>();
    expect(modelos?.n).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA2: o PUT da campanha não apaga o modelo; o slug muda os links na hora
// ---------------------------------------------------------------------------------------------------

describe("CA2: o PUT da campanha não apaga o modelo, e trocar o slug muda o link montado", () => {
  const putCampanha = (cabecalhos: Record<string, string>, corpo: unknown) =>
    requisitar("PUT", "/api/admin/campanha", cabecalhos, { corpo });

  it("coordenação e admin salvam a campanha (com outro slug): o modelo fica, e os links da coordenação e da /minha já saem com o slug novo", async () => {
    await lista(await salvar({ modelo: MODELO }));

    const daCoordenacao = await putCampanha(coordenacao, {
      ...DADOS_CAMPANHA,
      slug_rifei: "rifa-kids-novo-slug",
    });
    expect(daCoordenacao.status).toBe(200);
    expect(await modeloGravado()).toBe(MODELO);
    const { corpo } = await lista(await listar(coordenacao));
    expect(corpo.modelo).toBe(MODELO);
    expect(corpo.itens.find((item) => item.celula_id === 2)?.links).toEqual([
      { affiliate_id: 102, url: link(102, "rifa-kids-novo-slug") },
    ]);
    const { corpo: doLider } = await meus(await verMeus(sessoes.liderAgape));
    expect(doLider.itens[0].links.map((l) => l.url)).toEqual(
      [160, 150, 101].map((id) => link(id, "rifa-kids-novo-slug")),
    );

    // O admin, com os grupos só dele no corpo (como estão gravados): o UPSERT também não nomeia o modelo.
    const doAdmin = await putCampanha(admin, {
      ...DADOS_CAMPANHA,
      slug_rifei: "rifa-kids-outro-slug",
      pedidos: { desconsiderar: false },
      acesso: { discipuladores: true, redes: true },
      mensagens: MENSAGENS_PADRAO,
    });
    expect(doAdmin.status).toBe(200);
    expect(await modeloGravado()).toBe(MODELO);
    const { corpo: depois } = await lista(await listar());
    expect(depois.itens.find((item) => item.celula_id === 2)?.links).toEqual([
      { affiliate_id: 102, url: link(102, "rifa-kids-outro-slug") },
    ]);
    // A trilha: o modelo (1) e as duas campanhas, cada uma com o slug de antes e o de depois.
    expect((await trilha()).map((linha) => linha.resumo)).toEqual([
      `Modelo do link de vendas: (vazio) → ${MODELO}`,
      expect.stringContaining(
        'slug_rifei ("rifa-videira-kids-teste" → "rifa-kids-novo-slug")',
      ),
      expect.stringContaining(
        'slug_rifei ("rifa-kids-novo-slug" → "rifa-kids-outro-slug")',
      ),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA3: o escopo da /minha e o acesso desligado
// ---------------------------------------------------------------------------------------------------

describe("CA3: GET /api/minha/links-vendas, o escopo da visão individual (D12) e a chave de acesso (D20)", () => {
  beforeEach(async () => {
    await gravarModelo(MODELO);
  });

  const CONSULTAS_IGNORADAS = [
    "",
    "?celula_id=4",
    "?celula_id=4&discipulador_id=30&rede_id=2",
    "?alvo=rede&id=2",
  ];

  it.each(CONSULTAS_IGNORADAS)(
    "líder (consulta %j): só a célula dele, com os links; um id na consulta é ignorado",
    async (consulta) => {
      const { corpo } = await meus(await verMeus(sessoes.liderAgape, consulta));
      expect(corpo).toEqual({
        alvo: {
          tipo: "celula",
          id: 1,
          nome: "Célula Ágape",
          divisao: "jovens",
        },
        configurado: true,
        itens: [
          {
            celula_id: 1,
            celula_nome: "Célula Ágape",
            lider_nome: "Líder da Célula Ágape",
            discipulador_id: 10,
            discipulador_nome: "Discipulador Abel",
            rede_id: 1,
            rede_nome: "Rede Jovem Ficticia",
            divisao: "jovens",
            links: [160, 150, 101].map((id) => ({
              affiliate_id: id,
              url: link(id),
            })),
          },
        ],
      });
    },
  );

  it.each(CONSULTAS_IGNORADAS)(
    "discipulador e rede (consulta %j): só as células do alvo, na ordem da hierarquia",
    async (consulta) => {
      const celulas = async (sessao: Record<string, string>) =>
        (await meus(await verMeus(sessao, consulta))).corpo.itens.map(
          (item) => item.celula_id,
        );
      expect(await celulas(sessoes.discipuladorAbel)).toEqual([1, 2]);
      expect(await celulas(sessoes.discipuladorBoaz)).toEqual([3, 6]);
      expect(await celulas(sessoes.redeJovem)).toEqual([1, 2, 3, 6]);
      // A Rede Adulta: as do Caleb; o Davi não tem células.
      expect(await celulas(sessoes.redeAdulta)).toEqual([4, 5]);
    },
  );

  it.each(["discipulador", "rede"] as const)(
    "%s com o acesso do papel desligado na campanha: 403 acesso_desligado, como o resto da /minha; o líder segue com 200",
    async (papel) => {
      await db
        .prepare(
          `UPDATE campanhas SET ${papel === "discipulador" ? "acesso_discipuladores" : "acesso_redes"} = 0 WHERE id = ?1`,
        )
        .bind(campanhaId)
        .run();
      const res = await verMeus(
        papel === "discipulador" ? sessoes.discipuladorAbel : sessoes.redeJovem,
      );
      expect({ status: res.status, corpo: await res.json() }).toEqual({
        status: 403,
        corpo: {
          erro: {
            codigo: "acesso_desligado",
            mensagem: expect.any(String),
            detalhes: { papel },
          },
        },
      });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(
        (await meus(await verMeus(sessoes.liderAgape))).corpo.itens,
      ).toHaveLength(1);
    },
  );

  it("a coordenação e o admin levam 403 na /minha (eles usam a lista da Adesão)", async () => {
    await esperarErro(await verMeus(coordenacao), 403, "proibido");
    await esperarErro(await verMeus(admin), 403, "proibido");
  });
});

// ---------------------------------------------------------------------------------------------------
// CA4: mais de um código, sem código, sem modelo, modelo gravado à mão, vínculo na hora
// ---------------------------------------------------------------------------------------------------

describe("CA4: os links de cada célula", () => {
  it("a lista da coordenação: TODAS as células (a sem afiliado com links vazia), na ordem da hierarquia; mais de um código, do mais recente ao mais antigo", async () => {
    await gravarModelo(MODELO);
    const { corpo } = await lista(await listar(coordenacao));
    expect(corpo.itens.map((item) => item.celula_id)).toEqual(
      ORDEM_DAS_CELULAS,
    );
    expect(linksPorCelula(corpo.itens)).toEqual(AFILIADOS_DA_CELULA);
    // O afiliado sem célula (900) não aparece.
    expect(
      corpo.itens.flatMap((item) => item.links).map((l) => l.affiliate_id),
    ).not.toContain(900);
  });

  it("célula sem código: o líder dela recebe a célula com links vazia (configurado true)", async () => {
    await gravarModelo(MODELO);
    const { corpo } = await meus(await verMeus(sessoes.liderEbenezer));
    expect(corpo.configurado).toBe(true);
    expect(corpo.itens).toEqual([
      expect.objectContaining({
        celula_id: 6,
        celula_nome: "Célula Ebenézer",
        links: [],
      }),
    ]);
  });

  it("sem modelo: configurado false e nenhuma célula tem link, na coordenação e na /minha", async () => {
    const { corpo } = await lista(await listar());
    expect(corpo).toMatchObject({ modelo: null, configurado: false });
    expect(corpo.itens.every((item) => item.links.length === 0)).toBe(true);
    for (const sessao of Object.values(sessoes)) {
      const { corpo: meu } = await meus(await verMeus(sessao));
      expect(meu.configurado).toBe(false);
      expect(meu.itens.every((item) => item.links.length === 0)).toBe(true);
    }
  });

  it.each([
    ["outro site", "https://golpe.example/{slug}?afiliado={afiliado}"],
    ["http", "http://rifei.com.br/{slug}?afiliado={afiliado}"],
    ["sem {afiliado}", "https://rifei.com.br/{slug}"],
    ["outro endereço depois", "https://rifei.com.br//golpe.example/{afiliado}"],
    ["texto qualquer", "x"],
  ])(
    "modelo gravado à mão fora das regras (%s): 200 com configurado false, o modelo como está e nenhum link (sem 500)",
    async (_caso, modelo) => {
      await gravarModelo(modelo);
      const { corpo } = await lista(await listar(coordenacao));
      expect(corpo).toMatchObject({ modelo, configurado: false });
      expect(corpo.itens.every((item) => item.links.length === 0)).toBe(true);
      const { corpo: meu } = await meus(await verMeus(sessoes.redeJovem));
      expect(meu.configurado).toBe(false);
      expect(meu.itens.every((item) => item.links.length === 0)).toBe(true);
    },
  );

  it("sem cache: vincular um afiliado na Adesão dá o link na requisição seguinte; desvincular tira", async () => {
    await gravarModelo(MODELO);
    expect(
      (await meus(await verMeus(sessoes.liderEbenezer))).corpo.itens[0].links,
    ).toEqual([]);
    const vincular = (celula_id: number | null) =>
      requisitar("PUT", "/api/admin/afiliados/900", coordenacao, {
        corpo: { celula_id },
      });
    expect((await vincular(6)).status).toBe(200);
    expect(
      (await meus(await verMeus(sessoes.liderEbenezer))).corpo.itens[0].links,
    ).toEqual([{ affiliate_id: 900, url: link(900) }]);
    expect((await vincular(null)).status).toBe(200);
    expect(
      (await meus(await verMeus(sessoes.liderEbenezer))).corpo.itens[0].links,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA5: a varredura das respostas
// ---------------------------------------------------------------------------------------------------

describe("CA5: nenhuma resposta traz telefone, e-mail, rótulo ou valor; todo link é da Rifei", () => {
  /** Os únicos campos que as respostas podem ter. */
  const CAMPOS = new Set([
    "modelo",
    "configurado",
    "itens",
    "alvo",
    "tipo",
    "id",
    "nome",
    "divisao",
    "celula_id",
    "celula_nome",
    "lider_nome",
    "discipulador_id",
    "discipulador_nome",
    "rede_id",
    "rede_nome",
    "links",
    "affiliate_id",
    "url",
  ]);
  /** Os únicos números: ids da hierarquia e dos afiliados. */
  const IDS = new Set([
    1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 101, 102, 103, 104, 105, 150, 160, 900,
  ]);
  const PROIBIDOS = [
    ...[1, 2, 3, 4, 5, 6].flatMap((celula) => [
      telefone(celula),
      telefone(celula).replace(/\D/g, ""),
      `98765-43${String(celula).padStart(2, "0")}`,
      email(celula),
    ]),
    ...[101, 102, 103, 104, 105, 150, 160, 900].map(rotulo),
    "Nota interna",
    "@",
    "R$",
    "centavo",
    "bilhete",
  ];

  /** Todos os números do JSON, em qualquer nível. */
  function numerosDe(valor: unknown, numeros: number[] = []): number[] {
    if (typeof valor === "number") numeros.push(valor);
    else if (Array.isArray(valor))
      for (const item of valor) numerosDe(item, numeros);
    else if (valor !== null && typeof valor === "object")
      for (const item of Object.values(valor)) numerosDe(item, numeros);
    return numeros;
  }

  /** Todos os `url` do JSON. */
  function urlsDe(valor: unknown, urls: string[] = []): string[] {
    if (Array.isArray(valor)) for (const item of valor) urlsDe(item, urls);
    else if (valor !== null && typeof valor === "object")
      for (const [campo, item] of Object.entries(valor)) {
        if (campo === "url" && typeof item === "string") urls.push(item);
        else urlsDe(item, urls);
      }
    return urls;
  }

  it("a lista da coordenação, a resposta do PUT e a /minha dos três papéis, com tudo preenchido no banco", async () => {
    const respostas: { nome: string; texto: string; corpo: unknown }[] = [];
    const salvo = await lista(await salvar({ modelo: MODELO }));
    respostas.push({ nome: "PUT", ...salvo });
    for (const [nome, cabecalhos] of [
      ["admin", admin],
      ["coordenacao", coordenacao],
    ] as const)
      respostas.push({ nome, ...(await lista(await listar(cabecalhos))) });
    for (const [nome, sessao] of Object.entries(sessoes))
      respostas.push({ nome, ...(await meus(await verMeus(sessao))) });

    let totalDeLinks = 0;
    for (const { nome, texto, corpo } of respostas) {
      expect({
        nome,
        fora: [...camposDe(corpo)].filter((campo) => !CAMPOS.has(campo)),
      }).toEqual({
        nome,
        fora: [],
      });
      expect({
        nome,
        numeros: numerosDe(corpo).filter((n) => !IDS.has(n)),
      }).toEqual({
        nome,
        numeros: [],
      });
      for (const proibido of PROIBIDOS)
        expect({ nome, proibido, aparece: texto.includes(proibido) }).toEqual({
          nome,
          proibido,
          aparece: false,
        });
      // Os textos: só nomes da hierarquia, o modelo (na coordenação), a divisão, o tipo do alvo e os links.
      for (const textoDoCorpo of textosDe(corpo))
        expect(textoDoCorpo).not.toMatch(/\d{4,}-?\d{4}|@/);
      const urls = urlsDe(corpo);
      for (const url of urls) {
        expect({ nome, url, valido: eLinkDeVendas(url) }).toEqual({
          nome,
          url,
          valido: true,
        });
        expect(url.startsWith("https://rifei.com.br/")).toBe(true);
      }
      totalDeLinks += urls.length;
    }
    // A conferência não ficou vazia: os links saíram (o PUT, o admin e a coordenação, 7 cada; a /minha: o líder da
    // Ágape 3, o da Ebenézer 0, o Abel 4, o Boaz 1, a Rede Jovem 5 e a Adulta 2).
    expect(totalDeLinks).toBe(3 * 7 + 3 + 0 + 4 + 1 + 5 + 2);
  });
});
