// RIFA-091 (adendo da D41): a atribuição à mão da célula (PUT /api/admin/pedidos/:id/celula) liga a venda sem afiliado
// ao afiliado da célula também na Rifei. App real (D1 local com as migrações) e uma Rifei FALSA no lugar do fetch:
// nenhuma chamada sai daqui. Vincula e grava o affiliate_id; célula sem afiliado, com vários, sem conexão, a Rifei que
// recusa, não responde, recusa o token ou responde outro afiliado: a atribuição vale do mesmo jeito (nunca 5xx);
// repetir tenta de novo; desfazer e o pedido com afiliado não chamam; o token nunca aparece em resposta, log ou trilha.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MENSAGEM_FALHA_RIFEI,
  respostaAtribuirCelulaPedidoSchema,
  type RespostaAtribuirCelulaPedido,
} from "../../shared/contracts";
import app from "../index";
import { cifrarTokenRifei } from "../lib/cifra-rifei";
import { ORIGEM, cabecalhosDeSessao } from "../test/acesso-teste";
import {
  DADOS_CAMPANHA_RANKING_UNICO,
  aprovado,
  limparBanco,
  semearCenario,
  type PedidoTeste,
} from "../test/painel-apoio";

const db = env.DB;
const TOKEN = "token-ficticio-da-api-da-rifei-091";
const TOKEN_TELA = "token-ficticio-colado-na-tela-0091";
const CHAVE = "chave-ficticia-dos-testes-com-mais-de-32-caracteres";
const SLUG = DADOS_CAMPANHA_RANKING_UNICO.slug_rifei;
const ID_RIFEI = 1671784;
/** A Canaã (3) tem um afiliado só no cenário: o 103. */
const CANAA = 3;
const AFILIADO_CANAA = 103;

const SEM_AFILIADO: PedidoTeste = {
  ...aprovado(null, "2026-11-25T15:00:00.000Z", 37),
  id: "SEM-AFILIADO-37",
};
const DE_ORFAO: PedidoTeste = {
  ...aprovado(900, "2026-11-26T15:00:00.000Z", 11),
  id: "DE-ORFAO-11",
};

// ---------------------------------------------------------------------------------------------------
// A Rifei falsa
// ---------------------------------------------------------------------------------------------------

interface ChamadaRifei {
  metodo: string;
  caminho: string;
  corpo: string | null;
  cabecalhos: Headers;
}

/** O que a Rifei falsa responde ao link-affiliate (o GET da campanha sempre dá certo, salvo `tokenRecusado`). */
let respostaDoVinculo: (affiliateId: number) => Response;
let tokenRecusado: boolean;
let chamadas: ChamadaRifei[];

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** A resposta 200 de verdade (capturada pelo PO em 24/11), com o e-mail e o nome que o sistema não pode guardar. */
const vinculoAceito = (affiliateId: number) =>
  json(200, {
    id: 555,
    affiliate_id: affiliateId,
    author_id: 77,
    code: "lider-ficticio",
    commission_type: "percentage",
    commission_value: 0,
    products_type: "all",
    products: [],
    created_at: "2026-11-24T02:19:00.000000Z",
    updated_at: "2026-11-24T02:19:00.000000Z",
    affiliate: {
      id: affiliateId,
      email: "lider.ficticio@example.com",
      name: "Lider Ficticio da Rifei",
    },
  });

const vinculos = () =>
  chamadas.filter((chamada) => chamada.caminho.endsWith("/link-affiliate"));

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
    chamadas.push({
      metodo,
      caminho,
      corpo: typeof init?.body === "string" ? init.body : null,
      cabecalhos: new Headers(init?.headers),
    });
    if (tokenRecusado) return json(401, { message: "Unauthenticated" });
    if (metodo === "GET" && caminho === `/raffles/${SLUG}`)
      return json(200, { id: ID_RIFEI, version: 1 });
    const vinculo = caminho.match(
      new RegExp(`^/raffles/${ID_RIFEI}/orders/(.+)/link-affiliate$`),
    );
    if (metodo === "PUT" && vinculo) {
      const { affiliate_id: id } = JSON.parse(String(init?.body)) as {
        affiliate_id: number;
      };
      return respostaDoVinculo(id);
    }
    return json(404, { message: "rota desconhecida" });
  });
}

// ---------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------

let admin: Record<string, string>;

async function atribuir(
  id: string,
  celulaId: number | null,
  segredos: Partial<Cloudflare.Env> = { RIFEI_API_TOKEN: TOKEN },
): Promise<Response> {
  const headers = new Headers(admin);
  headers.set("Content-Type", "application/json");
  return app.request(
    `${ORIGEM}/api/admin/pedidos/${encodeURIComponent(id)}/celula`,
    { method: "PUT", headers, body: JSON.stringify({ celula_id: celulaId }) },
    { ...env, ...segredos },
  );
}

/** Corpos crus das respostas, para conferir que o token nunca aparece. */
let textos: string[];

async function atribuirOk(
  id: string,
  celulaId: number | null,
  segredos?: Partial<Cloudflare.Env>,
): Promise<RespostaAtribuirCelulaPedido> {
  const res = await atribuir(id, celulaId, segredos);
  expect(res.status).toBe(200);
  const texto = await res.text();
  textos.push(texto);
  return respostaAtribuirCelulaPedidoSchema.parse(JSON.parse(texto));
}

const pedidoNoBanco = (id: string) =>
  db
    .prepare(
      "SELECT affiliate_id, celula_atribuida_id, atualizado_em FROM pedidos WHERE id = ?1",
    )
    .bind(id)
    .first<{
      affiliate_id: number | null;
      celula_atribuida_id: number | null;
      atualizado_em: string;
    }>();

const trilha = async (acao: string) =>
  (
    await db
      .prepare("SELECT alvo, resumo FROM auditoria WHERE acao = ?1 ORDER BY id")
      .bind(acao)
      .all<{ alvo: string; resumo: string }>()
  ).results;

const toda = async () =>
  (
    await db
      .prepare("SELECT acao, alvo, resumo FROM auditoria ORDER BY id")
      .all<{ acao: string; alvo: string; resumo: string }>()
  ).results;

/** O token colado na tela, cifrado com a chave dos testes (a linha que a tela Conexão com a Rifei grava). */
async function gravarTokenDaTela() {
  await db
    .prepare(
      `INSERT INTO rifei_conexao (id, token_cifrado, final_token, conectado_em)
       VALUES (1, ?1, '0091', '2026-11-24T12:00:00.000Z')`,
    )
    .bind(await cifrarTokenRifei(TOKEN_TELA, CHAVE))
    .run();
}

let logs: unknown[][];

beforeEach(async () => {
  await semearCenario({
    campanha: DADOS_CAMPANHA_RANKING_UNICO,
    pedidos: [SEM_AFILIADO, DE_ORFAO],
  });
  await db.batch([
    db.prepare("DELETE FROM auditoria"),
    db.prepare("DELETE FROM rifei_conexao"),
  ]);
  admin = await cabecalhosDeSessao("admin");
  respostaDoVinculo = vinculoAceito;
  tokenRecusado = false;
  chamadas = [];
  textos = [];
  logs = [];
  instalarRifei();
  for (const nivel of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
});

afterEach(async () => {
  // O token nunca sai do servidor: nem na resposta, nem no log, nem na trilha.
  const trilhaInteira = JSON.stringify(await toda());
  for (const texto of [...textos, JSON.stringify(logs), trilhaInteira]) {
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(TOKEN_TELA);
    // Nem o e-mail ou o nome do afiliado que a Rifei devolve.
    expect(texto).not.toContain("lider.ficticio@example.com");
    expect(texto).not.toContain("Lider Ficticio da Rifei");
  }
  vi.restoreAllMocks();
  await limparBanco();
});

// ---------------------------------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------------------------------

describe("RIFA-091: a atribuição liga a venda ao afiliado da célula na Rifei", () => {
  it("a Rifei aceita: PUT link-affiliate com o afiliado da célula; grava o affiliate_id; a célula passa a vir do afiliado", async () => {
    const resposta = await atribuirOk(SEM_AFILIADO.id, CANAA);
    expect(resposta).toMatchObject({
      id: SEM_AFILIADO.id,
      affiliate_id: AFILIADO_CANAA,
      celula_id: CANAA,
      celula_nome: "Célula Canaã",
      celula_origem: "afiliado",
      rifei: { situacao: "vinculado" },
    });
    expect(resposta.rifei.mensagem).toBeUndefined();
    // A chamada: o id da campanha na Rifei, o código do pedido e o corpo capturado (Content-Length 24 no exemplo).
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      `GET /raffles/${SLUG}`,
      `PUT /raffles/${ID_RIFEI}/orders/${SEM_AFILIADO.id}/link-affiliate`,
    ]);
    const [vinculo] = vinculos();
    expect(vinculo.corpo).toBe(
      JSON.stringify({ affiliate_id: AFILIADO_CANAA }),
    );
    expect(vinculo.cabecalhos.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(vinculo.cabecalhos.get("x-rate-limit")).toBe("true");
    expect(vinculo.cabecalhos.get("Content-Type")).toBe("application/json");
    // No banco: o afiliado gravado pelo sistema e a atribuída continua (D41).
    expect(await pedidoNoBanco(SEM_AFILIADO.id)).toMatchObject({
      affiliate_id: AFILIADO_CANAA,
      celula_atribuida_id: CANAA,
    });
    expect(await trilha("pedido.atribuir_celula")).toHaveLength(1);
    expect(await trilha("pedido.vincular_afiliado_rifei")).toEqual([
      {
        alvo: `pedido:${SEM_AFILIADO.id}`,
        resumo: `Pedido "${SEM_AFILIADO.id}": afiliado ${AFILIADO_CANAA} da célula ${CANAA} na Rifei: vinculado`,
      },
    ]);
    // Agora a célula vem do afiliado: atribuir de novo dá 409 (D41) e não chama a Rifei.
    const deNovo = await atribuir(SEM_AFILIADO.id, CANAA);
    expect(deNovo.status).toBe(409);
    expect(vinculos()).toHaveLength(1);
  });

  it("célula sem afiliado e célula com vários afiliados: não chama a Rifei e a atribuição vale", async () => {
    await db
      .prepare(
        "UPDATE afiliados SET celula_id = NULL, vinculado_em = NULL WHERE affiliate_id = ?1",
      )
      .bind(AFILIADO_CANAA)
      .run();
    const sem = await atribuirOk(SEM_AFILIADO.id, CANAA);
    expect(sem).toMatchObject({
      affiliate_id: null,
      celula_id: CANAA,
      celula_origem: "manual",
      rifei: { situacao: "celula_sem_afiliado" },
    });
    await db.batch([
      db
        .prepare(
          "UPDATE afiliados SET celula_id = ?1, vinculado_em = '2026-11-24T12:00:00.000Z' WHERE affiliate_id = ?2",
        )
        .bind(CANAA, AFILIADO_CANAA),
      db
        .prepare(
          `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
           VALUES (106, ?1, 'manual', '2026-11-24T12:00:00.000Z')`,
        )
        .bind(CANAA),
    ]);
    // Repetir a mesma célula: sem trilha nova da atribuição, mas a regra da Rifei roda de novo.
    const varios = await atribuirOk(SEM_AFILIADO.id, CANAA);
    expect(varios.rifei).toEqual({ situacao: "varios_afiliados" });
    expect(varios.celula_origem).toBe("manual");
    expect(chamadas).toEqual([]);
    expect((await pedidoNoBanco(SEM_AFILIADO.id))?.affiliate_id).toBeNull();
    expect(await trilha("pedido.atribuir_celula")).toHaveLength(1);
    expect(await trilha("pedido.vincular_afiliado_rifei")).toEqual([]);
  });

  it("sem conexão (sem token, ou o da tela que a chave não abre): não chama a Rifei e a atribuição vale", async () => {
    const semToken = await atribuirOk(SEM_AFILIADO.id, CANAA, {
      RIFEI_API_TOKEN: "",
    });
    expect(semToken).toMatchObject({
      celula_id: CANAA,
      celula_origem: "manual",
      rifei: { situacao: "sem_conexao" },
    });
    // O token da tela tem prioridade; sem a chave do servidor (RIFEI_CHAVE_CIFRA) ele não pode ser lido.
    await gravarTokenDaTela();
    const ilegivel = await atribuirOk(SEM_AFILIADO.id, CANAA);
    expect(ilegivel.rifei).toEqual({ situacao: "sem_conexao" });
    expect(chamadas).toEqual([]);
    expect((await pedidoNoBanco(SEM_AFILIADO.id))?.affiliate_id).toBeNull();
    expect(await trilha("pedido.vincular_afiliado_rifei")).toEqual([]);
  });

  it("a Rifei recusa: a mensagem dela vai junto, nada é gravado no pedido; repetir tenta de novo e, aceita, vincula", async () => {
    respostaDoVinculo = () =>
      json(422, { message: "  Este pedido   não pode ser alterado " });
    const recusada = await atribuirOk(SEM_AFILIADO.id, CANAA);
    expect(recusada).toMatchObject({
      affiliate_id: null,
      celula_id: CANAA,
      celula_origem: "manual",
      rifei: {
        situacao: "recusado",
        mensagem: "Este pedido não pode ser alterado",
      },
    });
    expect((await pedidoNoBanco(SEM_AFILIADO.id))?.affiliate_id).toBeNull();

    respostaDoVinculo = vinculoAceito;
    const repetida = await atribuirOk(SEM_AFILIADO.id, CANAA);
    expect(repetida).toMatchObject({
      affiliate_id: AFILIADO_CANAA,
      celula_origem: "afiliado",
      rifei: { situacao: "vinculado" },
    });
    expect(vinculos()).toHaveLength(2);
    // A atribuição não mudou na segunda vez (sem trilha nova); as duas tentativas na Rifei entram.
    expect(await trilha("pedido.atribuir_celula")).toHaveLength(1);
    expect(
      (await trilha("pedido.vincular_afiliado_rifei")).map((l) => l.resumo),
    ).toEqual([
      `Pedido "${SEM_AFILIADO.id}": afiliado ${AFILIADO_CANAA} da célula ${CANAA} na Rifei: recusado`,
      `Pedido "${SEM_AFILIADO.id}": afiliado ${AFILIADO_CANAA} da célula ${CANAA} na Rifei: vinculado`,
    ]);
  });

  it("a Rifei não responde (503), recusa o token (401) ou devolve outro afiliado: 200 com a situação, nunca 5xx", async () => {
    respostaDoVinculo = () => json(503, {});
    const indisponivel = await atribuirOk(SEM_AFILIADO.id, CANAA);
    expect(indisponivel.rifei).toEqual({
      situacao: "indisponivel",
      mensagem: MENSAGEM_FALHA_RIFEI.indisponivel,
    });

    respostaDoVinculo = () => vinculoAceito(999);
    const outro = await atribuirOk(SEM_AFILIADO.id, CANAA);
    expect(outro.rifei).toEqual({
      situacao: "falhou",
      mensagem: MENSAGEM_FALHA_RIFEI.resposta_inesperada,
    });

    tokenRecusado = true;
    const token = await atribuirOk(SEM_AFILIADO.id, CANAA);
    expect(token.rifei).toEqual({
      situacao: "falhou",
      mensagem: MENSAGEM_FALHA_RIFEI.token_invalido,
    });
    expect(token).toMatchObject({ celula_id: CANAA, celula_origem: "manual" });
    expect((await pedidoNoBanco(SEM_AFILIADO.id))?.affiliate_id).toBeNull();
    expect(
      (await trilha("pedido.vincular_afiliado_rifei")).map((l) => l.resumo),
    ).toEqual([
      `Pedido "${SEM_AFILIADO.id}": afiliado ${AFILIADO_CANAA} da célula ${CANAA} na Rifei: indisponivel`,
      `Pedido "${SEM_AFILIADO.id}": afiliado ${AFILIADO_CANAA} da célula ${CANAA} na Rifei: falhou (resposta_inesperada)`,
      `Pedido "${SEM_AFILIADO.id}": afiliado ${AFILIADO_CANAA} da célula ${CANAA} na Rifei: falhou (token_invalido)`,
    ]);
  });

  it("com o token da tela: a recusa (401) fica gravada na conexão, e o sucesso depois limpa (como as outras chamadas)", async () => {
    await gravarTokenDaTela();
    const comChave = { RIFEI_API_TOKEN: "", RIFEI_CHAVE_CIFRA: CHAVE };
    tokenRecusado = true;
    expect(
      (await atribuirOk(SEM_AFILIADO.id, CANAA, comChave)).rifei.situacao,
    ).toBe("falhou");
    const conexao = () =>
      db
        .prepare("SELECT testado_em, recusado_em FROM rifei_conexao")
        .first<{ testado_em: string | null; recusado_em: string | null }>();
    expect((await conexao())?.recusado_em).not.toBeNull();
    tokenRecusado = false;
    expect(
      (await atribuirOk(SEM_AFILIADO.id, CANAA, comChave)).rifei.situacao,
    ).toBe("vinculado");
    expect(await conexao()).toMatchObject({
      testado_em: expect.any(String),
      recusado_em: null,
    });
    expect(vinculos()[0].cabecalhos.get("Authorization")).toBe(
      `Bearer ${TOKEN_TELA}`,
    );
  });

  it("não se aplica: desfazer e o pedido que já tem afiliado (não vinculado) não chamam a Rifei", async () => {
    respostaDoVinculo = () => json(422, { message: "não chegou aqui" });
    await atribuirOk(SEM_AFILIADO.id, CANAA);
    chamadas = [];
    const desfeito = await atribuirOk(SEM_AFILIADO.id, null);
    expect(desfeito).toMatchObject({
      celula_id: null,
      rifei: { situacao: "nao_se_aplica" },
    });
    const orfao = await atribuirOk(DE_ORFAO.id, CANAA);
    expect(orfao).toMatchObject({
      affiliate_id: 900,
      celula_id: CANAA,
      celula_origem: "manual",
      rifei: { situacao: "nao_se_aplica" },
    });
    expect(chamadas).toEqual([]);
    expect((await pedidoNoBanco(DE_ORFAO.id))?.affiliate_id).toBe(900);
  });
});
