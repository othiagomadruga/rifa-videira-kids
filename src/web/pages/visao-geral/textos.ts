// Textos da tela Visão geral (sem React): unidade da meta, fase e dia, situação, meta do dia, ritmo,
// projeção, totais dos avisos, a descrição do gráfico e os tipos do relatório para baixar (RIFA-038). Números, dinheiro, percentuais e datas sempre
// pelos formatadores (lib/formatadores); as regras e os números vêm prontos da API (calculos.ts).
import type {
  EscopoPainel,
  MetaDoDia,
  PeriodoDaReferencia,
  ReferenciaCampanha,
  RespostaPainelResumo,
  Ritmo,
  TotaisVendas,
  UnidadeMeta,
} from "../../../shared/contracts/calculos";
import type { TipoRelatorio } from "../../../shared/contracts/relatorio";
import type { NomeIcone, TomSituacao } from "../../components/ui";
import {
  formatarData,
  formatarMoeda,
  formatarNumero,
  formatarPercentual,
} from "../../lib/formatadores";

/** "1 dia", "13 dias", "1 pedido". */
export function contagem(
  numero: number,
  singular: string,
  plural: string,
): string {
  return `${formatarNumero(numero)} ${numero === 1 ? singular : plural}`;
}

/** Na unidade da meta: "139 bilhetes", "1 bilhete" ou "R$ 2.780,00". */
export function quantidade(valor: number, unidade: UnidadeMeta): string {
  return unidade === "centavos"
    ? formatarMoeda(valor)
    : contagem(valor, "bilhete", "bilhetes");
}

/** Sem a palavra "bilhetes" (gráfico e tabela, que dizem a unidade no título): "139" ou "R$ 2.780,00". */
export function valorCurto(valor: number, unidade: UnidadeMeta): string {
  return unidade === "centavos" ? formatarMoeda(valor) : formatarNumero(valor);
}

/** Marca do eixo do gráfico. Em R$, sem os centavos, porque as marcas são reais inteiros: "R$ 20.000". */
export function valorDoEixo(valor: number, unidade: UnidadeMeta): string {
  return unidade === "centavos"
    ? formatarMoeda(valor).replace(/,00$/, "")
    : formatarNumero(valor);
}

/** A unidade nos títulos: "bilhetes" ou "R$". */
export const NOME_DA_UNIDADE: Record<UnidadeMeta, string> = {
  bilhetes: "bilhetes",
  centavos: "R$",
};

/** "23/11": o dia do calendário, sem trocar de dia. */
export function dataCurta(data: string): string {
  return formatarData(data).slice(0, 5);
}

/** O verbo concorda com a quantidade: 1 bilhete "faltou"; 2 bilhetes ou R$ 20,00 "faltaram". */
function concordar(
  valor: number,
  unidade: UnidadeMeta,
  singular: string,
  plural: string,
): string {
  return unidade === "bilhetes" && valor === 1 ? singular : plural;
}

export const ROTULO_DO_ESCOPO: Record<EscopoPainel, string> = {
  campanha: "Campanha toda",
  divisao: "Divisão",
  rede: "Rede",
  discipulador: "Discipulador",
  celula: "Célula",
};

/**
 * Fase, dia da campanha e período (CA1). `partes` é o título dividido onde ele pode quebrar de linha
 * ("Dia 12 de 24" · "Semana 2 (faltam 6 dias)"); juntas com " · ", dão o `titulo`.
 */
export function textoDaFase(referencia: ReferenciaCampanha): {
  titulo: string;
  partes: string[];
  detalhe: string;
} {
  const inicio = formatarData(referencia.data_inicio);
  const fim = formatarData(referencia.data_fim);
  const duracao = contagem(referencia.duracao_dias, "dia", "dias");
  switch (referencia.fase) {
    case "antes": {
      const dias = referencia.dias_para_inicio ?? 0;
      const titulo =
        dias === 1
          ? "A campanha começa amanhã"
          : `A campanha começa em ${contagem(dias, "dia", "dias")}`;
      return {
        titulo,
        partes: [titulo],
        detalhe: `De ${inicio} a ${fim}: ${duracao} de vendas.`,
      };
    }
    case "durante": {
      const { periodo } = referencia;
      const dia = `Dia ${formatarNumero(referencia.dia_campanha ?? 0)} de ${formatarNumero(referencia.duracao_dias)}`;
      const partes = periodo
        ? [
            dia,
            `${periodo.nome} (${
              periodo.dias_restantes === 1
                ? "último dia"
                : `faltam ${contagem(periodo.dias_restantes, "dia", "dias")}`
            })`,
          ]
        : [dia];
      return {
        titulo: partes.join(" · "),
        partes,
        detalhe:
          referencia.dias_restantes === 1
            ? `Hoje é o último dia da campanha (${fim}).`
            : `Faltam ${contagem(referencia.dias_restantes, "dia", "dias")}, contando hoje (até ${fim}).`,
      };
    }
    case "encerrada":
      return {
        titulo: "Campanha encerrada",
        partes: ["Campanha encerrada"],
        detalhe: `Foi de ${inicio} a ${fim} (${duracao} de vendas).`,
      };
  }
}

export type TextoSituacao = {
  tom: TomSituacao;
  titulo: string;
  detalhe: string;
  /** O ícone do chip (um nome de icones.ts; RIFA-053: antes, o caractere "↓"). Padrão: o do tom. */
  icone?: NomeIcone;
};

/** "Falta 1 bilhete", "Faltam 20 bilhetes", "Faltam R$ 60,00". */
export function faltam(valor: number, unidade: UnidadeMeta): string {
  return `${concordar(valor, unidade, "Falta", "Faltam")} ${quantidade(valor, unidade)}`;
}

/** Situação de uma janela (período ou campanha) durante a campanha: em dia, abaixo (e quanto) ou sem meta. */
export function situacaoDaJanela(
  ritmo: Ritmo,
  unidade: UnidadeMeta,
): TextoSituacao {
  switch (ritmo.situacao) {
    case "sem_meta":
      return {
        tom: "neutro",
        titulo: "Sem meta",
        detalhe: "Não há meta para cobrar aqui.",
      };
    case "em_dia":
      return {
        tom: "sucesso",
        titulo: "Em dia",
        detalhe:
          ritmo.diferenca > 0
            ? `${quantidade(ritmo.diferenca, unidade)} acima do esperado até ontem`
            : "Exatamente no esperado até ontem",
      };
    case "abaixo":
      return {
        tom: "alerta",
        icone: "caiu",
        titulo: "Abaixo do esperado",
        detalhe: `${faltam(-ritmo.diferenca, unidade)} para o esperado até ontem`,
      };
  }
}

/** Situação da campanha inteira, na fase em que ela está (antes, durante ou encerrada). */
export function situacaoDaCampanha(
  resumo: RespostaPainelResumo,
): TextoSituacao {
  const { campanha, referencia, unidade } = resumo;
  if (referencia.fase === "antes") {
    return {
      tom: "neutro",
      titulo: "Ainda não começou",
      detalhe: `Meta: ${quantidade(campanha.meta, unidade)}`,
    };
  }
  if (referencia.fase === "durante" && referencia.dia_campanha === 1) {
    // No 1º dia ainda não há dia fechado: "acima do esperado até ontem" não diria nada.
    return {
      tom: "neutro",
      titulo: "1º dia de vendas",
      detalhe: "A comparação com a curva começa amanhã, com o 1º dia fechado.",
    };
  }
  if (referencia.fase === "encerrada" && campanha.situacao !== "sem_meta") {
    // Depois do fim, o esperado é a meta inteira.
    return campanha.situacao === "em_dia"
      ? {
          tom: "sucesso",
          titulo: "Meta batida",
          detalhe:
            campanha.diferenca > 0
              ? `${quantidade(campanha.diferenca, unidade)} acima da meta`
              : "Exatamente a meta",
        }
      : {
          tom: "alerta",
          icone: "caiu",
          titulo: "Abaixo da meta",
          detalhe: `${concordar(-campanha.diferenca, unidade, "Faltou", "Faltaram")} ${quantidade(-campanha.diferenca, unidade)} para a meta`,
        };
  }
  return situacaoDaJanela(campanha, unidade);
}

/** Situação do período atual; no 1º dia dele, neutra (o esperado do período começa a contar amanhã). */
export function situacaoDoPeriodo(
  periodo: Ritmo,
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

/** De onde sai a meta de hoje: a parte da curva, mais o que faltou ou menos o que sobrou até ontem (R3). */
export function explicacaoDaMetaDoDia(
  hoje: MetaDoDia,
  unidade: UnidadeMeta,
  ultimoDia: boolean,
): string {
  if (ultimoDia) {
    return hoje.meta === 0
      ? "Último dia: a meta da campanha já foi alcançada até ontem."
      : "Último dia: a meta de hoje é tudo o que falta para a meta da campanha.";
  }
  const base = quantidade(hoje.meta_base, unidade);
  const ajuste = hoje.meta - hoje.meta_base;
  if (hoje.meta === 0)
    return `O que sobrou até ontem já cobre a curva de hoje (${base}).`;
  if (ajuste > 0)
    return `${base} da curva de hoje + ${quantidade(ajuste, unidade)} que ${concordar(ajuste, unidade, "faltou", "faltaram")} até ontem.`;
  if (ajuste < 0)
    return `${base} da curva de hoje − ${quantidade(-ajuste, unidade)} que ${concordar(-ajuste, unidade, "sobrou", "sobraram")} até ontem.`;
  return "É a parte da curva de hoje.";
}

/** "101% do esperado até ontem"; null enquanto não há dia fechado com esperado. */
export function textoDoRitmo(ritmoBp: number | null): string | null {
  return ritmoBp === null
    ? null
    : `${formatarPercentual(ritmoBp)} do esperado até ontem`;
}

/** Para onde a campanha vai no ritmo dos dias fechados (R5), ou o resultado depois do fim. */
export function textoDaProjecao(resumo: RespostaPainelResumo): string {
  const { campanha, referencia, unidade } = resumo;
  if (referencia.fase === "encerrada") {
    const total = quantidade(campanha.realizado, unidade);
    return campanha.percentual_meta_bp === null
      ? `Resultado final: ${total}.`
      : `Resultado final: ${formatarPercentual(campanha.percentual_meta_bp)} da meta (${total}).`;
  }
  if (campanha.projecao === null) {
    return referencia.fase === "antes"
      ? "A projeção aparece depois do 1º dia de vendas."
      : "Sem projeção ainda: ela aparece depois do 1º dia fechado.";
  }
  const total = quantidade(campanha.projecao, unidade);
  return campanha.projecao_percentual_meta_bp === null
    ? `No ritmo atual, termina com ${total}.`
    : `No ritmo atual, chega a ${formatarPercentual(campanha.projecao_percentual_meta_bp)} da meta (${total}).`;
}

/** Totais de um aviso, na unidade da meta: "3 bilhetes (1 pedido)" ou "R$ 60,00 (1 pedido)". */
export function textoDosTotais(
  totais: TotaisVendas,
  unidade: UnidadeMeta,
): string {
  const valor =
    unidade === "centavos"
      ? formatarMoeda(totais.total_centavos)
      : contagem(totais.bilhetes, "bilhete", "bilhetes");
  return `${valor} (${contagem(totais.pedidos_aprovados, "pedido", "pedidos")})`;
}

/** As vendas aprovadas do recorte, com o valor arrecadado (a coordenação pode ver R$). */
export function textoDasVendas(totais: TotaisVendas): string {
  return [
    contagem(totais.pedidos_aprovados, "pedido aprovado", "pedidos aprovados"),
    contagem(totais.bilhetes, "bilhete", "bilhetes"),
    formatarMoeda(totais.total_centavos),
  ].join(" · ");
}

/** Estado vazio antes da 1ª venda do recorte. */
export function textoSemVendas(resumo: RespostaPainelResumo): {
  titulo: string;
  descricao: string;
} {
  const { referencia, escopo } = resumo;
  const naCampanha = escopo.tipo === "campanha";
  switch (referencia.fase) {
    case "antes":
      return {
        titulo: "Nenhuma venda ainda",
        descricao: `As vendas contam a partir de ${formatarData(referencia.data_inicio)}, o 1º dia da campanha.`,
      };
    case "durante":
      return {
        titulo: "Nenhuma venda ainda",
        descricao: naCampanha
          ? "Assim que o primeiro pedido for aprovado na Rifei, ele aparece aqui."
          : `Ainda não há venda aprovada para ${escopo.nome}. Assim que houver, ela aparece aqui.`,
      };
    case "encerrada":
      return {
        titulo: "Nenhuma venda",
        descricao: naCampanha
          ? "A campanha terminou sem vendas aprovadas."
          : `${escopo.nome} terminou a campanha sem vendas aprovadas.`,
      };
  }
}

const SITUACAO_NA_FRASE: Record<Ritmo["situacao"], string> = {
  em_dia: "em dia",
  abaixo: "abaixo do esperado",
  sem_meta: "sem meta",
};

/** Descrição do gráfico (leitor de tela): o que a curva mostra e a conclusão, sem a lista de valores. */
export function descricaoDaCurva(resumo: RespostaPainelResumo): string {
  const { referencia, curva, unidade, campanha } = resumo;
  const meta = curva.at(-1)?.esperado ?? campanha.meta;
  const base = `O esperado acumulado sobe de ${formatarData(referencia.data_inicio)} a ${formatarData(referencia.data_fim)}, até a meta de ${quantidade(meta, unidade)}.`;
  switch (referencia.fase) {
    case "antes":
      return `${base} As vendas ainda não começaram.`;
    case "durante":
      // No 1º dia ainda não há dia fechado: nem "em dia" nem "abaixo", como no cartão da campanha.
      if (referencia.dia_campanha === 1)
        return `${base} Hoje é o 1º dia (${formatarData(referencia.data)}): o realizado é ${quantidade(campanha.realizado, unidade)}; a comparação com a curva começa amanhã.`;
      return `${base} Até hoje, dia ${formatarNumero(referencia.dia_campanha ?? 0)} (${formatarData(referencia.data)}), o realizado é ${quantidade(campanha.realizado, unidade)}; o esperado até ontem era ${quantidade(campanha.esperado, unidade)}: ${SITUACAO_NA_FRASE[campanha.situacao]}.`;
    case "encerrada":
      return `${base} Resultado final: ${quantidade(campanha.realizado, unidade)}.`;
  }
}

/**
 * Relatório da campanha (RIFA-038, D23): o nome e uma linha que explica cada tipo, em linguagem simples. A ordem
 * da tela é a de TIPOS_RELATORIO (contrato); um tipo novo no contrato falha aqui no typecheck. RIFA-061 (D27): "posição
 * no ranking" vale com e sem ranking por divisão (a coluna do arquivo diz "Posição na divisão" ou "Posição no
 * ranking"; o cartão não lê a campanha).
 */
export const TEXTOS_TIPO_RELATORIO = {
  totais: {
    rotulo: "Totais da campanha",
    descricao:
      "Uma linha com o resultado geral: meta, bilhetes, arrecadação e % da meta.",
  },
  celulas: {
    rotulo: "Por célula",
    descricao:
      "Cada célula com rede, discipulador, líder, vendas, % da meta e posição no ranking.",
  },
  discipuladores: {
    rotulo: "Por discipulador",
    descricao:
      "Cada discipulador com a soma das células dele, % da meta e posição no ranking.",
  },
  redes: {
    rotulo: "Por rede",
    descricao:
      "Cada rede com a soma das células dela, % da meta e posição no ranking.",
  },
  periodos: {
    rotulo: "Por período",
    descricao: "Bilhetes e arrecadação de cada período que já começou.",
  },
  dias: {
    rotulo: "Por dia",
    descricao: "Bilhetes e arrecadação de cada dia, do primeiro até hoje.",
  },
  ddd: {
    rotulo: "Por DDD",
    descricao:
      "Vendas pelo DDD do telefone de quem comprou, como no Mapa (sem dado pessoal).",
  },
} as const satisfies Record<
  TipoRelatorio,
  { rotulo: string; descricao: string }
>;

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045): a explicação que aparece com o mouse parado (ou o foco do teclado) em cada botão e campo da
// tela. Dizem para que serve e o que acontece, sem repetir o rótulo.
// ---------------------------------------------------------------------------------------------------

export const DICAS = {
  filtro:
    "Mostra o painel de uma divisão, rede, discipulador ou célula. A escolha fica no endereço da página.",
  atualizar:
    "Busca os números agora, sem esperar a próxima atualização automática.",
  verCampanhaToda:
    "Tira o recorte e volta a mostrar o painel da campanha inteira.",
  dadosDaCurva:
    "Abre uma tabela, dia a dia, com o esperado e o realizado acumulados e o vendido no dia.",
  /** Um rádio por tipo do relatório: para que serve a planilha (a linha embaixo do nome diz o que ela traz). */
  tipoRelatorio: {
    totais:
      "Para prestar contas ou mostrar o resultado geral. A planilha tem uma linha só.",
    celulas:
      "Para comparar as células entre si. A planilha tem uma linha por célula, para ordenar e filtrar no Excel.",
    discipuladores:
      "Para acompanhar cada discipulador. A planilha tem uma linha por discipulador.",
    redes: "Para comparar as redes. A planilha tem uma linha por rede.",
    periodos:
      "Para comparar os períodos da campanha entre si. A planilha tem uma linha por período.",
    dias: "Para ver o ritmo das vendas, dia a dia. A planilha tem uma linha por dia.",
    ddd: "Para saber de que regiões vêm as vendas. A planilha tem uma linha por DDD, como a tabela da tela Mapa.",
  } satisfies Record<TipoRelatorio, string>,
  baixarRelatorio:
    "Gera a planilha do tipo escolhido com os números de agora e salva no aparelho.",
  baixando: "Indisponível enquanto o relatório baixa. Espere um instante.",
  tentarBaixarDeNovo:
    "Pede o mesmo relatório de novo. Se continuar falhando, confira a internet.",
} as const;

/**
 * Com uma rede só (RIFA-065, D30), os textos que citavam a rede, sem ela. O relatório "Por rede" sai da lista; o
 * arquivo das células continua com a coluna "Rede" (é o arquivo de trabalho da coordenação, montado pela API).
 */
export const TEXTOS_REDE_UNICA = {
  filtro:
    "Mostra o painel de uma divisão, de um discipulador ou de uma célula. A escolha fica no endereço da página.",
  falhaDoFiltro:
    "Não foi possível carregar as células. Toque em Atualizar para tentar de novo.",
  relatorioCelulas:
    "Cada célula com discipulador, líder, vendas, % da meta e posição no ranking.",
} as const;
