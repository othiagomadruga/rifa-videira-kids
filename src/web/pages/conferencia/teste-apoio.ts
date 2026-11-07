// Apoio dos testes da tela da conferência: respostas de exemplo da API (cada uma passa pelo schema ESTRITO
// do contrato: um campo a mais ou errado quebra o teste já na montagem) e uma API falsa que responde por
// rota e guarda as chamadas (método, caminho e corpo). Todos os dados são fictícios.
import { vi } from "vitest";
import {
  respostaAnaliseAgregadaSchema,
  respostaAnalisePorPedidoSchema,
  respostaListaRecuperacoesSchema,
  respostaRecuperarReconciliacaoSchema,
  type Divergencia,
  type MapeamentoReconciliacao,
  type Recuperacao,
  type RespostaAnaliseAgregada,
  type RespostaAnalisePorPedido,
  type RespostaRecuperarReconciliacao,
  type TipoDivergencia,
} from "../../../shared/contracts/api";
import { respostaJson } from "../../test/renderizar";

/** O arquivo de exemplo: dados pessoais fictícios que nunca podem sair do arquivo. */
export const NOME_FICTICIO = "Maria Ficticia Souza";
export const EMAIL_FICTICIO = "maria.ficticia@example.com";
export const CSV_EXEMPLO = [
  "Pedido;Nome;E-mail;Status;Quantidade de bilhetes;Valor;Afiliado;Data do pagamento",
  `R-0101;${NOME_FICTICIO};${EMAIL_FICTICIO};Pago;3;R$ 60,00;101;27/11/2026 10:00`,
  "R-0102;Joao Ficticio;joao@example.com;Pago;2;R$ 40,00;102;28/11/2026",
  "",
].join("\r\n");

export const MAPEAMENTO: MapeamentoReconciliacao = {
  pedido_id: 0,
  status: 3,
  qtd_bilhetes: 4,
  bilhetes: null,
  valor: 5,
  afiliado: 6,
  data: 7,
};

const COLUNAS = [
  ["Pedido", "pedido_id", false],
  ["Nome", null, true],
  ["E-mail", null, true],
  ["Status", "status", false],
  ["Quantidade de bilhetes", "qtd_bilhetes", false],
  ["Valor", "valor", false],
  ["Afiliado", "afiliado", false],
  ["Data do pagamento", "data", false],
] as const;

const ATAPE = { id: 1, nome: "Célula Ágape" };
const BETEL = { id: 2, nome: "Célula Betel" };

function perdida(
  pedido_id: string,
  dados: Partial<NonNullable<Divergencia["arquivo"]>>,
  recuperavel = true,
  observacoes: Divergencia["observacoes"] = [],
): Divergencia {
  return {
    pedido_id,
    arquivo: {
      status: "aprovado",
      qtd_bilhetes: 1,
      total_centavos: 2000,
      afiliado: "reconhecido",
      affiliate_id: 101,
      celula: ATAPE,
      data: "2026-11-27",
      ...dados,
    },
    sistema: null,
    recuperavel,
    observacoes,
  };
}

const VENDAS_PERDIDAS: Divergencia[] = [
  perdida("R-0101", { qtd_bilhetes: 3, total_centavos: 6000 }),
  perdida("R-0102", {
    qtd_bilhetes: 2,
    total_centavos: 4000,
    affiliate_id: 102,
    celula: BETEL,
    data: "2026-11-28",
  }),
  perdida("R-0103", { total_centavos: null }, false, ["sem_valor"]),
  perdida("R-0105", {
    afiliado: "nao_reconhecido",
    affiliate_id: null,
    celula: null,
    data: "2026-11-29",
  }),
];

const AUSENTE: Divergencia = {
  pedido_id: "R-0007",
  arquivo: null,
  sistema: {
    status: "approved",
    qtd_bilhetes: 1,
    total_centavos: 2000,
    affiliate_id: null,
    celula: null,
    aprovado_em: "2026-11-20T15:00:00.000Z",
    origem: "webhook",
  },
  recuperavel: false,
  observacoes: ["fora_do_periodo_do_arquivo"],
};

const VALOR: Divergencia = {
  pedido_id: "R-0002",
  arquivo: {
    status: "aprovado",
    qtd_bilhetes: 2,
    total_centavos: 5000,
    afiliado: "reconhecido",
    affiliate_id: 102,
    celula: BETEL,
    data: "2026-11-25",
  },
  sistema: {
    status: "approved",
    qtd_bilhetes: 2,
    total_centavos: 4000,
    affiliate_id: 102,
    celula: BETEL,
    aprovado_em: "2026-11-25T15:00:00.000Z",
    origem: "webhook",
  },
  recuperavel: false,
  observacoes: [],
};

const TIPOS: TipoDivergencia[] = [
  "venda_perdida",
  "pagamento_nao_registrado",
  "nao_pago_na_rifei",
  "ausente_no_arquivo",
  "valor_diferente",
  "quantidade_diferente",
  "afiliado_diferente",
];

function grupo(tipo: TipoDivergencia, itens: Divergencia[]) {
  const soma = (lado: "arquivo" | "sistema") => ({
    bilhetes: itens.reduce((t, item) => t + (item[lado]?.qtd_bilhetes ?? 0), 0),
    total_centavos: itens.reduce(
      (t, item) => t + (item[lado]?.total_centavos ?? 0),
      0,
    ),
  });
  return {
    tipo,
    quantidade: itens.length,
    arquivo: soma("arquivo"),
    sistema: soma("sistema"),
    itens,
    itens_omitidos: 0,
  };
}

const ITENS_POR_TIPO: Partial<Record<TipoDivergencia, Divergencia[]>> = {
  venda_perdida: VENDAS_PERDIDAS,
  ausente_no_arquivo: [AUSENTE],
  valor_diferente: [VALOR],
};

const COMUM = {
  colunas: COLUNAS.map(([nome, campo, pessoal], indice) => ({
    indice,
    nome,
    campo_detectado: campo,
    dado_pessoal: pessoal,
  })),
  mapeamento: MAPEAMENTO,
  mapeamento_detectado: true,
  arquivo: {
    linhas: 12,
    linhas_ignoradas: 1,
    um_bilhete_por_linha: false,
    data_inicio: "2026-11-24",
    data_fim: "2026-11-29",
  },
  avisos: [
    {
      codigo: "colunas_pessoais_ignoradas" as const,
      mensagem:
        "As colunas Nome e E-mail têm dados pessoais e foram ignoradas: o sistema não lê nem guarda nada delas.",
      quantidade: null,
    },
    {
      codigo: "afiliado_nao_reconhecido" as const,
      mensagem:
        "1 pedido com um afiliado que o sistema não reconhece: não é um número nem o rótulo de um afiliado cadastrado (tela Adesão).",
      quantidade: 1,
    },
  ],
  conferido_em: "2026-12-01T15:00:00.000Z",
};

export const ANALISE_POR_PEDIDO: RespostaAnalisePorPedido =
  respostaAnalisePorPedidoSchema.parse({
    modo: "por_pedido",
    ...COMUM,
    resumo: {
      pedidos_no_arquivo: 10,
      aprovados_no_arquivo: {
        pedidos_aprovados: 8,
        bilhetes: 16,
        total_centavos: 31000,
      },
      aprovados_no_sistema: {
        pedidos_aprovados: 5,
        bilhetes: 9,
        total_centavos: 18000,
      },
      conferem: 2,
      com_divergencia: 6,
    },
    divergencias: TIPOS.map((tipo) => grupo(tipo, ITENS_POR_TIPO[tipo] ?? [])),
  });

/** A mesma conferência depois de recuperar R-0101 e R-0102: elas saem das vendas perdidas. */
export const ANALISE_DEPOIS: RespostaAnalisePorPedido =
  respostaAnalisePorPedidoSchema.parse({
    ...ANALISE_POR_PEDIDO,
    mapeamento_detectado: false,
    resumo: { ...ANALISE_POR_PEDIDO.resumo, conferem: 4, com_divergencia: 4 },
    divergencias: TIPOS.map((tipo) =>
      grupo(
        tipo,
        tipo === "venda_perdida"
          ? VENDAS_PERDIDAS.slice(2)
          : (ITENS_POR_TIPO[tipo] ?? []),
      ),
    ),
  });

export const ANALISE_SEM_DIFERENCA: RespostaAnalisePorPedido =
  respostaAnalisePorPedidoSchema.parse({
    ...ANALISE_POR_PEDIDO,
    avisos: [],
    resumo: { ...ANALISE_POR_PEDIDO.resumo, conferem: 8, com_divergencia: 0 },
    divergencias: TIPOS.map((tipo) => grupo(tipo, [])),
  });

export const ANALISE_AGREGADA: RespostaAnaliseAgregada =
  respostaAnaliseAgregadaSchema.parse({
    modo: "agregado",
    ...COMUM,
    mapeamento: { ...MAPEAMENTO, pedido_id: null },
    avisos: [
      {
        codigo: "sem_coluna_pedido",
        mensagem:
          "O arquivo não tem a coluna do código do pedido: a comparação é pelos totais (por afiliado e por dia) e não dá para recuperar vendas.",
        quantidade: null,
      },
    ],
    recorte: { data_inicio: "2026-11-24", data_fim: "2026-11-29" },
    total: {
      arquivo: { pedidos_aprovados: 8, bilhetes: 16, total_centavos: 31000 },
      sistema: { pedidos_aprovados: 5, bilhetes: 9, total_centavos: 18000 },
      confere: false,
    },
    por_afiliado: [
      {
        afiliado: "afiliado",
        affiliate_id: 101,
        celula: ATAPE,
        arquivo: { pedidos_aprovados: 3, bilhetes: 8, total_centavos: 16000 },
        sistema: { pedidos_aprovados: 2, bilhetes: 5, total_centavos: 10000 },
        confere: false,
      },
      {
        afiliado: "nao_reconhecido",
        affiliate_id: null,
        celula: null,
        arquivo: { pedidos_aprovados: 1, bilhetes: 1, total_centavos: 2000 },
        sistema: { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 },
        confere: false,
      },
      {
        afiliado: "afiliado",
        affiliate_id: 102,
        celula: BETEL,
        arquivo: { pedidos_aprovados: 1, bilhetes: 2, total_centavos: 4000 },
        sistema: { pedidos_aprovados: 1, bilhetes: 2, total_centavos: 4000 },
        confere: true,
      },
    ],
    por_dia: [
      {
        data: "2026-11-24",
        arquivo: { pedidos_aprovados: 1, bilhetes: 3, total_centavos: 6000 },
        sistema: { pedidos_aprovados: 1, bilhetes: 3, total_centavos: 6000 },
        confere: true,
      },
      {
        data: "2026-11-28",
        arquivo: { pedidos_aprovados: 2, bilhetes: 3, total_centavos: 4000 },
        sistema: { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 },
        confere: false,
      },
    ],
  });

const RECUPERADO_0101 = {
  pedido_id: "R-0101",
  qtd_bilhetes: 3,
  total_centavos: 6000,
  afiliado: "reconhecido" as const,
  affiliate_id: 101,
  celula: ATAPE,
  aprovado_em: "2026-11-27T13:00:00.000Z",
  origem_data: "arquivo" as const,
};

const RECUPERADO_0105 = {
  pedido_id: "R-0105",
  qtd_bilhetes: 1,
  total_centavos: 2000,
  afiliado: "nao_reconhecido" as const,
  affiliate_id: null,
  celula: null,
  aprovado_em: "2026-12-01T15:00:00.000Z",
  origem_data: "recuperacao" as const,
};

/** Prévia (simular) de R-0101 e R-0105, com a R-0102 que entrou no sistema no meio do caminho. */
export const PREVIA: RespostaRecuperarReconciliacao =
  respostaRecuperarReconciliacaoSchema.parse({
    simulado: true,
    aplicado: false,
    recuperacao_id: null,
    recuperados: [RECUPERADO_0101, RECUPERADO_0105],
    nao_recuperados: [{ pedido_id: "R-0102", motivo: "ja_existe" }],
    totais: { pedidos_aprovados: 2, bilhetes: 4, total_centavos: 8000 },
    avisos: [COMUM.avisos[1]],
  });

export const GRAVADA: RespostaRecuperarReconciliacao =
  respostaRecuperarReconciliacaoSchema.parse({
    ...PREVIA,
    simulado: false,
    aplicado: true,
    recuperacao_id: 7,
    nao_recuperados: [],
  });

export const RECUPERACOES: Recuperacao[] =
  respostaListaRecuperacoesSchema.parse({
    itens: [
      {
        id: 7,
        executado_em: "2026-12-01T15:00:00.000Z",
        usuario: { id: 900, nome: "Pessoa de Teste" },
        pedidos_solicitados: 2,
        pedidos_recuperados: 2,
        bilhetes: 4,
        total_centavos: 8000,
        linhas_arquivo: 12,
        arquivo_sha256: "a".repeat(64),
        colunas: {
          pedido_id: "Pedido",
          status: "Status",
          qtd_bilhetes: "Quantidade de bilhetes",
          bilhetes: null,
          valor: "Valor",
          afiliado: "Afiliado",
          data: "Data do pagamento",
        },
        pedidos: ["R-0101", "R-0105"],
      },
    ],
  }).itens;

export type Chamada = { metodo: string; caminho: string; corpo: unknown };

type Respostas = {
  /** Respostas de POST .../analisar, em ordem (a última se repete). */
  analises?: (object | Response)[];
  recuperar?: (corpo: { simular: boolean }) => object | Response;
  recuperacoes?: () => Recuperacao[];
};

/** API falsa da tela: responde por rota e guarda as chamadas. */
export function criarApiFalsa(respostas: Respostas = {}) {
  const chamadas: Chamada[] = [];
  const analises = respostas.analises ?? [ANALISE_POR_PEDIDO];
  let vezDaAnalise = 0;
  const fetch = vi.fn(
    async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const caminho = new URL(String(entrada), "http://localhost").pathname;
      const metodo = init?.method ?? "GET";
      const corpo: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      chamadas.push({ metodo, caminho, corpo });
      const responder = (valor: object | Response) =>
        valor instanceof Response ? valor : respostaJson(valor);
      if (caminho === "/api/admin/reconciliacao/analisar") {
        const resposta = analises[Math.min(vezDaAnalise, analises.length - 1)];
        vezDaAnalise++;
        return responder(resposta);
      }
      if (caminho === "/api/admin/reconciliacao/recuperar") {
        const pedido = corpo as { simular: boolean };
        return responder(
          respostas.recuperar?.(pedido) ?? (pedido.simular ? PREVIA : GRAVADA),
        );
      }
      if (caminho === "/api/admin/reconciliacao/recuperacoes")
        return respostaJson({ itens: respostas.recuperacoes?.() ?? [] });
      return respostaJson(
        { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
        404,
      );
    },
  );
  return {
    fetch,
    chamadas,
    /** As chamadas a uma rota (pelo fim do caminho). */
    de: (fim: string) =>
      chamadas.filter((chamada) => chamada.caminho.endsWith(fim)),
  };
}

export type ApiFalsa = ReturnType<typeof criarApiFalsa>;

export function respostaErro(
  codigo: string,
  mensagem: string,
  status: number,
  detalhes?: unknown,
): Response {
  return respostaJson(
    {
      erro:
        detalhes === undefined
          ? { codigo, mensagem }
          : { codigo, mensagem, detalhes },
    },
    status,
  );
}
