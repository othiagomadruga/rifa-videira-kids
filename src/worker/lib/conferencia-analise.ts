/**
 * Análise da conferência (RIFA-012; docs/integracao-rifei.md, seção 10): junta as posições do corpo
 * compacto (o navegador já leu o CSV) em pedidos, decide o valor dos pedidos em várias linhas, confere se
 * a coluna do código é mesmo o código da Rifei, compara com o que o banco leu e monta a resposta de
 * POST /api/admin/reconciliacao/analisar (por pedido ou agregado) e o plano do "Recuperar".
 *
 * Módulo puro: recebe o corpo, o que o banco leu (db/reconciliacao.ts) e o instante "agora"; não lê o
 * banco nem o relógio, e não usa o Intl por linha (a CPU do Worker é curta: 10 ms no plano Free). As
 * respostas só levam códigos de pedido validados, status normalizados, números, centavos, dias e ids de
 * afiliado: nenhum texto livre do arquivo (D1).
 */
import {
  LIMITE_ITENS_POR_DIVERGENCIA,
  MINIMO_CODIGOS_PARA_CONFERIR,
  PROPORCAO_MINIMA_CODIGOS_ENCONTRADOS,
  TIPOS_DIVERGENCIA,
  TOLERANCIA_DESCONTO_BP,
  intervaloUtcDoDia,
  type AfiliadoDoCorpo,
  type AvisoReconciliacao,
  type CorpoConferencia,
  type Divergencia,
  type GrupoDivergencia,
  type MotivoNaoRecuperado,
  type ObservacaoDivergencia,
  type OrigemPedido,
  type PedidoNoArquivo,
  type PedidoNoSistema,
  type PedidoRecuperado,
  type RespostaAnaliseAgregada,
  type RespostaAnalisePorPedido,
  type SituacaoAfiliadoArquivo,
  type StatusArquivoReconciliacao,
  type StatusPedido,
  type TipoDivergencia,
  type TotaisArquivo,
  type TotaisVendas,
} from "../../shared/contracts";
import { Avisos } from "../../shared/conferencia/avisos";
import { chaveDoAfiliado } from "../../shared/conferencia/valores";

// ---------------------------------------------------------------------------------------------------
// O que vem do banco
// ---------------------------------------------------------------------------------------------------

export interface PedidoGravado {
  id: string;
  campanha_id: number;
  status: StatusPedido;
  qtd_bilhetes: number;
  total_centavos: number;
  affiliate_id: number | null;
  /** `aprovado_em` em ms (o banco manda como número: a resposta do D1 fica menor). */
  aprovado_ms: number | null;
  origem: OrigemPedido;
}

export interface AfiliadoGravado {
  affiliate_id: number;
  rotulo: string | null;
  celula_id: number | null;
  celula_nome: string | null;
}

/** A campanha ativa, no que a conferência usa. */
export interface CampanhaDaConferencia {
  id: number;
  fuso: string;
  /** Preço do bilhete, em centavos: base da regra do valor dos pedidos em várias linhas. */
  preco: number;
}

/** Período (dias locais) que a coluna da data cobre e o intervalo UTC dele, `[inicio, fim)`. */
export interface PeriodoDoArquivo {
  inicio: string;
  fim: string;
  utc: { inicio: string; fim: string };
  /** O mesmo intervalo UTC, em ms. */
  ms: { inicio: number; fim: number };
}

type Celula = { id: number; nome: string } | null;

export interface AfiliadoResolvido {
  readonly situacao: SituacaoAfiliadoArquivo;
  readonly affiliateId: number | null;
}

const SEM_COLUNA: AfiliadoResolvido = {
  situacao: "sem_coluna",
  affiliateId: null,
};
const VAZIO_NO_ARQUIVO: AfiliadoResolvido = {
  situacao: "vazio",
  affiliateId: null,
};
const NAO_RECONHECIDO: AfiliadoResolvido = {
  situacao: "nao_reconhecido",
  affiliateId: null,
};

/** Afiliados do banco: célula de cada um e o rótulo (usuário da Rifei) para reconhecer texto do arquivo. */
export class Afiliados {
  private readonly porId = new Map<number, AfiliadoGravado>();
  /** Rótulo normalizado → affiliate_id; null quando dois afiliados têm o mesmo rótulo (ambíguo). */
  private readonly porRotulo = new Map<string, number | null>();

  constructor(afiliados: readonly AfiliadoGravado[]) {
    for (const afiliado of afiliados) {
      this.porId.set(afiliado.affiliate_id, afiliado);
      if (afiliado.rotulo === null) continue;
      const chave = chaveDoAfiliado(afiliado.rotulo);
      if (chave === "") continue;
      this.porRotulo.set(
        chave,
        this.porRotulo.has(chave) ? null : afiliado.affiliate_id,
      );
    }
  }

  celula(affiliateId: number | null): Celula {
    if (affiliateId === null) return null;
    const afiliado = this.porId.get(affiliateId);
    return afiliado?.celula_id != null && afiliado.celula_nome !== null
      ? { id: afiliado.celula_id, nome: afiliado.celula_nome }
      : null;
  }

  /** O mesmo objeto para cada id reconhecido (milhares de pedidos têm poucas dezenas de afiliados). */
  private readonly reconhecidos = new Map<number, AfiliadoResolvido>();

  /** O afiliado do arquivo (undefined = sem a coluna): número, rótulo cadastrado, vazio ou não reconhecido. */
  doArquivo(valor: AfiliadoDoCorpo | undefined): AfiliadoResolvido {
    if (valor === undefined) return SEM_COLUNA;
    if (valor === null) return VAZIO_NO_ARQUIVO;
    let id: number | null | undefined = null;
    if (typeof valor === "number") id = valor;
    else if (typeof valor === "string") id = this.porRotulo.get(valor);
    if (id == null) return NAO_RECONHECIDO;
    let resolvido = this.reconhecidos.get(id);
    if (resolvido === undefined) {
      resolvido = { situacao: "reconhecido", affiliateId: id };
      this.reconhecidos.set(id, resolvido);
    }
    return resolvido;
  }
}

// ---------------------------------------------------------------------------------------------------
// Posições → pedidos
// ---------------------------------------------------------------------------------------------------

/**
 * O valor de um pedido no arquivo, antes da regra do valor:
 * - `unico`: uma linha só, ou várias com valores diferentes, somados (`somado`);
 * - `repetido`: várias linhas com o MESMO valor em todas (o de um bilhete ou o do pedido inteiro? a regra
 *   decide, pelos pedidos que batem com o sistema ou pelo preço do bilhete);
 * - null: sem a coluna, ilegível ou faltando em alguma das linhas.
 */
export type ValorDoArquivo =
  | { tipo: "unico"; centavos: number; somado: boolean }
  | { tipo: "repetido"; centavos: number }
  | null;

/** Um pedido do arquivo: as posições com o mesmo código, juntas. */
export interface PedidoDoArquivo {
  id: string;
  /** Linhas do arquivo com este código. */
  linhas: number;
  /** Linhas com status, afiliado ou dia diferentes: fica fora da comparação e não pode ser recuperado. */
  inconsistente: boolean;
  /** `aprovado` quando o arquivo não tem a coluna de status; `desconhecido` quando ela está vazia. */
  status: StatusArquivoReconciliacao;
  /** A mesma quantidade em todas as linhas (null se faltar em alguma ou se elas diferirem). */
  qtdIgual: number | null;
  /** A quantidade juntada: a da coluna (ou, sem ela, a contagem dos números). */
  qtd: number | null;
  qtdDiferenteDosNumeros: boolean;
  valor: ValorDoArquivo;
  /** undefined = sem a coluna do afiliado. */
  afiliado: AfiliadoDoCorpo | undefined;
  dia: string | null;
  instante: number | null;
}

export interface Agrupamento {
  /** Os pedidos pelo código, na ordem da primeira linha de cada um. */
  pedidos: Map<string, PedidoDoArquivo>;
  /** Algum código aparece em mais de uma linha. */
  repetidos: boolean;
  /** Linhas sem código legível. */
  linhasSemCodigo: number;
}

/** Estado de um pedido enquanto as posições dele são lidas. */
interface Acumulo {
  id: string;
  linhas: number;
  inconsistente: boolean;
  status: StatusArquivoReconciliacao | null;
  qtdPrimeira: number | null;
  qtdIguais: boolean;
  qtdLinhas: number;
  qtdSoma: number;
  numerosLinhas: number;
  numerosSoma: number;
  valorPrimeiro: number | null;
  valorIguais: boolean;
  valorLinhas: number;
  valorSoma: number;
  afiliado: AfiliadoDoCorpo;
  dia: string | null;
  instante: number | null;
}

const chaveDoAfiliadoDoCorpo = (valor: AfiliadoDoCorpo) =>
  valor === false
    ? "invalido"
    : typeof valor === "number"
      ? `n:${valor}`
      : `t:${String(valor)}`;

function novoAcumulo(id: string): Acumulo {
  return {
    id,
    linhas: 0,
    inconsistente: false,
    status: null,
    qtdPrimeira: null,
    qtdIguais: true,
    qtdLinhas: 0,
    qtdSoma: 0,
    numerosLinhas: 0,
    numerosSoma: 0,
    valorPrimeiro: null,
    valorIguais: true,
    valorLinhas: 0,
    valorSoma: 0,
    afiliado: null,
    dia: null,
    instante: null,
  };
}

function pedidoDoAcumulo(
  a: Acumulo,
  temStatus: boolean,
  temAfiliado: boolean,
): PedidoDoArquivo {
  const qtdIgual =
    a.qtdPrimeira !== null && a.qtdIguais && a.qtdLinhas === a.linhas
      ? a.qtdPrimeira
      : null;
  let qtdDaColuna: number | null = null;
  if (a.qtdPrimeira !== null)
    qtdDaColuna = !a.qtdIguais
      ? a.qtdSoma
      : // "1" em cada linha, ou o total repetido: pelo menos uma por linha.
        a.qtdLinhas === a.linhas && a.linhas > 1
        ? Math.max(a.qtdPrimeira, a.linhas)
        : a.qtdPrimeira;
  const contados = a.numerosLinhas > 0 ? a.numerosSoma : null;
  let valor: ValorDoArquivo = null;
  if (a.valorPrimeiro !== null) {
    if (a.valorLinhas === a.linhas)
      valor = a.valorIguais
        ? { tipo: "repetido", centavos: a.valorPrimeiro }
        : { tipo: "unico", centavos: a.valorSoma, somado: true };
    // Só uma linha com o valor (as outras só com o bilhete): é o valor do pedido. Faltando em mais de
    // uma, o total fica sem valor (não dá para saber o das linhas vazias).
    else if (a.valorLinhas === 1)
      valor = { tipo: "unico", centavos: a.valorPrimeiro, somado: false };
  }
  return {
    id: a.id,
    linhas: a.linhas,
    inconsistente: a.inconsistente,
    status: temStatus ? (a.status ?? "desconhecido") : "aprovado",
    qtdIgual,
    qtd: qtdDaColuna ?? contados,
    qtdDiferenteDosNumeros:
      qtdDaColuna !== null && contados !== null && qtdDaColuna !== contados,
    valor,
    afiliado: temAfiliado ? a.afiliado : undefined,
    dia: a.dia,
    instante: a.instante,
  };
}

/** Um código numa posição só (que pode valer por várias linhas iguais): sem acumular. */
function pedidoDeUmaPosicao(
  corpo: CorpoConferencia,
  i: number,
  id: string,
): PedidoDoArquivo {
  const n = corpo.vezes[i];
  const q = corpo.qtd_bilhetes?.[i] ?? null;
  const contados = corpo.numeros?.[i] ?? null;
  const v = corpo.valor?.[i] ?? null;
  // "1" em cada linha, ou o total repetido: pelo menos uma por linha.
  const qtdDaColuna = q === null ? null : n > 1 ? Math.max(q, n) : q;
  const numeros = contados === null ? null : contados * n;
  return {
    id,
    linhas: n,
    inconsistente: false,
    status: corpo.status ? (corpo.status[i] ?? "desconhecido") : "aprovado",
    qtdIgual: q,
    qtd: qtdDaColuna ?? numeros,
    qtdDiferenteDosNumeros:
      qtdDaColuna !== null && numeros !== null && qtdDaColuna !== numeros,
    valor:
      v === null
        ? null
        : n === 1
          ? { tipo: "unico", centavos: v, somado: false }
          : { tipo: "repetido", centavos: v },
    afiliado: corpo.afiliado ? corpo.afiliado[i] : undefined,
    dia: corpo.dia?.[i] ?? null,
    instante: corpo.instante?.[i] ?? null,
  };
}

/** Marca, em agruparPedidos, o lugar de um código que ainda está sendo acumulado. */
const LUGAR_GUARDADO = {} as PedidoDoArquivo;

/** Soma a posição `i` ao acúmulo do código (que aparece em mais de uma posição). */
function acumular1(a: Acumulo, corpo: CorpoConferencia, i: number): void {
  const n = corpo.vezes[i];
  a.linhas += n;
  const st = corpo.status?.[i] ?? null;
  if (st !== null) {
    if (a.status === null) a.status = st;
    else if (a.status !== st) a.inconsistente = true;
  }
  const q = corpo.qtd_bilhetes?.[i] ?? null;
  if (q !== null) {
    if (a.qtdPrimeira === null) a.qtdPrimeira = q;
    else if (a.qtdPrimeira !== q) a.qtdIguais = false;
    a.qtdLinhas += n;
    a.qtdSoma += q * n;
  }
  const contados = corpo.numeros?.[i] ?? null;
  if (contados !== null) {
    a.numerosLinhas += n;
    a.numerosSoma += contados * n;
  }
  const v = corpo.valor?.[i] ?? null;
  if (v !== null) {
    if (a.valorPrimeiro === null) a.valorPrimeiro = v;
    else if (a.valorPrimeiro !== v) a.valorIguais = false;
    a.valorLinhas += n;
    a.valorSoma += v * n;
  }
  const af = corpo.afiliado?.[i] ?? null;
  if (af !== null) {
    if (a.afiliado === null) a.afiliado = af;
    else if (chaveDoAfiliadoDoCorpo(a.afiliado) !== chaveDoAfiliadoDoCorpo(af))
      a.inconsistente = true;
  }
  const d = corpo.dia?.[i] ?? null;
  if (d !== null) {
    if (a.dia === null) a.dia = d;
    else if (a.dia !== d) a.inconsistente = true;
  }
  const t = corpo.instante?.[i] ?? null;
  if (t !== null && a.instante === null) a.instante = t;
}

/**
 * Junta as posições de cada código: status, afiliado e dia precisam bater (senão o pedido é
 * inconsistente); quantidades iguais em todas as linhas contam uma vez (no "Um bilhete por linha", pelo
 * menos uma por linha) e diferentes somam; o valor fica para a regra do valor (ValorDoArquivo). O código
 * numa posição só (o caso comum, inclusive com linhas iguais juntadas pelo navegador) não acumula nada.
 */
export function agruparPedidos(corpo: CorpoConferencia): Agrupamento {
  const codigos = corpo.pedido_id ?? [];
  const posicoes = corpo.vezes.length;
  // 1ª volta: quais códigos aparecem em mais de uma posição.
  const vistos = new Set<string>();
  const varios = new Set<string>();
  for (let i = 0; i < posicoes; i++) {
    const id = codigos[i];
    if (id === null || id === undefined) continue;
    if (vistos.has(id)) varios.add(id);
    else vistos.add(id);
  }

  const pedidos = new Map<string, PedidoDoArquivo>();
  const acumulos = new Map<string, Acumulo>();
  let linhasSemCodigo = 0;
  let repetidos = false;
  for (let i = 0; i < posicoes; i++) {
    const id = codigos[i];
    if (id === null || id === undefined) {
      linhasSemCodigo += corpo.vezes[i];
      continue;
    }
    if (!varios.has(id)) {
      const pedido = pedidoDeUmaPosicao(corpo, i, id);
      repetidos ||= pedido.linhas > 1;
      pedidos.set(id, pedido);
      continue;
    }
    let a = acumulos.get(id);
    if (a === undefined) {
      a = novoAcumulo(id);
      acumulos.set(id, a);
      // Guarda o lugar do código (a ordem é a da primeira linha); o pedido entra no fim.
      pedidos.set(id, LUGAR_GUARDADO);
    }
    acumular1(a, corpo, i);
  }

  const temStatus = corpo.status !== undefined;
  const temAfiliado = corpo.afiliado !== undefined;
  for (const a of acumulos.values()) {
    repetidos = true;
    pedidos.set(a.id, pedidoDoAcumulo(a, temStatus, temAfiliado));
  }
  return { pedidos, repetidos, linhasSemCodigo };
}

/** Primeiro e último dia (no fuso da campanha) que a coluna da data cobre. */
export function diasDoArquivo(
  corpo: CorpoConferencia,
): { inicio: string; fim: string } | null {
  let inicio: string | null = null;
  let fim: string | null = null;
  for (const dia of corpo.dia ?? []) {
    if (dia === null) continue;
    if (inicio === null || dia < inicio) inicio = dia;
    if (fim === null || dia > fim) fim = dia;
  }
  return inicio === null || fim === null ? null : { inicio, fim };
}

/** O período do arquivo com o intervalo UTC (duas contas no Intl por requisição, não por linha). */
export function periodoDoArquivo(
  corpo: CorpoConferencia,
  fuso: string,
): PeriodoDoArquivo | null {
  const dias = diasDoArquivo(corpo);
  if (dias === null) return null;
  const utc = {
    inicio: intervaloUtcDoDia(dias.inicio, fuso).inicio,
    fim: intervaloUtcDoDia(dias.fim, fuso).fim,
  };
  return {
    ...dias,
    utc,
    ms: { inicio: Date.parse(utc.inicio), fim: Date.parse(utc.fim) },
  };
}

// ---------------------------------------------------------------------------------------------------
// Regra do valor dos pedidos em várias linhas
// ---------------------------------------------------------------------------------------------------

/**
 * Como o arquivo escreve o valor de um pedido em várias linhas com o mesmo valor em todas:
 * - por_bilhete: cada linha traz o valor de um bilhete (total = valor × linhas);
 * - repetido: cada linha repete o valor do pedido inteiro (total = valor).
 */
export type ConvencaoDoValor = "por_bilhete" | "repetido";

/** Pedidos que batem com o sistema precisos para firmar a convenção (e a maioria dos comparados). */
export const MINIMO_PEDIDOS_DA_CONVENCAO = 2;

/**
 * A convenção do arquivo, pelos pedidos em várias linhas com valor repetido que JÁ estão pagos no sistema
 * (na campanha) e que vieram do WEBHOOK: se a maioria bate com uma das duas contas (e pelo menos
 * MINIMO_PEDIDOS_DA_CONVENCAO), vale para todos os pedidos do arquivo. Sem maioria, null (a regra do preço
 * decide pedido a pedido). Um pedido gravado pela própria conferência não prova nada: o total dele saiu
 * desta mesma regra, e contá-lo transformaria um valor ambíguo noutro arquivo em "por bilhete".
 */
export function convencaoDoArquivo(
  pedidos: Iterable<PedidoDoArquivo>,
  noSistema: (id: string) => PedidoGravado | undefined,
  campanhaId: number,
): ConvencaoDoValor | null {
  let porBilhete = 0;
  let repetido = 0;
  let comparados = 0;
  for (const pedido of pedidos) {
    if (pedido.inconsistente || pedido.valor?.tipo !== "repetido") continue;
    const gravado = noSistema(pedido.id);
    if (
      !gravado ||
      gravado.campanha_id !== campanhaId ||
      gravado.status !== "approved" ||
      gravado.origem !== "webhook"
    )
      continue;
    comparados++;
    const v = pedido.valor.centavos;
    if (gravado.total_centavos === v * pedido.linhas) porBilhete++;
    else if (gravado.total_centavos === v) repetido++;
  }
  if (porBilhete >= MINIMO_PEDIDOS_DA_CONVENCAO && porBilhete * 2 > comparados)
    return "por_bilhete";
  if (repetido >= MINIMO_PEDIDOS_DA_CONVENCAO && repetido * 2 > comparados)
    return "repetido";
  return null;
}

/** O valor `v` é o de um bilhete: até o preço, com no máximo TOLERANCIA_DESCONTO_BP de desconto. */
export function ehValorDeUmBilhete(v: number, preco: number): boolean {
  return v <= preco && v * 10_000 >= preco * (10_000 - TOLERANCIA_DESCONTO_BP);
}

export interface ValorDecidido {
  /** null: sem valor, ou ambíguo. */
  centavos: number | null;
  ambiguo: boolean;
  /** A regra que decidiu um valor repetido (null nos outros casos). */
  regra: "convencao_por_bilhete" | "convencao_repetido" | "preco" | null;
}

/**
 * O total de um pedido: o da linha (ou a soma de valores diferentes); com o mesmo valor `v` em várias
 * linhas, a convenção do arquivo decide, e sem ela `v` perto do preço do bilhete é por bilhete
 * (v × linhas); outro `v` é ambíguo (sem total, e o pedido não pode ser recuperado).
 */
export function decidirValor(
  pedido: PedidoDoArquivo,
  convencao: ConvencaoDoValor | null,
  preco: number,
): ValorDecidido {
  const valor = pedido.valor;
  if (valor === null) return { centavos: null, ambiguo: false, regra: null };
  if (valor.tipo === "unico")
    return { centavos: valor.centavos, ambiguo: false, regra: null };
  const v = valor.centavos;
  if (convencao === "por_bilhete")
    return {
      centavos: v * pedido.linhas,
      ambiguo: false,
      regra: "convencao_por_bilhete",
    };
  if (convencao === "repetido")
    return { centavos: v, ambiguo: false, regra: "convencao_repetido" };
  if (ehValorDeUmBilhete(v, preco))
    return { centavos: v * pedido.linhas, ambiguo: false, regra: "preco" };
  return { centavos: null, ambiguo: true, regra: null };
}

/** A quantidade do pedido; quando as linhas repetem o pedido inteiro, a quantidade de uma linha. */
export function quantidadeDecidida(
  pedido: PedidoDoArquivo,
  convencao: ConvencaoDoValor | null,
): number | null {
  return convencao === "repetido" && pedido.qtdIgual !== null
    ? pedido.qtdIgual
    : pedido.qtd;
}

/** Quantos pedidos cada regra do valor decidiu: os avisos saem no fim, uma vez cada. */
class ContagemDaRegra {
  private ambiguos = 0;
  private repetidos = 0;
  private porBilhete = 0;
  private pelaConvencao = false;

  contar(decidido: ValorDecidido): void {
    if (decidido.ambiguo) this.ambiguos++;
    else if (decidido.regra === "convencao_repetido") this.repetidos++;
    else if (decidido.regra !== null) {
      this.porBilhete++;
      if (decidido.regra === "convencao_por_bilhete") this.pelaConvencao = true;
    }
  }

  avisar(avisos: Avisos, preco: number): void {
    avisos.contar("valor_ambiguo", this.ambiguos, "pedido", { preco });
    avisos.contar("valor_do_pedido_repetido", this.repetidos, "pedido");
    avisos.contar("valor_por_bilhete", this.porBilhete, "pedido", {
      preco,
      pelaConvencao: this.pelaConvencao,
    });
  }
}

// ---------------------------------------------------------------------------------------------------
// A coluna do código confere?
// ---------------------------------------------------------------------------------------------------

export interface ConferenciaDoCodigo {
  confere: boolean;
  pagos_no_arquivo: number;
  encontrados: number;
}

/**
 * Trava do código: com pelo menos MINIMO_CODIGOS_PARA_CONFERIR pagos no arquivo e menos de
 * PROPORCAO_MINIMA_CODIGOS_ENCONTRADOS deles no sistema (em qualquer campanha), a coluna escolhida
 * provavelmente não é o código da Rifei. Exceção: se o sistema tem pelo menos o mesmo mínimo de pagos no
 * período do arquivo e a maioria deles aparece no arquivo, a coluna é a certa (o webhook é que falhou).
 */
export function conferirCodigo(
  pedidos: Iterable<PedidoDoArquivo>,
  noSistema: (id: string) => PedidoGravado | undefined,
  sistema: { pagosNoPeriodo: number; pagosNoPeriodoNoArquivo: number },
): ConferenciaDoCodigo {
  let pagos = 0;
  let encontrados = 0;
  for (const pedido of pedidos) {
    if (pedido.inconsistente || pedido.status !== "aprovado") continue;
    pagos++;
    if (noSistema(pedido.id)) encontrados++;
  }
  const poucos =
    pagos >= MINIMO_CODIGOS_PARA_CONFERIR &&
    encontrados < pagos * PROPORCAO_MINIMA_CODIGOS_ENCONTRADOS;
  const confirmadoPeloSistema =
    sistema.pagosNoPeriodo >= MINIMO_CODIGOS_PARA_CONFERIR &&
    sistema.pagosNoPeriodoNoArquivo >=
      sistema.pagosNoPeriodo * PROPORCAO_MINIMA_CODIGOS_ENCONTRADOS;
  return {
    confere: !poucos || confirmadoPeloSistema,
    pagos_no_arquivo: pagos,
    encontrados,
  };
}

// ---------------------------------------------------------------------------------------------------
// Datas da venda
// ---------------------------------------------------------------------------------------------------

const MS_POR_HORA = 3_600_000;

const formatadoresDoDia = new Map<string, Intl.DateTimeFormat>();

/** O dia ("YYYY-MM-DD") de um instante no fuso, com o formatador guardado (criar um custa caro). */
export function diaNoFuso(fuso: string, instante: Date): string {
  let formatador = formatadoresDoDia.get(fuso);
  if (!formatador) {
    formatador = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatadoresDoDia.set(fuso, formatador);
  }
  const partes = formatador.formatToParts(instante);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((item) => item.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

/** O "agora", o dia de hoje e o meio-dia de cada dia no fuso: o Intl só roda uma vez por dia distinto. */
export class Calendario {
  private readonly meioDia = new Map<string, number>();
  private readonly fuso: string;
  readonly agora: Date;
  private hojeGuardado: string | null = null;

  constructor(fuso: string, agora: Date) {
    this.fuso = fuso;
    this.agora = agora;
  }

  /** "YYYY-MM-DD" de hoje no fuso (calculado na primeira vez que precisa). */
  get hoje(): string {
    this.hojeGuardado ??= diaNoFuso(this.fuso, this.agora);
    return this.hojeGuardado;
  }

  /** Meio-dia local do dia, em ms (UTC). */
  meioDiaDe(dia: string): number {
    let valor = this.meioDia.get(dia);
    if (valor === undefined) {
      valor =
        Date.parse(intervaloUtcDoDia(dia, this.fuso).inicio) + 12 * MS_POR_HORA;
      this.meioDia.set(dia, valor);
    }
    return valor;
  }
}

/** A data do arquivo é no futuro (depois de agora, ou um dia depois de hoje)? */
function dataNoFuturo(
  pedido: PedidoDoArquivo,
  calendario: Calendario,
): boolean {
  if (pedido.instante !== null)
    return pedido.instante > calendario.agora.getTime();
  return pedido.dia !== null && pedido.dia > calendario.hoje;
}

/** Instante a gravar num pedido recuperado (e de onde ele veio). null: a data do arquivo é no futuro. */
function instanteDaVenda(
  pedido: PedidoDoArquivo,
  calendario: Calendario,
): { instante: number; origem: PedidoRecuperado["origem_data"] } | null {
  const agoraMs = calendario.agora.getTime();
  if (dataNoFuturo(pedido, calendario)) return null;
  if (pedido.instante !== null)
    return { instante: pedido.instante, origem: "arquivo" };
  if (pedido.dia === null) return { instante: agoraMs, origem: "recuperacao" };
  return {
    instante: Math.min(calendario.meioDiaDe(pedido.dia), agoraMs),
    origem: "dia_do_arquivo",
  };
}

// ---------------------------------------------------------------------------------------------------
// Decisões comuns à análise e ao "Recuperar"
// ---------------------------------------------------------------------------------------------------

/** O que o banco leu para o modo por pedido (db/reconciliacao.ts). */
export interface SistemaPorPedido {
  campanha: CampanhaDaConferencia;
  afiliados: readonly AfiliadoGravado[];
  /** Os pedidos do banco (de qualquer campanha) com os códigos do arquivo. */
  encontrados: ReadonlyMap<string, PedidoGravado>;
  /** Pagos da campanha ativa no período do arquivo (todos, se o arquivo não tem datas). */
  pagosNoPeriodo: number;
}

/** O que a análise e o "Recuperar" decidem do mesmo jeito: a convenção do valor e a trava do código. */
export interface Decisoes {
  convencao: ConvencaoDoValor | null;
  codigo: ConferenciaDoCodigo;
}

export function decidir(
  agrupamento: Agrupamento,
  sistema: SistemaPorPedido,
  periodo: PeriodoDoArquivo | null,
): Decisoes {
  const noSistema = (id: string) => sistema.encontrados.get(id);
  const { campanha } = sistema;
  let pagosNoPeriodoNoArquivo = 0;
  for (const gravado of sistema.encontrados.values()) {
    if (gravado.campanha_id !== campanha.id || gravado.status !== "approved")
      continue;
    if (
      periodo !== null &&
      (gravado.aprovado_ms === null ||
        gravado.aprovado_ms < periodo.ms.inicio ||
        gravado.aprovado_ms >= periodo.ms.fim)
    )
      continue;
    pagosNoPeriodoNoArquivo++;
  }
  return {
    convencao: convencaoDoArquivo(
      agrupamento.pedidos.values(),
      noSistema,
      campanha.id,
    ),
    codigo: conferirCodigo(agrupamento.pedidos.values(), noSistema, {
      pagosNoPeriodo: sistema.pagosNoPeriodo,
      pagosNoPeriodoNoArquivo,
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Modo por pedido
// ---------------------------------------------------------------------------------------------------

/** O que impede a recuperação de uma venda perdida (lista vazia = recuperável). */
function impedimentos(
  pedido: PedidoDoArquivo,
  qtd: number | null,
  decidido: ValorDecidido,
  calendario: Calendario,
  codigoConfere: boolean,
): ObservacaoDivergencia[] {
  const lista: ObservacaoDivergencia[] = [];
  if (qtd === null || qtd < 1) lista.push("sem_quantidade");
  if (decidido.ambiguo) lista.push("valor_ambiguo");
  else if (decidido.centavos === null) lista.push("sem_valor");
  if (dataNoFuturo(pedido, calendario)) lista.push("data_no_futuro");
  if (!codigoConfere) lista.push("codigo_nao_confere");
  return lista;
}

function ladoDoSistema(
  pedido: PedidoGravado,
  afiliados: Afiliados,
): PedidoNoSistema {
  return {
    status: pedido.status,
    qtd_bilhetes: pedido.qtd_bilhetes,
    total_centavos: pedido.total_centavos,
    affiliate_id: pedido.affiliate_id,
    celula: afiliados.celula(pedido.affiliate_id),
    aprovado_em:
      pedido.aprovado_ms === null
        ? null
        : new Date(pedido.aprovado_ms).toISOString(),
    origem: pedido.origem,
  };
}

const porCodigo = (a: { pedido_id: string }, b: { pedido_id: string }) =>
  a.pedido_id < b.pedido_id ? -1 : a.pedido_id > b.pedido_id ? 1 : 0;

type Soma = { bilhetes: number; total_centavos: number };

function somar(
  itens: readonly Divergencia[],
  lado: (item: Divergencia) => {
    qtd_bilhetes: number | null;
    total_centavos: number | null;
  } | null,
): Soma {
  let bilhetes = 0;
  let total = 0;
  for (const item of itens) {
    const valores = lado(item);
    bilhetes += valores?.qtd_bilhetes ?? 0;
    total += valores?.total_centavos ?? 0;
  }
  return { bilhetes, total_centavos: total };
}

function montarGrupo(
  tipo: TipoDivergencia,
  itens: Divergencia[],
): GrupoDivergencia {
  itens.sort(porCodigo);
  return {
    tipo,
    quantidade: itens.length,
    arquivo: somar(itens, (item) => item.arquivo),
    sistema: somar(itens, (item) => item.sistema),
    itens: itens.slice(0, LIMITE_ITENS_POR_DIVERGENCIA),
    itens_omitidos: Math.max(0, itens.length - LIMITE_ITENS_POR_DIVERGENCIA),
  };
}

const ehPendenteOuNegado = (status: StatusArquivoReconciliacao) =>
  status === "pendente" || status === "expirado" || status === "cancelado";

/** Os avisos que só dependem das colunas usadas (os da leitura das células, a tela monta). */
function avisosDasColunas(corpo: CorpoConferencia): Avisos {
  const avisos = new Avisos();
  const { colunas } = corpo;
  if (colunas.pedido_id === null) avisos.marcar("sem_coluna_pedido");
  if (colunas.status === null) avisos.marcar("sem_coluna_status");
  if (colunas.qtd_bilhetes === null && colunas.bilhetes === null)
    avisos.marcar("sem_coluna_quantidade");
  if (colunas.valor === null) avisos.marcar("sem_coluna_valor");
  if (colunas.afiliado === null) avisos.marcar("sem_coluna_afiliado");
  if (colunas.data === null) avisos.marcar("sem_coluna_data");
  return avisos;
}

/** Marca o aviso da trava do código (com o nome da coluna e as contagens). */
function avisarCodigo(
  avisos: Avisos,
  corpo: CorpoConferencia,
  codigo: ConferenciaDoCodigo,
): void {
  if (!codigo.confere)
    avisos.marcar("codigo_nao_confere", {
      nomes: corpo.colunas.pedido_id ? [corpo.colunas.pedido_id] : [],
      pagos: codigo.pagos_no_arquivo,
      encontrados: codigo.encontrados,
    });
}

/** Os pagos da campanha ativa que o arquivo não tem (o banco já os separou, contou e somou). */
export interface AusentesDoArquivo {
  quantidade: number;
  bilhetes: number;
  total_centavos: number;
  /** Os primeiros LIMITE_ITENS_POR_DIVERGENCIA, em ordem de código. */
  itens: (PedidoGravado & { fora_do_periodo: boolean })[];
}

export interface EntradaPorPedido {
  corpo: CorpoConferencia;
  agrupamento: Agrupamento;
  sistema: SistemaPorPedido & {
    /** Todos os pagos da campanha ativa no sistema. */
    aprovados: TotaisVendas;
    ausentes: AusentesDoArquivo;
  };
  periodo: PeriodoDoArquivo | null;
  calendario: Calendario;
}

/** Comparação pedido a pedido (o arquivo tem a coluna do código). */
export function analisarPorPedido(
  entrada: EntradaPorPedido,
): RespostaAnalisePorPedido {
  const { corpo, agrupamento, sistema, periodo, calendario } = entrada;
  const { campanha } = sistema;
  const avisos = avisosDasColunas(corpo);
  const afiliados = new Afiliados(sistema.afiliados);
  const { pedidos, repetidos, linhasSemCodigo } = agrupamento;
  if (repetidos) avisos.marcar("um_bilhete_por_linha");
  const { convencao, codigo } = decidir(agrupamento, sistema, periodo);
  avisarCodigo(avisos, corpo, codigo);

  const grupos = new Map<TipoDivergencia, Divergencia[]>(
    TIPOS_DIVERGENCIA.map((tipo) => [tipo, []]),
  );
  const comDivergencia = new Set<string>();
  let conferem = 0;
  let inconsistentes = 0;
  let desconhecidos = 0;
  let afiliadosNaoReconhecidos = 0;
  let deOutra = 0;
  let qtdDiferentes = 0;
  let aprovados = 0;
  let bilhetesAprovados = 0;
  let centavosAprovados = 0;

  const regra = new ContagemDaRegra();
  for (const pedido of pedidos.values()) {
    if (pedido.inconsistente) {
      inconsistentes++;
      continue;
    }
    const gravado = sistema.encontrados.get(pedido.id);
    if (gravado && gravado.campanha_id !== campanha.id) {
      deOutra++;
      continue;
    }
    if (pedido.qtdDiferenteDosNumeros) qtdDiferentes++;
    if (pedido.status === "desconhecido") desconhecidos++;
    const decidido = decidirValor(pedido, convencao, campanha.preco);
    const qtd = quantidadeDecidida(pedido, convencao);
    regra.contar(decidido);
    const afiliado = afiliados.doArquivo(pedido.afiliado);
    if (afiliado.situacao === "nao_reconhecido") afiliadosNaoReconhecidos++;

    // Os tipos de divergência do pedido (null = nenhum): a lista só existe quando há o que mostrar.
    let tipos: TipoDivergencia[] | null = null;
    let observacoes: ObservacaoDivergencia[] = [];
    if (pedido.status === "aprovado") {
      aprovados++;
      bilhetesAprovados += qtd ?? 0;
      centavosAprovados += decidido.centavos ?? 0;
      if (!gravado) {
        tipos = ["venda_perdida"];
        observacoes = impedimentos(
          pedido,
          qtd,
          decidido,
          calendario,
          codigo.confere,
        );
      } else if (gravado.status !== "approved") {
        tipos = ["pagamento_nao_registrado"];
      } else {
        if (
          decidido.centavos !== null &&
          decidido.centavos !== gravado.total_centavos
        )
          (tipos ??= []).push("valor_diferente");
        if (qtd !== null && qtd !== gravado.qtd_bilhetes)
          (tipos ??= []).push("quantidade_diferente");
        if (
          afiliado.situacao !== "sem_coluna" &&
          afiliado.situacao !== "nao_reconhecido" &&
          afiliado.affiliateId !== gravado.affiliate_id
        )
          (tipos ??= []).push("afiliado_diferente");
        if (tipos === null) conferem++;
      }
    } else if (
      gravado?.status === "approved" &&
      ehPendenteOuNegado(pedido.status)
    ) {
      tipos = ["nao_pago_na_rifei"];
    }
    if (tipos === null) continue;

    comDivergencia.add(pedido.id);
    const doArquivo: PedidoNoArquivo = {
      status: pedido.status,
      qtd_bilhetes: qtd,
      total_centavos: decidido.centavos,
      afiliado: afiliado.situacao,
      affiliate_id: afiliado.affiliateId,
      celula: afiliados.celula(afiliado.affiliateId),
      data: pedido.dia,
    };
    const doSistema = gravado ? ladoDoSistema(gravado, afiliados) : null;
    for (const tipo of tipos)
      grupos.get(tipo)!.push({
        pedido_id: pedido.id,
        arquivo: doArquivo,
        sistema: doSistema,
        recuperavel: tipo === "venda_perdida" && observacoes.length === 0,
        observacoes,
      });
  }
  regra.avisar(avisos, campanha.preco);

  // Pagos no sistema que o arquivo não tem: o banco já tirou os do arquivo, contou e somou.
  const { ausentes } = sistema;
  const itensAusentes: Divergencia[] = ausentes.itens.map((gravado) => ({
    pedido_id: gravado.id,
    arquivo: null,
    sistema: ladoDoSistema(gravado, afiliados),
    recuperavel: false,
    observacoes: gravado.fora_do_periodo
      ? (["fora_do_periodo_do_arquivo"] as ObservacaoDivergencia[])
      : [],
  }));
  const grupoAusentes: GrupoDivergencia = {
    tipo: "ausente_no_arquivo",
    quantidade: ausentes.quantidade,
    arquivo: { bilhetes: 0, total_centavos: 0 },
    sistema: {
      bilhetes: ausentes.bilhetes,
      total_centavos: ausentes.total_centavos,
    },
    itens: itensAusentes.sort(porCodigo),
    itens_omitidos: Math.max(0, ausentes.quantidade - itensAusentes.length),
  };

  avisos.contar("status_desconhecido", desconhecidos, "pedido");
  avisos.contar("quantidade_diferente_dos_numeros", qtdDiferentes, "pedido");
  avisos.contar("afiliado_nao_reconhecido", afiliadosNaoReconhecidos, "pedido");
  avisos.contar("pedido_inconsistente", inconsistentes, "pedido");
  avisos.contar("pedido_de_outra_campanha", deOutra, "pedido");
  if (aprovados === 0) avisos.marcar("sem_aprovados");

  const temQuantidade =
    corpo.colunas.qtd_bilhetes !== null || corpo.colunas.bilhetes !== null;
  return {
    modo: "por_pedido",
    arquivo: {
      linhas: corpo.linhas,
      linhas_ignoradas: linhasSemCodigo,
      um_bilhete_por_linha: repetidos,
      data_inicio: periodo?.inicio ?? null,
      data_fim: periodo?.fim ?? null,
    },
    avisos: avisos.lista(),
    conferido_em: calendario.agora.toISOString(),
    codigo,
    resumo: {
      pedidos_no_arquivo: pedidos.size,
      aprovados_no_arquivo: {
        pedidos_aprovados: aprovados,
        bilhetes: temQuantidade ? bilhetesAprovados : null,
        total_centavos: corpo.colunas.valor === null ? null : centavosAprovados,
      },
      aprovados_no_sistema: sistema.aprovados,
      conferem,
      com_divergencia: comDivergencia.size + ausentes.quantidade,
    },
    divergencias: TIPOS_DIVERGENCIA.map((tipo) =>
      tipo === "ausente_no_arquivo"
        ? grupoAusentes
        : montarGrupo(tipo, grupos.get(tipo)!),
    ),
  };
}

// ---------------------------------------------------------------------------------------------------
// Modo agregado (sem o código do pedido)
// ---------------------------------------------------------------------------------------------------

export interface Acumulado {
  pedidos: number;
  bilhetes: number;
  centavos: number;
}

const vazioAcumulado = (): Acumulado => ({
  pedidos: 0,
  bilhetes: 0,
  centavos: 0,
});

/** O que o arquivo permite contar no modo agregado. */
interface Contaveis {
  pedidos: boolean;
  bilhetes: boolean;
  valor: boolean;
}

function comparar(
  doArquivo: Acumulado | undefined,
  doSistema: Acumulado | undefined,
  contaveis: Contaveis,
): {
  arquivo: TotaisArquivo;
  sistema: TotaisVendas;
  confere: boolean;
} {
  const a = doArquivo ?? vazioAcumulado();
  const s = doSistema ?? vazioAcumulado();
  const arquivo: TotaisArquivo = {
    pedidos_aprovados: contaveis.pedidos ? a.pedidos : null,
    bilhetes: contaveis.bilhetes ? a.bilhetes : null,
    total_centavos: contaveis.valor ? a.centavos : null,
  };
  return {
    arquivo,
    sistema: {
      pedidos_aprovados: s.pedidos,
      bilhetes: s.bilhetes,
      total_centavos: s.centavos,
    },
    confere:
      (arquivo.pedidos_aprovados === null || a.pedidos === s.pedidos) &&
      (arquivo.bilhetes === null || a.bilhetes === s.bilhetes) &&
      (arquivo.total_centavos === null || a.centavos === s.centavos),
  };
}

function acumular(
  mapa: Map<string, Acumulado>,
  chave: string,
  pedidos: number,
  bilhetes: number,
  centavos: number,
): void {
  let atual = mapa.get(chave);
  if (atual === undefined) {
    atual = vazioAcumulado();
    mapa.set(chave, atual);
  }
  atual.pedidos += pedidos;
  atual.bilhetes += bilhetes;
  atual.centavos += centavos;
}

const CHAVE_SEM_AFILIADO = "sem";
const CHAVE_NAO_RECONHECIDO = "nr";
const chaveDoId = (id: number) => `id:${id}`;

/** Os pagos da campanha ativa (no período do arquivo, quando ele tem datas), somados pelo banco. */
export interface SistemaAgregado {
  afiliados: readonly AfiliadoGravado[];
  total: Acumulado;
  porAfiliado: { affiliate_id: number | null; soma: Acumulado }[];
  /** Por dia local; null quando o arquivo não tem a coluna da data. */
  porDia: { dia: string; soma: Acumulado }[] | null;
}

export interface EntradaAgregada {
  corpo: CorpoConferencia;
  sistema: SistemaAgregado;
  periodo: PeriodoDoArquivo | null;
  agora: Date;
}

/**
 * Uma linha por bilhete sem o código: alguma linha paga com um número só e a quantidade do pedido
 * (maior que 1) repetida.
 */
function temUmBilhetePorLinha(corpo: CorpoConferencia): boolean {
  const { numeros, qtd_bilhetes: qtds, status } = corpo;
  if (!numeros || !qtds) return false;
  for (let i = 0; i < corpo.vezes.length; i++) {
    const aprovada = !status || status[i] === "aprovado";
    const q = qtds[i];
    if (aprovada && numeros[i] === 1 && q !== null && q > 1) return true;
  }
  return false;
}

/** Comparação dos totais pagos: geral, por afiliado e por dia. */
export function analisarAgregado(
  entrada: EntradaAgregada,
): RespostaAnaliseAgregada {
  const { corpo, sistema, periodo, agora } = entrada;
  const { colunas, vezes } = corpo;
  const avisos = avisosDasColunas(corpo);
  const afiliados = new Afiliados(sistema.afiliados);

  const umBilhetePorLinha = temUmBilhetePorLinha(corpo);
  if (umBilhetePorLinha) avisos.marcar("um_bilhete_por_linha_sem_id");
  const temQuantidade =
    colunas.qtd_bilhetes !== null || colunas.bilhetes !== null;
  // Sem o código e sem a quantidade, uma linha pode ser um pedido ou um bilhete: não dá para contar
  // pedidos (no "Um bilhete por linha", contaria cada bilhete como um pedido).
  if (!temQuantidade) avisos.marcar("sem_contagem_de_pedidos");
  const contaveis: Contaveis = {
    pedidos: temQuantidade && !umBilhetePorLinha,
    bilhetes: temQuantidade,
    valor: colunas.valor !== null && !umBilhetePorLinha,
  };

  const totalArquivo = vazioAcumulado();
  const porAfiliadoArquivo = new Map<string, Acumulado>();
  const porDiaArquivo = new Map<string, Acumulado>();
  let desconhecidas = 0;
  let naoReconhecidos = 0;
  let aprovadas = 0;
  for (let i = 0; i < vezes.length; i++) {
    const n = vezes[i];
    if (corpo.status) {
      const status = corpo.status[i];
      if (status !== "aprovado") {
        if (status === null || status === "desconhecido") desconhecidas += n;
        continue;
      }
    }
    aprovadas += n;
    const bilhetes = umBilhetePorLinha
      ? 1
      : (corpo.qtd_bilhetes?.[i] ?? corpo.numeros?.[i] ?? 0);
    const centavos = corpo.valor?.[i] ?? 0;
    totalArquivo.pedidos += n;
    totalArquivo.bilhetes += bilhetes * n;
    totalArquivo.centavos += centavos * n;
    if (corpo.afiliado) {
      const { situacao, affiliateId } = afiliados.doArquivo(corpo.afiliado[i]);
      if (situacao === "nao_reconhecido") naoReconhecidos += n;
      const chave =
        affiliateId !== null
          ? chaveDoId(affiliateId)
          : situacao === "nao_reconhecido"
            ? CHAVE_NAO_RECONHECIDO
            : CHAVE_SEM_AFILIADO;
      acumular(porAfiliadoArquivo, chave, n, bilhetes * n, centavos * n);
    }
    const dia = corpo.dia?.[i] ?? null;
    if (dia !== null)
      acumular(porDiaArquivo, dia, n, bilhetes * n, centavos * n);
  }
  avisos.contar("status_desconhecido", desconhecidas, "linha");
  avisos.contar("afiliado_nao_reconhecido", naoReconhecidos, "linha");
  if (aprovadas === 0) avisos.marcar("sem_aprovados");

  const porAfiliadoSistema = new Map<string, Acumulado>(
    sistema.porAfiliado.map(({ affiliate_id, soma }) => [
      affiliate_id === null ? CHAVE_SEM_AFILIADO : chaveDoId(affiliate_id),
      soma,
    ]),
  );
  const porDiaSistema = new Map<string, Acumulado>(
    (sistema.porDia ?? []).map(({ dia, soma }) => [dia, soma]),
  );

  type LinhaAfiliado = NonNullable<
    RespostaAnaliseAgregada["por_afiliado"]
  >[number];
  let porAfiliado: LinhaAfiliado[] | null = null;
  if (colunas.afiliado !== null) {
    const chaves = new Set([
      ...porAfiliadoArquivo.keys(),
      ...porAfiliadoSistema.keys(),
    ]);
    porAfiliado = [...chaves].map((chave): LinhaAfiliado => {
      const id = chave.startsWith("id:") ? Number(chave.slice(3)) : null;
      return {
        afiliado:
          id !== null
            ? "afiliado"
            : chave === CHAVE_NAO_RECONHECIDO
              ? "nao_reconhecido"
              : "sem_afiliado",
        affiliate_id: id,
        celula: afiliados.celula(id),
        ...comparar(
          porAfiliadoArquivo.get(chave),
          porAfiliadoSistema.get(chave),
          contaveis,
        ),
      };
    });
    const ordemDoTipo = { afiliado: 0, sem_afiliado: 1, nao_reconhecido: 2 };
    porAfiliado.sort(
      (a, b) =>
        Number(a.confere) - Number(b.confere) ||
        ordemDoTipo[a.afiliado] - ordemDoTipo[b.afiliado] ||
        (a.affiliate_id ?? 0) - (b.affiliate_id ?? 0),
    );
  }

  let porDia: RespostaAnaliseAgregada["por_dia"] = null;
  if (colunas.data !== null) {
    const dias = [
      ...new Set([...porDiaArquivo.keys(), ...porDiaSistema.keys()]),
    ].sort();
    porDia = dias.map((dia) => ({
      data: dia,
      ...comparar(porDiaArquivo.get(dia), porDiaSistema.get(dia), contaveis),
    }));
  }

  return {
    modo: "agregado",
    arquivo: {
      linhas: corpo.linhas,
      linhas_ignoradas: 0,
      um_bilhete_por_linha: umBilhetePorLinha,
      data_inicio: periodo?.inicio ?? null,
      data_fim: periodo?.fim ?? null,
    },
    avisos: avisos.lista(),
    conferido_em: agora.toISOString(),
    recorte:
      periodo === null
        ? null
        : { data_inicio: periodo.inicio, data_fim: periodo.fim },
    total: comparar(totalArquivo, sistema.total, contaveis),
    por_afiliado: porAfiliado,
    por_dia: porDia,
  };
}

// ---------------------------------------------------------------------------------------------------
// "Recuperar"
// ---------------------------------------------------------------------------------------------------

export interface PlanoRecuperacao {
  gravar: PedidoRecuperado[];
  naoRecuperados: { pedido_id: string; motivo: MotivoNaoRecuperado }[];
  avisos: AvisoReconciliacao[];
}

/**
 * Decide, para cada código escolhido (sem repetição, na ordem pedida), se ele pode ser gravado como venda
 * aprovada e com quais dados, com as mesmas regras da análise (a convenção do valor; a trava do código é
 * conferida antes, na rota). Um código que já está no banco (em qualquer campanha) nunca é sobrescrito.
 */
export function planejarRecuperacao(
  entrada: {
    corpo: CorpoConferencia;
    agrupamento: Agrupamento;
    sistema: SistemaPorPedido;
    convencao: ConvencaoDoValor | null;
    calendario: Calendario;
  },
  codigos: readonly string[],
): PlanoRecuperacao {
  const { corpo, agrupamento, sistema, convencao, calendario } = entrada;
  const avisos = new Avisos();
  if (corpo.colunas.status === null) avisos.marcar("sem_coluna_status");
  if (corpo.colunas.afiliado === null) avisos.marcar("sem_coluna_afiliado");
  if (corpo.colunas.data === null) avisos.marcar("sem_coluna_data");
  const afiliados = new Afiliados(sistema.afiliados);
  const preco = sistema.campanha.preco;

  const gravar: PedidoRecuperado[] = [];
  const naoRecuperados: PlanoRecuperacao["naoRecuperados"] = [];
  const regra = new ContagemDaRegra();
  let naoReconhecidos = 0;
  for (const codigo of new Set(codigos)) {
    const nao = (motivo: MotivoNaoRecuperado) =>
      naoRecuperados.push({ pedido_id: codigo, motivo });
    const pedido = agrupamento.pedidos.get(codigo);
    if (!pedido) {
      nao("nao_esta_no_arquivo");
      continue;
    }
    if (pedido.inconsistente) {
      nao("inconsistente_no_arquivo");
      continue;
    }
    if (pedido.status !== "aprovado") {
      nao("nao_aprovado_no_arquivo");
      continue;
    }
    if (sistema.encontrados.has(codigo)) {
      nao("ja_existe");
      continue;
    }
    const qtd = quantidadeDecidida(pedido, convencao);
    if (qtd === null || qtd < 1) {
      nao("sem_quantidade");
      continue;
    }
    const decidido = decidirValor(pedido, convencao, preco);
    if (decidido.centavos === null) {
      nao(decidido.ambiguo ? "valor_ambiguo" : "sem_valor");
      continue;
    }
    const venda = instanteDaVenda(pedido, calendario);
    if (venda === null) {
      nao("data_no_futuro");
      continue;
    }
    regra.contar(decidido);
    const { situacao, affiliateId } = afiliados.doArquivo(pedido.afiliado);
    if (situacao === "nao_reconhecido") naoReconhecidos++;
    gravar.push({
      pedido_id: codigo,
      qtd_bilhetes: qtd,
      total_centavos: decidido.centavos,
      afiliado: situacao,
      affiliate_id: affiliateId,
      celula: afiliados.celula(affiliateId),
      aprovado_em: new Date(venda.instante).toISOString(),
      origem_data: venda.origem,
    });
  }
  regra.avisar(avisos, preco);
  avisos.contar("afiliado_nao_reconhecido", naoReconhecidos, "pedido");
  return { gravar, naoRecuperados, avisos: avisos.lista() };
}
