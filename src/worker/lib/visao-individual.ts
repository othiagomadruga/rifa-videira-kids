/**
 * Montador da visão individual (RIFA-014, RF08, D12; GET /api/minha/visao): função pura, FORA do contrato, que
 * monta a resposta de um líder, discipulador ou rede com as funções de src/shared/contracts/calculos.ts
 * (montarResumoPainel e montarRankingPainel) e a regra do ranking público (R9) para os primeiros, e só copia o
 * que `respostaVisaoIndividualSchema` permite.
 *
 * Sem dinheiro, nunca (D12): com meta em centavos, as quantidades na unidade da meta saem null e ficam só os
 * percentuais; nenhum campo de valor em R$ é copiado (vendas.total_centavos, projecao...); a distância até os
 * vizinhos (`diferenca`) sai sempre null até o PO decidir. Números só do próprio alvo e da equipe dele; dos
 * pares, só nome e posição.
 *
 * O que os montadores do contrato não trazem prontos, e o que se faz aqui:
 * - bilhetes de hoje com meta em centavos: somados das vendas do dia das células do alvo (a entrada já traz os
 *   bilhetes por célula e dia);
 * - curva em pontos-base: sobre a meta EXATA do alvo (a fração, sem arredondar), com a mesma conta de
 *   percentual_meta_bp (percentualBp) e de percentual_esperado_bp (percentualEsperadoBp): o ponto de hoje é
 *   igual a campanha.percentual_meta_bp;
 * - `eu` nos primeiros pelo id, a partir do ranking da coordenação (o item público não tem id);
 * - alvo sem células fica fora do ranking (R8): posições null.
 *
 * CPU (o Worker tem 10 ms por requisição no plano Free; cada montador percorre as linhas de venda que recebe,
 * ~1,5 µs por linha no workerd): "hoje" é calculado uma vez e vai como `data` para todos os montadores, e cada
 * um recebe só as vendas que pesam no resultado dele, sem mudar nada na resposta:
 * - o resumo de um escopo (o alvo ou alguém da equipe), só as das células do escopo, e só elas como células,
 *   mais uma que representa as outras pela soma das pessoas (a meta proporcional depende delas só por isso);
 * - os rankings, por célula, as dos dias já fechados da janela somadas numa linha só (no 1º dia da janela) e as
 *   de hoje: um ranking depende das vendas só pelo realizado da janela até ontem e até agora de cada célula; e o
 *   de uma divisão, só as células dela (mais a que representa as outras, como no resumo).
 * src/worker/lib/visao-individual.test.ts confere, campo a campo, que cada resposta é a mesma do montador com
 * todas as células e todas as vendas.
 * As metas continuam sobre TODAS as células (a regra proporcional reparte o total entre todas), então os
 * números são os mesmos do painel.
 */
import {
  curvaEsperada,
  diaLocalDoInstante,
  metasDasCelulas,
  montarRankingPainel,
  montarResumoPainel,
  percentualBp,
  percentualEsperadoBp,
  somarMetas,
  type Alvo,
  type CelulaCalculo,
  type ConsultaVisaoIndividual,
  type DesempenhoIndividual,
  type Divisao,
  type EntradaCalculo,
  type EscopoResolvido,
  type ItemEquipe,
  type NivelRanking,
  type RespostaPainelResumo,
  type RespostaRanking,
  type RespostaVisaoIndividual,
  type Ritmo,
  type RitmoIndividual,
  type VendasDoDia,
  type VizinhoRanking,
} from "../../shared/contracts";

/** Os dados de base da visão: iguais para todos os usuários (db/visao-individual.ts). */
export interface DadosDaVisao {
  /** A campanha, TODAS as células com a hierarquia e as vendas aprovadas por célula e dia local. */
  entrada: EntradaCalculo;
  /** Todos os discipuladores, inclusive os sem células (a equipe da rede lista todos os dela). */
  discipuladores: readonly { id: number; nome: string; rede_id: number }[];
  /** Por célula: o líder, como está na hierarquia, e quantos afiliados estão vinculados a ela. */
  celulas: ReadonlyMap<
    number,
    { lider_nome: string; afiliados_vinculados: number }
  >;
}

/**
 * Os montadores do contrato que a visão chama. Injetáveis, como os de routes/publico.ts: o teste de desempenho
 * (routes/minha-desempenho.test.ts) conta o trabalho de cada visão (as chamadas, as linhas de venda e as células
 * que eles recebem). Em produção, os de calculos.ts.
 */
export const MONTADORES_DA_VISAO = Object.freeze({
  montarResumoPainel,
  montarRankingPainel,
});
export type MontadoresDaVisao = typeof MONTADORES_DA_VISAO;

/** Quem pede, da sessão: o nome do usuário e o alvo (com o id do banco, nunca da requisição). */
export interface QuemPede {
  pessoa: string;
  alvo: Alvo;
}

/** Nomes em português: sem diferenciar acentos e maiúsculas, "Célula 2" antes de "Célula 10" (como o ranking). */
const ordemDosNomes = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  numeric: true,
});
const porNome = <T extends { id: number; nome: string }>(a: T, b: T) =>
  ordemDosNomes.compare(a.nome, b.nome) || a.id - b.id;

/** Com meta em centavos, toda quantidade na unidade da meta seria dinheiro: sai null. */
function semDinheiro(centavos: boolean) {
  const quantidade = (valor: number) => (centavos ? null : valor);
  const ritmo = (valor: Ritmo): RitmoIndividual => ({
    meta: quantidade(valor.meta),
    esperado: quantidade(valor.esperado),
    realizado: quantidade(valor.realizado),
    diferenca: quantidade(valor.diferenca),
    situacao: valor.situacao,
    percentual_meta_bp: valor.percentual_meta_bp,
    percentual_esperado_bp: valor.percentual_esperado_bp,
  });
  return {
    desempenho(
      resumo: RespostaPainelResumo,
      bilhetesHoje: number | null,
    ): DesempenhoIndividual {
      const { hoje } = resumo;
      return {
        hoje:
          hoje === null
            ? null
            : {
                data: hoje.data,
                meta: quantidade(hoje.meta),
                realizado: quantidade(hoje.realizado),
                falta: quantidade(hoje.falta),
                percentual_meta_bp: hoje.percentual_meta_bp,
                batida: hoje.batida,
              },
        periodo: resumo.periodo === null ? null : ritmo(resumo.periodo),
        campanha: {
          ...ritmo(resumo.campanha),
          projecao_percentual_meta_bp:
            resumo.campanha.projecao_percentual_meta_bp,
        },
        bilhetes: {
          campanha: resumo.vendas.bilhetes,
          hoje: hoje === null ? null : bilhetesHoje,
        },
      };
    },
  };
}

/**
 * As células que não pesam num resultado, como uma só (com a soma das pessoas delas). O id 0 não é de nenhuma
 * célula, discipulador ou rede (os ids do banco são positivos): ela nunca entra num escopo.
 */
const AS_OUTRAS_CELULAS: Omit<CelulaCalculo, "qtd_pessoas" | "divisao"> = {
  id: 0,
  nome: "As outras células",
  discipulador_id: 0,
  discipulador_nome: "Nenhum",
  rede_id: 0,
  rede_nome: "Nenhuma",
};
const OUTRA_DIVISAO = {
  jovens: "adultos",
  adultos: "jovens",
} as const satisfies Record<Divisao, Divisao>;

/**
 * As vendas que pesam num ranking da janela [`inicio`, `fim`] na data `hoje`: por célula, a soma das dos dias
 * já fechados da janela (até ontem) numa linha só, no 1º dia da janela, e as de hoje (se hoje está na janela).
 * O resto (antes da janela, depois de hoje ou depois do fim dela) não entra no ranking. Separadas por divisão
 * (o ranking de uma divisão só olha as células dela). Datas "YYYY-MM-DD": a ordem do texto é a do calendário.
 */
function vendasQuePesamNoRanking(
  entrada: EntradaCalculo,
  inicio: string,
  fim: string,
  hoje: string,
): Record<Divisao | "todas", VendasDoDia[]> {
  const divisaoDaCelula = new Map(
    entrada.celulas.map((celula) => [celula.id, celula.divisao]),
  );
  const fechadas = new Map<number, VendasDoDia>();
  const deHoje: VendasDoDia[] = [];
  for (const venda of entrada.vendas) {
    if (venda.celula_id === null || venda.dia < inicio || venda.dia > fim)
      continue;
    if (venda.dia === hoje) deHoje.push(venda);
    else if (venda.dia < hoje) {
      const soma = fechadas.get(venda.celula_id);
      if (soma === undefined)
        fechadas.set(venda.celula_id, { ...venda, dia: inicio });
      else {
        soma.pedidos += venda.pedidos;
        soma.bilhetes += venda.bilhetes;
        soma.centavos += venda.centavos;
      }
    }
  }
  const resultado: Record<Divisao | "todas", VendasDoDia[]> = {
    todas: [],
    jovens: [],
    adultos: [],
  };
  for (const venda of [...fechadas.values(), ...deHoje]) {
    const divisao = divisaoDaCelula.get(venda.celula_id!);
    // Venda de uma célula que não está na hierarquia lida: fica de fora, como no montador (sem célula).
    if (divisao === undefined) continue;
    resultado.todas.push(venda);
    resultado[divisao].push(venda);
  }
  return resultado;
}

/** A posição de um id num ranking do nível, com os vizinhos só por nome e posição (sem distância, D12). */
function posicaoNoRanking(ranking: RespostaRanking, id: number) {
  const item = ranking.itens.find((linha) => linha.id === id);
  if (item === undefined) return null;
  const vizinho = (outro: VizinhoRanking | null) =>
    outro && { nome: outro.nome, posicao: outro.posicao, diferenca: null };
  return {
    posicao: item.posicao,
    participantes: ranking.itens.length,
    acima: vizinho(item.acima),
    abaixo: vizinho(item.abaixo),
  };
}

/**
 * A visão do alvo de quem pede (o alvo vem SÓ de `quem`, que vem da sessão). `agora` é o instante da requisição;
 * `consulta.periodo` escolhe a janela do ranking.
 */
export function montarVisaoIndividual(
  dados: DadosDaVisao,
  quem: QuemPede,
  consulta: ConsultaVisaoIndividual,
  agora: Date,
  montadores: MontadoresDaVisao = MONTADORES_DA_VISAO,
): RespostaVisaoIndividual {
  const { entrada } = dados;
  const { campanha } = entrada;
  const { alvo } = quem;
  const data = diaLocalDoInstante(agora, campanha.fuso_horario);
  const regras = semDinheiro(campanha.meta.unidade === "centavos");
  const metas = metasDasCelulas(campanha.meta, entrada.celulas);

  // As vendas por célula (as sem célula não pesam em nada daqui: nem no alvo, nem nos rankings).
  const vendasDaCelula = new Map<number, VendasDoDia[]>();
  for (const venda of entrada.vendas) {
    if (venda.celula_id === null) continue;
    const lista = vendasDaCelula.get(venda.celula_id);
    if (lista) lista.push(venda);
    else vendasDaCelula.set(venda.celula_id, [venda]);
  }
  const vendasDe = (celulas: readonly CelulaCalculo[]) =>
    celulas.flatMap((celula) => vendasDaCelula.get(celula.id) ?? []);
  const pessoas = (celulas: readonly CelulaCalculo[]) =>
    celulas.reduce((soma, celula) => soma + celula.qtd_pessoas, 0);
  const totalDePessoas = pessoas(entrada.celulas);
  /**
   * As células que um montador recebe no lugar de todas: `celulas` e, se houver outras, uma só que as
   * representa pela soma das pessoas, sem vendas, fora de qualquer escopo (id 0) e fora da `divisao` (a do
   * ranking). A meta de cada uma de `celulas` fica a mesma (a regra proporcional depende das outras só pelo
   * total de pessoas; as outras regras, nem disso), e o montador não monta a série diária das que não pesam.
   */
  const comAsOutras = (
    celulas: readonly CelulaCalculo[],
    divisao: Divisao = "jovens",
  ): readonly CelulaCalculo[] =>
    celulas.length === entrada.celulas.length
      ? celulas
      : [
          ...celulas,
          {
            ...AS_OUTRAS_CELULAS,
            divisao: OUTRA_DIVISAO[divisao],
            qtd_pessoas: totalDePessoas - pessoas(celulas),
          },
        ];

  /** Os números de um escopo (o alvo ou alguém da equipe) e a meta exata dele. */
  function calcular(escopo: EscopoResolvido, celulas: CelulaCalculo[]) {
    const resumo = montadores.montarResumoPainel(
      { campanha, celulas: comAsOutras(celulas), vendas: vendasDe(celulas) },
      { escopo, data },
      agora,
    );
    let bilhetesHoje = 0;
    for (const celula of celulas)
      for (const venda of vendasDaCelula.get(celula.id) ?? [])
        if (venda.dia === data) bilhetesHoje += venda.bilhetes;
    return {
      resumo,
      metaExata: somarMetas(celulas.map((celula) => metas.get(celula.id)!)),
      desempenho: regras.desempenho(resumo, bilhetesHoje),
    };
  }

  const celulasDoAlvo = entrada.celulas.filter((celula) =>
    alvo.tipo === "celula"
      ? celula.id === alvo.id
      : alvo.tipo === "discipulador"
        ? celula.discipulador_id === alvo.id
        : celula.rede_id === alvo.id,
  );
  const proprio = calcular(
    { tipo: alvo.tipo, id: alvo.id, divisao: alvo.divisao, nome: alvo.nome },
    celulasDoAlvo,
  );

  // Rankings: o do nível do alvo (geral e na divisão) e, para a equipe, os dos níveis abaixo na divisão. A
  // janela vem do próprio montador (sem células, ele só calcula a janela, que não depende das vendas).
  const nivel: NivelRanking = alvo.tipo;
  const { periodo } = consulta;
  const janela = montadores.montarRankingPainel(
    { campanha, celulas: [], vendas: [] },
    { nivel, periodo, data },
    agora,
  ).janela;
  const vendasDoRanking = vendasQuePesamNoRanking(
    entrada,
    janela.data_inicio,
    janela.data_fim,
    data,
  );
  const celulasDa = (divisao: Divisao) =>
    entrada.celulas.filter((celula) => celula.divisao === divisao);
  const ranking = (nivelDoRanking: NivelRanking, divisao?: Divisao) =>
    montadores.montarRankingPainel(
      divisao === undefined
        ? { campanha, celulas: entrada.celulas, vendas: vendasDoRanking.todas }
        : {
            campanha,
            celulas: comAsOutras(celulasDa(divisao), divisao),
            vendas: vendasDoRanking[divisao],
          },
      { nivel: nivelDoRanking, divisao, periodo, data },
      agora,
    );
  const geral = ranking(nivel);
  const naDivisao = ranking(nivel, alvo.divisao);
  const posicaoGeral = posicaoNoRanking(geral, alvo.id);
  const posicaoNaDivisao = posicaoNoRanking(naDivisao, alvo.id);
  // R9, a regra do ranking público (montarRankingPublico): só quem já vendeu na janela, posição até o limite
  // (empates no limite entram todos). Pelo ranking da coordenação, que tem o id: `eu` não depende do nome.
  const limite = campanha.publico.limite_ranking;
  const primeiros = naDivisao.itens
    .filter(
      (item) =>
        item.vendas.pedidos_aprovados > 0 &&
        (limite === null || item.posicao <= limite),
    )
    .map((item) => ({
      posicao: item.posicao,
      nome: item.nome,
      eu: item.id === alvo.id,
    }));

  // Equipe: as células do discipulador; os discipuladores da rede (inclusive os sem células), cada um seguido
  // das células dele. Só quem está abaixo do alvo, pelos ids da hierarquia.
  const equipe: ItemEquipe[] = [];
  if (alvo.tipo !== "celula") {
    const rankingDasCelulas = ranking("celula", alvo.divisao);
    const itemDaCelula = (celula: CelulaCalculo): ItemEquipe => {
      const extra = dados.celulas.get(celula.id);
      if (extra === undefined)
        throw new Error(`Célula ${celula.id} sem os dados de adesão`);
      return {
        tipo: "celula",
        id: celula.id,
        nome: celula.nome,
        discipulador_id: celula.discipulador_id,
        lider_nome: extra.lider_nome,
        afiliados_vinculados: extra.afiliados_vinculados,
        desempenho: calcular(
          {
            tipo: "celula",
            id: celula.id,
            divisao: celula.divisao,
            nome: celula.nome,
          },
          [celula],
        ).desempenho,
        posicao_divisao:
          posicaoNoRanking(rankingDasCelulas, celula.id)?.posicao ?? null,
      };
    };
    const celulasDoDiscipulador = (id: number) =>
      celulasDoAlvo
        .filter((celula) => celula.discipulador_id === id)
        .sort(porNome);

    if (alvo.tipo === "discipulador")
      equipe.push(...celulasDoDiscipulador(alvo.id).map(itemDaCelula));
    else {
      const rankingDosDiscipuladores = ranking("discipulador", alvo.divisao);
      const discipuladores = dados.discipuladores
        .filter((discipulador) => discipulador.rede_id === alvo.id)
        .sort(porNome);
      for (const discipulador of discipuladores) {
        const celulas = celulasDoDiscipulador(discipulador.id);
        equipe.push({
          tipo: "discipulador",
          id: discipulador.id,
          nome: discipulador.nome,
          discipulador_id: null,
          lider_nome: null,
          afiliados_vinculados: null,
          desempenho: calcular(
            {
              tipo: "discipulador",
              id: discipulador.id,
              divisao: alvo.divisao,
              nome: discipulador.nome,
            },
            celulas,
          ).desempenho,
          posicao_divisao:
            posicaoNoRanking(rankingDosDiscipuladores, discipulador.id)
              ?.posicao ?? null,
        });
        equipe.push(...celulas.map(itemDaCelula));
      }
    }
  }

  // Curva em pontos-base da meta exata do alvo; vazia sem meta (não há percentual).
  const { resumo, metaExata } = proprio;
  const pesos = curvaEsperada(campanha.periodos);
  const curva =
    resumo.campanha.percentual_meta_bp === null
      ? []
      : resumo.curva.map((ponto) => ({
          dia: ponto.dia,
          data: ponto.data,
          esperado_bp: percentualEsperadoBp(pesos, ponto.dia),
          realizado_bp:
            ponto.realizado === null
              ? null
              : percentualBp(
                  { num: BigInt(ponto.realizado), den: 1n },
                  metaExata,
                ),
        }));

  return {
    alvo: {
      tipo: alvo.tipo,
      id: alvo.id,
      nome: alvo.nome,
      divisao: alvo.divisao,
    },
    pessoa: quem.pessoa,
    referencia: resumo.referencia,
    unidade: campanha.meta.unidade,
    desempenho: proprio.desempenho,
    afiliados_vinculados:
      alvo.tipo === "celula"
        ? (dados.celulas.get(alvo.id)?.afiliados_vinculados ?? 0)
        : null,
    curva,
    ranking: {
      nivel,
      janela,
      criterio: campanha.ranking.criterio,
      geral: posicaoGeral,
      divisao: posicaoNaDivisao,
      primeiros,
    },
    equipe,
    atualizado_em: agora.toISOString(),
  };
}
