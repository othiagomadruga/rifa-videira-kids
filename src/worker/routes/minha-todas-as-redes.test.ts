// RIFA-090 (adendo da D12): GET /api/minha/todas-as-redes no D1 local, com o relógio fixo no dia 9 da campanha do
// cenário do painel (01/12/2026 12:00 em Belém, 2º dia da Semana 2). Os sub-apps são montados como o index.ts os monta
// (o painel sob /api/painel, para comparar, e o ranking geral sob /api/minha, com o login dentro dele); o app real (a
// ordem de montagem, o 401/403 de cada papel e a chave desligada) é provado em src/worker/protecao.test.ts.
// - o discipulador e a rede veem TODOS os discipuladores (com células) e TODAS as células, na posição e na ordem do
//   ranking da coordenação para a mesma janela, com `eu` nas linhas deles;
// - sem dinheiro, sem comprador, sem telefone e sem id (o comprador do cenário tem nome e telefone gravados);
// - 401 sem sessão; 403 para o líder da célula; 400 janela inválida; 404 sem campanha;
// - os rankings ficam até 30 s na memória (a resposta, nunca: o `eu` muda por pessoa).
// Nomes e telefones fictícios.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  JANELAS_RANKING,
  erroApiSchema,
  respostaRankingSchema,
  respostaTodasAsRedesSchema,
  type RespostaTodasAsRedes,
} from "../../shared/contracts";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import { cabecalhosDeSessaoDaHierarquia } from "../test/acesso-teste";
import {
  AGORA,
  DADOS_CAMPANHA_RANKING_UNICO,
  PEDIDOS,
  aprovado,
  dia,
  semearCenario,
} from "../test/painel-apoio";
import { PREFIXO_MINHA } from "./minha";
import {
  SEM_CACHE_DOS_RANKINGS,
  TTL_TODAS_AS_REDES_MS,
  criarMinhaTodasAsRedes,
} from "./minha-todas-as-redes";
import { PREFIXO_PAINEL, criarPainel } from "./painel";

const db = env.DB;
const CAMINHO = "/api/minha/todas-as-redes";

/** Os sub-apps como o index.ts os monta, com o relógio do teste e o cache dado. */
function montar(
  opcoes: Parameters<typeof criarMinhaTodasAsRedes>[0] = {
    cache: SEM_CACHE_DOS_RANKINGS,
  },
) {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.route(
    PREFIXO_PAINEL,
    criarPainel(() => AGORA),
  );
  app.route(
    PREFIXO_MINHA,
    criarMinhaTodasAsRedes({ relogio: () => AGORA, ...opcoes }),
  );
  app.notFound(rotaInexistente);
  app.onError(erroNaoTratado);
  return app;
}
const app = montar();

const pedir = (
  caminho: string,
  cabecalhos: Record<string, string> = {},
  noApp = app,
) => noApp.request(caminho, { headers: cabecalhos }, env);

/** Um comprador com nome e telefone gravados (D36): nunca pode aparecer aqui. */
const COMPRA_COM_CONTATO = aprovado(101, `${dia(9)}T11:00:00.000Z`, 3);
const NOME_DO_COMPRADOR = "Comprador Inconfundivel";
const TELEFONE_DO_COMPRADOR = "+5591987654321";

const sessoes: Record<
  "discipulador" | "rede" | "lider",
  Record<string, string>
> = { discipulador: {}, rede: {}, lider: {} };

async function semear(): Promise<void> {
  await semearCenario({
    campanha: DADOS_CAMPANHA_RANKING_UNICO,
    pedidos: [...PEDIDOS, COMPRA_COM_CONTATO],
  });
  await db
    .prepare(
      "UPDATE pedidos SET comprador_nome = ?2, comprador_telefone = ?3 WHERE id = ?1",
    )
    .bind(COMPRA_COM_CONTATO.id, NOME_DO_COMPRADOR, TELEFONE_DO_COMPRADOR)
    .run();
  // O discipulador Abel (10: Ágape e Betel), a Rede Adulta (2: Caleb, com Dorcas e Éfeso) e o líder da Ágape (1).
  sessoes.discipulador = await cabecalhosDeSessaoDaHierarquia(
    "discipulador",
    10,
  );
  sessoes.rede = await cabecalhosDeSessaoDaHierarquia("rede", 2);
  sessoes.lider = await cabecalhosDeSessaoDaHierarquia("lider", 1);
}

beforeAll(semear);

async function todasAsRedes(
  sessao: Record<string, string>,
  consulta = "",
  noApp = app,
): Promise<{ texto: string; corpo: RespostaTodasAsRedes }> {
  const res = await pedir(`${CAMINHO}${consulta}`, sessao, noApp);
  const texto = await res.text();
  expect({
    status: res.status,
    cache: res.headers.get("Cache-Control"),
  }).toEqual({ status: 200, cache: "no-store" });
  const corpo: unknown = JSON.parse(texto);
  const lida = respostaTodasAsRedesSchema.parse(corpo);
  expect(lida).toEqual(corpo);
  return { texto, corpo: lida };
}

/** O ranking da coordenação (com valores) do nível e da janela, sem filtro de divisão. */
async function daCoordenacao(nivel: "celula" | "discipulador", janela: string) {
  const res = await pedir(
    `/api/painel/ranking?nivel=${nivel}&periodo=${janela}`,
  );
  expect(res.status).toBe(200);
  return respostaRankingSchema.parse(await res.json());
}

describe("o discipulador e a rede veem todos, na ordem da coordenação", () => {
  it.each(JANELAS_RANKING)(
    "janela %s: todos os discipuladores com células e todas as células, com a posição e a ordem da coordenação",
    async (janela) => {
      const { corpo } = await todasAsRedes(
        sessoes.discipulador,
        `?janela=${janela}`,
      );
      const discipuladores = await daCoordenacao("discipulador", janela);
      const celulas = await daCoordenacao("celula", janela);
      expect(corpo.janela).toEqual(celulas.janela);
      expect(corpo.criterio).toBe(celulas.criterio);
      expect(corpo.discipuladores).toEqual(
        discipuladores.itens.map((item) => ({
          posicao: item.posicao,
          nome: item.nome,
          percentual_meta_bp: item.percentual_meta_bp,
          bilhetes: item.vendas.bilhetes,
          eu: item.id === 10,
        })),
      );
      expect(corpo.celulas).toEqual(
        celulas.itens.map((item) => ({
          posicao: item.posicao,
          nome: item.nome,
          discipulador: item.discipulador?.nome,
          percentual_meta_bp: item.percentual_meta_bp,
          bilhetes: item.vendas.bilhetes,
          eu: item.discipulador?.id === 10,
        })),
      );
      // Os 3 discipuladores com células (o Davi, sem células, fica fora, R8) e as 5 células, das duas redes.
      expect(corpo.discipuladores.map((item) => item.nome).sort()).toEqual([
        "Discipulador Abel",
        "Discipulador Boaz",
        "Discipulador Caleb",
      ]);
      expect(corpo.celulas).toHaveLength(5);
    },
  );

  it("sem janela, a atual (a semana); a consulta não muda o alvo (um id é ignorado)", async () => {
    const semJanela = await todasAsRedes(sessoes.discipulador);
    expect(semJanela.corpo.janela).toMatchObject({
      tipo: "atual",
      nome: "Semana 2",
    });
    const comId = await todasAsRedes(
      sessoes.discipulador,
      "?discipulador_id=30&rede_id=2",
    );
    expect(comId.corpo).toEqual(semJanela.corpo);
  });

  it("eu: o discipulador marca a linha dele e as células dele; a rede, os discipuladores e as células dela", async () => {
    const abel = (await todasAsRedes(sessoes.discipulador, "?janela=campanha"))
      .corpo;
    expect(
      abel.discipuladores.filter((item) => item.eu).map((item) => item.nome),
    ).toEqual(["Discipulador Abel"]);
    expect(
      abel.celulas
        .filter((item) => item.eu)
        .map((item) => item.nome)
        .sort(),
    ).toEqual(["Célula Betel", "Célula Ágape"]);
    const adulta = (await todasAsRedes(sessoes.rede, "?janela=campanha")).corpo;
    expect(
      adulta.discipuladores.filter((item) => item.eu).map((item) => item.nome),
    ).toEqual(["Discipulador Caleb"]);
    expect(
      adulta.celulas
        .filter((item) => item.eu)
        .map((item) => item.nome)
        .sort(),
    ).toEqual(["Célula Dorcas", "Célula Éfeso"]);
    // O resto é igual para os dois (o quadro é um só).
    const semEu = (resposta: RespostaTodasAsRedes) => ({
      ...resposta,
      discipuladores: resposta.discipuladores.map((item) => ({
        ...item,
        eu: false,
      })),
      celulas: resposta.celulas.map((item) => ({ ...item, eu: false })),
    });
    expect(semEu(adulta)).toEqual(semEu(abel));
  });

  it("sem dinheiro, sem comprador, sem telefone e sem id (o comprador do cenário tem nome e telefone gravados)", async () => {
    const celulas = await daCoordenacao("celula", "campanha");
    const centavos = celulas.itens
      .map((item) => item.vendas.total_centavos)
      .filter((valor) => valor > 0);
    expect(centavos.length).toBeGreaterThan(0);
    for (const sessao of [sessoes.discipulador, sessoes.rede])
      for (const janela of JANELAS_RANKING) {
        const { texto } = await todasAsRedes(sessao, `?janela=${janela}`);
        expect(texto).not.toMatch(
          /centavos|total|"meta"|realizado|esperado|"acima"|"abaixo"|"id"|telefone|comprador|whatsapp|senha|R\$/,
        );
        expect(texto).not.toContain(NOME_DO_COMPRADOR);
        expect(texto).not.toContain(TELEFONE_DO_COMPRADOR.slice(3));
        for (const valor of centavos) expect(texto).not.toContain(`${valor}`);
      }
  });
});

describe("quem não pode e os erros", () => {
  it("sem sessão: 401; o líder da célula: 403 proibido (o PO pediu só para os discipuladores), com no-store", async () => {
    const semSessao = await pedir(CAMINHO);
    expect(semSessao.status).toBe(401);
    expect(erroApiSchema.parse(await semSessao.json()).erro.codigo).toBe(
      "nao_autenticado",
    );
    const lider = await pedir(`${CAMINHO}?janela=campanha`, sessoes.lider);
    expect({
      status: lider.status,
      cache: lider.headers.get("Cache-Control"),
    }).toEqual({ status: 403, cache: "no-store" });
    expect(erroApiSchema.parse(await lider.json()).erro.codigo).toBe(
      "proibido",
    );
  });

  it("janela inválida: 400 requisicao_invalida", async () => {
    const res = await pedir(`${CAMINHO}?janela=semana`, sessoes.discipulador);
    expect(res.status).toBe(400);
    expect(erroApiSchema.parse(await res.json()).erro.codigo).toBe(
      "requisicao_invalida",
    );
  });
});

describe("cache dos rankings (30 s) e sem campanha", () => {
  it("os rankings ficam até 30 s por janela; a resposta, que é por pessoa, não", async () => {
    let agora = AGORA.getTime();
    const comCache = montar({ relogio: () => new Date(agora) });
    const antes = (
      await todasAsRedes(sessoes.discipulador, "?janela=atual", comCache)
    ).corpo;
    // Uma venda nova da Canaã (do Boaz) hoje: dentro do prazo, o mesmo quadro (e o `eu` de cada pessoa continua dela).
    await db
      .prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em)
         SELECT 'PT-NOVA', id, 103, 'approved', 40, 80000, ?1 FROM campanhas WHERE ativa = 1`,
      )
      .bind(`${dia(9)}T14:30:00.000Z`)
      .run();
    agora += TTL_TODAS_AS_REDES_MS - 1;
    expect(
      (await todasAsRedes(sessoes.discipulador, "?janela=atual", comCache))
        .corpo.celulas,
    ).toEqual(antes.celulas);
    const daRede = (await todasAsRedes(sessoes.rede, "?janela=atual", comCache))
      .corpo;
    expect(
      daRede.celulas.filter((item) => item.eu).map((item) => item.nome),
    ).toHaveLength(2);
    // A outra janela tem o próprio prazo: lê o banco agora, com a venda nova.
    const campanha = (
      await todasAsRedes(sessoes.discipulador, "?janela=campanha", comCache)
    ).corpo;
    expect(
      campanha.celulas.find((item) => item.nome === "Célula Canaã"),
    ).toMatchObject({ bilhetes: 64 });
    // Passado o prazo, a semana também.
    agora += 2;
    const depois = (
      await todasAsRedes(sessoes.discipulador, "?janela=atual", comCache)
    ).corpo;
    expect(depois.celulas[0]).toMatchObject({
      posicao: 1,
      nome: "Célula Canaã",
      bilhetes: 46,
    });
    expect(depois.celulas).not.toEqual(antes.celulas);
    await db.prepare("DELETE FROM pedidos WHERE id = 'PT-NOVA'").run();
  });

  it("sem campanha ativa: 404 nao_encontrado, com no-store", async () => {
    await db.prepare("UPDATE campanhas SET ativa = 0 WHERE ativa = 1").run();
    try {
      const res = await pedir(CAMINHO, sessoes.discipulador);
      expect({
        status: res.status,
        cache: res.headers.get("Cache-Control"),
      }).toEqual({ status: 404, cache: "no-store" });
      expect(erroApiSchema.parse(await res.json()).erro.codigo).toBe(
        "nao_encontrado",
      );
    } finally {
      await db
        .prepare(
          "UPDATE campanhas SET ativa = 1 WHERE id = (SELECT max(id) FROM campanhas WHERE slug_rifei = 'rifa-videira-kids-teste')",
        )
        .run();
    }
  });
});
