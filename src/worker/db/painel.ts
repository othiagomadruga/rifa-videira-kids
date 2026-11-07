/**
 * Leitura do painel, dos rankings, do ranking público e do bumbo (RIFA-PAINEL; docs/api.md, Sprint 3, e
 * docs/regras-de-calculo.md, seção 5). Este módulo só LÊ o banco, de forma agregada, e entrega a
 * `EntradaCalculo` aos montadores de src/shared/contracts/calculos.ts. Nenhuma regra de cálculo mora aqui.
 *
 * Por requisição, duas idas ao banco, sem N+1:
 * 1. a campanha ativa e os períodos dela (`buscarCampanhaAtiva`, um comando só);
 * 2. um `db.batch` com TODAS as células e a hierarquia (com `qtd_pessoas`; a meta proporcional reparte o
 *    total entre todas), as vendas aprovadas agrupadas por célula e dia local e, no resumo de rede,
 *    discipulador ou célula, o nome e a divisão do escopo.
 * As vendas vêm da view `vendas_aprovadas` (só `approved`, célula resolvida pelo afiliado na leitura, D7),
 * de QUALQUER data e com `celula_id` null para as sem célula: são no máximo (células + 1) × dias com venda
 * linhas, e os montadores separam a janela da campanha, as vendas sem célula e as de fora da janela.
 * Custo: cada requisição percorre os pedidos aprovados da campanha no banco (o D1 conta ~6 linhas lidas
 * por pedido, pelos LEFT JOIN da view); o Worker só recebe as linhas agregadas. O teste
 * src/worker/routes/painel-desempenho.test.ts mede com ~7 mil e com 259 mil pedidos.
 *
 * Dia local no SQL. O dia de uma venda é o dia de `aprovado_em` no fuso da campanha (R6). Num fuso de
 * deslocamento fixo D (em minutos), é `date(aprovado_em, 'D minutes')`. Em America/Belem, D = −180: Belém
 * está em UTC−3 sem horário de verão desde 12/09/1988 (tzdata), então `date(aprovado_em, '-180 minutes')`,
 * o mesmo que o `date(aprovado_em, '-3 hours')` de docs/modelo-de-dados.md (7.1), dá o dia de
 * `diaLocalDoInstante` para toda venda desde então: 2026-11-23T02:59:59.999Z → 2026-11-22 e
 * 2026-11-23T03:00:00.000Z → 2026-11-23. O deslocamento sai do Intl (a mesma base de fusos do contrato),
 * e não de uma constante, e cada dia devolvido pelo banco é conferido: o deslocamento precisa ser D no
 * primeiro e no último milissegundo do dia (nenhum fuso muda duas vezes num dia). A conferência fica na
 * memória do isolate. Num fuso com horário de verão (ex.: America/New_York em novembro) algum dia falha
 * e a leitura cai para as vendas uma a uma, agrupadas no Worker com `agruparVendasPorDia` (uma ida a
 * mais, só nesse caso). Assim o resultado é exato com qualquer fuso, e rápido com o da campanha.
 */
import {
  NOMES_DIVISAO,
  agruparVendasPorDia,
  diasEntre,
  hojeNoFuso,
  type CelulaCalculo,
  type DetalheValidacao,
  type Divisao,
  type EntradaCalculo,
  type EscopoPainel,
  type EscopoResolvido,
  type VendaAprovada,
  type VendasDoDia,
} from "../../shared/contracts";
import { buscarCampanhaAtiva, montarCampanha } from "./campanha";

// ---------------------------------------------------------------------------------------------------
// Relógio
// ---------------------------------------------------------------------------------------------------

/** "Agora" da API. As rotas recebem a função (injetável) para os testes fixarem o instante. */
export type Relogio = () => Date;

export const relogioDoSistema: Relogio = () => new Date();

// ---------------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------------

/** Todas as células com a hierarquia resolvida (o formato de `CelulaCalculo`). */
const SELECIONAR_CELULAS = `
  SELECT c.id, c.nome, c.qtd_pessoas, c.discipulador_id, d.nome AS discipulador_nome, d.rede_id,
    r.nome AS rede_nome, r.divisao
  FROM celulas AS c
  JOIN discipuladores AS d ON d.id = c.discipulador_id
  JOIN redes AS r ON r.id = d.rede_id
  ORDER BY c.id`;

/** Vendas aprovadas da campanha por célula e dia local (?2 = deslocamento do fuso: '-180 minutes'). */
const SELECIONAR_VENDAS_POR_DIA = `
  SELECT celula_id, date(aprovado_em, ?2) AS dia, count(*) AS pedidos,
    sum(qtd_bilhetes) AS bilhetes, sum(total_centavos) AS centavos
  FROM vendas_aprovadas
  WHERE campanha_id = ?1
  GROUP BY celula_id, dia`;

/** As vendas uma a uma, para agrupar no Worker quando o fuso não tem deslocamento fixo. */
const SELECIONAR_VENDAS = `
  SELECT celula_id, aprovado_em, qtd_bilhetes, total_centavos
  FROM vendas_aprovadas
  WHERE campanha_id = ?1`;

type EscopoComId = Extract<EscopoPainel, "rede" | "discipulador" | "celula">;

/** Nome e divisão (a da rede) da entidade do escopo, para o resumo. */
const SELECIONAR_ESCOPO: Record<EscopoComId, string> = {
  rede: "SELECT nome, divisao FROM redes WHERE id = ?1",
  discipulador: `
    SELECT d.nome, r.divisao
    FROM discipuladores AS d JOIN redes AS r ON r.id = d.rede_id
    WHERE d.id = ?1`,
  celula: `
    SELECT c.nome, r.divisao
    FROM celulas AS c
    JOIN discipuladores AS d ON d.id = c.discipulador_id
    JOIN redes AS r ON r.id = d.rede_id
    WHERE c.id = ?1`,
};

const NAO_ENCONTRADO: Record<EscopoComId, string> = {
  rede: "Rede não encontrada",
  discipulador: "Discipulador não encontrado",
  celula: "Célula não encontrada",
};

// ---------------------------------------------------------------------------------------------------
// Deslocamento do fuso
// ---------------------------------------------------------------------------------------------------

const MS_POR_MINUTO = 60_000;
const MS_POR_DIA = 86_400_000;
/** Limite da memória de dias conferidos (cada entrada é pequena; passou disso, recomeça). */
const LIMITE_DIAS_CONFERIDOS = 10_000;

const formatadoresDeDeslocamento = new Map<string, Intl.DateTimeFormat>();
const diasConferidos = new Map<string, boolean>();

/**
 * Deslocamento do fuso num instante, em minutos ("GMT-03:00" → −180; "GMT+05:45" → 345; "GMT" ou
 * "GMT+00:00" → 0; o sinal também é aceito como U+2212, que alguns ICU usam). Null se o Intl não der um
 * deslocamento em horas e minutos (ex.: hora média local de antes de 1914): a leitura cai para o JS.
 */
function deslocamentoEmMinutos(fuso: string, instante: number): number | null {
  let formatador = formatadoresDeDeslocamento.get(fuso);
  if (!formatador) {
    formatador = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      timeZoneName: "longOffset",
    });
    formatadoresDeDeslocamento.set(fuso, formatador);
  }
  const nome = formatador
    .formatToParts(instante)
    .find((parte) => parte.type === "timeZoneName")?.value;
  const partes = /^GMT(?:([+\-\u2212])(\d{2}):(\d{2}))?$/.exec(nome ?? "");
  if (!partes) return null;
  if (partes[1] === undefined) return 0;
  const minutos = Number(partes[2]) * 60 + Number(partes[3]);
  return partes[1] === "+" ? minutos : -minutos;
}

/**
 * O dia local `dia` vai exatamente de `dia 00:00 − D` a `dia 24:00 − D` (UTC)? Então toda venda que o
 * SQL põe nesse dia (`date(aprovado_em, 'D minutes')`) é mesmo desse dia no fuso.
 */
function diaNoDeslocamento(
  fuso: string,
  minutos: number,
  dia: string,
): boolean {
  const chave = `${fuso}|${minutos}|${dia}`;
  let conferido = diasConferidos.get(chave);
  if (conferido === undefined) {
    const inicio = Date.parse(`${dia}T00:00:00.000Z`) - minutos * MS_POR_MINUTO;
    conferido =
      !Number.isNaN(inicio) &&
      deslocamentoEmMinutos(fuso, inicio) === minutos &&
      deslocamentoEmMinutos(fuso, inicio + MS_POR_DIA - 1) === minutos;
    if (diasConferidos.size >= LIMITE_DIAS_CONFERIDOS) diasConferidos.clear();
    diasConferidos.set(chave, conferido);
  }
  return conferido;
}

/** Modificador de date() do SQLite: −180 → "-180 minutes". */
const modificador = (minutos: number) =>
  `${minutos < 0 ? "-" : "+"}${Math.abs(minutos)} minutes`;

// ---------------------------------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------------------------------

/** O escopo pedido na consulta do resumo (o schema já exige `id` e `divisao` onde precisa). */
export interface PedidoEscopo {
  escopo: EscopoPainel;
  id?: number;
  divisao?: Divisao;
}

export type FalhaLeitura = {
  ok: false;
  codigo: "nao_encontrado" | "requisicao_invalida";
  mensagem: string;
  detalhes?: DetalheValidacao[];
};

export type LeituraDoCalculo =
  | {
      ok: true;
      /** O instante único da requisição: vale para a data de hoje e para o montador. */
      agora: Date;
      entrada: EntradaCalculo;
      /** O escopo pedido, resolvido (na campanha, o nome dela). */
      escopo: EscopoResolvido;
    }
  | FalhaLeitura;

const falha = (
  codigo: FalhaLeitura["codigo"],
  mensagem: string,
  detalhes?: DetalheValidacao[],
): FalhaLeitura =>
  detalhes === undefined
    ? { ok: false, codigo, mensagem }
    : { ok: false, codigo, mensagem, detalhes };

function exigir<T>(valor: T | undefined, nome: string): T {
  if (valor === undefined)
    throw new RangeError(`Escopo sem ${nome} (o schema da consulta exige)`);
  return valor;
}

/**
 * Lê tudo o que os montadores precisam, na ordem de docs/api.md:
 * - sem campanha ativa: 404 `nao_encontrado`;
 * - `data` depois de hoje (`hojeNoFuso(fuso da campanha, agora)`, a função única do contrato):
 *   400 `requisicao_invalida`, com o detalhe `data_futura`;
 * - escopo de rede, discipulador ou célula com id inexistente: 404 `nao_encontrado`.
 * Chama o relógio uma vez só: o `agora` devolvido é o que a rota passa ao montador.
 */
export async function lerEntradaDoCalculo(
  db: D1Database,
  relogio: Relogio,
  consulta: { data?: string; escopo?: PedidoEscopo } = {},
): Promise<LeituraDoCalculo> {
  const agora = relogio();
  const ativa = await buscarCampanhaAtiva(db);
  if (!ativa)
    return falha("nao_encontrado", "A campanha ainda não foi configurada");
  const campanha = montarCampanha(ativa);
  const fuso = campanha.fuso_horario;

  if (
    consulta.data !== undefined &&
    diasEntre(hojeNoFuso(fuso, agora), consulta.data) > 0
  ) {
    const mensagem = "A data não pode ser depois de hoje";
    return falha("requisicao_invalida", "Consulta inválida", [
      { caminho: ["data"], codigo: "data_futura", mensagem },
    ]);
  }

  const pedido = consulta.escopo ?? { escopo: "campanha" };
  const tipo = pedido.escopo;
  const comId = tipo === "rede" || tipo === "discipulador" || tipo === "celula";
  const id = comId ? exigir(pedido.id, "id") : null;
  // O deslocamento no 1º dia da campanha; os dias devolvidos são conferidos depois.
  const minutos = deslocamentoEmMinutos(
    fuso,
    Date.parse(`${campanha.data_inicio}T12:00:00.000Z`),
  );
  const comandos = [
    db.prepare(SELECIONAR_CELULAS),
    minutos === null
      ? db.prepare(SELECIONAR_VENDAS).bind(ativa.id)
      : db
          .prepare(SELECIONAR_VENDAS_POR_DIA)
          .bind(ativa.id, modificador(minutos)),
  ];
  // O escopo vai no mesmo batch: um id inexistente (raro) custa a leitura, mas não uma ida a mais.
  if (comId) comandos.push(db.prepare(SELECIONAR_ESCOPO[tipo]).bind(id));
  const [linhasCelulas, linhasVendas, linhasEscopo] = await db.batch(comandos);

  let escopo: EscopoResolvido;
  if (comId) {
    const entidade = linhasEscopo.results[0] as
      { nome: string; divisao: Divisao } | undefined;
    if (!entidade) return falha("nao_encontrado", NAO_ENCONTRADO[tipo]);
    escopo = { tipo, id, divisao: entidade.divisao, nome: entidade.nome };
  } else if (tipo === "divisao") {
    const divisao = exigir(pedido.divisao, "divisao");
    escopo = { tipo, id: null, divisao, nome: NOMES_DIVISAO[divisao] };
  } else {
    escopo = { tipo, id: null, divisao: null, nome: campanha.nome };
  }

  let vendas: VendasDoDia[];
  if (minutos === null) {
    vendas = agruparVendasPorDia(linhasVendas.results as VendaAprovada[], fuso);
  } else {
    const porDia = linhasVendas.results as VendasDoDia[];
    vendas = porDia.every((linha) =>
      diaNoDeslocamento(fuso, minutos, linha.dia),
    )
      ? porDia
      : agruparVendasPorDia(await lerVendasUmaAUma(db, ativa.id), fuso);
  }

  return {
    ok: true,
    agora,
    entrada: {
      campanha,
      celulas: linhasCelulas.results as CelulaCalculo[],
      vendas,
    },
    escopo,
  };
}

async function lerVendasUmaAUma(
  db: D1Database,
  campanhaId: number,
): Promise<VendaAprovada[]> {
  const { results } = await db
    .prepare(SELECIONAR_VENDAS)
    .bind(campanhaId)
    .all<VendaAprovada>();
  return results;
}
