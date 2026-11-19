// O comprovante de Pix em PDF (RIFA-074, D34), lido NO NAVEGADOR: um Pix por arquivo, o comprovante que o banco gera
// (o do Bradesco, no app e no Net Empresa, e, de forma genérica, o de outros bancos: o comprador pode mandar o dele).
// O texto chega de pdf.ts (as linhas montadas pela posição) e vira UM lançamento de crédito, que entra no mesmo
// cruzamento do extrato, com a origem "comprovante".
//
// O layout (fontes públicas; nenhum banco publica o modelo, e os nomes dos campos variam):
// - Bradesco: "Comprovante de Transação Pix" (ou "Comprovante Pix"), "Dados de quem recebeu" e "Dados de quem pagou"
//   (Nome, CPF/CNPJ mascarado, Instituição), "Dados da transação" (Valor, "Data e hora: 20/12/2024 - 15:16:05",
//   "Debitado da"), "Identificador" e "Número de controle" (ou "ID da transação"), às vezes "Descrição";
// - outros bancos: "Comprovante de transferência", "Origem" e "Destino" (Nubank), "Pagador" e "Recebedor", "De" e
//   "Para", "ID da transação" ou "EndToEndID" (o E2E do Banco Central: 32 caracteres que começam com E), "Mensagem".
// O rótulo e o valor podem vir na mesma linha ("Valor: R$ 20,00", ou as duas colunas lado a lado) ou o valor na linha
// de baixo. O leitor é tolerante e não depende da ordem.
//
// O que sai do comprovante:
// - valor, data e hora, o nome de quem pagou (só na tela, como o "REM: <nome>" do extrato; D26);
// - o identificador (txid): no Pix manual da Rifei é o número do pedido; igual ao número de um pedido, o cruzamento
//   é exato ("Certo");
// - o ID da transação (E2E): acha o mesmo Pix em dois arquivos (juntar.ts);
// - a descrição ou mensagem: o comprador pode ter escrito o número do pedido.
// Pix agendado (ainda não pago) é uma falha clara. Módulo puro (sem o pdf.js), testado em comprovante.test.ts.
import {
  criarRelogio,
  normalizar,
  type ContextoDeLeitura,
  type ExtratoLido,
  type FalhaDoExtrato,
  type Lancamento,
} from "./lancamentos";
import { FALHAS_DO_COMPROVANTE } from "./textos";
import {
  acharData,
  acharHora,
  lerValorComSinal,
  limparSinais,
} from "./valores";

/** O E2E do Banco Central: "E" + o ISPB (8) + a data e hora (12) + 11 letras ou algarismos. */
const E2E = /(?<![A-Z0-9])E\d{20}[A-Z0-9]{11}(?![A-Z0-9])/i;
/** Um valor em reais: "R$ 1.234,56", "1.234,56", "20,00". */
const VALOR =
  /(?:R\$\s*)?[-+]?\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)|(?:R\$\s*)?\d+,\d{2}(?!\d)/i;

// Os rótulos, no texto normalizado (maiúsculas, sem acento), no começo da linha.
const ROTULO_VALOR =
  /^(?:VALOR(?: DO PIX| DA TRANSFERENCIA| DA TRANSACAO| PAGO| TRANSFERIDO| ENVIADO| RECEBIDO| TOTAL)?|QUANTIA)\b/;
const ROTULO_DATA =
  /^(?:DATA E HORA(?: DA TRANSACAO| DO PAGAMENTO)?|DATA\/HORA|DATA DA TRANSACAO|DATA DA TRANSFERENCIA|DATA DO PAGAMENTO|DATA DO PIX|DATA|REALIZAD[OA] EM|EFETUAD[OA] EM|FEITO EM|FEITA EM)\b/;
const ROTULO_HORA = /^(?:HORA|HORARIO)\b/;
const ROTULO_PAGADOR =
  /^(?:DADOS DE QUEM PAGOU|DADOS DO PAGADOR|QUEM PAGOU|NOME DO PAGADOR|PAGADOR|ORIGEM|CONTA DE ORIGEM|DADOS DA ORIGEM)\b|^DE(?=\s*:|$)/;
const ROTULO_RECEBEDOR =
  /^(?:DADOS DE QUEM RECEBEU|DADOS DO RECEBEDOR|QUEM RECEBEU|NOME DO RECEBEDOR|RECEBEDOR|DESTINO|CONTA DE DESTINO|DADOS DO DESTINO|PARA|FAVORECIDO|BENEFICIARIO)\b|^PARA(?=\s*:|$)/;
/** Um bloco que não é de nenhuma das partes (encerra o bloco de quem pagou). */
const ROTULO_OUTRO_BLOCO =
  /^(?:DADOS DA TRANSACAO|DADOS DA TRANSFERENCIA|DADOS DO PIX|TRANSACAO|AUTENTICACAO)\b/;
const ROTULO_NOME = /^(?:NOME(?: COMPLETO)?|RAZAO SOCIAL)\b/;
/** Os campos de uma parte que não são o nome. */
const ROTULO_DA_PARTE =
  /^(?:CPF|CNPJ|CPF\/CNPJ|INSTITUICAO|BANCO|AGENCIA|CONTA|TIPO DE CONTA|CHAVE|CHAVE PIX|ISPB|DOCUMENTO)\b/;
const ROTULO_ID =
  /^(?:ID DA TRANSACAO|ID DA TRANSFERENCIA|ID\/TRANSACAO|ID TRANSACAO|ID DO PIX|ID PIX|END ?TO ?END(?: ?ID)?|E2E(?: ?ID)?|IDENTIFICADOR DA TRANSACAO|NUMERO DE CONTROLE|N[O.º°]? ?DE CONTROLE|CODIGO DA TRANSACAO|CODIGO DE AUTENTICACAO|AUTENTICACAO)\b/;
const ROTULO_TXID =
  /^(?:IDENTIFICADOR|IDENTIFICACAO|TXID|TX ?ID|ID DO QR ?CODE|CODIGO DE IDENTIFICACAO)\b/;
const ROTULO_MENSAGEM =
  /^(?:DESCRICAO|MENSAGEM|INFORMACAO AO RECEBEDOR|INFORMACOES ADICIONAIS|INFORMACOES AO RECEBEDOR|OBSERVACAO|OBSERVACOES)\b/;
/** Pix agendado, ainda não pago (sem "concluído" ou "efetivado" no comprovante). */
const AGENDADO = /\bAGENDAD[OA]\b|\bAGENDAMENTO\b/;
const CONCLUIDO =
  /\bCONCLUID[OA]\b|\bEFETIVAD[OA]\b|\bREALIZAD[OA]\b|\bEFETUAD[OA]\b/;
/** No máximo estes valores no comprovante (o valor, a tarifa, o total); mais que isso é um extrato. */
const MAXIMO_VALORES = 6;

/** O comprovante lido: o Pix e o que acha o pedido e o mesmo Pix noutro arquivo. */
export interface ComprovanteLido {
  centavos: number;
  dia: string;
  instante: number | null;
  pagador: string | null;
  /** O ID da transação (o E2E, ou o número do banco quando não há E2E). */
  idDaTransacao: string | null;
  /** O identificador (txid), sem espaços. */
  txid: string | null;
  /** Descrição ou mensagem de quem pagou. */
  mensagens: string[];
}

interface Linha {
  original: string;
  normal: string;
}

/** O texto depois do rótulo (sem ":" e "-"); vazio quando o valor está na linha de baixo. */
function depoisDoRotulo(linha: Linha, rotulo: RegExp): string {
  const achado = rotulo.exec(linha.normal);
  if (!achado) return "";
  // O normal tem o mesmo tamanho do original (NFC; o acento sai, a letra fica): corta na mesma posição.
  const resto =
    linha.original.length === linha.normal.length
      ? linha.original.slice(achado[0].length)
      : linha.normal.slice(achado[0].length);
  return resto.replace(/^[\s:–—-]+/, "").trim();
}

/** O valor do rótulo: na mesma linha ou na de baixo (se a de baixo não é outro rótulo conhecido). */
function valorDoRotulo(
  linhas: readonly Linha[],
  indice: number,
  rotulo: RegExp,
): string {
  const mesma = depoisDoRotulo(linhas[indice], rotulo);
  if (mesma !== "") return mesma;
  const proxima = linhas[indice + 1];
  return proxima && !ehRotulo(proxima) ? proxima.original : "";
}

const TODOS_OS_ROTULOS = [
  ROTULO_VALOR,
  ROTULO_DATA,
  ROTULO_HORA,
  ROTULO_PAGADOR,
  ROTULO_RECEBEDOR,
  ROTULO_OUTRO_BLOCO,
  ROTULO_NOME,
  ROTULO_DA_PARTE,
  ROTULO_ID,
  ROTULO_TXID,
  ROTULO_MENSAGEM,
];

/** A linha é só um rótulo (sem valor ao lado). */
function ehRotulo(linha: Linha): boolean {
  return TODOS_OS_ROTULOS.some(
    (rotulo) =>
      rotulo.test(linha.normal) && depoisDoRotulo(linha, rotulo) === "",
  );
}

/** O primeiro índice cuja linha casa com o rótulo. */
const acharRotulo = (linhas: readonly Linha[], rotulo: RegExp, desde = 0) =>
  linhas.findIndex(
    (linha, indice) => indice >= desde && rotulo.test(linha.normal),
  );

function lerValor(texto: string): number | null {
  const achado = VALOR.exec(limparSinais(texto));
  if (!achado) return null;
  const centavos = lerValorComSinal(achado[0]);
  return centavos === null ? null : Math.abs(centavos);
}

/** O nome de quem pagou: no bloco de quem pagou, o campo Nome ou a primeira linha que não é outro campo. */
function lerPagador(linhas: readonly Linha[]): string | null {
  const inicio = acharRotulo(linhas, ROTULO_PAGADOR);
  if (inicio < 0) return null;
  // "Pagador: Fulano" ou "Nome do pagador: Fulano" (o nome na própria linha).
  const naLinha = depoisDoRotulo(linhas[inicio], ROTULO_PAGADOR);
  if (naLinha !== "" && !ROTULO_NOME.test(normalizar(naLinha)))
    return nomeLimpo(naLinha);
  for (
    let indice = inicio + 1;
    indice < Math.min(linhas.length, inicio + 8);
    indice++
  ) {
    const linha = linhas[indice];
    if (
      ROTULO_RECEBEDOR.test(linha.normal) ||
      ROTULO_OUTRO_BLOCO.test(linha.normal) ||
      ROTULO_VALOR.test(linha.normal) ||
      ROTULO_DATA.test(linha.normal) ||
      ROTULO_ID.test(linha.normal) ||
      ROTULO_TXID.test(linha.normal)
    )
      return null;
    if (ROTULO_NOME.test(linha.normal))
      return nomeLimpo(valorDoRotulo(linhas, indice, ROTULO_NOME));
    if (ROTULO_DA_PARTE.test(linha.normal)) continue;
    if (/\p{L}{2}/u.test(linha.original) && !/\d{3}/.test(linha.original))
      return nomeLimpo(linha.original);
  }
  return null;
}

function nomeLimpo(texto: string): string | null {
  const nome = texto.replace(/\s+/g, " ").trim();
  return /\p{L}{2}/u.test(nome) ? nome : null;
}

/** A data e a hora do Pix: o campo de data (e o de hora), ou a primeira linha com data e hora. */
function lerQuando(
  linhas: readonly Linha[],
  contexto: ContextoDeLeitura,
): { dia: string; instante: number | null } | null {
  const relogio = criarRelogio(contexto);
  const candidatos: string[] = [];
  const indice = acharRotulo(linhas, ROTULO_DATA);
  if (indice >= 0) {
    const valor = valorDoRotulo(linhas, indice, ROTULO_DATA);
    const hora = acharRotulo(linhas, ROTULO_HORA);
    candidatos.push(
      hora >= 0
        ? `${valor} ${valorDoRotulo(linhas, hora, ROTULO_HORA)}`
        : valor,
    );
  }
  // Sem o rótulo (o cabeçalho "16 NOV 2026 - 10:05:33" de alguns apps): a primeira linha com data e hora; depois,
  // a primeira com data.
  const comHora = linhas.find(
    (linha) =>
      acharData(linha.original, relogio.hoje) && acharHora(linha.original),
  );
  if (comHora) candidatos.push(comHora.original);
  const comData = linhas.find((linha) =>
    acharData(linha.original, relogio.hoje),
  );
  if (comData) candidatos.push(comData.original);
  for (const texto of candidatos) {
    const data = acharData(texto, relogio.hoje);
    if (!data) continue;
    const semData = `${texto.slice(0, data.inicio)} ${" ".repeat(data.fim - data.inicio)} ${texto.slice(data.fim)}`;
    const hora = acharHora(semData);
    const lido = relogio.local(data.ano, data.mes, data.dia, hora ?? undefined);
    if (lido) return lido;
  }
  return null;
}

/** O ID da transação: o E2E em qualquer lugar (inteiro ou quebrado em duas linhas) ou o campo do ID. */
function lerIdDaTransacao(linhas: readonly Linha[]): string | null {
  for (let indice = 0; indice < linhas.length; indice++) {
    const texto = linhas[indice].original.replace(/\s+/g, "");
    const achado = E2E.exec(texto);
    if (achado) return achado[0].toUpperCase();
    const comABaixo =
      texto + (linhas[indice + 1]?.original.replace(/\s+/g, "") ?? "");
    const quebrado = E2E.exec(comABaixo);
    if (quebrado && quebrado.index < texto.length)
      return quebrado[0].toUpperCase();
  }
  const indice = acharRotulo(linhas, ROTULO_ID);
  if (indice < 0) return null;
  const valor = valorDoRotulo(linhas, indice, ROTULO_ID).replace(/\s+/g, "");
  return /^[A-Za-z0-9./-]{6,}$/.test(valor) ? valor.toUpperCase() : null;
}

/** O identificador (txid): o campo Identificador; o E2E num campo desses é o ID da transação, não o txid. */
function lerTxid(linhas: readonly Linha[]): string | null {
  for (let indice = 0; indice < linhas.length; indice++) {
    const linha = linhas[indice];
    if (!ROTULO_TXID.test(linha.normal) || ROTULO_ID.test(linha.normal))
      continue;
    const valor = valorDoRotulo(linhas, indice, ROTULO_TXID).replace(
      /\s+/g,
      "",
    );
    if (
      valor === "" ||
      E2E.test(valor) ||
      !/^[A-Za-z0-9._-]{1,35}$/.test(valor)
    )
      continue;
    return valor;
  }
  return null;
}

function lerMensagens(linhas: readonly Linha[]): string[] {
  const mensagens: string[] = [];
  linhas.forEach((linha, indice) => {
    if (!ROTULO_MENSAGEM.test(linha.normal)) return;
    const valor = valorDoRotulo(linhas, indice, ROTULO_MENSAGEM);
    if (valor !== "") mensagens.push(valor);
  });
  return mensagens;
}

function linhasDe(texto: string): Linha[] {
  return limparSinais(texto)
    .split(/\r\n|\r|\n/)
    .map((linha) => linha.normalize("NFC").replace(/\s+/g, " ").trim())
    .filter((linha) => linha !== "")
    .map((original) => ({ original, normal: normalizar(original) }));
}

/**
 * Se o texto do PDF é um comprovante de Pix: fala de Pix, se apresenta como comprovante (ou tem os blocos de quem pagou
 * e de quem recebeu), tem poucos valores, nenhuma tabela (o extrato tem o cabeçalho Data, Crédito, Débito...) e
 * nenhuma linha com a data e o valor juntos (a linha de lançamento do extrato).
 */
export function pareceComprovante(texto: string): boolean {
  if (texto.includes("\t")) return false;
  const linhas = linhasDe(texto);
  const normal = normalizar(texto);
  if (!/\bPIX\b/.test(normal)) return false;
  // Comprovante no título, ou os dois blocos (quem pagou e quem recebeu) cada um na sua linha.
  const blocos =
    linhas.some((linha) => ROTULO_PAGADOR.test(linha.normal)) &&
    linhas.some((linha) => ROTULO_RECEBEDOR.test(linha.normal));
  if (!/\bCOMPROVANTE\b/.test(normal) && !blocos) return false;
  // A linha com a data e o valor juntos é um lançamento de extrato.
  const hoje = new Date().toISOString().slice(0, 10);
  if (
    linhas.some(
      (linha) => VALOR.test(linha.original) && acharData(linha.original, hoje),
    )
  )
    return false;
  const valores = normal.match(new RegExp(VALOR.source, "gi")) ?? [];
  return valores.length >= 1 && valores.length <= MAXIMO_VALORES;
}

/** Lê o comprovante; a falha diz o que faltou. */
export function lerComprovante(
  texto: string,
  contexto: ContextoDeLeitura,
): ComprovanteLido | FalhaDoExtrato {
  const linhas = linhasDe(texto);
  const normal = normalizar(texto);
  if (AGENDADO.test(normal) && !CONCLUIDO.test(normal))
    return FALHAS_DO_COMPROVANTE.agendado;
  // O valor: o campo Valor; sem ele, a linha só com o valor (o destaque "R$ 20,00" no topo de alguns apps).
  let centavos: number | null = null;
  const indice = acharRotulo(linhas, ROTULO_VALOR);
  if (indice >= 0)
    centavos = lerValor(valorDoRotulo(linhas, indice, ROTULO_VALOR));
  if (centavos === null) {
    const sozinho = linhas.find((linha) =>
      /^(?:R\$\s*)?[\d.]+,\d{2}$/i.test(linha.original),
    );
    if (sozinho) centavos = lerValor(sozinho.original);
  }
  if (centavos === null || centavos === 0)
    return FALHAS_DO_COMPROVANTE.semValor;
  const quando = lerQuando(linhas, contexto);
  if (!quando) return FALHAS_DO_COMPROVANTE.semData;
  return {
    centavos,
    dia: quando.dia,
    instante: quando.instante,
    pagador: lerPagador(linhas),
    idDaTransacao: lerIdDaTransacao(linhas),
    txid: lerTxid(linhas),
    mensagens: lerMensagens(linhas),
  };
}

/** A descrição do Pix na tela: "Comprovante de Pix · <nome> · identificador <txid>". */
export function descricaoDoComprovante(comprovante: ComprovanteLido): string {
  return [
    "Comprovante de Pix",
    comprovante.pagador,
    comprovante.txid && `identificador ${comprovante.txid}`,
    ...comprovante.mensagens,
  ]
    .filter((parte) => parte)
    .join(" · ");
}

/** O comprovante como o extrato de um lançamento só, com a origem "comprovante". */
export function extratoDoComprovante(
  comprovante: ComprovanteLido,
): ExtratoLido {
  const lancamento: Lancamento = {
    ordem: 1,
    dia: comprovante.dia,
    instante: comprovante.instante,
    centavos: comprovante.centavos,
    descricao: descricaoDoComprovante(comprovante),
    identificadores: [
      ...(comprovante.txid ? [comprovante.txid] : []),
      ...(comprovante.idDaTransacao ? [comprovante.idDaTransacao] : []),
      ...comprovante.mensagens,
    ],
    origem: "comprovante",
    ...(comprovante.pagador ? { pagador: comprovante.pagador } : {}),
    ...(comprovante.idDaTransacao
      ? { idDaTransacao: comprovante.idDaTransacao }
      : {}),
    ...(comprovante.txid ? { txid: comprovante.txid } : {}),
  };
  return {
    ok: true,
    formato: "comprovante",
    lancamentos: [lancamento],
    ilegiveis: 0,
    semHora: comprovante.instante === null,
  };
}
