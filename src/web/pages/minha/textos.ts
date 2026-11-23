// Textos da visão individual (/minha: líder, discipulador e rede), sem React. Só percentuais, posições,
// nomes, datas e bilhetes do próprio alvo e da equipe dele; nunca dinheiro (D12). Quantidades na unidade da
// meta só aparecem com a meta em bilhetes: com a meta em centavos elas chegam null e o texto fica só com o
// percentual (emBilhetes). Números, percentuais e datas sempre pelos formatadores (lib/formatadores).
import type {
  DesempenhoIndividual,
  MetaDoDiaIndividual,
  ReferenciaCampanha,
  RespostaVisaoIndividual,
  RitmoIndividual,
} from "../../../shared/contracts/api";
import {
  NOMES_DIVISAO,
  type Divisao,
  type JanelaRanking,
  type JanelaRankingResposta,
  type NivelRanking,
  type PeriodoDaReferencia,
  type UnidadeMeta,
} from "../../../shared/contracts/calculos";
import type { TipoAlvo } from "../../../shared/contracts/dominio";
import type { NomeIcone, TomBadge, TomSituacao } from "../../components/ui";
import {
  formatarData,
  formatarNumero,
  formatarPercentual,
} from "../../lib/formatadores";

export type Ranking = RespostaVisaoIndividual["ranking"];
export type PosicaoIndividual = NonNullable<Ranking["geral"]>;
export type VizinhoIndividual = NonNullable<PosicaoIndividual["acima"]>;
export type RitmoDaCampanha = DesempenhoIndividual["campanha"];

/** "1 dia", "13 dias". */
export function contagem(
  numero: number,
  singular: string,
  plural: string,
): string {
  return `${formatarNumero(numero)} ${numero === 1 ? singular : plural}`;
}

/** "1 bilhete", "42 bilhetes". */
export function bilhetes(numero: number): string {
  return contagem(numero, "bilhete", "bilhetes");
}

/**
 * Uma quantidade na unidade da meta, só quando a meta é em bilhetes. Com a meta em centavos, ela seria
 * dinheiro: a API manda null e, mesmo que mandasse um número, a tela não o mostraria.
 */
export function emBilhetes(
  valor: number | null,
  unidade: UnidadeMeta,
): number | null {
  return unidade === "bilhetes" ? valor : null;
}

/** Posição no ranking: 1 → "1º". Empatados mostram a mesma posição (1º, 1º, 3º). */
export function formatarPosicao(posicao: number): string {
  return `${posicao}º`;
}

/** "23/11": o dia do calendário, sem trocar de dia. */
export function dataCurta(data: string): string {
  return formatarData(data).slice(0, 5);
}

/** Quem disputa no ranking de cada nível, com o artigo: "as células", "os discipuladores", "as redes". */
const PARES_DO_NIVEL: Record<
  NivelRanking,
  { pares: string; artigo: string; todos: string }
> = {
  celula: { pares: "células", artigo: "as", todos: "todas as" },
  discipulador: { pares: "discipuladores", artigo: "os", todos: "todos os" },
  rede: { pares: "redes", artigo: "as", todos: "todas as" },
};

// ---------------------------------------------------------------------------------------------------
// Fase da campanha e destaque
// ---------------------------------------------------------------------------------------------------

export type TextoDaFase = { destaque: string; detalhe: string };

/** Onde a campanha está hoje: o dia, a contagem regressiva ou "encerrada". */
export function textoDaFase(referencia: ReferenciaCampanha): TextoDaFase {
  const periodoDasVendas = `As vendas vão de ${formatarData(referencia.data_inicio)} a ${formatarData(referencia.data_fim)}.`;
  switch (referencia.fase) {
    case "antes": {
      const faltam = referencia.dias_para_inicio ?? 1;
      return {
        destaque:
          faltam === 1
            ? "As vendas começam amanhã"
            : `Faltam ${contagem(faltam, "dia", "dias")} para começar`,
        detalhe: periodoDasVendas,
      };
    }
    case "durante": {
      // dias_restantes conta hoje: no último dia vale 1.
      const restantes = referencia.dias_restantes;
      return {
        destaque: `Dia ${formatarNumero(referencia.dia_campanha ?? 1)} de ${formatarNumero(referencia.duracao_dias)}`,
        detalhe:
          restantes <= 1
            ? `Hoje é o último dia da campanha (${formatarData(referencia.data_fim)}).`
            : `Faltam ${contagem(restantes, "dia", "dias")}, contando hoje (até ${formatarData(referencia.data_fim)}).`,
      };
    }
    case "encerrada":
      return {
        destaque: "Campanha encerrada",
        detalhe: `Terminou em ${formatarData(referencia.data_fim)}.`,
      };
  }
}

/** Antes do início: a meta da campanha, só se for em bilhetes (null com a meta em centavos ou sem meta). */
export function textoDaMetaAntes(
  campanha: RitmoDaCampanha,
  unidade: UnidadeMeta,
): string | null {
  const meta = emBilhetes(campanha.meta, unidade);
  return meta !== null && meta > 0
    ? `Meta da campanha: ${bilhetes(meta)}.`
    : null;
}

export type TextoDeHoje = {
  /** "Faltam 7 bilhetes hoje", "Meta de hoje batida", "22% da meta de hoje"... */
  destaque: string;
  detalhe: string | null;
  batida: boolean;
};

/**
 * A meta de hoje (só durante a campanha). Com a meta em bilhetes: quanto falta, a meta e o vendido hoje.
 * Com a meta em centavos: só o percentual (e os bilhetes vendidos hoje, que não são dinheiro).
 */
export function textoDeHoje(
  hoje: MetaDoDiaIndividual,
  bilhetesHoje: number | null,
  unidade: UnidadeMeta,
  /** O alvo não tem meta na campanha (ex.: sem células): não há o que "cobrir" hoje. */
  semMeta = false,
): TextoDeHoje {
  const meta = emBilhetes(hoje.meta, unidade);
  const realizado = emBilhetes(hoje.realizado, unidade);
  const falta = emBilhetes(hoje.falta, unidade);
  const vendidosHoje =
    bilhetesHoje === null ? null : `Vendidos hoje: ${bilhetes(bilhetesHoje)}.`;
  if (semMeta) {
    return { destaque: "Sem meta hoje", detalhe: vendidosHoje, batida: false };
  }
  const coberta =
    meta === 0 || (meta === null && hoje.percentual_meta_bp === null);
  if (coberta) {
    return {
      destaque: "Meta de hoje já coberta",
      detalhe: [
        "O que foi vendido até ontem já cobre a curva de hoje.",
        vendidosHoje,
      ]
        .filter(Boolean)
        .join(" "),
      batida: true,
    };
  }
  if (meta !== null && realizado !== null && falta !== null) {
    const resumo = `Meta de hoje: ${bilhetes(meta)}; vendidos hoje: ${formatarNumero(realizado)}.`;
    return hoje.batida
      ? { destaque: "Meta de hoje batida", detalhe: resumo, batida: true }
      : {
          destaque:
            falta === 1
              ? "Falta 1 bilhete hoje"
              : `Faltam ${bilhetes(falta)} hoje`,
          detalhe: resumo,
          batida: false,
        };
  }
  const percentual =
    hoje.percentual_meta_bp === null
      ? null
      : `${formatarPercentual(hoje.percentual_meta_bp)} da meta de hoje`;
  return hoje.batida
    ? {
        destaque: "Meta de hoje batida",
        detalhe: [percentual && `${percentual}.`, vendidosHoje]
          .filter(Boolean)
          .join(" "),
        batida: true,
      }
    : {
        destaque: percentual ?? "Meta de hoje",
        detalhe: vendidosHoje,
        batida: false,
      };
}

// ---------------------------------------------------------------------------------------------------
// Situação (em dia ou abaixo), projeção e período
// ---------------------------------------------------------------------------------------------------

export type TextoSituacao = {
  tom: TomSituacao;
  titulo: string;
  detalhe: string;
  /** O ícone do chip (um nome de icones.ts; RIFA-053: antes, o caractere "↓"). Padrão: o do tom. */
  icone?: NomeIcone;
};

/** "Falta 1 bilhete", "Faltam 3 bilhetes". */
function faltamBilhetes(numero: number): string {
  return numero === 1 ? "Falta 1 bilhete" : `Faltam ${bilhetes(numero)}`;
}

/** Com a meta em centavos: "35% da meta; a curva esperava 36% até ontem". */
function comparacaoEmPercentual(ritmo: RitmoIndividual): string {
  if (
    ritmo.percentual_meta_bp === null ||
    ritmo.percentual_esperado_bp === null
  )
    return "";
  return `${formatarPercentual(ritmo.percentual_meta_bp)} da meta; a curva esperava ${formatarPercentual(ritmo.percentual_esperado_bp)} até ontem`;
}

/** Em dia, abaixo ou sem meta numa janela (período ou campanha), durante a campanha. */
export function situacaoDaJanela(
  ritmo: RitmoIndividual,
  unidade: UnidadeMeta,
): TextoSituacao {
  const diferenca = emBilhetes(ritmo.diferenca, unidade);
  switch (ritmo.situacao) {
    case "sem_meta":
      return {
        tom: "neutro",
        titulo: "Sem meta",
        detalhe: "Ainda não há meta para comparar.",
      };
    case "em_dia":
      return {
        tom: "sucesso",
        titulo: "Em dia",
        detalhe:
          diferenca === null
            ? comparacaoEmPercentual(ritmo)
            : diferenca > 0
              ? `${bilhetes(diferenca)} acima do esperado até ontem`
              : "Exatamente no esperado até ontem",
      };
    case "abaixo":
      return {
        tom: "alerta",
        icone: "caiu",
        titulo: "Abaixo do esperado",
        detalhe:
          diferenca === null
            ? comparacaoEmPercentual(ritmo)
            : `${faltamBilhetes(-diferenca)} para o esperado até ontem`,
      };
  }
}

/** Situação da campanha inteira na fase em que ela está; null antes do início (a contagem ocupa o lugar). */
export function situacaoDaCampanha(
  campanha: RitmoDaCampanha,
  referencia: ReferenciaCampanha,
  unidade: UnidadeMeta,
): TextoSituacao | null {
  if (referencia.fase === "antes") return null;
  if (campanha.situacao === "sem_meta")
    return situacaoDaJanela(campanha, unidade);
  if (referencia.fase === "durante" && referencia.dia_campanha === 1) {
    // No 1º dia ainda não há dia fechado: "acima do esperado até ontem" não diria nada.
    return {
      tom: "neutro",
      titulo: "1º dia de vendas",
      detalhe: "A comparação com a curva começa amanhã, com o 1º dia fechado.",
    };
  }
  if (referencia.fase === "encerrada") {
    // Depois do fim, o esperado é a meta inteira.
    const diferenca = emBilhetes(campanha.diferenca, unidade);
    const resultado =
      campanha.percentual_meta_bp === null
        ? ""
        : `Resultado: ${formatarPercentual(campanha.percentual_meta_bp)} da meta`;
    return campanha.situacao === "em_dia"
      ? {
          tom: "sucesso",
          titulo: "Meta batida",
          detalhe:
            diferenca === null
              ? resultado
              : diferenca > 0
                ? `${bilhetes(diferenca)} acima da meta`
                : "Exatamente a meta",
        }
      : {
          tom: "alerta",
          icone: "caiu",
          titulo: "Abaixo da meta",
          detalhe:
            diferenca === null
              ? resultado
              : `${-diferenca === 1 ? "Faltou 1 bilhete" : `Faltaram ${bilhetes(-diferenca)}`} para a meta`,
        };
  }
  return situacaoDaJanela(campanha, unidade);
}

/** Para onde a campanha vai no ritmo dos dias fechados; só durante, depois do 1º dia. */
export function textoDaProjecao(
  campanha: RitmoDaCampanha,
  referencia: ReferenciaCampanha,
): string | null {
  if (
    referencia.fase !== "durante" ||
    campanha.projecao_percentual_meta_bp === null
  )
    return null;
  return `No ritmo atual, chega a ${formatarPercentual(campanha.projecao_percentual_meta_bp)} da meta até ${formatarData(referencia.data_fim)}.`;
}

/** Situação do período atual; no 1º dia dele, neutra (o esperado do período começa a contar amanhã). */
export function situacaoDoPeriodo(
  periodo: RitmoIndividual,
  info: PeriodoDaReferencia,
  unidade: UnidadeMeta,
): TextoSituacao {
  if (info.dia_no_periodo === 1 && periodo.situacao !== "sem_meta") {
    return {
      tom: "neutro",
      titulo: `1º dia de ${info.nome}`,
      detalhe: "A comparação com a curva do período começa amanhã.",
    };
  }
  return situacaoDaJanela(periodo, unidade);
}

/** "Dia 2 de 7 · 03/12 a 09/12". */
export function textoDoPeriodo(info: PeriodoDaReferencia): string {
  return `Dia ${formatarNumero(info.dia_no_periodo)} de ${formatarNumero(info.dias)} · ${dataCurta(info.data_inicio)} a ${dataCurta(info.data_fim)}`;
}

// ---------------------------------------------------------------------------------------------------
// Gráfico
// ---------------------------------------------------------------------------------------------------

const SITUACAO_NA_FRASE: Record<RitmoIndividual["situacao"], string> = {
  em_dia: "em dia",
  abaixo: "abaixo do esperado",
  sem_meta: "sem meta",
};

/** Descrição do gráfico (leitor de tela): o que a curva mostra e a conclusão, sem a lista de valores. */
export function descricaoDaCurva(visao: RespostaVisaoIndividual): string {
  const { referencia } = visao;
  const { campanha } = visao.desempenho;
  const base = `O esperado acumulado sobe dia a dia de ${formatarData(referencia.data_inicio)} a ${formatarData(referencia.data_fim)}, até 100% da meta.`;
  const realizado =
    campanha.percentual_meta_bp === null
      ? null
      : formatarPercentual(campanha.percentual_meta_bp);
  switch (referencia.fase) {
    case "antes":
      return `${base} As vendas ainda não começaram.`;
    case "durante":
      if (referencia.dia_campanha === 1)
        return `${base} Hoje é o 1º dia (${formatarData(referencia.data)}): o realizado é ${realizado} da meta; a comparação com a curva começa amanhã.`;
      return `${base} Até hoje, dia ${formatarNumero(referencia.dia_campanha ?? 1)} (${formatarData(referencia.data)}), o realizado é ${realizado} da meta; o esperado até ontem era ${formatarPercentual(campanha.percentual_esperado_bp ?? 0)}: ${SITUACAO_NA_FRASE[campanha.situacao]}.`;
    case "encerrada":
      return `${base} Resultado final: ${realizado} da meta.`;
  }
}

// ---------------------------------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------------------------------

/** Título da disputa: "Semana 2 · 03/12 a 09/12"; a campanha toda; depois do fim, o resultado final. */
export function textoDaJanela(
  janela: JanelaRankingResposta,
  referencia: ReferenciaCampanha,
): string {
  if (janela.tipo === "campanha") {
    return referencia.fase === "encerrada"
      ? "Resultado final da campanha"
      : "Campanha inteira";
  }
  return `${janela.nome} · ${dataCurta(janela.data_inicio)} a ${dataCurta(janela.data_fim)}`;
}

/** "2º de 6". */
export function textoDaColocacao(posicao: PosicaoIndividual): string {
  return `${formatarPosicao(posicao.posicao)} de ${formatarNumero(posicao.participantes)}`;
}

/**
 * O vizinho de cima ou de baixo: só o nome e a posição, "Célula Betel (1º)". A distância (`diferenca`) nunca
 * aparece: somada ao número do alvo, ela revelaria o número do vizinho (D12).
 */
export function textoDoVizinho(vizinho: VizinhoIndividual | null): string {
  return vizinho === null
    ? "Ninguém"
    : `${vizinho.nome} (${formatarPosicao(vizinho.posicao)})`;
}

/**
 * Entre quem é a disputa: na divisão, "Entre as células dos Jovens"; no geral (divisao null), "Entre todas
 * as células, jovens e adultos"; sem ranking por divisão (D27, `porDivisao` false), só "Entre todas as células".
 */
export function textoDosPares(
  nivel: NivelRanking,
  divisao: Divisao | null,
  porDivisao = true,
): string {
  const { pares, artigo, todos } = PARES_DO_NIVEL[nivel];
  if (divisao !== null)
    return `Entre ${artigo} ${pares} dos ${NOMES_DIVISAO[divisao]}`;
  return porDivisao
    ? `Entre ${todos} ${pares}, jovens e adultos`
    : `Entre ${todos} ${pares}`;
}

/** O critério do ranking, em uma frase (sem valores). */
export const TEXTO_DO_CRITERIO: Record<Ranking["criterio"], string> = {
  percentual_meta: "A ordem é pelo % da meta de cada um.",
  bilhetes: "A ordem é pelos bilhetes vendidos.",
  arrecadacao: "A ordem é pela arrecadação de cada um.",
};

/** Quem o alvo é nas frases: "a sua célula", "você", "a sua rede". */
const QUEM: Record<TipoAlvo, string> = {
  celula: "a sua célula",
  discipulador: "você",
  rede: "a sua rede",
};

const CHAMADA: Record<TipoAlvo, string> = {
  celula: "Compartilhe o seu link de afiliado com amigos e familiares!",
  discipulador: "Anime os líderes das suas células!",
  rede: "Anime os discipuladores e os líderes da rede!",
};

/**
 * No lugar da posição, enquanto o alvo não vendeu nada: antes do início e durante, uma frase de incentivo;
 * depois do fim, o resultado.
 */
export function fraseSemVendas(
  tipo: TipoAlvo,
  referencia: ReferenciaCampanha,
): string {
  switch (referencia.fase) {
    case "antes":
      return `As vendas começam em ${formatarData(referencia.data_inicio)}: a primeira venda já coloca ${QUEM[tipo]} na disputa. ${CHAMADA[tipo]}`;
    case "durante":
      return `Falta só a primeira venda para ${QUEM[tipo]} entrar na disputa. ${CHAMADA[tipo]}`;
    case "encerrada":
      return tipo === "discipulador"
        ? "As suas células não tiveram vendas nesta campanha."
        : `${tipo === "celula" ? "A sua célula" : "A sua rede"} não teve vendas nesta campanha.`;
  }
}

/** Alvo sem células (R8): fica fora do ranking, com posições null. */
export function fraseSemCelulas(tipo: TipoAlvo): string {
  return tipo === "rede"
    ? "Ainda não há células nesta rede, por isso ela ainda não aparece no ranking das redes."
    : tipo === "discipulador"
      ? "Ainda não há células ligadas a você, por isso você ainda não aparece no ranking dos discipuladores."
      : "Esta célula ainda não aparece no ranking.";
}

// ---------------------------------------------------------------------------------------------------
// Equipe (discipulador e rede)
// ---------------------------------------------------------------------------------------------------

/** Situação curta de um alvo da equipe na campanha, para uma coluna da tabela. */
export function situacaoCurta(
  desempenho: DesempenhoIndividual,
  referencia: ReferenciaCampanha,
): { tom: TomBadge; texto: string } {
  const { situacao } = desempenho.campanha;
  if (situacao === "sem_meta") return { tom: "neutro", texto: "Sem meta" };
  if (referencia.fase === "antes")
    return { tom: "neutro", texto: "Ainda não começou" };
  if (referencia.fase === "durante" && referencia.dia_campanha === 1)
    return { tom: "neutro", texto: "1º dia" };
  if (referencia.fase === "encerrada")
    return situacao === "em_dia"
      ? { tom: "sucesso", texto: "Meta batida" }
      : { tom: "alerta", texto: "Abaixo da meta" };
  return situacao === "em_dia"
    ? { tom: "sucesso", texto: "Em dia" }
    : { tom: "alerta", texto: "Abaixo do esperado" };
}

/** "35%" ou "Sem meta". */
export function percentualDaMeta(percentualBp: number | null): string {
  return percentualBp === null ? "Sem meta" : formatarPercentual(percentualBp);
}

/** Quem ainda não aderiu: "1 célula ainda não aderiu" / "2 células ainda não aderiram". */
export function tituloSemAdesao(quantas: number): string {
  return quantas === 1
    ? "1 célula ainda não aderiu"
    : `${formatarNumero(quantas)} células ainda não aderiram`;
}

// ---------------------------------------------------------------------------------------------------
// Ajuda (RIFA-066, D31): a explicação dos títulos, com o mouse no título e no "?" ao lado (foco e toque), para quem
// nunca viu o sistema: o que é, para que serve e um exemplo. O cabeçalho, que fica no pacote inicial, pede estes
// textos sob demanda (este módulo já vem no pacote da visão): só textos, sem dinheiro.
// ---------------------------------------------------------------------------------------------------

export const AJUDA = {
  cabecalhoCelula:
    "A visão da sua célula na campanha: quanto da meta já foi vendido, a posição no ranking e o link de vendas. Só percentuais e bilhetes, sem dinheiro.",
  cabecalhoDiscipulador:
    "A sua visão de discipulador: a meta e o ranking das células que você acompanha, e o link de vendas de cada uma. Só percentuais e bilhetes, sem dinheiro.",
  cabecalhoRede:
    "A visão da sua rede: a meta, o ranking dos discipuladores e das células da rede e os links de vendas. Só percentuais e bilhetes, sem dinheiro.",
  cabecalho:
    "A sua visão da campanha: a meta, o ranking e o link de vendas, só com percentuais e bilhetes.",
  contagem:
    "Quantos dias faltam para as vendas começarem. A meta já aparece abaixo, para você se preparar.",
  metaDaCampanha:
    "Quanto da meta da campanha inteira já foi vendido. Ex.: 50% quer dizer que metade dos bilhetes da meta já saiu.",
  hoje: "Quanto vender hoje para ficar em dia com a meta e quanto já foi vendido hoje. Se ontem faltou, a falta entra na meta de hoje.",
  periodo:
    "A etapa em que a campanha está agora, normalmente uma semana, com a sua parte da meta e um ranking próprio. Toda semana é uma nova chance de subir.",
  curva:
    "O gráfico do que se esperava vender até cada dia contra o que foi vendido, em % da meta. Se a linha do vendido fica abaixo, é hora de acelerar.",
  ranking:
    "A sua posição na disputa e quem está logo acima e logo abaixo. Ex.: passar do 5º para o 3º lugar nesta semana.",
  naSuaDivisao:
    "A sua posição entre os da sua divisão (Jovens ou Adultos), que disputam entre si. Abaixo, quem está logo acima e logo abaixo.",
  geral: "A sua posição entre todos, com as duas divisões juntas.",
  suaPosicao:
    "A sua posição entre todos da disputa. Abaixo, quem está logo acima e logo abaixo.",
  primeiros:
    "Quem está na frente agora nesta disputa. Serve de alvo: veja quanto falta para chegar lá.",
  equipeRede:
    "Os discipuladores da sua rede e as células de cada um, com a posição e quanto da meta já fizeram. Serve para ver quem precisa de uma força.",
  equipeCelulas:
    "As células que você acompanha, com a posição e quanto da meta cada uma já fez. Serve para ver quem precisa de uma força.",
  links:
    "O link da Rifei da célula: toda compra feita por ele conta para a meta dela. Mande para quem vai comprar, pelo WhatsApp ou pelo QR code.",
  compradores:
    "Quem mais comprou bilhetes pelas suas células, com a célula de cada um. Serve para agradecer e para lembrar quem pode ajudar de novo. Ex.: em “Esta semana”, só as compras da semana.",
} as const;

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045): a explicação que aparece com o mouse parado (ou o foco do teclado) em cada botão e campo da
// visão individual. Dizem para que serve e o que acontece, sem repetir o rótulo. O "Sair" da moldura fica em
// textos-moldura.ts (vai no pacote inicial, como o minha-moldura.css); os do link de vendas, em components/qr.
// ---------------------------------------------------------------------------------------------------

export const DICAS = {
  dadosDaCurva:
    "Abre uma tabela, dia a dia, com o esperado e o realizado acumulados, em % da meta.",
  /** RIFA-083: a troca de janela dos maiores compradores. */
  janelaCompradores: {
    atual:
      "Mostra quem mais comprou no período de agora (normalmente a semana).",
    campanha: "Mostra quem mais comprou desde o primeiro dia da campanha.",
  } satisfies Record<JanelaRanking, string>,
} as const;

// ---------------------------------------------------------------------------------------------------
// Maiores compradores (RIFA-083, D38): só o nome, os bilhetes e a célula (sem telefone e sem dinheiro).
// ---------------------------------------------------------------------------------------------------

/** Os botões da troca de janela, na ordem. */
export const TEXTO_JANELA_COMPRADORES: Record<JanelaRanking, string> = {
  atual: "Esta semana",
  campanha: "Campanha toda",
};

/** Quando ainda ninguém comprou na janela. */
export function semCompras(janela: JanelaRanking): string {
  return janela === "atual"
    ? "Ainda não há compras nesta semana."
    : "Ainda não há compras na campanha.";
}

/** "Semana 2 · 30/11 a 06/12" ou "Campanha inteira · 23/11 a 13/12". */
export function textoDaJanelaDosCompradores(
  janela: JanelaRankingResposta,
): string {
  const nome = janela.tipo === "campanha" ? "Campanha inteira" : janela.nome;
  return `${nome} · ${dataCurta(janela.data_inicio)} a ${dataCurta(janela.data_fim)}`;
}
