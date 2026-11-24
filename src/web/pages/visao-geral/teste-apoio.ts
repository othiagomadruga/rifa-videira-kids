// Apoio dos testes da Visão geral. A campanha fictícia é a dos exemplos de docs/api.md (10/7/7 dias com
// 35/25/45 a partir de 23/11/2026, 10 bilhetes por pessoa, células de 12, 9 e 15 pessoas: meta 360).
// A API simulada responde como a de verdade: o resumo sai de montarResumoPainel (calculos.ts), a mesma
// função que o Worker chama, então os números são os do contrato; o relatório (RIFA-038) sai de
// montarCsvRelatorio, com os cabeçalhos de cabecalhosDoRelatorio (relatorio.ts).
import { vi } from "vitest";
import {
  NOMES_DIVISAO,
  montarResumoPainel,
  type CampanhaCalculo,
  type CelulaCalculo,
  type EscopoResolvido,
  type RespostaPainelResumo,
  type VendasDoDia,
} from "../../../shared/contracts/calculos";
import { hojeNoFuso } from "../../../shared/contracts/calendario";
import {
  COLUNAS_RELATORIO,
  TIPOS_RELATORIO,
  cabecalhoDoRelatorio,
  cabecalhosDoRelatorio,
  formatarInteiroCsv,
  montarCsvRelatorio,
  type ColunaRelatorio,
  type TipoRelatorio,
} from "../../../shared/contracts/relatorio";
import { respostaJson } from "../../test/renderizar";

export const CAMPANHA: CampanhaCalculo = {
  nome: "Projeto Videira Kids",
  fuso_horario: "America/Belem",
  data_inicio: "2026-11-23",
  meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
  periodos: [
    { nome: "Semana 1", dias: 10, percentual_bp: 3500 },
    { nome: "Semana 2", dias: 7, percentual_bp: 2500 },
    { nome: "Semana 3", dias: 7, percentual_bp: 4500 },
  ],
  ranking: { criterio: "percentual_meta" },
  publico: { mostra_percentual_meta: false, limite_ranking: 3 },
};

/** A mesma campanha com a meta em R$: R$ 200,00 por pessoa (meta R$ 7.200,00). */
export const CAMPANHA_EM_REAIS: CampanhaCalculo = {
  ...CAMPANHA,
  meta: { unidade: "centavos", regra: "por_pessoa", valor: 20_000 },
};

export const CELULAS: CelulaCalculo[] = [
  {
    id: 1,
    nome: "Célula Ficticia 01",
    qtd_pessoas: 12,
    discipulador_id: 1,
    discipulador_nome: "Discipulador Ficticio A",
    rede_id: 1,
    rede_nome: "Rede Jovem Ficticia",
    divisao: "jovens",
  },
  {
    id: 2,
    nome: "Célula Ficticia 02",
    qtd_pessoas: 9,
    discipulador_id: 1,
    discipulador_nome: "Discipulador Ficticio A",
    rede_id: 1,
    rede_nome: "Rede Jovem Ficticia",
    divisao: "jovens",
  },
  {
    id: 3,
    nome: "Célula Ficticia 03",
    qtd_pessoas: 15,
    discipulador_id: 2,
    discipulador_nome: "Discipulador Ficticio B",
    rede_id: 2,
    rede_nome: "Rede Adulta Ficticia",
    divisao: "adultos",
  },
];

/** RIFA-092: os 4 grupos da migração 0018, como GET /api/admin/grupos devolve (na ordem da tela). */
export const GRUPOS = [
  { id: 1, nome: "Adultos da manhã", ordem: 1 },
  { id: 2, nome: "Adultos da noite", ordem: 2 },
  { id: 3, nome: "Jovens", ordem: 3 },
  { id: 4, nome: "Adolescentes", ordem: 4 },
] as const;

const nomeDoGrupo = (id: number | null | undefined) =>
  GRUPOS.find((grupo) => grupo.id === id)?.nome ?? null;

/**
 * RIFA-092: as mesmas três células com o grupo efetivo, de divisões diferentes e fora da ordem dos grupos (o nome e o
 * id dariam outra ordem): a 01 em "Adolescentes", a 02 em "Adultos da manhã" e a 03 sem grupo. "Adultos da noite" e
 * "Jovens" ficam sem células.
 */
export const CELULAS_COM_GRUPOS: CelulaCalculo[] = CELULAS.map((celula) => ({
  ...celula,
  grupo_efetivo_id: { 1: 4, 2: 1 }[celula.id] ?? null,
}));

/** Um item de GET /api/admin/celulas (Celula do contrato), com dados fictícios. */
export function celulaDaApi(celula: CelulaCalculo) {
  return {
    ...celula,
    grupo_efetivo_id: celula.grupo_efetivo_id ?? null,
    grupo_efetivo_nome: nomeDoGrupo(celula.grupo_efetivo_id),
    lider_nome: `Lider Ficticio ${String(celula.id).padStart(2, "0")}`,
    lider_email: null,
    lider_telefone: null,
    criado_em: "2026-11-06T18:00:00.000Z",
    atualizado_em: "2026-11-06T18:00:00.000Z",
  };
}

const PRECO_CENTAVOS = 2000;

/** Data local do dia N da campanha (1 = 23/11/2026). */
export function dataDoDia(dia: number): string {
  return new Date(Date.UTC(2026, 10, 22 + dia)).toISOString().slice(0, 10);
}

/** Um instante no horário de Belém (UTC−3), do dia N da campanha ou de uma data. */
export function emBelem(dia: number | string, hora = "15:30"): Date {
  const data = typeof dia === "number" ? dataDoDia(dia) : dia;
  return new Date(`${data}T${hora}:00-03:00`);
}

/** Vendas de um dia (célula null = sem célula), a R$ 20,00 o bilhete, cerca de 2 bilhetes por pedido. */
function venda(
  celula: number | null,
  dia: number | string,
  bilhetes: number,
): VendasDoDia {
  return {
    celula_id: celula,
    dia: typeof dia === "number" ? dataDoDia(dia) : dia,
    pedidos: Math.ceil(bilhetes / 2),
    bilhetes,
    centavos: bilhetes * PRECO_CENTAVOS,
  };
}

/** Vendas diárias de cada célula do dia `de` ao dia `ate` (inclusive). */
function porDia(
  de: number,
  ate: number,
  bilhetesPorCelula: Record<number, number>,
): VendasDoDia[] {
  const linhas: VendasDoDia[] = [];
  for (let dia = de; dia <= ate; dia++) {
    for (const [celula, bilhetes] of Object.entries(bilhetesPorCelula)) {
      if (bilhetes > 0) linhas.push(venda(Number(celula), dia, bilhetes));
    }
  }
  return linhas;
}

export type Cenario = {
  campanha: CampanhaCalculo;
  vendas: VendasDoDia[];
  agora: Date;
};

/** Em dia, no dia 12 (04/12): o exemplo de docs/api.md (139 vendidos, 134 até ontem, esperado 133). */
const VENDAS_EM_DIA: VendasDoDia[] = [
  venda(1, "2026-11-20", 1), // compra de teste na reunião de cadastro (antes do início)
  ...porDia(1, 9, { 1: 5, 2: 3, 3: 4 }),
  ...porDia(10, 10, { 1: 5, 2: 3, 3: 6 }),
  venda(null, 4, 3), // sem célula
  ...porDia(11, 11, { 1: 4, 2: 2, 3: 3 }),
  ...porDia(12, 12, { 1: 2, 3: 3 }),
];

export const CENARIOS = {
  emDia: { campanha: CAMPANHA, vendas: VENDAS_EM_DIA, agora: emBelem(12) },
  /** Abaixo do ritmo no dia 12: 8 por dia (90 até ontem, com 2 sem célula) e 4 hoje. */
  abaixo: {
    campanha: CAMPANHA,
    vendas: [
      ...porDia(1, 11, { 1: 3, 2: 2, 3: 3 }),
      venda(null, 6, 2),
      ...porDia(12, 12, { 1: 2, 2: 1, 3: 1 }),
    ],
    agora: emBelem(12),
  },
  /** Três dias antes do início, só com a compra de teste. */
  antes: {
    campanha: CAMPANHA,
    vendas: [venda(1, "2026-11-20", 1)],
    agora: emBelem("2026-11-20", "10:00"),
  },
  vespera: {
    campanha: CAMPANHA,
    vendas: [],
    agora: emBelem("2026-11-22", "20:00"),
  },
  /** 1º dia, às 10:00, com 3 bilhetes vendidos. */
  primeiroDia: {
    campanha: CAMPANHA,
    vendas: porDia(1, 1, { 1: 2, 3: 1 }),
    agora: emBelem(1, "10:00"),
  },
  /** Dia 5 sem nenhuma venda. */
  semVendas: { campanha: CAMPANHA, vendas: [], agora: emBelem(5) },
  /** Último dia (24), às 18:00: 302 até ontem (com 3 sem célula) e 12 hoje. */
  ultimoDia: {
    campanha: CAMPANHA,
    vendas: [
      ...porDia(1, 23, { 1: 4, 2: 3, 3: 6 }),
      venda(null, 4, 3),
      ...porDia(24, 24, { 1: 5, 2: 2, 3: 5 }),
    ],
    agora: emBelem(24, "18:00"),
  },
  /** Encerrada (20/12): 16 por dia nos 24 dias, 3 sem célula e 2 depois do fim. */
  encerrada: {
    campanha: CAMPANHA,
    vendas: [
      ...porDia(1, 24, { 1: 5, 2: 4, 3: 7 }),
      venda(null, 4, 3),
      venda(2, "2026-12-18", 2),
    ],
    agora: emBelem("2026-12-20", "12:00"),
  },
  /** O cenário em dia com a meta em R$. */
  emReais: {
    campanha: CAMPANHA_EM_REAIS,
    vendas: VENDAS_EM_DIA,
    agora: emBelem(12),
  },
} satisfies Record<string, Cenario>;

export const ESCOPO_CAMPANHA_RESOLVIDO: EscopoResolvido = {
  tipo: "campanha",
  id: null,
  divisao: null,
  nome: CAMPANHA.nome,
};

/** O escopo como a API o resolve (nome e divisão), ou null se o id não existe (404). */
export function resolverEscopo(
  params: URLSearchParams,
  campanha: CampanhaCalculo = CAMPANHA,
): EscopoResolvido | null {
  const tipo = params.get("escopo") ?? "campanha";
  const id = Number(params.get("id"));
  if (tipo === "campanha")
    return { ...ESCOPO_CAMPANHA_RESOLVIDO, nome: campanha.nome };
  // RIFA-092: o grupo existe mesmo sem células; sem divisão.
  if (tipo === "grupo") {
    const nome = nomeDoGrupo(id);
    return nome === null ? null : { tipo, id, divisao: null, nome };
  }
  if (tipo === "divisao") {
    const divisao = params.get("divisao");
    return divisao === "jovens" || divisao === "adultos"
      ? { tipo, id: null, divisao, nome: NOMES_DIVISAO[divisao] }
      : null;
  }
  const campo = {
    rede: "rede_id",
    discipulador: "discipulador_id",
    celula: "id",
  } as const;
  if (tipo !== "rede" && tipo !== "discipulador" && tipo !== "celula")
    return null;
  const celula = CELULAS.find((item) => item[campo[tipo]] === id);
  if (!celula) return null;
  const nome = {
    rede: celula.rede_nome,
    discipulador: celula.discipulador_nome,
    celula: celula.nome,
  }[tipo];
  return { tipo, id, divisao: celula.divisao, nome };
}

/** O resumo que a API devolveria no cenário (padrão: escopo campanha; as células sem grupo). */
export function resumoDoCenario(
  cenario: Cenario,
  escopo: EscopoResolvido = {
    ...ESCOPO_CAMPANHA_RESOLVIDO,
    nome: cenario.campanha.nome,
  },
  celulas: readonly CelulaCalculo[] = CELULAS,
): RespostaPainelResumo {
  return montarResumoPainel(
    { campanha: cenario.campanha, celulas, vendas: cenario.vendas },
    { escopo },
    cenario.agora,
  );
}

const erroJson = (status: number, codigo: string, mensagem: string) =>
  respostaJson({ erro: { codigo, mensagem } }, status);

/** A data de referência do cenário (hoje no fuso da campanha): a do nome do arquivo do relatório. */
export function dataDoCenario(cenario: Cenario): string {
  return hojeNoFuso(cenario.campanha.fuso_horario, cenario.agora);
}

/**
 * O CSV que a API mandaria para o tipo (RIFA-038): o cabeçalho do contrato, na unidade da meta, e uma linha
 * fictícia (textos com acento nas colunas de nome, números nas outras), tudo por montarCsvRelatorio.
 */
export function csvDoRelatorio(
  tipo: TipoRelatorio,
  cenario: Cenario = CENARIOS.emDia,
): string {
  const [celula] = CELULAS;
  const data = dataDoCenario(cenario);
  const textos: Partial<Record<ColunaRelatorio, string>> = {
    campanha: cenario.campanha.nome,
    data_referencia: data,
    data_inicio: cenario.campanha.data_inicio,
    data_fim: "2026-12-16",
    data,
    divisao: NOMES_DIVISAO[celula.divisao],
    rede: celula.rede_nome,
    discipulador: celula.discipulador_nome,
    celula: celula.nome,
    lider: "Líder Fictício 01",
    periodo: "Semana 2",
  };
  const linha = COLUNAS_RELATORIO[tipo].map(
    (coluna, indice) => textos[coluna] ?? formatarInteiroCsv(indice + 1),
  );
  return montarCsvRelatorio(
    cabecalhoDoRelatorio(tipo, cenario.campanha.meta.unidade),
    [linha],
  );
}

/** A resposta 200 do relatório: o CSV e os cabeçalhos do contrato (Content-Disposition com o nome do arquivo). */
export function respostaRelatorio(
  tipo: TipoRelatorio,
  cenario: Cenario = CENARIOS.emDia,
): Response {
  return new Response(csvDoRelatorio(tipo, cenario), {
    status: 200,
    headers: cabecalhosDoRelatorio(tipo, dataDoCenario(cenario)),
  });
}

const ehTipoRelatorio = (valor: string | null): valor is TipoRelatorio =>
  (TIPOS_RELATORIO as readonly (string | null)[]).includes(valor);

export const RESPOSTAS_DE_ERRO = {
  semCampanha: () => erroJson(404, "nao_encontrado", "Nenhuma campanha ativa"),
  naoEncontrado: (mensagem = "Célula não encontrada") =>
    erroJson(404, "nao_encontrado", mensagem),
  interno: () =>
    erroJson(500, "erro_interno", "Erro interno. Tente de novo em instantes."),
};

type Resposta = Response | Promise<Response>;

/**
 * Troca o fetch por uma API simulada do cenário. Responde GET /api/painel/resumo (montarResumoPainel com
 * o escopo da consulta), GET /api/admin/celulas, GET /api/admin/grupos (RIFA-092) e GET /api/painel/relatorio (o CSV
 * do tipo, por respostaRelatorio; 400 sem tipo válido). `api.resumo`, `api.celulas`, `api.grupos` e `api.relatorio`
 * trocam a resposta da próxima chamada (devolvendo undefined, vale a padrão); `api.hierarquia` são as células do
 * cenário (a lista e o resumo; `CELULAS_COM_GRUPOS` para o filtro por grupo); `api.chamadas` guarda cada caminho
 * pedido, com a consulta, e `api.pedidos` cada Request (método, cabeçalhos, credenciais e signal).
 */
export function simularApi(cenarioInicial: Cenario) {
  const api = {
    cenario: cenarioInicial,
    chamadas: [] as string[],
    pedidos: [] as { url: URL; init: RequestInit | undefined }[],
    resumo: undefined as ((url: URL) => Resposta | undefined) | undefined,
    celulas: undefined as (() => Resposta | undefined) | undefined,
    grupos: undefined as (() => Resposta | undefined) | undefined,
    hierarquia: CELULAS as readonly CelulaCalculo[],
    relatorio: undefined as ((url: URL) => Resposta | undefined) | undefined,
    /** As consultas ao relatório (caminho e consulta), na ordem. */
    get consultasAoRelatorio() {
      return this.chamadas.filter((caminho) =>
        caminho.startsWith("/api/painel/relatorio"),
      );
    },
    /** Quantas consultas ao resumo foram feitas. */
    get consultasAoResumo() {
      return this.chamadas.filter((caminho) =>
        caminho.startsWith("/api/painel/resumo"),
      ).length;
    },
  };
  const fetchSimulado = vi.fn(
    async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), "http://localhost");
      api.chamadas.push(`${url.pathname}${url.search}`);
      api.pedidos.push({ url, init });
      if (url.pathname === "/api/painel/relatorio") {
        const especial = await api.relatorio?.(url);
        if (especial) return especial;
        const tipo = url.searchParams.get("tipo");
        return ehTipoRelatorio(tipo)
          ? respostaRelatorio(tipo, api.cenario)
          : erroJson(400, "requisicao_invalida", "Requisição inválida");
      }
      if (url.pathname === "/api/admin/celulas") {
        return (
          (await api.celulas?.()) ??
          respostaJson({ itens: api.hierarquia.map(celulaDaApi) })
        );
      }
      if (url.pathname === "/api/admin/grupos") {
        return (await api.grupos?.()) ?? respostaJson({ itens: GRUPOS });
      }
      if (url.pathname === "/api/painel/resumo") {
        const especial = await api.resumo?.(url);
        if (especial) return especial;
        const escopo = resolverEscopo(url.searchParams, api.cenario.campanha);
        return escopo
          ? respostaJson(resumoDoCenario(api.cenario, escopo, api.hierarquia))
          : RESPOSTAS_DE_ERRO.naoEncontrado();
      }
      return erroJson(404, "nao_encontrado", "Rota não encontrada");
    },
  );
  vi.stubGlobal("fetch", fetchSimulado);
  return api;
}
