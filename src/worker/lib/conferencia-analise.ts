/**
 * Análise da conferência (RIFA-012; docs/integracao-rifei.md, seção 10): junta as linhas lidas do arquivo
 * (lib/conferencia-arquivo.ts) em pedidos, compara com os pedidos gravados e monta a resposta de
 * POST /api/admin/reconciliacao/analisar (por pedido ou agregado) e o plano do "Recuperar".
 *
 * Módulo puro: recebe o que o banco leu e o instante "agora"; não lê o banco nem o relógio. As respostas
 * só levam códigos de pedido validados, status normalizados, números, centavos, dias e ids de afiliado:
 * nenhum texto livre do arquivo (D1).
 */
import {
  CAMPOS_RECONCILIACAO,
  LIMITE_COLUNAS_CSV_RECONCILIACAO,
  LIMITE_ITENS_POR_DIVERGENCIA,
  TIPOS_DIVERGENCIA,
  diaLocalDoInstante,
  hojeNoFuso,
  intervaloUtcDoDia,
  type AvisoReconciliacao,
  type CodigoAvisoReconciliacao,
  type ColunaArquivoReconciliacao,
  type Divergencia,
  type GrupoDivergencia,
  type MapeamentoReconciliacao,
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
  CODIGOS_AVISO_RECONCILIACAO,
  MOTIVOS_NAO_RECUPERADO,
} from "../../shared/contracts";
import {
  INVALIDO,
  VAZIO,
  chaveDoAfiliado,
  type AfiliadoLido,
  type DataLida,
  type LeituraArquivo,
  type LinhaLida,
} from "./conferencia-arquivo";

/** A leitura do arquivo que deu certo. */
export type ArquivoLido = Extract<LeituraArquivo, { ok: true }>;

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
  aprovado_em: string | null;
  origem: OrigemPedido;
}

export interface AfiliadoGravado {
  affiliate_id: number;
  rotulo: string | null;
  celula_id: number | null;
  celula_nome: string | null;
}

export interface DadosDoSistema {
  campanhaId: number;
  fuso: string;
  /** Pedidos de todas as campanhas (a comparação usa os da ativa; os outros só contam como existentes). */
  pedidos: readonly PedidoGravado[];
  afiliados: readonly AfiliadoGravado[];
}

type Celula = { id: number; nome: string } | null;

/** Afiliados do banco: célula de cada um e o rótulo (usuário da Rifei) para reconhecer texto do arquivo. */
class Afiliados {
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

  /** O afiliado do arquivo, resolvido: número, rótulo cadastrado, vazio ou não reconhecido. */
  doArquivo(lido: AfiliadoLido | null): {
    situacao: SituacaoAfiliadoArquivo;
    affiliateId: number | null;
  } {
    if (lido === null) return { situacao: "sem_coluna", affiliateId: null };
    switch (lido.tipo) {
      case "vazio":
        return { situacao: "vazio", affiliateId: null };
      case "numero":
        return { situacao: "reconhecido", affiliateId: lido.id };
      case "texto": {
        const id = this.porRotulo.get(lido.chave);
        return id == null
          ? { situacao: "nao_reconhecido", affiliateId: null }
          : { situacao: "reconhecido", affiliateId: id };
      }
      default:
        return { situacao: "nao_reconhecido", affiliateId: null };
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------------------------------

const quantos = (n: number, singular: string, plural: string) =>
  `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : plural}`;

/** "Nome", "Nome e Email", "Nome, Email e Telefone". */
function listaDeNomes(nomes: readonly string[]): string {
  return nomes.length <= 1
    ? (nomes[0] ?? "")
    : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

type Unidade = "linha" | "pedido";
const UNIDADES: Record<Unidade, [string, string]> = {
  linha: ["linha", "linhas"],
  pedido: ["pedido", "pedidos"],
};

interface DadosDoAviso {
  quantidade: number | null;
  unidade: Unidade;
  nomes: string[];
}

const MENSAGENS: Record<
  CodigoAvisoReconciliacao,
  (dados: DadosDoAviso) => string
> = {
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
      ? `A coluna ${nomes[0]} tem dados pessoais e foi ignorada: o sistema não lê nem guarda nada dela.`
      : `As colunas ${listaDeNomes(nomes)} têm dados pessoais e foram ignoradas: o sistema não lê nem guarda nada delas.`,
  colunas_demais: ({ quantidade }) =>
    `O arquivo tem mais de ${LIMITE_COLUNAS_CSV_RECONCILIACAO} colunas: ${quantos(quantidade ?? 0, "coluna ficou", "colunas ficaram")} de fora.`,
  sem_id: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "linha", "linhas")} sem o código do pedido ${quantidade === 1 ? "ficou" : "ficaram"} fora da comparação.`,
  id_invalido: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "linha", "linhas")} com o código do pedido inválido (com espaço, acento ou um sinal no começo, como numa fórmula) ${quantidade === 1 ? "ficou" : "ficaram"} fora da comparação.`,
  status_desconhecido: ({ quantidade, unidade }) =>
    `${quantos(quantidade ?? 0, ...UNIDADES[unidade])} com um status que o sistema não reconhece (nem pago, nem pendente, expirado ou cancelado): não ${quantidade === 1 ? "conta" : "contam"} como venda paga.`,
  quantidade_invalida: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "linha", "linhas")} com a quantidade de bilhetes ilegível (use um número inteiro, como 3).`,
  quantidade_diferente_dos_numeros: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "pedido", "pedidos")} com a quantidade de bilhetes diferente da lista de números: vale a quantidade.`,
  valor_invalido: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "linha", "linhas")} com o valor ilegível (use, por exemplo, R$ 20,00).`,
  data_invalida: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "linha", "linhas")} com a data ilegível (use, por exemplo, 23/11/2026 14:30).`,
  afiliado_nao_reconhecido: ({ quantidade, unidade }) =>
    `${quantos(quantidade ?? 0, ...UNIDADES[unidade])} com um afiliado que o sistema não reconhece: não é um número nem o rótulo de um afiliado cadastrado (tela Adesão).`,
  formula_ignorada: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "valor", "valores")} começando com =, +, - ou @ (como uma fórmula de planilha): ${quantidade === 1 ? "foi tratado como ilegível" : "foram tratados como ilegíveis"}.`,
  pedido_inconsistente: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "pedido", "pedidos")} em linhas que não batem entre si (status, afiliado ou dia diferentes): ${quantidade === 1 ? "ficou" : "ficaram"} fora da comparação.`,
  um_bilhete_por_linha: () =>
    "Os pedidos aparecem em várias linhas (opção “Um bilhete por linha”). O sistema juntou as linhas de cada pedido: um valor igual em todas as linhas conta uma vez; valores diferentes são somados.",
  um_bilhete_por_linha_sem_id: () =>
    "O arquivo tem um bilhete por linha e não tem o código do pedido: só os bilhetes podem ser comparados. Exporte sem a opção “Um bilhete por linha” ou inclua o código do pedido.",
  pedido_de_outra_campanha: ({ quantidade }) =>
    `${quantos(quantidade ?? 0, "pedido", "pedidos")} do arquivo ${quantidade === 1 ? "está" : "estão"} no sistema em outra campanha e ${quantidade === 1 ? "ficou" : "ficaram"} de fora: confira se exportou a campanha certa.`,
  sem_aprovados: () => "O arquivo não tem nenhum pedido pago.",
};

/** Avisos da leitura e da comparação, na ordem de CODIGOS_AVISO_RECONCILIACAO. */
export class Avisos {
  private readonly itens = new Map<CodigoAvisoReconciliacao, DadosDoAviso>();

  /** Aviso que vale para o arquivo inteiro (sem contagem). */
  marcar(codigo: CodigoAvisoReconciliacao, nomes: string[] = []): void {
    this.itens.set(codigo, { quantidade: null, unidade: "linha", nomes });
  }

  /** Soma `quantidade` ao aviso (nada acontece com zero). */
  contar(
    codigo: CodigoAvisoReconciliacao,
    quantidade: number,
    unidade: Unidade = "linha",
  ): void {
    if (quantidade <= 0) return;
    const atual = this.itens.get(codigo)?.quantidade ?? 0;
    this.itens.set(codigo, {
      quantidade: atual + quantidade,
      unidade,
      nomes: [],
    });
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

/** Avisos que só dependem das colunas e dos problemas de formato das células. */
function avisosDaLeitura(arquivo: ArquivoLido): Avisos {
  const avisos = new Avisos();
  const { mapeamento, colunas, problemas } = arquivo;
  if (mapeamento.pedido_id === null) avisos.marcar("sem_coluna_pedido");
  if (mapeamento.status === null) avisos.marcar("sem_coluna_status");
  if (mapeamento.qtd_bilhetes === null && mapeamento.bilhetes === null)
    avisos.marcar("sem_coluna_quantidade");
  if (mapeamento.valor === null) avisos.marcar("sem_coluna_valor");
  if (mapeamento.afiliado === null) avisos.marcar("sem_coluna_afiliado");
  if (mapeamento.data === null) avisos.marcar("sem_coluna_data");
  const pessoais = colunas
    .filter((coluna) => coluna.dado_pessoal)
    .map((coluna) => coluna.nome);
  if (pessoais.length > 0)
    avisos.marcar("colunas_pessoais_ignoradas", pessoais);
  avisos.contar("colunas_demais", arquivo.colunasDemais);
  if (mapeamento.pedido_id !== null) {
    avisos.contar("sem_id", problemas.semId);
    avisos.contar("id_invalido", problemas.idInvalido);
  }
  avisos.contar(
    "quantidade_invalida",
    problemas.quantidadeInvalida + problemas.numerosInvalidos,
  );
  avisos.contar("valor_invalido", problemas.valorInvalido);
  avisos.contar("data_invalida", problemas.dataInvalida);
  avisos.contar("formula_ignorada", problemas.formulas);
  return avisos;
}

// ---------------------------------------------------------------------------------------------------
// Linhas → pedidos
// ---------------------------------------------------------------------------------------------------

/** Um pedido do arquivo: as linhas com o mesmo código, juntas. */
export interface PedidoDoArquivo {
  id: string;
  /** Linhas do arquivo com este código. */
  linhas: number;
  /** Linhas com status, afiliado ou dia diferentes: fica fora da comparação e não pode ser recuperado. */
  inconsistente: boolean;
  /** `aprovado` quando o arquivo não tem a coluna de status. */
  status: StatusArquivoReconciliacao;
  qtd: number | null;
  /** Números dos bilhetes, sem repetição e em ordem. */
  numeros: number[] | null;
  centavos: number | null;
  afiliado: AfiliadoLido | null;
  data: DataLida | null;
  qtdDiferenteDosNumeros: boolean;
}

/** O único valor (pela chave) de uma lista, ou o conflito. Lista vazia: `undefined`. */
function unico<T>(
  valores: readonly T[],
  chave: (valor: T) => string,
): { valor: T | undefined; conflito: boolean } {
  const primeiro = valores[0];
  if (primeiro === undefined) return { valor: undefined, conflito: false };
  const referencia = chave(primeiro);
  return {
    valor: primeiro,
    conflito: valores.some((valor) => chave(valor) !== referencia),
  };
}

const soma = (valores: readonly number[]) =>
  valores.reduce((total, valor) => total + valor, 0);

/**
 * Valor numérico de um pedido em várias linhas: igual em todas conta uma vez (é do pedido, repetido em
 * cada linha); diferentes, somam (são de cada linha).
 */
function juntarValores(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  return valores.every((valor) => valor === valores[0])
    ? valores[0]
    : soma(valores);
}

/**
 * Quantidade de um pedido em várias linhas: como os valores, mas uma linha por bilhete com a mesma
 * quantidade em todas ("1" em cada uma, ou o total repetido) dá pelo menos uma por linha.
 */
function juntarQuantidades(
  valores: readonly number[],
  linhas: number,
): number | null {
  const junta = juntarValores(valores);
  if (junta === null) return null;
  const iguais = valores.every((valor) => valor === valores[0]);
  return iguais && valores.length === linhas && linhas > 1
    ? Math.max(junta, linhas)
    : junta;
}

const numeroOu = <T>(valor: T | number | null): number | null =>
  typeof valor === "number" ? valor : null;

const chaveDoAfiliadoLido = (afiliado: AfiliadoLido) =>
  afiliado.tipo === "numero"
    ? `n:${afiliado.id}`
    : afiliado.tipo === "texto"
      ? `t:${afiliado.chave}`
      : afiliado.tipo;

function juntarLinhas(
  id: string,
  linhas: readonly LinhaLida[],
  mapeamento: MapeamentoReconciliacao,
): PedidoDoArquivo {
  let inconsistente = false;

  let status: StatusArquivoReconciliacao = "aprovado";
  if (mapeamento.status !== null) {
    const valores = linhas.flatMap((linha) =>
      linha.status === null || linha.status === VAZIO ? [] : [linha.status],
    );
    const { valor, conflito } = unico(valores, (item) => item);
    inconsistente ||= conflito;
    status = valor ?? "desconhecido";
  }

  const numeros = new Set<number>();
  let temNumeros = false;
  for (const linha of linhas) {
    if (Array.isArray(linha.numeros)) {
      temNumeros = true;
      for (const numero of linha.numeros) numeros.add(numero);
    }
  }
  const listaNumeros = temNumeros ? [...numeros].sort((a, b) => a - b) : null;
  const qtdDaColuna = juntarQuantidades(
    linhas.flatMap((linha) => {
      const qtd = numeroOu(linha.qtd);
      return qtd === null ? [] : [qtd];
    }),
    linhas.length,
  );
  const qtd = qtdDaColuna ?? listaNumeros?.length ?? null;

  const centavos = juntarValores(
    linhas.flatMap((linha) => {
      const valor = numeroOu(linha.centavos);
      return valor === null ? [] : [valor];
    }),
  );

  let afiliado: AfiliadoLido | null = null;
  if (mapeamento.afiliado !== null) {
    const valores = linhas.flatMap((linha) =>
      linha.afiliado === null || linha.afiliado.tipo === "vazio"
        ? []
        : [linha.afiliado],
    );
    const { valor, conflito } = unico(valores, chaveDoAfiliadoLido);
    inconsistente ||= conflito;
    afiliado = valor ?? { tipo: "vazio" };
  }

  let data: DataLida | null = null;
  if (mapeamento.data !== null) {
    const valores = linhas.flatMap((linha) =>
      linha.data === null || linha.data === VAZIO || linha.data === INVALIDO
        ? []
        : [linha.data],
    );
    const { valor, conflito } = unico(valores, (item) => item.dia);
    inconsistente ||= conflito;
    data = valores.find((item) => item.instante !== null) ?? valor ?? null;
  }

  return {
    id,
    linhas: linhas.length,
    inconsistente,
    status,
    qtd,
    numeros: listaNumeros,
    centavos,
    afiliado,
    data,
    qtdDiferenteDosNumeros:
      qtdDaColuna !== null &&
      listaNumeros !== null &&
      qtdDaColuna !== listaNumeros.length,
  };
}

/** Os pedidos do arquivo pelo código, na ordem da primeira linha de cada um. */
export function agruparPedidos(arquivo: ArquivoLido): {
  pedidos: Map<string, PedidoDoArquivo>;
  /** Algum código aparece em mais de uma linha. */
  repetidos: boolean;
  linhasSemCodigo: number;
} {
  const porId = new Map<string, LinhaLida[]>();
  let linhasSemCodigo = 0;
  for (const linha of arquivo.linhas) {
    if (
      typeof linha.id !== "string" ||
      linha.id === VAZIO ||
      linha.id === INVALIDO
    ) {
      linhasSemCodigo++;
      continue;
    }
    const lista = porId.get(linha.id);
    if (lista) lista.push(linha);
    else porId.set(linha.id, [linha]);
  }
  const pedidos = new Map<string, PedidoDoArquivo>();
  let repetidos = false;
  for (const [id, linhas] of porId) {
    repetidos ||= linhas.length > 1;
    pedidos.set(id, juntarLinhas(id, linhas, arquivo.mapeamento));
  }
  return { pedidos, repetidos, linhasSemCodigo };
}

/** Primeiro e último dia (no fuso da campanha) que a coluna da data cobre. */
function periodoDoArquivo(
  linhas: readonly LinhaLida[],
): { inicio: string; fim: string } | null {
  let inicio: string | null = null;
  let fim: string | null = null;
  for (const linha of linhas) {
    const data = linha.data;
    if (data === null || data === VAZIO || data === INVALIDO) continue;
    if (inicio === null || data.dia < inicio) inicio = data.dia;
    if (fim === null || data.dia > fim) fim = data.dia;
  }
  return inicio === null || fim === null ? null : { inicio, fim };
}

// ---------------------------------------------------------------------------------------------------
// Modo por pedido
// ---------------------------------------------------------------------------------------------------

const MS_POR_HORA = 3_600_000;

/** Instante a gravar num pedido recuperado (e de onde ele veio). null: a data do arquivo é no futuro. */
function instanteDaVenda(
  data: DataLida | null,
  fuso: string,
  agora: Date,
): { instante: number; origem: PedidoRecuperado["origem_data"] } | null {
  const agoraMs = agora.getTime();
  if (data === null) return { instante: agoraMs, origem: "recuperacao" };
  if (data.instante !== null)
    return data.instante > agoraMs
      ? null
      : { instante: data.instante, origem: "arquivo" };
  const hoje = hojeNoFuso(fuso, agora);
  if (data.dia > hoje) return null;
  const meioDia =
    Date.parse(intervaloUtcDoDia(data.dia, fuso).inicio) + 12 * MS_POR_HORA;
  return { instante: Math.min(meioDia, agoraMs), origem: "dia_do_arquivo" };
}

/** O que impede a recuperação de uma venda perdida (lista vazia = recuperável). */
function impedimentos(
  pedido: PedidoDoArquivo,
  fuso: string,
  agora: Date,
): ("sem_quantidade" | "sem_valor" | "data_no_futuro")[] {
  const lista: ("sem_quantidade" | "sem_valor" | "data_no_futuro")[] = [];
  if (pedido.qtd === null || pedido.qtd < 1) lista.push("sem_quantidade");
  if (pedido.centavos === null) lista.push("sem_valor");
  if (instanteDaVenda(pedido.data, fuso, agora) === null)
    lista.push("data_no_futuro");
  return lista;
}

function ladoDoArquivo(
  pedido: PedidoDoArquivo,
  afiliados: Afiliados,
): PedidoNoArquivo {
  const { situacao, affiliateId } = afiliados.doArquivo(pedido.afiliado);
  return {
    status: pedido.status,
    qtd_bilhetes: pedido.qtd,
    total_centavos: pedido.centavos,
    afiliado: situacao,
    affiliate_id: affiliateId,
    celula: afiliados.celula(affiliateId),
    data: pedido.data?.dia ?? null,
  };
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
    aprovado_em: pedido.aprovado_em,
    origem: pedido.origem,
  };
}

const porCodigo = (a: Divergencia, b: Divergencia) =>
  a.pedido_id < b.pedido_id ? -1 : a.pedido_id > b.pedido_id ? 1 : 0;

function montarGrupo(
  tipo: TipoDivergencia,
  itens: Divergencia[],
): GrupoDivergencia {
  itens.sort(porCodigo);
  const somar = (
    lado: (item: Divergencia) => {
      qtd_bilhetes: number | null;
      total_centavos: number | null;
    } | null,
  ) => ({
    bilhetes: soma(itens.map((item) => lado(item)?.qtd_bilhetes ?? 0)),
    total_centavos: soma(itens.map((item) => lado(item)?.total_centavos ?? 0)),
  });
  return {
    tipo,
    quantidade: itens.length,
    arquivo: somar((item) => item.arquivo),
    sistema: somar((item) => item.sistema),
    itens: itens.slice(0, LIMITE_ITENS_POR_DIVERGENCIA),
    itens_omitidos: Math.max(0, itens.length - LIMITE_ITENS_POR_DIVERGENCIA),
  };
}

const ehPendenteOuNegado = (status: StatusArquivoReconciliacao) =>
  status === "pendente" || status === "expirado" || status === "cancelado";

function comum(
  arquivo: ArquivoLido,
  avisos: Avisos,
  extra: {
    linhasIgnoradas: number;
    umBilhetePorLinha: boolean;
    periodo: { inicio: string; fim: string } | null;
  },
  agora: Date,
) {
  return {
    colunas: arquivo.colunas satisfies ColunaArquivoReconciliacao[],
    mapeamento: arquivo.mapeamento,
    mapeamento_detectado: arquivo.detectado,
    arquivo: {
      linhas: arquivo.linhas.length,
      linhas_ignoradas: extra.linhasIgnoradas,
      um_bilhete_por_linha: extra.umBilhetePorLinha,
      data_inicio: extra.periodo?.inicio ?? null,
      data_fim: extra.periodo?.fim ?? null,
    },
    avisos: avisos.lista(),
    conferido_em: agora.toISOString(),
  };
}

function totaisDoSistema(pedidos: readonly PedidoGravado[]): TotaisVendas {
  return {
    pedidos_aprovados: pedidos.length,
    bilhetes: soma(pedidos.map((pedido) => pedido.qtd_bilhetes)),
    total_centavos: soma(pedidos.map((pedido) => pedido.total_centavos)),
  };
}

/** Comparação pedido a pedido (o arquivo tem a coluna do código). */
export function analisarPorPedido(
  arquivo: ArquivoLido,
  dados: DadosDoSistema,
  agora: Date,
): RespostaAnalisePorPedido {
  const avisos = avisosDaLeitura(arquivo);
  const afiliados = new Afiliados(dados.afiliados);
  const { pedidos, repetidos, linhasSemCodigo } = agruparPedidos(arquivo);
  if (repetidos) avisos.marcar("um_bilhete_por_linha");
  const periodo = periodoDoArquivo(arquivo.linhas);

  const daCampanha = new Map<string, PedidoGravado>();
  const deOutraCampanha = new Set<string>();
  for (const pedido of dados.pedidos) {
    if (pedido.campanha_id === dados.campanhaId)
      daCampanha.set(pedido.id, pedido);
    else deOutraCampanha.add(pedido.id);
  }

  const grupos = new Map<TipoDivergencia, Divergencia[]>(
    TIPOS_DIVERGENCIA.map((tipo) => [tipo, []]),
  );
  const incluir = (tipo: TipoDivergencia, item: Divergencia) =>
    grupos.get(tipo)!.push(item);
  const comDivergencia = new Set<string>();
  let conferem = 0;
  let inconsistentes = 0;
  let desconhecidos = 0;
  let afiliadosNaoReconhecidos = 0;
  let deOutra = 0;
  let qtdDiferentes = 0;
  const aprovadosNoArquivo: PedidoDoArquivo[] = [];

  for (const pedido of pedidos.values()) {
    if (pedido.inconsistente) {
      inconsistentes++;
      continue;
    }
    if (pedido.qtdDiferenteDosNumeros) qtdDiferentes++;
    if (pedido.status === "desconhecido") desconhecidos++;
    const doArquivo = ladoDoArquivo(pedido, afiliados);
    if (doArquivo.afiliado === "nao_reconhecido") afiliadosNaoReconhecidos++;
    const gravado = daCampanha.get(pedido.id);
    if (!gravado && deOutraCampanha.has(pedido.id)) {
      deOutra++;
      continue;
    }
    if (pedido.status === "aprovado") aprovadosNoArquivo.push(pedido);
    const item = (tipo: TipoDivergencia, extra: Partial<Divergencia> = {}) => {
      comDivergencia.add(pedido.id);
      incluir(tipo, {
        pedido_id: pedido.id,
        arquivo: doArquivo,
        sistema: gravado ? ladoDoSistema(gravado, afiliados) : null,
        recuperavel: false,
        observacoes: [],
        ...extra,
      });
    };

    if (pedido.status === "aprovado") {
      if (!gravado) {
        const observacoes = impedimentos(pedido, dados.fuso, agora);
        item("venda_perdida", {
          recuperavel: observacoes.length === 0,
          observacoes,
        });
        continue;
      }
      if (gravado.status !== "approved") {
        item("pagamento_nao_registrado");
        continue;
      }
      let diferente = false;
      if (
        pedido.centavos !== null &&
        pedido.centavos !== gravado.total_centavos
      ) {
        item("valor_diferente");
        diferente = true;
      }
      if (pedido.qtd !== null && pedido.qtd !== gravado.qtd_bilhetes) {
        item("quantidade_diferente");
        diferente = true;
      }
      if (
        doArquivo.afiliado !== "sem_coluna" &&
        doArquivo.afiliado !== "nao_reconhecido" &&
        doArquivo.affiliate_id !== gravado.affiliate_id
      ) {
        item("afiliado_diferente");
        diferente = true;
      }
      if (!diferente) conferem++;
    } else if (
      gravado?.status === "approved" &&
      ehPendenteOuNegado(pedido.status)
    ) {
      item("nao_pago_na_rifei");
    }
  }

  // Pagos no sistema que o arquivo não tem (nem com código inconsistente, nem não pago).
  const aprovadosNoSistema = [...daCampanha.values()].filter(
    (pedido) => pedido.status === "approved",
  );
  for (const gravado of aprovadosNoSistema) {
    if (pedidos.has(gravado.id)) continue;
    const dia =
      gravado.aprovado_em === null
        ? null
        : diaLocalDoInstante(gravado.aprovado_em, dados.fuso);
    const fora =
      periodo !== null &&
      dia !== null &&
      (dia < periodo.inicio || dia > periodo.fim);
    comDivergencia.add(gravado.id);
    incluir("ausente_no_arquivo", {
      pedido_id: gravado.id,
      arquivo: null,
      sistema: ladoDoSistema(gravado, afiliados),
      recuperavel: false,
      observacoes: fora ? ["fora_do_periodo_do_arquivo"] : [],
    });
  }

  avisos.contar("status_desconhecido", desconhecidos, "pedido");
  avisos.contar("quantidade_diferente_dos_numeros", qtdDiferentes, "pedido");
  avisos.contar("afiliado_nao_reconhecido", afiliadosNaoReconhecidos, "pedido");
  avisos.contar("pedido_inconsistente", inconsistentes, "pedido");
  avisos.contar("pedido_de_outra_campanha", deOutra, "pedido");
  if (aprovadosNoArquivo.length === 0) avisos.marcar("sem_aprovados");

  const temQuantidade =
    arquivo.mapeamento.qtd_bilhetes !== null ||
    arquivo.mapeamento.bilhetes !== null;
  return {
    modo: "por_pedido",
    ...comum(
      arquivo,
      avisos,
      {
        linhasIgnoradas: linhasSemCodigo,
        umBilhetePorLinha: repetidos,
        periodo,
      },
      agora,
    ),
    resumo: {
      pedidos_no_arquivo: pedidos.size,
      aprovados_no_arquivo: {
        pedidos_aprovados: aprovadosNoArquivo.length,
        bilhetes: temQuantidade
          ? soma(aprovadosNoArquivo.map((pedido) => pedido.qtd ?? 0))
          : null,
        total_centavos:
          arquivo.mapeamento.valor === null
            ? null
            : soma(aprovadosNoArquivo.map((pedido) => pedido.centavos ?? 0)),
      },
      aprovados_no_sistema: totaisDoSistema(aprovadosNoSistema),
      conferem,
      com_divergencia: comDivergencia.size,
    },
    divergencias: TIPOS_DIVERGENCIA.map((tipo) =>
      montarGrupo(tipo, grupos.get(tipo)!),
    ),
  };
}

// ---------------------------------------------------------------------------------------------------
// Modo agregado (sem o código do pedido)
// ---------------------------------------------------------------------------------------------------

interface Acumulado {
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
  const atual = mapa.get(chave) ?? vazioAcumulado();
  atual.pedidos += pedidos;
  atual.bilhetes += bilhetes;
  atual.centavos += centavos;
  mapa.set(chave, atual);
}

const CHAVE_SEM_AFILIADO = "sem";
const CHAVE_NAO_RECONHECIDO = "nr";
const chaveDoId = (id: number) => `id:${id}`;

/** Comparação dos totais pagos: geral, por afiliado e por dia. */
export function analisarAgregado(
  arquivo: ArquivoLido,
  dados: DadosDoSistema,
  agora: Date,
): RespostaAnaliseAgregada {
  const avisos = avisosDaLeitura(arquivo);
  const afiliados = new Afiliados(dados.afiliados);
  const { mapeamento } = arquivo;
  const periodo = periodoDoArquivo(arquivo.linhas);

  const aprovadas = arquivo.linhas.filter((linha) => {
    if (mapeamento.status === null) return true;
    return linha.status === "aprovado";
  });
  const desconhecidas = arquivo.linhas.filter(
    (linha) => linha.status === "desconhecido" || linha.status === VAZIO,
  ).length;
  avisos.contar("status_desconhecido", desconhecidas, "linha");

  // Uma linha por bilhete sem o código: um número por linha e a quantidade do pedido repetida.
  const umBilhetePorLinha =
    mapeamento.bilhetes !== null &&
    mapeamento.qtd_bilhetes !== null &&
    aprovadas.some(
      (linha) =>
        Array.isArray(linha.numeros) &&
        linha.numeros.length === 1 &&
        typeof linha.qtd === "number" &&
        linha.qtd > 1,
    );
  if (umBilhetePorLinha) avisos.marcar("um_bilhete_por_linha_sem_id");
  const contaveis: Contaveis = {
    pedidos: !umBilhetePorLinha,
    bilhetes: mapeamento.qtd_bilhetes !== null || mapeamento.bilhetes !== null,
    valor: mapeamento.valor !== null && !umBilhetePorLinha,
  };
  const bilhetesDaLinha = (linha: LinhaLida) => {
    if (umBilhetePorLinha) return 1;
    const qtd = numeroOu(linha.qtd);
    if (qtd !== null) return qtd;
    return Array.isArray(linha.numeros) ? linha.numeros.length : 0;
  };

  const totalArquivo = vazioAcumulado();
  const porAfiliadoArquivo = new Map<string, Acumulado>();
  const porDiaArquivo = new Map<string, Acumulado>();
  let naoReconhecidos = 0;
  for (const linha of aprovadas) {
    const bilhetes = bilhetesDaLinha(linha);
    const centavos = numeroOu(linha.centavos) ?? 0;
    totalArquivo.pedidos += 1;
    totalArquivo.bilhetes += bilhetes;
    totalArquivo.centavos += centavos;
    if (mapeamento.afiliado !== null) {
      const { situacao, affiliateId } = afiliados.doArquivo(linha.afiliado);
      if (situacao === "nao_reconhecido") naoReconhecidos++;
      const chave =
        affiliateId !== null
          ? chaveDoId(affiliateId)
          : situacao === "nao_reconhecido"
            ? CHAVE_NAO_RECONHECIDO
            : CHAVE_SEM_AFILIADO;
      acumular(porAfiliadoArquivo, chave, 1, bilhetes, centavos);
    }
    const data = linha.data;
    if (data !== null && data !== VAZIO && data !== INVALIDO)
      acumular(porDiaArquivo, data.dia, 1, bilhetes, centavos);
  }
  avisos.contar("afiliado_nao_reconhecido", naoReconhecidos, "linha");
  if (aprovadas.length === 0) avisos.marcar("sem_aprovados");

  // O sistema: pagos da campanha ativa, só nos dias do arquivo quando ele tem datas.
  const totalSistema = vazioAcumulado();
  const porAfiliadoSistema = new Map<string, Acumulado>();
  const porDiaSistema = new Map<string, Acumulado>();
  for (const pedido of dados.pedidos) {
    if (pedido.campanha_id !== dados.campanhaId || pedido.status !== "approved")
      continue;
    const dia =
      pedido.aprovado_em === null
        ? null
        : diaLocalDoInstante(pedido.aprovado_em, dados.fuso);
    if (
      periodo !== null &&
      (dia === null || dia < periodo.inicio || dia > periodo.fim)
    )
      continue;
    totalSistema.pedidos += 1;
    totalSistema.bilhetes += pedido.qtd_bilhetes;
    totalSistema.centavos += pedido.total_centavos;
    acumular(
      porAfiliadoSistema,
      pedido.affiliate_id === null
        ? CHAVE_SEM_AFILIADO
        : chaveDoId(pedido.affiliate_id),
      1,
      pedido.qtd_bilhetes,
      pedido.total_centavos,
    );
    if (dia !== null)
      acumular(
        porDiaSistema,
        dia,
        1,
        pedido.qtd_bilhetes,
        pedido.total_centavos,
      );
  }

  type LinhaAfiliado = NonNullable<
    RespostaAnaliseAgregada["por_afiliado"]
  >[number];
  let porAfiliado: LinhaAfiliado[] | null = null;
  if (mapeamento.afiliado !== null) {
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
  if (mapeamento.data !== null) {
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
    ...comum(
      arquivo,
      avisos,
      { linhasIgnoradas: 0, umBilhetePorLinha, periodo },
      agora,
    ),
    recorte:
      periodo === null
        ? null
        : { data_inicio: periodo.inicio, data_fim: periodo.fim },
    total: comparar(totalArquivo, totalSistema, contaveis),
    por_afiliado: porAfiliado,
    por_dia: porDia,
  };
}

// ---------------------------------------------------------------------------------------------------
// "Recuperar"
// ---------------------------------------------------------------------------------------------------

export type MotivoNaoRecuperado = (typeof MOTIVOS_NAO_RECUPERADO)[number];

/** Um pedido a gravar: o que a resposta mostra e os números dos bilhetes (só para o banco). */
export interface PedidoAGravar extends PedidoRecuperado {
  numeros: number[] | null;
}

export interface PlanoRecuperacao {
  gravar: PedidoAGravar[];
  naoRecuperados: { pedido_id: string; motivo: MotivoNaoRecuperado }[];
  avisos: AvisoReconciliacao[];
}

/** Máximo de números de bilhete guardados por pedido (o webhook guarda até o mesmo limite). */
const MAXIMO_NUMEROS_GUARDADOS = 10_000;

/**
 * Decide, para cada código escolhido (sem repetição, na ordem pedida), se ele pode ser gravado como venda
 * aprovada e com quais dados. `existentes` são os códigos que já estão no banco (em qualquer campanha):
 * esses nunca são sobrescritos.
 */
export function planejarRecuperacao(
  arquivo: ArquivoLido,
  dados: {
    fuso: string;
    afiliados: readonly AfiliadoGravado[];
    existentes: ReadonlySet<string>;
  },
  codigos: readonly string[],
  agora: Date,
): PlanoRecuperacao {
  const avisos = new Avisos();
  const { mapeamento } = arquivo;
  if (mapeamento.status === null) avisos.marcar("sem_coluna_status");
  if (mapeamento.afiliado === null) avisos.marcar("sem_coluna_afiliado");
  if (mapeamento.data === null) avisos.marcar("sem_coluna_data");
  const afiliados = new Afiliados(dados.afiliados);
  const { pedidos } = agruparPedidos(arquivo);

  const gravar: PedidoAGravar[] = [];
  const naoRecuperados: PlanoRecuperacao["naoRecuperados"] = [];
  let naoReconhecidos = 0;
  for (const codigo of new Set(codigos)) {
    const nao = (motivo: MotivoNaoRecuperado) =>
      naoRecuperados.push({ pedido_id: codigo, motivo });
    const pedido = pedidos.get(codigo);
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
    if (dados.existentes.has(codigo)) {
      nao("ja_existe");
      continue;
    }
    if (pedido.qtd === null || pedido.qtd < 1) {
      nao("sem_quantidade");
      continue;
    }
    if (pedido.centavos === null) {
      nao("sem_valor");
      continue;
    }
    const venda = instanteDaVenda(pedido.data, dados.fuso, agora);
    if (venda === null) {
      nao("data_no_futuro");
      continue;
    }
    const { situacao, affiliateId } = afiliados.doArquivo(pedido.afiliado);
    if (situacao === "nao_reconhecido") naoReconhecidos++;
    gravar.push({
      pedido_id: codigo,
      qtd_bilhetes: pedido.qtd,
      total_centavos: pedido.centavos,
      afiliado: situacao,
      affiliate_id: affiliateId,
      celula: afiliados.celula(affiliateId),
      aprovado_em: new Date(venda.instante).toISOString(),
      origem_data: venda.origem,
      numeros:
        pedido.numeros !== null &&
        pedido.numeros.length <= MAXIMO_NUMEROS_GUARDADOS
          ? pedido.numeros
          : null,
    });
  }
  avisos.contar("afiliado_nao_reconhecido", naoReconhecidos, "pedido");
  return { gravar, naoRecuperados, avisos: avisos.lista() };
}

/** Os campos do pedido na resposta (sem os números dos bilhetes). */
export function paraResposta(pedido: PedidoAGravar): PedidoRecuperado {
  const { numeros: _numeros, ...resto } = pedido;
  void _numeros;
  return resto;
}

/** Nome de coluna usado em cada campo (para a auditoria). */
export function colunasDoMapeamento(
  arquivo: ArquivoLido,
): Record<(typeof CAMPOS_RECONCILIACAO)[number], string | null> {
  return Object.fromEntries(
    CAMPOS_RECONCILIACAO.map((campo) => {
      const indice = arquivo.mapeamento[campo];
      return [campo, indice === null ? null : arquivo.colunas[indice].nome];
    }),
  ) as Record<(typeof CAMPOS_RECONCILIACAO)[number], string | null>;
}
