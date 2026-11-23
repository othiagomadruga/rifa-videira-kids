/**
 * Relatório diário por e-mail (RIFA-086 e RIFA-087, D40): os números do dia de referência e o e-mail montado (assunto,
 * HTML e texto). Tudo aqui é PURO (sem banco, sem relógio, sem rede): db/painel.ts lê e o envio é de
 * lib/relatorio-diario-envio.ts.
 *
 * - `dadosDoRelatorioDiario`: os números, dos MESMOS montadores do painel (`montarResumoPainel`, `montarRankingPainel`
 *   e `montarRankingGruposPainel`, de calculos.ts) no dia de referência, com a janela da campanha inteira até o fim
 *   desse dia. Fora da campanha (antes do início ou depois do fim), null: o e-mail não sai. O valor do dia
 *   (`totaisDoDia`, de lib/arrecadado.ts) é a mesma fonte do total da campanha, filtrada pelo dia.
 * - Dois tipos (TIPOS_RELATORIO_DIARIO): `manha` (o dia anterior fechado, "Resumo de ...") e `tarde` (hoje até a hora
 *   do envio, "Parcial de ..., até 17h"; "Hoje até 17h" no lugar de "No dia"). O resto é igual.
 * - `montarRelatorioDiario`: o e-mail no visual que o PO aprovou em 23/11 (uma coluna, até 560 px, estilos inline) e a
 *   versão em texto puro. Números em pt-BR montados por texto (sem ponto
 *   flutuante, D2); percentuais dos pontos-base TRUNCADOS em uma casa, como o site (R11: nunca "100%" antes da meta).
 *   Nada da Efí: o saldo saiu na RIFA-087 (adendo da D40).
 *
 * Nada de comprador (nome, telefone) nem de contato de líder: os dados só têm números agregados e os nomes de células,
 * discipuladores e grupos. Todo texto que vem do banco é escapado no HTML.
 */
import {
  CELULAS_NO_RELATORIO_DIARIO,
  LINK_PAINEL_RELATORIO_DIARIO,
  intervaloUtcDoDia,
  montarRankingGruposPainel,
  montarRankingPainel,
  montarResumoPainel,
  type EntradaCalculo,
  type GrupoCalculo,
  type ItemRanking,
  type RegraMeta,
  type TipoRelatorioDiario,
  type UnidadeMeta,
} from "../../shared/contracts";
import { totaisDoDia } from "./arrecadado";

// ---------------------------------------------------------------------------------------------------
// Os números do dia
// ---------------------------------------------------------------------------------------------------

/** Uma célula de "Células que mais avançaram". */
export interface CelulaDoRelatorio {
  posicao: number;
  nome: string;
  percentual_meta_bp: number | null;
  bilhetes: number;
}

/** Tudo o que o e-mail mostra, já calculado. */
export interface DadosRelatorioDiario {
  /** `manha`: o dia anterior fechado; `tarde`: hoje até a hora do envio (parcial). */
  tipo: TipoRelatorioDiario;
  /** Dia de referência (AAAA-MM-DD, no fuso da campanha). */
  data: string;
  /** Só na tarde: até que hora vão os números, no fuso da campanha ("17h", "15h42"); null na manhã. */
  parcial_ate: string | null;
  dia_campanha: number;
  duracao_dias: number;
  unidade: UnidadeMeta;
  /** A meta da célula (a regra da campanha), para a nota das células. */
  regra_meta: { regra: RegraMeta; valor: number };
  /** Da campanha inteira até o fim do dia de referência (com as vendas sem célula). */
  vendas: { bilhetes: number; total_centavos: number };
  campanha: { meta: number; percentual_meta_bp: number | null };
  /**
   * O dia de referência: os pedidos pagos do dia (bilhetes e R$, a mesma fonte de `vendas`, filtrada pelo dia) e a
   * meta do dia (na unidade da meta).
   */
  dia: { bilhetes: number; total_centavos: number; meta: number };
  /** O período (semana) do dia de referência. */
  periodo: {
    nome: string;
    data_inicio: string;
    data_fim: string;
    realizado: number;
    meta: number;
    percentual_meta_bp: number | null;
  };
  /** As primeiras do ranking de células (campanha inteira), só as que já venderam. */
  celulas: CelulaDoRelatorio[];
  /** Cada grupo (D39) e quem está em 1º (empates: todos); vazio = ainda sem vendas. */
  grupos: { nome: string; primeiros: string[] }[];
  /** Os discipuladores que venderam (na ordem do ranking) e os que não (em ordem alfabética). */
  discipuladores: {
    com_venda: { nome: string; percentual_meta_bp: number | null }[];
    sem_venda: string[];
  };
  total_celulas: number;
  celulas_sem_venda: number;
  bilhetes_sem_celula: number;
}

/** Qual envio: a manhã ou a tarde, com o instante do corte (o envio). */
export type EnvioDoRelatorio = { tipo: "manha" } | { tipo: "tarde"; ate: Date };

const ordemDosNomes = new Intl.Collator("pt-BR", { sensitivity: "base" });

const vendeu = (item: ItemRanking) => item.vendas.pedidos_aprovados > 0;

function exigir<T>(valor: T | null, nome: string): T {
  if (valor === null) throw new RangeError(`${nome} ausente na campanha`);
  return valor;
}

/**
 * Os números do e-mail de `data` (o dia de referência), ou null fora da campanha (antes do início ou depois do fim:
 * nada a enviar). `entrada` e `grupos` são os da leitura do painel (db/painel.ts com os comandos de db/grupos.ts).
 */
export function dadosDoRelatorioDiario(
  entrada: EntradaCalculo,
  grupos: readonly GrupoCalculo[],
  data: string,
  envio: EnvioDoRelatorio,
): DadosRelatorioDiario | null {
  const { campanha } = entrada;
  // O "agora" dos montadores: o último milissegundo do dia de referência. Os montadores com `data` a usam; o dos
  // grupos (que sempre calcula "hoje") recebe este instante, e o dia dele é o de referência.
  const fimDoDia = new Date(
    Date.parse(intervaloUtcDoDia(data, campanha.fuso_horario).fim) - 1,
  );
  const resumo = montarResumoPainel(
    entrada,
    {
      escopo: {
        tipo: "campanha",
        id: null,
        divisao: null,
        nome: campanha.nome,
      },
      data,
    },
    fimDoDia,
  );
  const { referencia } = resumo;
  if (referencia.fase !== "durante") return null;
  const hoje = exigir(resumo.hoje, "Meta do dia");
  const periodo = exigir(resumo.periodo, "Período");
  const infoPeriodo = exigir(referencia.periodo, "Período");

  const ranking = (nivel: "celula" | "discipulador") =>
    montarRankingPainel(entrada, { nivel, periodo: "campanha", data }, fimDoDia)
      .itens;
  const celulas = ranking("celula");
  const discipuladores = ranking("discipulador");
  const porGrupo = montarRankingGruposPainel(
    entrada,
    grupos,
    { nivel: "celula", janela: "campanha" },
    fimDoDia,
  );

  const doDia = totaisDoDia(entrada, data);

  return {
    tipo: envio.tipo,
    data,
    parcial_ate:
      envio.tipo === "tarde"
        ? horaCurta(envio.ate.toISOString(), campanha.fuso_horario)
        : null,
    dia_campanha: exigir(referencia.dia_campanha, "Dia da campanha"),
    duracao_dias: referencia.duracao_dias,
    unidade: resumo.unidade,
    regra_meta: { regra: campanha.meta.regra, valor: campanha.meta.valor },
    vendas: {
      bilhetes: resumo.vendas.bilhetes,
      total_centavos: resumo.vendas.total_centavos,
    },
    campanha: {
      meta: resumo.campanha.meta,
      percentual_meta_bp: resumo.campanha.percentual_meta_bp,
    },
    dia: {
      bilhetes: doDia.bilhetes,
      total_centavos: doDia.total_centavos,
      meta: hoje.meta,
    },
    periodo: {
      nome: infoPeriodo.nome,
      data_inicio: infoPeriodo.data_inicio,
      data_fim: infoPeriodo.data_fim,
      realizado: periodo.realizado,
      meta: periodo.meta,
      percentual_meta_bp: periodo.percentual_meta_bp,
    },
    celulas: celulas
      .filter(vendeu)
      .slice(0, CELULAS_NO_RELATORIO_DIARIO)
      .map((item) => ({
        posicao: item.posicao,
        nome: item.nome,
        percentual_meta_bp: item.percentual_meta_bp,
        bilhetes: item.vendas.bilhetes,
      })),
    grupos: porGrupo.grupos.map((grupo) => ({
      nome: grupo.nome,
      primeiros: grupo.itens
        .filter((item) => item.posicao === 1 && vendeu(item))
        .map((item) => item.nome),
    })),
    discipuladores: {
      com_venda: discipuladores.filter(vendeu).map((item) => ({
        nome: item.nome,
        percentual_meta_bp: item.percentual_meta_bp,
      })),
      sem_venda: discipuladores
        .filter((item) => !vendeu(item))
        .map((item) => item.nome)
        .sort(ordemDosNomes.compare),
    },
    total_celulas: celulas.length,
    celulas_sem_venda: celulas.filter((item) => !vendeu(item)).length,
    bilhetes_sem_celula: resumo.vendas_sem_celula?.bilhetes ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------------
// Formatação em pt-BR (por texto, sem ponto flutuante)
// ---------------------------------------------------------------------------------------------------

/** 5280 → "5.280". */
export function formatarInteiro(valor: number): string {
  if (!Number.isSafeInteger(valor))
    throw new RangeError(`Inteiro inválido: ${valor}`);
  const sinal = valor < 0 ? "-" : "";
  return `${sinal}${String(Math.abs(valor)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** 114000 → "R$ 1.140,00"; −310 → "-R$ 3,10". */
export function formatarReais(centavos: number): string {
  if (!Number.isSafeInteger(centavos))
    throw new RangeError(`Centavos inválidos: ${centavos}`);
  const absoluto = Math.abs(centavos);
  const reais = formatarInteiro(Math.trunc(absoluto / 100));
  const resto = String(absoluto % 100).padStart(2, "0");
  return `${centavos < 0 ? "-" : ""}R$ ${reais},${resto}`;
}

/** Pontos-base com uma casa, truncados como no site: 809 → "8,0%"; 93 → "0,9%"; 12000 → "120,0%". */
export function formatarPercentualBp(bp: number): string {
  if (!Number.isSafeInteger(bp) || bp < 0)
    throw new RangeError(`Pontos-base inválidos: ${bp}`);
  const decimos = Math.trunc(bp / 10);
  return `${formatarInteiro(Math.trunc(decimos / 10))},${decimos % 10}%`;
}

const DIAS_DA_SEMANA = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
] as const;

/** "2026-11-23" → "segunda". */
export function diaDaSemana(data: string): string {
  return DIAS_DA_SEMANA[new Date(`${data}T12:00:00.000Z`).getUTCDay()];
}

/** "2026-11-23" → "23/11". */
export function diaMes(data: string): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

/** "23 a 29/11" no mesmo mês; "28/11 a 04/12" entre meses. */
export function intervaloDeDias(inicio: string, fim: string): string {
  return inicio.slice(0, 7) === fim.slice(0, 7)
    ? `${inicio.slice(8, 10)} a ${diaMes(fim)}`
    : `${diaMes(inicio)} a ${diaMes(fim)}`;
}

/** "07:00": a hora do instante no fuso. */
export function horaNoFuso(instante: string, fuso: string): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instante));
  const parte = (tipo: string) =>
    partes.find((item) => item.type === tipo)?.value ?? "00";
  return `${parte("hour").padStart(2, "0")}:${parte("minute")}`;
}

/** "17h" na hora cheia, "15h42" fora dela: a hora do instante no fuso, como se diz no e-mail. */
export function horaCurta(instante: string, fuso: string): string {
  const [hora, minuto] = horaNoFuso(instante, fuso).split(":");
  return minuto === "00" ? `${Number(hora)}h` : `${Number(hora)}h${minuto}`;
}

/** ["A", "B", "C"] → "A, B e C". */
export function juntarNomes(nomes: readonly string[]): string {
  return nomes.length <= 1
    ? (nomes[0] ?? "")
    : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
}

/** "bilhete" / "bilhetes". */
const palavraBilhete = (quantidade: number) =>
  quantidade === 1 ? "bilhete" : "bilhetes";

/** "1 bilhete" / "49 bilhetes". */
const bilhetes = (quantidade: number) =>
  `${formatarInteiro(quantidade)} ${palavraBilhete(quantidade)}`;

/** "1 bilhete pago" / "135 bilhetes pagos". */
const bilhetesPagos = (quantidade: number) =>
  `${bilhetes(quantidade)} ${quantidade === 1 ? "pago" : "pagos"}`;

/** Um valor na unidade da meta: "49 bilhetes" ou "R$ 1.140,00". */
const naUnidade = (valor: number, unidade: UnidadeMeta) =>
  unidade === "bilhetes" ? bilhetes(valor) : formatarReais(valor);

/** Só o número na unidade (sem "bilhetes"): "1.584" ou "R$ 1.584,00". */
const numeroNaUnidade = (valor: number, unidade: UnidadeMeta) =>
  unidade === "bilhetes" ? formatarInteiro(valor) : formatarReais(valor);

const percentualOuSemMeta = (bp: number | null) =>
  bp === null ? "sem meta" : formatarPercentualBp(bp);

/** Quantos líderes de grupo aparecem empatados em 1º antes do "e mais N". */
const PRIMEIROS_POR_GRUPO = 3;

function textoDosPrimeiros(primeiros: readonly string[]): string {
  if (primeiros.length <= PRIMEIROS_POR_GRUPO) return juntarNomes(primeiros);
  return `${primeiros.slice(0, PRIMEIROS_POR_GRUPO).join(", ")} e mais ${primeiros.length - PRIMEIROS_POR_GRUPO}`;
}

// ---------------------------------------------------------------------------------------------------
// Os textos do e-mail (iguais no HTML e no texto puro)
// ---------------------------------------------------------------------------------------------------

/**
 * Manhã: "Projeto Videira Kids · resumo de segunda, 23/11". Tarde (com `parcialAte`):
 * "Projeto Videira Kids · parcial de segunda, 23/11 (até 17h)".
 */
export function assuntoDoRelatorioDiario(
  data: string,
  parcialAte: string | null = null,
): string {
  const dia = `${diaDaSemana(data)}, ${diaMes(data)}`;
  return parcialAte === null
    ? `Projeto Videira Kids · resumo de ${dia}`
    : `Projeto Videira Kids · parcial de ${dia} (até ${parcialAte})`;
}

/** "Resumo de segunda, 23/11 · dia 1 de 21" ou "Parcial de segunda, 23/11, até 17h · dia 1 de 21". */
function subtitulo(dados: DadosRelatorioDiario): string {
  const dia = `${diaDaSemana(dados.data)}, ${diaMes(dados.data)}`;
  const contagem = `dia ${dados.dia_campanha} de ${dados.duracao_dias}`;
  return dados.parcial_ate === null
    ? `Resumo de ${dia} · ${contagem}`
    : `Parcial de ${dia}, até ${dados.parcial_ate} · ${contagem}`;
}

/** O rótulo da linha do dia: "No dia" (manhã) ou "Hoje até 17h" (tarde). */
const rotuloDoDia = (dados: DadosRelatorioDiario) =>
  dados.parcial_ate === null ? "No dia" : `Hoje até ${dados.parcial_ate}`;

function notaDasCelulas(dados: DadosRelatorioDiario): string {
  const { regra, valor } = dados.regra_meta;
  const alvo =
    regra === "por_pessoa"
      ? `${naUnidade(valor, dados.unidade)} por membro`
      : regra === "fixa_por_celula"
        ? `${naUnidade(valor, dados.unidade)} por célula`
        : "o alvo da campanha repartido pelos membros";
  return `% do alvo da célula (${alvo}) · bilhetes vendidos`;
}

function textoDoAlvo(dados: DadosRelatorioDiario): string {
  const meta = naUnidade(dados.campanha.meta, dados.unidade);
  return dados.campanha.percentual_meta_bp === null
    ? `Alvo da campanha: ${meta}`
    : `${formatarPercentualBp(dados.campanha.percentual_meta_bp)} do alvo da campanha (${meta})`;
}

function textoCelulasSemVenda(dados: DadosRelatorioDiario): string {
  const { celulas_sem_venda: sem, total_celulas: total } = dados;
  if (sem === 0)
    return `Todas as ${formatarInteiro(total)} células já venderam`;
  return sem === 1
    ? `1 de ${formatarInteiro(total)} células ainda não vendeu`
    : `${formatarInteiro(sem)} de ${formatarInteiro(total)} células ainda não venderam`;
}

function textoSemCelula(quantidade: number): string | null {
  if (quantidade === 0) return null;
  return quantidade === 1
    ? "1 bilhete foi vendido sem link de célula (não conta para nenhuma)"
    : `${formatarInteiro(quantidade)} bilhetes foram vendidos sem link de célula (não contam para nenhuma)`;
}

const RODAPE = "Enviado todo dia às 7h e às 17h · Projeto Videira Kids";

// ---------------------------------------------------------------------------------------------------
// HTML do e-mail (estilos inline, uma coluna, até 560 px)
// ---------------------------------------------------------------------------------------------------

/** Escapa o texto para o HTML (nomes digitados pela coordenação). */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const COR = {
  fundo: "#f4f2f7",
  cartao: "#ffffff",
  texto: "#1f1b2d",
  roxo: "#6b4c9a",
  suave: "#6e6880",
  apagado: "#8a8499",
  corpo: "#4a4560",
  trilho: "#ece8f3",
  ouro: "#c9a227",
  atencao: "#fbf6e6",
  botao: "#5b2a86",
  linha: "#eee",
} as const;

const SECAO = `margin-top:26px;font-size:13px;letter-spacing:.08em;color:${COR.roxo};font-weight:700`;
const TABELA =
  "width:100%;margin-top:8px;border-collapse:collapse;font-size:15px";

/** Uma linha de tabela (rótulo à esquerda, valor à direita), com o traço em cima a partir da segunda. */
function linhaDeTabela(
  indice: number,
  esquerda: { html: string; estilo?: string },
  direita: { html: string; estilo?: string },
  respiro = "7px",
): string {
  const borda = indice === 0 ? "" : `;border-top:1px solid ${COR.linha}`;
  const estilo = (base: string, extra?: string) =>
    `${base}${extra ? `;${extra}` : ""}${borda}`;
  return `<tr><td style="${estilo(`padding:${respiro} 0`, esquerda.estilo)}">${esquerda.html}</td><td style="${estilo(`padding:${respiro} 0;text-align:right`, direita.estilo)}">${direita.html}</td></tr>`;
}

/** A barra do alvo: a largura é o percentual (até 100%), com um mínimo visível. */
function larguraDaBarra(bp: number | null): string {
  const decimos = Math.trunc(Math.min(bp ?? 0, 10_000) / 10);
  return `${Math.trunc(decimos / 10)}.${decimos % 10}%`;
}

function htmlDoRelatorio(dados: DadosRelatorioDiario, assunto: string): string {
  const e = escaparHtml;
  const { unidade } = dados;
  const partes: string[] = [];
  partes.push(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${e(assunto)}</title></head>`,
    `<body style="margin:0;background:${COR.fundo};font-family:Helvetica,Arial,sans-serif;color:${COR.texto}">`,
    `<div style="max-width:560px;margin:0 auto;padding:20px 14px">`,
    `<div style="background:${COR.cartao};border-radius:14px;padding:26px 22px">`,
    `<div style="font-size:13px;letter-spacing:.12em;color:${COR.roxo};font-weight:700">PROJETO VIDEIRA KIDS</div>`,
    `<div style="font-size:15px;color:${COR.suave};margin-top:4px">${e(subtitulo(dados))}</div>`,
  );

  // Arrecadado e o alvo da campanha.
  partes.push(
    `<div style="margin:22px 0 6px;font-size:40px;font-weight:800;color:${COR.texto}">${e(formatarReais(dados.vendas.total_centavos))}</div>`,
    `<div style="font-size:15px;color:${COR.corpo}">arrecadados · <b>${e(bilhetesPagos(dados.vendas.bilhetes))}</b></div>`,
  );
  if (dados.campanha.percentual_meta_bp !== null)
    partes.push(
      `<div style="margin-top:14px;height:10px;background:${COR.trilho};border-radius:6px;overflow:hidden"><div style="width:${larguraDaBarra(dados.campanha.percentual_meta_bp)};min-width:6px;height:10px;background:${COR.ouro}"></div></div>`,
    );
  partes.push(
    `<div style="font-size:13px;color:${COR.suave};margin-top:6px">${e(textoDoAlvo(dados))}</div>`,
  );

  // O dia (bilhetes e R$ dos pedidos pagos do dia) e o período.
  const metaDoDia = `<span style="color:${COR.suave}">(meta ${e(numeroNaUnidade(dados.dia.meta, unidade))})</span>`;
  const realizadoDoDia = `<b>${e(formatarInteiro(dados.dia.bilhetes))}</b> ${palavraBilhete(dados.dia.bilhetes)} · <b>${e(formatarReais(dados.dia.total_centavos))}</b>`;
  const { periodo } = dados;
  const percentualDoPeriodo =
    periodo.percentual_meta_bp === null
      ? ""
      : ` · ${e(formatarPercentualBp(periodo.percentual_meta_bp))}`;
  partes.push(
    `<table style="width:100%;margin-top:22px;border-collapse:collapse;font-size:15px">`,
    linhaDeTabela(
      0,
      { html: e(rotuloDoDia(dados)), estilo: `color:${COR.suave}` },
      { html: `${realizadoDoDia} ${metaDoDia}` },
      "8px",
    ),
    linhaDeTabela(
      1,
      {
        html: `${e(periodo.nome)} · ${e(intervaloDeDias(periodo.data_inicio, periodo.data_fim))}`,
        estilo: `color:${COR.suave}`,
      },
      {
        html: `<b>${e(numeroNaUnidade(periodo.realizado, unidade))}</b> de ${e(numeroNaUnidade(periodo.meta, unidade))}${percentualDoPeriodo}`,
      },
      "8px",
    ),
    `</table>`,
  );

  // Células que mais avançaram.
  partes.push(`<div style="${SECAO}">CÉLULAS QUE MAIS AVANÇARAM</div>`);
  if (dados.celulas.length === 0)
    partes.push(
      `<div style="font-size:15px;margin-top:8px;color:${COR.apagado}">Nenhuma célula vendeu ainda.</div>`,
    );
  else
    partes.push(
      `<table style="${TABELA}">`,
      ...dados.celulas.map((celula, indice) =>
        linhaDeTabela(
          indice,
          { html: `${celula.posicao}. ${e(celula.nome)}` },
          {
            html: `<b>${e(percentualOuSemMeta(celula.percentual_meta_bp))}</b> <span style="color:${COR.suave}">· ${e(formatarInteiro(celula.bilhetes))}</span>`,
          },
        ),
      ),
      `</table>`,
      `<div style="font-size:12px;color:${COR.apagado};margin-top:4px">${e(notaDasCelulas(dados))}</div>`,
    );

  // Por grupo (D39): só com grupos.
  if (dados.grupos.length > 0)
    partes.push(
      `<div style="${SECAO}">POR GRUPO · QUEM LIDERA</div>`,
      `<table style="${TABELA}">`,
      ...dados.grupos.map((grupo, indice) =>
        linhaDeTabela(
          indice,
          { html: e(grupo.nome), estilo: `color:${COR.suave}` },
          grupo.primeiros.length === 0
            ? { html: "ainda sem vendas", estilo: `color:${COR.apagado}` }
            : { html: e(textoDosPrimeiros(grupo.primeiros)) },
        ),
      ),
      `</table>`,
    );

  // Discipuladores.
  const { com_venda: comVenda, sem_venda: semVenda } = dados.discipuladores;
  if (comVenda.length + semVenda.length > 0) {
    partes.push(`<div style="${SECAO}">DISCIPULADORES</div>`);
    partes.push(
      comVenda.length === 0
        ? `<div style="font-size:15px;margin-top:8px;line-height:1.7;color:${COR.apagado}">Nenhum discipulador vendeu ainda.</div>`
        : `<div style="font-size:15px;margin-top:8px;line-height:1.7">${comVenda
            .map(
              (item) =>
                `${e(item.nome)} <b>${e(percentualOuSemMeta(item.percentual_meta_bp))}</b>`,
            )
            .join(" · ")}</div>`,
    );
    if (comVenda.length > 0 && semVenda.length > 0)
      partes.push(
        `<div style="font-size:13px;color:${COR.apagado}">Sem venda ainda: ${e(juntarNomes(semVenda))}</div>`,
      );
  }

  // Atenção.
  const avisos = [
    e(textoCelulasSemVenda(dados)),
    ...[textoSemCelula(dados.bilhetes_sem_celula)].flatMap((texto) =>
      texto === null ? [] : [e(texto)],
    ),
  ];
  partes.push(
    `<div style="margin-top:26px;background:${COR.atencao};border-radius:10px;padding:14px 16px;font-size:14px;line-height:1.6">`,
    `<b>Atenção</b><br>`,
    avisos.map((aviso) => `• ${aviso}`).join("<br>"),
    `</div>`,
  );

  // O botão e o rodapé.
  partes.push(
    `<div style="margin-top:24px;text-align:center"><a href="${e(LINK_PAINEL_RELATORIO_DIARIO)}" style="display:inline-block;background:${COR.botao};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:15px">Abrir o painel completo</a></div>`,
    `</div>`,
    `<div style="text-align:center;font-size:12px;color:${COR.apagado};margin-top:12px">${e(RODAPE)}</div>`,
    `</div></body></html>`,
  );
  return partes.join("\n");
}

// ---------------------------------------------------------------------------------------------------
// Texto puro
// ---------------------------------------------------------------------------------------------------

function textoDoRelatorio(dados: DadosRelatorioDiario): string {
  const { unidade, periodo } = dados;
  const linhas: string[] = [
    "PROJETO VIDEIRA KIDS",
    subtitulo(dados),
    "",
    `${formatarReais(dados.vendas.total_centavos)} arrecadados · ${bilhetesPagos(dados.vendas.bilhetes)}`,
    textoDoAlvo(dados),
    "",
    `${rotuloDoDia(dados)}: ${bilhetes(dados.dia.bilhetes)} · ${formatarReais(dados.dia.total_centavos)} (meta ${numeroNaUnidade(dados.dia.meta, unidade)})`,
    `${periodo.nome} · ${intervaloDeDias(periodo.data_inicio, periodo.data_fim)}: ${numeroNaUnidade(periodo.realizado, unidade)} de ${numeroNaUnidade(periodo.meta, unidade)}${periodo.percentual_meta_bp === null ? "" : ` · ${formatarPercentualBp(periodo.percentual_meta_bp)}`}`,
    "",
    "CÉLULAS QUE MAIS AVANÇARAM",
  ];
  if (dados.celulas.length === 0) linhas.push("Nenhuma célula vendeu ainda.");
  else
    linhas.push(
      ...dados.celulas.map(
        (celula) =>
          `${celula.posicao}. ${celula.nome}: ${percentualOuSemMeta(celula.percentual_meta_bp)} · ${formatarInteiro(celula.bilhetes)}`,
      ),
      `(${notaDasCelulas(dados)})`,
    );
  if (dados.grupos.length > 0)
    linhas.push(
      "",
      "POR GRUPO · QUEM LIDERA",
      ...dados.grupos.map(
        (grupo) =>
          `${grupo.nome}: ${grupo.primeiros.length === 0 ? "ainda sem vendas" : textoDosPrimeiros(grupo.primeiros)}`,
      ),
    );
  const { com_venda: comVenda, sem_venda: semVenda } = dados.discipuladores;
  if (comVenda.length + semVenda.length > 0) {
    linhas.push(
      "",
      "DISCIPULADORES",
      comVenda.length === 0
        ? "Nenhum discipulador vendeu ainda."
        : comVenda
            .map(
              (item) =>
                `${item.nome} ${percentualOuSemMeta(item.percentual_meta_bp)}`,
            )
            .join(" · "),
    );
    if (comVenda.length > 0 && semVenda.length > 0)
      linhas.push(`Sem venda ainda: ${juntarNomes(semVenda)}`);
  }
  const semCelula = textoSemCelula(dados.bilhetes_sem_celula);
  linhas.push(
    "",
    "ATENÇÃO",
    `• ${textoCelulasSemVenda(dados)}`,
    ...(semCelula === null ? [] : [`• ${semCelula}`]),
    "",
    `Abrir o painel completo: ${LINK_PAINEL_RELATORIO_DIARIO}`,
    "",
    RODAPE,
  );
  return `${linhas.join("\n")}\n`;
}

/** O e-mail do dia (manhã ou tarde): assunto, HTML (o mesmo da prévia) e texto puro. */
export function montarRelatorioDiario(dados: DadosRelatorioDiario): {
  assunto: string;
  html: string;
  texto: string;
} {
  const assunto = assuntoDoRelatorioDiario(dados.data, dados.parcial_ate);
  return {
    assunto,
    html: htmlDoRelatorio(dados, assunto),
    texto: textoDoRelatorio(dados),
  };
}
