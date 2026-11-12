// Apoio dos testes da visão individual (/minha): as sessões de líder, discipulador e rede (nomes fictícios),
// respostas de GET /api/minha/visao montadas para cada cenário e uma API falsa (o fetch simulado) que guarda
// as chamadas. Toda resposta passa pelo respostaVisaoIndividualSchema do contrato (estrito e com as regras
// cruzadas: sem dinheiro, curva coerente com a fase, equipe só de quem está abaixo do alvo).
//
// A campanha fictícia é a dos exemplos de docs/api.md: 24 dias a partir de 23/11/2026, períodos de 10, 7 e
// 7 dias com 35/25/45 (normalizados), consultada em 04/12/2026 (dia 12, 2º dia da Semana 2).
import { vi } from "vitest";
import {
  respostaMeusLinksVendasSchema,
  respostaVisaoIndividualSchema,
  type Alvo,
  type CriterioRanking,
  type DesempenhoIndividual,
  type ItemEquipe,
  type PapelHierarquia,
  type ReferenciaCampanha,
  type RespostaMeusLinksVendas,
  type RespostaVisaoIndividual,
  type UnidadeMeta,
  type UsuarioSessao,
} from "../../../shared/contracts";
import { respostaJson } from "../../test/renderizar";

// ---------------------------------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------------------------------

export const ALVO_CELULA: Alvo = {
  tipo: "celula",
  id: 1,
  nome: "Célula Ágape",
  divisao: "jovens",
};
export const ALVO_DISCIPULADOR: Alvo = {
  tipo: "discipulador",
  id: 10,
  nome: "Davi Fictício",
  divisao: "jovens",
};
export const ALVO_REDE: Alvo = {
  tipo: "rede",
  id: 100,
  nome: "Rede Jovem Fictícia",
  divisao: "jovens",
};
/** Alvos sem nenhuma célula (fora do ranking, R8). */
const ALVO_DISCIPULADOR_SEM_CELULAS: Alvo = {
  tipo: "discipulador",
  id: 12,
  nome: "Lucas Fictício",
  divisao: "jovens",
};
const ALVO_REDE_SEM_CELULAS: Alvo = {
  tipo: "rede",
  id: 101,
  nome: "Rede Nova Fictícia",
  divisao: "jovens",
};

export const LIDER: UsuarioSessao = {
  id: 2001,
  nome: "Maria Fictícia",
  papel: "lider",
  alvo: ALVO_CELULA,
};
export const DISCIPULADOR: UsuarioSessao = {
  id: 2002,
  nome: "Davi Fictício",
  papel: "discipulador",
  alvo: ALVO_DISCIPULADOR,
};
export const REDE: UsuarioSessao = {
  id: 2003,
  nome: "Pastor Fictício",
  papel: "rede",
  alvo: ALVO_REDE,
};
export const SESSOES: Record<PapelHierarquia, UsuarioSessao> = {
  lider: LIDER,
  discipulador: DISCIPULADOR,
  rede: REDE,
};

const PAPEL_DO_TIPO = {
  celula: "lider",
  discipulador: "discipulador",
  rede: "rede",
} as const satisfies Record<Alvo["tipo"], PapelHierarquia>;

/** A sessão de quem recebe esta visão (o alvo e o nome da própria resposta). */
export function sessaoDaVisao(visao: RespostaVisaoIndividual): UsuarioSessao {
  return {
    id: 2000 + visao.alvo.id,
    nome: visao.pessoa,
    papel: PAPEL_DO_TIPO[visao.alvo.tipo],
    alvo: visao.alvo,
  };
}

// ---------------------------------------------------------------------------------------------------
// Campanha e referência
// ---------------------------------------------------------------------------------------------------

const INICIO = "2026-11-23";
const FIM = "2026-12-16";
const DURACAO = 24;
const PERIODOS = [
  { nome: "Semana 1", dias: 10, peso: 3500 },
  { nome: "Semana 2", dias: 7, peso: 2500 },
  { nome: "Semana 3", dias: 7, peso: 4500 },
] as const;
const PESO_TOTAL = 10_500;
/** Hoje, durante a campanha: dia 12 (04/12/2026), o 2º da Semana 2. */
const DIA_DE_HOJE = 12;

export type Fase = ReferenciaCampanha["fase"];

export const REFERENCIAS: Record<Fase, ReferenciaCampanha> = {
  antes: {
    data: "2026-11-20",
    fase: "antes",
    data_inicio: INICIO,
    data_fim: FIM,
    duracao_dias: DURACAO,
    dia_campanha: null,
    dias_restantes: DURACAO,
    dias_para_inicio: 3,
    periodo: null,
  },
  durante: {
    data: "2026-12-04",
    fase: "durante",
    data_inicio: INICIO,
    data_fim: FIM,
    duracao_dias: DURACAO,
    dia_campanha: DIA_DE_HOJE,
    dias_restantes: 13,
    dias_para_inicio: null,
    periodo: {
      ordem: 2,
      nome: "Semana 2",
      data_inicio: "2026-12-03",
      data_fim: "2026-12-09",
      dias: 7,
      dia_no_periodo: 2,
      dias_restantes: 6,
    },
  },
  encerrada: {
    data: "2026-12-20",
    fase: "encerrada",
    data_inicio: INICIO,
    data_fim: FIM,
    duracao_dias: DURACAO,
    dia_campanha: null,
    dias_restantes: 0,
    dias_para_inicio: null,
    periodo: null,
  },
};

const ATUALIZADO_EM: Record<Fase, string> = {
  antes: "2026-11-20T18:30:00.000Z",
  durante: "2026-12-04T18:30:00.000Z",
  encerrada: "2026-12-20T18:30:00.000Z",
};

function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias))
    .toISOString()
    .slice(0, 10);
}

/** Fração da meta que a curva espera até o fim do dia `dia` (0 = antes do 1º dia). */
function fracaoEsperada(dia: number): number {
  let acumulado = 0;
  let inicio = 0;
  for (const { dias, peso } of PERIODOS) {
    acumulado += (peso * Math.min(Math.max(dia - inicio, 0), dias)) / dias;
    inicio += dias;
  }
  return dia >= DURACAO ? 1 : acumulado / PESO_TOTAL;
}

const truncarBp = (fracao: number) => Math.floor(fracao * 10_000 + 1e-9);
const somar = (valores: readonly number[]) =>
  valores.reduce((total, valor) => total + valor, 0);

// ---------------------------------------------------------------------------------------------------
// Números de um alvo
// ---------------------------------------------------------------------------------------------------

/** Meta da campanha (bilhetes) e os bilhetes vendidos por dia, do 1º ao último dia da campanha. */
type Numeros = { meta: number; vendas: readonly number[] };

/** Desempenho na fase, com a meta em bilhetes (a conversão para centavos fica em `semQuantidades`). */
function desempenhoDe(
  { meta, vendas }: Numeros,
  fase: Fase,
): DesempenhoIndividual {
  const semMeta = meta === 0;
  const bp = (valor: number, base: number) =>
    base === 0 ? null : truncarBp(valor / base);
  if (fase === "antes") {
    return {
      hoje: null,
      periodo: null,
      campanha: {
        meta,
        esperado: 0,
        realizado: 0,
        diferenca: 0,
        situacao: semMeta ? "sem_meta" : "em_dia",
        percentual_meta_bp: semMeta ? null : 0,
        percentual_esperado_bp: semMeta ? null : 0,
        projecao_percentual_meta_bp: null,
      },
      bilhetes: { campanha: 0, hoje: null },
    };
  }
  const dias = fase === "durante" ? DIA_DE_HOJE : DURACAO;
  const vendidas = vendas.slice(0, dias);
  const realizado = somar(vendidas);
  const ateOntem = somar(vendidas.slice(0, -1));
  const fechados = fase === "durante" ? dias - 1 : DURACAO;
  const esperadoExato = meta * fracaoEsperada(fechados);
  const esperado = Math.ceil(esperadoExato - 1e-9);
  const situacao = semMeta
    ? "sem_meta"
    : realizado >= esperado
      ? "em_dia"
      : "abaixo";
  const campanha = {
    meta,
    esperado,
    realizado,
    diferenca: realizado - esperado,
    situacao,
    percentual_meta_bp: bp(realizado, meta),
    percentual_esperado_bp: semMeta
      ? null
      : truncarBp(fracaoEsperada(fechados)),
    projecao_percentual_meta_bp:
      fase === "encerrada"
        ? bp(realizado, meta)
        : esperadoExato > 0 && !semMeta
          ? truncarBp(ateOntem / esperadoExato)
          : null,
  } as const;
  if (fase === "encerrada") {
    return {
      hoje: null,
      periodo: null,
      campanha,
      bilhetes: { campanha: realizado, hoje: null },
    };
  }
  // Durante: hoje (R3) e o período atual (Semana 2: dias 11 a 17).
  const vendidoHoje = vendidas[dias - 1];
  const metaHoje = Math.max(
    0,
    Math.ceil(meta * fracaoEsperada(dias) - 1e-9) - ateOntem,
  );
  const metaPeriodo = (meta * PERIODOS[1].peso) / PESO_TOTAL;
  const diaNoPeriodo = dias - PERIODOS[0].dias;
  const esperadoPeriodo = Math.ceil(
    (metaPeriodo * (diaNoPeriodo - 1)) / PERIODOS[1].dias - 1e-9,
  );
  const realizadoPeriodo = somar(vendidas.slice(PERIODOS[0].dias));
  return {
    hoje: {
      data: REFERENCIAS.durante.data,
      meta: metaHoje,
      realizado: vendidoHoje,
      falta: Math.max(0, metaHoje - vendidoHoje),
      percentual_meta_bp: bp(vendidoHoje, metaHoje),
      batida: vendidoHoje >= metaHoje,
    },
    periodo: {
      meta: Math.ceil(metaPeriodo - 1e-9),
      esperado: esperadoPeriodo,
      realizado: realizadoPeriodo,
      diferenca: realizadoPeriodo - esperadoPeriodo,
      situacao: semMeta
        ? "sem_meta"
        : realizadoPeriodo >= esperadoPeriodo
          ? "em_dia"
          : "abaixo",
      percentual_meta_bp: bp(realizadoPeriodo, metaPeriodo),
      percentual_esperado_bp: semMeta
        ? null
        : truncarBp((diaNoPeriodo - 1) / PERIODOS[1].dias),
    },
    campanha,
    bilhetes: { campanha: realizado, hoje: vendidoHoje },
  };
}

/** Com a meta em centavos, as quantidades na unidade da meta saem null (seriam dinheiro); ficam os %. */
function semQuantidades(
  desempenho: DesempenhoIndividual,
): DesempenhoIndividual {
  const { hoje, periodo, campanha } = desempenho;
  const vazio = {
    meta: null,
    esperado: null,
    realizado: null,
    diferenca: null,
  };
  return {
    ...desempenho,
    hoje: hoje && { ...hoje, meta: null, realizado: null, falta: null },
    periodo: periodo && { ...periodo, ...vazio },
    campanha: { ...campanha, ...vazio },
  };
}

/** A curva em pontos-base da meta: um ponto por dia; vazia sem meta. */
function curvaDe({ meta, vendas }: Numeros, fase: Fase) {
  if (meta === 0) return [];
  const comDado =
    fase === "antes" ? 0 : fase === "durante" ? DIA_DE_HOJE : DURACAO;
  let acumulado = 0;
  return Array.from({ length: DURACAO }, (_, indice) => {
    const dia = indice + 1;
    acumulado += vendas[indice] ?? 0;
    return {
      dia,
      data: somarDias(INICIO, indice),
      esperado_bp: truncarBp(fracaoEsperada(dia)),
      realizado_bp: dia <= comDado ? truncarBp(acumulado / meta) : null,
    };
  });
}

// Vendas fictícias por dia (24 dias). Ágape: abaixo do esperado no dia 12 (42 de 120) e acima da meta no
// fim; Betel: em dia; Canaã: sem vendas (o líder ainda não aderiu); Dorcas: com o Elias.
const VENDAS = {
  agape: [
    4, 3, 5, 4, 2, 4, 3, 4, 5, 3, 3, 2, 6, 5, 7, 6, 5, 8, 7, 6, 9, 8, 7, 10,
  ],
  betel: [
    3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  ],
  canaa: Array.from({ length: DURACAO }, () => 0),
  dorcas: Array.from({ length: DURACAO }, (_, dia) => (dia % 3 === 0 ? 3 : 2)),
};

const somarVendas = (...listas: (readonly number[])[]) =>
  Array.from({ length: DURACAO }, (_, dia) =>
    somar(listas.map((lista) => lista[dia])),
  );

const NUMEROS = {
  agape: { meta: 120, vendas: VENDAS.agape },
  agapeSemVendas: { meta: 120, vendas: VENDAS.canaa },
  betel: { meta: 60, vendas: VENDAS.betel },
  canaa: { meta: 120, vendas: VENDAS.canaa },
  dorcas: { meta: 100, vendas: VENDAS.dorcas },
  davi: {
    meta: 300,
    vendas: somarVendas(VENDAS.agape, VENDAS.betel, VENDAS.canaa),
  },
  elias: { meta: 100, vendas: VENDAS.dorcas },
  semCelulas: { meta: 0, vendas: VENDAS.canaa },
  rede: {
    meta: 400,
    vendas: somarVendas(
      VENDAS.agape,
      VENDAS.betel,
      VENDAS.canaa,
      VENDAS.dorcas,
    ),
  },
} satisfies Record<string, Numeros>;

// ---------------------------------------------------------------------------------------------------
// Ranking e equipe
// ---------------------------------------------------------------------------------------------------

type Ranking = RespostaVisaoIndividual["ranking"];
type Posicao = NonNullable<Ranking["geral"]>;

const vizinho = (nome: string, posicao: number) => ({
  nome,
  posicao,
  diferenca: null,
});

const JANELAS: Record<Fase, Ranking["janela"]> = {
  antes: {
    tipo: "atual",
    ordem: 1,
    nome: "Semana 1",
    data_inicio: INICIO,
    data_fim: "2026-12-02",
  },
  durante: {
    tipo: "atual",
    ordem: 2,
    nome: "Semana 2",
    data_inicio: "2026-12-03",
    data_fim: "2026-12-09",
  },
  // Depois do fim, a tela pede a campanha inteira (o resultado final).
  encerrada: {
    tipo: "campanha",
    ordem: null,
    nome: "Campanha inteira",
    data_inicio: INICIO,
    data_fim: FIM,
  },
};

/** Antes da 1ª venda de todos: todos empatados em 1º, ninguém nos primeiros. */
const empatados = (participantes: number): Posicao => ({
  posicao: 1,
  participantes,
  acima: null,
  abaixo: null,
});

function itemCelula(
  id: number,
  nome: string,
  discipuladorId: number,
  liderNome: string,
  afiliados: number,
  desempenho: DesempenhoIndividual,
  posicao: number,
): ItemEquipe {
  return {
    tipo: "celula",
    id,
    nome,
    discipulador_id: discipuladorId,
    lider_nome: liderNome,
    afiliados_vinculados: afiliados,
    desempenho,
    posicao_divisao: posicao,
  };
}

function itemDiscipulador(
  id: number,
  nome: string,
  desempenho: DesempenhoIndividual,
  posicao: number | null,
): ItemEquipe {
  return {
    tipo: "discipulador",
    id,
    nome,
    discipulador_id: null,
    lider_nome: null,
    afiliados_vinculados: null,
    desempenho,
    posicao_divisao: posicao,
  };
}

// ---------------------------------------------------------------------------------------------------
// A visão de cada cenário
// ---------------------------------------------------------------------------------------------------

export type Cenario = {
  /** De quem é a visão (padrão: líder). */
  papel?: PapelHierarquia;
  /** Padrão: durante (dia 12 de 24). */
  fase?: Fase;
  /** Padrão: bilhetes. Com centavos, só percentuais (as quantidades da meta saem null). */
  unidade?: UnidadeMeta;
  /** Líder: a célula ainda não vendeu nada (frase de incentivo no lugar da posição). */
  semVendas?: boolean;
  /** Discipulador ou rede sem células: fora do ranking, sem meta e sem curva. */
  semCelulas?: boolean;
  /** Líder: afiliados vinculados à célula (padrão 2; 0 = o aviso de adesão). */
  afiliados?: number;
  /** Líder: a célula lidera a divisão (sem ninguém acima). */
  primeiroLugar?: boolean;
  criterio?: CriterioRanking;
};

/** A resposta de GET /api/minha/visao no cenário, conferida pelo schema do contrato. */
export function visaoDe(cenario: Cenario = {}): RespostaVisaoIndividual {
  const {
    papel = "lider",
    fase = "durante",
    unidade = "bilhetes",
    semVendas = false,
    semCelulas = false,
    afiliados = 2,
    primeiroLugar = false,
    criterio = "percentual_meta",
  } = cenario;
  const desempenho = (numeros: Numeros) => {
    const calculado = desempenhoDe(numeros, fase);
    return unidade === "centavos" ? semQuantidades(calculado) : calculado;
  };
  const antes = fase === "antes";

  let alvo: Alvo;
  let pessoa: string;
  let numeros: Numeros;
  let geral: Posicao | null;
  let divisao: Posicao | null;
  let primeiros: Ranking["primeiros"];
  let equipe: ItemEquipe[] = [];
  const primeiro = (posicao: number, nome: string, eu = false) => ({
    posicao,
    nome,
    eu,
  });

  if (papel === "lider") {
    alvo = ALVO_CELULA;
    pessoa = LIDER.nome;
    numeros = semVendas ? NUMEROS.agapeSemVendas : NUMEROS.agape;
    if (antes) {
      [geral, divisao, primeiros] = [empatados(12), empatados(6), []];
    } else if (semVendas) {
      geral = {
        posicao: 12,
        participantes: 12,
        acima: vizinho("Célula Joquebede", 11),
        abaixo: null,
      };
      divisao = {
        posicao: 6,
        participantes: 6,
        acima: vizinho("Célula Canaã", 5),
        abaixo: null,
      };
      primeiros = [
        primeiro(1, "Célula Betel"),
        primeiro(2, "Célula Getsêmani"),
        primeiro(3, "Célula Dorcas"),
      ];
    } else if (primeiroLugar) {
      geral = {
        posicao: 1,
        participantes: 12,
        acima: null,
        abaixo: vizinho("Célula Éfeso", 2),
      };
      divisao = {
        posicao: 1,
        participantes: 6,
        acima: null,
        abaixo: vizinho("Célula Betel", 2),
      };
      primeiros = [
        primeiro(1, "Célula Ágape", true),
        primeiro(2, "Célula Betel"),
        primeiro(3, "Célula Getsêmani"),
      ];
    } else {
      geral = {
        posicao: 4,
        participantes: 12,
        acima: vizinho("Célula Éfeso", 3),
        abaixo: vizinho("Célula Filadélfia", 5),
      };
      divisao = {
        posicao: 2,
        participantes: 6,
        acima: vizinho("Célula Betel", 1),
        abaixo: vizinho("Célula Getsêmani", 3),
      };
      primeiros = [
        primeiro(1, "Célula Betel"),
        primeiro(2, "Célula Ágape", true),
        primeiro(3, "Célula Getsêmani"),
      ];
    }
  } else if (papel === "discipulador") {
    alvo = semCelulas ? ALVO_DISCIPULADOR_SEM_CELULAS : ALVO_DISCIPULADOR;
    pessoa = semCelulas ? "Lucas Fictício" : DISCIPULADOR.nome;
    numeros = semCelulas ? NUMEROS.semCelulas : NUMEROS.davi;
    primeiros = antes
      ? []
      : [
          primeiro(1, "Davi Fictício", !semCelulas),
          primeiro(2, "Elias Fictício"),
        ];
    if (semCelulas) {
      [geral, divisao] = [null, null];
    } else if (antes) {
      [geral, divisao] = [empatados(4), empatados(2)];
    } else {
      geral = {
        posicao: 2,
        participantes: 4,
        acima: vizinho("Bia Fictícia", 1),
        abaixo: vizinho("Elias Fictício", 3),
      };
      divisao = {
        posicao: 1,
        participantes: 2,
        acima: null,
        abaixo: vizinho("Elias Fictício", 2),
      };
    }
    if (!semCelulas) equipe = celulasDoDavi(desempenho);
  } else {
    alvo = semCelulas ? ALVO_REDE_SEM_CELULAS : ALVO_REDE;
    pessoa = semCelulas ? "Pastora Fictícia" : REDE.nome;
    numeros = semCelulas ? NUMEROS.semCelulas : NUMEROS.rede;
    primeiros = antes ? [] : [primeiro(1, "Rede Jovem Fictícia", !semCelulas)];
    if (semCelulas) {
      [geral, divisao] = [null, null];
      equipe = [
        itemDiscipulador(
          13,
          "Noé Fictício",
          desempenho(NUMEROS.semCelulas),
          null,
        ),
      ];
    } else {
      [geral, divisao] = antes
        ? [empatados(2), empatados(1)]
        : [
            {
              posicao: 1,
              participantes: 2,
              acima: null,
              abaixo: vizinho("Rede Adulta Fictícia", 2),
            },
            { posicao: 1, participantes: 1, acima: null, abaixo: null },
          ];
      equipe = [
        itemDiscipulador(10, "Davi Fictício", desempenho(NUMEROS.davi), 1),
        itemDiscipulador(11, "Elias Fictício", desempenho(NUMEROS.elias), 2),
        itemDiscipulador(
          12,
          "Lucas Fictício",
          desempenho(NUMEROS.semCelulas),
          null,
        ),
        ...celulasDoDavi(desempenho),
        itemCelula(
          4,
          "Célula Dorcas",
          11,
          "Pedro Fictício",
          3,
          desempenho(NUMEROS.dorcas),
          3,
        ),
      ];
    }
  }

  const desempenhoDoAlvo = desempenho(numeros);
  return respostaVisaoIndividualSchema.parse({
    alvo,
    pessoa,
    referencia: REFERENCIAS[fase],
    unidade,
    desempenho: desempenhoDoAlvo,
    afiliados_vinculados: papel === "lider" ? afiliados : null,
    curva: curvaDe(numeros, fase),
    ranking: {
      nivel: alvo.tipo,
      janela: JANELAS[fase],
      criterio,
      geral,
      divisao,
      primeiros,
    },
    equipe,
    atualizado_em: ATUALIZADO_EM[fase],
  });
}

function celulasDoDavi(
  desempenho: (numeros: Numeros) => DesempenhoIndividual,
): ItemEquipe[] {
  return [
    itemCelula(
      1,
      "Célula Ágape",
      10,
      "Maria Fictícia",
      2,
      desempenho(NUMEROS.agape),
      2,
    ),
    itemCelula(
      2,
      "Célula Betel",
      10,
      "João Fictício",
      1,
      desempenho(NUMEROS.betel),
      1,
    ),
    itemCelula(
      3,
      "Célula Canaã",
      10,
      "Ana Fictícia",
      0,
      desempenho(NUMEROS.canaa),
      6,
    ),
  ];
}

/** Todos os cenários que a tela precisa mostrar sem nenhum dinheiro (CA2), com um nome para o teste. */
export function todosOsCenarios(): [string, Cenario][] {
  const lista: [string, Cenario][] = [];
  for (const papel of ["lider", "discipulador", "rede"] as const)
    for (const fase of ["antes", "durante", "encerrada"] as const)
      for (const unidade of ["bilhetes", "centavos"] as const) {
        lista.push([`${papel}, ${fase}, ${unidade}`, { papel, fase, unidade }]);
        if (papel !== "lider")
          lista.push([
            `${papel} sem células, ${fase}, ${unidade}`,
            { papel, fase, unidade, semCelulas: true },
          ]);
      }
  for (const unidade of ["bilhetes", "centavos"] as const) {
    lista.push([`lider sem vendas, ${unidade}`, { semVendas: true, unidade }]);
    lista.push([
      `lider sem afiliado, ${unidade}`,
      { afiliados: 0, unidade, criterio: "arrecadacao" },
    ]);
  }
  return lista;
}

// ---------------------------------------------------------------------------------------------------
// Links de vendas (RIFA-046, D24): GET /api/minha/links-vendas
// ---------------------------------------------------------------------------------------------------

/** O link de vendas de um afiliado (o formato do exemplo da D24; o real ainda não foi confirmado com a Rifei). */
export function urlDoAfiliado(affiliateId: number): string {
  return `https://rifei.com.br/videira-kids?afiliado=${affiliateId}`;
}

/** As células da Rede Jovem Fictícia (as mesmas da visão), com os afiliados vinculados (o mais recente primeiro). */
const CELULAS_COM_AFILIADOS = [
  {
    id: 1,
    nome: "Célula Ágape",
    lider: "Maria Fictícia",
    disc: [10, "Davi Fictício"],
    afiliados: [1042],
  },
  {
    id: 2,
    nome: "Célula Betel",
    lider: "João Fictício",
    disc: [10, "Davi Fictício"],
    afiliados: [1043],
  },
  {
    id: 3,
    nome: "Célula Canaã",
    lider: "Ana Fictícia",
    disc: [10, "Davi Fictício"],
    afiliados: [],
  },
  {
    id: 4,
    nome: "Célula Dorcas",
    lider: "Pedro Fictício",
    disc: [11, "Elias Fictício"],
    afiliados: [1050],
  },
] as const;

export type CenarioLinks = {
  /** false: sem modelo (o PO ainda não confirmou o formato), nenhuma célula tem link. Padrão: true. */
  configurado?: boolean;
  /** Os afiliados da célula do líder (Célula Ágape), do mais recente para o mais antigo. Padrão: [1042]. */
  afiliadosDoLider?: number[];
};

/** A resposta de GET /api/minha/links-vendas para o alvo, passada pelo schema (escopo, ordem, só rifei.com.br). */
export function meusLinksDe(
  alvo: Alvo,
  { configurado = true, afiliadosDoLider }: CenarioLinks = {},
): RespostaMeusLinksVendas {
  const itens = CELULAS_COM_AFILIADOS.filter((celula) =>
    alvo.tipo === "celula"
      ? celula.id === alvo.id
      : alvo.tipo === "discipulador"
        ? celula.disc[0] === alvo.id
        : alvo.id === ALVO_REDE.id,
  ).map((celula) => {
    const afiliados =
      celula.id === ALVO_CELULA.id && afiliadosDoLider
        ? afiliadosDoLider
        : celula.afiliados;
    return {
      celula_id: celula.id,
      celula_nome: celula.nome,
      lider_nome: celula.lider,
      discipulador_id: celula.disc[0],
      discipulador_nome: celula.disc[1],
      rede_id: ALVO_REDE.id,
      rede_nome: ALVO_REDE.nome,
      divisao: ALVO_REDE.divisao,
      links: configurado
        ? afiliados.map((id) => ({ affiliate_id: id, url: urlDoAfiliado(id) }))
        : [],
    };
  });
  return respostaMeusLinksVendasSchema.parse({ alvo, configurado, itens });
}

// ---------------------------------------------------------------------------------------------------
// API falsa
// ---------------------------------------------------------------------------------------------------

export function respostaErro(
  status: number,
  codigo: string,
  mensagem: string,
): Response {
  return respostaJson({ erro: { codigo, mensagem } }, status);
}

/** `caminho` com a consulta (ex.: "/api/minha/visao?periodo=atual"). */
export type Chamada = { metodo: string; caminho: string };
type Responder = (chamada: Chamada) => Response | Promise<Response>;

/**
 * fetch simulado: GET /api/minha/visao responde com `visao` (ou com o que `visao(periodo)` devolver),
 * passando pelo schema; GET /api/minha/links-vendas, os `links` (padrão: os do alvo da visão, pelo schema; o
 * líder sem afiliado na visão, sem link); POST /api/sessao/sair, 204; GET /api/sessao, a `sessao` (sem ela,
 * 401). Outra rota: 404 no formato da API.
 */
export function criarApiFalsa(
  visao:
    | RespostaVisaoIndividual
    | ((periodo: string) => RespostaVisaoIndividual) = visaoDe(),
  sessao: UsuarioSessao | null = null,
  links: RespostaMeusLinksVendas | null = null,
) {
  const chamadas: Chamada[] = [];
  const marcadas: { metodo: string; caminho: string; responder: Responder }[] =
    [];

  function responderComoAApi(chamada: Chamada, url: URL): Response {
    if (chamada.metodo === "GET" && url.pathname === "/api/minha/visao") {
      const periodo = url.searchParams.get("periodo") ?? "atual";
      const resposta = typeof visao === "function" ? visao(periodo) : visao;
      return respostaJson(respostaVisaoIndividualSchema.parse(resposta));
    }
    if (
      chamada.metodo === "GET" &&
      url.pathname === "/api/minha/links-vendas"
    ) {
      const daVisao = typeof visao === "function" ? visao("atual") : visao;
      return respostaJson(
        respostaMeusLinksVendasSchema.parse(
          links ??
            meusLinksDe(daVisao.alvo, {
              afiliadosDoLider:
                daVisao.afiliados_vinculados === 0 ? [] : undefined,
            }),
        ),
      );
    }
    if (chamada.metodo === "POST" && url.pathname === "/api/sessao/sair") {
      return new Response(null, { status: 204 });
    }
    if (chamada.metodo === "GET" && url.pathname === "/api/sessao") {
      return sessao
        ? respostaJson({ usuario: sessao })
        : respostaErro(401, "nao_autenticado", "Sessão inválida");
    }
    return respostaErro(404, "nao_encontrado", "Rota não encontrada");
  }

  const fetchFalso = vi.fn(
    async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      const chamada: Chamada = {
        metodo: init?.method ?? "GET",
        caminho: `${url.pathname}${url.search}`,
      };
      chamadas.push(chamada);
      const indice = marcadas.findIndex(
        (marcada) =>
          marcada.metodo === chamada.metodo && marcada.caminho === url.pathname,
      );
      if (indice >= 0) {
        const [marcada] = marcadas.splice(indice, 1);
        return marcada.responder(chamada);
      }
      return responderComoAApi(chamada, url);
    },
  );

  return {
    fetch: fetchFalso,
    chamadas,
    /** A próxima chamada a `metodo caminho` (sem a consulta) recebe esta resposta (uma vez só). */
    proxima(metodo: string, caminho: string, resposta: Response | Responder) {
      marcadas.push({
        metodo,
        caminho,
        responder: typeof resposta === "function" ? resposta : () => resposta,
      });
    },
    /** As chamadas a um caminho (sem a consulta). */
    chamadasA(metodo: string, caminho: string) {
      return chamadas.filter(
        (chamada) =>
          chamada.metodo === metodo &&
          chamada.caminho.split("?")[0] === caminho,
      );
    },
  };
}

export type ApiFalsa = ReturnType<typeof criarApiFalsa>;
