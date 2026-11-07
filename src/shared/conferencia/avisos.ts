/**
 * Avisos da conferência (RIFA-012): as mensagens, em português simples, para cada código de
 * CODIGOS_AVISO_RECONCILIACAO. Sem nenhum valor do arquivo: só contagens, nomes de coluna e o preço do
 * bilhete da campanha. Módulo puro e sem zod: o navegador monta os avisos da leitura (colunas, células
 * ilegíveis) e o Worker os da comparação, com as mesmas mensagens; a tela junta as duas listas.
 */
import {
  CODIGOS_AVISO_RECONCILIACAO,
  LIMITE_COLUNAS_CSV_RECONCILIACAO,
  type AvisoReconciliacao,
  type CodigoAvisoReconciliacao,
} from "../contracts/conferencia";

/** 12345 → "12.345" (sem Intl: a mensagem sai igual no navegador e no Worker, e de graça). */
export function formatarInteiro(numero: number): string {
  const texto = String(Math.trunc(Math.abs(numero)));
  const comPontos = texto.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return numero < 0 ? `-${comPontos}` : comPontos;
}

/** 123456 → "R$ 1.234,56". */
export function formatarCentavos(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const resto = String(Math.abs(centavos % 100)).padStart(2, "0");
  return `R$ ${formatarInteiro(reais)},${resto}`;
}

const quantos = (n: number, singular: string, plural: string) =>
  `${formatarInteiro(n)} ${n === 1 ? singular : plural}`;

/** "Nome", "Nome e Email", "Nome, Email e Telefone". */
function listaDeNomes(nomes: readonly string[]): string {
  return nomes.length <= 1
    ? (nomes[0] ?? "")
    : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

export type UnidadeAviso = "linha" | "pedido";
const UNIDADES: Record<UnidadeAviso, [string, string]> = {
  linha: ["linha", "linhas"],
  pedido: ["pedido", "pedidos"],
};

/** O que a mensagem de um aviso pode usar (nunca um valor do arquivo). */
export interface DadosDoAviso {
  quantidade: number | null;
  unidade: UnidadeAviso;
  /** Nomes de coluna. */
  nomes: string[];
  /** Preço do bilhete da campanha, em centavos. */
  preco?: number;
  /** Pedidos pagos do arquivo e quantos deles existem no sistema (trava do código). */
  pagos?: number;
  encontrados?: number;
  /** A regra do valor veio dos pedidos que batem com o sistema (e não do preço do bilhete). */
  pelaConvencao?: boolean;
}

const ficou = (n: number | null) => (n === 1 ? "ficou" : "ficaram");

const MENSAGENS: Record<
  CodigoAvisoReconciliacao,
  (dados: DadosDoAviso) => string
> = {
  codigo_nao_confere: ({ nomes, pagos, encontrados }) =>
    `A coluna escolhida como código do pedido${nomes[0] ? ` (${nomes[0]})` : ""} não parece ser o código da Rifei: só ${formatarInteiro(encontrados ?? 0)} de ${quantos(pagos ?? 0, "pedido pago", "pedidos pagos")} do arquivo existem no sistema. Nada foi marcado para recuperar: troque a coluna do código do pedido e confira de novo.`,
  sem_coluna_pedido: () =>
    "O arquivo não tem a coluna do código do pedido: a comparação é pelos totais (por afiliado e por dia) e não dá para recuperar vendas.",
  sem_coluna_status: () =>
    "O arquivo não tem a coluna do status: todos os pedidos foram tratados como pagos. Se ele tiver pedidos pendentes ou expirados, exporte só os pagos ou inclua a coluna do status.",
  sem_coluna_quantidade: () =>
    "O arquivo não tem a quantidade nem os números dos bilhetes: as quantidades não foram comparadas e não dá para recuperar vendas.",
  sem_coluna_valor: () =>
    "O arquivo não tem a coluna do valor: os valores não foram comparados e não dá para recuperar vendas.",
  sem_coluna_afiliado: () =>
    "O arquivo não tem a coluna do afiliado: os afiliados não foram comparados, e uma venda recuperada entra sem afiliado (fora das células).",
  sem_coluna_data: () =>
    "O arquivo não tem a coluna da data: uma venda recuperada entra com a data e a hora em que for recuperada.",
  colunas_pessoais_ignoradas: ({ nomes }) =>
    nomes.length === 1
      ? `A coluna ${nomes[0]} tem dados pessoais e foi ignorada: ela não sai do seu computador nem é guardada.`
      : `As colunas ${listaDeNomes(nomes)} têm dados pessoais e foram ignoradas: elas não saem do seu computador nem são guardadas.`,
  colunas_demais: ({ quantidade }) =>
    `O arquivo tem mais de ${LIMITE_COLUNAS_CSV_RECONCILIACAO} colunas: ${quantos(quantidade ?? 0, "coluna ficou", "colunas ficaram")} de fora.`,
  sem_id: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "linha", "linhas")} sem o código do pedido ${ficou(quantidade)} fora da comparação.`,
  id_invalido: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "linha", "linhas")} com o código do pedido inválido (com espaço, acento ou um sinal no começo, como numa fórmula) ${ficou(quantidade)} fora da comparação.`,
  status_desconhecido: ({ quantidade, unidade }) =>
    `${quantos(quantidade ?? 0, ...UNIDADES[unidade])} com um status que o sistema não reconhece (nem pago, nem pendente, expirado ou cancelado): não ${quantidade === 1 ? "conta" : "contam"} como venda paga.`,
  quantidade_invalida: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "linha", "linhas")} com a quantidade ou os números dos bilhetes ilegíveis (use um número inteiro, como 3).`,
  quantidade_diferente_dos_numeros: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "pedido", "pedidos")} com a quantidade de bilhetes diferente da contagem dos números: vale a quantidade.`,
  valor_invalido: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "linha", "linhas")} com o valor ilegível (use, por exemplo, R$ 20,00).`,
  data_invalida: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "linha", "linhas")} com a data ilegível (use, por exemplo, 23/11/2026 14:30).`,
  afiliado_nao_reconhecido: ({ quantidade, unidade }) =>
    `${quantos(quantidade ?? 0, ...UNIDADES[unidade])} com um afiliado que o sistema não reconhece: não é um número nem o rótulo de um afiliado cadastrado (tela Adesão).`,
  formula_ignorada: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "valor", "valores")} começando com =, +, - ou @ (como uma fórmula de planilha): ${quantidade === 1 ? "foi tratado como ilegível" : "foram tratados como ilegíveis"}.`,
  pedido_inconsistente: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "pedido", "pedidos")} em linhas que não batem entre si (status, afiliado ou dia diferentes): ${ficou(quantidade)} fora da comparação.`,
  um_bilhete_por_linha: () =>
    "Os pedidos aparecem em várias linhas (opção “Um bilhete por linha”): o sistema juntou as linhas de cada pedido. Valores diferentes nas linhas de um pedido são somados.",
  valor_por_bilhete: ({ quantidade, preco, pelaConvencao }) =>
    `${quantos(quantidade ?? 0, "pedido em várias linhas repete", "pedidos em várias linhas repetem")} o mesmo valor em cada linha, e ele é o valor de um bilhete ${pelaConvencao ? "(é assim que batem os pedidos do arquivo que já estão no sistema)" : `(é o preço do bilhete, ${formatarCentavos(preco ?? 0)}, ou um pouco menos, com desconto)`}: o total do pedido é o valor de uma linha vezes o número de linhas.`,
  valor_do_pedido_repetido: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "pedido em várias linhas repete", "pedidos em várias linhas repetem")} em cada linha o valor do pedido inteiro (é assim que batem os pedidos do arquivo que já estão no sistema): o valor conta uma vez.`,
  valor_ambiguo: ({ quantidade, preco }) =>
    `${quantos(quantidade ?? 0, "pedido em várias linhas repete", "pedidos em várias linhas repetem")} o mesmo valor em cada linha, e ele não é o preço do bilhete (${formatarCentavos(preco ?? 0)}): não dá para saber se é o valor de um bilhete ou o do pedido inteiro. O valor ${quantidade === 1 ? "dele" : "deles"} não foi comparado, e ${quantidade === 1 ? "ele não pode ser recuperado" : "eles não podem ser recuperados"} aqui: confira na Rifei.`,
  um_bilhete_por_linha_sem_id: () =>
    "O arquivo tem um bilhete por linha e não tem o código do pedido: só os bilhetes podem ser comparados. Exporte sem a opção “Um bilhete por linha” ou inclua o código do pedido.",
  sem_contagem_de_pedidos: () =>
    "Sem o código do pedido e sem a quantidade de bilhetes, não dá para saber se cada linha é um pedido ou um bilhete: a quantidade de pedidos não foi comparada, e os valores foram somados linha a linha.",
  pedido_de_outra_campanha: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "pedido", "pedidos")} do arquivo ${quantidade === 1 ? "está" : "estão"} no sistema em outra campanha e ${ficou(quantidade)} de fora: confira se exportou a campanha certa.`,
  sem_aprovados: () => "O arquivo não tem nenhum pedido pago.",
};

const ORDEM = new Map<CodigoAvisoReconciliacao, number>(
  CODIGOS_AVISO_RECONCILIACAO.map((codigo, indice) => [codigo, indice]),
);

/** Avisos de uma leitura ou comparação; `lista()` sai na ordem de CODIGOS_AVISO_RECONCILIACAO. */
export class Avisos {
  private readonly itens = new Map<CodigoAvisoReconciliacao, DadosDoAviso>();

  /** Aviso que vale para o arquivo inteiro (sem contagem, a não ser que `dados` traga uma). */
  marcar(
    codigo: CodigoAvisoReconciliacao,
    dados: Partial<DadosDoAviso> = {},
  ): void {
    this.itens.set(codigo, {
      quantidade: null,
      unidade: "linha",
      nomes: [],
      ...dados,
    });
  }

  /** Soma `quantidade` ao aviso (nada acontece com zero). */
  contar(
    codigo: CodigoAvisoReconciliacao,
    quantidade: number,
    unidade: UnidadeAviso = "linha",
    dados: Partial<DadosDoAviso> = {},
  ): void {
    if (quantidade <= 0) return;
    const atual = this.itens.get(codigo)?.quantidade ?? 0;
    this.itens.set(codigo, {
      nomes: [],
      ...dados,
      quantidade: atual + quantidade,
      unidade,
    });
  }

  tem(codigo: CodigoAvisoReconciliacao): boolean {
    return this.itens.has(codigo);
  }

  lista(): AvisoReconciliacao[] {
    return CODIGOS_AVISO_RECONCILIACAO.flatMap((codigo) => {
      const dados = this.itens.get(codigo);
      return dados
        ? [
            {
              codigo,
              mensagem: MENSAGENS[codigo](dados),
              quantidade: dados.quantidade,
            },
          ]
        : [];
    });
  }
}

/** Junta listas de avisos (a da leitura, no navegador, e a da API) na ordem do contrato, sem repetir código. */
export function juntarAvisos(
  ...listas: readonly (readonly AvisoReconciliacao[])[]
): AvisoReconciliacao[] {
  const porCodigo = new Map<CodigoAvisoReconciliacao, AvisoReconciliacao>();
  for (const lista of listas)
    for (const aviso of lista)
      if (!porCodigo.has(aviso.codigo)) porCodigo.set(aviso.codigo, aviso);
  return [...porCodigo.values()].sort(
    (a, b) => (ORDEM.get(a.codigo) ?? 0) - (ORDEM.get(b.codigo) ?? 0),
  );
}
