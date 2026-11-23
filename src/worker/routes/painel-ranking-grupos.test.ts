// GET /api/painel/ranking-grupos (RIFA-084, D39): o ranking separado pelo grupo do discipulador, só da coordenação,
// com o D1 dos testes e o relógio fixo. Cada resposta 200 passa pelo schema estrito do contrato e é comparada com o
// montador sobre os mesmos dados (a entrada esperada é montada no JS, sem o SQL). O login fica de fora daqui
// (protecao.test.ts confere no app real: 401 sem sessão, 403 para a hierarquia).
//
// Cenário (test/painel-apoio.ts), no dia 9 (Semana 2): Betel 42%, Dorcas 25,2%, Ágape e Canaã 21% (empate), Éfeso 0%.
// Grupos: Caleb (Dorcas, Éfeso) em "Adultos da manhã"; Abel (Ágape, Betel) em "Adultos da noite"; Davi (sem células)
// em "Adolescentes"; Boaz (Canaã) sem grupo. "Jovens" não tem discipulador. Nenhuma célula com grupo próprio, menos nos
// testes da RIFA-085 (o grupo próprio da célula, que vale no lugar do grupo do discipulador no nível célula).
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  JANELAS_RANKING,
  NIVEIS_RANKING_GRUPOS,
  erroApiSchema,
  montarRankingGruposPainel,
  montarRankingPainel,
  respostaRankingGruposSchema,
  type CodigoErro,
  type ConsultaRankingGrupos,
  type GrupoCalculo,
} from "../../shared/contracts";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  AGORA,
  bancoQueConta,
  entradaEsperada,
  limparBanco,
  semearCenario,
} from "../test/painel-apoio";
import { PREFIXO_PAINEL, criarPainel } from "./painel";

const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.route(
  PREFIXO_PAINEL,
  criarPainel(() => AGORA),
);
app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

/** Os ids dos grupos semeados pela migração 0018. */
const GRUPO = { manha: 1, noite: 2, jovens: 3, adolescentes: 4 } as const;

async function chamar(consulta = "", db: D1Database = env.DB) {
  const res = await app.request(
    `/api/painel/ranking-grupos${consulta}`,
    {},
    { ...env, DB: db },
  );
  return {
    status: res.status,
    corpo: (await res.json()) as unknown,
    cacheControl: res.headers.get("Cache-Control"),
  };
}

async function rankingGrupos(consulta = "") {
  const resposta = await chamar(consulta);
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status: 200,
  });
  expect(resposta.cacheControl).toBe("no-store");
  return respostaRankingGruposSchema.parse(resposta.corpo);
}

function esperarErro(
  resposta: Awaited<ReturnType<typeof chamar>>,
  status: number,
  codigo: CodigoErro,
) {
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status,
    corpo: { erro: { codigo } },
  });
  expect(resposta.cacheControl).toBe("no-store");
  return erroApiSchema.parse(resposta.corpo).erro;
}

async function definirGrupos(grupos: Record<number, number | null>) {
  await env.DB.batch(
    Object.entries(grupos).map(([discipulador, grupo]) =>
      env.DB.prepare(
        "UPDATE discipuladores SET grupo_id = ?1 WHERE id = ?2",
      ).bind(grupo, Number(discipulador)),
    ),
  );
}

/** RIFA-085: o grupo próprio de cada célula (null = herda o do discipulador). */
async function definirGruposDasCelulas(grupos: Record<number, number | null>) {
  await env.DB.batch(
    Object.entries(grupos).map(([celula, grupo]) =>
      env.DB.prepare("UPDATE celulas SET grupo_id = ?1 WHERE id = ?2").bind(
        grupo,
        Number(celula),
      ),
    ),
  );
}

/** Os grupos do cenário como o Worker os lê (o montador ordena e descarta os sem células). */
const GRUPOS_DO_CENARIO: GrupoCalculo[] = [
  { id: GRUPO.manha, nome: "Adultos da manhã", ordem: 1, discipuladores: [30] },
  { id: GRUPO.noite, nome: "Adultos da noite", ordem: 2, discipuladores: [10] },
  {
    id: GRUPO.adolescentes,
    nome: "Adolescentes",
    ordem: 4,
    discipuladores: [40],
  },
];

beforeEach(async () => {
  await semearCenario();
  await definirGrupos({
    10: GRUPO.noite,
    20: null,
    30: GRUPO.manha,
    40: GRUPO.adolescentes,
  });
});

afterEach(async () => {
  await limparBanco();
});

describe("GET /api/painel/ranking-grupos (RIFA-084, D39)", () => {
  const CONSULTAS: ConsultaRankingGrupos[] = NIVEIS_RANKING_GRUPOS.flatMap(
    (nivel) => JANELAS_RANKING.map((janela) => ({ nivel, janela })),
  );

  it.each(CONSULTAS)(
    "%o responde o mesmo que montarRankingGruposPainel sobre os mesmos dados",
    async (consulta) => {
      const parametros = new URLSearchParams(consulta);
      expect(await rankingGrupos(`?${parametros}`)).toEqual(
        montarRankingGruposPainel(
          entradaEsperada(),
          GRUPOS_DO_CENARIO,
          consulta,
          AGORA,
        ),
      );
    },
  );

  it("padrão (células, janela atual): só os grupos com células, na ordem, com a posição e os vizinhos DENTRO do grupo", async () => {
    const corpo = await rankingGrupos();
    expect(corpo).toMatchObject({
      nivel: "celula",
      janela: { tipo: "atual", ordem: 2, nome: "Semana 2" },
      criterio: "percentual_meta",
      unidade: "bilhetes",
    });
    expect(
      corpo.grupos.map((grupo) => ({
        nome: grupo.nome,
        ordem: grupo.ordem,
        itens: grupo.itens.map((item) => [
          item.posicao,
          item.nome,
          item.percentual_meta_bp,
        ]),
      })),
    ).toEqual([
      {
        nome: "Adultos da manhã",
        ordem: 1,
        itens: [
          [1, "Célula Dorcas", 2520],
          [2, "Célula Éfeso", 0],
        ],
      },
      {
        nome: "Adultos da noite",
        ordem: 2,
        itens: [
          [1, "Célula Betel", 4200],
          [2, "Célula Ágape", 2100],
        ],
      },
    ]);
    // Os vizinhos são os do grupo: a Ágape tem a Betel acima e ninguém abaixo (a Canaã, sem grupo, não entra).
    const agape = corpo.grupos[1].itens[1];
    expect(agape.acima).toMatchObject({ nome: "Célula Betel", posicao: 1 });
    expect(agape.abaixo).toBeNull();
  });

  it("as metas, o realizado e o % são os do ranking de todas (o mesmo critério e a mesma janela)", async () => {
    const corpo = await rankingGrupos("?janela=campanha");
    const todas = montarRankingPainel(
      entradaEsperada(),
      { nivel: "celula", periodo: "campanha" },
      AGORA,
    );
    expect(corpo.janela).toEqual(todas.janela);
    for (const item of corpo.grupos.flatMap((grupo) => grupo.itens)) {
      const noGeral = todas.itens.find((linha) => linha.id === item.id)!;
      expect({
        nome: item.nome,
        meta: item.meta,
        realizado: item.realizado,
        percentual: item.percentual_meta_bp,
      }).toEqual({
        nome: noGeral.nome,
        meta: noGeral.meta,
        realizado: noGeral.realizado,
        percentual: noGeral.percentual_meta_bp,
      });
    }
  });

  it("nível discipulador: cada discipulador no seu grupo; o sem células e o sem grupo ficam de fora", async () => {
    const corpo = await rankingGrupos("?nivel=discipulador");
    expect(
      corpo.grupos.map((grupo) => [
        grupo.nome,
        grupo.itens.map((item) => `${item.posicao} ${item.nome}`),
      ]),
    ).toEqual([
      ["Adultos da manhã", ["1 Discipulador Caleb"]],
      ["Adultos da noite", ["1 Discipulador Abel"]],
    ]);
  });

  it("o empate divide a posição dentro do grupo (Ágape e Canaã, as duas com 21%)", async () => {
    await definirGrupos({ 20: GRUPO.noite });
    const corpo = await rankingGrupos();
    const noite = corpo.grupos.find((grupo) => grupo.id === GRUPO.noite)!;
    expect(noite.itens.map((item) => [item.posicao, item.nome])).toEqual([
      [1, "Célula Betel"],
      [2, "Célula Ágape"],
      [2, "Célula Canaã"],
    ]);
  });

  it("nenhum discipulador com grupo: 200 com grupos vazio (a tela não mostra a seção)", async () => {
    await definirGrupos({ 10: null, 30: null, 40: null });
    expect((await rankingGrupos()).grupos).toEqual([]);
  });

  it("uma ida ao banco a mais, nenhuma: a campanha e um lote com o cálculo e os grupos", async () => {
    const { db, contagem } = bancoQueConta();
    const resposta = await chamar("", db);
    expect(resposta.status).toBe(200);
    expect(contagem.idas).toBe(2);
  });

  describe("RIFA-085 (D39, adendo): o grupo próprio da célula", () => {
    const resumo = (corpo: Awaited<ReturnType<typeof rankingGrupos>>) =>
      corpo.grupos.map((grupo) => [
        grupo.nome,
        grupo.itens.map((item) => `${item.posicao} ${item.nome}`),
      ]);

    it("nível célula: a célula com grupo próprio sai do grupo do discipulador e entra no dela, com a posição lá", async () => {
      // A Betel (do Abel, "Adultos da noite") é de "Adolescentes", como as células do pedido do PO.
      await definirGruposDasCelulas({ 2: GRUPO.adolescentes });
      const corpo = await rankingGrupos();
      expect(resumo(corpo)).toEqual([
        ["Adultos da manhã", ["1 Célula Dorcas", "2 Célula Éfeso"]],
        ["Adultos da noite", ["1 Célula Ágape"]],
        ["Adolescentes", ["1 Célula Betel"]],
      ]);
      // A meta e o realizado continuam os do ranking de todas.
      const todas = montarRankingPainel(
        entradaEsperada(),
        { nivel: "celula", periodo: "atual" },
        AGORA,
      );
      const betel = corpo.grupos[2].itens[0];
      expect(betel).toMatchObject({ acima: null, abaixo: null });
      const geral = todas.itens.find((item) => item.id === 2)!;
      expect([betel.meta, betel.realizado]).toEqual([
        geral.meta,
        geral.realizado,
      ]);
    });

    it("a resposta é a do montador com o grupo próprio lido do banco (as duas janelas e os dois níveis)", async () => {
      await definirGruposDasCelulas({ 2: GRUPO.adolescentes, 3: GRUPO.jovens });
      const grupos: GrupoCalculo[] = [
        ...GRUPOS_DO_CENARIO.map((grupo) =>
          grupo.id === GRUPO.adolescentes ? { ...grupo, celulas: [2] } : grupo,
        ),
        {
          id: GRUPO.jovens,
          nome: "Jovens",
          ordem: 3,
          discipuladores: [],
          celulas: [3],
        },
      ];
      for (const consulta of CONSULTAS)
        expect(
          await rankingGrupos(`?${new URLSearchParams(consulta)}`),
        ).toEqual(
          montarRankingGruposPainel(entradaEsperada(), grupos, consulta, AGORA),
        );
    });

    it("um grupo sem discipulador, só com células de grupo próprio, aparece no nível célula", async () => {
      // A Canaã é do Boaz (sem grupo) e "Jovens" não tem discipulador.
      await definirGruposDasCelulas({ 3: GRUPO.jovens });
      expect(resumo(await rankingGrupos())).toEqual([
        ["Adultos da manhã", ["1 Célula Dorcas", "2 Célula Éfeso"]],
        ["Adultos da noite", ["1 Célula Betel", "2 Célula Ágape"]],
        ["Jovens", ["1 Célula Canaã"]],
      ]);
    });

    it("nível discipulador: nada muda (cada discipulador no grupo dele, com todas as células dele)", async () => {
      const antes = await rankingGrupos("?nivel=discipulador&janela=campanha");
      await definirGruposDasCelulas({
        2: GRUPO.adolescentes,
        3: GRUPO.jovens,
        4: GRUPO.noite,
      });
      const depois = await rankingGrupos("?nivel=discipulador&janela=campanha");
      expect(depois).toEqual(antes);
      expect(resumo(depois)).toEqual([
        ["Adultos da manhã", ["1 Discipulador Caleb"]],
        ["Adultos da noite", ["1 Discipulador Abel"]],
      ]);
    });

    it("a célula volta a herdar (null): o ranking fica como era", async () => {
      const antes = await rankingGrupos();
      await definirGruposDasCelulas({ 2: GRUPO.adolescentes });
      await definirGruposDasCelulas({ 2: null });
      expect(await rankingGrupos()).toEqual(antes);
    });
  });

  it.each(["?nivel=rede", "?janela=semana", "?janela="])(
    "consulta inválida (%s): 400 requisicao_invalida",
    async (consulta) => {
      esperarErro(await chamar(consulta), 400, "requisicao_invalida");
    },
  );

  it("sem campanha ativa: 404 nao_encontrado", async () => {
    await env.DB.prepare("UPDATE campanhas SET ativa = 0").run();
    esperarErro(await chamar(), 404, "nao_encontrado");
  });
});
