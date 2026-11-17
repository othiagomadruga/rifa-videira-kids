// RIFA-014: o montador da visão individual (lib/visao-individual.ts), puro. Prova que:
// - a saída passa no respostaVisaoIndividualSchema (estrito, com as regras cruzadas) em todos os cenários: fases,
//   meta em bilhetes ou centavos, as três regras de meta, os três critérios, as duas janelas, os dois limites do
//   público e todos os alvos do cenário (inclusive o discipulador sem células);
// - os números são os do painel: cada desempenho, posição e ranking confere com montarResumoPainel e
//   montarRankingPainel chamados com TODAS as células e TODAS as vendas (as reduções de CPU não mudam nada), os
//   primeiros conferem com montarRankingPublico e cada ponto da curva com o percentual da meta e o esperado do
//   painel no fim daquele dia;
// - com meta em centavos, nenhuma quantidade na unidade da meta (seria dinheiro) e os bilhetes de hoje somados;
// - `eu` vem pelo id, `diferenca` sai sempre null e o alvo sem células fica fora do ranking;
// - sem ranking por divisão (RIFA-061, D27), o mesmo, com o ranking de todos no lugar do da divisão.
import { describe, expect, it } from "vitest";
import {
  CRITERIOS_RANKING,
  JANELAS_RANKING,
  REGRAS_META,
  campanhaEntradaSchema,
  montarRankingPainel,
  montarRankingPublico,
  montarResumoPainel,
  rankingPorDivisao,
  respostaVisaoIndividualSchema,
  somarDias,
  type Alvo,
  type CampanhaCalculo,
  type CelulaCalculo,
  type CriterioRanking,
  type Divisao,
  type EntradaCalculo,
  type JanelaRanking,
  type NivelRanking,
  type RegraMeta,
  type RespostaPainelResumo,
  type RespostaVisaoIndividual,
  type Ritmo,
  type UnidadeMeta,
} from "../../shared/contracts";
import {
  AFILIADOS,
  AGORA,
  CELULAS,
  DADOS_CAMPANHA,
  DISCIPULADORES,
  PEDIDOS,
  REDES,
  entradaEsperada,
} from "../test/painel-apoio";
import { montarVisaoIndividual, type DadosDaVisao } from "./visao-individual";

// ---------------------------------------------------------------------------------------------------
// Cenário: o do painel (painel-apoio.ts), com 5 células em 2 redes e o discipulador Davi sem células
// ---------------------------------------------------------------------------------------------------

const DIVISAO_DA_REDE = new Map<number, Divisao>(
  REDES.map((rede) => [rede.id, rede.divisao]),
);

const ALVOS: Alvo[] = [
  ...CELULAS.map((celula): Alvo => ({
    tipo: "celula",
    id: celula.id,
    nome: celula.nome,
    divisao: celula.divisao,
  })),
  ...DISCIPULADORES.map((discipulador): Alvo => ({
    tipo: "discipulador",
    id: discipulador.id,
    nome: discipulador.nome,
    divisao: DIVISAO_DA_REDE.get(discipulador.rede_id)!,
  })),
  ...REDES.map((rede): Alvo => ({
    tipo: "rede",
    id: rede.id,
    nome: rede.nome,
    divisao: rede.divisao,
  })),
];

const alvo = (tipo: Alvo["tipo"], id: number) =>
  ALVOS.find((item) => item.tipo === tipo && item.id === id)!;

function dadosDe(entrada: EntradaCalculo): DadosDaVisao {
  return {
    entrada,
    discipuladores: DISCIPULADORES.map(({ id, nome, rede_id }) => ({
      id,
      nome,
      rede_id,
    })),
    celulas: new Map(
      entrada.celulas.map((celula) => [
        celula.id,
        {
          lider_nome: `Líder da ${celula.nome}`,
          afiliados_vinculados: AFILIADOS.filter(
            (afiliado) => afiliado.celula_id === celula.id,
          ).length,
        },
      ]),
    ),
  };
}

/** Metas por unidade e regra (em centavos, os mesmos bilhetes × R$ 20,00; a proporcional dá frações). */
const VALOR_DA_META: Record<UnidadeMeta, Record<RegraMeta, number>> = {
  bilhetes: { por_pessoa: 10, total_proporcional: 997, fixa_por_celula: 100 },
  centavos: {
    por_pessoa: 20_000,
    total_proporcional: 1_993_997,
    fixa_por_celula: 200_000,
  },
};

function campanhaCom(opcoes: {
  unidade?: UnidadeMeta;
  regra?: RegraMeta;
  criterio?: CriterioRanking;
  limite?: number | null;
  /** RIFA-061 (D27): ausente, como a campanha de antes da opção (separa). */
  porDivisao?: boolean;
}): CampanhaCalculo {
  const unidade = opcoes.unidade ?? "bilhetes";
  const regra = opcoes.regra ?? "por_pessoa";
  return campanhaEntradaSchema.parse({
    ...DADOS_CAMPANHA,
    meta: { unidade, regra, valor: VALOR_DA_META[unidade][regra] },
    ranking: {
      criterio: opcoes.criterio ?? "percentual_meta",
      ...(opcoes.porDivisao === undefined
        ? {}
        : { por_divisao: opcoes.porDivisao }),
    },
    publico: {
      mostra_percentual_meta: false,
      limite_ranking: opcoes.limite === undefined ? 3 : opcoes.limite,
    },
  });
}

/**
 * Instantes (12:00 de Belém): antes do início, o 1º dia (nenhum dia fechado), o dia 8 (1º da Semana 2), o dia 9
 * (o AGORA do painel), o último dia e depois do fim.
 */
const INSTANTES = {
  antes: new Date("2026-11-21T15:00:00.000Z"),
  primeiroDia: new Date("2026-11-23T15:00:00.000Z"),
  dia8: new Date("2026-11-30T15:00:00.000Z"),
  dia9: AGORA,
  ultimoDia: new Date("2026-12-13T15:00:00.000Z"),
  depois: new Date("2026-12-20T15:00:00.000Z"),
} as const;

const visaoDe = (
  entrada: EntradaCalculo,
  quem: Alvo,
  periodo: JanelaRanking,
  agora: Date,
) =>
  montarVisaoIndividual(
    dadosDe(entrada),
    { pessoa: "Pessoa Ficticia", alvo: quem },
    { periodo },
    agora,
  );

/** O schema estrito aceita a visão como ela é (nenhum campo a mais, nenhuma regra cruzada quebrada). */
function conforme(visao: RespostaVisaoIndividual): void {
  expect(respostaVisaoIndividualSchema.parse(visao)).toEqual(visao);
}

// ---------------------------------------------------------------------------------------------------
// O que se espera, a partir dos montadores do contrato com TODAS as células e TODAS as vendas
// ---------------------------------------------------------------------------------------------------

const celulasDoAlvo = (quem: Alvo, celulas: readonly CelulaCalculo[]) =>
  celulas.filter((celula) =>
    quem.tipo === "celula"
      ? celula.id === quem.id
      : quem.tipo === "discipulador"
        ? celula.discipulador_id === quem.id
        : celula.rede_id === quem.id,
  );

function ritmoSemDinheiro(ritmo: Ritmo, centavos: boolean) {
  const quantidade = (valor: number) => (centavos ? null : valor);
  return {
    meta: quantidade(ritmo.meta),
    esperado: quantidade(ritmo.esperado),
    realizado: quantidade(ritmo.realizado),
    diferenca: quantidade(ritmo.diferenca),
    situacao: ritmo.situacao,
    percentual_meta_bp: ritmo.percentual_meta_bp,
    percentual_esperado_bp: ritmo.percentual_esperado_bp,
  };
}

/** O desempenho que a visão deve ter: o resumo do painel, sem dinheiro, e os bilhetes de hoje somados à parte. */
function desempenhoEsperado(entrada: EntradaCalculo, quem: Alvo, agora: Date) {
  const resumo: RespostaPainelResumo = montarResumoPainel(
    entrada,
    {
      escopo: {
        tipo: quem.tipo,
        id: quem.id,
        divisao: quem.divisao,
        nome: quem.nome,
      },
    },
    agora,
  );
  const centavos = entrada.campanha.meta.unidade === "centavos";
  const ids = new Set(
    celulasDoAlvo(quem, entrada.celulas).map((celula) => celula.id),
  );
  const bilhetesHoje = entrada.vendas
    .filter(
      (venda) =>
        venda.celula_id !== null &&
        ids.has(venda.celula_id) &&
        venda.dia === resumo.referencia.data,
    )
    .reduce((soma, venda) => soma + venda.bilhetes, 0);
  return {
    resumo,
    desempenho: {
      hoje: resumo.hoje && {
        data: resumo.hoje.data,
        meta: centavos ? null : resumo.hoje.meta,
        realizado: centavos ? null : resumo.hoje.realizado,
        falta: centavos ? null : resumo.hoje.falta,
        percentual_meta_bp: resumo.hoje.percentual_meta_bp,
        batida: resumo.hoje.batida,
      },
      periodo: resumo.periodo && ritmoSemDinheiro(resumo.periodo, centavos),
      campanha: {
        ...ritmoSemDinheiro(resumo.campanha, centavos),
        projecao_percentual_meta_bp:
          resumo.campanha.projecao_percentual_meta_bp,
      },
      bilhetes: {
        campanha: resumo.vendas.bilhetes,
        hoje: resumo.hoje === null ? null : bilhetesHoje,
      },
    },
  };
}

/** A posição no ranking do painel com tudo (geral ou na divisão), só com nome e posição dos vizinhos. */
function posicaoEsperada(
  entrada: EntradaCalculo,
  nivel: NivelRanking,
  id: number,
  periodo: JanelaRanking,
  agora: Date,
  divisao?: Divisao,
) {
  const ranking = montarRankingPainel(
    entrada,
    { nivel, divisao, periodo },
    agora,
  );
  const item = ranking.itens.find((linha) => linha.id === id);
  const vizinho = (outro: { nome: string; posicao: number } | null) =>
    outro && { nome: outro.nome, posicao: outro.posicao, diferenca: null };
  return {
    janela: ranking.janela,
    posicao:
      item === undefined
        ? null
        : {
            posicao: item.posicao,
            participantes: ranking.itens.length,
            acima: vizinho(item.acima),
            abaixo: vizinho(item.abaixo),
          },
  };
}

/** Confere uma visão inteira contra os montadores do contrato com a entrada completa. */
function conferirContraOPainel(
  visao: RespostaVisaoIndividual,
  entrada: EntradaCalculo,
  quem: Alvo,
  periodo: JanelaRanking,
  agora: Date,
): void {
  const { resumo, desempenho } = desempenhoEsperado(entrada, quem, agora);
  expect(visao.desempenho).toEqual(desempenho);
  expect(visao.referencia).toEqual(resumo.referencia);

  const geral = posicaoEsperada(entrada, quem.tipo, quem.id, periodo, agora);
  const naDivisao = posicaoEsperada(
    entrada,
    quem.tipo,
    quem.id,
    periodo,
    agora,
    quem.divisao,
  );
  // Sem ranking por divisão (D27), os montadores ignoram a divisão: o "da divisão" esperado já é o de todos.
  expect(visao.ranking).toEqual({
    nivel: quem.tipo,
    janela: geral.janela,
    criterio: entrada.campanha.ranking.criterio,
    ...(rankingPorDivisao(entrada.campanha) ? {} : { por_divisao: false }),
    geral: geral.posicao,
    divisao: naDivisao.posicao,
    primeiros: expect.any(Array),
  });

  // Os primeiros: os mesmos nomes e posições do ranking público da divisão, e `eu` só no próprio alvo.
  const publico = montarRankingPublico(
    entrada,
    { nivel: quem.tipo, divisao: quem.divisao, periodo },
    agora,
  );
  expect(
    visao.ranking.primeiros.map(({ posicao, nome }) => ({ posicao, nome })),
  ).toEqual(publico.itens.map(({ posicao, nome }) => ({ posicao, nome })));
  const painelDaDivisao = montarRankingPainel(
    entrada,
    { nivel: quem.tipo, divisao: quem.divisao, periodo },
    agora,
  );
  expect(visao.ranking.primeiros.map((item) => item.eu)).toEqual(
    painelDaDivisao.itens
      .filter((item) =>
        publico.itens.some(
          (doPublico) =>
            doPublico.posicao === item.posicao && doPublico.nome === item.nome,
        ),
      )
      .map((item) => item.id === quem.id),
  );

  // A equipe: cada item com os números do painel e a posição na divisão do painel.
  for (const item of visao.equipe) {
    const membro: Alvo = {
      tipo: item.tipo,
      id: item.id,
      nome: item.nome,
      divisao: quem.divisao,
    };
    expect({ id: item.id, desempenho: item.desempenho }).toEqual({
      id: item.id,
      desempenho: desempenhoEsperado(entrada, membro, agora).desempenho,
    });
    expect({ id: item.id, posicao: item.posicao_divisao }).toEqual({
      id: item.id,
      posicao:
        posicaoEsperada(
          entrada,
          item.tipo,
          item.id,
          periodo,
          agora,
          quem.divisao,
        ).posicao?.posicao ?? null,
    });
  }

  // A curva (não depende da janela do ranking: conferida uma vez por cenário): cada ponto é o percentual da
  // meta (realizado) do painel no fim daquele dia e o esperado do painel no fim dele (que o painel mostra no
  // dia seguinte, como "esperado até ontem").
  if (periodo !== "atual") return;
  if (resumo.campanha.percentual_meta_bp === null)
    expect(visao.curva).toEqual([]);
  else
    for (const ponto of visao.curva) {
      const escopo = {
        tipo: quem.tipo,
        id: quem.id,
        divisao: quem.divisao,
        nome: quem.nome,
      };
      const noDia = montarResumoPainel(
        entrada,
        { escopo, data: ponto.data },
        agora,
      );
      const noDiaSeguinte = montarResumoPainel(
        entrada,
        { escopo, data: somarDias(ponto.data, 1) },
        agora,
      );
      expect({ dia: ponto.dia, esperado: ponto.esperado_bp }).toEqual({
        dia: ponto.dia,
        esperado: noDiaSeguinte.campanha.percentual_esperado_bp,
      });
      if (ponto.realizado_bp !== null)
        expect({ dia: ponto.dia, realizado: ponto.realizado_bp }).toEqual({
          dia: ponto.dia,
          realizado: noDia.campanha.percentual_meta_bp,
        });
    }
}

// ---------------------------------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------------------------------

describe("montarVisaoIndividual: schema e números do painel em todos os cenários", () => {
  const unidades: UnidadeMeta[] = ["bilhetes", "centavos"];
  for (const unidade of unidades)
    for (const regra of REGRAS_META)
      for (const criterio of CRITERIOS_RANKING)
        it(`meta em ${unidade}, ${regra}, critério ${criterio}: todos os alvos, fases e janelas`, () => {
          const entrada = entradaEsperada(
            campanhaCom({ unidade, regra, criterio }),
          );
          for (const [fase, agora] of Object.entries(INSTANTES))
            for (const periodo of JANELAS_RANKING)
              for (const quem of ALVOS) {
                const visao = visaoDe(entrada, quem, periodo, agora);
                try {
                  conforme(visao);
                  conferirContraOPainel(visao, entrada, quem, periodo, agora);
                } catch (erro) {
                  throw new Error(
                    `${fase}, ${periodo}, ${quem.tipo} ${quem.id}: ${String(erro)}`,
                    { cause: erro },
                  );
                }
              }
        });

  it("RIFA-061 (D27): sem ranking por divisão, todos os alvos, fases e janelas conferem com os montadores (o de todos)", () => {
    for (const regra of REGRAS_META)
      for (const criterio of CRITERIOS_RANKING) {
        const entrada = entradaEsperada(
          campanhaCom({ regra, criterio, porDivisao: false }),
        );
        for (const [fase, agora] of Object.entries(INSTANTES))
          for (const periodo of JANELAS_RANKING)
            for (const quem of ALVOS) {
              const visao = visaoDe(entrada, quem, periodo, agora);
              try {
                conforme(visao);
                conferirContraOPainel(visao, entrada, quem, periodo, agora);
                expect(visao.ranking.por_divisao).toBe(false);
                expect(visao.ranking.divisao).toEqual(visao.ranking.geral);
              } catch (erro) {
                throw new Error(
                  `${regra}, ${criterio}, ${fase}, ${periodo}, ${quem.tipo} ${quem.id}: ${String(erro)}`,
                  { cause: erro },
                );
              }
            }
      }
  });

  it("RIFA-061 (D27): ligada (true ou ausente), a visão é a de sempre, sem a marca", () => {
    for (const porDivisao of [undefined, true])
      for (const quem of ALVOS) {
        const entrada = entradaEsperada(campanhaCom({ porDivisao }));
        const visao = visaoDe(entrada, quem, "atual", AGORA);
        expect(visao.ranking).not.toHaveProperty("por_divisao");
        expect(visao).toEqual(visaoDe(entradaEsperada(), quem, "atual", AGORA));
      }
  });

  it("limite do público: null mostra todos os que venderam; 1 só o primeiro (com empates)", () => {
    for (const limite of [null, 1, 3])
      for (const periodo of JANELAS_RANKING)
        for (const quem of ALVOS) {
          const entrada = entradaEsperada(campanhaCom({ limite }));
          const visao = visaoDe(entrada, quem, periodo, AGORA);
          conforme(visao);
          conferirContraOPainel(visao, entrada, quem, periodo, AGORA);
          if (limite !== null)
            expect(
              visao.ranking.primeiros.every((item) => item.posicao <= limite),
            ).toBe(true);
        }
  });
});

describe("montarVisaoIndividual: o que a visão mostra de cada alvo", () => {
  const entrada = entradaEsperada();

  it("líder: só a própria célula, os afiliados dela e nenhuma equipe", () => {
    const visao = visaoDe(entrada, alvo("celula", 2), "atual", AGORA);
    expect(visao.alvo).toEqual(alvo("celula", 2));
    expect(visao.pessoa).toBe("Pessoa Ficticia");
    expect(visao.afiliados_vinculados).toBe(1);
    expect(visao.equipe).toEqual([]);
    // Betel no dia 9: meta da campanha 60 bilhetes; 3 + 4 + 5 na Semana 1 e 6 no dia 8 (e nada no dia 9).
    expect(visao.desempenho.campanha).toMatchObject({
      meta: 60,
      realizado: 18,
      percentual_meta_bp: 3000,
    });
    expect(visao.desempenho.bilhetes).toEqual({ campanha: 18, hoje: 0 });
    expect(visao.ranking.nivel).toBe("celula");
  });

  it("discipulador: as células dele, por nome, com líder e afiliados; outro discipulador fica de fora", () => {
    const visao = visaoDe(entrada, alvo("discipulador", 10), "atual", AGORA);
    expect(visao.afiliados_vinculados).toBeNull();
    expect(
      visao.equipe.map(({ tipo, id, discipulador_id, lider_nome }) => ({
        tipo,
        id,
        discipulador_id,
        lider_nome,
      })),
    ).toEqual([
      {
        tipo: "celula",
        id: 1,
        discipulador_id: 10,
        lider_nome: "Líder da Célula Ágape",
      },
      {
        tipo: "celula",
        id: 2,
        discipulador_id: 10,
        lider_nome: "Líder da Célula Betel",
      },
    ]);
    expect(visao.equipe.every((item) => item.afiliados_vinculados === 1)).toBe(
      true,
    );
  });

  it("rede: os discipuladores dela por nome, cada um seguido das células dele; nada da outra rede", () => {
    const jovem = visaoDe(entrada, alvo("rede", 1), "atual", AGORA);
    expect(jovem.equipe.map(({ tipo, id }) => `${tipo}:${id}`)).toEqual([
      "discipulador:10",
      "celula:1",
      "celula:2",
      "discipulador:20",
      "celula:3",
    ]);
    const adulta = visaoDe(entrada, alvo("rede", 2), "atual", AGORA);
    expect(adulta.equipe.map(({ tipo, id }) => `${tipo}:${id}`)).toEqual([
      "discipulador:30",
      "celula:4",
      "celula:5",
      "discipulador:40",
    ]);
    // Davi não tem células: está na equipe, sem meta e fora do ranking (R8).
    const davi = adulta.equipe.find((item) => item.id === 40)!;
    expect(davi.posicao_divisao).toBeNull();
    expect(davi.desempenho.campanha.situacao).toBe("sem_meta");
  });

  it("RIFA-061 (D27): sem ranking por divisão, a rede adulta vê as posições entre todos (células e discipuladores) e os primeiros de todos", () => {
    const unico = entradaEsperada(campanhaCom({ porDivisao: false }));
    const adulta = visaoDe(unico, alvo("rede", 2), "atual", AGORA);
    const separada = visaoDe(entrada, alvo("rede", 2), "atual", AGORA);
    // Dorcas é a 1ª dos adultos e a 2ª de todas; Caleb é o 1º dos adultos e o 3º de todos (Abel e Boaz na frente).
    const posicao = (visao: RespostaVisaoIndividual, id: number) =>
      visao.equipe.find((item) => item.id === id)!.posicao_divisao;
    expect([posicao(separada, 4), posicao(adulta, 4)]).toEqual([1, 2]);
    expect([posicao(separada, 30), posicao(adulta, 30)]).toEqual([1, 3]);
    expect(adulta.ranking.divisao).toEqual(adulta.ranking.geral);
    // Os primeiros da Betel (líder dos jovens) passam a ter a Dorcas, dos adultos.
    const betel = visaoDe(unico, alvo("celula", 2), "atual", AGORA);
    expect(betel.ranking.primeiros.map((item) => item.nome)).toContain(
      "Célula Dorcas",
    );
    expect(
      visaoDe(entrada, alvo("celula", 2), "atual", AGORA).ranking.primeiros.map(
        (item) => item.nome,
      ),
    ).not.toContain("Célula Dorcas");
  });

  it("alvo sem células (discipulador Davi): fora do ranking, sem curva e sem equipe", () => {
    const visao = visaoDe(entrada, alvo("discipulador", 40), "atual", AGORA);
    conforme(visao);
    expect(visao.ranking.geral).toBeNull();
    expect(visao.ranking.divisao).toBeNull();
    expect(visao.curva).toEqual([]);
    expect(visao.equipe).toEqual([]);
    expect(visao.desempenho.campanha).toMatchObject({
      meta: 0,
      situacao: "sem_meta",
      percentual_meta_bp: null,
    });
  });

  it("a distância até os vizinhos sai sempre null (D12), em todos os critérios", () => {
    for (const criterio of CRITERIOS_RANKING) {
      const comCriterio = entradaEsperada(campanhaCom({ criterio }));
      for (const quem of ALVOS)
        for (const periodo of JANELAS_RANKING) {
          const { ranking } = visaoDe(comCriterio, quem, periodo, AGORA);
          const vizinhos = [ranking.geral, ranking.divisao].flatMap(
            (posicao) => (posicao ? [posicao.acima, posicao.abaixo] : []),
          );
          expect(
            vizinhos.filter(
              (vizinho) => vizinho !== null && vizinho.diferenca !== null,
            ),
          ).toEqual([]);
        }
    }
  });

  it("com meta em centavos, nenhuma quantidade na unidade da meta; os bilhetes de hoje saem somados", () => {
    const emCentavos = entradaEsperada(campanhaCom({ unidade: "centavos" }));
    // Dia 9 (01/12): Dorcas vendeu 5 + 7 bilhetes; Ágape, 1.
    const dorcas = visaoDe(emCentavos, alvo("celula", 4), "atual", AGORA);
    conforme(dorcas);
    expect(dorcas.unidade).toBe("centavos");
    expect(dorcas.desempenho.hoje).toMatchObject({
      meta: null,
      realizado: null,
      falta: null,
    });
    for (const janela of [
      dorcas.desempenho.periodo!,
      dorcas.desempenho.campanha,
    ])
      expect(janela).toMatchObject({
        meta: null,
        esperado: null,
        realizado: null,
        diferenca: null,
      });
    expect(dorcas.desempenho.bilhetes.hoje).toBe(12);
    expect(dorcas.desempenho.campanha.percentual_meta_bp).not.toBeNull();
    const rede = visaoDe(emCentavos, alvo("rede", 1), "atual", AGORA);
    expect(rede.desempenho.bilhetes.hoje).toBe(1);
  });

  it("a curva usa a meta exata: com a meta proporcional fracionária, o ponto de hoje é o percentual da campanha", () => {
    // 997 bilhetes repartidos por 60 pessoas: Ágape (12 pessoas) tem meta 199,4 (199 + 2/5), mostrada como 200.
    const fracionaria = entradaEsperada(
      campanhaCom({ regra: "total_proporcional" }),
    );
    const visao = visaoDe(fracionaria, alvo("celula", 1), "atual", AGORA);
    conforme(visao);
    expect(visao.desempenho.campanha.meta).toBe(200);
    const hoje = visao.curva[8];
    expect(hoje.realizado_bp).toBe(
      visao.desempenho.campanha.percentual_meta_bp,
    );
    // Ágape até o dia 9: 6 × 6 + 6 (dia 7) + 5 (dia 8) + 1 (dia 9) = 48 bilhetes; 48 ÷ 199,4 = 24,07% (2407 bp).
    // Pela meta arredondada (200) seriam 2400.
    expect(hoje.realizado_bp).toBe(2407);
    expect(visao.curva.at(-1)!.esperado_bp).toBe(10_000);
    expect(
      visao.curva.slice(9).every((ponto) => ponto.realizado_bp === null),
    ).toBe(true);
  });

  it("`eu` vem pelo id: duas células com o mesmo nome na divisão não confundem a marca", () => {
    // Só aqui (o banco não deixa nomes iguais): a Betel passa a se chamar como a Ágape.
    const mesmoNome = {
      ...entrada,
      celulas: entrada.celulas.map((celula) =>
        celula.id === 2 ? { ...celula, nome: "Célula Ágape" } : celula,
      ),
    };
    for (const id of [1, 2]) {
      const visao = visaoDe(
        mesmoNome,
        { ...alvo("celula", id), nome: "Célula Ágape" },
        "campanha",
        AGORA,
      );
      const marcados = visao.ranking.primeiros.filter((item) => item.eu);
      const posicao = montarRankingPainel(
        mesmoNome,
        { nivel: "celula", divisao: "jovens", periodo: "campanha" },
        AGORA,
      ).itens.find((item) => item.id === id)!.posicao;
      expect(marcados).toEqual([{ posicao, nome: "Célula Ágape", eu: true }]);
    }
  });

  it("antes da primeira venda e antes do início: posições sem vendas, nenhum primeiro, curva sem realizado", () => {
    const semVendas = entradaEsperada(DADOS_CAMPANHA, []);
    const antes = visaoDe(
      semVendas,
      alvo("celula", 1),
      "atual",
      INSTANTES.antes,
    );
    conforme(antes);
    expect(antes.referencia.fase).toBe("antes");
    expect(antes.desempenho.hoje).toBeNull();
    expect(antes.desempenho.bilhetes).toEqual({ campanha: 0, hoje: null });
    expect(antes.ranking.primeiros).toEqual([]);
    expect(antes.curva.every((ponto) => ponto.realizado_bp === null)).toBe(
      true,
    );
    const durante = visaoDe(semVendas, alvo("celula", 1), "atual", AGORA);
    expect(durante.ranking.primeiros).toEqual([]);
    expect(durante.ranking.geral?.participantes).toBe(5);
  });

  it("vendas sem célula e de células fora da hierarquia lida não pesam em nada", () => {
    const comSobras: EntradaCalculo = {
      ...entrada,
      vendas: [
        ...entrada.vendas,
        {
          celula_id: null,
          dia: "2026-12-01",
          pedidos: 9,
          bilhetes: 99,
          centavos: 198_000,
        },
        {
          celula_id: 999,
          dia: "2026-12-01",
          pedidos: 9,
          bilhetes: 99,
          centavos: 198_000,
        },
      ],
    };
    for (const quem of ALVOS)
      for (const periodo of JANELAS_RANKING)
        expect(visaoDe(comSobras, quem, periodo, AGORA)).toEqual(
          visaoDe(entrada, quem, periodo, AGORA),
        );
  });

  it("os pedidos do cenário (para o leitor): o painel e a visão leem as mesmas vendas", () => {
    expect(PEDIDOS.length).toBeGreaterThan(30);
    expect(entrada.vendas.length).toBeGreaterThan(20);
  });
});
