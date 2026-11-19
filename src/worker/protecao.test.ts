// INT-1: proteção das rotas da coordenação no app REAL (src/worker/index.ts, via exports.default.fetch).
// Uma rota de /api/admin/* ou /api/painel/* aberta vazaria os contatos dos líderes e deixaria mudar a
// configuração da campanha. Aqui se prova, com a ordem de montagem do index.ts, que:
// a) toda rota da coordenação (do contrato e registrada no app) exige sessão, e as só de admin recusam
//    a coordenação;
// b) o middleware cobre os prefixos inteiros: caminho sem rota também dá 401, e não 404;
// c) escrita de outra origem é recusada (CSRF), mesmo com sessão de admin, e nada é gravado;
// d) os cabeçalhos de segurança saem em 200, 401, 403 e 404, e o webhook segue só com o Bearer;
// e) o painel (RIFA-PAINEL) fica atrás do login e a visão pública fica aberta, sem nenhum valor, e só
//    ela passa pelo cache de 30 s (relógio fixo: nada depende do dia em que o teste roda);
// g) os papéis da hierarquia (RIFA-014, D12) levam 403 em toda rota de /api/admin e /api/painel, e todo
//    caminho de /api/minha exige a sessão de um deles (sem sessão, 401; coordenação, 403);
// h) com o acesso do papel desligado na campanha (RIFA-029, D20), o discipulador e a rede levam 403
//    `acesso_desligado` em todo /api/minha e no login, o líder não muda, e tudo volta com a chave;
// i) o login da célula com a senha padrão (RIFA-064, D29) abre só a sessão do líder da célula: 403 em toda a
//    coordenação, a /minha só da própria célula, CSRF, e a chave desligada derruba a sessão aberta pela senha;
// j) o login do admin com usuário e senha (RIFA-073, D33) abre a sessão do admin (a mesma do link); a senha do admin é
//    só do papel admin (coordenação e hierarquia: 403), o login é aberto mas com CSRF, e remover a senha derruba a sessão;
// e o formato único de erro vale em todas as partes montadas.
import { env, exports } from "cloudflare:workers";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import paidOrderAfiliado from "../../test/fixtures/rifei/paid_order.afiliado.json";
import {
  JANELAS_RANKING,
  NIVEIS_RANKING,
  PAPEIS_HIERARQUIA,
  ROTAS,
  ROTAS_ACESSO,
  ROTAS_ACESSO_HIERARQUIA,
  ROTAS_LINK_VENDAS,
  ROTAS_REGRAS_CAMPANHA,
  ROTAS_RELATORIO,
  ROTAS_TOKEN_WEBHOOK,
  afiliadoResumoSchema,
  campanhaEntradaSchema,
  diasEntre,
  erroApiSchema,
  hojeNoFuso,
  respostaAdesaoSchema,
  respostaAuditoriaSchema,
  respostaBumboSchema,
  respostaListaAfiliadosSchema,
  respostaListaRecuperacoesSchema,
  respostaMeusLinksVendasSchema,
  respostaPainelResumoSchema,
  respostaPedidosSuspeitosSchema,
  respostaRankingPublicoSchema,
  respostaRankingSchema,
  respostaSessaoSchema,
  respostaVisaoIndividualSchema,
  respostaWebhookRifeiSchema,
  somarDias,
  type CodigoErro,
  type Papel,
  type PapelHierarquia,
} from "../shared/contracts";
import app from "./index";
import { TTL_CACHE_PUBLICO_MS } from "./lib/cache-publico";
import { CABECALHOS_SEGURANCA } from "./middleware/cabecalhos-seguranca";
import { CACHE_PUBLICO } from "./routes/publico";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
  criarAcessoDaHierarquiaNoBanco,
} from "./test/acesso-teste";
import {
  CAMPOS_PUBLICOS,
  CAMPO_DE_VALOR,
  DADOS_CAMPANHA,
  PEDIDOS,
  TEXTO_DE_VALOR,
  camposDe,
  deslocarPedidos,
  semearCenario,
  textosDe,
} from "./test/painel-apoio";

const ESCRITAS = ["POST", "PUT", "PATCH", "DELETE"] as const;
type Metodo = "GET" | (typeof ESCRITAS)[number];

const ORIGEM_MALICIOSA = "https://site-malicioso.example";
/** Prefixos da coordenação: tudo abaixo deles exige sessão (index.ts, passo 4). */
const PREFIXOS_COORDENACAO = ["/api/admin", "/api/painel"] as const;
/** Id que não existe no banco: as chamadas com sessão não alteram nenhum registro. */
const ID_INEXISTENTE = "999999";

function eDaCoordenacao(caminho: string): boolean {
  return PREFIXOS_COORDENACAO.some(
    (prefixo) => caminho === prefixo || caminho.startsWith(`${prefixo}/`),
  );
}

/** "/api/admin/redes/:id" → "/api/admin/redes/999999". */
function concreto(caminho: string): string {
  return caminho.replace(/:[A-Za-z]+/g, ID_INEXISTENTE);
}

interface RotaDaCoordenacao {
  metodo: Metodo;
  caminho: string;
  papeis: readonly Papel[];
}

/**
 * Grupo `coordenacao` do contrato: ROTAS (admin e coordenacao, ou os `papeis` da rota quando ela é mais
 * restrita, como a auditoria e as regras da campanha), ROTAS_ACESSO e ROTAS_ACESSO_HIERARQUIA (papéis da própria
 * rota), ROTAS_REGRAS_CAMPANHA (Sprint 6, D20: só admin), ROTAS_TOKEN_WEBHOOK (RIFA-039, D21: só admin),
 * ROTAS_RELATORIO (RIFA-038, D23: admin e coordenação) e ROTAS_LINK_VENDAS (RIFA-046, D24: a lista de admin e coordenação
 * e o PUT do modelo só de admin; a visão da hierarquia, em /api/minha, fica no filtro de fora). O relatório entrou aqui
 * já no contrato (sem `papeis`, ele passava nos três testes mesmo antes de montado) e o primeiro teste abaixo confere que
 * ele está registrado no app; com sessão, sem `tipo`, ele responde o 400 do formato único (passou do login).
 */
const ROTAS_DA_COORDENACAO: RotaDaCoordenacao[] = [
  ...[
    ...Object.values(ROTAS),
    ...Object.values(ROTAS_REGRAS_CAMPANHA),
    ...Object.values(ROTAS_TOKEN_WEBHOOK),
    ...Object.values(ROTAS_RELATORIO),
    ...Object.values(ROTAS_LINK_VENDAS),
  ]
    .filter((rota) => rota.grupo === "coordenacao")
    .map((rota) => ({
      metodo: rota.metodo,
      caminho: rota.caminho,
      papeis:
        "papeis" in rota ? rota.papeis : (["admin", "coordenacao"] as const),
    })),
  ...[...Object.values(ROTAS_ACESSO), ...Object.values(ROTAS_ACESSO_HIERARQUIA)]
    .filter((rota) => rota.grupo === "coordenacao")
    .map((rota) => {
      if (rota.papeis === null)
        throw new Error(`${rota.caminho}: rota da coordenação sem papéis`);
      return {
        metodo: rota.metodo,
        caminho: rota.caminho,
        papeis: rota.papeis,
      };
    }),
];

const casos = (rotas: RotaDaCoordenacao[]) =>
  rotas.map((rota) => [`${rota.metodo} ${rota.caminho}`, rota] as const);

/** Requisição ao Worker de verdade. Escritas levam corpo JSON "{}" (os handlers recusam com 400). */
function requisitar(
  metodo: Metodo,
  caminho: string,
  cabecalhos: Record<string, string> = {},
  corpo = "{}",
): Promise<Response> {
  const headers = new Headers(cabecalhos);
  const escrita = metodo !== "GET";
  if (escrita) headers.set("Content-Type", "application/json");
  return exports.default.fetch(`${ORIGEM}${caminho}`, {
    method: metodo,
    headers,
    body: escrita ? corpo : undefined,
  });
}

/** Status e corpo exatos de um erro sem detalhes, no formato único. */
async function esperarErro(
  res: Response,
  status: number,
  codigo: CodigoErro,
): Promise<void> {
  expect({ status: res.status, corpo: await res.json() }).toEqual({
    status,
    corpo: { erro: { codigo, mensagem: expect.any(String) } },
  });
}

/** Passou da sessão: nem 401 nem 403, e um erro do handler (400, 404...) vem no formato único. */
async function esperarQuePassou(res: Response): Promise<void> {
  expect([401, 403]).not.toContain(res.status);
  if (res.status >= 400) {
    const corpo: unknown = await res.json();
    expect(erroApiSchema.parse(corpo)).toEqual(corpo);
  }
}

function esperarCabecalhosDeSeguranca(res: Response): void {
  const recebidos = Object.fromEntries(
    Object.keys(CABECALHOS_SEGURANCA).map((nome) => [
      nome,
      res.headers.get(nome),
    ]),
  );
  expect(recebidos).toEqual(CABECALHOS_SEGURANCA);
}

/** Rotas registradas no app (sem os middlewares, que o Hono registra com o método ALL). */
function rotasRegistradas(): { metodo: Metodo; caminho: string }[] {
  const vistas = new Map<string, { metodo: Metodo; caminho: string }>();
  for (const { method, path } of app.routes) {
    if (method === "ALL") continue;
    vistas.set(`${method} ${path}`, {
      metodo: method as Metodo,
      caminho: path,
    });
  }
  return [...vistas.values()];
}

/** Grupo de cada rota do contrato, por "MÉTODO caminho" (sem a barra final do webhook). */
const GRUPO_NO_CONTRATO = new Map(
  [
    ...Object.values(ROTAS),
    ...Object.values(ROTAS_ACESSO),
    ...Object.values(ROTAS_ACESSO_HIERARQUIA),
    ...Object.values(ROTAS_REGRAS_CAMPANHA),
    ...Object.values(ROTAS_TOKEN_WEBHOOK),
    ...Object.values(ROTAS_RELATORIO),
    ...Object.values(ROTAS_LINK_VENDAS),
  ].map((rota): [string, string] => [
    `${rota.metodo} ${rota.caminho}`,
    rota.grupo,
  ]),
);

let coordenacao: Record<string, string>;
let admin: Record<string, string>;

beforeAll(async () => {
  coordenacao = await cabecalhosDeSessao("coordenacao");
  admin = await cabecalhosDeSessao("admin");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a) toda rota da coordenação exige sessão", () => {
  it("o contrato tem as rotas esperadas da coordenação (o filtro não ficou vazio)", () => {
    // 24 de ROTAS + 6 de ROTAS_ACESSO (5 só de admin e o GET /api/sessao) na Sprint 2; a auditoria (só admin)
    // na Sprint 4; as 2 de ROTAS_ACESSO_HIERARQUIA (só admin) na Sprint 5; as 3 de ROTAS_REGRAS_CAMPANHA (só
    // admin) na Sprint 6; as 2 de ROTAS_TOKEN_WEBHOOK (só admin) na RIFA-039; a de ROTAS_RELATORIO (admin e
    // coordenação) na RIFA-038; as 2 de ROTAS_LINK_VENDAS da coordenação (a lista, de admin e coordenação, e o PUT
    // do modelo, só de admin) na RIFA-046.
    expect(ROTAS_DA_COORDENACAO.length).toBeGreaterThanOrEqual(41);
    expect(
      ROTAS_DA_COORDENACAO.filter(
        (rota) => !rota.papeis.includes("coordenacao"),
      ).length,
    ).toBeGreaterThanOrEqual(14);
    // As regras da campanha (D20) e o token do webhook (D21) estão todos no filtro, só de admin, e montados no app.
    const registradas = rotasRegistradas().map(
      (rota) => `${rota.metodo} ${rota.caminho}`,
    );
    for (const rota of [
      ...Object.values(ROTAS_REGRAS_CAMPANHA),
      ...Object.values(ROTAS_TOKEN_WEBHOOK),
    ]) {
      expect(
        ROTAS_DA_COORDENACAO.find(
          (item) =>
            item.metodo === rota.metodo && item.caminho === rota.caminho,
        )?.papeis,
      ).toEqual(["admin"]);
      expect(registradas).toContain(`${rota.metodo} ${rota.caminho}`);
    }
    // O relatório (D23) está no filtro, para admin e coordenação, e montado no app (RIFA-038-api).
    expect(
      ROTAS_DA_COORDENACAO.find(
        (item) =>
          item.metodo === "GET" &&
          item.caminho === ROTAS_RELATORIO.baixarRelatorio.caminho,
      )?.papeis,
    ).toEqual(["admin", "coordenacao"]);
    expect(registradas).toContain("GET /api/painel/relatorio");
    // O link de vendas (D24): a lista para admin e coordenação, o PUT do modelo só de admin, os dois montados; a visão
    // da hierarquia (em /api/minha) fora do filtro da coordenação.
    const doFiltro = (rota: { metodo: string; caminho: string }) =>
      ROTAS_DA_COORDENACAO.find(
        (item) => item.metodo === rota.metodo && item.caminho === rota.caminho,
      )?.papeis;
    expect(doFiltro(ROTAS_LINK_VENDAS.linksVendas)).toEqual([
      "admin",
      "coordenacao",
    ]);
    expect(doFiltro(ROTAS_LINK_VENDAS.salvarModeloLinkVendas)).toEqual([
      "admin",
    ]);
    expect(doFiltro(ROTAS_LINK_VENDAS.meusLinksVendas)).toBeUndefined();
    for (const rota of Object.values(ROTAS_LINK_VENDAS))
      expect(registradas).toContain(`${rota.metodo} ${rota.caminho}`);
  });

  it.each(casos(ROTAS_DA_COORDENACAO))(
    "%s sem cookie: 401 nao_autenticado",
    async (_rota, rota) => {
      const res = await requisitar(rota.metodo, concreto(rota.caminho), {
        Origin: ORIGEM,
      });

      await esperarErro(res, 401, "nao_autenticado");
    },
  );

  it.each(casos(ROTAS_DA_COORDENACAO))(
    "%s com sessão de coordenacao: 403 se a rota é só de admin; senão, passa",
    async (_rota, rota) => {
      const res = await requisitar(
        rota.metodo,
        concreto(rota.caminho),
        coordenacao,
      );

      if (rota.papeis.includes("coordenacao")) await esperarQuePassou(res);
      else await esperarErro(res, 403, "proibido");
    },
  );

  it.each(casos(ROTAS_DA_COORDENACAO))(
    "%s com sessão de admin: passa",
    async (_rota, rota) => {
      const res = await requisitar(rota.metodo, concreto(rota.caminho), admin);

      await esperarQuePassou(res);
    },
  );

  it("toda rota registrada no app sob /api/admin e /api/painel responde 401 sem cookie (inclusive fora do contrato)", async () => {
    const protegidas = rotasRegistradas().filter((rota) =>
      eDaCoordenacao(rota.caminho),
    );
    // Sprint 2: hierarquia (16), usuários e links (5), campanha (2) e afiliados e adesão (3).
    expect(protegidas.length).toBeGreaterThanOrEqual(26);

    for (const rota of protegidas) {
      const res = await requisitar(rota.metodo, concreto(rota.caminho), {
        Origin: ORIGEM,
      });
      expect({ rota, status: res.status }).toEqual({ rota, status: 401 });
    }
  });

  it("toda rota registrada sob /api/admin e /api/painel está em ROTAS_DA_COORDENACAO (o 403 das só de admin é conferido)", () => {
    // Os catálogos à parte (ROTAS_REGRAS_CAMPANHA, D20; ROTAS_TOKEN_WEBHOOK, D21) entram em ROTAS_DA_COORDENACAO no
    // mesmo merge que monta as rotas: sem isso, uma rota só de admin montada sem a checagem do papel passaria.
    const conferidas = new Set(
      ROTAS_DA_COORDENACAO.map((rota) => `${rota.metodo} ${rota.caminho}`),
    );
    const fora = rotasRegistradas()
      .filter((rota) => eDaCoordenacao(rota.caminho))
      .map((rota) => `${rota.metodo} ${rota.caminho}`)
      .filter((chave) => !conferidas.has(chave));

    expect(fora).toEqual([]);
  });

  it("fora de /api/admin e /api/painel, só fica sem sessão a rota que o contrato declara aberta", async () => {
    const fora = rotasRegistradas().filter(
      (rota) => !eDaCoordenacao(rota.caminho),
    );

    for (const rota of fora) {
      const chave = `${rota.metodo} ${rota.caminho.replace(/(.)\/$/, "$1")}`;
      const grupo = GRUPO_NO_CONTRATO.get(chave);
      expect({ chave, noContrato: grupo !== undefined }).toEqual({
        chave,
        noContrato: true,
      });
      if (grupo === "coordenacao" || grupo === "hierarquia") {
        // Ex.: GET /api/sessao, protegida dentro do próprio sub-app, e GET /api/minha/visao (RIFA-014),
        // protegida pelo login dos papéis da hierarquia em /api/minha/*.
        const res = await requisitar(rota.metodo, concreto(rota.caminho), {
          Origin: ORIGEM,
        });
        expect({ chave, status: res.status }).toEqual({ chave, status: 401 });
      } else {
        expect(["aberto", "rifei_bearer"]).toContain(grupo);
      }
    }
  });

  it("os contatos dos líderes só saem com sessão", async () => {
    const criar = async (caminho: string, dados: object) => {
      const res = await requisitar(
        "POST",
        caminho,
        admin,
        JSON.stringify(dados),
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: number }).id;
    };
    const redeId = await criar("/api/admin/redes", {
      nome: "Rede Ficticia da Protecao",
      divisao: "jovens",
    });
    const discipuladorId = await criar("/api/admin/discipuladores", {
      rede_id: redeId,
      nome: "Discipulador Ficticio da Protecao",
    });
    const celulaId = await criar("/api/admin/celulas", {
      discipulador_id: discipuladorId,
      nome: "Celula Ficticia da Protecao",
      qtd_pessoas: 10,
      lider_nome: "Lider Ficticio da Protecao",
      lider_email: "lider.protecao@example.com",
      lider_telefone: "(91) 90000-0999",
    });

    for (const caminho of [
      "/api/admin/celulas",
      `/api/admin/celulas/${celulaId}`,
      // O painel de adesão também traz o telefone do líder (para cobrar quem falta).
      "/api/admin/adesao",
    ]) {
      const semSessao = await requisitar("GET", caminho);
      const texto = await semSessao.text();
      expect(semSessao.status).toBe(401);
      expect(texto).not.toContain("90000-0999");
      expect(texto).not.toContain("lider.protecao@example.com");

      const comSessao = await requisitar("GET", caminho, coordenacao);
      expect(comSessao.status).toBe(200);
      expect(await comSessao.text()).toContain("90000-0999");
    }
  });

  it("afiliados e adesão (RIFA-006) estão montados atrás do login: sem cookie 401, com sessão de coordenacao respondem", async () => {
    const registradas = rotasRegistradas().map(
      (rota) => `${rota.metodo} ${rota.caminho}`,
    );
    for (const rota of [
      ROTAS.listarAfiliados,
      ROTAS.salvarAfiliado,
      ROTAS.adesao,
    ]) {
      expect(registradas).toContain(`${rota.metodo} ${rota.caminho}`);
    }
    const affiliateId = 424242;
    const caminhoPut = `/api/admin/afiliados/${affiliateId}`;
    const corpo = JSON.stringify({ celula_id: null });
    const existe = async () =>
      (await env.DB.prepare("SELECT 1 FROM afiliados WHERE affiliate_id = ?")
        .bind(affiliateId)
        .first()) !== null;

    // Sem cookie: 401 nas três rotas; de outra origem, 403 mesmo com sessão. O PUT não cria nada.
    for (const [metodo, caminho] of [
      ["GET", "/api/admin/afiliados"],
      ["GET", "/api/admin/afiliados?vinculado=false"],
      ["PUT", caminhoPut],
      ["GET", "/api/admin/adesao"],
    ] as const) {
      await esperarErro(
        await requisitar(metodo, caminho, { Origin: ORIGEM }, corpo),
        401,
        "nao_autenticado",
      );
    }
    await esperarErro(
      await requisitar(
        "PUT",
        caminhoPut,
        { ...coordenacao, Origin: ORIGEM_MALICIOSA },
        corpo,
      ),
      403,
      "proibido",
    );
    expect(await existe()).toBe(false);

    // Com a sessão de coordenacao: o PUT pré-cadastra o afiliado e as leituras respondem no contrato.
    const salvo = await requisitar("PUT", caminhoPut, coordenacao, corpo);
    expect(salvo.status).toBe(200);
    expect(afiliadoResumoSchema.parse(await salvo.json())).toMatchObject({
      affiliate_id: affiliateId,
      celula_id: null,
      origem: "manual",
    });
    expect(await existe()).toBe(true);

    const orfaos = await requisitar(
      "GET",
      "/api/admin/afiliados?vinculado=false",
      coordenacao,
    );
    expect(orfaos.status).toBe(200);
    expect(
      respostaListaAfiliadosSchema
        .parse(await orfaos.json())
        .itens.map((item) => item.affiliate_id),
    ).toContain(affiliateId);

    const adesao = await requisitar("GET", "/api/admin/adesao", coordenacao);
    expect(adesao.status).toBe(200);
    expect(
      respostaAdesaoSchema.parse(await adesao.json()).resumo
        .afiliados_nao_vinculados,
    ).toBeGreaterThanOrEqual(1);
  });

  it("conferência pelo CSV (RIFA-012) está montada atrás do login: sem cookie 401, de outra origem 403, com sessão responde", async () => {
    const registradas = rotasRegistradas().map(
      (rota) => `${rota.metodo} ${rota.caminho}`,
    );
    const rotas = [
      ROTAS.analisarReconciliacao,
      ROTAS.recuperarReconciliacao,
      ROTAS.listarRecuperacoes,
    ];
    for (const rota of rotas)
      expect(registradas).toContain(`${rota.metodo} ${rota.caminho}`);
    // O corpo compacto que o navegador manda (o CSV fica nele): nem o 401 nem o 403 o leem.
    const analise = {
      colunas: {
        pedido_id: "Pedido",
        status: "Status",
        qtd_bilhetes: "Quantidade",
        bilhetes: null,
        valor: "Valor",
        afiliado: null,
        data: null,
      },
      linhas: 1,
      arquivo_sha256: "0".repeat(64),
      vezes: [1],
      pedido_id: ["R-PROTECAO"],
      status: ["aprovado"],
      qtd_bilhetes: [1],
      valor: [2000],
    };
    const corpos: Record<string, string | undefined> = {
      [ROTAS.analisarReconciliacao.caminho]: JSON.stringify(analise),
      [ROTAS.recuperarReconciliacao.caminho]: JSON.stringify({
        ...analise,
        pedidos: ["R-PROTECAO"],
      }),
    };
    const recuperacoes = async () =>
      (
        await env.DB.prepare(
          "SELECT count(*) AS total FROM recuperacoes",
        ).first<{ total: number }>()
      )?.total;

    for (const rota of rotas) {
      const corpo = corpos[rota.caminho];
      const semCookie = await requisitar(
        rota.metodo,
        rota.caminho,
        { Origin: ORIGEM },
        corpo,
      );
      const texto = await semCookie.text();
      expect({ rota: rota.caminho, status: semCookie.status }).toEqual({
        rota: rota.caminho,
        status: 401,
      });
      expect(texto).not.toContain("R-PROTECAO");
      if (rota.metodo === "POST")
        await esperarErro(
          await requisitar(
            "POST",
            rota.caminho,
            { ...coordenacao, Origin: ORIGEM_MALICIOSA },
            corpo,
          ),
          403,
          "proibido",
        );
    }
    expect(await recuperacoes()).toBe(0);

    // Com a sessão de coordenacao: passa do login (aqui ainda não há campanha ativa: 404 no formato
    // único) e a lista de recuperações responde no contrato.
    for (const rota of rotas.filter((item) => item.metodo === "POST")) {
      const res = await requisitar(
        "POST",
        rota.caminho,
        coordenacao,
        corpos[rota.caminho],
      );
      await esperarQuePassou(res);
    }
    const lista = await requisitar(
      "GET",
      ROTAS.listarRecuperacoes.caminho,
      coordenacao,
    );
    expect(lista.status).toBe(200);
    expect(lista.headers.get("Cache-Control")).toBe("no-store");
    expect(
      respostaListaRecuperacoesSchema.parse(await lista.json()).itens,
    ).toEqual([]);
    expect(await recuperacoes()).toBe(0);
  });
});

describe("b) o middleware cobre os prefixos inteiros (sem rota: 401, não 404)", () => {
  const CAMINHOS_SEM_ROTA_PROPRIA = [
    "/api/admin",
    "/api/admin/",
    "/api/admin/qualquer",
    "/api/admin/qualquer/coisa/funda",
    "/api/painel",
    "/api/painel/",
    "/api/painel/x/y",
    "/api/painel/resumo?escopo=campanha",
    "/api/admin/usuarios/1/links/extra",
    "/api/admin/celulas/",
    "/api/admin//celulas",
    // O URL do Worker resolve os pontos ("/api/admin/celulas") e o Hono decodifica o %61 ("a"):
    // o middleware e o roteador veem o mesmo caminho.
    "/api/admin/../admin/celulas",
    "/api/admin/%2e%2e/admin/celulas",
    "/api/qualquer/../admin/celulas",
    "/api/%61dmin/celulas",
  ];

  it.each(CAMINHOS_SEM_ROTA_PROPRIA)(
    "GET %s sem cookie: 401",
    async (caminho) => {
      await esperarErro(
        await requisitar("GET", caminho),
        401,
        "nao_autenticado",
      );
    },
  );

  it.each(ESCRITAS)(
    "%s da mesma origem e sem cookie em /api/admin/qualquer e /api/painel/x/y: 401",
    async (metodo) => {
      for (const caminho of ["/api/admin/qualquer", "/api/painel/x/y"]) {
        await esperarErro(
          await requisitar(metodo, caminho, { Origin: ORIGEM }),
          401,
          "nao_autenticado",
        );
      }
    },
  );

  it.each(["HEAD", "OPTIONS"])(
    "%s (sem checagem de origem) também exige sessão: 401",
    async (metodo) => {
      for (const caminho of ["/api/admin/celulas", "/api/painel/resumo"]) {
        const res = await exports.default.fetch(`${ORIGEM}${caminho}`, {
          method: metodo,
        });
        expect({ caminho, status: res.status }).toEqual({
          caminho,
          status: 401,
        });
      }
    },
  );

  it.each([
    "/api/qualquer",
    "/api/adminx/celulas",
    "/api/painelzinho",
    "/api/ADMIN/celulas",
  ])(
    "contraprova: %s fica fora dos prefixos e não chega a rota nenhuma (404)",
    async (caminho) => {
      await esperarErro(
        await requisitar("GET", caminho),
        404,
        "nao_encontrado",
      );
    },
  );
});

describe("c) escrita de outra origem é recusada (CSRF), mesmo com sessão de admin", () => {
  const ESCRITAS_DA_COORDENACAO = ROTAS_DA_COORDENACAO.filter(
    (rota) => rota.metodo !== "GET",
  );

  it("o contrato tem escritas da coordenação com POST, PUT, PATCH e DELETE", () => {
    expect(
      [...new Set(ESCRITAS_DA_COORDENACAO.map((rota) => rota.metodo))].sort(),
    ).toEqual([...ESCRITAS].sort());
  });

  it.each(casos(ESCRITAS_DA_COORDENACAO))(
    "%s: 403 com Origin de outro site, sem Origin, com Origin null ou Sec-Fetch-Site cross-site/same-site",
    async (_rota, rota) => {
      const variantes: Record<string, string>[] = [
        { ...admin, Origin: ORIGEM_MALICIOSA },
        { Cookie: admin.Cookie },
        { Cookie: admin.Cookie, Origin: "null" },
        { Cookie: admin.Cookie, "Sec-Fetch-Site": "cross-site" },
        // Outro subdomínio do mesmo site: o SameSite=Lax deixaria o cookie ir, a origem não.
        { Cookie: admin.Cookie, "Sec-Fetch-Site": "same-site" },
      ];
      for (const cabecalhos of variantes) {
        await esperarErro(
          await requisitar(rota.metodo, concreto(rota.caminho), cabecalhos),
          403,
          "proibido",
        );
      }
    },
  );

  it.each(ESCRITAS)(
    "%s de outra origem em caminho sem rota: 403 (a origem é conferida antes da sessão)",
    async (metodo) => {
      for (const cabecalhos of [
        { ...admin, Origin: ORIGEM_MALICIOSA },
        { Origin: ORIGEM_MALICIOSA },
      ]) {
        for (const caminho of ["/api/admin/qualquer", "/api/painel/x/y"]) {
          await esperarErro(
            await requisitar(metodo, caminho, cabecalhos),
            403,
            "proibido",
          );
        }
      }
    },
  );

  it("nada é gravado: rede, importação, usuário e desativação vindos de outra origem não mudam o banco", async () => {
    const contar = async () => {
      const [redes, discipuladores, celulas, usuarios] = await env.DB.batch<{
        total: number;
      }>(
        ["redes", "discipuladores", "celulas", "usuarios"].map((tabela) =>
          env.DB.prepare(`SELECT count(*) AS total FROM ${tabela}`),
        ),
      );
      const ativos = await env.DB.prepare(
        "SELECT count(*) AS total FROM usuarios WHERE ativo = 1",
      ).first<{ total: number }>();
      return [redes, discipuladores, celulas, usuarios]
        .map((resultado) => resultado.results[0].total)
        .concat(ativos?.total ?? -1);
    };
    const usuarioCoordenacao = await requisitar(
      "GET",
      "/api/sessao",
      coordenacao,
    );
    const { usuario } = (await usuarioCoordenacao.json()) as {
      usuario: { id: number };
    };
    const csv = [
      "rede,divisao,discipulador,celula,qtd_pessoas,lider_nome",
      "Rede Forjada,jovens,Discipulador Forjado,Celula Forjada,10,Lider Forjado",
    ].join("\n");
    const tentativas: [Metodo, string, object][] = [
      ["POST", "/api/admin/redes", { nome: "Rede Forjada", divisao: "jovens" }],
      ["POST", "/api/admin/hierarquia/importar", { csv, simular: false }],
      [
        "POST",
        "/api/admin/usuarios",
        { nome: "Pessoa Forjada", papel: "admin" },
      ],
      ["PATCH", `/api/admin/usuarios/${usuario.id}`, { ativo: false }],
    ];
    const antes = await contar();

    for (const [metodo, caminho, corpo] of tentativas) {
      const res = await requisitar(
        metodo,
        caminho,
        { ...admin, Origin: ORIGEM_MALICIOSA },
        JSON.stringify(corpo),
      );
      expect({ caminho, status: res.status }).toEqual({ caminho, status: 403 });
    }
    expect(await contar()).toEqual(antes);

    // Contraprova: a mesma rede, da mesma origem, é criada (só a origem fazia a diferença).
    const mesmaOrigem = await requisitar(
      "POST",
      "/api/admin/redes",
      admin,
      JSON.stringify({ nome: "Rede Forjada", divisao: "jovens" }),
    );
    expect(mesmaOrigem.status).toBe(201);
  });
});

describe("d) cabeçalhos de segurança e webhook da Rifei", () => {
  it("os 4 cabeçalhos de segurança saem em 200, 401, 403 e 404 da API", async () => {
    const casos: [string, number, Response][] = [
      ["health", 200, await requisitar("GET", "/api/health")],
      [
        "células com sessão",
        200,
        await requisitar("GET", "/api/admin/celulas", coordenacao),
      ],
      ["sessão", 200, await requisitar("GET", "/api/sessao", coordenacao)],
      ["admin sem cookie", 401, await requisitar("GET", "/api/admin/celulas")],
      ["painel sem cookie", 401, await requisitar("GET", "/api/painel/resumo")],
      [
        "papel sem permissão",
        403,
        await requisitar("GET", "/api/admin/usuarios", coordenacao),
      ],
      [
        "outra origem",
        403,
        await requisitar("POST", "/api/admin/redes", {
          ...admin,
          Origin: ORIGEM_MALICIOSA,
        }),
      ],
      [
        "rota inexistente",
        404,
        await requisitar("GET", "/api/rota-inexistente"),
      ],
    ];

    for (const [caso, status, res] of casos) {
      expect({ caso, status: res.status }).toEqual({ caso, status });
      esperarCabecalhosDeSeguranca(res);
    }
  });

  async function enviarWebhook(cabecalhos: Record<string, string>) {
    return exports.default.fetch(`${ORIGEM}/api/webhooks/rifei`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify(paidOrderAfiliado),
    });
  }

  it("webhook com o Bearer e SEM cookie: a fixture é processada (200), fora da sessão", async () => {
    // Só uma campanha fica ativa: a de outro bloco (o painel semeia a dele), se rodou antes, sai.
    await env.DB.batch([
      env.DB.prepare("UPDATE campanhas SET ativa = 0 WHERE ativa = 1"),
      env.DB.prepare(
        `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
           meta_unidade, meta_regra, meta_valor, ranking_criterio)
         VALUES ('Campanha de teste', ?, 1, '2026-11-23', 2000, 'bilhetes', 'por_pessoa', 10,
           'percentual_meta')`,
      ).bind(paidOrderAfiliado.slug),
    ]);

    const res = await enviarWebhook({
      Authorization: `Bearer ${env.RIFEI_WEBHOOK_TOKEN}`,
    });

    expect(res.status).toBe(200);
    expect(respostaWebhookRifeiSchema.parse(await res.json())).toMatchObject({
      resultado: "processado",
    });
    expect(res.headers.get("Set-Cookie")).toBeNull();
    esperarCabecalhosDeSeguranca(res);
  });

  it("webhook sem o Bearer: 401, mesmo com sessão de admin (a sessão não abre o webhook)", async () => {
    for (const cabecalhos of [{}, admin]) {
      const res = await enviarWebhook(cabecalhos);

      expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
      esperarCabecalhosDeSeguranca(res);
      await esperarErro(res, 401, "nao_autenticado");
    }
  });
});

describe("e) painel atrás do login e visão pública aberta, sem valores (RIFA-PAINEL)", () => {
  // Relógio FIXO (vi.useFakeTimers só no Date, que o app real lê com new Date()): nada aqui depende do
  // dia em que o teste roda nem da virada do dia em Belém (03:00Z). É 12:00 de Belém num dia que já
  // passou, de propósito: as sessões do beforeAll do arquivo (relógio real, valem 24 h) continuam
  // válidas nesse instante, e nenhuma sessão nova é criada com o relógio parado. O cenário dos testes
  // do painel vai para esse dia, que vira o dia 9 de 21 (2º dia da Semana 2), com as vendas deslocadas.
  const AGORA_FIXO = new Date("2026-11-04T15:00:00.000Z");
  const hoje = hojeNoFuso(DADOS_CAMPANHA.fuso_horario, AGORA_FIXO);
  const inicio = somarDias(hoje, -8);
  const deslocamento = diasEntre(DADOS_CAMPANHA.data_inicio, inicio);
  const CONFIGURACOES_PUBLICAS = [
    { mostra_percentual_meta: false, limite_ranking: 3 },
    { mostra_percentual_meta: true, limite_ranking: null },
  ];
  const CAMINHOS_PUBLICOS = [
    ...NIVEIS_RANKING.flatMap((nivel) =>
      JANELAS_RANKING.flatMap((periodo) =>
        ["", "&divisao=jovens", "&divisao=adultos"].map(
          (divisao) =>
            `/api/publico/ranking?nivel=${nivel}&periodo=${periodo}${divisao}`,
        ),
      ),
    ),
    "/api/publico/ranking",
    "/api/publico/bumbo",
    // O `data` do bumbo só vale na janela da campanha (RIFA-011): a contagem regressiva de antes do
    // início sai sem `data` e é varrida em routes/publico.test.ts.
    ...[1, 2, 8].map(
      (diaDaMensagem) =>
        `/api/publico/bumbo?data=${somarDias(inicio, diaDaMensagem - 1)}`,
    ),
  ];

  async function semear(publico = CONFIGURACOES_PUBLICAS[0]) {
    await semearCenario({
      campanha: campanhaEntradaSchema.parse({
        ...DADOS_CAMPANHA,
        data_inicio: inicio,
        publico,
      }),
      pedidos: deslocarPedidos(PEDIDOS, deslocamento),
    });
  }

  // O cache das rotas abertas (30 s, no relógio da rota) guarda as respostas de um teste: cada teste
  // começa 31 s depois do anterior (ainda no mesmo dia), para não receber a resposta guardada por outro.
  let instante = AGORA_FIXO.getTime();
  function andarDoRelogio() {
    instante += TTL_CACHE_PUBLICO_MS + 1_000;
    vi.setSystemTime(instante);
  }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instante);
    await semear();
  });

  beforeEach(() => {
    andarDoRelogio();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("as rotas do painel e as públicas estão registradas no app real", () => {
    const registradas = rotasRegistradas().map(
      (rota) => `${rota.metodo} ${rota.caminho}`,
    );

    for (const rota of [
      ROTAS.painelResumo,
      ROTAS.painelRanking,
      ROTAS.rankingPublico,
      ROTAS.bumbo,
    ])
      expect(registradas).toContain(`${rota.metodo} ${rota.caminho}`);
  });

  it.each([
    "/api/painel/resumo",
    "/api/painel/resumo?escopo=rede&id=1",
    "/api/painel/resumo?escopo=celula&id=999",
    "/api/painel/ranking",
    "/api/painel/ranking?nivel=rede&periodo=campanha&divisao=adultos",
    // O login vem antes da validação: consulta inválida ou data futura sem cookie também é 401.
    "/api/painel/resumo?escopo=igreja",
    "/api/painel/ranking?data=2999-01-01",
  ])("painel sem cookie: GET %s → 401, sem nenhum valor", async (caminho) => {
    const res = await requisitar("GET", caminho);
    const texto = await res.text();

    expect({ status: res.status, corpo: JSON.parse(texto) }).toEqual({
      status: 401,
      corpo: {
        erro: { codigo: "nao_autenticado", mensagem: expect.any(String) },
      },
    });
    expect(texto).not.toContain("centavos");
    esperarCabecalhosDeSeguranca(res);
  });

  it("painel com sessão de coordenacao: 200 com os valores (contraprova), no-store", async () => {
    const resumo = await requisitar("GET", "/api/painel/resumo", coordenacao);
    expect(resumo.status).toBe(200);
    expect(resumo.headers.get("Cache-Control")).toBe("no-store");
    const corpoResumo = respostaPainelResumoSchema.parse(await resumo.json());
    // O relógio fixo chega ao app real: o "hoje" da resposta é o dia do AGORA_FIXO.
    expect(corpoResumo.referencia).toMatchObject({
      data: hoje,
      dia_campanha: 9,
    });
    expect(corpoResumo.vendas.total_centavos).toBeGreaterThan(0);

    const ranking = await requisitar(
      "GET",
      "/api/painel/ranking?nivel=celula",
      coordenacao,
    );
    expect(ranking.status).toBe(200);
    expect(ranking.headers.get("Cache-Control")).toBe("no-store");
    expect(
      respostaRankingSchema.parse(await ranking.json()).itens,
    ).toHaveLength(5);
  });

  it.each(CONFIGURACOES_PUBLICAS)(
    "visão pública sem cookie (público %o): 200, cache curto e nenhum valor em R$ ou bilhetes (varredura recursiva por nomes e textos)",
    async (publico) => {
      await semear(publico);
      let itensVistos = 0;

      for (const caminho of CAMINHOS_PUBLICOS) {
        const res = await requisitar("GET", caminho);
        const texto = await res.text();
        const corpo: unknown = JSON.parse(texto);

        expect({ caminho, status: res.status }).toEqual({
          caminho,
          status: 200,
        });
        expect(res.headers.get("Cache-Control")).toBe(CACHE_PUBLICO);
        expect(res.headers.get("Set-Cookie")).toBeNull();
        esperarCabecalhosDeSeguranca(res);
        const campos = [...camposDe(corpo)];
        expect({
          caminho,
          deValor: campos.filter((campo) => CAMPO_DE_VALOR.test(campo)),
          foraDaLista: campos.filter((campo) => !CAMPOS_PUBLICOS.has(campo)),
          textosComValor: textosDe(corpo).filter((item) =>
            TEXTO_DE_VALOR.test(item),
          ),
        }).toEqual({
          caminho,
          deValor: [],
          foraDaLista: [],
          textosComValor: [],
        });
        expect(texto).not.toContain("R$");
        if (caminho.startsWith("/api/publico/ranking"))
          itensVistos += respostaRankingPublicoSchema.parse(corpo).itens.length;
        else respostaBumboSchema.parse(corpo);
      }
      // A varredura olhou rankings com gente dentro, não só listas vazias.
      expect(itensVistos).toBeGreaterThan(20);
    },
  );

  it("com cookie de sessão, a visão pública é a mesma: a sessão não abre valor nenhum nem muda a chave do cache", async () => {
    await semear();
    const semInstante = (corpo: unknown) => {
      const { atualizado_em, gerado_em, ...resto } = corpo as Record<
        string,
        unknown
      >;
      expect([atualizado_em, gerado_em].some(Boolean)).toBe(true);
      return resto;
    };

    for (const caminho of ["/api/publico/ranking", "/api/publico/bumbo"]) {
      const anonimo = await requisitar("GET", caminho);
      // Passa do prazo do cache: a resposta com sessão é montada de novo, não lida do cache.
      andarDoRelogio();
      const comSessao = await requisitar("GET", caminho, admin);

      expect(comSessao.status).toBe(200);
      const corpoComSessao: unknown = await comSessao.json();
      expect(semInstante(corpoComSessao)).toEqual(
        semInstante(await anonimo.json()),
      );
      // Dentro do prazo, sem cookie, volta a MESMA resposta guardada: a sessão não entra na chave.
      expect(await (await requisitar("GET", caminho)).json()).toEqual(
        corpoComSessao,
      );
    }
  });

  it("cache só na visão pública: 30 s sem ler o banco (com ou sem cookie); o painel lê o banco toda vez e nunca passa pela Cache API", async () => {
    const batch = vi.spyOn(env.DB, "batch");
    const match = vi.spyOn(Cache.prototype, "match");
    const put = vi.spyOn(Cache.prototype, "put");

    for (const caminho of ["/api/painel/resumo", "/api/painel/ranking"])
      for (let vez = 0; vez < 2; vez++) {
        const antes = batch.mock.calls.length;
        const res = await requisitar("GET", caminho, coordenacao);

        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(batch.mock.calls.length).toBe(antes + 1);
      }
    expect({
      match: match.mock.calls.length,
      put: put.mock.calls.length,
    }).toEqual({ match: 0, put: 0 });

    // Contraprova: a 1ª ida à visão pública lê o banco e grava a 200 na Cache API; as seguintes, na
    // mesma URL normalizada e dentro dos 30 s, saem do cache, sem ler o banco.
    const primeira = await requisitar("GET", "/api/publico/ranking");
    const lidas = batch.mock.calls.length;
    expect(primeira.status).toBe(200);
    expect(put).toHaveBeenCalledOnce();
    const texto = await primeira.text();
    for (const cabecalhos of [{}, admin])
      expect(
        await (
          await requisitar(
            "GET",
            "/api/publico/ranking?periodo=atual&nivel=celula",
            cabecalhos,
          )
        ).text(),
      ).toBe(texto);
    expect(batch.mock.calls.length).toBe(lidas);
  });
});

describe("f) RIFA-013b: pedidos suspeitos e auditoria atrás do login, teto do corpo depois dele", () => {
  it("as duas rotas novas estão no contrato e registradas no app (a auditoria, só para admin)", () => {
    const registradas = rotasRegistradas().map(
      (rota) => `${rota.metodo} ${rota.caminho}`,
    );
    for (const rota of [ROTAS.pedidosSuspeitos, ROTAS.auditoria])
      expect(registradas).toContain(`${rota.metodo} ${rota.caminho}`);
    expect(ROTAS.auditoria.papeis).toEqual(["admin"]);
    expect("papeis" in ROTAS.pedidosSuspeitos).toBe(false);
  });

  it("pedidos suspeitos: 401 sem cookie; com sessão, a lista sai sem nenhum dado do comprador", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE campanhas SET ativa = 0 WHERE ativa = 1"),
      env.DB.prepare(
        `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
           meta_unidade, meta_regra, meta_valor, ranking_criterio)
         VALUES ('Campanha da protecao', 'protecao-suspeitos', 1, '2026-11-23', 2000, 'bilhetes',
           'por_pessoa', 10, 'percentual_meta')`,
      ),
    ]);
    // Implausível: 500 bilhetes (acima do teto) por R$ 10,00 (bem abaixo de 500 × R$ 20,00).
    const pedido = {
      ...paidOrderAfiliado,
      id: "PROTECAO-SUSPEITO-1",
      slug: "protecao-suspeitos",
      numbers_count: 500,
      numbers: null,
      total: 10,
    };
    const entrega = await exports.default.fetch(
      `${ORIGEM}/api/webhooks/rifei`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.RIFEI_WEBHOOK_TOKEN}`,
        },
        body: JSON.stringify(pedido),
      },
    );
    expect(await entrega.json()).toMatchObject({ resultado: "processado" });

    await esperarErro(
      await requisitar("GET", ROTAS.pedidosSuspeitos.caminho),
      401,
      "nao_autenticado",
    );
    const res = await requisitar(
      "GET",
      ROTAS.pedidosSuspeitos.caminho,
      coordenacao,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const texto = await res.text();
    const corpo = respostaPedidosSuspeitosSchema.parse(JSON.parse(texto));
    expect(corpo.itens.map((item) => item.pedido_id)).toEqual([pedido.id]);
    const { buyer } = paidOrderAfiliado;
    for (const valor of [buyer.name, buyer.email, buyer.document, "900000001"])
      expect(texto).not.toContain(valor);
    expect(
      [...camposDe(JSON.parse(texto))].filter((campo) =>
        /ddd|pais|utm|numer|buyer|comprador|email|telefone|phone/.test(campo),
      ),
    ).toEqual([]);
  });

  it("RIFA-076 (D36): nome e telefone do comprador só para o admin (lista de pedidos e planilha); nem a coordenação, nem a hierarquia, nem o público", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE campanhas SET ativa = 0 WHERE ativa = 1"),
      env.DB.prepare(
        `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
           meta_unidade, meta_regra, meta_valor, ranking_criterio)
         VALUES ('Campanha do comprador', 'protecao-comprador', 1, '2026-11-23', 2000, 'bilhetes',
           'por_pessoa', 10, 'percentual_meta')`,
      ),
    ]);
    const entrega = await exports.default.fetch(
      `${ORIGEM}/api/webhooks/rifei`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.RIFEI_WEBHOOK_TOKEN}`,
        },
        body: JSON.stringify({
          ...paidOrderAfiliado,
          id: "PROTECAO-COMPRADOR-1",
          slug: "protecao-comprador",
        }),
      },
    );
    expect(await entrega.json()).toMatchObject({ resultado: "processado" });
    const { buyer } = paidOrderAfiliado;
    const contato = [buyer.name, "900000001"];

    // A planilha: só admin (o filtro de cima confere a rota no contrato; aqui, o papel).
    expect(ROTAS.exportarCompradores.papeis).toEqual(["admin"]);
    await esperarErro(
      await requisitar("GET", ROTAS.exportarCompradores.caminho),
      401,
      "nao_autenticado",
    );
    await esperarErro(
      await requisitar("GET", ROTAS.exportarCompradores.caminho, coordenacao),
      403,
      "proibido",
    );
    const planilha = await requisitar(
      "GET",
      ROTAS.exportarCompradores.caminho,
      admin,
    );
    expect(planilha.status).toBe(200);
    expect(await planilha.text()).toContain(buyer.name);

    // A lista de pedidos: o admin vê; a coordenação recebe a mesma lista sem o campo e sem os valores.
    const doAdmin = await requisitar("GET", ROTAS.listarPedidos.caminho, admin);
    const textoAdmin = await doAdmin.text();
    expect(textoAdmin).toContain(buyer.name);
    const daCoordenacao = await requisitar(
      "GET",
      ROTAS.listarPedidos.caminho,
      coordenacao,
    );
    expect(daCoordenacao.status).toBe(200);
    const textoCoordenacao = await daCoordenacao.text();
    for (const valor of contato) expect(textoCoordenacao).not.toContain(valor);
    expect([...camposDe(JSON.parse(textoCoordenacao))]).not.toContain(
      "comprador",
    );

    // As rotas abertas (público) também não: nenhuma devolve nome ou telefone.
    for (const rota of Object.values(ROTAS).filter(
      (item) => item.grupo === "aberto" && item.metodo === "GET",
    )) {
      const res = await requisitar("GET", concreto(rota.caminho));
      const texto = await res.text();
      for (const valor of contato)
        expect({ rota: rota.caminho, vazou: texto.includes(valor) }).toEqual({
          rota: rota.caminho,
          vazou: false,
        });
    }
  });

  it("auditoria: 401 sem cookie, 403 para a coordenação; o admin vê quem fez a ação", async () => {
    const vinculo = await requisitar(
      "PUT",
      "/api/admin/afiliados/737373",
      coordenacao,
      JSON.stringify({ celula_id: null }),
    );
    expect(vinculo.status).toBe(200);

    await esperarErro(
      await requisitar("GET", ROTAS.auditoria.caminho),
      401,
      "nao_autenticado",
    );
    await esperarErro(
      await requisitar("GET", ROTAS.auditoria.caminho, coordenacao),
      403,
      "proibido",
    );
    const res = await requisitar("GET", ROTAS.auditoria.caminho, admin);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const { usuario } = (await (
      await requisitar("GET", "/api/sessao", coordenacao)
    ).json()) as { usuario: { id: number } };
    expect(
      respostaAuditoriaSchema.parse(await res.json()).itens,
    ).toContainEqual(
      expect.objectContaining({
        usuario_id: usuario.id,
        acao: "afiliado.salvar",
        alvo: "afiliado:737373",
      }),
    );
  });

  it("teto do corpo da coordenação: sem sessão, 401 (o login vem antes); com sessão, 413", async () => {
    const grande = JSON.stringify({
      nome: "x".repeat(2 * 1024 * 1024),
      divisao: "jovens",
    });

    await esperarErro(
      await requisitar("POST", "/api/admin/redes", { Origin: ORIGEM }, grande),
      401,
      "nao_autenticado",
    );
    await esperarErro(
      await requisitar("POST", "/api/admin/redes", admin, grande),
      413,
      "corpo_muito_grande",
    );
  });
});

describe("g) RIFA-014 (CA3): papéis da hierarquia só em /api/minha, e /api/minha só para eles", () => {
  /** Caminhos sob /api/minha, com rota e sem (todos exigem a sessão de um papel da hierarquia). */
  const CAMINHOS_DA_MINHA = [
    "/api/minha",
    "/api/minha/",
    "/api/minha/visao",
    "/api/minha/visao?periodo=campanha",
    "/api/minha/visao?periodo=invalido",
    "/api/minha/visao/",
    "/api/minha/qualquer",
    "/api/minha/qualquer/coisa/funda",
    "/api/minha//visao",
    "/api/minha/../minha/visao",
    "/api/qualquer/../minha/visao",
    "/api/%6dinha/visao",
    // RIFA-046 (D24): os links de vendas das células do alvo.
    "/api/minha/links-vendas",
    "/api/minha/links-vendas?celula_id=2",
    "/api/minha/links-vendas/",
  ];
  const sessoes = {} as Record<PapelHierarquia, Record<string, string>>;

  beforeAll(async () => {
    // A hierarquia do painel (a célula 1, o discipulador 10 e a rede 1) e uma sessão de cada papel.
    await semearCenario();
    sessoes.lider = await cabecalhosDeSessaoDaHierarquia("lider", 1);
    sessoes.discipulador = await cabecalhosDeSessaoDaHierarquia(
      "discipulador",
      10,
    );
    sessoes.rede = await cabecalhosDeSessaoDaHierarquia("rede", 1);
  });

  it("o contrato tem a rota da hierarquia, montada no app, e os papéis dela são os 3 da hierarquia", () => {
    const daHierarquia = Object.values(ROTAS).filter(
      (rota) => rota.grupo === "hierarquia",
    );
    expect(
      daHierarquia.map((rota) => [
        `${rota.metodo} ${rota.caminho}`,
        rota.papeis,
      ]),
    ).toEqual([["GET /api/minha/visao", PAPEIS_HIERARQUIA]]);
    // O catálogo à parte do link de vendas (D24): só a visão da hierarquia em /api/minha.
    expect(
      Object.values(ROTAS_LINK_VENDAS)
        .filter((rota) => rota.grupo === "hierarquia")
        .map((rota) => [`${rota.metodo} ${rota.caminho}`, rota.papeis]),
    ).toEqual([["GET /api/minha/links-vendas", PAPEIS_HIERARQUIA]]);
    const registradas = rotasRegistradas().map(
      (rota) => `${rota.metodo} ${rota.caminho}`,
    );
    expect(registradas).toContain("GET /api/minha/visao");
    expect(registradas).toContain("GET /api/minha/links-vendas");
  });

  it.each(PAPEIS_HIERARQUIA)(
    "sessão de %s: 403 em TODA rota registrada sob /api/admin e /api/painel (inclusive fora do contrato) e nos caminhos sem rota",
    async (papel) => {
      const protegidas = rotasRegistradas().filter((rota) =>
        eDaCoordenacao(rota.caminho),
      );
      expect(protegidas.length).toBeGreaterThanOrEqual(30);
      for (const rota of [
        ...protegidas,
        ...ROTAS_DA_COORDENACAO.filter((daCoordenacao) =>
          daCoordenacao.caminho.startsWith("/api/admin"),
        ),
        ...["/api/admin", "/api/admin/qualquer", "/api/painel/x/y"].flatMap(
          (caminho) =>
            (["GET", ...ESCRITAS] as const).map((metodo) => ({
              metodo,
              caminho,
            })),
        ),
      ]) {
        const res = await requisitar(
          rota.metodo,
          concreto(rota.caminho),
          sessoes[papel],
        );
        expect({
          papel,
          rota: `${rota.metodo} ${rota.caminho}`,
          status: res.status,
        }).toEqual({
          papel,
          rota: `${rota.metodo} ${rota.caminho}`,
          status: 403,
        });
        expect(erroApiSchema.parse(await res.json()).erro.codigo).toBe(
          "proibido",
        );
      }
    },
  );

  it.each(PAPEIS_HIERARQUIA)(
    "sessão de %s: GET /api/sessao diz quem é, com o alvo; a visão responde 200",
    async (papel) => {
      const sessao = await requisitar("GET", "/api/sessao", sessoes[papel]);
      expect(sessao.status).toBe(200);
      const { usuario } = respostaSessaoSchema.parse(await sessao.json());
      expect(usuario.papel).toBe(papel);
      expect(usuario.alvo).toMatchObject({
        id: { lider: 1, discipulador: 10, rede: 1 }[papel],
      });
      const visao = await requisitar("GET", "/api/minha/visao", sessoes[papel]);
      expect(visao.status).toBe(200);
      expect(visao.headers.get("Cache-Control")).toBe("no-store");
      respostaVisaoIndividualSchema.parse(await visao.json());
      // RIFA-046 (D24): os links de vendas das células do alvo, pelo schema estrito (o escopo é conferido nele).
      const links = await requisitar(
        "GET",
        ROTAS_LINK_VENDAS.meusLinksVendas.caminho,
        sessoes[papel],
      );
      expect(links.status).toBe(200);
      expect(links.headers.get("Cache-Control")).toBe("no-store");
      expect(
        respostaMeusLinksVendasSchema.parse(await links.json()).alvo,
      ).toMatchObject({ id: { lider: 1, discipulador: 10, rede: 1 }[papel] });
    },
  );

  it.each(CAMINHOS_DA_MINHA)(
    "GET %s sem sessão: 401 (exista a rota ou não)",
    async (caminho) => {
      const res = await requisitar("GET", caminho);
      await esperarErro(res, 401, "nao_autenticado");
      esperarCabecalhosDeSeguranca(res);
    },
  );

  it("toda rota registrada sob /api/minha dá 401 sem cookie, em todo método; escrita de outra origem, 403", async () => {
    const daMinha = rotasRegistradas().filter((rota) =>
      rota.caminho.startsWith("/api/minha"),
    );
    expect(daMinha.length).toBeGreaterThanOrEqual(1);
    for (const rota of daMinha)
      await esperarErro(
        await requisitar(rota.metodo, concreto(rota.caminho), {
          Origin: ORIGEM,
        }),
        401,
        "nao_autenticado",
      );
    for (const metodo of ESCRITAS) {
      await esperarErro(
        await requisitar(metodo, "/api/minha/visao", { Origin: ORIGEM }),
        401,
        "nao_autenticado",
      );
      await esperarErro(
        await requisitar(metodo, "/api/minha/visao", {
          ...sessoes.lider,
          Origin: ORIGEM_MALICIOSA,
        }),
        403,
        "proibido",
      );
    }
    for (const metodo of ["HEAD", "OPTIONS"]) {
      const res = await exports.default.fetch(`${ORIGEM}/api/minha/visao`, {
        method: metodo,
      });
      expect({ metodo, status: res.status }).toEqual({ metodo, status: 401 });
    }
  });

  it.each(["admin", "coordenacao"] as const)(
    "sessão de %s: 403 em /api/minha/* (a coordenação usa o painel)",
    async (papel) => {
      const sessao = papel === "admin" ? admin : coordenacao;
      for (const caminho of CAMINHOS_DA_MINHA) {
        const res = await requisitar("GET", caminho, sessao);
        expect({ papel, caminho, status: res.status }).toEqual({
          papel,
          caminho,
          status: 403,
        });
        expect(erroApiSchema.parse(await res.json()).erro.codigo).toBe(
          "proibido",
        );
      }
    },
  );

  it.each(["/api/minhax/visao", "/api/MINHA/visao", "/api/minh/visao"])(
    "contraprova: %s fica fora do prefixo e não chega a rota nenhuma (404)",
    async (caminho) => {
      await esperarErro(
        await requisitar("GET", caminho),
        404,
        "nao_encontrado",
      );
    },
  );
});

describe("h) RIFA-029 (D20, CA4): acesso de discipuladores e redes pela chave da campanha", () => {
  /** Caminhos sob /api/minha, com rota e sem: o 403 vale em todos (o login de /api/minha/* confere a chave). */
  const CAMINHOS = [
    "/api/minha/visao",
    "/api/minha/visao?periodo=campanha",
    "/api/minha/visao?periodo=invalido",
    // RIFA-046 (D24): os links de vendas seguem a chave, como todo /api/minha.
    "/api/minha/links-vendas",
    "/api/minha/qualquer",
    "/api/minha/qualquer/coisa/funda",
    "/api/minha",
  ];
  const PAPEIS_COM_CHAVE = ["discipulador", "rede"] as const;
  const ALVO = { lider: 1, discipulador: 10, rede: 1 } as const;
  const sessoes = {} as Record<PapelHierarquia, Record<string, string>>;
  const tokens = {} as Record<PapelHierarquia, string>;

  const chaves = (discipuladores: 0 | 1, redes: 0 | 1) =>
    env.DB.prepare(
      "UPDATE campanhas SET acesso_discipuladores = ?1, acesso_redes = ?2 WHERE ativa = 1",
    )
      .bind(discipuladores, redes)
      .run();
  const entrar = (token: string) =>
    exports.default.fetch(`${ORIGEM}/api/sessao`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGEM },
      body: JSON.stringify({ token }),
    });

  beforeAll(async () => {
    await semearCenario();
    for (const papel of PAPEIS_HIERARQUIA) {
      sessoes[papel] = await cabecalhosDeSessaoDaHierarquia(papel, ALVO[papel]);
      tokens[papel] = (
        await criarAcessoDaHierarquiaNoBanco(papel, ALVO[papel])
      ).token;
    }
  });

  afterAll(async () => {
    await chaves(1, 1);
  });

  it.each(PAPEIS_COM_CHAVE)(
    "%s desligado: 403 acesso_desligado com { papel } em todo /api/minha/*, no-store; a sessão não é apagada (GET /api/sessao, 200)",
    async (papel) => {
      await chaves(papel === "discipulador" ? 0 : 1, papel === "rede" ? 0 : 1);
      for (const caminho of CAMINHOS) {
        const res = await requisitar("GET", caminho, sessoes[papel]);
        expect({
          caminho,
          status: res.status,
          corpo: await res.json(),
        }).toEqual({
          caminho,
          status: 403,
          corpo: {
            erro: {
              codigo: "acesso_desligado",
              mensagem: expect.stringContaining("desligou"),
              detalhes: { papel },
            },
          },
        });
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        esperarCabecalhosDeSeguranca(res);
      }
      const sessao = await requisitar("GET", "/api/sessao", sessoes[papel]);
      expect(sessao.status).toBe(200);
      expect(
        respostaSessaoSchema.parse(await sessao.json()).usuario.papel,
      ).toBe(papel);
      // O outro papel com chave e o líder seguem entrando na visão.
      const outro = papel === "discipulador" ? "rede" : "discipulador";
      for (const quem of ["lider", outro] as const)
        expect({
          quem,
          status: (await requisitar("GET", "/api/minha/visao", sessoes[quem]))
            .status,
        }).toEqual({ quem, status: 200 });
    },
  );

  it("com os dois desligados, o líder não é afetado e a coordenação continua com 403 proibido em /api/minha", async () => {
    await chaves(0, 0);
    const lider = await requisitar("GET", "/api/minha/visao", sessoes.lider);
    expect(lider.status).toBe(200);
    respostaVisaoIndividualSchema.parse(await lider.json());
    // Os links de vendas do líder também (RIFA-046, D24: o líder não tem chave).
    const links = await requisitar(
      "GET",
      ROTAS_LINK_VENDAS.meusLinksVendas.caminho,
      sessoes.lider,
    );
    expect(links.status).toBe(200);
    respostaMeusLinksVendasSchema.parse(await links.json());
    await esperarErro(
      await requisitar("GET", "/api/minha/visao", coordenacao),
      403,
      "proibido",
    );
    // Sem sessão, 401, como sempre (o login vem antes da chave).
    await esperarErro(
      await requisitar("GET", "/api/minha/visao"),
      401,
      "nao_autenticado",
    );
  });

  it("login (POST /api/sessao) com link VÁLIDO do papel desligado: 403 acesso_desligado, sem cookie; link inválido continua 401; o líder entra", async () => {
    await chaves(0, 0);
    for (const papel of PAPEIS_COM_CHAVE) {
      const antes = await env.DB.prepare(
        "SELECT count(*) AS n FROM sessoes",
      ).first<{
        n: number;
      }>();
      const res = await entrar(tokens[papel]);
      expect({ papel, status: res.status, corpo: await res.json() }).toEqual({
        papel,
        status: 403,
        corpo: {
          erro: {
            codigo: "acesso_desligado",
            mensagem: expect.any(String),
            detalhes: { papel },
          },
        },
      });
      expect(res.headers.get("Set-Cookie")).toBeNull();
      expect(
        await env.DB.prepare("SELECT count(*) AS n FROM sessoes").first(),
      ).toEqual(antes);
    }
    await esperarErro(await entrar("x".repeat(43)), 401, "nao_autenticado");
    const lider = await entrar(tokens.lider);
    expect(lider.status).toBe(200);
    expect(lider.headers.get("Set-Cookie")).toContain("__Host-sessao=");
  });

  it("religada a chave, o link e a sessão de antes voltam a valer (nada foi revogado)", async () => {
    await chaves(0, 0);
    await chaves(1, 1);
    for (const papel of PAPEIS_COM_CHAVE) {
      expect(
        (await requisitar("GET", "/api/minha/visao", sessoes[papel])).status,
      ).toBe(200);
      const res = await entrar(tokens[papel]);
      expect(res.status).toBe(200);
      expect(
        respostaSessaoSchema.parse(await res.json()).usuario.alvo,
      ).toMatchObject({ id: ALVO[papel] });
    }
  });

  it("gerar links em lote do papel desligado: 409 acao_desligada com a chave, antes de conferir os ids (o líder gera)", async () => {
    await chaves(0, 0);
    for (const papel of PAPEIS_COM_CHAVE) {
      const res = await requisitar(
        "POST",
        ROTAS_ACESSO_HIERARQUIA.gerarLinksHierarquia.caminho,
        admin,
        JSON.stringify({ papel, ids: [999999] }),
      );
      expect({ papel, status: res.status, corpo: await res.json() }).toEqual({
        papel,
        status: 409,
        corpo: {
          erro: {
            codigo: "acao_desligada",
            mensagem: expect.any(String),
            detalhes: {
              chave:
                papel === "discipulador"
                  ? "acesso.discipuladores"
                  : "acesso.redes",
            },
          },
        },
      });
    }
    // O corpo inválido ainda dá 400 (antes da chave); o líder não tem chave (o id inexistente dá o 404 de sempre).
    expect(
      (
        await requisitar(
          "POST",
          ROTAS_ACESSO_HIERARQUIA.gerarLinksHierarquia.caminho,
          admin,
          JSON.stringify({ papel: "rede", ids: [] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await requisitar(
          "POST",
          ROTAS_ACESSO_HIERARQUIA.gerarLinksHierarquia.caminho,
          admin,
          JSON.stringify({ papel: "lider", ids: [999999] }),
        )
      ).status,
    ).toBe(404);
  });
});

describe("i) RIFA-064 (D29): login da célula com a senha padrão, só na /minha da própria célula", () => {
  /** A célula 1 do cenário ("Célula Ágape") e a 2 ("Célula Betel"), de painel-apoio. */
  const CELULA = { id: 1, nome: "Célula Ágape", senha: "@celulaagape1234" };
  const OUTRA = { id: 2, nome: "Célula Betel" };
  let sessaoPorSenha: Record<string, string>;
  let liderPeloLink: Record<string, string>;

  const chaveDaSenha = (ligada: 0 | 1) =>
    env.DB.prepare(
      "UPDATE campanhas SET acesso_celulas_senha = ?1 WHERE ativa = 1",
    )
      .bind(ligada)
      .run();
  const entrarComSenha = (
    corpo: object,
    cabecalhos: Record<string, string> = { Origin: ORIGEM },
  ) =>
    exports.default.fetch(`${ORIGEM}${ROTAS_ACESSO.entrarComSenha.caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify(corpo),
    });

  beforeAll(async () => {
    await semearCenario();
    const res = await entrarComSenha({
      celula: CELULA.nome,
      senha: CELULA.senha,
    });
    expect(res.status).toBe(200);
    const cookie = /^__Host-sessao=([^;]+)/.exec(
      res.headers.get("Set-Cookie") ?? "",
    )?.[1];
    sessaoPorSenha = { Cookie: `__Host-sessao=${cookie}`, Origin: ORIGEM };
    liderPeloLink = await cabecalhosDeSessaoDaHierarquia("lider", OUTRA.id);
  });

  // A trilha guarda o login (e segura o usuário do líder): limpa, para o próximo describe poder semear de novo.
  afterAll(async () => {
    await chaveDaSenha(1);
    await env.DB.prepare(
      "DELETE FROM auditoria WHERE acao = 'sessao.entrar_com_senha'",
    ).run();
  });

  it("o contrato declara POST /api/sessao/senha aberto, e ele está montado no app (corpo vazio: 400, não 404)", async () => {
    expect(GRUPO_NO_CONTRATO.get("POST /api/sessao/senha")).toBe("aberto");
    expect(
      rotasRegistradas().map((rota) => `${rota.metodo} ${rota.caminho}`),
    ).toContain("POST /api/sessao/senha");
    const vazio = await requisitar("POST", "/api/sessao/senha", {
      Origin: ORIGEM,
    });
    expect(vazio.status).toBe(400);
    esperarCabecalhosDeSeguranca(vazio);
  });

  it("a sessão aberta pela senha é a do papel líder da célula (o alvo dela, lido da sessão)", async () => {
    const res = await requisitar("GET", "/api/sessao", sessaoPorSenha);
    expect(res.status).toBe(200);
    const { usuario } = respostaSessaoSchema.parse(await res.json());
    expect(usuario).toMatchObject({
      papel: "lider",
      alvo: { tipo: "celula", id: CELULA.id, nome: CELULA.nome },
    });
  });

  it("403 em TODA rota registrada sob /api/admin e /api/painel (inclusive fora do contrato) e nos caminhos sem rota", async () => {
    const protegidas = rotasRegistradas().filter((rota) =>
      eDaCoordenacao(rota.caminho),
    );
    expect(protegidas.length).toBeGreaterThanOrEqual(30);
    for (const rota of [
      ...protegidas,
      ...ROTAS_DA_COORDENACAO.filter((daCoordenacao) =>
        daCoordenacao.caminho.startsWith("/api/admin"),
      ),
      ...["/api/admin", "/api/admin/qualquer", "/api/painel/x/y"].flatMap(
        (caminho) =>
          (["GET", ...ESCRITAS] as const).map((metodo) => ({
            metodo,
            caminho,
          })),
      ),
    ]) {
      const res = await requisitar(
        rota.metodo,
        concreto(rota.caminho),
        sessaoPorSenha,
      );
      expect({
        rota: `${rota.metodo} ${rota.caminho}`,
        status: res.status,
      }).toEqual({ rota: `${rota.metodo} ${rota.caminho}`, status: 403 });
      expect(erroApiSchema.parse(await res.json()).erro.codigo).toBe(
        "proibido",
      );
    }
  });

  it("a /minha é só a da célula: a visão e os links de vendas (mesmo pedindo outra célula) trazem o alvo da sessão", async () => {
    const visao = await requisitar("GET", "/api/minha/visao", sessaoPorSenha);
    expect(visao.status).toBe(200);
    expect(visao.headers.get("Cache-Control")).toBe("no-store");
    respostaVisaoIndividualSchema.parse(await visao.json());
    for (const caminho of [
      ROTAS_LINK_VENDAS.meusLinksVendas.caminho,
      `${ROTAS_LINK_VENDAS.meusLinksVendas.caminho}?celula_id=${OUTRA.id}`,
    ]) {
      const res = await requisitar("GET", caminho, sessaoPorSenha);
      expect(res.status).toBe(200);
      const corpo = respostaMeusLinksVendasSchema.parse(await res.json());
      expect({ caminho, alvo: corpo.alvo.id }).toEqual({
        caminho,
        alvo: CELULA.id,
      });
      expect(JSON.stringify(corpo)).not.toContain(OUTRA.nome);
    }
  });

  it("CSRF: o login de outra origem dá 403 sem sessão; com a sessão da senha, escrita de outra origem em /api/minha dá 403", async () => {
    const antes = await env.DB.prepare(
      "SELECT count(*) AS n FROM sessoes",
    ).first();
    const res = await entrarComSenha(
      { celula: CELULA.nome, senha: CELULA.senha },
      { Origin: ORIGEM_MALICIOSA },
    );
    await esperarErro(res, 403, "proibido");
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM sessoes").first(),
    ).toEqual(antes);
    for (const metodo of ESCRITAS)
      await esperarErro(
        await requisitar(metodo, "/api/minha/visao", {
          ...sessaoPorSenha,
          Origin: ORIGEM_MALICIOSA,
        }),
        403,
        "proibido",
      );
  });

  it("chave desligada: o login por senha dá 401 e a sessão da senha cai (401) em todo /api/minha; o líder pelo link segue; religada, entra", async () => {
    await chaveDaSenha(0);
    await esperarErro(
      await entrarComSenha({ celula: CELULA.nome, senha: CELULA.senha }),
      401,
      "nao_autenticado",
    );
    for (const caminho of [
      "/api/sessao",
      "/api/minha/visao",
      ROTAS_LINK_VENDAS.meusLinksVendas.caminho,
      "/api/minha/qualquer",
    ])
      await esperarErro(
        await requisitar("GET", caminho, sessaoPorSenha),
        401,
        "nao_autenticado",
      );
    expect(
      (await requisitar("GET", "/api/minha/visao", liderPeloLink)).status,
    ).toBe(200);
    await chaveDaSenha(1);
    expect(
      (await requisitar("GET", "/api/minha/visao", sessaoPorSenha)).status,
    ).toBe(200);
  });
});

describe("j) RIFA-073 (D33): login do admin com usuário e senha", () => {
  const SENHA = "senha de teste da protecao";
  const USUARIO = "admin.protecao";
  let doLink: Record<string, string>;
  let pelaSenha: Record<string, string>;

  const entrarComoAdmin = (
    corpo: object,
    cabecalhos: Record<string, string> = { Origin: ORIGEM },
  ) =>
    exports.default.fetch(`${ORIGEM}${ROTAS_ACESSO.entrarComoAdmin.caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify(corpo),
    });

  beforeAll(async () => {
    doLink = await cabecalhosDeSessao("admin");
    const definida = await requisitar(
      "PUT",
      ROTAS_ACESSO.definirMinhaSenhaAdmin.caminho,
      doLink,
      JSON.stringify({ usuario: USUARIO, senha: SENHA }),
    );
    expect(definida.status).toBe(200);
    const res = await entrarComoAdmin({ usuario: USUARIO, senha: SENHA });
    expect(res.status).toBe(200);
    const cookie = /^__Host-sessao=([^;]+)/.exec(
      res.headers.get("Set-Cookie") ?? "",
    )?.[1];
    pelaSenha = { Cookie: `__Host-sessao=${cookie}`, Origin: ORIGEM };
  });

  it("o contrato declara POST /api/sessao/admin aberto e a senha do admin só de admin; tudo montado no app", async () => {
    expect(GRUPO_NO_CONTRATO.get("POST /api/sessao/admin")).toBe("aberto");
    const registradas = rotasRegistradas().map(
      (rota) => `${rota.metodo} ${rota.caminho}`,
    );
    expect(registradas).toContain("POST /api/sessao/admin");
    for (const rota of [
      ROTAS_ACESSO.obterMinhaSenhaAdmin,
      ROTAS_ACESSO.definirMinhaSenhaAdmin,
      ROTAS_ACESSO.removerMinhaSenhaAdmin,
    ]) {
      expect(registradas).toContain(`${rota.metodo} ${rota.caminho}`);
      expect(
        ROTAS_DA_COORDENACAO.find(
          (item) =>
            item.metodo === rota.metodo && item.caminho === rota.caminho,
        )?.papeis,
      ).toEqual(["admin"]);
    }
    const vazio = await requisitar("POST", "/api/sessao/admin", {
      Origin: ORIGEM,
    });
    expect(vazio.status).toBe(400);
    esperarCabecalhosDeSeguranca(vazio);
  });

  it("a sessão aberta pela senha é a do admin e passa em TODA rota da coordenação (inclusive as só de admin)", async () => {
    const { usuario } = respostaSessaoSchema.parse(
      await (await requisitar("GET", "/api/sessao", pelaSenha)).json(),
    );
    expect(usuario.papel).toBe("admin");
    // Menos remover a própria senha, que derruba esta sessão (o último teste confere).
    for (const rota of ROTAS_DA_COORDENACAO.filter(
      (item) =>
        `${item.metodo} ${item.caminho}` !== "DELETE /api/admin/minha-senha",
    ))
      await esperarQuePassou(
        await requisitar(rota.metodo, concreto(rota.caminho), pelaSenha),
      );
    // A hierarquia continua fora: a sessão do admin leva 403 em /api/minha.
    await esperarErro(
      await requisitar("GET", "/api/minha/visao", pelaSenha),
      403,
      "proibido",
    );
  });

  it("a senha do admin: sem sessão 401; coordenação, líder, discipulador e rede 403", async () => {
    const sessoes = [
      coordenacao,
      await cabecalhosDeSessaoDaHierarquia("lider", 1),
      await cabecalhosDeSessaoDaHierarquia("discipulador", 10),
      await cabecalhosDeSessaoDaHierarquia("rede", 1),
    ];
    for (const metodo of ["GET", "PUT", "DELETE"] as const) {
      await esperarErro(
        await requisitar(metodo, "/api/admin/minha-senha", { Origin: ORIGEM }),
        401,
        "nao_autenticado",
      );
      for (const sessao of sessoes)
        await esperarErro(
          await requisitar(
            metodo,
            "/api/admin/minha-senha",
            sessao,
            JSON.stringify({ usuario: "outro.usuario", senha: SENHA }),
          ),
          403,
          "proibido",
        );
    }
  });

  it("CSRF: login de outra origem 403 sem cookie; escrita da senha de outra origem 403, mesmo com a sessão do admin", async () => {
    const login = await entrarComoAdmin(
      { usuario: USUARIO, senha: SENHA },
      { Origin: "https://site-malicioso.example" },
    );
    await esperarErro(login, 403, "proibido");
    expect(login.headers.get("Set-Cookie")).toBeNull();
    for (const metodo of ["PUT", "DELETE"] as const)
      await esperarErro(
        await requisitar(
          metodo,
          "/api/admin/minha-senha",
          { ...pelaSenha, Origin: "https://site-malicioso.example" },
          JSON.stringify({ usuario: "outro.usuario", senha: SENHA }),
        ),
        403,
        "proibido",
      );
  });

  it("removida a senha, a sessão aberta por ela cai (401) e o login recusa; a do link continua", async () => {
    const res = await requisitar("DELETE", "/api/admin/minha-senha", doLink);
    expect(res.status).toBe(204);
    await esperarErro(
      await requisitar("GET", "/api/admin/usuarios", pelaSenha),
      401,
      "nao_autenticado",
    );
    await esperarErro(
      await entrarComoAdmin({ usuario: USUARIO, senha: SENHA }),
      401,
      "nao_autenticado",
    );
    expect(
      (await requisitar("GET", "/api/admin/usuarios", doLink)).status,
    ).toBe(200);
  });
});

describe("formato único de erro em todas as partes montadas", () => {
  it.each<
    [
      string,
      Metodo,
      string,
      string | undefined,
      Record<string, string>,
      number,
      CodigoErro,
    ]
  >([
    [
      "webhook",
      "POST",
      "/api/webhooks/rifei",
      "{}",
      {},
      401,
      "nao_autenticado",
    ],
    [
      "sessão: link inválido",
      "POST",
      "/api/sessao",
      '{"token":"x"}',
      { Origin: ORIGEM },
      401,
      "nao_autenticado",
    ],
    [
      "sessão: corpo que não é JSON",
      "POST",
      "/api/sessao",
      "{",
      { Origin: ORIGEM },
      400,
      "json_invalido",
    ],
    [
      "sessão: sem token",
      "POST",
      "/api/sessao",
      "{}",
      { Origin: ORIGEM },
      400,
      "requisicao_invalida",
    ],
    [
      "sessão: corpo acima de 4 KiB (RIFA-013b)",
      "POST",
      "/api/sessao",
      JSON.stringify({ token: "x".repeat(5000) }),
      { Origin: ORIGEM },
      413,
      "corpo_muito_grande",
    ],
    [
      "auditoria: consulta inválida (RIFA-013b)",
      "GET",
      "/api/admin/auditoria?limite=0",
      undefined,
      {},
      400,
      "requisicao_invalida",
    ],
    [
      "usuários: id inexistente",
      "POST",
      `/api/admin/usuarios/${ID_INEXISTENTE}/links`,
      undefined,
      {},
      404,
      "nao_encontrado",
    ],
    [
      "usuários: parâmetro inválido",
      "PATCH",
      "/api/admin/usuarios/abc",
      '{"ativo":true}',
      {},
      400,
      "requisicao_invalida",
    ],
    [
      "hierarquia: JSON malformado",
      "POST",
      "/api/admin/redes",
      '{"nome": "Rede',
      {},
      400,
      "json_invalido",
    ],
    [
      "hierarquia: fora do schema",
      "POST",
      "/api/admin/redes",
      '{"nome":""}',
      {},
      400,
      "requisicao_invalida",
    ],
    [
      "hierarquia: id inexistente",
      "GET",
      `/api/admin/redes/${ID_INEXISTENTE}`,
      undefined,
      {},
      404,
      "nao_encontrado",
    ],
    [
      "notFound",
      "GET",
      "/api/rota-inexistente",
      undefined,
      {},
      404,
      "nao_encontrado",
    ],
  ])(
    "%s: %s %s → formato único",
    async (_parte, metodo, caminho, corpo, cabecalhos, status, codigo) => {
      const comSessao = caminho.startsWith("/api/admin/") ? admin : {};
      const res = await requisitar(
        metodo,
        caminho,
        { ...comSessao, ...cabecalhos },
        corpo,
      );

      expect(res.status).toBe(status);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      const json: unknown = await res.json();
      expect(erroApiSchema.parse(json)).toEqual(json);
      expect(erroApiSchema.parse(json).erro.codigo).toBe(codigo);
    },
  );

  it("onError: falha do banco na checagem da sessão vira 500 erro_interno, sem detalhes", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const dbComFalha = {
      prepare: () => {
        throw new Error("D1 indisponível");
      },
    } as unknown as D1Database;

    const res = await app.request(
      "/api/admin/celulas",
      { headers: admin },
      { ...env, DB: dbComFalha },
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      erro: { codigo: "erro_interno", mensagem: "Erro interno" },
    });
    esperarCabecalhosDeSeguranca(res);
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
