/**
 * Leitura do CSV "Exportar Pedidos" da Rifei para a conferência (RIFA-012; docs/integracao-rifei.md,
 * seção 10): o cabeçalho vira a lista de colunas (o campo que cada nome indica, com as variações em
 * português e em inglês, e as colunas de dado pessoal), o mapeamento é detectado ou conferido, e cada
 * linha sai com os valores das colunas MAPEADAS já interpretados.
 *
 * Privacidade (D1): o arquivo inteiro passa por `lerCsv` (lib/csv.ts) na memória da requisição, mas daqui
 * só sai o que as colunas mapeadas têm, já convertido: código validado (FORMATO_ID_PEDIDO_RECONCILIACAO),
 * status normalizado, números, centavos e dia. As colunas de dado pessoal nunca são lidas nem podem ser
 * mapeadas. Nenhuma função daqui devolve, guarda ou manda para o log um valor do arquivo: as falhas e os
 * avisos só trazem números de linha, contagens e nomes de coluna.
 *
 * As colunas reais do export da Rifei ainda não estão confirmadas (integracao-rifei.md, seção 9, item 9):
 * a detecção é por palavras do nome, e a coordenação confere e ajusta o mapeamento na tela.
 */
import {
  CAMPOS_RECONCILIACAO,
  FORMATO_ID_PEDIDO_RECONCILIACAO,
  LIMITE_CARACTERES_CSV_RECONCILIACAO,
  LIMITE_COLUNAS_CSV_RECONCILIACAO,
  LIMITE_LINHAS_CSV_RECONCILIACAO,
  diaDoCalendario,
  hojeNoFuso,
  intervaloUtcDoDia,
  type CampoReconciliacao,
  type ColunaArquivoReconciliacao,
  type DetalheValidacao,
  type MapeamentoReconciliacao,
  type StatusArquivoReconciliacao,
} from "../../shared/contracts";
import {
  arquivoVazio,
  lerCsv,
  normalizarNomeDeColuna,
  resumirNomeDeColuna,
  type FalhaCsv,
  type RegistroCsv,
} from "./csv";

// ---------------------------------------------------------------------------------------------------
// Falhas do arquivo (400 csv_invalido, no formato detalhesCsvInvalidoSchema)
// ---------------------------------------------------------------------------------------------------

/** Arquivo acima do limite de caracteres (o `csv` do corpo). */
export function arquivoGrandeParaConferencia(): FalhaCsv {
  const megabytes = LIMITE_CARACTERES_CSV_RECONCILIACAO / 1_000_000;
  return {
    ok: false,
    mensagem: `O arquivo passa de ${megabytes} MB. Exporte da Rifei só as colunas que a conferência usa (sem nome, e-mail e telefone) ou um período menor.`,
    detalhes: {
      motivo: "arquivo_grande",
      limite_caracteres: LIMITE_CARACTERES_CSV_RECONCILIACAO,
    },
  };
}

function linhasDemais(total: number): FalhaCsv {
  const limite = LIMITE_LINHAS_CSV_RECONCILIACAO;
  return {
    ok: false,
    mensagem: `O arquivo tem ${total.toLocaleString("pt-BR")} linhas de pedidos; o limite é ${limite.toLocaleString("pt-BR")}. Exporte um período menor, ou sem a opção “Um bilhete por linha”.`,
    detalhes: { motivo: "linhas_demais", limite, total_linhas: total },
  };
}

function cabecalhoComDados(): FalhaCsv {
  return {
    ok: false,
    mensagem:
      "A primeira linha do arquivo não parece um cabeçalho: ela tem números, datas, valores ou e-mails. Exporte de novo pela Rifei: a primeira linha precisa ter os nomes das colunas.",
    detalhes: { motivo: "sem_cabecalho" },
  };
}

/** O que o decodificador põe no lugar de bytes que não são UTF-8 (ex.: arquivo salvo em Windows-1252). */
const CARACTERE_INVALIDO = "\uFFFD";

// ---------------------------------------------------------------------------------------------------
// Detecção das colunas pelo nome
// ---------------------------------------------------------------------------------------------------

/** Conjunto de palavras escritas num texto só, separadas por espaço. */
const conjunto = (palavras: string) => new Set(palavras.split(" "));

const DO_AFILIADO = conjunto(
  "afiliado afiliada afiliados afiliadas affiliate affiliates vendedor vendedora revendedor revendedora promotor promotora indicacao indicado indicada indicador indicadora parceiro parceira embaixador embaixadora referral",
);
const DE_IDENTIFICADOR = conjunto(
  "id codigo cod numero num nro n no identificador code ref referencia",
);
const DE_CONTEXTO_DO_STATUS = conjunto("pedido pagamento compra order payment");
/** Dado pessoal do comprador (ou da compra dele): a coluna nunca é lida. */
const DE_DADO_PESSOAL = conjunto(
  "nome name email mail telefone fone tel celular whatsapp zap phone mobile cpf cnpj documento document rg nascimento birth birthday aniversario idade endereco address logradouro rua bairro cidade city municipio cep zipcode zip uf estado state pais country complemento comprador compradora cliente buyer customer sobrenome genero sexo instagram facebook observacao observacoes obs observation ip",
);
/** Com uma destas colunas no arquivo, "Número" sozinho é o número do endereço (dado pessoal). */
const DO_ENDERECO = conjunto(
  "endereco address logradouro rua bairro cep zipcode complemento",
);
const SO_NUMERO = conjunto("numero num nro n no number");
const DE_DATA = conjunto("data date dia datahora datetime timestamp");
/** "Pago em", "Criado em", "paid_at"... */
const ANTES_DE_EM = conjunto(
  "pago paga aprovado aprovada confirmado confirmada criado criada feito realizado comprado",
);
const ANTES_DE_AT = conjunto("created paid approved confirmed");
const DO_PAGAMENTO = conjunto(
  "pagamento pago paga aprovacao aprovado aprovada confirmacao confirmado confirmada paid approved approval payment confirmed",
);
/** Datas que não são da venda: a coluna fica sem campo. */
const DE_DATA_IGNORADA = conjunto(
  "vencimento expiracao expira expirado expirada expired expires validade reserva atualizacao atualizado updated alteracao cancelamento sorteio",
);
const DE_QUANTIDADE = conjunto("quantidade qtd qtde quant quantity qty count");
const DE_BILHETE = conjunto(
  "bilhete bilhetes cota cotas numeros numbers ticket tickets titulo titulos",
);
const TOTAL_OU_NUMERO = conjunto("total numero num n no nro");
/** Bilhetes premiados são só uma parte dos comprados: a coluna fica sem campo. */
const DO_PREMIO = conjunto(
  "premiado premiados premiada premiadas premio premios lucky sorteado sorteados",
);
const DE_VALOR = conjunto(
  "valor total preco price amount value montante quantia arrecadado receita r brl",
);
const DO_VALOR_PAGO = conjunto("total pago paga final");
/** Não é o valor pago (antes do desconto, unitário, líquido de taxas): só se não houver outro. */
const DE_VALOR_FRACO = conjunto(
  "subtotal preco price unitario bruto original liquido",
);
const DE_VALOR_IGNORADO = conjunto(
  "desconto descontos discount taxa taxas tarifa fee frete cupom coupon comissao juros",
);
const DO_PEDIDO = conjunto("pedido pedidos order compra venda");
const DA_TRANSACAO = conjunto("transacao transaction txid gateway");
const SO_IDENTIFICADOR = conjunto(
  "id codigo cod code identificador referencia ref",
);

interface Classificacao {
  campo: CampoReconciliacao | null;
  /** Preferência entre colunas do mesmo campo (a maior vence; 0 = a coluna fica sem campo). */
  pontos: number;
  pessoal: boolean;
}

const SEM_CAMPO: Classificacao = { campo: null, pontos: 0, pessoal: false };

function palavrasDoNome(nome: string): Set<string> {
  return new Set(
    normalizarNomeDeColuna(nome)
      .split(/[^a-z0-9]+/)
      .filter((palavra) => palavra !== ""),
  );
}

/**
 * O campo que o nome da coluna indica. A ordem das regras importa: "Data do pedido" é data, e não código;
 * "Nome do afiliado" é afiliado, e não dado pessoal; "Total de bilhetes" é quantidade, e não valor.
 */
function classificarNome(palavras: ReadonlySet<string>): Classificacao {
  const tem = (alvo: ReadonlySet<string>) =>
    [...palavras].some((palavra) => alvo.has(palavra));
  const so = (alvo: ReadonlySet<string>) =>
    palavras.size > 0 && [...palavras].every((palavra) => alvo.has(palavra));

  if (tem(DO_AFILIADO)) {
    const contato = [...palavras].some(
      (palavra) =>
        DE_DADO_PESSOAL.has(palavra) &&
        palavra !== "nome" &&
        palavra !== "name",
    );
    return {
      campo: "afiliado",
      pontos: contato ? 1 : tem(DE_IDENTIFICADOR) ? 3 : 2,
      pessoal: false,
    };
  }
  if (
    palavras.has("status") ||
    palavras.has("situacao") ||
    (palavras.has("estado") && tem(DE_CONTEXTO_DO_STATUS))
  ) {
    return {
      campo: "status",
      pontos: tem(DE_CONTEXTO_DO_STATUS) ? 3 : 2,
      pessoal: false,
    };
  }
  if (tem(DE_DADO_PESSOAL)) return { campo: null, pontos: 0, pessoal: true };
  if (
    tem(DE_DATA) ||
    (palavras.has("em") && tem(ANTES_DE_EM)) ||
    (palavras.has("at") && tem(ANTES_DE_AT))
  ) {
    if (tem(DE_DATA_IGNORADA)) return SEM_CAMPO;
    return { campo: "data", pontos: tem(DO_PAGAMENTO) ? 3 : 2, pessoal: false };
  }
  if (tem(DE_QUANTIDADE) || (tem(TOTAL_OU_NUMERO) && tem(DE_BILHETE))) {
    if (tem(DO_PREMIO)) return SEM_CAMPO;
    return {
      campo: "qtd_bilhetes",
      pontos: tem(DE_BILHETE) ? 3 : 2,
      pessoal: false,
    };
  }
  if (tem(DE_BILHETE)) {
    return tem(DO_PREMIO)
      ? SEM_CAMPO
      : { campo: "bilhetes", pontos: 2, pessoal: false };
  }
  if (tem(DE_VALOR) || tem(DE_VALOR_FRACO)) {
    if (tem(DE_VALOR_IGNORADO)) return SEM_CAMPO;
    return {
      campo: "valor",
      pontos: tem(DE_VALOR_FRACO) ? 1 : tem(DO_VALOR_PAGO) ? 3 : 2,
      pessoal: false,
    };
  }
  if (tem(DO_PEDIDO)) return { campo: "pedido_id", pontos: 3, pessoal: false };
  if (tem(DA_TRANSACAO) && tem(DE_IDENTIFICADOR))
    return { campo: "pedido_id", pontos: 1, pessoal: false };
  if (so(SO_IDENTIFICADOR))
    return { campo: "pedido_id", pontos: 2, pessoal: false };
  return SEM_CAMPO;
}

/** Mapeamento vazio: nenhum campo tem coluna. */
export function mapeamentoVazio(): MapeamentoReconciliacao {
  return {
    pedido_id: null,
    status: null,
    qtd_bilhetes: null,
    bilhetes: null,
    valor: null,
    afiliado: null,
    data: null,
  };
}

export interface DeteccaoColunas {
  colunas: ColunaArquivoReconciliacao[];
  /** Para cada campo, a coluna de maior preferência (no empate, a primeira). */
  mapeamento: MapeamentoReconciliacao;
}

/**
 * As colunas do cabeçalho (até LIMITE_COLUNAS_CSV_RECONCILIACAO): nome resumido, o campo que o nome
 * indica e se é dado pessoal; e o mapeamento detectado.
 */
export function detectarColunas(cabecalho: readonly string[]): DeteccaoColunas {
  const lidas = cabecalho.slice(0, LIMITE_COLUNAS_CSV_RECONCILIACAO);
  const palavras = lidas.map(palavrasDoNome);
  const temEndereco = palavras.some((doNome) =>
    [...doNome].some((palavra) => DO_ENDERECO.has(palavra)),
  );
  const classificacoes = palavras.map((doNome) => {
    const classificacao = classificarNome(doNome);
    // "Número" sozinho, num arquivo com endereço, é o número da casa do comprador.
    if (
      temEndereco &&
      doNome.size > 0 &&
      [...doNome].every((palavra) => SO_NUMERO.has(palavra))
    )
      return { campo: null, pontos: 0, pessoal: true };
    return classificacao;
  });

  const colunas = lidas.map((nome, indice): ColunaArquivoReconciliacao => ({
    indice,
    nome: resumirNomeDeColuna(nome) || `Coluna ${indice + 1}`,
    campo_detectado:
      classificacoes[indice].pontos > 0 ? classificacoes[indice].campo : null,
    dado_pessoal: classificacoes[indice].pessoal,
  }));

  const mapeamento = mapeamentoVazio();
  for (const campo of CAMPOS_RECONCILIACAO) {
    let melhor: number | null = null;
    for (const [indice, classificacao] of classificacoes.entries()) {
      if (classificacao.campo !== campo || classificacao.pontos === 0) continue;
      if (
        melhor === null ||
        classificacao.pontos > classificacoes[melhor].pontos
      )
        melhor = indice;
    }
    mapeamento[campo] = melhor;
  }
  return { colunas, mapeamento };
}

/** Problemas de um mapeamento enviado (400 requisicao_invalida), com o campo em `caminho`. */
export function conferirMapeamento(
  mapeamento: MapeamentoReconciliacao,
  colunas: readonly ColunaArquivoReconciliacao[],
): DetalheValidacao[] {
  const problemas: DetalheValidacao[] = [];
  const usadas = new Map<number, CampoReconciliacao>();
  for (const campo of CAMPOS_RECONCILIACAO) {
    const indice = mapeamento[campo];
    if (indice === null) continue;
    const caminho = ["mapeamento", campo];
    const coluna = colunas[indice];
    if (coluna === undefined) {
      problemas.push({
        caminho,
        codigo: "coluna_inexistente",
        mensagem: `O arquivo não tem a coluna ${indice + 1}`,
      });
      continue;
    }
    if (coluna.dado_pessoal) {
      problemas.push({
        caminho,
        codigo: "coluna_pessoal",
        mensagem: `A coluna "${coluna.nome}" tem dados pessoais e não pode ser usada`,
      });
      continue;
    }
    const outro = usadas.get(indice);
    if (outro !== undefined) {
      problemas.push({
        caminho,
        codigo: "coluna_repetida",
        mensagem: `A coluna "${coluna.nome}" já foi escolhida para outro campo (${outro})`,
      });
      continue;
    }
    usadas.set(indice, campo);
  }
  return problemas;
}

/** Um nome de cabeçalho que é, na verdade, um dado (a primeira linha não é o cabeçalho). */
const PARECE_DADO = [
  /@/,
  /^\+?[\d\s().-]{8,}$/,
  /^-?\d+(?:[.,]\d+)*$/,
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/,
  /^\d{4}-\d{2}-\d{2}/,
  /^r\$\s*\d/i,
];

function pareceDado(nome: string): boolean {
  const limpo = nome.trim();
  return limpo !== "" && PARECE_DADO.some((padrao) => padrao.test(limpo));
}

// ---------------------------------------------------------------------------------------------------
// Valores das células (todas as funções recebem o texto da célula e nunca o devolvem)
// ---------------------------------------------------------------------------------------------------

/** Célula vazia (ou só um traço). */
export const VAZIO = "vazio";
/** Célula com conteúdo que não dá para ler. */
export const INVALIDO = "invalido";
export type Lido<T> = T | typeof VAZIO | typeof INVALIDO;

const MARCAS_DE_VAZIO = new Set(["", "-", "—", "–"]);

/** Começa como uma fórmula de planilha (=, +, @, ou - seguido de algo que não é número). */
export function pareceFormula(texto: string): boolean {
  const limpo = texto.trim();
  return /^[=+@]/.test(limpo) || /^-[^\d\s]/.test(limpo);
}

const ESPACOS = /[\s\u00A0\u202F]+/g;
const MAXIMO_CENTAVOS = 1_000_000_000;

/** Formatos aceitos de valor, depois de tirar "R$" e os espaços. A ordem resolve "1.234" e "1,234". */
const FORMATOS_DE_VALOR: {
  padrao: RegExp;
  milhar: string | null;
  decimal: string;
}[] = [
  // 1.234,56 · 1.234 (milhar com ponto, decimal com vírgula)
  { padrao: /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/, milhar: ".", decimal: "," },
  // 1234,56 · 20,5 · 20
  { padrao: /^\d+(?:,\d{1,2})?$/, milhar: null, decimal: "," },
  // 1,234.56 · 1,234 (milhar com vírgula, decimal com ponto)
  { padrao: /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/, milhar: ",", decimal: "." },
  // 1234.56 · 20.5
  { padrao: /^\d+(?:\.\d{1,2})?$/, milhar: null, decimal: "." },
];

/**
 * Valor em reais para centavos inteiros, por texto (sem float, D2): "R$ 1.234,56" → 123456;
 * "20,00", "20.00" e "20" → 2000. Negativo, com mais de 2 casas ou acima de R$ 10.000.000,00: inválido.
 */
export function lerCentavos(texto: string): Lido<number> {
  const limpo = texto.trim();
  if (MARCAS_DE_VAZIO.has(limpo)) return VAZIO;
  if (limpo.length > 40) return INVALIDO;
  const numero = limpo.replace(/R\$|BRL/gi, "").replace(ESPACOS, "");
  for (const { padrao, milhar, decimal } of FORMATOS_DE_VALOR) {
    if (!padrao.test(numero)) continue;
    const semMilhar = milhar === null ? numero : numero.split(milhar).join("");
    const [inteiro, fracao = ""] = semMilhar.split(decimal);
    if (inteiro.length > 13) return INVALIDO;
    const centavos = Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));
    return centavos <= MAXIMO_CENTAVOS ? centavos : INVALIDO;
  }
  return INVALIDO;
}

const MAXIMO_BILHETES = 1_000_000;

/** Quantidade de bilhetes: inteiro de 0 a 1.000.000 ("12", "1.000", "12,0"). */
export function lerQuantidade(texto: string): Lido<number> {
  const limpo = texto.trim().replace(ESPACOS, "");
  if (MARCAS_DE_VAZIO.has(limpo)) return VAZIO;
  let digitos: string | null = null;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(limpo)) digitos = limpo.split(".").join("");
  else if (/^\d{1,9}(?:[.,]0+)?$/.test(limpo)) digitos = limpo.split(/[.,]/)[0];
  if (digitos === null) return INVALIDO;
  const quantidade = Number(digitos);
  return quantidade <= MAXIMO_BILHETES ? quantidade : INVALIDO;
}

/** Tamanho máximo da célula dos números dos bilhetes (um pedido grande cabe com folga). */
const MAXIMO_CARACTERES_BILHETES = 200_000;

/** Números dos bilhetes ("001, 002, 003", "[1, 2]", "1 2 3"): só dígitos e separadores. */
export function lerNumeros(texto: string): Lido<number[]> {
  const limpo = texto.trim();
  if (MARCAS_DE_VAZIO.has(limpo)) return VAZIO;
  if (
    limpo.length > MAXIMO_CARACTERES_BILHETES ||
    /[^\d\s,;|/.()[\]-]/.test(limpo)
  )
    return INVALIDO;
  const numeros = limpo.match(/\d+/g);
  if (numeros === null || numeros.some((numero) => numero.length > 12))
    return INVALIDO;
  return numeros.map(Number);
}

/** Palavras do status, sem acento e em minúsculas ("Não pago" → {nao, pago}). */
function palavrasDoTexto(texto: string): Set<string> {
  return new Set(
    texto
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((palavra) => palavra !== ""),
  );
}

const STATUS_CANCELADO = conjunto(
  "cancelado cancelada canceled cancelled estornado estornada estorno reembolsado reembolsada refunded recusado recusada rejeitado rejeitada rejected chargeback devolvido devolvida",
);
const STATUS_EXPIRADO = conjunto(
  "expirado expirada expired vencido vencida expirou",
);
const STATUS_PENDENTE = conjunto(
  "pendente pendentes pending aguardando processando processamento process processing reservado reservada aberto aberta andamento analise nao not unpaid",
);
const STATUS_APROVADO = conjunto(
  "aprovado aprovada approved pago paga paid confirmado confirmada concluido concluida completed accredited quitado quitada",
);

/**
 * Status do arquivo, normalizado. Primeiro o que nega a venda (cancelado, expirado, pendente, "não"):
 * "Não pago" e "Pagamento pendente" não são pagos; "Pago" e "approved" são.
 */
export function lerStatus(
  texto: string,
): StatusArquivoReconciliacao | typeof VAZIO {
  const limpo = texto.trim();
  if (MARCAS_DE_VAZIO.has(limpo)) return VAZIO;
  if (limpo.length > 60) return "desconhecido";
  const palavras = palavrasDoTexto(limpo);
  const tem = (alvo: ReadonlySet<string>) =>
    [...palavras].some((palavra) => alvo.has(palavra));
  if (tem(STATUS_CANCELADO)) return "cancelado";
  if (tem(STATUS_EXPIRADO)) return "expirado";
  if (tem(STATUS_PENDENTE)) return "pendente";
  if (tem(STATUS_APROVADO)) return "aprovado";
  return "desconhecido";
}

/** Data lida: o dia no fuso da campanha e, quando o arquivo tem a hora, o instante (ms, UTC). */
export interface DataLida {
  dia: string;
  instante: number | null;
}

const DATA_COM_FUSO =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?\s*(Z|[+-]\d{2}:?\d{2})$/i;
const DATA_ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?$/;
const DATA_BR =
  /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:(?:\s+|\s*,\s*|\s+[àa]s\s+)(\d{1,2})[:h](\d{2})(?::(\d{2}))?)?$/i;

const dois = (numero: number) => String(numero).padStart(2, "0");

function diaValido(ano: number, mes: number, dia: number): string | null {
  if (ano < 2000 || ano > 2099) return null;
  const texto = `${ano}-${dois(mes)}-${dois(dia)}`;
  return diaDoCalendario(texto) === null ? null : texto;
}

function horaValida(
  hora: string | undefined,
  minuto: string | undefined,
  segundo: string | undefined,
): number | null {
  if (hora === undefined || minuto === undefined) return null;
  const [h, m, s] = [Number(hora), Number(minuto), Number(segundo ?? 0)];
  if (h > 23 || m > 59 || s > 59) return Number.NaN;
  return ((h * 60 + m) * 60 + s) * 1000;
}

/** Hora local do arquivo (sem fuso) para instante: início do dia no fuso + a hora. */
function instanteLocal(dia: string, ms: number, fuso: string): number {
  return Date.parse(intervaloUtcDoDia(dia, fuso).inicio) + ms;
}

/**
 * Data do pagamento (ou do pedido): "23/11/2026", "23/11/2026 14:35", "23/11/26 às 14h35",
 * "2026-11-23", "2026-11-23 14:35:10" (hora local do fuso da campanha) ou ISO com fuso
 * ("2026-11-23T14:35:10-03:00"). Dia e mês na ordem brasileira.
 */
export function lerDataNoFuso(texto: string, fuso: string): Lido<DataLida> {
  const limpo = texto.trim();
  if (MARCAS_DE_VAZIO.has(limpo)) return VAZIO;
  if (limpo.length > 40) return INVALIDO;

  const comFuso = DATA_COM_FUSO.exec(limpo);
  if (comFuso) {
    const [, ano, mes, dia, hora, minuto, segundo, fracao, fusoDoTexto] =
      comFuso;
    if (diaValido(Number(ano), Number(mes), Number(dia)) === null)
      return INVALIDO;
    if (Number.isNaN(horaValida(hora, minuto, segundo) ?? 0)) return INVALIDO;
    const offset =
      fusoDoTexto.toUpperCase() === "Z"
        ? "Z"
        : `${fusoDoTexto.slice(0, 3)}:${fusoDoTexto.slice(-2)}`;
    const instante = Date.parse(
      `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo ?? "00"}${(fracao ?? "").slice(0, 4)}${offset}`,
    );
    if (Number.isNaN(instante)) return INVALIDO;
    return { dia: hojeNoFuso(fuso, new Date(instante)), instante };
  }

  const iso = DATA_ISO.exec(limpo);
  const br = iso ? null : DATA_BR.exec(limpo);
  if (!iso && !br) return INVALIDO;
  const [ano, mes, dia, hora, minuto, segundo] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3]), iso[4], iso[5], iso[6]]
    : [
        br![3].length === 2 ? 2000 + Number(br![3]) : Number(br![3]),
        Number(br![2]),
        Number(br![1]),
        br![4],
        br![5],
        br![6],
      ];
  const diaTexto = diaValido(ano, mes, dia);
  const ms = horaValida(hora, minuto, segundo);
  if (diaTexto === null || Number.isNaN(ms)) return INVALIDO;
  return {
    dia: diaTexto,
    instante: ms === null ? null : instanteLocal(diaTexto, ms, fuso),
  };
}

/** Afiliado da célula: número (o affiliate_id), texto (o usuário, comparado com os rótulos) ou vazio. */
export type AfiliadoLido =
  | { tipo: "vazio" }
  | { tipo: "numero"; id: number }
  /** `chave` só serve para achar o rótulo: nunca sai na resposta. */
  | { tipo: "texto"; chave: string }
  | { tipo: "invalido" };

const SEM_AFILIADO = new Set([
  "nenhum",
  "nenhuma",
  "sem afiliado",
  "sem",
  "n/a",
  "na",
  "nao",
  "null",
  "none",
  "0",
]);

/** Texto do afiliado (ou do rótulo cadastrado) para comparação: sem acento, minúsculo, sem @ no início. */
export function chaveDoAfiliado(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^@\s*/, "");
}

export function lerAfiliado(texto: string): AfiliadoLido {
  const limpo = texto.trim();
  if (MARCAS_DE_VAZIO.has(limpo)) return { tipo: "vazio" };
  // "@usuario" é o jeito comum de escrever o usuário: no afiliado, só = e + (e - seguido de letra) são
  // fórmula. O texto nunca sai na resposta; serve só para achar o rótulo cadastrado.
  if (limpo.length > 120 || (pareceFormula(limpo) && !limpo.startsWith("@")))
    return { tipo: "invalido" };
  const numero = /^#?\s*(\d{1,15})$/.exec(limpo);
  if (numero) {
    const id = Number(numero[1]);
    if (id === 0) return { tipo: "vazio" };
    return Number.isSafeInteger(id)
      ? { tipo: "numero", id }
      : { tipo: "invalido" };
  }
  const chave = chaveDoAfiliado(limpo);
  if (SEM_AFILIADO.has(chave)) return { tipo: "vazio" };
  return chave === "" ? { tipo: "invalido" } : { tipo: "texto", chave };
}

/** Código do pedido (FORMATO_ID_PEDIDO_RECONCILIACAO). */
export function lerIdPedido(texto: string): Lido<string> {
  const limpo = texto.trim();
  if (limpo === "") return VAZIO;
  return FORMATO_ID_PEDIDO_RECONCILIACAO.test(limpo) ? limpo : INVALIDO;
}

// ---------------------------------------------------------------------------------------------------
// O arquivo inteiro
// ---------------------------------------------------------------------------------------------------

/** Uma linha de dados com as colunas mapeadas já lidas. null = o campo não está no mapeamento. */
export interface LinhaLida {
  /** Linha da planilha (o cabeçalho é a primeira com conteúdo). */
  linha: number;
  id: Lido<string> | null;
  status: StatusArquivoReconciliacao | typeof VAZIO | null;
  qtd: Lido<number> | null;
  numeros: Lido<number[]> | null;
  centavos: Lido<number> | null;
  afiliado: AfiliadoLido | null;
  data: Lido<DataLida> | null;
}

/** Contagens dos problemas de formato (só números: nenhum valor do arquivo). */
export interface ProblemasDeFormato {
  semId: number;
  idInvalido: number;
  quantidadeInvalida: number;
  numerosInvalidos: number;
  valorInvalido: number;
  dataInvalida: number;
  formulas: number;
}

export type LeituraArquivo =
  | {
      ok: true;
      colunas: ColunaArquivoReconciliacao[];
      mapeamento: MapeamentoReconciliacao;
      /** O mapeamento veio da detecção (o pedido não trouxe um). */
      detectado: boolean;
      /** Colunas do cabeçalho além do limite (ignoradas). */
      colunasDemais: number;
      linhas: LinhaLida[];
      problemas: ProblemasDeFormato;
    }
  | { ok: false; tipo: "arquivo"; falha: FalhaCsv }
  | { ok: false; tipo: "mapeamento"; problemas: DetalheValidacao[] };

function falhaDoArquivo(falha: FalhaCsv): LeituraArquivo {
  return { ok: false, tipo: "arquivo", falha };
}

/** Lê a célula (null = o campo não está no mapeamento) e avisa quando ela é ilegível. */
function lerCelula<T>(
  texto: string | null,
  leitor: (texto: string) => T,
  invalido: (valor: T) => boolean,
  aoInvalido: (texto: string) => void,
): T | null {
  if (texto === null) return null;
  const valor = leitor(texto);
  if (invalido(valor)) aoInvalido(texto);
  return valor;
}

/** Linha (da planilha) do primeiro caractere inválido de UTF-8, olhando os campos já lidos. */
function linhaComCaractereInvalido(
  registros: readonly RegistroCsv[],
): number | null {
  const registro = registros.find((item) =>
    item.campos.some((valor) => valor.includes(CARACTERE_INVALIDO)),
  );
  return registro?.linha ?? null;
}

/**
 * Lê o arquivo: falha (400 csv_invalido) quando ele não tem cabeçalho (ou a primeira linha é de dados),
 * tem aspas abertas, não está em UTF-8 ou passa do limite de linhas; falha (400 requisicao_invalida)
 * quando o mapeamento enviado não serve para o cabeçalho. Sem mapeamento, usa o detectado.
 */
export function lerArquivoReconciliacao(
  texto: string,
  opcoes: { mapeamento?: MapeamentoReconciliacao; fuso: string },
): LeituraArquivo {
  if (texto.length > LIMITE_CARACTERES_CSV_RECONCILIACAO)
    return falhaDoArquivo(arquivoGrandeParaConferencia());
  const leitura = lerCsv(texto);
  if (!leitura.ok)
    return falhaDoArquivo({
      ok: false,
      mensagem: `${leitura.mensagem}. Exporte o arquivo de novo pela Rifei.`,
      detalhes: { motivo: "aspas_abertas", linha: leitura.linha },
    });
  const [cabecalho, ...dados] = leitura.registros;
  if (!cabecalho) return falhaDoArquivo(arquivoVazio());
  if (texto.includes(CARACTERE_INVALIDO)) {
    const linha = linhaComCaractereInvalido(leitura.registros) ?? 1;
    return falhaDoArquivo({
      ok: false,
      mensagem: `O arquivo não está em UTF-8 (caractere inválido na linha ${linha}). Use o arquivo como a Rifei baixou, sem abrir e salvar no Excel; se precisar salvar, use “CSV UTF-8”.`,
      detalhes: { motivo: "codificacao_invalida", linha },
    });
  }
  if (
    cabecalho.campos.slice(0, LIMITE_COLUNAS_CSV_RECONCILIACAO).some(pareceDado)
  )
    return falhaDoArquivo(cabecalhoComDados());
  if (dados.length > LIMITE_LINHAS_CSV_RECONCILIACAO)
    return falhaDoArquivo(linhasDemais(dados.length));

  const deteccao = detectarColunas(cabecalho.campos);
  const mapeamento = opcoes.mapeamento ?? deteccao.mapeamento;
  if (opcoes.mapeamento) {
    const problemas = conferirMapeamento(opcoes.mapeamento, deteccao.colunas);
    if (problemas.length > 0)
      return { ok: false, tipo: "mapeamento", problemas };
  }

  const problemas: ProblemasDeFormato = {
    semId: 0,
    idInvalido: 0,
    quantidadeInvalida: 0,
    numerosInvalidos: 0,
    valorInvalido: 0,
    dataInvalida: 0,
    formulas: 0,
  };
  /** Conta a célula ilegível (e se ela parece fórmula) sem guardar o texto. */
  const contar =
    (contador: keyof ProblemasDeFormato | null) => (texto: string) => {
      if (contador !== null) problemas[contador]++;
      if (pareceFormula(texto)) problemas.formulas++;
    };
  const ehInvalido = (valor: unknown) => valor === INVALIDO;
  const lerData = (texto: string) => lerDataNoFuso(texto, opcoes.fuso);

  const linhas = dados.map((registro): LinhaLida => {
    const celula = (campo: CampoReconciliacao): string | null => {
      const indice = mapeamento[campo];
      return indice === null ? null : (registro.campos[indice] ?? "");
    };
    const id = lerCelula(
      celula("pedido_id"),
      lerIdPedido,
      ehInvalido,
      contar("idInvalido"),
    );
    if (id === VAZIO) problemas.semId++;
    return {
      linha: registro.linha,
      id,
      // status_desconhecido e afiliado_nao_reconhecido são contados por pedido, na análise.
      status: lerCelula(
        celula("status"),
        lerStatus,
        (valor) => valor === "desconhecido",
        contar(null),
      ),
      qtd: lerCelula(
        celula("qtd_bilhetes"),
        lerQuantidade,
        ehInvalido,
        contar("quantidadeInvalida"),
      ),
      numeros: lerCelula(
        celula("bilhetes"),
        lerNumeros,
        ehInvalido,
        contar("numerosInvalidos"),
      ),
      centavos: lerCelula(
        celula("valor"),
        lerCentavos,
        ehInvalido,
        contar("valorInvalido"),
      ),
      afiliado: lerCelula(
        celula("afiliado"),
        lerAfiliado,
        (valor) => valor.tipo === "invalido",
        contar(null),
      ),
      data: lerCelula(
        celula("data"),
        lerData,
        ehInvalido,
        contar("dataInvalida"),
      ),
    };
  });

  return {
    ok: true,
    colunas: deteccao.colunas,
    mapeamento,
    detectado: opcoes.mapeamento === undefined,
    colunasDemais: Math.max(
      0,
      cabecalho.campos.length - LIMITE_COLUNAS_CSV_RECONCILIACAO,
    ),
    linhas,
    problemas,
  };
}
