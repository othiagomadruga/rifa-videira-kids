/**
 * Relatório da campanha para baixar (RIFA-038; docs/decisions.md D23): as linhas de cada tipo e o arquivo CSV. Módulo
 * puro, sem banco e sem relógio: recebe o que as leituras do painel e do mapa já devolvem (db/painel.ts e
 * db/mapa-ddd.ts, que excluem o pedido desconsiderado, D20) e chama os MESMOS montadores do painel, dos rankings e do
 * mapa (calculos.ts e lib/mapa-ddd.ts). Os números do arquivo são os das telas, por construção.
 *
 * - Cada linha é um registro com TODAS as colunas do tipo (o TypeScript exige cada uma de `COLUNAS_RELATORIO`), posto
 *   na ordem do contrato por `emOrdem`.
 * - Os números saem SÓ pelos formatadores do contrato (nada de `String(numero)`), e o arquivo SÓ por
 *   `montarCsvRelatorio(cabecalhoDoRelatorio(tipo, unidade), linhas)`, que passa toda célula pela proteção contra
 *   fórmula (`celulaCsv`): um nome de célula, rede, discipulador, líder ou da campanha que comece com `=`, `+`, `-` ou
 *   `@` sai com o apóstrofo.
 * - Nada pessoal: da hierarquia, só os nomes (do líder, o `lider_nome`); do comprador, só o DDD agregado; nenhum id.
 */
import {
  COLUNAS_RELATORIO,
  LINHA_EXTERIOR_RELATORIO,
  LINHA_SEM_DDD_RELATORIO,
  NOMES_DIVISAO,
  ORDEM_DIVISOES,
  TEXTO_CRITERIO_RELATORIO,
  TEXTO_FASE_RELATORIO,
  cabecalhoDoRelatorio,
  calcularCalendario,
  diasEntre,
  formatarCentavosCsv,
  formatarDataCsv,
  formatarInteiroCsv,
  formatarMetaCsv,
  formatarPercentualBpCsv,
  hojeNoFuso,
  montarCsvRelatorio,
  montarRankingPainel,
  montarResumoPainel,
  rankingPorDivisao,
  somarDias,
  type EntradaCalculo,
  type EscopoResolvido,
  type ItemRanking,
  type NivelRanking,
  type RespostaMapaDdd,
  type TipoRelatorio,
  type TotaisVendas,
  type UnidadeMeta,
} from "../../shared/contracts";

/** Os tipos que saem da leitura do painel (`lerEntradaDoCalculo`); o `ddd` sai da do mapa (`lerMapaDdd`). */
export type TipoDoPainel = Exclude<TipoRelatorio, "ddd">;

/** O que a leitura do painel devolve (`LeituraDoCalculo` com `ok`), sem o escopo de consulta: é sempre a campanha. */
export interface DadosDoPainel {
  /** O instante único da requisição: o mesmo para o montador e para o "hoje" dos períodos e dos dias. */
  agora: Date;
  entrada: EntradaCalculo;
  /** O escopo campanha, resolvido pela leitura (o nome da campanha). */
  escopo: EscopoResolvido;
}

/** Os comandos a mais do lote (db/relatorio.ts), já lidos: cada um só no tipo que o usa, null nos outros. */
export interface ExtrasDoRelatorio {
  /** Só em `celulas`: o nome do líder por id da célula. */
  lideres: ReadonlyMap<number, string> | null;
  /** Só em `totais`: quantos pedidos da campanha estão desconsiderados (de qualquer status). */
  desconsiderados: number | null;
}

/** Os montadores que o relatório usa (os do painel: a rota passa os seus, injetáveis como os dela). */
export interface MontadoresDoRelatorio {
  montarResumoPainel: typeof montarResumoPainel;
  montarRankingPainel: typeof montarRankingPainel;
}

const MONTADORES_DO_CONTRATO: MontadoresDoRelatorio = {
  montarResumoPainel,
  montarRankingPainel,
};

/** O arquivo de um tipo e a data de referência do nome dele (hoje no fuso da campanha). */
export interface ArquivoRelatorio {
  csv: string;
  data: string;
}

// ---------------------------------------------------------------------------------------------------
// Colunas
// ---------------------------------------------------------------------------------------------------

type ColunaDe<T extends TipoRelatorio> = (typeof COLUNAS_RELATORIO)[T][number];
/** Uma linha de um tipo, com todas as colunas dele (nenhuma a mais, nenhuma a menos). */
type Registro<T extends TipoRelatorio> = Readonly<Record<ColunaDe<T>, string>>;

/** As células da linha na ordem das colunas do contrato. */
function emOrdem<T extends TipoRelatorio>(
  tipo: T,
  registro: Registro<T>,
): string[] {
  const colunas = COLUNAS_RELATORIO[tipo] as readonly ColunaDe<T>[];
  return colunas.map((coluna) => registro[coluna]);
}

/** Pedidos aprovados, bilhetes e arrecadação (R$), com os formatadores do contrato. */
function colunasDeVendas(vendas: TotaisVendas) {
  return {
    pedidos: formatarInteiroCsv(vendas.pedidos_aprovados),
    bilhetes: formatarInteiroCsv(vendas.bilhetes),
    arrecadacao: formatarCentavosCsv(vendas.total_centavos),
  };
}

function exigir<T>(valor: T | null | undefined, nome: string): T {
  if (valor === null || valor === undefined)
    throw new RangeError(`Relatório sem ${nome}`);
  return valor;
}

const ZERO: TotaisVendas = {
  pedidos_aprovados: 0,
  bilhetes: 0,
  total_centavos: 0,
};

function somar(a: TotaisVendas, b: TotaisVendas): TotaisVendas {
  return {
    pedidos_aprovados: a.pedidos_aprovados + b.pedidos_aprovados,
    bilhetes: a.bilhetes + b.bilhetes,
    total_centavos: a.total_centavos + b.total_centavos,
  };
}

// ---------------------------------------------------------------------------------------------------
// totais
// ---------------------------------------------------------------------------------------------------

/**
 * A linha única dos totais, do resumo da campanha (`montarResumoPainel` no escopo campanha, como o painel): as vendas
 * na janela até hoje (com as sem célula), as sem célula e as fora das datas (antes do início + depois do fim). O
 * critério do ranking vem da campanha (o `campanha` do resumo é o ritmo, sem ele).
 */
export function linhaDosTotais(
  dados: DadosDoPainel,
  desconsiderados: number,
  montadores: MontadoresDoRelatorio = MONTADORES_DO_CONTRATO,
): string[] {
  const resumo = montadores.montarResumoPainel(
    dados.entrada,
    { escopo: dados.escopo },
    dados.agora,
  );
  const semCelula = exigir(resumo.vendas_sem_celula, "as vendas sem célula");
  const fora = exigir(resumo.vendas_fora_da_janela, "as vendas fora da janela");
  const foraDasDatas = somar(fora.antes_do_inicio, fora.depois_do_fim);
  return emOrdem("totais", {
    campanha: resumo.escopo.nome,
    data_referencia: formatarDataCsv(resumo.referencia.data),
    fase: TEXTO_FASE_RELATORIO[resumo.referencia.fase],
    data_inicio: formatarDataCsv(resumo.referencia.data_inicio),
    data_fim: formatarDataCsv(resumo.referencia.data_fim),
    meta: formatarMetaCsv(resumo.campanha.meta, resumo.unidade),
    ...colunasDeVendas(resumo.vendas),
    percentual_meta: formatarPercentualBpCsv(
      resumo.campanha.percentual_meta_bp,
    ),
    pedidos_sem_celula: formatarInteiroCsv(semCelula.pedidos_aprovados),
    bilhetes_sem_celula: formatarInteiroCsv(semCelula.bilhetes),
    arrecadacao_sem_celula: formatarCentavosCsv(semCelula.total_centavos),
    pedidos_fora_das_datas: formatarInteiroCsv(foraDasDatas.pedidos_aprovados),
    bilhetes_fora_das_datas: formatarInteiroCsv(foraDasDatas.bilhetes),
    arrecadacao_fora_das_datas: formatarCentavosCsv(
      foraDasDatas.total_centavos,
    ),
    pedidos_desconsiderados: formatarInteiroCsv(desconsiderados),
    criterio_ranking:
      TEXTO_CRITERIO_RELATORIO[dados.entrada.campanha.ranking.criterio],
  });
}

// ---------------------------------------------------------------------------------------------------
// celulas, discipuladores, redes
// ---------------------------------------------------------------------------------------------------

/**
 * Os itens do ranking do nível, divisão por divisão (`ORDEM_DIVISOES`: jovens, depois adultos), na janela da campanha
 * inteira até hoje e na ordem do ranking da divisão: `montarRankingPainel` com `periodo: "campanha"`, como os
 * Rankings. Entram todos, inclusive quem não vendeu; discipulador ou rede sem célula não aparece (R8). Sem ranking
 * por divisão (RIFA-061, D27), um ranking só, de todos, na ordem dele (a "Posição no ranking" do cabeçalho).
 */
function itensPorDivisao(
  dados: DadosDoPainel,
  nivel: NivelRanking,
  montadores: MontadoresDoRelatorio,
): { unidade: UnidadeMeta; itens: ItemRanking[] } {
  const divisoes = rankingPorDivisao(dados.entrada.campanha)
    ? ORDEM_DIVISOES
    : [undefined];
  const rankings = divisoes.map((divisao) =>
    montadores.montarRankingPainel(
      dados.entrada,
      { nivel, divisao, periodo: "campanha" },
      dados.agora,
    ),
  );
  return {
    unidade: dados.entrada.campanha.meta.unidade,
    itens: rankings.flatMap((ranking) => ranking.itens),
  };
}

/**
 * As colunas comuns aos três níveis: divisão, meta, vendas, % da meta e a posição no ranking da divisão (sem ranking
 * por divisão, no ranking de todos).
 */
function colunasDoItem(item: ItemRanking, unidade: UnidadeMeta) {
  return {
    divisao: NOMES_DIVISAO[item.divisao],
    meta: formatarMetaCsv(item.meta, unidade),
    ...colunasDeVendas(item.vendas),
    percentual_meta: formatarPercentualBpCsv(item.percentual_meta_bp),
    posicao_divisao: formatarInteiroCsv(item.posicao),
  };
}

/** Uma linha por célula, com o nome do líder (só o nome: `lideres` vem de `SELECT id, lider_nome`). */
export function linhasDasCelulas(
  dados: DadosDoPainel,
  lideres: ReadonlyMap<number, string>,
  montadores: MontadoresDoRelatorio = MONTADORES_DO_CONTRATO,
): string[][] {
  const { unidade, itens } = itensPorDivisao(dados, "celula", montadores);
  return itens.map((item) =>
    emOrdem("celulas", {
      ...colunasDoItem(item, unidade),
      rede: exigir(item.rede, "a rede da célula").nome,
      discipulador: exigir(item.discipulador, "o discipulador da célula").nome,
      celula: item.nome,
      lider: exigir(lideres.get(item.id), "o líder da célula"),
    }),
  );
}

/** Uma linha por discipulador com célula. */
export function linhasDosDiscipuladores(
  dados: DadosDoPainel,
  montadores: MontadoresDoRelatorio = MONTADORES_DO_CONTRATO,
): string[][] {
  const { unidade, itens } = itensPorDivisao(dados, "discipulador", montadores);
  return itens.map((item) =>
    emOrdem("discipuladores", {
      ...colunasDoItem(item, unidade),
      rede: exigir(item.rede, "a rede do discipulador").nome,
      discipulador: item.nome,
    }),
  );
}

/** Uma linha por rede com célula. */
export function linhasDasRedes(
  dados: DadosDoPainel,
  montadores: MontadoresDoRelatorio = MONTADORES_DO_CONTRATO,
): string[][] {
  const { unidade, itens } = itensPorDivisao(dados, "rede", montadores);
  return itens.map((item) =>
    emOrdem("redes", { ...colunasDoItem(item, unidade), rede: item.nome }),
  );
}

// ---------------------------------------------------------------------------------------------------
// periodos, dias
// ---------------------------------------------------------------------------------------------------

/** Um dia da campanha já começado, com as vendas de todas as células e as sem célula. */
interface DiaDaCampanha {
  data: string;
  /** 1 = primeiro dia. */
  dia: number;
  /** Índice do período que contém o dia (0…). */
  periodo: number;
  vendas: TotaisVendas;
}

/**
 * Os dias do 1º até o último já começado (`min(último dia, hoje)`, hoje no fuso da campanha; hoje, parcial), com a
 * soma de `entrada.vendas` (todas as células e as sem célula) de cada dia; dia sem venda, zerado. As vendas antes do
 * início e depois do fim não caem em nenhum dia (ficam nos totais, em "fora das datas").
 */
function diasAteHoje(dados: DadosDoPainel): {
  calendario: ReturnType<typeof calcularCalendario>;
  dias: DiaDaCampanha[];
} {
  const { campanha, vendas } = dados.entrada;
  const calendario = calcularCalendario(
    campanha.data_inicio,
    campanha.periodos,
  );
  const hoje = hojeNoFuso(campanha.fuso_horario, dados.agora);
  const ultimo = Math.min(
    calendario.total_dias,
    diasEntre(campanha.data_inicio, hoje) + 1,
  );
  const porDia = new Map<string, TotaisVendas>();
  for (const venda of vendas)
    porDia.set(
      venda.dia,
      somar(porDia.get(venda.dia) ?? ZERO, {
        pedidos_aprovados: venda.pedidos,
        bilhetes: venda.bilhetes,
        total_centavos: venda.centavos,
      }),
    );

  const dias: DiaDaCampanha[] = [];
  let periodo = 0;
  let fimDoPeriodo = campanha.periodos[0].dias;
  for (let dia = 1; dia <= ultimo; dia++) {
    while (dia > fimDoPeriodo) {
      periodo += 1;
      fimDoPeriodo += campanha.periodos[periodo].dias;
    }
    const data = somarDias(campanha.data_inicio, dia - 1);
    dias.push({ data, dia, periodo, vendas: porDia.get(data) ?? ZERO });
  }
  return { calendario, dias };
}

/**
 * Uma linha por período já começado (`data_inicio` ≤ hoje), com as datas do calendário (mesmo com o período em
 * andamento) e as vendas dos dias dele até hoje.
 */
export function linhasDosPeriodos(dados: DadosDoPainel): string[][] {
  const { campanha } = dados.entrada;
  const { calendario, dias } = diasAteHoje(dados);
  const somas = new Map<number, TotaisVendas>();
  for (const dia of dias)
    somas.set(dia.periodo, somar(somas.get(dia.periodo) ?? ZERO, dia.vendas));
  return [...somas].map(([indice, vendas]) =>
    emOrdem("periodos", {
      periodo: campanha.periodos[indice].nome,
      data_inicio: formatarDataCsv(calendario.periodos[indice].data_inicio),
      data_fim: formatarDataCsv(calendario.periodos[indice].data_fim),
      ...colunasDeVendas(vendas),
    }),
  );
}

/** Uma linha por dia, do 1º até hoje (ou o último dia). */
export function linhasDosDias(dados: DadosDoPainel): string[][] {
  const { campanha } = dados.entrada;
  return diasAteHoje(dados).dias.map((dia) =>
    emOrdem("dias", {
      data: formatarDataCsv(dia.data),
      dia_campanha: formatarInteiroCsv(dia.dia),
      periodo: campanha.periodos[dia.periodo].nome,
      ...colunasDeVendas(dia.vendas),
    }),
  );
}

// ---------------------------------------------------------------------------------------------------
// ddd
// ---------------------------------------------------------------------------------------------------

/**
 * Do mapa por DDD da campanha inteira, sem divisão (`montarMapaDdd`, o mesmo de `/api/painel/mapa-ddd?periodo=campanha`):
 * uma linha por DDD com venda, na ordem do mapa, e depois "Exterior" e "Sem DDD", sempre (mesmo zeradas), com a
 * coluna DDD vazia.
 */
export function linhasDoDdd(mapa: RespostaMapaDdd): string[][] {
  const linha = (
    uf: string,
    ddd: string,
    recorte: RespostaMapaDdd["total"],
  ): string[] =>
    emOrdem("ddd", {
      uf,
      ddd,
      ...colunasDeVendas(recorte),
      parte_bilhetes: formatarPercentualBpCsv(recorte.parte_bilhetes_bp),
    });
  return [
    ...mapa.ddds.map((item) => linha(item.uf, item.ddd, item)),
    linha(LINHA_EXTERIOR_RELATORIO, "", mapa.exterior),
    linha(LINHA_SEM_DDD_RELATORIO, "", mapa.sem_ddd),
  ];
}

// ---------------------------------------------------------------------------------------------------
// O arquivo
// ---------------------------------------------------------------------------------------------------

/**
 * O CSV de um tipo do painel e a data do nome do arquivo (hoje no fuso da campanha, a `referencia.data` do painel).
 * `extras` traz o que o tipo pede (os líderes em `celulas`, a contagem em `totais`); faltar é erro de programação.
 */
export function arquivoDoPainel(
  tipo: TipoDoPainel,
  dados: DadosDoPainel,
  extras: ExtrasDoRelatorio,
  montadores: MontadoresDoRelatorio = MONTADORES_DO_CONTRATO,
): ArquivoRelatorio {
  const { campanha } = dados.entrada;
  const linhas = {
    totais: () => [
      linhaDosTotais(
        dados,
        exigir(extras.desconsiderados, "a contagem dos desconsiderados"),
        montadores,
      ),
    ],
    celulas: () =>
      linhasDasCelulas(dados, exigir(extras.lideres, "os líderes"), montadores),
    discipuladores: () => linhasDosDiscipuladores(dados, montadores),
    redes: () => linhasDasRedes(dados, montadores),
    periodos: () => linhasDosPeriodos(dados),
    dias: () => linhasDosDias(dados),
  } satisfies Record<TipoDoPainel, () => string[][]>;
  return {
    csv: montarCsvRelatorio(
      cabecalhoDoRelatorio(
        tipo,
        campanha.meta.unidade,
        rankingPorDivisao(campanha),
      ),
      linhas[tipo](),
    ),
    data: hojeNoFuso(campanha.fuso_horario, dados.agora),
  };
}

/**
 * O CSV do `ddd`. O cabeçalho dele não tem meta: `cabecalhoDoRelatorio("ddd", unidade)` sai igual com qualquer
 * unidade (testado no contrato), então a unidade aqui é indiferente. A data do nome é o `hoje` de `lerMapaDdd`.
 */
export function arquivoDoDdd(mapa: RespostaMapaDdd): string {
  return montarCsvRelatorio(
    cabecalhoDoRelatorio("ddd", "bilhetes"),
    linhasDoDdd(mapa),
  );
}
