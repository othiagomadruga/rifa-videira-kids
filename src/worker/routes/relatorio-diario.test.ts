// RIFA-086 (D40): as rotas do relatório diário (prévia e envio agora) e do saldo da Efí, SÓ DO ADMIN, no D1 local com
// o cenário do painel (test/painel-apoio.ts) e o relógio fixo no dia 9 da campanha (01/12/2026 12:00 em Belém): ontem é
// o dia 8, segunda, 30/11. O e-mail e a Efí são SIMULADOS (nenhum envio real, nenhuma chamada real) e os endereços são
// de exemplo. Os sub-apps são montados como no index.ts (sob /api/admin, depois dos cabeçalhos de segurança); o app
// real (a ordem de montagem e o 401/403 de cada papel) é provado também em src/worker/protecao.test.ts.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  erroApiSchema,
  respostaEnviarRelatorioDiarioSchema,
  respostaSaldoEfiSchema,
} from "../../shared/contracts";
import { esquecerEfi, URL_SALDO_EFI } from "../lib/efi";
import type { CriarMensagem } from "../lib/relatorio-diario-envio";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  CSP_PREVIA_EMAIL,
  cabecalhosSeguranca,
} from "../middleware/cabecalhos-seguranca";
import {
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
} from "../test/acesso-teste";
import { AGORA, limparBanco, semearCenario } from "../test/painel-apoio";
import { PREFIXO_EFI, criarEfi } from "./efi";
import {
  PREFIXO_RELATORIO_DIARIO,
  criarRelatorioDiario,
} from "./relatorio-diario";

const enviados: { para: string; mime: string }[] = [];
const criarMensagem: CriarMensagem = (de, para, mime) =>
  ({ from: de, to: para, mime }) as unknown as ReturnType<CriarMensagem>;
const send = vi.fn(async (mensagem: unknown) => {
  const { to, mime } = mensagem as { to: string; mime: string };
  enviados.push({ para: to, mime });
  return { messageId: "id" };
});
const EMAIL = { send } as unknown as SendEmail;
const DESTINATARIOS = "pastor@exemplo.com.br,po@example.com";

const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.use("*", cabecalhosSeguranca);
app.route(
  PREFIXO_RELATORIO_DIARIO,
  criarRelatorioDiario({
    relogio: () => AGORA,
    efi: { agora: () => AGORA.getTime(), avisar: () => {} },
    envio: { criarMensagem },
  }),
);
app.route(PREFIXO_EFI, criarEfi({ agora: () => AGORA.getTime() }));
app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

const PREVIA = "/api/admin/relatorio-diario/previa";
const ENVIAR = "/api/admin/relatorio-diario/enviar";
const SALDO = "/api/admin/efi/saldo";

let admin: Record<string, string>;
let coordenacao: Record<string, string>;
let lider: Record<string, string>;

function chamar(
  metodo: "GET" | "POST",
  caminho: string,
  cabecalhos: Record<string, string>,
  ambiente: Partial<Cloudflare.Env> = {},
  corpo: unknown = {},
) {
  const headers = new Headers(cabecalhos);
  if (metodo === "POST") headers.set("Content-Type", "application/json");
  return app.request(
    caminho,
    {
      method: metodo,
      headers,
      body: metodo === "POST" ? JSON.stringify(corpo) : undefined,
    },
    { ...env, ...ambiente },
  );
}

async function esperarErro(res: Response, status: number, codigo: string) {
  const corpo: unknown = await res.json();
  expect({ status: res.status, corpo }).toMatchObject({
    status,
    corpo: { erro: { codigo } },
  });
  return erroApiSchema.parse(corpo).erro;
}

beforeAll(async () => {
  await semearCenario();
  admin = await cabecalhosDeSessao("admin");
  coordenacao = await cabecalhosDeSessao("coordenacao");
  lider = await cabecalhosDeSessaoDaHierarquia("lider", 1);
});

afterAll(async () => {
  await limparBanco();
});

beforeEach(() => {
  esquecerEfi();
  enviados.length = 0;
  send.mockClear();
});

describe("só o admin: a coordenação e a hierarquia levam 403; sem sessão, 401; e nada é enviado", () => {
  it.each([
    ["GET", PREVIA],
    ["POST", ENVIAR],
    ["GET", SALDO],
  ] as const)("%s %s", async (metodo, caminho) => {
    const ambiente = { EMAIL, RELATORIO_EMAILS: DESTINATARIOS };
    await esperarErro(
      await chamar(metodo, caminho, { Origin: "http://localhost" }, ambiente),
      401,
      "nao_autenticado",
    );
    for (const sessao of [coordenacao, lider])
      await esperarErro(
        await chamar(metodo, caminho, sessao, ambiente),
        403,
        "proibido",
      );
    expect(send).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/relatorio-diario/previa", () => {
  it("padrão: o e-mail de ontem (30/11), em HTML, com a CSP da prévia (só estilo inline, nenhum script) e no-store", async () => {
    const res = await chamar("GET", PREVIA, admin);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP_PREVIA_EMAIL);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    const html = await res.text();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Resumo de segunda, 30/11 · dia 8 de 21");
    expect(html).toContain("<b>135 bilhetes</b> vendidos");
    // A Efí não está configurada nos testes.
    expect(html).toContain(
      'Saldo na Efí: <span style="color:#8a8499">indisponível</span>',
    );
  });

  it("`data` escolhe o dia (hoje também vale); depois de hoje, 400 data_futura; fora da campanha, 400 fora_da_campanha", async () => {
    const dia1 = await chamar("GET", `${PREVIA}?data=2026-11-23`, admin);
    expect(dia1.status).toBe(200);
    expect(await dia1.text()).toContain(
      "Resumo de segunda, 23/11 · dia 1 de 21",
    );
    const hoje = await chamar("GET", `${PREVIA}?data=2026-12-01`, admin);
    expect(hoje.status).toBe(200);
    expect(await hoje.text()).toContain("Resumo de terça, 01/12 · dia 9 de 21");

    const futura = await esperarErro(
      await chamar("GET", `${PREVIA}?data=2026-12-02`, admin),
      400,
      "requisicao_invalida",
    );
    expect(futura.detalhes).toMatchObject([{ codigo: "data_futura" }]);
    const antes = await esperarErro(
      await chamar("GET", `${PREVIA}?data=2026-11-22`, admin),
      400,
      "requisicao_invalida",
    );
    expect(antes.detalhes).toMatchObject([
      { caminho: ["data"], codigo: "fora_da_campanha" },
    ]);
    await esperarErro(
      await chamar("GET", `${PREVIA}?data=30/11/2026`, admin),
      400,
      "requisicao_invalida",
    );
  });

  it("nada pessoal: nem o nome e o telefone do comprador (D36) nem o contato do líder aparecem", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE pedidos SET comprador_nome = 'Comprador Ficticio Secreto', comprador_telefone = '+5591988887777'",
      ),
      env.DB.prepare(
        "UPDATE celulas SET lider_telefone = '+5591977776666', lider_email = 'lider@example.com'",
      ),
    ]);
    const html = await (await chamar("GET", PREVIA, admin)).text();
    for (const pessoal of [
      "Comprador Ficticio Secreto",
      "988887777",
      "977776666",
      "lider@example.com",
      "Líder da",
    ])
      expect(html).not.toContain(pessoal);
  });
});

describe("POST /api/admin/relatorio-diario/enviar", () => {
  it("sem o binding EMAIL ou sem destinatário: 503 nao_configurado, sem ler o banco e sem enviar", async () => {
    const prepare = vi.spyOn(env.DB, "prepare");
    await esperarErro(
      await chamar("POST", ENVIAR, admin, {
        EMAIL: undefined,
        RELATORIO_EMAILS: DESTINATARIOS,
      }),
      503,
      "nao_configurado",
    );
    await esperarErro(
      await chamar("POST", ENVIAR, admin, { EMAIL, RELATORIO_EMAILS: " , " }),
      503,
      "nao_configurado",
    );
    // Só a sessão foi lida (exigirSessao); nada do relatório.
    expect(
      prepare.mock.calls.some(([sql]) => String(sql).includes("pedidos")),
    ).toBe(false);
    prepare.mockRestore();
    expect(send).not.toHaveBeenCalled();
  });

  it("envia um e-mail por destinatário (ontem, por padrão), responde só as contagens e registra na trilha sem os e-mails", async () => {
    const res = await chamar("POST", ENVIAR, admin, {
      EMAIL,
      RELATORIO_EMAILS: DESTINATARIOS,
    });

    expect(res.status).toBe(200);
    const corpo = respostaEnviarRelatorioDiarioSchema.parse(await res.json());
    expect(corpo).toEqual({
      data: "2026-11-30",
      destinatarios: 2,
      enviados: 2,
      falhas: 0,
    });
    expect(enviados.map(({ para }) => para)).toEqual([
      "pastor@exemplo.com.br",
      "po@example.com",
    ]);
    const trilha = await env.DB.prepare(
      "SELECT acao, alvo, resumo FROM auditoria WHERE acao = 'relatorio_diario.enviar' ORDER BY id DESC LIMIT 1",
    ).first<{ acao: string; alvo: string; resumo: string }>();
    expect(trilha).toEqual({
      acao: "relatorio_diario.enviar",
      alvo: "relatorio_diario",
      resumo: "Relatório de 2026-11-30 enviado: 2 de 2 destinatário(s)",
    });
    expect(JSON.stringify(trilha)).not.toContain("@");
  });

  it("`data` no corpo escolhe o dia; fora da campanha, 400 e nada enviado; campo a mais, 400", async () => {
    const ambiente = { EMAIL, RELATORIO_EMAILS: "po@example.com" };
    const res = await chamar("POST", ENVIAR, admin, ambiente, {
      data: "2026-11-23",
    });
    expect(await res.json()).toMatchObject({ data: "2026-11-23", enviados: 1 });

    send.mockClear();
    await esperarErro(
      await chamar("POST", ENVIAR, admin, ambiente, { data: "2026-11-21" }),
      400,
      "requisicao_invalida",
    );
    await esperarErro(
      await chamar("POST", ENVIAR, admin, ambiente, {
        destinatarios: ["outro@example.com"],
      }),
      400,
      "requisicao_invalida",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("de outra origem (CSRF): 403, nada enviado", async () => {
    await esperarErro(
      await chamar(
        "POST",
        ENVIAR,
        { ...admin, Origin: "https://site-malicioso.example" },
        { EMAIL, RELATORIO_EMAILS: DESTINATARIOS },
      ),
      403,
      "proibido",
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/efi/saldo", () => {
  it("sem a Efí configurada: 200, configurado false, no-store", async () => {
    const res = await chamar("GET", SALDO, admin);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(respostaSaldoEfiSchema.parse(await res.json())).toEqual({
      configurado: false,
      saldo_centavos: null,
      consultado_em: AGORA.toISOString(),
    });
  });

  it("configurada (binding mTLS simulado): o saldo em centavos; a Efí falhou: 200 com o erro, sem 5xx", async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) =>
      String(url) === URL_SALDO_EFI
        ? Response.json({ saldo: "4321.09" })
        : Response.json({ access_token: "t", expires_in: 3600 }),
    );
    const ambiente = {
      EFI_CERT: { fetch } as unknown as Fetcher,
      EFI_CLIENT_ID: "id-ficticio",
      EFI_CLIENT_SECRET: "segredo-ficticio",
    };
    expect(await (await chamar("GET", SALDO, admin, ambiente)).json()).toEqual({
      configurado: true,
      saldo_centavos: 432_109,
      consultado_em: AGORA.toISOString(),
    });

    esquecerEfi();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetch.mockImplementation(async () => new Response("", { status: 502 }));
    const falhou = await chamar("GET", SALDO, admin, ambiente);
    expect(falhou.status).toBe(200);
    expect(await falhou.json()).toEqual({
      configurado: true,
      saldo_centavos: null,
      consultado_em: AGORA.toISOString(),
      erro: "autenticacao",
    });
  });
});
