// RIFA-070 (D32): a conexão com a Rifei pela tela (colar, testar, trocar e apagar o token; cifrado no D1, nunca de
// volta ao navegador nem à trilha), o estado com o último teste ok e a recusa do token, e a busca do pedido pelo
// número do pedido ou do bilhete para marcar à mão. Rifei falsa no lugar do fetch: nenhuma chamada real.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROTAS_CONEXAO_RIFEI,
  ROTAS_RIFEI_API,
  erroApiSchema,
  estadoConexaoRifeiSchema,
  respostaBuscarPedidoRifeiSchema,
  respostaMarcarPagosRifeiSchema,
  respostaTesteConexaoRifeiSchema,
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
const SLUG = DADOS_CAMPANHA.slug_rifei;
const ID_RIFEI = 1671784;
const CHAVE = "chave-ficticia-dos-testes-com-mais-de-32-caracteres";
const TOKEN_TELA = "token-ficticio-colado-na-tela-wxyz";
const TOKEN_SEGREDO = "token-ficticio-do-segredo-do-worker";
const {
  obterConexaoRifei: OBTER,
  salvarConexaoRifei: SALVAR,
  testarConexaoRifei: TESTAR,
  apagarConexaoRifei: APAGAR,
  buscarPedidoRifei: BUSCAR,
} = ROTAS_CONEXAO_RIFEI;
const MARCAR = ROTAS_RIFEI_API.marcarPagosRifei;

/** Os tokens que a Rifei falsa aceita; os outros levam 401. */
let aceitos: Set<string>;
let autorizacoes: string[];

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });

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
    const autorizacao = new Headers(init?.headers).get("Authorization") ?? "";
    autorizacoes.push(autorizacao);
    if (!aceitos.has(autorizacao.replace(/^Bearer /, "")))
      return json(401, { message: "Unauthenticated" });
    const metodo = init?.method ?? "GET";
    const caminho = decodeURIComponent(url.pathname);
    if (metodo === "GET" && caminho === `/raffles/${SLUG}`)
      return json(200, { id: ID_RIFEI, version: 1 });
    if (metodo === "PUT" && caminho === "/raffles/orders/many")
      return json(200, { message: "ok" });
    if (metodo === "GET" && caminho.startsWith(`/raffles/${ID_RIFEI}/orders/`))
      return json(200, { status: "approved" });
    return json(404, { message: "rota desconhecida" });
  });
}

async function chamar(
  rota: { metodo: string; caminho: string },
  opcoes: {
    papel?: "admin" | "coordenacao";
    corpo?: unknown;
    consulta?: string;
    chave?: string;
    segredo?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers(
    await cabecalhosDeSessao(opcoes.papel ?? "admin"),
  );
  let body: string | undefined;
  if (rota.metodo !== "GET" && rota.metodo !== "DELETE") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opcoes.corpo ?? {});
  }
  return app.request(
    `${ORIGEM}${rota.caminho}${opcoes.consulta ?? ""}`,
    { method: rota.metodo, headers, body },
    {
      ...env,
      RIFEI_CHAVE_CIFRA: opcoes.chave ?? CHAVE,
      RIFEI_API_TOKEN: opcoes.segredo ?? "",
    },
  );
}

async function esperarErro(res: Response, status: number, codigo: string) {
  expect(res.status).toBe(status);
  const corpo = erroApiSchema.parse(await res.json());
  expect(corpo.erro.codigo).toBe(codigo);
  return corpo.erro;
}

async function estado(opcoes: Parameters<typeof chamar>[1] = {}) {
  const res = await chamar(OBTER, opcoes);
  expect(res.status).toBe(200);
  return estadoConexaoRifeiSchema.parse(await res.json());
}

async function linha() {
  return db
    .prepare("SELECT * FROM rifei_conexao")
    .first<Record<string, unknown>>();
}

/** Todo o texto do banco (para conferir que o token em claro não está em lugar nenhum). */
async function textoDoBanco(): Promise<string> {
  const conexao = await linha();
  const trilha = await db
    .prepare("SELECT resumo, alvo FROM auditoria WHERE acao LIKE 'rifei.%'")
    .all();
  return JSON.stringify([conexao, trilha.results]);
}

const pedido = (id: string, status: PedidoTeste["status"]): PedidoTeste => ({
  id,
  affiliate_id: 101,
  status,
  aprovado_em: status === "approved" ? "2026-11-24T12:00:00.000Z" : null,
  qtd_bilhetes: 2,
  total_centavos: 5000,
});

beforeEach(async () => {
  await limparBanco(db);
  await db.prepare("DELETE FROM rifei_conexao").run();
  await db.prepare("DELETE FROM auditoria WHERE acao LIKE 'rifei.%'").run();
  await semearHierarquia(db);
  await semearCampanha(db);
  aceitos = new Set([TOKEN_TELA, TOKEN_SEGREDO]);
  autorizacoes = [];
  instalarRifei();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RIFA-070 (D32): Conexão com a Rifei pela tela", () => {
  it("só admin: a coordenação leva 403 em todas as rotas, sem chamar a Rifei", async () => {
    for (const rota of Object.values(ROTAS_CONEXAO_RIFEI))
      await esperarErro(
        await chamar(rota, {
          papel: "coordenacao",
          corpo: { token: TOKEN_TELA },
          consulta: "?numero=1",
        }),
        403,
        "proibido",
      );
    expect(autorizacoes).toEqual([]);
  });

  it("colar: testa na Rifei, grava cifrado e mostra só o final; nem a resposta nem a trilha trazem o token", async () => {
    expect(await estado()).toMatchObject({
      origem: null,
      final: null,
      chave_configurada: true,
    });
    // Cola com "Bearer " e aspas, como às vezes sai do console: o sistema limpa.
    const res = await chamar(SALVAR, {
      corpo: { token: ` "Bearer ${TOKEN_TELA}" ` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const texto = await res.text();
    expect(texto).not.toContain(TOKEN_TELA);
    const corpo = respostaTesteConexaoRifeiSchema.parse(JSON.parse(texto));
    expect(corpo.campanha_rifei_id).toBe(String(ID_RIFEI));
    expect(corpo.estado).toMatchObject({
      origem: "tela",
      final: "wxyz",
      token_legivel: true,
      recusado_em: null,
    });
    expect(corpo.estado.testado_em).toBe(corpo.estado.conectado_em);
    expect(autorizacoes).toEqual([`Bearer ${TOKEN_TELA}`]);

    const gravada = await linha();
    expect(String(gravada?.token_cifrado)).toMatch(/^v1:/);
    expect(await textoDoBanco()).not.toContain(TOKEN_TELA);
    const trilha = await db
      .prepare("SELECT resumo FROM auditoria WHERE acao = 'rifei.conectar'")
      .all<{ resumo: string }>();
    expect(trilha.results.map((linha) => linha.resumo)).toEqual([
      "Token da Rifei colado e testado (termina em …wxyz)",
    ]);
    expect(JSON.stringify(await estado())).not.toContain(TOKEN_TELA);
  });

  it("a Rifei recusa o token colado: 502 com a mensagem clara e nada é gravado", async () => {
    const erro = await esperarErro(
      await chamar(SALVAR, { corpo: { token: "token-ficticio-vencido-1234" } }),
      502,
      "rifei_falhou",
    );
    expect(erro.mensagem).toContain(
      "A Rifei recusou o token: cole um novo em Conexão com a Rifei",
    );
    expect(erro.detalhes).toEqual({ motivo: "token_invalido" });
    expect(await linha()).toBeNull();
  });

  it("sem a chave RIFEI_CHAVE_CIFRA: 503 e nada é gravado; texto que não é token: 400", async () => {
    await esperarErro(
      await chamar(SALVAR, { corpo: { token: TOKEN_TELA }, chave: "curta" }),
      503,
      "nao_configurado",
    );
    await esperarErro(
      await chamar(SALVAR, { corpo: { token: "tem espaço no meio do token" } }),
      400,
      "requisicao_invalida",
    );
    expect(await linha()).toBeNull();
    expect(autorizacoes).toEqual([]);
  });

  it("o token da tela vale antes do segredo; a recusa (401) fica gravada e o sucesso seguinte a limpa", async () => {
    await chamar(SALVAR, { corpo: { token: TOKEN_TELA } });
    await semearPedidos(db, [pedido("P1", "in_process")], {
      ativa: (await db
        .prepare("SELECT id FROM campanhas WHERE ativa = 1")
        .first<number>("id"))!,
    });
    autorizacoes = [];

    // O token venceu na Rifei: marcar responde 502 e a tela passa a dizer "A Rifei recusou o token".
    aceitos.delete(TOKEN_TELA);
    const erro = await esperarErro(
      await chamar(MARCAR, {
        corpo: { pedidos: ["P1"] },
        segredo: TOKEN_SEGREDO,
      }),
      502,
      "rifei_falhou",
    );
    expect(erro.mensagem).toBe(
      "A Rifei recusou o token: cole um novo em Conexão com a Rifei (Acessos → Conexão com a Rifei).",
    );
    expect(autorizacoes.every((a) => a === `Bearer ${TOKEN_TELA}`)).toBe(true);
    const recusado = await estado({ segredo: TOKEN_SEGREDO });
    expect(recusado.origem).toBe("tela");
    expect(recusado.recusado_em).not.toBeNull();

    // Uma segunda recusa não muda o instante da primeira.
    await chamar(TESTAR);
    expect((await estado()).recusado_em).toBe(recusado.recusado_em);

    // Token de volta (ex.: a Rifei voltou a aceitar): marcar dá certo, grava o teste e limpa a recusa.
    aceitos.add(TOKEN_TELA);
    const res = await chamar(MARCAR, { corpo: { pedidos: ["P1"] } });
    expect(
      respostaMarcarPagosRifeiSchema.parse(await res.json()).marcados,
    ).toBe(1);
    const depois = await estado();
    expect(depois.recusado_em).toBeNull();
    expect(depois.testado_em! >= recusado.testado_em!).toBe(true);
  });

  it("testar: com o token da tela, ok; a chave mudou: 503 pedindo para colar de novo", async () => {
    await chamar(SALVAR, { corpo: { token: TOKEN_TELA } });
    const res = await chamar(TESTAR);
    expect(res.status).toBe(200);
    expect(
      respostaTesteConexaoRifeiSchema.parse(await res.json()).estado.origem,
    ).toBe("tela");

    const outraChave = "outra-chave-ficticia-com-mais-de-32-caracteres";
    expect((await estado({ chave: outraChave })).token_legivel).toBe(false);
    const erro = await esperarErro(
      await chamar(TESTAR, { chave: outraChave }),
      503,
      "nao_configurado",
    );
    expect(erro.mensagem).toContain("cole um novo");
  });

  it("trocar e apagar: a trilha registra; sem o token da tela, vale o segredo (se houver)", async () => {
    await chamar(SALVAR, { corpo: { token: TOKEN_TELA } });
    await chamar(SALVAR, { corpo: { token: `${TOKEN_SEGREDO}-tela` } });
    aceitos.add(`${TOKEN_SEGREDO}-tela`);
    const res = await chamar(APAGAR, { segredo: TOKEN_SEGREDO });
    expect(res.status).toBe(200);
    expect(estadoConexaoRifeiSchema.parse(await res.json())).toMatchObject({
      origem: "segredo",
      final: null,
    });
    expect(await linha()).toBeNull();
    const trilha = await db
      .prepare(
        "SELECT acao FROM auditoria WHERE acao LIKE 'rifei.%conectar' ORDER BY id",
      )
      .all<{ acao: string }>();
    // O segundo PUT foi recusado (o token novo ainda não era aceito): só um "conectar".
    expect(trilha.results.map((linha) => linha.acao)).toEqual([
      "rifei.conectar",
      "rifei.desconectar",
    ]);
    // Apagar de novo não registra nada.
    await chamar(APAGAR);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'rifei.desconectar'",
        )
        .first<number>("n"))!,
    ).toBe(1);
  });

  it("a validade do token (o exp do JWT) aparece no estado", async () => {
    const exp = Date.UTC(2026, 11, 19, 12, 0, 0) / 1000;
    const meio = btoa(JSON.stringify({ sub: "conta", exp }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${meio}.assinatura-ficticia`;
    aceitos.add(jwt);
    const res = await chamar(SALVAR, { corpo: { token: jwt } });
    expect(
      respostaTesteConexaoRifeiSchema.parse(await res.json()).estado.expira_em,
    ).toBe("2026-12-19T12:00:00.000Z");
  });
});

describe("RIFA-070 (D32): achar o pedido pelo número do pedido ou do bilhete", () => {
  beforeEach(async () => {
    const ativa = (await db
      .prepare("SELECT id FROM campanhas WHERE ativa = 1")
      .first<number>("id"))!;
    await semearPedidos(
      db,
      [
        pedido("PED-RESERVADO", "in_process"),
        pedido("PED-PAGO", "approved"),
        pedido("PED-EXPIRADO", "expired"),
      ],
      { ativa },
    );
    const numeros = db.prepare("UPDATE pedidos SET numeros = ?2 WHERE id = ?1");
    await db.batch([
      numeros.bind("PED-RESERVADO", "[42, 43]"),
      numeros.bind("PED-PAGO", "[7, 8]"),
      // O bilhete 42 já esteve num pedido que expirou: o pendente vem primeiro.
      numeros.bind("PED-EXPIRADO", "[42, 99]"),
    ]);
  });

  async function buscar(numero: string) {
    const res = await chamar(BUSCAR, {
      consulta: `?numero=${encodeURIComponent(numero)}`,
    });
    expect(res.status).toBe(200);
    return respostaBuscarPedidoRifeiSchema.parse(await res.json()).pedidos;
  }

  it("pelo número do pedido: o pedido, como na tela de Pedidos", async () => {
    const [achado, ...resto] = await buscar("PED-PAGO");
    expect(resto).toEqual([]);
    expect(achado.achado_por).toBe("pedido");
    expect(achado.pedido).toMatchObject({
      id: "PED-PAGO",
      status: "approved",
      qtd_bilhetes: 2,
      total_centavos: 5000,
    });
    expect(Object.keys(achado.pedido)).not.toContain("numeros");
  });

  it("pelo bilhete (com zeros à esquerda): o pendente antes do expirado", async () => {
    const achados = await buscar("0042");
    expect(achados.map((a) => [a.achado_por, a.pedido.id])).toEqual([
      ["bilhete", "PED-RESERVADO"],
      ["bilhete", "PED-EXPIRADO"],
    ]);
  });

  it("não achou: lista vazia; número vazio: 400; sem chamar a Rifei", async () => {
    expect(await buscar("123456")).toEqual([]);
    await esperarErro(
      await chamar(BUSCAR, { consulta: "?numero=%20" }),
      400,
      "requisicao_invalida",
    );
    expect(autorizacoes).toEqual([]);
  });
});
