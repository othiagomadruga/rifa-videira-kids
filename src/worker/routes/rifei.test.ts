// RIFA-070 (D32): as rotas da API da Rifei no app real, com o D1 local e uma Rifei falsa no lugar do fetch. Só admin;
// 503 sem o segredo; 404 sem campanha; o banco decide o que vai à Rifei (já pago, desconsiderado e fora do sistema não
// vão); aprovado, expirado restaurado, recusado e indisponível, cada um no seu pedido; 401 da Rifei para tudo (502); a
// trilha sem o token; afiliados com o vínculo e a sugestão pelo e-mail; a sincronização que nunca troca um vínculo; e os
// convites, só com link da Rifei.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROTAS_RIFEI_API,
  detalhesRifeiFalhouSchema,
  erroApiSchema,
  respostaAfiliadosRifeiSchema,
  respostaConvitesRifeiSchema,
  respostaMarcarPagosRifeiSchema,
} from "../../shared/contracts";
import app from "../index";
import { ORIGEM, cabecalhosDeSessao } from "../test/acesso-teste";
import {
  DADOS_CAMPANHA,
  limparBanco,
  semearCampanha,
  semearHierarquia,
  semearPedidos,
  type PedidoTeste,
} from "../test/painel-apoio";

const db = env.DB;
const TOKEN = "token-ficticio-da-api-da-rifei";
const SLUG = DADOS_CAMPANHA.slug_rifei;
const ID_RIFEI = 1671784;
const {
  marcarPagosRifei: MARCAR,
  afiliadosRifei: AFILIADOS,
  sincronizarAfiliadosRifei: SINCRONIZAR,
  convitesRifei: CONVITES,
} = ROTAS_RIFEI_API;

// ---------------------------------------------------------------------------------------------------
// A Rifei falsa
// ---------------------------------------------------------------------------------------------------

interface RifeiFalsa {
  /** Pedidos reservados ou aprovados na lista de pedidos. */
  pedidos: Map<string, "reserved" | "approved">;
  /** Pedidos em "Pedidos expirados" (restauráveis). */
  expirados: Set<string>;
  afiliados: unknown[];
  /** Responde 401 a tudo (token recusado). */
  tokenRecusado: boolean;
  campanhaExiste: boolean;
  /** Aprovação recusada (400 com mensagem). */
  recusar: Set<string>;
  /** Aprovação com 503. */
  indisponivel: Set<string>;
  /** Link que o POST affiliates devolve (padrão: um da Rifei). */
  linkDoConvite: ((n: number) => string) | null;
  chamadas: string[];
  autorizacoes: Set<string | null>;
  convites: number;
}

function novaRifei(): RifeiFalsa {
  return {
    pedidos: new Map(),
    expirados: new Set(),
    afiliados: [],
    tokenRecusado: false,
    campanhaExiste: true,
    recusar: new Set(),
    indisponivel: new Set(),
    linkDoConvite: (n) =>
      `https://rifei.com.br/u/conta/afiliados/registrar?convite=c${n}`,
    chamadas: [],
    autorizacoes: new Set(),
    convites: 0,
  };
}

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let rifei: RifeiFalsa;

function instalarRifei() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada, init) => {
    const url = new URL(
      typeof entrada === "string"
        ? entrada
        : entrada instanceof URL
          ? entrada.href
          : entrada.url,
    );
    if (url.origin !== "https://api.rifei.com.br")
      throw new Error(`fetch fora da Rifei: ${url.href}`);
    const metodo = init?.method ?? "GET";
    const caminho = decodeURIComponent(url.pathname);
    rifei.chamadas.push(`${metodo} ${caminho}`);
    rifei.autorizacoes.add(new Headers(init?.headers).get("Authorization"));
    if (rifei.tokenRecusado) return json(401, { message: "Unauthorized" });

    if (metodo === "GET" && caminho === `/raffles/${SLUG}`)
      return rifei.campanhaExiste
        ? json(200, { id: ID_RIFEI, slug: SLUG, version: 1, status: "active" })
        : json(404, { message: "Campanha não encontrada" });
    if (metodo === "PUT" && caminho === "/raffles/orders/many") {
      const { orders } = JSON.parse(String(init?.body)) as { orders: string[] };
      const [id] = orders;
      if (rifei.indisponivel.has(id)) return json(503, {});
      if (rifei.recusar.has(id))
        return json(400, { message: "Este pedido não pode ser aprovado" });
      // Como um UPDATE em lote: o que não está na lista não muda, e a resposta é 200 do mesmo jeito.
      if (rifei.pedidos.has(id)) rifei.pedidos.set(id, "approved");
      return json(200, { message: "ok" });
    }
    const pedido = caminho.match(
      new RegExp(`^/raffles/${ID_RIFEI}/orders/(.+)$`),
    );
    if (metodo === "GET" && pedido) {
      const status = rifei.pedidos.get(pedido[1]);
      return status
        ? json(200, { id: pedido[1], status })
        : json(404, { message: "Pedido não encontrado" });
    }
    const restaurar = caminho.match(
      /^\/raffles\/expired-orders\/(.+)\/restore$/,
    );
    if (metodo === "PUT" && restaurar) {
      if (!rifei.expirados.delete(restaurar[1]))
        return json(404, { message: "Pedido expirado não encontrado" });
      rifei.pedidos.set(restaurar[1], "reserved");
      return json(200, { id: restaurar[1] });
    }
    if (metodo === "GET" && caminho === "/my-affiliates")
      return json(200, rifei.afiliados);
    if (metodo === "POST" && caminho === "/affiliates") {
      rifei.convites += 1;
      return rifei.linkDoConvite
        ? json(200, { link: rifei.linkDoConvite(rifei.convites) })
        : json(422, { message: "Limite de convites atingido" });
    }
    return json(404, { message: "rota desconhecida" });
  });
}

// ---------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------

async function chamar(
  rota: { metodo: string; caminho: string },
  opcoes: {
    papel?: "admin" | "coordenacao" | null;
    corpo?: unknown;
    segredo?: string;
  } = {},
): Promise<Response> {
  const papel = opcoes.papel === undefined ? "admin" : opcoes.papel;
  const headers = new Headers(
    papel === null ? { Origin: ORIGEM } : await cabecalhosDeSessao(papel),
  );
  let body: string | undefined;
  if (rota.metodo !== "GET") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opcoes.corpo ?? {});
  }
  return app.request(
    `${ORIGEM}${rota.caminho}`,
    { method: rota.metodo, headers, body },
    { ...env, RIFEI_API_TOKEN: opcoes.segredo ?? TOKEN },
  );
}

async function esperarErro(res: Response, status: number, codigo: string) {
  expect(res.status).toBe(status);
  const corpo = erroApiSchema.parse(await res.json());
  expect(corpo.erro.codigo).toBe(codigo);
  return corpo.erro;
}

async function trilha(acao: string) {
  return (
    await db
      .prepare("SELECT alvo, resumo FROM auditoria WHERE acao = ?1 ORDER BY id")
      .bind(acao)
      .all<{ alvo: string; resumo: string }>()
  ).results;
}

const pedido = (
  id: string,
  status: PedidoTeste["status"],
  extra: Partial<PedidoTeste> = {},
): PedidoTeste => ({
  id,
  affiliate_id: 101,
  status,
  aprovado_em: status === "approved" ? "2026-11-24T12:00:00.000Z" : null,
  qtd_bilhetes: 1,
  total_centavos: 2500,
  ...extra,
});

let campanhaId: number;

beforeEach(async () => {
  await limparBanco(db);
  await db.prepare("DELETE FROM auditoria WHERE acao LIKE 'rifei.%'").run();
  await semearHierarquia(db);
  campanhaId = await semearCampanha(db);
  rifei = novaRifei();
  instalarRifei();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------
// Acesso e configuração
// ---------------------------------------------------------------------------------------------------

describe("RIFA-070: só admin, com o segredo configurado", () => {
  it("a coordenação leva 403 em todas as rotas, antes do corpo; sem sessão, 401", async () => {
    for (const rota of [MARCAR, AFILIADOS, SINCRONIZAR, CONVITES]) {
      await esperarErro(
        await chamar(rota, { papel: "coordenacao", corpo: { invalido: true } }),
        403,
        "proibido",
      );
      await esperarErro(
        await chamar(rota, { papel: null }),
        401,
        "nao_autenticado",
      );
    }
    expect(rifei.chamadas).toEqual([]);
  });

  it("sem o segredo RIFEI_API_TOKEN (ou vazio): 503 nao_configurado, sem chamar a Rifei", async () => {
    await esperarErro(
      await chamar(MARCAR, { corpo: { pedidos: ["P1"] }, segredo: "  " }),
      503,
      "nao_configurado",
    );
    await esperarErro(
      await chamar(AFILIADOS, { segredo: "" }),
      503,
      "nao_configurado",
    );
    expect(rifei.chamadas).toEqual([]);
  });

  it("corpo fora do contrato: 400 (vazio, repetido, acima do limite)", async () => {
    for (const corpo of [
      { pedidos: [] },
      { pedidos: ["P1", "P1"] },
      { pedidos: Array.from({ length: 101 }, (_, i) => `P${i}`) },
      { pedidos: ["P1"], extra: 1 },
    ])
      await esperarErro(
        await chamar(MARCAR, { corpo }),
        400,
        "requisicao_invalida",
      );
  });
});

// ---------------------------------------------------------------------------------------------------
// Marcar como pago
// ---------------------------------------------------------------------------------------------------

describe("RIFA-070: POST /api/admin/rifei/marcar-pagos", () => {
  beforeEach(async () => {
    await semearPedidos(
      db,
      [
        pedido("RESERVADO1", "in_process"),
        pedido("EXPIRADO1", "expired"),
        pedido("PAGO1", "approved"),
        pedido("DESCONS1", "in_process", { desconsiderado: "teste" }),
        pedido("RECUSADO1", "in_process"),
        pedido("FORA1", "in_process"),
        pedido("SUMIU1", "in_process"),
      ],
      { ativa: campanhaId },
    );
    rifei.pedidos.set("RESERVADO1", "reserved");
    rifei.pedidos.set("RECUSADO1", "reserved");
    rifei.pedidos.set("FORA1", "reserved");
    rifei.expirados.add("EXPIRADO1");
    rifei.recusar.add("RECUSADO1");
    rifei.indisponivel.add("FORA1");
  });

  it("o resultado de cada pedido, na ordem do corpo; só os pendentes e expirados vão à Rifei", async () => {
    const res = await chamar(MARCAR, {
      corpo: {
        pedidos: [
          "RESERVADO1",
          "EXPIRADO1",
          "PAGO1",
          "DESCONS1",
          "NAO-EXISTE",
          "RECUSADO1",
          "FORA1",
          "SUMIU1",
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const corpo = respostaMarcarPagosRifeiSchema.parse(await res.json());
    expect(
      corpo.itens.map(({ pedido_id, resultado }) => [pedido_id, resultado]),
    ).toEqual([
      ["RESERVADO1", "marcado"],
      ["EXPIRADO1", "restaurado_e_marcado"],
      ["PAGO1", "ja_pago"],
      ["DESCONS1", "desconsiderado"],
      ["NAO-EXISTE", "fora_do_sistema"],
      ["RECUSADO1", "recusado_pela_rifei"],
      ["FORA1", "falhou"],
      ["SUMIU1", "recusado_pela_rifei"],
    ]);
    expect(corpo.marcados).toBe(2);
    expect(
      corpo.itens.find((item) => item.pedido_id === "RECUSADO1")?.mensagem,
    ).toBe("Este pedido não pode ser aprovado");
    expect(
      corpo.itens.find((item) => item.pedido_id === "SUMIU1")?.mensagem,
    ).toMatch(/não foi restaurado/);
    expect(rifei.pedidos.get("RESERVADO1")).toBe("approved");
    expect(rifei.pedidos.get("EXPIRADO1")).toBe("approved");

    // Já pago, desconsiderado e fora do sistema nunca chegam à Rifei; só o PUT em lote (nunca o que alterna).
    const tocados = rifei.chamadas.join("\n");
    for (const id of ["PAGO1", "DESCONS1", "NAO-EXISTE"])
      expect(tocados).not.toContain(id);
    expect(
      rifei.chamadas.filter((c) => /^PUT \/raffles\/\d+\/orders\//.test(c)),
    ).toEqual([]);
    expect([...rifei.autorizacoes]).toEqual([`Bearer ${TOKEN}`]);

    // O sistema não grava nada no pedido: ele conta quando o "Pedido pago" chegar pelo webhook.
    const reservado = await db
      .prepare("SELECT status FROM pedidos WHERE id = 'RESERVADO1'")
      .first<{ status: string }>();
    expect(reservado?.status).toBe("in_process");
  });

  it("a trilha: uma linha com a contagem e os números marcados, nunca o token", async () => {
    await chamar(MARCAR, {
      corpo: { pedidos: ["RESERVADO1", "EXPIRADO1", "RECUSADO1"] },
    });
    const linhas = await trilha("rifei.marcar_pagos");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].alvo).toBe(`campanha:${campanhaId}`);
    expect(linhas[0].resumo).toMatch(/^2 de 3 pedido\(s\) marcado\(s\)/);
    expect(linhas[0].resumo).toContain('"RESERVADO1"');
    expect(linhas[0].resumo).toContain('"EXPIRADO1"');
    expect(
      JSON.stringify(await db.prepare("SELECT * FROM auditoria").all()),
    ).not.toContain(TOKEN);
  });

  it("nada para mandar à Rifei: 200, sem chamada e sem trilha", async () => {
    const res = await chamar(MARCAR, {
      corpo: { pedidos: ["PAGO1", "DESCONS1"] },
    });
    const corpo = respostaMarcarPagosRifeiSchema.parse(await res.json());
    expect(corpo.marcados).toBe(0);
    expect(rifei.chamadas).toEqual([]);
    expect(await trilha("rifei.marcar_pagos")).toEqual([]);
  });

  it("a Rifei recusa o token: 502 rifei_falhou (token_invalido), sem trilha e sem o token na resposta", async () => {
    rifei.tokenRecusado = true;
    const res = await chamar(MARCAR, { corpo: { pedidos: ["RESERVADO1"] } });
    const texto = await res.clone().text();
    const erro = await esperarErro(res, 502, "rifei_falhou");
    expect(detalhesRifeiFalhouSchema.parse(erro.detalhes).motivo).toBe(
      "token_invalido",
    );
    expect(texto).not.toContain(TOKEN);
    expect(await trilha("rifei.marcar_pagos")).toEqual([]);
  });

  it("o slug não é uma campanha da conta: 502 campanha_nao_encontrada", async () => {
    rifei.campanhaExiste = false;
    const erro = await esperarErro(
      await chamar(MARCAR, { corpo: { pedidos: ["RESERVADO1"] } }),
      502,
      "rifei_falhou",
    );
    expect(erro.detalhes).toEqual({ motivo: "campanha_nao_encontrada" });
  });

  it("sem campanha ativa: 404", async () => {
    await limparBanco(db);
    await esperarErro(
      await chamar(MARCAR, { corpo: { pedidos: ["RESERVADO1"] } }),
      404,
      "nao_encontrado",
    );
  });
});

// ---------------------------------------------------------------------------------------------------
// Afiliados
// ---------------------------------------------------------------------------------------------------

describe("RIFA-070: afiliados da Rifei, sincronização e convites", () => {
  beforeEach(async () => {
    // Células 3, 4 e 5 sem afiliado; 101 vinculado à 1, 102 à 2.
    await db
      .prepare(
        "DELETE FROM afiliados WHERE affiliate_id IN (103, 104, 105, 900)",
      )
      .run();
    await db.batch([
      db.prepare(
        "UPDATE celulas SET lider_email = 'lider3@exemplo.com', lider_telefone = '+5591988880003' WHERE id = 3",
      ),
      db.prepare(
        "UPDATE celulas SET lider_email = 'repetido@exemplo.com' WHERE id IN (4, 5)",
      ),
      db.prepare(
        "UPDATE celulas SET lider_email = 'lider1@exemplo.com' WHERE id = 1",
      ),
    ]);
    rifei.afiliados = [
      // Vinculado à célula 1 no sistema: fica com ela, sem sugestão.
      {
        id: 1,
        affiliate_id: 101,
        code: "lider1",
        affiliate: { name: "Líder 1", email: "lider1@exemplo.com" },
      },
      // Novo, com o e-mail (outra caixa e espaços) do líder da célula 3: sugestão.
      {
        id: 2,
        affiliate_id: 3003,
        code: "lider3",
        affiliate: { name: "Líder 3", email: "  LIDER3@Exemplo.com " },
      },
      // O e-mail de dois líderes: sem sugestão.
      {
        id: 3,
        affiliate_id: 4004,
        code: "dupla",
        affiliate: { name: "Dupla", email: "repetido@exemplo.com" },
      },
      // Sem e-mail e sem código.
      { id: 4, affiliate_id: 5005, code: null, affiliate: null },
    ];
  });

  it("GET: o vínculo do sistema, a sugestão pelo e-mail e as células sem afiliado; não grava nada", async () => {
    const res = await chamar(AFILIADOS);
    expect(res.status).toBe(200);
    const corpo = respostaAfiliadosRifeiSchema.parse(await res.json());
    expect(corpo.sincronizacao).toBeNull();
    const porId = new Map(corpo.afiliados.map((a) => [a.affiliate_id, a]));
    expect(porId.get(101)?.celula?.celula_id).toBe(1);
    expect(porId.get(101)?.sugestao).toBeNull();
    expect(porId.get(3003)).toMatchObject({
      codigo: "lider3",
      celula: null,
      sugestao: { celula_id: 3 },
    });
    expect(porId.get(4004)?.sugestao).toBeNull();
    expect(porId.get(5005)).toMatchObject({
      codigo: null,
      email: null,
      sugestao: null,
    });
    expect(
      corpo.celulas_sem_afiliado.map((c) => [c.celula_id, c.tem_email]),
    ).toEqual([
      [3, true],
      [4, true],
      [5, true],
    ]);
    const { results } = await db
      .prepare("SELECT affiliate_id FROM afiliados ORDER BY affiliate_id")
      .all();
    expect(results).toEqual([{ affiliate_id: 101 }, { affiliate_id: 102 }]);
  });

  it("POST sincronizar: grava os códigos, cria os novos, vincula a sugestão e nunca troca um vínculo; repetir não muda nada", async () => {
    // O 102 está vinculado à célula 2, mas o e-mail dele na Rifei é o do líder da 3: o vínculo fica.
    rifei.afiliados.push({
      affiliate_id: 102,
      code: "lider2",
      affiliate: { email: "lider3@exemplo.com" },
    });
    const res = await chamar(SINCRONIZAR);
    expect(res.status).toBe(200);
    const corpo = respostaAfiliadosRifeiSchema.parse(await res.json());
    expect(corpo.sincronizacao).toEqual({ vinculados: 1, codigos_gravados: 5 });
    const { results } = await db
      .prepare(
        "SELECT affiliate_id, celula_id, codigo_rifei, origem FROM afiliados ORDER BY affiliate_id",
      )
      .all();
    expect(results).toEqual([
      {
        affiliate_id: 101,
        celula_id: 1,
        codigo_rifei: "lider1",
        origem: "manual",
      },
      {
        affiliate_id: 102,
        celula_id: 2,
        codigo_rifei: "lider2",
        origem: "manual",
      },
      {
        affiliate_id: 3003,
        celula_id: 3,
        codigo_rifei: "lider3",
        origem: "manual",
      },
      {
        affiliate_id: 4004,
        celula_id: null,
        codigo_rifei: "dupla",
        origem: "manual",
      },
      {
        affiliate_id: 5005,
        celula_id: null,
        codigo_rifei: null,
        origem: "manual",
      },
    ]);
    expect(
      corpo.afiliados.find((a) => a.affiliate_id === 3003)?.celula?.celula_id,
    ).toBe(3);
    expect(corpo.celulas_sem_afiliado.map((c) => c.celula_id)).toEqual([4, 5]);
    const linhas = await trilha("rifei.sincronizar_afiliados");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].alvo).toBe("rifei");
    expect(linhas[0].resumo).not.toMatch(/@/);

    const deNovo = respostaAfiliadosRifeiSchema.parse(
      await (await chamar(SINCRONIZAR)).json(),
    );
    expect(deNovo.sincronizacao).toEqual({
      vinculados: 0,
      codigos_gravados: 0,
    });
    expect(await trilha("rifei.sincronizar_afiliados")).toHaveLength(1);
  });

  it("POST convites: um link por célula, com o telefone do líder; a trilha sem o link", async () => {
    const res = await chamar(CONVITES, { corpo: { celulas: [3, 4] } });
    expect(res.status).toBe(201);
    const corpo = respostaConvitesRifeiSchema.parse(await res.json());
    expect(corpo.falhas).toEqual([]);
    expect(corpo.convites.map((c) => [c.celula_id, c.lider_telefone])).toEqual([
      [3, "+5591988880003"],
      [4, null],
    ]);
    expect(rifei.convites).toBe(2);
    const linhas = await trilha("rifei.gerar_convites");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].resumo).toBe(
      "2 convite(s) de afiliado gerado(s) na Rifei (células 3, 4)",
    );
    expect(linhas[0].resumo).not.toContain("https://");
  });

  it("POST convites: célula inexistente dá 404 sem chamar a Rifei; link fora da Rifei vira falha", async () => {
    await esperarErro(
      await chamar(CONVITES, { corpo: { celulas: [3, 999] } }),
      404,
      "nao_encontrado",
    );
    expect(rifei.chamadas).toEqual([]);

    rifei.linkDoConvite = () => "https://golpe.example/convite";
    const corpo = respostaConvitesRifeiSchema.parse(
      await (await chamar(CONVITES, { corpo: { celulas: [3] } })).json(),
    );
    expect(corpo.convites).toEqual([]);
    expect(corpo.falhas).toEqual([
      { celula_id: 3, mensagem: expect.stringMatching(/não devolveu o link/) },
    ]);
    expect(await trilha("rifei.gerar_convites")).toEqual([]);

    rifei.linkDoConvite = null;
    const recusado = respostaConvitesRifeiSchema.parse(
      await (await chamar(CONVITES, { corpo: { celulas: [3] } })).json(),
    );
    expect(recusado.falhas).toEqual([
      { celula_id: 3, mensagem: "Limite de convites atingido" },
    ]);
  });

  it("a Rifei responde fora do formato em my-affiliates: 502 resposta_inesperada", async () => {
    rifei.afiliados = { nada: true } as unknown as unknown[];
    const erro = await esperarErro(
      await chamar(AFILIADOS),
      502,
      "rifei_falhou",
    );
    expect(erro.detalhes).toEqual({ motivo: "resposta_inesperada" });
  });
});
