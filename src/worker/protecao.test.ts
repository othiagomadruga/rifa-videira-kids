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
  ROTAS,
  ROTAS_ACESSO,
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
  respostaPainelResumoSchema,
  respostaPedidosSuspeitosSchema,
  respostaRankingPublicoSchema,
  respostaRankingSchema,
  respostaWebhookRifeiSchema,
  somarDias,
  type CodigoErro,
  type Papel,
} from "../shared/contracts";
import app from "./index";
import { TTL_CACHE_PUBLICO_MS } from "./lib/cache-publico";
import { CABECALHOS_SEGURANCA } from "./middleware/cabecalhos-seguranca";
import { CACHE_PUBLICO } from "./routes/publico";
import { ORIGEM, cabecalhosDeSessao } from "./test/acesso-teste";
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
 * restrita, como a auditoria) e ROTAS_ACESSO (papéis da própria rota).
 */
const ROTAS_DA_COORDENACAO: RotaDaCoordenacao[] = [
  ...Object.values(ROTAS)
    .filter((rota) => rota.grupo === "coordenacao")
    .map((rota) => ({
      metodo: rota.metodo,
      caminho: rota.caminho,
      papeis:
        "papeis" in rota ? rota.papeis : (["admin", "coordenacao"] as const),
    })),
  ...Object.values(ROTAS_ACESSO)
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
  [...Object.values(ROTAS), ...Object.values(ROTAS_ACESSO)].map(
    (rota): [string, string] => [`${rota.metodo} ${rota.caminho}`, rota.grupo],
  ),
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
    // 24 de ROTAS + 6 de ROTAS_ACESSO (5 só de admin e o GET /api/sessao) na Sprint 2.
    expect(ROTAS_DA_COORDENACAO.length).toBeGreaterThanOrEqual(30);
    expect(
      ROTAS_DA_COORDENACAO.filter(
        (rota) => !rota.papeis.includes("coordenacao"),
      ).length,
    ).toBeGreaterThanOrEqual(5);
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
      if (grupo === "coordenacao") {
        // Ex.: GET /api/sessao, protegida dentro do próprio sub-app.
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
    // CSV fictício com dado pessoal: nem o 401 nem o 403 leem ou devolvem o arquivo.
    const csv =
      'Pedido,Nome,Status,Valor\r\nR-PROTECAO,Maria Ficticia da Protecao,Pago,"R$ 20,00"\r\n';
    const corpos: Record<string, string | undefined> = {
      [ROTAS.analisarReconciliacao.caminho]: JSON.stringify({ csv }),
      [ROTAS.recuperarReconciliacao.caminho]: JSON.stringify({
        csv,
        mapeamento: {
          pedido_id: 0,
          status: 2,
          qtd_bilhetes: null,
          bilhetes: null,
          valor: 3,
          afiliado: null,
          data: null,
        },
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
      expect(texto).not.toContain("Maria Ficticia");
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
    await env.DB.prepare(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
         meta_unidade, meta_regra, meta_valor, ranking_criterio)
       VALUES ('Campanha de teste', ?, 1, '2026-11-23', 2000, 'bilhetes', 'por_pessoa', 10,
         'percentual_meta')`,
    )
      .bind(paidOrderAfiliado.slug)
      .run();

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
