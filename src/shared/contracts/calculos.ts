// Regras de cálculo da campanha (RIFA-008): dia local e janela, metas, curva esperada, meta do dia,
// situação, projeção, fase/dia/período, agregação por nível, ranking, visão pública e texto do bumbo.
// Regras numeradas (R1 a R11), fontes e exemplos: docs/regras-de-calculo.md. Rotas: docs/api.md.
//
// Módulo puro (sem DOM, sem banco, sem relógio e sem zod), parte do contrato. O Worker lê as células
// e as vendas aprovadas agrupadas por célula e dia local e monta as respostas de /api/painel/* e
// /api/publico/* com as funções `montar*` daqui; o site pode usar as mesmas regras para explicar os
// números. "Agora" e a data de referência sempre chegam por parâmetro: mesma entrada, mesma saída.
//
// Exatidão (R11): metas, curva e esperados são frações exatas (BigInt) e só o resultado é
// arredondado. Alvos (meta, esperado, meta do dia) vão para CIMA, em unidades inteiras; percentuais
// vão para BAIXO, em pontos-base inteiros; a projeção vai para baixo. Com isso, para um realizado
// inteiro, "realizado ≥ alvo arredondado" vale exatamente quando "percentual ≥ 100%".
import type {
  ConsultaRanking,
  ConsultaRankingGrupos,
  ConsultaRankingPublico,
  EscopoPainel,
  ItemRanking,
  JanelaRanking,
  NivelRanking,
  ReferenciaCampanha,
  RespostaBumbo,
  RespostaPainelResumo,
  RespostaRanking,
  RespostaRankingGrupos,
  RespostaRankingPublico,
  Ritmo,
  SituacaoRitmo,
  TotaisVendas,
} from "./api";
import {
  calcularCalendario,
  diaDoCalendario,
  diasEntre,
  faseDaCampanha,
  hojeNoFuso,
  somarDias,
  type CalendarioCampanha,
} from "./calendario";
import type {
  CriterioRanking,
  Divisao,
  RegraMeta,
  UnidadeMeta,
} from "./dominio";

// ---------------------------------------------------------------------------------------------------
// Entrada dos cálculos
// ---------------------------------------------------------------------------------------------------

/** O que os cálculos usam da campanha (um `Campanha` do contrato serve). */
export type CampanhaCalculo = {
  nome: string;
  fuso_horario: string;
  data_inicio: string;
  meta: { unidade: UnidadeMeta; regra: RegraMeta; valor: number };
  periodos: readonly { nome: string; dias: number; percentual_bp: number }[];
  /** `por_divisao` ausente vale o padrão (separa por divisão: RANKING_POR_DIVISAO_PADRAO). */
  ranking: { criterio: CriterioRanking; por_divisao?: boolean };
  publico: { mostra_percentual_meta: boolean; limite_ranking: number | null };
};

/** Célula com a hierarquia resolvida (um `Celula` do contrato serve). */
export type CelulaCalculo = {
  id: number;
  nome: string;
  qtd_pessoas: number;
  discipulador_id: number;
  discipulador_nome: string;
  rede_id: number;
  rede_nome: string;
  divisao: Divisao;
};

/**
 * Vendas aprovadas de um dia local (no fuso da campanha), de uma célula ou sem célula
 * (`celula_id` null: sem afiliado ou afiliado não vinculado). Pode trazer dias fora da campanha:
 * os cálculos separam o que fica fora da janela (R6).
 */
export type VendasDoDia = {
  celula_id: number | null;
  dia: string;
  pedidos: number;
  bilhetes: number;
  centavos: number;
};

/** Tudo o que os montadores precisam: a campanha, TODAS as células e as vendas por célula e dia. */
export type EntradaCalculo = {
  campanha: CampanhaCalculo;
  celulas: readonly CelulaCalculo[];
  vendas: readonly VendasDoDia[];
};

/** Uma linha da view vendas_aprovadas, para quem agrupa no Worker (agruparVendasPorDia). */
export type VendaAprovada = {
  celula_id: number | null;
  aprovado_em: string;
  qtd_bilhetes: number;
  total_centavos: number;
};

export const NOMES_DIVISAO = {
  jovens: "Jovens",
  adultos: "Adultos",
} as const satisfies Record<Divisao, string>;

/** Ordem das divisões nos textos (a mesma de DIVISOES). */
export const ORDEM_DIVISOES = [
  "jovens",
  "adultos",
] as const satisfies readonly Divisao[];

/**
 * A campanha separa o ranking por divisão (RIFA-061, D27)? Sem a opção (uma campanha de antes dela), o padrão: sim
 * (RANKING_POR_DIVISAO_PADRAO de regras.ts; aqui escrito, para calculos.ts trazer valores só de calendario.ts).
 * Desligada, os rankings (`montarRankingPainel`, `montarRankingPublico`) ignoram a `divisao` da consulta e o bumbo
 * lista um ranking só, de todas as células.
 */
export function rankingPorDivisao(campanha: {
  ranking: { por_divisao?: boolean };
}): boolean {
  return campanha.ranking.por_divisao ?? true;
}

/**
 * A divisão que filtra o ranking: a da consulta, ou nenhuma (todas as células) quando a campanha não separa por
 * divisão. Com a marca que vai na resposta: `por_divisao: false` só nesse caso (ausente, a resposta fica como antes).
 */
function divisaoDoRanking(
  campanha: CampanhaCalculo,
  divisao: Divisao | undefined,
): { divisao: Divisao | undefined; marca: { por_divisao?: false } } {
  return rankingPorDivisao(campanha)
    ? { divisao, marca: {} }
    : { divisao: undefined, marca: { por_divisao: false } };
}

// ---------------------------------------------------------------------------------------------------
// Tipos das respostas, com nome, para as telas. O site importa regras e tipos daqui (módulo sem zod),
// nunca do index do contrato (docs/frontend.md). Os tipos de api.ts reexportados aqui são os mesmos.
// ---------------------------------------------------------------------------------------------------

export type {
  ConsultaBumbo,
  ConsultaPainelResumo,
  ConsultaRanking,
  ConsultaRankingGrupos,
  ConsultaRankingPublico,
  EscopoPainel,
  ItemRanking,
  JanelaRanking,
  NivelRanking,
  NivelRankingGrupos,
  ReferenciaCampanha,
  RespostaBumbo,
  RespostaPainelResumo,
  RespostaRanking,
  RespostaRankingGrupos,
  RespostaRankingPublico,
  Ritmo,
  SituacaoRitmo,
  TotaisVendas,
} from "./api";
export type { FaseCampanha } from "./calendario";
export type { CriterioRanking, Divisao, UnidadeMeta } from "./dominio";

/** Meta e venda de hoje no painel (`RespostaPainelResumo["hoje"]` sem o null). */
export type MetaDoDia = NonNullable<RespostaPainelResumo["hoje"]>;
/** Ritmo da campanha inteira, com a projeção (`RespostaPainelResumo["campanha"]`). */
export type RitmoCampanha = RespostaPainelResumo["campanha"];
/** Um dia da curva do gráfico (`RespostaPainelResumo["curva"][number]`). */
export type PontoCurva = RespostaPainelResumo["curva"][number];
/** Vendas antes do início e depois do fim (só no escopo campanha). */
export type VendasForaDaJanela = NonNullable<
  RespostaPainelResumo["vendas_fora_da_janela"]
>;
/** Período atual da referência (`ReferenciaCampanha["periodo"]` sem o null). */
export type PeriodoDaReferencia = NonNullable<ReferenciaCampanha["periodo"]>;
/**
 * A janela como sai na resposta dos rankings: tipo, ordem, nome e datas. Não confundir com
 * `JanelaRanking`, que é só o valor pedido na consulta ("atual" | "campanha") e vira o `tipo` daqui.
 */
export type JanelaRankingResposta = RespostaRanking["janela"];
/** Quem está logo acima ou logo abaixo de um item do ranking da coordenação. */
export type VizinhoRanking = NonNullable<ItemRanking["acima"]>;
/** Discipulador ou rede de um item do ranking: `{ id, nome }`. */
export type VinculoRanking = NonNullable<ItemRanking["rede"]>;
/** Um item do ranking público (sem valores). */
export type ItemRankingPublico = RespostaRankingPublico["itens"][number];
/** Um grupo do ranking por grupo da coordenação (RIFA-084, D39): id, nome, ordem e os itens, com a posição no grupo. */
export type GrupoRanking = RespostaRankingGrupos["grupos"][number];

// ---------------------------------------------------------------------------------------------------
// Frações exatas (R11)
// ---------------------------------------------------------------------------------------------------

/** Fração não negativa exata: num ÷ den, com den > 0. */
export type Fracao = { readonly num: bigint; readonly den: bigint };

const DEZ_MIL = 10_000n;
const ZERO: Fracao = { num: 0n, den: 1n };
const MAIOR_SEGURO = BigInt(Number.MAX_SAFE_INTEGER);

function inteiroNaoNegativo(valor: number, nome: string): bigint {
  if (!Number.isSafeInteger(valor) || valor < 0)
    throw new RangeError(
      `${nome} precisa ser um inteiro não negativo: ${valor}`,
    );
  return BigInt(valor);
}

function paraNumero(valor: bigint): number {
  if (valor > MAIOR_SEGURO || valor < -MAIOR_SEGURO)
    throw new RangeError(`Valor fora do limite seguro: ${valor}`);
  return Number(valor);
}

const fracao = (valor: number): Fracao => ({ num: BigInt(valor), den: 1n });
const piso = (valor: Fracao): bigint => valor.num / valor.den;
const teto = (valor: Fracao): bigint =>
  (valor.num + valor.den - 1n) / valor.den;
const vezes = (a: Fracao, b: Fracao): Fracao => ({
  num: a.num * b.num,
  den: a.den * b.den,
});
const menos = (a: Fracao, b: Fracao): Fracao => ({
  num: a.num * b.den - b.num * a.den,
  den: a.den * b.den,
});
const mais = (a: Fracao, b: Fracao): Fracao =>
  a.den === b.den
    ? { num: a.num + b.num, den: a.den }
    : { num: a.num * b.den + b.num * a.den, den: a.den * b.den };

/**
 * `parte ÷ todo` em pontos-base truncados; null quando o todo é zero. Exportada para a visão individual
 * (RIFA-014: a curva em pontos-base da meta exata, com a mesma conta de percentual_meta_bp).
 */
export function percentualBp(parte: Fracao, todo: Fracao): number | null {
  if (todo.num === 0n) return null;
  return paraNumero((parte.num * todo.den * DEZ_MIL) / (parte.den * todo.num));
}

const limitar = (valor: number, minimo: number, maximo: number): number =>
  Math.min(Math.max(valor, minimo), maximo);

// ---------------------------------------------------------------------------------------------------
// R6. Dia local e janela da campanha
// ---------------------------------------------------------------------------------------------------

const MS_POR_DIA = 86_400_000;
const MS_POR_QUINZE_MINUTOS = 900_000;
/** Instante com fuso explícito ("...Z" ou "...-03:00"): sem fuso, o Date usaria o do aparelho. */
const INSTANTE_COM_FUSO = /(?:Z|[+-]\d{2}:\d{2})$/;

const formatadoresDeFuso = new Map<string, Intl.DateTimeFormat>();

function formatadorDoFuso(fuso: string): Intl.DateTimeFormat {
  let formatador = formatadoresDeFuso.get(fuso);
  if (!formatador) {
    formatador = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatadoresDeFuso.set(fuso, formatador);
  }
  return formatador;
}

/** Relógio local (no fuso) de um instante, escrito como se fosse UTC, em milissegundos. */
function relogioLocal(fuso: string, instante: number): number {
  const partes = formatadorDoFuso(fuso).formatToParts(new Date(instante));
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((item) => item.type === tipo)?.value);
  const semMilissegundos = Date.UTC(
    parte("year"),
    parte("month") - 1,
    parte("day"),
    parte("hour"),
    parte("minute"),
    parte("second"),
  );
  return semMilissegundos + (((instante % 1000) + 1000) % 1000);
}

const dataDoRelogio = (relogio: number): string =>
  new Date(relogio).toISOString().slice(0, 10);

function milissegundos(instante: Date | string): number {
  if (typeof instante === "string" && !INSTANTE_COM_FUSO.test(instante))
    throw new RangeError(`Instante sem fuso: ${instante}`);
  const valor =
    instante instanceof Date ? instante.getTime() : Date.parse(instante);
  if (Number.isNaN(valor))
    throw new RangeError(`Instante inválido: ${String(instante)}`);
  return valor;
}

/**
 * Dia local ("YYYY-MM-DD") de um instante no fuso: 2026-11-23T02:59:59.999Z em Belém → 2026-11-22.
 * É a mesma regra de `hojeNoFuso` (calendario.ts), para a qual delega; aqui o instante também pode
 * ser o texto ISO do banco (com fuso explícito). Para "hoje no fuso da campanha", rotas e telas usam
 * `hojeNoFuso(campanha.fuso_horario, agora)`, que este módulo também exporta.
 */
export function diaLocalDoInstante(
  instante: Date | string,
  fuso: string,
): string {
  return hojeNoFuso(fuso, new Date(milissegundos(instante)));
}

/** "Hoje" no fuso: a função única (de calendario.ts), exportada também por aqui para o site. */
export { hojeNoFuso };

/** Primeiro instante do dia local (vale também para fusos com horário de verão à meia-noite). */
function inicioDoDia(data: string, fuso: string): number {
  const dia = diaDoCalendario(data);
  if (dia === null) throw new RangeError(`Data inválida: ${data}`);
  const meiaNoite = dia * MS_POR_DIA;
  const primeiro = meiaNoite - (relogioLocal(fuso, meiaNoite) - meiaNoite);
  const segundo = meiaNoite - (relogioLocal(fuso, primeiro) - primeiro);
  for (const candidato of [segundo, primeiro]) {
    if (
      dataDoRelogio(relogioLocal(fuso, candidato)) === data &&
      dataDoRelogio(relogioLocal(fuso, candidato - 1)) !== data
    )
      return candidato;
  }
  throw new RangeError(`Sem início do dia ${data} no fuso ${fuso}`);
}

/**
 * Intervalo UTC de um dia local, `[inicio, fim)`: em Belém (UTC−3 fixo), 2026-12-01 vai de
 * 2026-12-01T03:00:00.000Z a 2026-12-02T03:00:00.000Z (exclusivo).
 */
export function intervaloUtcDoDia(
  data: string,
  fuso: string,
): { inicio: string; fim: string } {
  return {
    inicio: new Date(inicioDoDia(data, fuso)).toISOString(),
    fim: new Date(inicioDoDia(somarDias(data, 1), fuso)).toISOString(),
  };
}

type CampanhaNoTempo = Pick<
  CampanhaCalculo,
  "fuso_horario" | "data_inicio" | "periodos"
>;

/**
 * Janela UTC em que uma venda conta (R6), `[inicio, fim)`: do início do primeiro dia local ao fim do
 * último. Serve para filtrar `aprovado_em` no banco (texto UTC: a ordem alfabética é a cronológica).
 */
export function janelaUtcDaCampanha(campanha: CampanhaNoTempo): {
  inicio: string;
  fim: string;
} {
  const { data_fim } = calcularCalendario(
    campanha.data_inicio,
    campanha.periodos,
  );
  return {
    inicio: intervaloUtcDoDia(campanha.data_inicio, campanha.fuso_horario)
      .inicio,
    fim: intervaloUtcDoDia(data_fim, campanha.fuso_horario).fim,
  };
}

/** R6: a venda conta se o dia local de `aprovado_em` está entre o primeiro e o último dia. */
export function vendaContaNaCampanha(
  aprovadoEm: string,
  campanha: CampanhaNoTempo,
): boolean {
  const dia = diaLocalDoInstante(aprovadoEm, campanha.fuso_horario);
  const { data_fim } = calcularCalendario(
    campanha.data_inicio,
    campanha.periodos,
  );
  return (
    diasEntre(campanha.data_inicio, dia) >= 0 && diasEntre(dia, data_fim) >= 0
  );
}

/**
 * Agrupa as vendas aprovadas por célula e dia local (a entrada dos montadores). Para muitas vendas,
 * consulta o fuso uma vez por bloco de 15 minutos (as mudanças de fuso caem em múltiplos de 15 min).
 * Ordem: por dia e, no dia, por célula (sem célula primeiro).
 */
export function agruparVendasPorDia(
  vendas: readonly VendaAprovada[],
  fuso: string,
): VendasDoDia[] {
  const deslocamentos = new Map<number, number>();
  const grupos = new Map<string, VendasDoDia>();
  for (const venda of vendas) {
    const instante = milissegundos(venda.aprovado_em);
    const bloco = Math.floor(instante / MS_POR_QUINZE_MINUTOS);
    let deslocamento = deslocamentos.get(bloco);
    if (deslocamento === undefined) {
      const inicioDoBloco = bloco * MS_POR_QUINZE_MINUTOS;
      deslocamento = relogioLocal(fuso, inicioDoBloco) - inicioDoBloco;
      deslocamentos.set(bloco, deslocamento);
    }
    const dia = dataDoRelogio(instante + deslocamento);
    const chave = `${venda.celula_id ?? "-"}|${dia}`;
    const grupo = grupos.get(chave) ?? {
      celula_id: venda.celula_id,
      dia,
      pedidos: 0,
      bilhetes: 0,
      centavos: 0,
    };
    grupo.pedidos += 1;
    grupo.bilhetes = somaSegura(
      grupo.bilhetes,
      venda.qtd_bilhetes,
      "qtd_bilhetes",
    );
    grupo.centavos = somaSegura(
      grupo.centavos,
      venda.total_centavos,
      "total_centavos",
    );
    grupos.set(chave, grupo);
  }
  return [...grupos.values()].sort(
    (a, b) =>
      a.dia.localeCompare(b.dia) || (a.celula_id ?? 0) - (b.celula_id ?? 0),
  );
}

function somaSegura(atual: number, parcela: number, nome: string): number {
  inteiroNaoNegativo(parcela, nome);
  const total = atual + parcela;
  if (!Number.isSafeInteger(total))
    throw new RangeError(`${nome}: soma fora do limite seguro`);
  return total;
}

// ---------------------------------------------------------------------------------------------------
// R7. Fase, dia e período
// ---------------------------------------------------------------------------------------------------

/**
 * Fase, dia da campanha e período numa data local. `dias_restantes` conta hoje (no último dia = 1);
 * `dias_para_inicio` só existe antes do início (na véspera = 1).
 */
export function referenciaDaCampanha(
  campanha: {
    data_inicio: string;
    periodos: readonly { nome: string; dias: number }[];
  },
  data: string,
): ReferenciaCampanha {
  const calendario = calcularCalendario(
    campanha.data_inicio,
    campanha.periodos,
  );
  const duracao = calendario.total_dias;
  const fase = faseDaCampanha(data, campanha.data_inicio, calendario.data_fim);
  const dia = diasEntre(campanha.data_inicio, data) + 1;
  let periodo: ReferenciaCampanha["periodo"] = null;
  if (fase === "durante") {
    const indice = indiceDoPeriodo(calendario, dia);
    const datas = calendario.periodos[indice];
    const { nome, dias } = campanha.periodos[indice];
    const diaNoPeriodo = diasEntre(datas.data_inicio, data) + 1;
    periodo = {
      ordem: indice + 1,
      nome,
      data_inicio: datas.data_inicio,
      data_fim: datas.data_fim,
      dias,
      dia_no_periodo: diaNoPeriodo,
      dias_restantes: dias - diaNoPeriodo + 1,
    };
  }
  return {
    data,
    fase,
    data_inicio: campanha.data_inicio,
    data_fim: calendario.data_fim,
    duracao_dias: duracao,
    dia_campanha: fase === "durante" ? dia : null,
    dias_restantes:
      fase === "antes" ? duracao : fase === "durante" ? duracao - dia + 1 : 0,
    dias_para_inicio: fase === "antes" ? 1 - dia : null,
    periodo,
  };
}

/** Índice (0…) do período que contém o dia da campanha `dia` (1…N); fora dela, o primeiro ou o último. */
function indiceDoPeriodo(calendario: CalendarioCampanha, dia: number): number {
  let ultimoDoPeriodo = 0;
  for (let indice = 0; indice < calendario.periodos.length; indice++) {
    const { data_inicio, data_fim } = calendario.periodos[indice];
    ultimoDoPeriodo += diasEntre(data_inicio, data_fim) + 1;
    if (dia <= ultimoDoPeriodo) return indice;
  }
  return calendario.periodos.length - 1;
}

// ---------------------------------------------------------------------------------------------------
// R1. Metas
// ---------------------------------------------------------------------------------------------------

/** Meta exata de uma instância, na unidade da meta. Não é arredondada no cálculo. */
export type MetaExata = Fracao;

/**
 * Meta exata de cada célula (por id), conforme a regra (REGRAS_META):
 * - por_pessoa: valor × qtd_pessoas;
 * - total_proporcional: valor × qtd_pessoas ÷ soma das pessoas de TODAS as células passadas;
 * - fixa_por_celula: valor, para todas (mesmo com 0 pessoas).
 * Célula com 0 pessoas fica sem meta nas duas regras por pessoa; sem nenhuma pessoa, todas ficam.
 */
export function metasDasCelulas(
  meta: { regra: RegraMeta; valor: number },
  celulas: readonly { id: number; qtd_pessoas: number }[],
): Map<number, MetaExata> {
  const valor = inteiroNaoNegativo(meta.valor, "meta.valor");
  const pessoas = celulas.map((celula) =>
    inteiroNaoNegativo(celula.qtd_pessoas, "qtd_pessoas"),
  );
  const totalPessoas = pessoas.reduce((soma, qtd) => soma + qtd, 0n);
  const metas = new Map<number, MetaExata>();
  celulas.forEach((celula, indice) => {
    if (metas.has(celula.id))
      throw new RangeError(`Célula repetida: ${celula.id}`);
    const qtd = pessoas[indice];
    switch (meta.regra) {
      case "por_pessoa":
        metas.set(celula.id, { num: valor * qtd, den: 1n });
        break;
      case "fixa_por_celula":
        metas.set(celula.id, { num: valor, den: 1n });
        break;
      case "total_proporcional":
        metas.set(
          celula.id,
          totalPessoas === 0n ? ZERO : { num: valor * qtd, den: totalPessoas },
        );
        break;
    }
  });
  return metas;
}

/** Meta de discipulador, rede, divisão ou campanha: a soma exata das metas das células abaixo. */
export function somarMetas(metas: Iterable<MetaExata>): MetaExata {
  let soma = ZERO;
  for (const meta of metas) soma = mais(soma, meta);
  return soma;
}

/** Meta para mostrar: para cima, em unidades inteiras. */
export function metaArredondada(meta: MetaExata): number {
  return paraNumero(teto(meta));
}

// ---------------------------------------------------------------------------------------------------
// R2. Curva esperada
// ---------------------------------------------------------------------------------------------------

/**
 * Fração da meta esperada ao fim de cada dia, F(0) … F(N): F(0) = 0 (antes do 1º dia) e F(N) = 1.
 * Períodos consecutivos, peso de cada um = percentual ÷ soma dos percentuais (normaliza 105%), e
 * linear dentro do período: F = (soma dos percentuais dos períodos encerrados + percentual do período
 * × dias decorridos ÷ dias do período) ÷ soma dos percentuais.
 */
export type CurvaEsperada = readonly Fracao[];

export function curvaEsperada(
  periodos: readonly { dias: number; percentual_bp: number }[],
): CurvaEsperada {
  const soma = periodos.reduce(
    (total, periodo) =>
      total + inteiroNaoNegativo(periodo.percentual_bp, "percentual_bp"),
    0n,
  );
  if (soma === 0n)
    throw new RangeError(
      "Pelo menos um período precisa ter percentual maior que zero",
    );
  const pontos: Fracao[] = [ZERO];
  let anteriores = 0n;
  for (const periodo of periodos) {
    const dias = inteiroNaoNegativo(periodo.dias, "dias");
    if (dias === 0n) throw new RangeError("Período sem dias");
    const percentual = BigInt(periodo.percentual_bp);
    for (let dia = 1n; dia <= dias; dia++)
      pontos.push({
        num: anteriores * dias + percentual * dia,
        den: soma * dias,
      });
    anteriores += percentual;
  }
  return pontos;
}

/** F(dia), com `dia` limitado a 0…N. */
function pontoDaCurva(curva: CurvaEsperada, dia: number): Fracao {
  return curva[limitar(dia, 0, curva.length - 1)];
}

/** Esperado acumulado ao fim do dia `dia` (0 = antes do 1º dia), para cima. */
export function esperadoAteODia(
  meta: MetaExata,
  curva: CurvaEsperada,
  dia: number,
): number {
  return paraNumero(teto(vezes(meta, pontoDaCurva(curva, dia))));
}

/** Onde a curva manda estar ao fim do dia `dia`, em pontos-base da meta (truncados). */
export function percentualEsperadoBp(
  curva: CurvaEsperada,
  dia: number,
): number {
  return paraNumero(piso(vezes(pontoDaCurva(curva, dia), fracao(10_000))));
}

// ---------------------------------------------------------------------------------------------------
// R3. Meta do dia; R4. Situação; R5. Projeção
// ---------------------------------------------------------------------------------------------------

/**
 * Meta do dia `dia` (1…N) = esperado até o fim do dia − realizado até o dia anterior, nunca negativa:
 * o que faltou entra na meta de hoje, e o que sobrou a reduz. `meta_base` é só a parte da curva.
 */
export function metaDoDia(
  meta: MetaExata,
  curva: CurvaEsperada,
  dia: number,
  realizadoAteOntem: number,
): { meta: number; meta_base: number } {
  const ateHoje = esperadoAteODia(meta, curva, dia);
  const ateOntem = esperadoAteODia(meta, curva, dia - 1);
  return {
    meta: Math.max(0, ateHoje - realizadoAteOntem),
    meta_base: ateHoje - ateOntem,
  };
}

/** Em dia quando o realizado cobre o esperado (até o fim de ontem); sem meta, não há o que cobrar. */
export function situacaoDoRitmo(
  metaDaJanela: MetaExata,
  realizado: number,
  esperado: number,
): SituacaoRitmo {
  if (metaDaJanela.num === 0n) return "sem_meta";
  return realizado >= esperado ? "em_dia" : "abaixo";
}

/**
 * Projeção do fim da campanha no ritmo dos dias fechados: realizado até ontem ÷ F(dias fechados).
 * Null antes do início e no 1º dia (nenhum dia fechado com esperado); depois do fim, é o resultado.
 */
export function projecaoDoFim(
  meta: MetaExata,
  curva: CurvaEsperada,
  diasFechados: number,
  realizadoAteOntem: number,
): { projecao: number | null; percentual_meta_bp: number | null } {
  const esperadoFracao = pontoDaCurva(curva, diasFechados);
  if (esperadoFracao.num === 0n)
    return { projecao: null, percentual_meta_bp: null };
  const realizado = fracao(realizadoAteOntem);
  return {
    projecao: paraNumero(
      piso({
        num: realizado.num * esperadoFracao.den,
        den: esperadoFracao.num,
      }),
    ),
    percentual_meta_bp: percentualBp(realizado, vezes(meta, esperadoFracao)),
  };
}

// ---------------------------------------------------------------------------------------------------
// R8. Ranking: empates dividem a posição e cada item conhece os vizinhos
// ---------------------------------------------------------------------------------------------------

export type ParticipanteRanking = {
  id: number | null;
  nome: string;
  /** Valor do critério (maior = melhor); null = sem meta no critério % da meta (vai para o fim). */
  chave: number | null;
};

export type VizinhoNoRanking<T extends ParticipanteRanking> = {
  item: T;
  posicao: number;
  /** Distância no critério (sempre ≥ 0); null se um dos dois não tem valor. */
  diferenca: number | null;
};

export type ColocacaoRanking<T extends ParticipanteRanking> = {
  item: T;
  posicao: number;
  /** Logo acima: o último da posição anterior (empatados não são vizinhos). */
  acima: VizinhoNoRanking<T> | null;
  /** Logo abaixo: o primeiro da posição seguinte. */
  abaixo: VizinhoNoRanking<T> | null;
};

/** Nomes em português: sem diferenciar acentos e maiúsculas, "Célula 2" antes de "Célula 10". */
const ordemDosNomes = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  numeric: true,
});

function compararParticipantes(
  a: ParticipanteRanking,
  b: ParticipanteRanking,
): number {
  if (a.chave !== b.chave) {
    if (a.chave === null) return 1;
    if (b.chave === null) return -1;
    return b.chave - a.chave;
  }
  return ordemDosNomes.compare(a.nome, b.nome) || (a.id ?? 0) - (b.id ?? 0);
}

/**
 * Ordena pelo critério (maior primeiro; sem meta no fim) e, no empate, pelo nome. Posição de
 * competição: 1 + quantos têm valor maior (1, 1, 3). Diferença até o vizinho na unidade do critério.
 */
export function classificarRanking<T extends ParticipanteRanking>(
  participantes: readonly T[],
): ColocacaoRanking<T>[] {
  const ordenados = [...participantes].sort(compararParticipantes);
  const inicioDoGrupo: number[] = [];
  ordenados.forEach((participante, indice) => {
    const empata =
      indice > 0 && ordenados[indice - 1].chave === participante.chave;
    inicioDoGrupo.push(empata ? inicioDoGrupo[indice - 1] : indice);
  });
  const fimDoGrupo = (indice: number) => {
    let fim = indice;
    while (
      fim + 1 < ordenados.length &&
      inicioDoGrupo[fim + 1] === inicioDoGrupo[indice]
    )
      fim++;
    return fim;
  };
  const distancia = (maior: T, menor: T) =>
    maior.chave === null || menor.chave === null
      ? null
      : maior.chave - menor.chave;
  return ordenados.map((item, indice) => {
    const anterior = inicioDoGrupo[indice] - 1;
    const seguinte = fimDoGrupo(indice) + 1;
    return {
      item,
      posicao: inicioDoGrupo[indice] + 1,
      acima:
        anterior >= 0
          ? {
              item: ordenados[anterior],
              posicao: inicioDoGrupo[anterior] + 1,
              diferenca: distancia(ordenados[anterior], item),
            }
          : null,
      abaixo:
        seguinte < ordenados.length
          ? {
              item: ordenados[seguinte],
              posicao: seguinte + 1,
              diferenca: distancia(item, ordenados[seguinte]),
            }
          : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Base comum dos montadores: calendário, curva, metas e vendas por dia da campanha
// ---------------------------------------------------------------------------------------------------

type Totais = { pedidos: number; bilhetes: number; centavos: number };
const totaisVazios = (): Totais => ({ pedidos: 0, bilhetes: 0, centavos: 0 });

function acumular(destino: Totais, parcela: Totais): void {
  destino.pedidos = somaSegura(destino.pedidos, parcela.pedidos, "pedidos");
  destino.bilhetes = somaSegura(destino.bilhetes, parcela.bilhetes, "bilhetes");
  destino.centavos = somaSegura(destino.centavos, parcela.centavos, "centavos");
}

const paraTotaisVendas = (totais: Totais): TotaisVendas => ({
  pedidos_aprovados: totais.pedidos,
  bilhetes: totais.bilhetes,
  total_centavos: totais.centavos,
});

type Base = {
  campanha: CampanhaCalculo;
  calendario: CalendarioCampanha;
  curva: CurvaEsperada;
  duracao: number;
  /** Dia da campanha da data de referência (pode ser ≤ 0 ou > duração). */
  dia: number;
  metas: Map<number, MetaExata>;
  /** Vendas por célula, indexadas pelo dia da campanha (1…N; a posição 0 fica vazia). */
  vendasPorCelula: Map<number, Totais[]>;
  vendasSemCelula: Totais[];
  antesDoInicio: Totais;
  depoisDoFim: Totais;
};

/** Até onde o retrato vai: dias fechados (entram no esperado) e último dia com vendas. */
type Corte = { fechados: number; ultimo: number };

/** Retrato na data de referência: vendas de dias depois dela ficam de fora (R6). */
function prepararBase(entrada: EntradaCalculo, data: string): Base {
  const { campanha, celulas } = entrada;
  const calendario = calcularCalendario(
    campanha.data_inicio,
    campanha.periodos,
  );
  const duracao = calendario.total_dias;
  const novaSerie = () => Array.from({ length: duracao + 1 }, totaisVazios);
  const vendasPorCelula = new Map(
    celulas.map((celula) => [celula.id, novaSerie()] as const),
  );
  const base: Base = {
    campanha,
    calendario,
    curva: curvaEsperada(campanha.periodos),
    duracao,
    dia: diasEntre(campanha.data_inicio, data) + 1,
    metas: metasDasCelulas(campanha.meta, celulas),
    vendasPorCelula,
    vendasSemCelula: novaSerie(),
    antesDoInicio: totaisVazios(),
    depoisDoFim: totaisVazios(),
  };
  for (const venda of entrada.vendas) {
    const totais = {
      pedidos: Number(inteiroNaoNegativo(venda.pedidos, "pedidos")),
      bilhetes: Number(inteiroNaoNegativo(venda.bilhetes, "bilhetes")),
      centavos: Number(inteiroNaoNegativo(venda.centavos, "centavos")),
    };
    if (diasEntre(data, venda.dia) > 0) continue;
    const dia = diasEntre(campanha.data_inicio, venda.dia) + 1;
    if (dia < 1) acumular(base.antesDoInicio, totais);
    else if (dia > duracao) acumular(base.depoisDoFim, totais);
    else {
      const serie =
        (venda.celula_id !== null && vendasPorCelula.get(venda.celula_id)) ||
        base.vendasSemCelula;
      acumular(serie[dia], totais);
    }
  }
  return base;
}

/** O retrato "agora": hoje conta no realizado, mas só os dias anteriores entram no esperado. */
function corteDoDia(base: Base): Corte {
  return {
    fechados: limitar(base.dia - 1, 0, base.duracao),
    ultimo: limitar(base.dia, 0, base.duracao),
  };
}

function somarDiasDaSerie(serie: Totais[], de: number, ate: number): Totais {
  const total = totaisVazios();
  for (let dia = Math.max(de, 1); dia <= ate; dia++)
    acumular(total, serie[dia]);
  return total;
}

const naUnidade = (totais: Totais, unidade: UnidadeMeta): number =>
  unidade === "bilhetes" ? totais.bilhetes : totais.centavos;

// ---------------------------------------------------------------------------------------------------
// Agregação por nível (R1, R8)
// ---------------------------------------------------------------------------------------------------

type Instancia = {
  id: number | null;
  nome: string;
  divisao: Divisao | null;
  discipulador: { id: number; nome: string } | null;
  rede: { id: number; nome: string } | null;
  meta: MetaExata;
  /** Vendas por dia da campanha (1…N). */
  vendas: Totais[];
};

function somarSeries(series: Totais[][], duracao: number): Totais[] {
  const soma = Array.from({ length: duracao + 1 }, totaisVazios);
  for (const serie of series)
    for (let dia = 1; dia <= duracao; dia++) acumular(soma[dia], serie[dia]);
  return soma;
}

function instanciaDasCelulas(
  base: Base,
  celulas: readonly CelulaCalculo[],
  dados: Omit<Instancia, "meta" | "vendas">,
  incluirSemCelula = false,
): Instancia {
  const series = celulas.map((celula) => base.vendasPorCelula.get(celula.id)!);
  if (incluirSemCelula) series.push(base.vendasSemCelula);
  return {
    ...dados,
    meta: somarMetas(celulas.map((celula) => base.metas.get(celula.id)!)),
    vendas: somarSeries(series, base.duracao),
  };
}

/** Instâncias de um nível (só as que têm células), com o filtro de divisão. */
function instanciasDoNivel(
  base: Base,
  celulas: readonly CelulaCalculo[],
  nivel: NivelRanking,
  divisao?: Divisao,
): Instancia[] {
  const grupos = new Map<number, CelulaCalculo[]>();
  for (const celula of celulas) {
    if (divisao !== undefined && celula.divisao !== divisao) continue;
    const chave =
      nivel === "celula"
        ? celula.id
        : nivel === "discipulador"
          ? celula.discipulador_id
          : celula.rede_id;
    const grupo = grupos.get(chave);
    if (grupo) grupo.push(celula);
    else grupos.set(chave, [celula]);
  }
  return [...grupos.entries()].map(([id, doGrupo]) => {
    const [primeira] = doGrupo;
    const rede = { id: primeira.rede_id, nome: primeira.rede_nome };
    const dados =
      nivel === "celula"
        ? {
            id,
            nome: primeira.nome,
            divisao: primeira.divisao,
            discipulador: {
              id: primeira.discipulador_id,
              nome: primeira.discipulador_nome,
            },
            rede,
          }
        : nivel === "discipulador"
          ? {
              id,
              nome: primeira.discipulador_nome,
              divisao: primeira.divisao,
              discipulador: null,
              rede,
            }
          : {
              id,
              nome: primeira.rede_nome,
              divisao: primeira.divisao,
              discipulador: null,
              rede: null,
            };
    return instanciaDasCelulas(base, doGrupo, dados);
  });
}

/** Escopo do painel já resolvido pela API (ela confere se o id existe e dá o nome). */
export type EscopoResolvido = RespostaPainelResumo["escopo"];

function celulasDoEscopo(
  celulas: readonly CelulaCalculo[],
  escopo: EscopoResolvido,
): readonly CelulaCalculo[] {
  const exigir = <T>(valor: T | null, nome: string): T => {
    if (valor === null)
      throw new RangeError(`Escopo ${escopo.tipo} sem ${nome}`);
    return valor;
  };
  const filtros: Record<EscopoPainel, (celula: CelulaCalculo) => boolean> = {
    campanha: () => true,
    divisao: (celula) => celula.divisao === exigir(escopo.divisao, "divisão"),
    rede: (celula) => celula.rede_id === exigir(escopo.id, "id"),
    discipulador: (celula) =>
      celula.discipulador_id === exigir(escopo.id, "id"),
    celula: (celula) => celula.id === exigir(escopo.id, "id"),
  };
  return celulas.filter(filtros[escopo.tipo]);
}

// ---------------------------------------------------------------------------------------------------
// Janelas: campanha inteira ou um período
// ---------------------------------------------------------------------------------------------------

type Janela = {
  ordem: number | null;
  nome: string;
  /** Primeiro e último dia da campanha da janela (1…N). */
  primeiro: number;
  ultimo: number;
  data_inicio: string;
  data_fim: string;
};

const NOME_JANELA_CAMPANHA = "Campanha inteira";

function janelaDaCampanha(base: Base): Janela {
  return {
    ordem: null,
    nome: NOME_JANELA_CAMPANHA,
    primeiro: 1,
    ultimo: base.duracao,
    data_inicio: base.campanha.data_inicio,
    data_fim: base.calendario.data_fim,
  };
}

/** Janela do período de índice `indice` (0…). */
function janelaDoPeriodo(base: Base, indice: number): Janela {
  const datas = base.calendario.periodos[indice];
  const primeiro = diasEntre(base.campanha.data_inicio, datas.data_inicio) + 1;
  return {
    ordem: indice + 1,
    nome: base.campanha.periodos[indice].nome,
    primeiro,
    ultimo: primeiro + base.campanha.periodos[indice].dias - 1,
    data_inicio: datas.data_inicio,
    data_fim: datas.data_fim,
  };
}

/** O ritmo como sai na resposta e, à parte, a meta exata e os totais da janela. */
type RitmoCalculado = { ritmo: Ritmo; metaExata: MetaExata; totais: Totais };

/** R2/R4: meta, esperado (até o fim do último dia fechado), realizado e situação numa janela. */
function ritmoNaJanela(
  base: Base,
  instancia: Instancia,
  janela: Janela,
  corte: Corte,
): RitmoCalculado {
  const unidade = base.campanha.meta.unidade;
  const antes = pontoDaCurva(base.curva, janela.primeiro - 1);
  const pesoDaJanela = menos(pontoDaCurva(base.curva, janela.ultimo), antes);
  const metaExata = vezes(instancia.meta, pesoDaJanela);
  const fechadoAte = Math.min(corte.fechados, janela.ultimo);
  const esperadoExato =
    fechadoAte < janela.primeiro
      ? ZERO
      : vezes(
          instancia.meta,
          menos(pontoDaCurva(base.curva, fechadoAte), antes),
        );
  const totais = somarDiasDaSerie(
    instancia.vendas,
    janela.primeiro,
    Math.min(corte.ultimo, janela.ultimo),
  );
  const realizado = naUnidade(totais, unidade);
  const realizadoAteOntem = naUnidade(
    somarDiasDaSerie(instancia.vendas, janela.primeiro, fechadoAte),
    unidade,
  );
  const esperado = paraNumero(teto(esperadoExato));
  return {
    ritmo: {
      meta: paraNumero(teto(metaExata)),
      esperado,
      realizado,
      realizado_ate_ontem: realizadoAteOntem,
      diferenca: realizado - esperado,
      situacao: situacaoDoRitmo(metaExata, realizado, esperado),
      percentual_meta_bp: percentualBp(fracao(realizado), metaExata),
      percentual_esperado_bp: percentualBp(esperadoExato, metaExata),
      ritmo_bp: percentualBp(fracao(realizadoAteOntem), esperadoExato),
    },
    metaExata,
    totais,
  };
}

/** Índice do período da janela "atual": o que contém o dia; antes do início, o 1º; depois, o último. */
const indiceDaJanelaAtual = (base: Base, dia: number): number =>
  indiceDoPeriodo(base.calendario, limitar(dia, 1, base.duracao));

function chaveDoCriterio(
  criterio: CriterioRanking,
  ritmo: RitmoCalculado,
): number | null {
  switch (criterio) {
    case "percentual_meta":
      return ritmo.ritmo.percentual_meta_bp;
    case "bilhetes":
      return ritmo.totais.bilhetes;
    case "arrecadacao":
      return ritmo.totais.centavos;
  }
}

type LinhaRanking = ParticipanteRanking & {
  instancia: Instancia;
  calculo: RitmoCalculado;
};

function linhasDoRanking(
  base: Base,
  celulas: readonly CelulaCalculo[],
  nivel: NivelRanking,
  divisao: Divisao | undefined,
  janela: Janela,
  corte: Corte,
): ColocacaoRanking<LinhaRanking>[] {
  const linhas = instanciasDoNivel(base, celulas, nivel, divisao).map(
    (instancia): LinhaRanking => {
      const calculo = ritmoNaJanela(base, instancia, janela, corte);
      return {
        id: instancia.id,
        nome: instancia.nome,
        chave: chaveDoCriterio(base.campanha.ranking.criterio, calculo),
        instancia,
        calculo,
      };
    },
  );
  return classificarRanking(linhas);
}

function janelaDaConsulta(
  base: Base,
  periodo: JanelaRanking,
  dia: number,
): { janela: Janela; resposta: RespostaRanking["janela"] } {
  const janela =
    periodo === "campanha"
      ? janelaDaCampanha(base)
      : janelaDoPeriodo(base, indiceDaJanelaAtual(base, dia));
  return {
    janela,
    resposta: {
      tipo: periodo,
      ordem: janela.ordem,
      nome: janela.nome,
      data_inicio: janela.data_inicio,
      data_fim: janela.data_fim,
    },
  };
}

const dataDaConsulta = (
  campanha: CampanhaCalculo,
  agora: Date,
  data: string | undefined,
): string => data ?? diaLocalDoInstante(agora, campanha.fuso_horario);

function obrigatorio<T>(valor: T | null, nome: string): T {
  if (valor === null) throw new RangeError(`${nome} ausente`);
  return valor;
}

// ---------------------------------------------------------------------------------------------------
// GET /api/painel/resumo
// ---------------------------------------------------------------------------------------------------

/**
 * Resumo do painel de um escopo na data de referência (padrão: hoje no fuso da campanha). Na
 * campanha, o realizado inclui as vendas sem célula; nos outros escopos, só as atribuídas.
 */
export function montarResumoPainel(
  entrada: EntradaCalculo,
  consulta: { escopo: EscopoResolvido; data?: string },
  agora: Date,
): RespostaPainelResumo {
  const { campanha } = entrada;
  const data = dataDaConsulta(campanha, agora, consulta.data);
  const base = prepararBase(entrada, data);
  const corte = corteDoDia(base);
  const referencia = referenciaDaCampanha(campanha, data);
  const unidade = campanha.meta.unidade;
  const ehCampanha = consulta.escopo.tipo === "campanha";
  const { escopo } = consulta;
  const instancia = instanciaDasCelulas(
    base,
    celulasDoEscopo(entrada.celulas, escopo),
    {
      id: escopo.id,
      nome: escopo.nome,
      divisao: escopo.divisao,
      discipulador: null,
      rede: null,
    },
    ehCampanha,
  );

  const campanhaInteira = ritmoNaJanela(
    base,
    instancia,
    janelaDaCampanha(base),
    corte,
  );
  const projecao = projecaoDoFim(
    instancia.meta,
    base.curva,
    corte.fechados,
    campanhaInteira.ritmo.realizado_ate_ontem,
  );

  const durante = referencia.fase === "durante";
  let hoje: RespostaPainelResumo["hoje"] = null;
  if (durante) {
    const realizadoAteOntem = campanhaInteira.ritmo.realizado_ate_ontem;
    const doDia = metaDoDia(
      instancia.meta,
      base.curva,
      base.dia,
      realizadoAteOntem,
    );
    const realizado = naUnidade(instancia.vendas[base.dia], unidade);
    hoje = {
      data,
      meta: doDia.meta,
      meta_base: doDia.meta_base,
      realizado,
      falta: Math.max(0, doDia.meta - realizado),
      percentual_meta_bp: percentualBp(fracao(realizado), fracao(doDia.meta)),
      batida: realizado >= doDia.meta,
    };
  }

  let acumulado = 0;
  const curva = Array.from({ length: base.duracao }, (_, indice) => {
    const dia = indice + 1;
    const noDia =
      dia <= corte.ultimo ? naUnidade(instancia.vendas[dia], unidade) : null;
    if (noDia !== null) acumulado += noDia;
    return {
      dia,
      data: somarDias(campanha.data_inicio, indice),
      esperado: esperadoAteODia(instancia.meta, base.curva, dia),
      realizado: noDia === null ? null : acumulado,
      realizado_no_dia: noDia,
    };
  });

  return {
    escopo: {
      tipo: escopo.tipo,
      id: escopo.id,
      divisao: escopo.divisao,
      nome: escopo.nome,
    },
    referencia,
    unidade,
    hoje,
    periodo: durante
      ? ritmoNaJanela(
          base,
          instancia,
          janelaDoPeriodo(base, indiceDaJanelaAtual(base, base.dia)),
          corte,
        ).ritmo
      : null,
    campanha: {
      ...campanhaInteira.ritmo,
      projecao: projecao.projecao,
      projecao_percentual_meta_bp: projecao.percentual_meta_bp,
    },
    curva,
    vendas: paraTotaisVendas(campanhaInteira.totais),
    vendas_sem_celula: ehCampanha
      ? paraTotaisVendas(
          somarDiasDaSerie(base.vendasSemCelula, 1, corte.ultimo),
        )
      : null,
    vendas_fora_da_janela: ehCampanha
      ? {
          antes_do_inicio: paraTotaisVendas(base.antesDoInicio),
          depois_do_fim: paraTotaisVendas(base.depoisDoFim),
        }
      : null,
    atualizado_em: agora.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------
// GET /api/painel/ranking e GET /api/publico/ranking
// ---------------------------------------------------------------------------------------------------

/** Ranking da coordenação: todas as instâncias do nível, com valores, situação e vizinhos. */
export function montarRankingPainel(
  entrada: EntradaCalculo,
  consulta: ConsultaRanking,
  agora: Date,
): RespostaRanking {
  const { campanha } = entrada;
  const data = dataDaConsulta(campanha, agora, consulta.data);
  const base = prepararBase(entrada, data);
  const { janela, resposta } = janelaDaConsulta(
    base,
    consulta.periodo,
    base.dia,
  );
  const { divisao, marca } = divisaoDoRanking(campanha, consulta.divisao);
  const linhas = linhasDoRanking(
    base,
    entrada.celulas,
    consulta.nivel,
    divisao,
    janela,
    corteDoDia(base),
  );
  return {
    nivel: consulta.nivel,
    divisao: divisao ?? null,
    ...marca,
    janela: resposta,
    criterio: campanha.ranking.criterio,
    unidade: campanha.meta.unidade,
    referencia: referenciaDaCampanha(campanha, data),
    itens: linhas.map(itemDoRankingPainel),
    atualizado_em: agora.toISOString(),
  };
}

const vizinhoNoPainel = (colocacao: VizinhoNoRanking<LinhaRanking> | null) =>
  colocacao && {
    id: obrigatorio(colocacao.item.id, "id"),
    nome: colocacao.item.nome,
    posicao: colocacao.posicao,
    diferenca: colocacao.diferenca,
  };

/** Um item do ranking da coordenação: valores, situação e os vizinhos (os da mesma lista). */
function itemDoRankingPainel({
  item,
  posicao,
  acima,
  abaixo,
}: ColocacaoRanking<LinhaRanking>): ItemRanking {
  return {
    posicao,
    id: obrigatorio(item.instancia.id, "id"),
    nome: item.nome,
    divisao: obrigatorio(item.instancia.divisao, "divisão"),
    discipulador: item.instancia.discipulador,
    rede: item.instancia.rede,
    meta: item.calculo.ritmo.meta,
    esperado: item.calculo.ritmo.esperado,
    realizado: item.calculo.ritmo.realizado,
    diferenca: item.calculo.ritmo.diferenca,
    situacao: item.calculo.ritmo.situacao,
    percentual_meta_bp: item.calculo.ritmo.percentual_meta_bp,
    vendas: paraTotaisVendas(item.calculo.totais),
    acima: vizinhoNoPainel(acima),
    abaixo: vizinhoNoPainel(abaixo),
  };
}

/** R9: só quem já vendeu na janela, até o limite configurado (empates no limite entram todos). */
function visiveisNoPublico(
  linhas: ColocacaoRanking<LinhaRanking>[],
  limite: number | null,
): ColocacaoRanking<LinhaRanking>[] {
  return linhas.filter(
    (linha) =>
      linha.item.calculo.totais.pedidos > 0 &&
      (limite === null || linha.posicao <= limite),
  );
}

/**
 * Ranking público (R9): só posição, nome e divisão, e o % da meta se a campanha permitir. Nunca há
 * valores em R$, bilhetes, metas nem realizado. Sempre na data de hoje (sem `data`).
 */
export function montarRankingPublico(
  entrada: EntradaCalculo,
  consulta: ConsultaRankingPublico,
  agora: Date,
): RespostaRankingPublico {
  const { campanha } = entrada;
  const data = diaLocalDoInstante(agora, campanha.fuso_horario);
  const base = prepararBase(entrada, data);
  const { janela, resposta } = janelaDaConsulta(
    base,
    consulta.periodo,
    base.dia,
  );
  const { divisao, marca } = divisaoDoRanking(campanha, consulta.divisao);
  const linhas = linhasDoRanking(
    base,
    entrada.celulas,
    consulta.nivel,
    divisao,
    janela,
    corteDoDia(base),
  );
  return {
    nivel: consulta.nivel,
    divisao: divisao ?? null,
    ...marca,
    janela: resposta,
    criterio: campanha.ranking.criterio,
    referencia: referenciaDaCampanha(campanha, data),
    itens: visiveisNoPublico(linhas, campanha.publico.limite_ranking).map(
      (colocacao) => itemDoRankingPublico(campanha, colocacao),
    ),
    atualizado_em: agora.toISOString(),
  };
}

/** Um item do ranking aberto: posição, nome e divisão, e o % da meta só se a campanha permitir (R9). */
function itemDoRankingPublico(
  campanha: CampanhaCalculo,
  { item, posicao }: ColocacaoRanking<LinhaRanking>,
): ItemRankingPublico {
  const percentual = item.calculo.ritmo.percentual_meta_bp;
  return {
    posicao,
    nome: item.nome,
    divisao: obrigatorio(item.instancia.divisao, "divisão"),
    ...(campanha.publico.mostra_percentual_meta && percentual !== null
      ? { percentual_meta_bp: percentual }
      : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// GET /api/painel/ranking-grupos (RIFA-084, D39): só a coordenação
// ---------------------------------------------------------------------------------------------------

/**
 * Um grupo do discipulador e os discipuladores dele (o Worker lê de `discipuladores.grupo_id`). As células herdam o
 * grupo do discipulador; um discipulador sem grupo fica fora de todos (e continua no ranking de todas).
 */
export type GrupoCalculo = {
  id: number;
  nome: string;
  ordem: number;
  discipuladores: readonly number[];
};

/** Os grupos que têm células, na ordem da tela (`ordem`; empate, o nome em português e o id), com as células. */
function gruposComCelulas(
  celulas: readonly CelulaCalculo[],
  grupos: readonly GrupoCalculo[],
): { grupo: GrupoCalculo; celulas: CelulaCalculo[] }[] {
  const ordenados = [...grupos].sort(
    (a, b) =>
      a.ordem - b.ordem || ordemDosNomes.compare(a.nome, b.nome) || a.id - b.id,
  );
  return ordenados.flatMap((grupo) => {
    const doGrupo = new Set(grupo.discipuladores);
    const suas = celulas.filter((celula) =>
      doGrupo.has(celula.discipulador_id),
    );
    return suas.length === 0 ? [] : [{ grupo, celulas: suas }];
  });
}

/**
 * O ranking de cada grupo, na data de hoje: o mesmo critério, a mesma janela, as mesmas metas (a meta de cada célula é
 * a do ranking de todas: a proporcional reparte o total entre TODAS as células) e a posição DENTRO do grupo. A divisão
 * não entra (o grupo é outro recorte, D39).
 */
function rankingsDosGrupos(
  entrada: EntradaCalculo,
  grupos: readonly GrupoCalculo[],
  nivel: NivelRanking,
  periodo: JanelaRanking,
  agora: Date,
) {
  const { campanha } = entrada;
  const data = diaLocalDoInstante(agora, campanha.fuso_horario);
  const base = prepararBase(entrada, data);
  const { janela, resposta } = janelaDaConsulta(base, periodo, base.dia);
  const corte = corteDoDia(base);
  return {
    data,
    janela: resposta,
    grupos: gruposComCelulas(entrada.celulas, grupos).map(
      ({ grupo, celulas }) => ({
        grupo: { id: grupo.id, nome: grupo.nome, ordem: grupo.ordem },
        linhas: linhasDoRanking(base, celulas, nivel, undefined, janela, corte),
      }),
    ),
  };
}

/** Ranking por grupo da coordenação: o item completo do ranking (valores, situação e vizinhos dentro do grupo). */
export function montarRankingGruposPainel(
  entrada: EntradaCalculo,
  grupos: readonly GrupoCalculo[],
  consulta: ConsultaRankingGrupos,
  agora: Date,
): RespostaRankingGrupos {
  const { campanha } = entrada;
  const calculado = rankingsDosGrupos(
    entrada,
    grupos,
    consulta.nivel,
    consulta.janela,
    agora,
  );
  return {
    nivel: consulta.nivel,
    janela: calculado.janela,
    criterio: campanha.ranking.criterio,
    unidade: campanha.meta.unidade,
    referencia: referenciaDaCampanha(campanha, calculado.data),
    grupos: calculado.grupos.map(({ grupo, linhas }) => ({
      ...grupo,
      itens: linhas.map(itemDoRankingPainel),
    })),
    atualizado_em: agora.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------
// R10. Bumbo do dia: texto para o grupo dos líderes, sem R$ nem quantidade de bilhetes (R9)
// ---------------------------------------------------------------------------------------------------

/**
 * Opções do bumbo. `mostrar_bilhetes` é reservado para um futuro bumbo INTERNO da coordenação
 * (pendência em docs/regras-de-calculo.md): o bumbo de `montarBumbo` é público e nunca mostra
 * quantidade de bilhetes nem R$ (R9), com qualquer valor desta opção.
 */
export type OpcoesBumbo = {
  mostrar_bilhetes: boolean;
};

/** Opções padrão (mantidas por compatibilidade: `montarBumbo` as aceita e ignora). */
export const BUMBO_PADRAO: Readonly<OpcoesBumbo> = Object.freeze({
  mostrar_bilhetes: false,
});

/**
 * Posições de cada ranking de divisão no bumbo (menos, se `publico.limite_ranking` for menor) e
 * quantas células "que mais subiram" ele cita.
 */
export const POSICOES_NO_BUMBO = 3;

/**
 * Máximo de células listadas por divisão no bumbo. Empatadas além disso viram uma linha
 * "e mais N empatadas no Pº lugar": com isso o texto cabe sempre no limite de 4000 caracteres da
 * resposta, mesmo com dezenas de células empatadas e nomes de 120 caracteres (SUPOSIÇÃO S22).
 */
export const NOMES_POR_DIVISAO_NO_BUMBO = 5;

const formatoInteiro = new Intl.NumberFormat("pt-BR");
const textoPercentual = (bp: number) =>
  `${formatoInteiro.format(Math.floor(bp / 100))}%`;
const textoDias = (dias: number) =>
  dias === 1 ? "1 dia" : `${formatoInteiro.format(dias)} dias`;
const dataCurta = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;

function juntarNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Chamada final do bumbo: o link da Rifei do líder é o "link de afiliado", como no site (RIFA-040). */
const CHAMADA_LINK =
  "compartilhe hoje o seu link de afiliado com quem é de fora da igreja!";

/**
 * Monta o bumbo do dia `data` (padrão: hoje), que fala do dia anterior já fechado: venda de ontem
 * (% da meta do dia), acumulado contra a curva e projeção, as primeiras posições do ranking do
 * período (por divisão), as células que mais subiram ontem e uma chamada final. Antes do início,
 * no 1º dia e depois do fim, o texto muda (contagem regressiva, largada e resultado final).
 *
 * É público: nunca há R$, centavos nem quantidade de bilhetes no texto (R9). O 4º argumento
 * (`OpcoesBumbo`) continua aceito por compatibilidade e é ignorado.
 */
export function montarBumbo(
  entrada: EntradaCalculo,
  consulta: { data?: string },
  agora: Date,
  opcoes?: OpcoesBumbo,
): RespostaBumbo;
export function montarBumbo(
  entrada: EntradaCalculo,
  consulta: { data?: string },
  agora: Date,
): RespostaBumbo {
  const { campanha } = entrada;
  const data = dataDaConsulta(campanha, agora, consulta.data);
  const referencia = referenciaDaCampanha(campanha, data);
  return {
    data,
    referencia,
    texto: textoDoBumbo(entrada, data, referencia),
    gerado_em: agora.toISOString(),
  };
}

function textoDoBumbo(
  entrada: EntradaCalculo,
  data: string,
  referencia: ReferenciaCampanha,
): string {
  const { campanha } = entrada;
  const duracao = referencia.duracao_dias;
  const dia = diasEntre(campanha.data_inicio, data) + 1;
  const linhas: string[] = [];

  if (dia <= 0) {
    const faltam = 1 - dia;
    linhas.push(
      `*${campanha.nome}*`,
      "",
      `${faltam === 1 ? "Falta" : "Faltam"} ${textoDias(faltam)} para começar: as vendas vão de ${dataCurta(referencia.data_inicio)} a ${dataCurta(referencia.data_fim)}.`,
      "Confira se o seu link de afiliado está pronto para compartilhar!",
    );
    return linhas.join("\n");
  }
  if (dia === 1) {
    linhas.push(
      `*${campanha.nome} · Dia 1 de ${duracao}*`,
      "",
      `Começou! As vendas vão até ${dataCurta(referencia.data_fim)}.`,
      `Bora: ${CHAMADA_LINK}`,
    );
    return linhas.join("\n");
  }

  // Retrato no fim de ontem: só dias fechados (o de hoje fica de fora).
  const ontem = Math.min(dia - 1, duracao);
  const base = prepararBase(entrada, somarDias(data, -1));
  const corte: Corte = { fechados: ontem, ultimo: ontem };
  const unidade = campanha.meta.unidade;
  const encerrada = dia > duracao;
  const mostraPercentualCelulas = campanha.publico.mostra_percentual_meta;
  const instancia = instanciaDasCelulas(
    base,
    entrada.celulas,
    {
      id: null,
      nome: campanha.nome,
      divisao: null,
      discipulador: null,
      rede: null,
    },
    true,
  );
  const { ritmo: acumulado } = ritmoNaJanela(
    base,
    instancia,
    janelaDaCampanha(base),
    corte,
  );
  const projecao = projecaoDoFim(
    instancia.meta,
    base.curva,
    ontem,
    acumulado.realizado_ate_ontem,
  );

  linhas.push(
    encerrada
      ? `*${campanha.nome} · Campanha encerrada*`
      : `*${campanha.nome} · Dia ${dia} de ${duracao}*`,
    "",
  );

  // Venda de ontem, em % da meta do dia de ontem.
  if (dia - 1 <= duracao) {
    const realizadoAteAnteontem = naUnidade(
      somarDiasDaSerie(instancia.vendas, 1, dia - 2),
      unidade,
    );
    const metaDeOntem = metaDoDia(
      instancia.meta,
      base.curva,
      dia - 1,
      realizadoAteAnteontem,
    ).meta;
    const vendasDeOntem = instancia.vendas[dia - 1];
    const rotulo = encerrada
      ? `*Último dia (dia ${dia - 1}):*`
      : `*Ontem (dia ${dia - 1}):*`;
    const percentual = percentualBp(
      fracao(naUnidade(vendasDeOntem, unidade)),
      fracao(metaDeOntem),
    );
    linhas.push(
      percentual === null
        ? `${rotulo} a meta do dia já estava coberta.`
        : `${rotulo} vendemos ${textoPercentual(percentual)} da meta do dia.`,
    );
  }

  // Acumulado contra a curva e projeção (só com meta).
  if (acumulado.percentual_meta_bp !== null) {
    if (encerrada) {
      linhas.push(
        `*Resultado final:* ${textoPercentual(acumulado.percentual_meta_bp)} da meta.`,
      );
    } else {
      linhas.push(
        `*Acumulado:* ${textoPercentual(acumulado.percentual_meta_bp)} da meta. Pela curva, o esperado até ontem era ${textoPercentual(acumulado.percentual_esperado_bp ?? 0)}.`,
      );
      if (projecao.percentual_meta_bp !== null)
        linhas.push(
          `${acumulado.situacao === "em_dia" ? "Estamos em dia" : "Estamos abaixo da curva"}: no ritmo atual, chegamos a ${textoPercentual(projecao.percentual_meta_bp)} da meta.`,
        );
    }
  }

  // Primeiras posições: ranking do período de ontem (ou da campanha, no fim), por divisão; sem ranking por divisão
  // (D27), um ranking só, de todas as células, sem título (como quando só uma divisão tem células).
  const janela = encerrada
    ? janelaDaCampanha(base)
    : janelaDoPeriodo(base, indiceDaJanelaAtual(base, ontem));
  const divisoes: readonly (Divisao | undefined)[] = rankingPorDivisao(campanha)
    ? ORDEM_DIVISOES.filter((divisao) =>
        entrada.celulas.some((celula) => celula.divisao === divisao),
      )
    : entrada.celulas.length > 0
      ? [undefined]
      : [];
  if (divisoes.length > 0) {
    const periodoFechou = janela.ultimo === ontem;
    // Nunca mais posições que a visão pública permite.
    const posicoes = Math.min(
      POSICOES_NO_BUMBO,
      campanha.publico.limite_ranking ?? POSICOES_NO_BUMBO,
    );
    linhas.push(
      "",
      encerrada
        ? "*Ranking final da campanha*"
        : `*Ranking · ${janela.nome} (${periodoFechou ? "resultado final" : "até ontem"})*`,
    );
    for (const divisao of divisoes) {
      const visiveis = visiveisNoPublico(
        linhasDoRanking(
          base,
          entrada.celulas,
          "celula",
          divisao,
          janela,
          corte,
        ),
        posicoes,
      );
      const titulo =
        divisao !== undefined && divisoes.length > 1
          ? `_${NOMES_DIVISAO[divisao]}_`
          : "";
      if (visiveis.length === 0) {
        linhas.push(
          titulo ? `${titulo}: ainda sem vendas.` : "Ainda sem vendas.",
        );
        continue;
      }
      if (titulo) linhas.push(titulo);
      const listadas = visiveis.slice(0, NOMES_POR_DIVISAO_NO_BUMBO);
      for (const { item, posicao } of listadas) {
        const percentual = item.calculo.ritmo.percentual_meta_bp;
        linhas.push(
          `${posicao}º ${item.nome}${mostraPercentualCelulas && percentual !== null ? ` · ${textoPercentual(percentual)}` : ""}`,
        );
      }
      // Com no máximo 3 posições, as que sobram estão todas empatadas na última posição listada.
      const sobra = visiveis.slice(listadas.length);
      if (sobra.length > 0) {
        const posicoesDaSobra = new Set(sobra.map((linha) => linha.posicao));
        const [posicao] = posicoesDaSobra;
        linhas.push(
          posicoesDaSobra.size === 1
            ? `e mais ${sobra.length} ${sobra.length === 1 ? "empatada" : "empatadas"} no ${posicao}º lugar`
            : `e mais ${sobra.length}`,
        );
      }
    }
  }

  // As células que mais subiram ontem: maior avanço em % da própria meta.
  if (!encerrada) {
    const subiram = entrada.celulas
      .map((celula) => {
        const vendas = base.vendasPorCelula.get(celula.id)![ontem];
        return {
          celula,
          avanco: percentualBp(
            fracao(naUnidade(vendas, unidade)),
            base.metas.get(celula.id)!,
          ),
        };
      })
      .filter(
        (item): item is { celula: CelulaCalculo; avanco: number } =>
          item.avanco !== null && item.avanco > 0,
      )
      .sort(
        (a, b) =>
          b.avanco - a.avanco ||
          ordemDosNomes.compare(a.celula.nome, b.celula.nome) ||
          a.celula.id - b.celula.id,
      )
      .slice(0, POSICOES_NO_BUMBO)
      .map(({ celula, avanco }) =>
        mostraPercentualCelulas && avanco >= 100
          ? `${celula.nome} (+${textoPercentual(avanco)})`
          : celula.nome,
      );
    if (subiram.length > 0)
      linhas.push("", `*Quem mais subiu ontem:* ${juntarNomes(subiram)}.`);
  }

  // Chamada final.
  linhas.push("");
  if (encerrada) linhas.push("Obrigado a todas as células pelo empenho!");
  else if (dia === duracao)
    linhas.push(`*Hoje é o último dia!* Bora: ${CHAMADA_LINK}`);
  else {
    const faltam = textoDias(duracao - dia + 1);
    linhas.push(
      acumulado.situacao === "abaixo"
        ? `Faltam ${faltam} e dá para virar o jogo: ${CHAMADA_LINK}`
        : `Faltam ${faltam}. Bora manter o ritmo: ${CHAMADA_LINK}`,
    );
  }
  return linhas.join("\n");
}
