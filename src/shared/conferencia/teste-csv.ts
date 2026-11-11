// CSVs fictícios da conferência pelo CSV da Rifei (RIFA-012), para os testes do navegador (src/shared,
// src/web) e do Worker (src/worker/test/conferencia-apoio.ts reexporta daqui): o arquivo do cenário em
// várias formas e os dados pessoais FICTÍCIOS que nunca podem sair do navegador, aparecer nas respostas,
// no banco ou no log. Módulo puro, só para testes (nenhuma tela importa daqui).
import type { MapeamentoReconciliacao } from "../contracts/conferencia";

export interface OpcoesCsv {
  separador?: "," | ";";
  bom?: boolean;
  /** Fim de linha (padrão CRLF, como o Excel e a maioria dos exports). */
  fimDeLinha?: "\r\n" | "\n";
}

/** Célula com aspas quando precisa (RFC 4180): separador, aspas ou quebra de linha. */
function celula(valor: string, separador: string): string {
  return valor.includes(separador) || /["\r\n]/.test(valor)
    ? `"${valor.replaceAll('"', '""')}"`
    : valor;
}

/** Monta o texto do CSV (primeira linha = cabeçalho). */
export function montarCsv(
  linhas: readonly (readonly string[])[],
  { separador = ",", bom = false, fimDeLinha = "\r\n" }: OpcoesCsv = {},
): string {
  const texto = linhas
    .map((linha) =>
      linha.map((valor) => celula(valor, separador)).join(separador),
    )
    .join(fimDeLinha);
  return `${bom ? "\uFEFF" : ""}${texto}${fimDeLinha}`;
}

/** Dados pessoais fictícios do arquivo: nenhum pode sair na resposta, no banco ou no log. */
export const DADOS_PESSOAIS = {
  nomes: [
    "Maria Ficticia Souza",
    "Joao Ficticio Lima",
    "Ana Teste Rocha",
    "Pedro Inventado Alves",
    "Clara Exemplo Dias",
  ],
  emails: [
    "maria.ficticia@example.com",
    "joao.ficticio@example.com",
    "ana.teste@example.com",
    "pedro.inventado@example.com",
    "clara.exemplo@example.com",
  ],
  telefones: [
    "+5591988880001",
    "+5591988880002",
    "+5591988880003",
    "+5591988880004",
    "+5591988880005",
  ],
  cpfs: ["111.444.777-35", "222.555.888-46", "333.666.999-57"],
  enderecos: ["Rua Ficticia 123", "Travessa Inventada 45"],
};

/** Todos os textos pessoais (e pedaços que também não podem aparecer, como os dígitos do telefone). */
export const TEXTOS_PESSOAIS = [
  ...DADOS_PESSOAIS.nomes,
  ...DADOS_PESSOAIS.nomes.map((nome) => nome.split(" ")[0]),
  ...DADOS_PESSOAIS.emails,
  ...DADOS_PESSOAIS.telefones,
  ...DADOS_PESSOAIS.telefones.map((telefone) => telefone.slice(3)),
  ...DADOS_PESSOAIS.cpfs,
  ...DADOS_PESSOAIS.enderecos,
  "example.com",
];

/** Os textos pessoais que aparecem em `texto` (deve dar sempre lista vazia). */
export function textosPessoaisEm(texto: string): string[] {
  return TEXTOS_PESSOAIS.filter((pessoal) => texto.includes(pessoal));
}

const pessoa = (indice: number) => ({
  nome: DADOS_PESSOAIS.nomes[indice % 5],
  email: DADOS_PESSOAIS.emails[indice % 5],
  telefone: DADOS_PESSOAIS.telefones[indice % 5],
  cpf: DADOS_PESSOAIS.cpfs[indice % 3],
});

/** Uma linha do arquivo "por pedido" do cenário. */
export interface LinhaRifei {
  pedido: string;
  status: string;
  quantidade: string;
  bilhetes: string;
  valor: string;
  afiliado: string;
  data: string;
}

/**
 * O arquivo do cenário (o que a Rifei teria exportado), com as colunas pessoais no meio e uma coluna
 * desconhecida. Ver PEDIDOS_DO_CENARIO para o que cada linha deve dar.
 */
export const LINHAS_DO_CENARIO: LinhaRifei[] = [
  // Conferem / divergem com os pedidos gravados.
  {
    pedido: "R-0001",
    status: "Pago",
    quantidade: "3",
    bilhetes: "101, 102, 103",
    valor: "R$ 60,00",
    afiliado: "101",
    data: "24/11/2026 12:00",
  },
  {
    pedido: "R-0002",
    status: "Pago",
    quantidade: "2",
    bilhetes: "201, 202",
    valor: "R$ 50,00",
    afiliado: "102",
    data: "25/11/2026 12:00",
  },
  {
    pedido: "R-0003",
    status: "Aprovado",
    quantidade: "5",
    bilhetes: "",
    valor: "R$ 80,00",
    afiliado: "103",
    data: "25/11/2026 13:00",
  },
  {
    pedido: "R-0004",
    status: "Pago",
    quantidade: "1",
    bilhetes: "401",
    valor: "R$ 20,00",
    afiliado: "105",
    data: "26/11/2026 09:30",
  },
  {
    pedido: "R-0005",
    status: "Pago",
    quantidade: "2",
    bilhetes: "501, 502",
    valor: "R$ 40,00",
    afiliado: "101",
    data: "26/11/2026 10:00",
  },
  {
    pedido: "R-0006",
    status: "Cancelado",
    quantidade: "2",
    bilhetes: "601, 602",
    valor: "R$ 40,00",
    afiliado: "105",
    data: "27/11/2026 08:00",
  },
  {
    pedido: "R-0009",
    status: "Expirado",
    quantidade: "1",
    bilhetes: "",
    valor: "R$ 20,00",
    afiliado: "103",
    data: "27/11/2026 09:00",
  },
  {
    pedido: "R-OUTRA",
    status: "Pago",
    quantidade: "1",
    bilhetes: "",
    valor: "R$ 20,00",
    afiliado: "101",
    data: "27/11/2026 09:10",
  },
  // Só no arquivo: vendas perdidas (três recuperáveis) e um pendente.
  {
    pedido: "R-0101",
    status: "Pago",
    quantidade: "3",
    bilhetes: "1001, 1002, 1003",
    valor: "R$ 60,00",
    afiliado: "101",
    data: "27/11/2026 10:00",
  },
  {
    pedido: "R-0102",
    status: "approved",
    quantidade: "2",
    bilhetes: "1004, 1005",
    valor: "40,00",
    afiliado: "@Lider.Betel",
    data: "28/11/2026",
  },
  {
    pedido: "R-0103",
    status: "Pago",
    quantidade: "1",
    bilhetes: "1006",
    valor: "",
    afiliado: "104",
    data: "28/11/2026 11:00",
  },
  {
    pedido: "R-0104",
    status: "Pendente",
    quantidade: "4",
    bilhetes: "",
    valor: "R$ 80,00",
    afiliado: "104",
    data: "29/11/2026 11:00",
  },
  {
    pedido: "R-0105",
    status: "Pago",
    quantidade: "1",
    bilhetes: "1007",
    valor: "R$ 20,00",
    afiliado: "lider.inexistente",
    data: "29/11/2026 15:45",
  },
  {
    pedido: "R-0106",
    status: "Pago",
    quantidade: "2",
    bilhetes: "1008, 1009",
    valor: "R$ 40,00",
    afiliado: "105",
    data: "05/12/2026 10:00",
  },
  {
    pedido: "R-0107",
    status: "Em disputa",
    quantidade: "1",
    bilhetes: "",
    valor: "R$ 20,00",
    afiliado: "102",
    data: "30/11/2026 10:00",
  },
  // Linhas que ficam de fora: código com fórmula e sem código.
  {
    pedido: '=HYPERLINK("http://x.example","clique")',
    status: "Pago",
    quantidade: "1",
    bilhetes: "",
    valor: "R$ 20,00",
    afiliado: "101",
    data: "30/11/2026 10:00",
  },
  {
    pedido: "",
    status: "Pago",
    quantidade: "1",
    bilhetes: "",
    valor: "R$ 20,00",
    afiliado: "101",
    data: "30/11/2026 11:00",
  },
];

export const CABECALHO_DO_CENARIO = [
  "Pedido",
  "Nome",
  "E-mail",
  "Telefone",
  "CPF",
  "Status",
  "Quantidade de bilhetes",
  "Bilhetes",
  "Valor",
  "Afiliado",
  "Data do pagamento",
  "Observação interna",
];

/** O CSV do cenário com as colunas na ordem do CABECALHO_DO_CENARIO. */
export function csvDoCenario(
  linhas: readonly LinhaRifei[] = LINHAS_DO_CENARIO,
  opcoes?: OpcoesCsv,
): string {
  return montarCsv(
    [
      CABECALHO_DO_CENARIO,
      ...linhas.map((linha, indice) => {
        const dados = pessoa(indice);
        return [
          linha.pedido,
          dados.nome,
          dados.email,
          dados.telefone,
          dados.cpf,
          linha.status,
          linha.quantidade,
          linha.bilhetes,
          linha.valor,
          linha.afiliado,
          linha.data,
          `Entregar para ${dados.nome}`,
        ];
      }),
    ],
    opcoes,
  );
}

/** O mapeamento que a detecção deve achar no CABECALHO_DO_CENARIO. */
export const MAPEAMENTO_DO_CENARIO: MapeamentoReconciliacao = {
  pedido_id: 0,
  status: 5,
  qtd_bilhetes: 6,
  bilhetes: 7,
  valor: 8,
  afiliado: 9,
  data: 10,
};
