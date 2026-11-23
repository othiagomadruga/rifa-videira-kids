// RIFA-087 (adendo da D40): GET /api/admin/arrecadado, o cartão "Arrecadado" da Visão geral, SÓ DO ADMIN. No D1 local
// com o cenário do painel (test/painel-apoio.ts) e o relógio fixo no dia 9 da campanha (01/12/2026 12:00 em Belém).
// Quanto entrou vem do banco (os pedidos pagos que a Rifei manda pelo webhook): nenhuma chamada à Efí nem à Rifei. Aqui
// também se prova, no banco, que o valor do dia (o "Hoje" do cartão e o "Hoje até 17h" do e-mail da tarde) não conta
// pedido de outro dia, não pago, desconsiderado nem de outra campanha. Os sub-apps são montados como no index.ts; o app
// real (401/403 de cada papel) é provado também em src/worker/protecao.test.ts.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  erroApiSchema,
  montarResumoPainel,
  respostaArrecadadoSchema,
} from "../../shared/contracts";
import { lerEntradaDoCalculo } from "../db/painel";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import { cabecalhosSeguranca } from "../middleware/cabecalhos-seguranca";
import {
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
} from "../test/acesso-teste";
import {
  AGORA,
  PEDIDOS,
  aprovado,
  desconsiderado,
  limparBanco,
  semearCenario,
} from "../test/painel-apoio";
import { PREFIXO_ARRECADADO, criarArrecadado } from "./arrecadado";
import {
  PREFIXO_RELATORIO_DIARIO,
  criarRelatorioDiario,
} from "./relatorio-diario";

const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.use("*", cabecalhosSeguranca);
app.route(PREFIXO_ARRECADADO, criarArrecadado({ relogio: () => AGORA }));
app.route(
  PREFIXO_RELATORIO_DIARIO,
  criarRelatorioDiario({ relogio: () => AGORA }),
);
app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

const ARRECADADO = "/api/admin/arrecadado";

/** 01/12 (hoje, dia 9) às 14:00 de Belém. */
const HOJE_14H = "2026-12-01T17:00:00.000Z";

/**
 * O cenário e, no dia de hoje, pedidos que NÃO contam: um que não foi pago (aguardando), um expirado (com hora de
 * aprovação gravada, o pior caso para o filtro), um pago e desconsiderado pelo admin e um pago de outra campanha.
 */
const PEDIDOS_DO_TESTE = [
  ...PEDIDOS,
  {
    id: "PT-HOJE-AGUARDANDO",
    affiliate_id: 101,
    status: "in_process",
    aprovado_em: null,
    qtd_bilhetes: 30,
    total_centavos: 60_000,
  },
  {
    id: "PT-HOJE-EXPIRADO",
    affiliate_id: 102,
    status: "expired",
    aprovado_em: HOJE_14H,
    qtd_bilhetes: 40,
    total_centavos: 80_000,
  },
  desconsiderado(aprovado(103, HOJE_14H, 50)),
  { ...aprovado(104, HOJE_14H, 60), id: "PT-HOJE-OUTRA", campanha: "outra" },
] as const;

let admin: Record<string, string>;

function chamar(caminho: string, cabecalhos: Record<string, string>) {
  return app.request(caminho, { headers: cabecalhos }, env);
}

beforeAll(async () => {
  await semearCenario({ pedidos: PEDIDOS_DO_TESTE });
  admin = await cabecalhosDeSessao("admin");
});

afterAll(async () => {
  await limparBanco();
});

describe("GET /api/admin/arrecadado", () => {
  it("só o admin: a coordenação e a hierarquia levam 403; sem sessão, 401", async () => {
    const semSessao = await chamar(ARRECADADO, {});
    expect(semSessao.status).toBe(401);
    for (const sessao of [
      await cabecalhosDeSessao("coordenacao"),
      await cabecalhosDeSessaoDaHierarquia("lider", 1),
    ]) {
      const res = await chamar(ARRECADADO, sessao);
      expect(res.status).toBe(403);
      expect(erroApiSchema.parse(await res.json()).erro.codigo).toBe(
        "proibido",
      );
    }
  });

  it("admin: a campanha até agora (o mesmo total do painel) e hoje, só com os pedidos pagos de hoje; no-store", async () => {
    const res = await chamar(ARRECADADO, admin);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const corpo = respostaArrecadadoSchema.parse(await res.json());
    // Hoje (01/12): Ágape 1, Dorcas 5 e 7 e 1 sem célula = 14 bilhetes, R$ 280,00. Ficam de fora o aguardando, o
    // expirado, o desconsiderado, o de outra campanha e os pedidos de 30/11 e de 02/12 em diante.
    expect(corpo).toEqual({
      data: "2026-12-01",
      campanha: {
        pedidos_aprovados: 25,
        bilhetes: 149,
        total_centavos: 296_400,
      },
      hoje: { pedidos_aprovados: 4, bilhetes: 14, total_centavos: 28_000 },
      atualizado_em: AGORA.toISOString(),
    });
    // A campanha é o `vendas` do resumo do painel (escopo campanha), a mesma fonte do número grande do e-mail.
    const lido = await lerEntradaDoCalculo(env.DB, () => AGORA);
    if (!lido.ok) throw new Error("sem campanha");
    expect(corpo.campanha).toEqual(
      montarResumoPainel(
        lido.entrada,
        {
          escopo: {
            tipo: "campanha",
            id: null,
            divisao: null,
            nome: lido.entrada.campanha.nome,
          },
        },
        AGORA,
      ).vendas,
    );
  });

  it("o e-mail da tarde mostra o mesmo valor de hoje (e o da manhã, o de ontem), sem os pedidos que não contam", async () => {
    const tarde = await (
      await chamar(
        `${PREFIXO_RELATORIO_DIARIO}/relatorio-diario/previa?tipo=tarde`,
        admin,
      )
    ).text();
    expect(tarde).toMatch(
      /Hoje até 12h<\/td><td[^>]*><b>14<\/b> bilhetes · <b>R\$ 280,00<\/b>/,
    );
    expect(tarde).toContain("R$ 2.964,00");
    const manha = await (
      await chamar(`${PREFIXO_RELATORIO_DIARIO}/relatorio-diario/previa`, admin)
    ).text();
    expect(manha).toMatch(
      /No dia<\/td><td[^>]*><b>17<\/b> bilhetes · <b>R\$ 340,00<\/b>/,
    );
  });

  it("sem campanha ativa: 404 nao_encontrado", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await env.DB.prepare("UPDATE campanhas SET ativa = 0").run();
    const res = await chamar(ARRECADADO, admin);
    expect(res.status).toBe(404);
    expect(erroApiSchema.parse(await res.json()).erro.codigo).toBe(
      "nao_encontrado",
    );
  });
});

describe("GET /api/admin/arrecadado fora das datas da campanha", () => {
  it("antes do início: campanha zerada e hoje null; depois do fim: o total final e hoje null", async () => {
    await semearCenario();
    admin = await cabecalhosDeSessao("admin");
    const antes = criarArrecadado({
      relogio: () => new Date("2026-11-22T15:00:00.000Z"),
    });
    const depois = criarArrecadado({
      relogio: () => new Date("2026-12-20T15:00:00.000Z"),
    });
    const pedir = (sub: ReturnType<typeof criarArrecadado>) => {
      const local = new Hono<{ Bindings: Cloudflare.Env }>();
      local.route(PREFIXO_ARRECADADO, sub);
      return local.request(ARRECADADO, { headers: admin }, env);
    };

    const naVespera = respostaArrecadadoSchema.parse(
      await (await pedir(antes)).json(),
    );
    expect(naVespera).toMatchObject({
      data: "2026-11-22",
      campanha: { bilhetes: 0, total_centavos: 0 },
      hoje: null,
    });
    const encerrada = respostaArrecadadoSchema.parse(
      await (await pedir(depois)).json(),
    );
    expect(encerrada.hoje).toBeNull();
    expect(encerrada.campanha.bilhetes).toBeGreaterThan(149);
  });
});
