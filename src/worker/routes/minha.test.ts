// RIFA-014: GET /api/minha/visao no app REAL (exports.default.fetch), com o líder, o discipulador e a rede
// entrando pelo link pessoal gerado em lote pela administração.
// - CA1: o líder vê só a própria célula com números; dos pares, só nome e posição; nenhum dinheiro com
//   qualquer configuração (meta em centavos e critério arrecadação inclusive), varrendo o JSON por chaves e por
//   valores: as outras células têm vendas inconfundíveis, e nenhum desses números aparece;
// - CA2: o discipulador vê as células dele com números (os do painel) e os outros discipuladores só pela
//   posição; a rede vê os discipuladores e as células dela, e nada das células e discipuladores da outra rede;
// - CA4: o alvo nunca vem da requisição (consulta, cabeçalhos, corpo);
// e mais: sem campanha, 404 como o painel; a resposta nunca fica em cache; a base, até 30 s.
// Relógio FIXO (vi.useFakeTimers só no Date, que o app real lê com new Date()), como em protecao.test.ts: é
// 12:00 de Belém num dia que já passou, o dia 9 de 21 da campanha (vendas deslocadas para esse dia).
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
import {
  campanhaEntradaSchema,
  diasEntre,
  erroApiSchema,
  hojeNoFuso,
  respostaGerarLinksHierarquiaSchema,
  respostaPainelResumoSchema,
  respostaRankingSchema,
  respostaSessaoSchema,
  respostaVisaoIndividualSchema,
  somarDias,
  type CriterioRanking,
  type PapelHierarquia,
  type RespostaVisaoIndividual,
  type UnidadeMeta,
} from "../../shared/contracts";
import { TTL_BASE_DA_VISAO_MS } from "../db/visao-individual";
import { ORIGEM, cabecalhosDeSessao } from "../test/acesso-teste";
import {
  CELULAS,
  DADOS_CAMPANHA,
  DISCIPULADORES,
  PEDIDOS,
  aprovado,
  camposDe,
  deslocarPedidos,
  semearCenario,
  textosDe,
} from "../test/painel-apoio";

const AGORA_FIXO = new Date("2026-11-04T15:00:00.000Z");
const HOJE = hojeNoFuso(DADOS_CAMPANHA.fuso_horario, AGORA_FIXO);
const INICIO = somarDias(HOJE, -8);
const DESLOCAMENTO = diasEntre(DADOS_CAMPANHA.data_inicio, INICIO);

/**
 * Vendas inconfundíveis no dia 2 (bilhetes por célula, pelo afiliado dela), mais uma venda da Ágape com um total
 * que não é bilhetes × preço: nenhum desses números (nem os totais com eles, em bilhetes ou em centavos) pode
 * aparecer na visão de quem não responde por aquela célula; os centavos, em visão nenhuma.
 */
const INCONFUNDIVEIS: Record<number, number> = {
  2: 31_337,
  3: 27_183,
  4: 16_180,
  5: 14_142,
};
const AFILIADO_DA_CELULA: Record<number, number> = {
  1: 101,
  2: 102,
  3: 103,
  4: 104,
  5: 105,
};
const EXTRAS = [
  ...Object.entries(INCONFUNDIVEIS).map(([celula, bilhetes]) =>
    aprovado(
      AFILIADO_DA_CELULA[Number(celula)],
      "2026-11-24T15:00:00.000Z",
      bilhetes,
    ),
  ),
  aprovado(101, "2026-11-24T16:00:00.000Z", 7, 77_777),
];

/** Chave de dinheiro (R$, centavos, arrecadação, preço...). `bilhetes` é quantidade e pode sair. */
const CHAVE_DE_DINHEIRO = /centavos|total|preco|arrecad|valor|reais|dinheiro/i;

let instante = AGORA_FIXO.getTime();
/** Anda mais que o prazo do cache da base da visão (30 s), ainda no mesmo dia. */
function andarDoRelogio(): void {
  instante += TTL_BASE_DA_VISAO_MS + 1_000;
  vi.setSystemTime(instante);
}

let admin: Record<string, string>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instante);
  admin = await cabecalhosDeSessao("admin");
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.useRealTimers();
});

function requisitar(
  metodo: "GET" | "POST",
  caminho: string,
  cabecalhos: Record<string, string>,
  corpo?: unknown,
): Promise<Response> {
  const headers = new Headers(cabecalhos);
  if (corpo !== undefined) headers.set("Content-Type", "application/json");
  return exports.default.fetch(`${ORIGEM}${caminho}`, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

async function semear(
  meta: { unidade: UnidadeMeta; valor: number },
  criterio: CriterioRanking,
): Promise<void> {
  await semearCenario({
    campanha: campanhaEntradaSchema.parse({
      ...DADOS_CAMPANHA,
      data_inicio: INICIO,
      meta: { ...meta, regra: "por_pessoa" },
      ranking: { criterio },
    }),
    pedidos: deslocarPedidos([...PEDIDOS, ...EXTRAS], DESLOCAMENTO),
  });
  andarDoRelogio();
}

/** O link do alvo gerado pela administração (o lote) e o login por ele: os cabeçalhos da sessão. */
async function entrarComo(
  papel: PapelHierarquia,
  id: number,
): Promise<Record<string, string>> {
  const lote = await requisitar(
    "POST",
    "/api/admin/acessos-hierarquia/links",
    admin,
    { papel, ids: [id] },
  );
  expect(lote.status).toBe(201);
  const [item] = respostaGerarLinksHierarquiaSchema.parse(
    await lote.json(),
  ).itens;
  const token = item.link.url.slice(`${ORIGEM}/acesso/`.length);
  const login = await requisitar(
    "POST",
    "/api/sessao",
    { Origin: ORIGEM },
    { token },
  );
  expect(login.status).toBe(200);
  const { usuario } = respostaSessaoSchema.parse(await login.json());
  expect(usuario).toMatchObject({ papel, alvo: { id } });
  const cookie = login.headers.get("Set-Cookie")!.split(";")[0];
  return { Cookie: cookie };
}

async function visao(
  sessao: Record<string, string>,
  consulta = "",
  cabecalhos: Record<string, string> = {},
): Promise<{ texto: string; corpo: RespostaVisaoIndividual }> {
  const res = await requisitar("GET", `/api/minha/visao${consulta}`, {
    ...sessao,
    ...cabecalhos,
  });
  const texto = await res.text();
  expect({
    status: res.status,
    cache: res.headers.get("Cache-Control"),
  }).toEqual({
    status: 200,
    cache: "no-store",
  });
  const corpo: unknown = JSON.parse(texto);
  const lida = respostaVisaoIndividualSchema.parse(corpo);
  expect(lida).toEqual(corpo);
  return { texto, corpo: lida };
}

/** Todos os números do JSON, em qualquer nível. */
function numerosDe(valor: unknown, numeros = new Set<number>()): Set<number> {
  if (typeof valor === "number") numeros.add(valor);
  else if (Array.isArray(valor))
    for (const item of valor) numerosDe(item, numeros);
  else if (valor !== null && typeof valor === "object")
    for (const item of Object.values(valor)) numerosDe(item, numeros);
  return numeros;
}

/** Os totais da campanha por célula, como a coordenação vê (com valores), para saber o que não pode vazar. */
async function totaisDaCoordenacao() {
  const res = await requisitar(
    "GET",
    "/api/painel/ranking?nivel=celula&periodo=campanha",
    admin,
  );
  expect(res.status).toBe(200);
  return new Map(
    respostaRankingSchema
      .parse(await res.json())
      .itens.map((item) => [item.id, item]),
  );
}

/**
 * Os números que só a coordenação vê de cada célula e que não se confundem com nenhum outro da visão (a partir
 * de 10.000): as vendas inconfundíveis, os totais de bilhetes com elas e os totais em centavos.
 */
async function numerosDasCelulas(): Promise<Map<number, number[]>> {
  const totais = await totaisDaCoordenacao();
  return new Map(
    CELULAS.map((celula) => {
      const item = totais.get(celula.id)!;
      return [
        celula.id,
        [
          INCONFUNDIVEIS[celula.id] ?? 0,
          item.vendas.bilhetes,
          item.vendas.total_centavos,
        ].filter((valor) => valor >= 10_000),
      ];
    }),
  );
}

/** Sem dinheiro: nenhuma chave de dinheiro, nenhum "R$" e nenhum total em centavos de célula nenhuma. */
function esperarSemDinheiro(
  corpo: RespostaVisaoIndividual,
  texto: string,
  centavosDasCelulas: number[],
): void {
  expect(
    [...camposDe(corpo)].filter((campo) => CHAVE_DE_DINHEIRO.test(campo)),
  ).toEqual([]);
  // `unidade` diz em que a meta é medida ("centavos" quando é dinheiro): é o aviso de que as quantidades saem
  // null, não um valor.
  expect(
    textosDe({ ...corpo, unidade: null }).filter((item) =>
      /R\$|centavo|reais/i.test(item),
    ),
  ).toEqual([]);
  expect(texto).not.toContain("R$");
  const numeros = numerosDe(corpo);
  expect(centavosDasCelulas.filter((valor) => numeros.has(valor))).toEqual([]);
}

describe.each([
  { unidade: "centavos", valor: 20_000, criterio: "arrecadacao" },
  { unidade: "bilhetes", valor: 10, criterio: "percentual_meta" },
  { unidade: "bilhetes", valor: 10, criterio: "bilhetes" },
] as const)(
  "CA1 e CA2: meta em $unidade, critério $criterio",
  ({ unidade, valor, criterio }) => {
    let numeros: Map<number, number[]>;
    let centavos: number[];

    beforeAll(async () => {
      await semear({ unidade, valor }, criterio);
      numeros = await numerosDasCelulas();
      const totais = await totaisDaCoordenacao();
      centavos = [...totais.values()].map((item) => item.vendas.total_centavos);
      // O cenário tem dinheiro de verdade para não vazar (a contraprova da varredura).
      expect(Math.min(...centavos)).toBeGreaterThan(10_000);
    });

    it("CA1: o líder entra pelo link e vê só a própria célula com números; dos pares, só nome e posição; nada de dinheiro", async () => {
      const lider = await entrarComo("lider", 1);
      const sessao = await requisitar("GET", "/api/sessao", lider);
      expect(
        respostaSessaoSchema.parse(await sessao.json()).usuario.alvo,
      ).toEqual({
        tipo: "celula",
        id: 1,
        nome: "Célula Ágape",
        divisao: "jovens",
      });

      const { texto, corpo } = await visao(lider);
      expect(corpo.alvo).toEqual({
        tipo: "celula",
        id: 1,
        nome: "Célula Ágape",
        divisao: "jovens",
      });
      expect(corpo.pessoa).toBe("Líder da Célula Ágape");
      expect(corpo.equipe).toEqual([]);
      expect(corpo.afiliados_vinculados).toBe(1);
      expect(corpo.referencia).toMatchObject({ data: HOJE, dia_campanha: 9 });

      // Os números da própria célula: os do painel da coordenação (sem os de dinheiro).
      const painel = await requisitar(
        "GET",
        "/api/painel/resumo?escopo=celula&id=1",
        admin,
      );
      const resumo = respostaPainelResumoSchema.parse(await painel.json());
      expect(corpo.desempenho.campanha).toMatchObject({
        percentual_meta_bp: resumo.campanha.percentual_meta_bp,
        situacao: resumo.campanha.situacao,
        meta: unidade === "centavos" ? null : resumo.campanha.meta,
        realizado: unidade === "centavos" ? null : resumo.campanha.realizado,
      });
      expect(corpo.desempenho.bilhetes.campanha).toBe(resumo.vendas.bilhetes);
      if (unidade === "bilhetes")
        expect(numerosDe(corpo).has(resumo.vendas.bilhetes)).toBe(true);

      // Dos pares: só nome e posição (sem distância).
      for (const posicao of [corpo.ranking.geral!, corpo.ranking.divisao!])
        for (const vizinho of [posicao.acima, posicao.abaixo])
          if (vizinho !== null)
            expect(Object.keys(vizinho).sort()).toEqual([
              "diferenca",
              "nome",
              "posicao",
            ]);
      expect(
        [corpo.ranking.geral, corpo.ranking.divisao].flatMap((posicao) =>
          [posicao!.acima, posicao!.abaixo].filter(
            (vizinho) => vizinho !== null && vizinho.diferenca !== null,
          ),
        ),
      ).toEqual([]);
      for (const item of corpo.ranking.primeiros)
        expect(Object.keys(item).sort()).toEqual(["eu", "nome", "posicao"]);

      // Nenhum número das outras células, e nenhum dinheiro (nem o da própria).
      const dasOutras = [2, 3, 4, 5].flatMap((id) => numeros.get(id)!);
      const vistos = numerosDe(corpo);
      expect(
        dasOutras.filter((valorDaOutra) => vistos.has(valorDaOutra)),
      ).toEqual([]);
      esperarSemDinheiro(corpo, texto, centavos);
    });

    it("CA2: o discipulador vê as células dele com os números do painel; os outros discipuladores, só a posição", async () => {
      const abel = await entrarComo("discipulador", 10);
      const { texto, corpo } = await visao(abel);
      expect(corpo.alvo).toMatchObject({ tipo: "discipulador", id: 10 });
      expect(corpo.equipe.map((item) => item.id)).toEqual([1, 2]);
      for (const item of corpo.equipe) {
        const painel = await requisitar(
          "GET",
          `/api/painel/resumo?escopo=celula&id=${item.id}`,
          admin,
        );
        const resumo = respostaPainelResumoSchema.parse(await painel.json());
        expect({ id: item.id, campanha: item.desempenho.campanha }).toEqual({
          id: item.id,
          campanha: expect.objectContaining({
            percentual_meta_bp: resumo.campanha.percentual_meta_bp,
            realizado:
              unidade === "centavos" ? null : resumo.campanha.realizado,
          }),
        });
        expect(item.desempenho.bilhetes.campanha).toBe(resumo.vendas.bilhetes);
      }
      // Boaz (o outro discipulador da divisão) aparece só por nome e posição; os números da Canaã (dele), não.
      expect(texto).toContain("Discipulador Boaz");
      expect(texto).not.toContain("Célula Canaã");
      const vistos = numerosDe(corpo);
      expect(
        [3, 4, 5]
          .flatMap((id) => numeros.get(id)!)
          .filter((valorDaOutra) => vistos.has(valorDaOutra)),
      ).toEqual([]);
      esperarSemDinheiro(corpo, texto, centavos);
    });

    it("CA2: a rede vê os discipuladores e as células dela; da outra rede, nada (só o nome dela na posição)", async () => {
      const visoes = {
        1: await visao(await entrarComo("rede", 1)),
        2: await visao(await entrarComo("rede", 2)),
      };
      const daRede = (rede: number) => ({
        discipuladores: DISCIPULADORES.filter((item) => item.rede_id === rede),
        celulas: CELULAS.filter((item) => item.rede_id === rede),
      });
      for (const [rede, outra] of [
        [1, 2],
        [2, 1],
      ] as const) {
        const { texto, corpo } = visoes[rede];
        const minha = daRede(rede);
        expect(
          corpo.equipe.map(({ tipo, id }) => `${tipo}:${id}`).sort(),
        ).toEqual(
          [
            ...minha.discipuladores.map((item) => `discipulador:${item.id}`),
            ...minha.celulas.map((item) => `celula:${item.id}`),
          ].sort(),
        );
        const daOutra = daRede(outra);
        for (const nome of [
          ...daOutra.discipuladores.map((item) => item.nome),
          ...daOutra.celulas.map((item) => item.nome),
        ])
          expect({ rede, nome, aparece: texto.includes(nome) }).toEqual({
            rede,
            nome,
            aparece: false,
          });
        const vistos = numerosDe(corpo);
        expect(
          daOutra.celulas
            .flatMap((celula) => numeros.get(celula.id)!)
            .filter((valorDaOutra) => vistos.has(valorDaOutra)),
        ).toEqual([]);
        esperarSemDinheiro(corpo, texto, centavos);
      }
    });
  },
);

describe("CA2: isolamento entre redes e discipuladores da MESMA divisão", () => {
  // Uma segunda rede jovem (a 3), com o discipulador Elias e a célula Filipos, que vende 12.345 bilhetes: o
  // filtro da equipe tem de ser pela rede e pelo discipulador, não pela divisão.
  const FILIPOS = 12_345;
  let numeros: Map<number, number[]>;

  beforeAll(async () => {
    await semear({ unidade: "bilhetes", valor: 10 }, "percentual_meta");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO redes (id, nome, divisao) VALUES (3, 'Rede Jovem Sul Ficticia', 'jovens')",
      ),
      env.DB.prepare(
        "INSERT INTO discipuladores (id, rede_id, nome) VALUES (50, 3, 'Discipulador Elias')",
      ),
      env.DB.prepare(
        `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
         VALUES (6, 50, 'Célula Filipos', 9, 'Líder da Célula Filipos')`,
      ),
      env.DB.prepare(
        `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
         VALUES (106, 6, 'manual', '2026-11-20T12:00:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em)
         SELECT 'FILIPOS-1', id, 106, 'approved', ?1, ?1 * 2000, ?2 FROM campanhas WHERE ativa = 1`,
      ).bind(FILIPOS, `${somarDias(INICIO, 2)}T15:00:00.000Z`),
    ]);
    andarDoRelogio();
    const totais = await totaisDaCoordenacao();
    numeros = new Map(
      [...totais.values()].map((item) => [
        item.id,
        [item.vendas.bilhetes, item.vendas.total_centavos].filter(
          (valor) => valor >= 10_000,
        ),
      ]),
    );
    expect(numeros.get(6)).toEqual([FILIPOS, FILIPOS * 2000]);
  });

  it("a rede A não vê discipuladores nem células da rede B (as duas jovens), e vice-versa", async () => {
    const redeA = (await visao(await entrarComo("rede", 1))).corpo;
    const redeB = (await visao(await entrarComo("rede", 3))).corpo;
    expect(redeA.equipe.map(({ tipo, id }) => `${tipo}:${id}`)).toEqual([
      "discipulador:10",
      "celula:1",
      "celula:2",
      "discipulador:20",
      "celula:3",
    ]);
    expect(redeB.equipe.map(({ tipo, id }) => `${tipo}:${id}`)).toEqual([
      "discipulador:50",
      "celula:6",
    ]);
    const textoA = JSON.stringify(redeA);
    for (const nome of ["Discipulador Elias", "Célula Filipos"])
      expect(textoA).not.toContain(nome);
    expect(numerosDe(redeA).has(FILIPOS)).toBe(false);
    const textoB = JSON.stringify(redeB);
    for (const nome of [
      "Discipulador Abel",
      "Discipulador Boaz",
      "Célula Ágape",
      "Célula Betel",
      "Célula Canaã",
    ])
      expect(textoB).not.toContain(nome);
    const vistosB = numerosDe(redeB);
    expect(
      [1, 2, 3]
        .flatMap((id) => numeros.get(id)!)
        .filter((valor) => vistosB.has(valor)),
    ).toEqual([]);
    // As duas redes se veem só no ranking das redes: nome e posição.
    expect(redeA.ranking.geral?.participantes).toBe(3);
    expect(redeA.ranking.divisao?.participantes).toBe(2);
  });

  it("o discipulador de uma rede não vê as células do discipulador da outra rede da mesma divisão", async () => {
    const elias = (await visao(await entrarComo("discipulador", 50))).corpo;
    expect(elias.equipe.map((item) => item.id)).toEqual([6]);
    const abel = (await visao(await entrarComo("discipulador", 10))).corpo;
    expect(abel.equipe.map((item) => item.id)).toEqual([1, 2]);
    expect(JSON.stringify(abel)).not.toContain("Célula Filipos");
    expect(numerosDe(abel).has(FILIPOS)).toBe(false);
  });
});

describe("CA4: o alvo nunca vem da requisição", () => {
  beforeAll(async () => {
    await semear({ unidade: "bilhetes", valor: 10 }, "percentual_meta");
  });

  const semInstante = (visao: RespostaVisaoIndividual) => ({
    ...visao,
    atualizado_em: null,
  });

  it("id na consulta, nos cabeçalhos ou no corpo não muda nada: sai sempre o alvo da sessão", async () => {
    const lider = await entrarComo("lider", 1);
    const discipulador = await entrarComo("discipulador", 10);
    for (const [sessao, proprio] of [
      [lider, 1],
      [discipulador, 10],
    ] as const) {
      const base = semInstante((await visao(sessao)).corpo);
      expect(base.alvo.id).toBe(proprio);
      for (const consulta of [
        "?id=2",
        "?celula_id=2",
        "?discipulador_id=20",
        "?rede_id=2",
        "?alvo=4&tipo=celula",
        "?id=2&id=3",
        "?periodo=atual&celula_id=5",
      ])
        expect({
          consulta,
          visao: semInstante((await visao(sessao, consulta)).corpo),
        }).toEqual({
          consulta,
          visao: base,
        });
      for (const cabecalhos of [
        { "X-Celula-Id": "2" },
        { "X-Alvo-Id": "20", "X-Alvo-Tipo": "discipulador" },
        { "CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "2" },
      ] as Record<string, string>[])
        expect(
          semInstante((await visao(sessao, "", cabecalhos)).corpo),
        ).toEqual(base);
      // Não há escrita em /api/minha: um POST com outro alvo no corpo não chega a rota nenhuma.
      const post = await requisitar(
        "POST",
        "/api/minha/visao",
        { ...sessao, Origin: ORIGEM },
        { celula_id: 2, alvo: { tipo: "celula", id: 2 } },
      );
      expect(post.status).toBe(404);
      expect(erroApiSchema.parse(await post.json()).erro.codigo).toBe(
        "nao_encontrado",
      );
    }
  });

  it("a janela vem da consulta (periodo), e só ela; periodo inválido é 400", async () => {
    const lider = await entrarComo("lider", 3);
    const atual = (await visao(lider)).corpo;
    const campanha = (await visao(lider, "?periodo=campanha")).corpo;
    expect(atual.ranking.janela).toMatchObject({ tipo: "atual", ordem: 2 });
    expect(campanha.ranking.janela).toMatchObject({
      tipo: "campanha",
      ordem: null,
    });
    expect(campanha.alvo).toEqual(atual.alvo);
    const invalida = await requisitar(
      "GET",
      "/api/minha/visao?periodo=semana",
      lider,
    );
    expect(invalida.status).toBe(400);
    expect(invalida.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("campanha, cache e alvo novo", () => {
  it("sem campanha ativa: 404 nao_encontrado, como o painel (sem cache)", async () => {
    await semear({ unidade: "bilhetes", valor: 10 }, "percentual_meta");
    const lider = await entrarComo("lider", 2);
    await env.DB.prepare("UPDATE campanhas SET ativa = 0").run();
    andarDoRelogio();
    const res = await requisitar("GET", "/api/minha/visao", lider);
    expect({
      status: res.status,
      cache: res.headers.get("Cache-Control"),
      codigo: erroApiSchema.parse(await res.json()).erro.codigo,
    }).toEqual({ status: 404, cache: "no-store", codigo: "nao_encontrado" });
  });

  it("a base fica até 30 s no isolate (sem ir ao D1); a resposta de cada um sai na hora; alvo novo lê de novo", async () => {
    await semear({ unidade: "bilhetes", valor: 10 }, "percentual_meta");
    const lider = await entrarComo("lider", 4);
    const outro = await entrarComo("lider", 5);
    const batch = vi.spyOn(env.DB, "batch");
    await visao(lider);
    expect(batch).toHaveBeenCalledTimes(1);
    const deOutro = await visao(outro);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(deOutro.corpo.alvo.id).toBe(5);
    andarDoRelogio();
    await visao(lider);
    expect(batch).toHaveBeenCalledTimes(2);

    // Uma célula criada depois da base guardada: a visão do líder dela lê o banco de novo (e já a encontra).
    await env.DB.prepare(
      `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
       VALUES (6, 20, 'Célula Filadélfia', 8, 'Líder da Célula Filadélfia')`,
    ).run();
    const lote = await requisitar(
      "POST",
      "/api/admin/acessos-hierarquia/links",
      admin,
      { papel: "lider", ids: [6] },
    );
    expect(lote.status).toBe(201);
    const nova = await entrarComo("lider", 6);
    const antes = batch.mock.calls.length;
    const { corpo } = await visao(nova);
    expect(batch.mock.calls.length).toBe(antes + 1);
    expect(corpo.alvo).toMatchObject({ id: 6, nome: "Célula Filadélfia" });
    expect(corpo.ranking.geral?.participantes).toBe(6);
  });
});

describe("RIFA-061 (D27): sem ranking por divisão, a visão usa o ranking de todos", () => {
  it("o líder da Dorcas (adultos) fica na posição entre todas, com a marca; a rede adulta vê as posições de todos", async () => {
    await semear({ unidade: "bilhetes", valor: 10 }, "percentual_meta");
    const lider = await entrarComo("lider", 4);
    const rede = await entrarComo("rede", 2);
    const separado = await visao(lider);
    expect(separado.corpo.ranking).not.toHaveProperty("por_divisao");
    await env.DB.prepare(
      "UPDATE campanhas SET ranking_por_divisao = 0 WHERE ativa = 1",
    ).run();
    andarDoRelogio();
    const { corpo } = await visao(lider);
    expect(corpo.ranking.por_divisao).toBe(false);
    expect(corpo.ranking.divisao).toEqual(corpo.ranking.geral);
    expect(corpo.ranking.geral).toEqual(separado.corpo.ranking.geral);
    expect(corpo.ranking.divisao).not.toEqual(separado.corpo.ranking.divisao);
    const daRede = (await visao(rede)).corpo;
    expect(daRede.ranking.por_divisao).toBe(false);
    for (const item of daRede.equipe.filter(
      (membro) => membro.tipo === "celula",
    ))
      expect(item.posicao_divisao).toBeGreaterThanOrEqual(1);
  });
});

describe("a hierarquia muda com a base em cache: nunca 500 (RIFA-014-api-b)", () => {
  // A sessão lê o alvo na hora; a base da visão pode ter sido lida até 30 s antes. Se o alvo de quem pede mudou de
  // divisão, a base guardada não serve (relê): sem isso, a visão misturava a divisão nova (da sessão) com os
  // rankings da antiga (da base) e o schema recusava a resposta (500) por até 30 s.
  beforeEach(async () => {
    await semear({ unidade: "bilhetes", valor: 10 }, "percentual_meta");
  });

  /** A visão de quem pede depois da mudança, dentro dos 30 s da base guardada: relida, e na divisão nova. */
  async function depoisDaMudanca(
    sessao: Record<string, string>,
    mudanca: string,
  ): Promise<RespostaVisaoIndividual> {
    await env.DB.prepare(mudanca).run();
    const batch = vi.spyOn(env.DB, "batch");
    const { corpo } = await visao(sessao);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(corpo.alvo.divisao).toBe("adultos");
    return corpo;
  }

  it("a rede que troca de divisão: a visão dela relê a base e sai na divisão nova, com os rankings dela", async () => {
    const rede = await entrarComo("rede", 1);
    expect((await visao(rede)).corpo.alvo.divisao).toBe("jovens");
    const corpo = await depoisDaMudanca(
      rede,
      "UPDATE redes SET divisao = 'adultos' WHERE id = 1",
    );
    expect(corpo.ranking.geral?.participantes).toBe(2);
    expect(corpo.ranking.divisao?.participantes).toBe(2);
    expect(corpo.equipe.map(({ tipo, id }) => `${tipo}:${id}`)).toEqual([
      "discipulador:10",
      "celula:1",
      "celula:2",
      "discipulador:20",
      "celula:3",
    ]);
    expect(corpo.equipe.every((item) => item.posicao_divisao !== null)).toBe(
      true,
    );
  });

  it("a célula que vai para um discipulador de outra divisão: a visão do líder relê a base", async () => {
    const lider = await entrarComo("lider", 1);
    expect((await visao(lider)).corpo.alvo.divisao).toBe("jovens");
    const corpo = await depoisDaMudanca(
      lider,
      "UPDATE celulas SET discipulador_id = 30 WHERE id = 1",
    );
    // Na divisão dos adultos: Dorcas, Éfeso e agora a Ágape.
    expect(corpo.ranking.divisao?.participantes).toBe(3);
    expect(corpo.ranking.geral?.participantes).toBe(5);
  });

  it("o discipulador que vai para uma rede de outra divisão: a visão dele relê a base, com as células na posição nova", async () => {
    const discipulador = await entrarComo("discipulador", 10);
    expect((await visao(discipulador)).corpo.alvo.divisao).toBe("jovens");
    const corpo = await depoisDaMudanca(
      discipulador,
      "UPDATE discipuladores SET rede_id = 2 WHERE id = 10",
    );
    expect(corpo.equipe.map((item) => item.id)).toEqual([1, 2]);
    expect(corpo.equipe.every((item) => item.posicao_divisao !== null)).toBe(
      true,
    );
    // Na divisão dos adultos: Caleb e agora Abel (Davi não tem células).
    expect(corpo.ranking.divisao?.participantes).toBe(2);
  });

  it("para as outras pessoas (o alvo delas não mudou), a hierarquia pode aparecer até 30 s atrasada, sem erro", async () => {
    const abel = await entrarComo("discipulador", 10);
    expect((await visao(abel)).corpo.equipe.map((item) => item.id)).toEqual([
      1, 2,
    ]);
    // A Betel vai do Abel para o Boaz (mesma divisão): a visão do Abel não precisa reler a base.
    await env.DB.prepare(
      "UPDATE celulas SET discipulador_id = 20 WHERE id = 2",
    ).run();
    expect((await visao(abel)).corpo.equipe.map((item) => item.id)).toEqual([
      1, 2,
    ]);
    andarDoRelogio();
    expect((await visao(abel)).corpo.equipe.map((item) => item.id)).toEqual([
      1,
    ]);
  });
});

describe("o schema estrito antes de sair (D12)", () => {
  it("a rota devolve o que o schema estrito devolve; se ele recusa a visão, 500 erro_interno sem nenhum dado", async () => {
    await semear({ unidade: "bilhetes", valor: 10 }, "percentual_meta");
    const lider = await entrarComo("lider", 2);
    const parse = vi.spyOn(respostaVisaoIndividualSchema, "parse");

    const res = await requisitar("GET", "/api/minha/visao", lider);
    expect(res.status).toBe(200);
    // A rota passou a visão pelo schema estrito, uma vez, e respondeu com o resultado dele.
    expect(parse).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual(parse.mock.results[0].value);

    // Uma visão que o schema recusa (um campo a mais, uma regra cruzada quebrada) não sai: 500, só o erro.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    parse.mockImplementationOnce(() => {
      throw new Error("visão fora do schema");
    });
    const recusada = await requisitar("GET", "/api/minha/visao", lider);
    const texto = await recusada.text();
    expect({
      status: recusada.status,
      cache: recusada.headers.get("Cache-Control"),
      corpo: JSON.parse(texto) as unknown,
    }).toEqual({
      status: 500,
      cache: "no-store",
      corpo: { erro: { codigo: "erro_interno", mensagem: "Erro interno" } },
    });
    expect(texto).not.toContain("Célula Betel");
    expect(log).toHaveBeenCalled();
  });
});
