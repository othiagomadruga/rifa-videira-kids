// O relatório "Pix recebidos" do Bradesco em PDF (RIFA-077, adendo da D34), lido NO NAVEGADOR. É o PDF que o banco
// gera da lista de Pix recebidos (não o extrato da conta), com as colunas Data | Referência | Identificação |
// Horário | Entradas (R$) | Saídas (R$) | "Ver detalhes". Cada lançamento é um BLOCO vertical:
// - a data em duas linhas (o dia numa, "NOV" na de baixo), só no primeiro lançamento do dia;
// - a Referência (o nome de quem pagou e, embaixo, o banco dele) quebrada em várias linhas, acima e abaixo da linha
//   do meio;
// - na linha do meio, a Identificação (o E2E do Pix: "E" + ISPB + aaaammddhhmm + sufixo), o horário e o valor, na
//   coluna Entradas (crédito) ou Saídas (débito, fica de fora do cruzamento).
// O ano não aparece: vem do E2E (aaaamm do E2E) ou, sem ele, do ano corrente (como o "16/11" do texto colado).
//
// Duas partes, para o resto do leitor do PDF não mudar:
// 1. textoDosPixRecebidos (pura, com as posições do pdf.js): acha o cabeçalho, agrupa os pedaços em blocos pela linha
//    do meio (o horário, o valor e o E2E) e devolve um texto canônico, uma linha por lançamento (tabulações);
// 2. lerPixRecebidos: lê esse texto e devolve o extrato (um lançamento por linha), com o pagador sem o banco, o banco
//    à parte e o E2E como idDaTransacao (acha o mesmo Pix num comprovante; juntar.ts). São todos Pix: as palavras do
//    Pix ("PIX", "TRANSF") não valem para eles (filtrarPix).
// Privacidade (D26): o nome e o banco ficam só na memória da tela.
import {
  criarRelogio,
  normalizar,
  type ContextoDeLeitura,
  type ExtratoLido,
  type FalhaDoExtrato,
  type Lancamento,
} from "./lancamentos";
import type { TextoDoPdf } from "./pdf-linhas";
import { acharData, acharHora, lerValorComSinal } from "./valores";

/** A primeira linha do texto canônico e o cabeçalho dele. */
export const MARCA_PIX_RECEBIDOS = "Pix recebidos";
export const CABECALHO_PIX_RECEBIDOS = [
  "Data",
  "Horário",
  "Pagador",
  "Banco",
  "Identificação",
  "Entradas (R$)",
  "Saídas (R$)",
].join("\t");

const ALTURA_PADRAO = 10;
const alturaDe = (pedaco: TextoDoPdf) =>
  pedaco.altura > 0 ? pedaco.altura : ALTURA_PADRAO;

// ---------------------------------------------------------------------------------------------------
// 1. Os blocos, pelas posições
// ---------------------------------------------------------------------------------------------------

const ROTULOS = {
  data: /^DATA\b/,
  referencia: /^REFERENCIA\b/,
  identificacao: /^IDENTIFICACAO\b/,
  horario: /^HORARIO\b/,
  entradas: /^ENTRADAS\b/,
  saidas: /^SAIDAS\b/,
} as const;
type Rotulo = keyof typeof ROTULOS;

interface Coluna {
  inicio: number;
  fim: number;
}

interface Cabecalho {
  colunas: Partial<Record<Rotulo, Coluna>>;
  /** Abaixo disto começa a tabela. */
  base: number;
}

/** O E2E do Banco Central: "E" + o ISPB (8) + aaaammddhhmm (12) + 11 letras ou algarismos. */
const E2E = /(?<![A-Z0-9])E\d{20}[A-Z0-9]{11}(?![A-Z0-9])/i;
const HORA = /(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?!\d)/;
const VALOR = /(?<![\d,.])(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?![\d,])/g;
const VER_DETALHES = /^(?:VER|DETALHES|VER DETALHES)$/;
const MESES = [
  "JAN",
  "FEV",
  "MAR",
  "ABR",
  "MAI",
  "JUN",
  "JUL",
  "AGO",
  "SET",
  "OUT",
  "NOV",
  "DEZ",
];

/** O cabeçalho da página: Data, Horário, Entradas e Saídas, e Referência ou Identificação, na mesma faixa. */
function acharCabecalho(pedacos: readonly TextoDoPdf[]): Cabecalho | null {
  const rotulados = pedacos.flatMap((pedaco) => {
    const texto = normalizar(pedaco.texto.trim());
    const rotulo = (Object.keys(ROTULOS) as Rotulo[]).find((nome) =>
      ROTULOS[nome].test(texto),
    );
    return rotulo ? [{ rotulo, pedaco }] : [];
  });
  for (const ancora of rotulados.filter((item) => item.rotulo === "entradas")) {
    const faixa = alturaDe(ancora.pedaco) * 3;
    const colunas: Partial<Record<Rotulo, Coluna>> = {};
    let base = ancora.pedaco.y;
    for (const rotulo of Object.keys(ROTULOS) as Rotulo[]) {
      const achado = rotulados
        .filter(
          (item) =>
            item.rotulo === rotulo &&
            Math.abs(item.pedaco.y - ancora.pedaco.y) <= faixa,
        )
        .sort(
          (a, b) =>
            Math.abs(a.pedaco.y - ancora.pedaco.y) -
            Math.abs(b.pedaco.y - ancora.pedaco.y),
        )[0];
      if (!achado) continue;
      colunas[rotulo] = {
        inicio: achado.pedaco.x,
        fim: achado.pedaco.x + Math.max(0, achado.pedaco.largura),
      };
      base = Math.min(base, achado.pedaco.y);
    }
    if (
      colunas.data &&
      colunas.horario &&
      colunas.entradas &&
      colunas.saidas &&
      (colunas.referencia || colunas.identificacao)
    ) {
      // O "(R$)" da segunda linha do cabeçalho também é cabeçalho.
      const segunda = pedacos.filter(
        (pedaco) =>
          pedaco.y < base &&
          base - pedaco.y <= faixa &&
          /^\(?R\$\)?$|^ATE$/.test(normalizar(pedaco.texto.trim())),
      );
      for (const pedaco of segunda) base = Math.min(base, pedaco.y);
      return { colunas, base: base - alturaDe(ancora.pedaco) * 0.3 };
    }
  }
  return null;
}

/** Um pedaço da linha do meio: o horário, o valor ou o E2E. */
interface Marca {
  y: number;
  altura: number;
  hora?: string;
  entrada?: string;
  saida?: string;
  e2e?: string;
}

interface LinhaDeTexto {
  y: number;
  altura: number;
  partes: { x: number; texto: string }[];
}

interface Bloco {
  y: number;
  altura: number;
  hora: string;
  entrada: string;
  saida: string;
  e2e: string;
  referencia: LinhaDeTexto[];
  data: LinhaDeTexto[];
}

/** A coluna de texto do pedaço (Data, Referência ou outra): a última que começa antes dele. */
function colunaDoTexto(pedaco: TextoDoPdf, cabecalho: Cabecalho): Rotulo {
  const folga = alturaDe(pedaco) * 0.5;
  const ordem = (Object.entries(cabecalho.colunas) as [Rotulo, Coluna][]).sort(
    (a, b) => a[1].inicio - b[1].inicio,
  );
  let escolhida = ordem[0][0];
  for (const [rotulo, coluna] of ordem)
    if (coluna.inicio <= pedaco.x + folga) escolhida = rotulo;
  return escolhida;
}

/** Junta os pedaços na mesma linha (pelo y), da esquerda para a direita. */
function juntarEmLinhas(
  linhas: LinhaDeTexto[],
  pedaco: TextoDoPdf,
  texto: string,
): void {
  const altura = alturaDe(pedaco);
  const mesma = linhas.find(
    (linha) =>
      Math.abs(linha.y - pedaco.y) <= Math.max(linha.altura, altura) * 0.4,
  );
  if (mesma) mesma.partes.push({ x: pedaco.x, texto });
  else linhas.push({ y: pedaco.y, altura, partes: [{ x: pedaco.x, texto }] });
}

const textoDaLinha = (linha: LinhaDeTexto) =>
  [...linha.partes]
    .sort((a, b) => a.x - b.x)
    .map((parte) => parte.texto)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/** Os blocos da página: um por linha do meio, com as linhas da Referência e da Data mais perto dela. */
function blocosDaPagina(
  pedacos: readonly TextoDoPdf[],
  cabecalho: Cabecalho,
): Bloco[] {
  const { entradas, saidas } = cabecalho.colunas as Record<Rotulo, Coluna>;
  const marcas: Marca[] = [];
  const referencia: LinhaDeTexto[] = [];
  const data: LinhaDeTexto[] = [];
  for (const pedaco of pedacos) {
    const texto = pedaco.texto.replace(/\s+/g, " ").trim();
    if (
      texto === "" ||
      !Number.isFinite(pedaco.x) ||
      !Number.isFinite(pedaco.y)
    )
      continue;
    if (pedaco.y >= cabecalho.base) continue;
    if (VER_DETALHES.test(normalizar(texto))) continue;
    const marca: Marca = { y: pedaco.y, altura: alturaDe(pedaco) };
    const e2e = E2E.exec(texto);
    if (e2e) marca.e2e = e2e[0];
    const hora = HORA.exec(texto);
    if (hora) marca.hora = hora[0];
    const fim = pedaco.x + Math.max(0, pedaco.largura);
    const valores = fim >= entradas.inicio ? texto.match(VALOR) : null;
    if (valores) {
      // Os valores ficam alinhados pela direita: a coluna é a do fim do cabeçalho mais perto do fim do valor.
      const valor = valores.at(-1) as string;
      if (Math.abs(fim - entradas.fim) <= Math.abs(fim - saidas.fim))
        marca.entrada = valor;
      else marca.saida = valor;
    }
    if (marca.e2e || marca.hora || marca.entrada || marca.saida) {
      marcas.push(marca);
      continue;
    }
    const coluna = colunaDoTexto(pedaco, cabecalho);
    if (coluna === "data") juntarEmLinhas(data, pedaco, texto);
    else if (coluna === "referencia") juntarEmLinhas(referencia, pedaco, texto);
  }
  // As marcas da mesma linha do meio formam um bloco.
  const blocos: Bloco[] = [];
  for (const marca of marcas.sort((a, b) => b.y - a.y)) {
    const atual = blocos.find(
      (bloco) =>
        Math.abs(bloco.y - marca.y) <=
        Math.max(bloco.altura, marca.altura) * 0.6,
    );
    const bloco: Bloco = atual ?? {
      y: marca.y,
      altura: marca.altura,
      hora: "",
      entrada: "",
      saida: "",
      e2e: "",
      referencia: [],
      data: [],
    };
    if (!atual) blocos.push(bloco);
    bloco.hora ||= marca.hora ?? "";
    bloco.entrada ||= marca.entrada ?? "";
    bloco.saida ||= marca.saida ?? "";
    bloco.e2e ||= marca.e2e ?? "";
  }
  if (blocos.length === 0) return [];
  const maisPerto = (y: number) =>
    blocos.reduce((melhor, bloco) =>
      Math.abs(bloco.y - y) < Math.abs(melhor.y - y) ? bloco : melhor,
    );
  for (const linha of data) maisPerto(linha.y).data.push(linha);
  repartirReferencia(blocos, referencia);
  return blocos;
}

/**
 * As linhas da Referência em cada bloco. A célula fica centrada na linha do meio, e o tamanho dela varia (o nome e o
 * banco em 2 a 8 linhas): o mais perto erraria entre um bloco curto e um longo. Entre duas linhas do meio, a divisa
 * é o maior vão entre as linhas (o espaço entre as linhas da tabela é maior que o entre as linhas de uma célula); a
 * linha na altura de uma linha do meio é do bloco dela; acima da primeira e abaixo da última, do bloco da ponta.
 */
function repartirReferencia(blocos: Bloco[], linhas: LinhaDeTexto[]): void {
  const ordem = [...blocos].sort((a, b) => b.y - a.y);
  const restantes = [...linhas].sort((a, b) => b.y - a.y);
  const naAltura = (linha: LinhaDeTexto, bloco: Bloco) =>
    Math.abs(linha.y - bloco.y) <= Math.max(linha.altura, bloco.altura) * 0.6;
  for (const linha of restantes) {
    const bloco = ordem.find((item) => naAltura(linha, item));
    if (bloco) bloco.referencia.push(linha);
  }
  const soltas = restantes.filter(
    (linha) => !ordem.some((bloco) => naAltura(linha, bloco)),
  );
  const primeiro = ordem[0];
  const ultimo = ordem[ordem.length - 1];
  for (const linha of soltas) {
    if (linha.y > primeiro.y) primeiro.referencia.push(linha);
    else if (linha.y < ultimo.y) ultimo.referencia.push(linha);
  }
  for (let i = 0; i + 1 < ordem.length; i++) {
    const [cima, baixo] = [ordem[i], ordem[i + 1]];
    const entre = soltas.filter(
      (linha) => linha.y < cima.y && linha.y > baixo.y,
    );
    if (entre.length === 0) continue;
    // As pontas: a linha do meio, ou a linha da célula na altura dela que está mais para dentro.
    const pontaDe = (bloco: Bloco, escolher: (...ys: number[]) => number) =>
      escolher(
        bloco.y,
        ...bloco.referencia
          .filter((linha) => naAltura(linha, bloco))
          .map((linha) => linha.y),
      );
    const alturas = [
      pontaDe(cima, Math.min),
      ...entre.map((linha) => linha.y),
      pontaDe(baixo, Math.max),
    ];
    let corte = 0;
    let maior = -Infinity;
    for (let j = 0; j + 1 < alturas.length; j++) {
      const vao = alturas[j] - alturas[j + 1];
      if (vao > maior) {
        maior = vao;
        corte = j;
      }
    }
    // alturas[0] é a linha do meio de cima: as linhas até o corte são dela.
    entre.forEach((linha, j) =>
      (j < corte ? cima : baixo).referencia.push(linha),
    );
  }
}

/** O começo de uma linha que é o banco ("ITAÚ UNIBANCO S.A.", "Banco Bradesco S.A.", "NU PAGAMENTOS - IP"). */
const INICIO_DO_BANCO =
  /^(?:BANCO|BCO|BANK|ITAU|UNIBANCO|NU|NUBANK|CAIXA|CEF|SANTANDER|BRADESCO|INTER|C6|PAGSEGURO|PAGBANK|MERCADO ?PAGO|MERCADOPAGO|PICPAY|SICOOB|SICREDI|COOPERATIVA|COOP|CORA|NEON|STONE|BTG|SAFRA|BANRISUL|BRB|AGIBANK|BMG|DAYCOVAL|SOFISA|EFI|GERENCIANET|ASAAS|CELCOIN|BANESTES|UNICRED|CRESOL|AILOS|BANPARA|BANESE|CLOUDWALK|RECARGAPAY|IUGU|BS2|SUMUP|PAGARME|NUINVEST|INSTITUICAO DE PAGAMENTO)\b/;
/** O fim de uma linha que é o banco (a forma da empresa). */
const FIM_DO_BANCO =
  /(?:\bS\.? ?A\.?|\bS\/A|\bLTDA\.?|\bIP|\bSCD|\bSCFI|\bDTVM)$/;

/** Separa a Referência no nome de quem pagou e no banco dele. */
export function separarBanco(linhas: readonly { y: number; texto: string }[]): {
  nome: string;
  banco: string;
} {
  const ordem = [...linhas].sort((a, b) => b.y - a.y);
  const textos = ordem.map((linha) => linha.texto);
  const juntar = (de: number, ate: number) =>
    textos.slice(de, ate).join(" ").replace(/\s+/g, " ").trim();
  // 1. A linha que começa com o nome de um banco (nunca a primeira: ela é o nome).
  let corte = textos.findIndex(
    (texto, indice) => indice > 0 && INICIO_DO_BANCO.test(normalizar(texto)),
  );
  // 2. O vão maior entre as linhas (o banco é outro parágrafo da célula), com o fim de banco depois dele.
  if (corte < 0 && ordem.length >= 3) {
    const vaos = ordem.slice(1).map((linha, i) => ordem[i].y - linha.y);
    const maior = Math.max(...vaos);
    const menor = Math.min(...vaos);
    const indice = vaos.indexOf(maior) + 1;
    if (
      maior - menor >= 0.5 &&
      FIM_DO_BANCO.test(normalizar(juntar(indice, textos.length)))
    )
      corte = indice;
  }
  // 3. Só a última linha, se ela tem a forma de uma empresa ("... S.A.").
  if (
    corte < 0 &&
    textos.length >= 2 &&
    FIM_DO_BANCO.test(normalizar(textos.at(-1) as string)) &&
    normalizar(textos.at(-1) as string).replace(/[^A-Z]/g, "").length > 3
  )
    corte = textos.length - 1;
  if (corte < 0) return { nome: juntar(0, textos.length), banco: "" };
  return { nome: juntar(0, corte), banco: juntar(corte, textos.length) };
}

/** O dia e o mês da coluna Data ("19" e "NOV", "19 NOV", "19/11"). */
function diaEMes(texto: string): { dia?: number; mes?: number } {
  const normal = normalizar(texto);
  const barra = /(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/.exec(normal);
  if (barra) return { dia: Number(barra[1]), mes: Number(barra[2]) };
  const dia = /(?<!\d)(\d{1,2})(?!\d)/.exec(normal);
  const mes = MESES.findIndex((nome) => new RegExp(`\\b${nome}`).test(normal));
  return {
    dia: dia ? Number(dia[1]) : undefined,
    mes: mes >= 0 ? mes + 1 : undefined,
  };
}

/** O ano pelo E2E (aaaamm logo depois do ISPB), com a virada do ano (o E2E é em UTC). */
function anoDoE2e(e2e: string, mes: number): number | null {
  const achado = /^E\d{8}(\d{4})(\d{2})/i.exec(e2e);
  if (!achado) return null;
  const ano = Number(achado[1]);
  const mesDoE2e = Number(achado[2]);
  if (ano < 2000 || ano > 2100 || mesDoE2e < 1 || mesDoE2e > 12) return null;
  if (mesDoE2e === 1 && mes === 12) return ano - 1;
  if (mesDoE2e === 12 && mes === 1) return ano + 1;
  return ano;
}

const dois = (numero: number) => String(numero).padStart(2, "0");
const semTab = (texto: string) => texto.replace(/\t/g, " ");

/**
 * O texto canônico do relatório "Pix recebidos" (uma linha por lançamento), ou null se nenhuma página tem o
 * cabeçalho dele (o PDF é outro: segue o leitor de sempre). A página sem cabeçalho usa o da anterior; a data vale
 * para os lançamentos de baixo (só o primeiro do dia a traz), também na página seguinte.
 */
export function textoDosPixRecebidos(
  paginas: readonly (readonly TextoDoPdf[])[],
): string | null {
  const cabecalhos = paginas.map(acharCabecalho);
  if (cabecalhos.every((cabecalho) => cabecalho === null)) return null;
  const saida = [MARCA_PIX_RECEBIDOS, CABECALHO_PIX_RECEBIDOS];
  let cabecalho: Cabecalho | null = null;
  let dia: number | undefined;
  let mes: number | undefined;
  paginas.forEach((pedacos, indice) => {
    const daPagina = cabecalhos[indice];
    if (daPagina) cabecalho = daPagina;
    else if (cabecalho) cabecalho = { ...cabecalho, base: Infinity };
    if (!cabecalho) return;
    for (const bloco of blocosDaPagina(pedacos, cabecalho).sort(
      (a, b) => b.y - a.y,
    )) {
      const lido = diaEMes(
        bloco.data
          .sort((a, b) => b.y - a.y)
          .map(textoDaLinha)
          .join(" "),
      );
      if (lido.dia !== undefined) {
        dia = lido.dia;
        mes = lido.mes ?? mes;
      }
      const ano =
        mes !== undefined && bloco.e2e ? anoDoE2e(bloco.e2e, mes) : null;
      const data =
        dia !== undefined && mes !== undefined
          ? `${dois(dia)}/${dois(mes)}${ano ? `/${ano}` : ""}`
          : "";
      const { nome, banco } = separarBanco(
        bloco.referencia.map((linha) => ({
          y: linha.y,
          texto: textoDaLinha(linha),
        })),
      );
      saida.push(
        [data, bloco.hora, nome, banco, bloco.e2e, bloco.entrada, bloco.saida]
          .map(semTab)
          .join("\t"),
      );
    }
  });
  return saida.join("\n");
}

// ---------------------------------------------------------------------------------------------------
// 2. Os lançamentos, do texto canônico
// ---------------------------------------------------------------------------------------------------

/** O texto é o do relatório "Pix recebidos" (textoDosPixRecebidos)? */
export function parecePixRecebidos(texto: string): boolean {
  const [marca, cabecalho] = texto.split(/\r?\n/, 2);
  return marca === MARCA_PIX_RECEBIDOS && cabecalho === CABECALHO_PIX_RECEBIDOS;
}

/** O relatório sem nenhum lançamento (o leitor do PDF troca pela falha dele). */
export const SEM_PIX_RECEBIDOS: FalhaDoExtrato = {
  ok: false,
  titulo: "Não achamos Pix no relatório",
  mensagem: "Baixe de novo o relatório de Pix recebidos do período.",
};

/** Lê os lançamentos do texto canônico: um por linha, com o pagador, o banco e o E2E. */
export function lerPixRecebidos(
  texto: string,
  contexto: ContextoDeLeitura,
): ExtratoLido | FalhaDoExtrato {
  const relogio = criarRelogio(contexto);
  const lancamentos: Lancamento[] = [];
  let ilegiveis = 0;
  let ordem = 0;
  for (const linha of texto.split(/\r?\n/).slice(2)) {
    if (linha.trim() === "") continue;
    ordem++;
    const celulas = linha.split("\t");
    const [
      celulaData,
      celulaHora,
      pagador,
      banco,
      e2e,
      celulaEntrada,
      celulaSaida,
    ] = Array.from({ length: 7 }, (_, indice) => celulas[indice] ?? "");
    const data = acharData(celulaData, relogio.hoje);
    const hora = acharHora(celulaHora);
    const entrada = lerValorComSinal(celulaEntrada);
    const saidaLida = lerValorComSinal(celulaSaida);
    const centavos =
      entrada !== null && entrada !== 0
        ? Math.abs(entrada)
        : saidaLida !== null && saidaLida !== 0
          ? -Math.abs(saidaLida)
          : null;
    const local =
      data && centavos !== null
        ? relogio.local(data.ano, data.mes, data.dia, hora ?? undefined)
        : null;
    if (local === null || centavos === null) {
      ilegiveis++;
      continue;
    }
    const lancamento: Lancamento = {
      ordem,
      dia: local.dia,
      instante: local.instante,
      centavos,
      descricao: [centavos > 0 ? "Pix recebido" : "Pix (saída)", pagador.trim()]
        .filter((parte) => parte !== "")
        .join(" · "),
      identificadores: [],
      pix: true,
    };
    if (pagador.trim()) lancamento.pagador = pagador.trim();
    if (banco.trim()) lancamento.banco = banco.trim();
    if (E2E.test(e2e.trim())) lancamento.idDaTransacao = e2e.trim();
    lancamentos.push(lancamento);
  }
  if (lancamentos.length === 0 && ilegiveis === 0) return SEM_PIX_RECEBIDOS;
  return {
    ok: true,
    formato: "pdf",
    lancamentos,
    ilegiveis,
    semHora: lancamentos.every((item) => item.instante === null),
  };
}
