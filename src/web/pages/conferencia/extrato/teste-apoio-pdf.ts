// Apoio dos testes do extrato em PDF (RIFA-068): PDFs SINTÉTICOS gerados aqui (o texto com a posição de cada pedaço,
// na fonte Helvetica, como os relatórios de banco), no formato pesquisado do extrato do Bradesco (a tabela Data,
// Histórico, Docto., Crédito (R$), Débito (R$) e Saldo (R$), com o Pix em duas linhas: "TRANSFERENCIA PIX", o
// documento, o valor e o saldo; embaixo, "REM: <nome>"). Também o PDF só com uma imagem (escaneado) e o PDF com senha.
// Nenhum dado é real: nomes, documentos, agência e conta são fictícios.
import type { TextoDoPdf } from "./pdf-linhas";
import {
  PAGADORA_TRES,
  PAGADORA_UM,
  PAGADOR_DOIS,
  TEXTO_LINHAS,
} from "./teste-apoio";

/** O pdf.js nos testes (Node, sem Web Worker): o "worker" roda na mesma linha de execução, pelo `pdfjsWorker`. */
export async function prepararPdfjsNosTestes(): Promise<void> {
  const worker: unknown = await import(
    // @ts-expect-error -- o pdfjs-dist não traz os tipos do módulo do worker.
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
}

/** Um texto na página: x e y em pontos (A4: 595 × 842, o y cresce para cima). */
export interface TextoNaPagina {
  x: number;
  y: number;
  texto: string;
  /** O tamanho da letra (padrão 8). */
  tamanho?: number;
  negrito?: boolean;
  /** Alinhado pela direita: o x é onde o texto termina (as colunas de valor). */
  direita?: boolean;
}

/** As larguras da Helvetica (em milésimos da letra) dos caracteres dos valores; o resto, aproximado. */
function largura(texto: string, tamanho: number): number {
  let soma = 0;
  for (const letra of texto)
    soma += /\d/.test(letra)
      ? 556
      : ",./: ".includes(letra)
        ? 278
        : "-()".includes(letra)
          ? 333
          : 556;
  return (soma * tamanho) / 1000;
}

/** Um texto como string literal do PDF, na codificação WinAnsi (os acentos em octal: o arquivo fica só em ASCII). */
function literal(texto: string): string {
  let saida = "(";
  for (const letra of texto) {
    const codigo = letra.charCodeAt(0);
    if (codigo > 0xff) throw new Error(`Fora da WinAnsi: ${letra}`);
    if (letra === "(" || letra === ")" || letra === "\\") saida += `\\${letra}`;
    else if (codigo < 32 || codigo > 126)
      saida += `\\${codigo.toString(8).padStart(3, "0")}`;
    else saida += letra;
  }
  return `${saida})`;
}

/** Monta o arquivo: os objetos na ordem, a tabela xref e o trailer (tudo em ASCII: a posição é o tamanho do texto). */
function montar(objetos: string[]): Uint8Array<ArrayBuffer> {
  let arquivo = "%PDF-1.4\n";
  const posicoes: number[] = [];
  objetos.forEach((objeto, indice) => {
    posicoes.push(arquivo.length);
    arquivo += `${indice + 1} 0 obj\n${objeto}\nendobj\n`;
  });
  const xref = arquivo.length;
  arquivo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const posicao of posicoes)
    arquivo += `${String(posicao).padStart(10, "0")} 00000 n \n`;
  arquivo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(arquivo);
}

const fluxo = (conteudo: string, dicionario = "") =>
  `<< /Length ${conteudo.length}${dicionario} >>\nstream\n${conteudo}\nendstream`;

/** Um PDF com os textos de cada página (Helvetica e Helvetica-Bold, sem fonte embutida, como muitos relatórios). */
export function criarPdf(
  paginas: readonly (readonly TextoNaPagina[])[],
): Uint8Array<ArrayBuffer> {
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "", // as páginas, preenchido abaixo
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  const filhas: string[] = [];
  for (const textos of paginas) {
    const comandos = textos.map((item) => {
      const tamanho = item.tamanho ?? 8;
      const x = item.direita ? item.x - largura(item.texto, tamanho) : item.x;
      return `/${item.negrito ? "F2" : "F1"} ${tamanho} Tf 1 0 0 1 ${x.toFixed(2)} ${item.y.toFixed(2)} Tm ${literal(item.texto)} Tj`;
    });
    const conteudo = `BT\n${comandos.join("\n")}\nET`;
    objetos.push(fluxo(conteudo));
    const numeroDoConteudo = objetos.length;
    objetos.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${numeroDoConteudo} 0 R >>`,
    );
    filhas.push(`${objetos.length} 0 R`);
  }
  objetos[1] = `<< /Type /Pages /Kids [${filhas.join(" ")}] /Count ${filhas.length} >>`;
  return montar(objetos);
}

/** Um PDF de uma página só com uma imagem (o extrato escaneado ou fotografado): nenhum texto. */
export function criarPdfDeImagem(): Uint8Array<ArrayBuffer> {
  return montar([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
    fluxo("q 500 0 0 700 47 71 cm /Im1 Do Q"),
    fluxo(
      "FF00 00FF>",
      " /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode",
    ),
  ]);
}

/**
 * Um PDF com senha de abrir (RC4 de 128 bits, a senha fictícia "senha-ficticia"), com uma linha de extrato fictícia.
 * Gerado uma vez com o pypdf (6.17) a partir de um PDF deste arquivo, porque a cifra pede MD5 e RC4:
 *   w = PdfWriter(clone_from=PdfReader(io.BytesIO(pdf))); w.encrypt("senha-ficticia", algorithm="RC4-128")
 * pdf.test.ts confere que, com a senha, o pdf.js lê o texto fictício (o arquivo é um PDF cifrado de verdade).
 */
export const SENHA_DO_PDF = "senha-ficticia";
export const PDF_COM_SENHA_BASE64 = [
  "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4K",
  "ZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgMyAwIFIgXQovQ291bnQgMQo+",
  "PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDIgMCBSCi9NZWRpYUJveCBb",
  "IDAgMCA1OTUgODQyIF0KL1Jlc291cmNlcyA8PAovRm9udCA8PAovRjEgNCAwIFIKPj4KPj4KL0Nv",
  "bnRlbnRzIDUgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9U",
  "eXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQovRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZwo+Pgpl",
  "bmRvYmoKNSAwIG9iago8PAovTGVuZ3RoIDIwMQo+PgpzdHJlYW0KvGq1Z/4xgL0ewwJ8+TFKkAQy",
  "h6HedM4iL0zKLO/5P0qyL2C0+jfQBbpPeaiK4fKEZ2E5GqMdiIXgEx1iqSAE1csuPuIvbp/7sAOk",
  "4NIxw29XBDPm0Q2VuIKlOjgJJR2l81qhE7Ex8rwboszwXmyimgHFPzsoV6rK/ZsjxZJdLSogtSZU",
  "NVGFuOy9sM3Ew314elWcmKGdFRYuONquHdBcXjQnvXciuIe/av/HxQXUrWvCAK9AnnjjXVV1t4/w",
  "JYW/5S5GAmEcge51CmVuZHN0cmVhbQplbmRvYmoKNiAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0",
  "aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8YjFmZTZiMjdjZjQ1ZjE5",
  "ZWY0ZDI5MjAwNGQ4OWM3YjZlNTU1ZDhhYWRhY2M0YjEwNmZmNGE0ODAwOGNkOTBiZT4KL1UgPDY0",
  "MmUyYWYzYzEzNDI0YjAyNjY2YmM4YTA5ZjAwNTFkMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZm",
  "YTAxMDg+Cj4+CmVuZG9iago3IDAgb2JqCjw8Ci9Qcm9kdWNlciA8ZWYxOGZkNzIxND4KPj4KZW5k",
  "b2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAw",
  "MDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjMgMDAwMDAgbiAKMDAwMDAwMDI1MSAwMDAwMCBuIAow",
  "MDAwMDAwMzQ4IDAwMDAwIG4gCjAwMDAwMDA2MDAgMDAwMDAgbiAKMDAwMDAwMDgxNSAwMDAwMCBu",
  "IAp0cmFpbGVyCjw8Ci9TaXplIDgKL1Jvb3QgMSAwIFIKL0luZm8gNyAwIFIKL0lEIFsgPDM5Mzcz",
  "MTMwNjE2NjM1NjQzOTYxNjYzMjYzNjMzNzM0MzEzMDMzMzU2MzMzMzI2NTMxMzUzNjMxMzIzMTYz",
  "MzM+IDwzOTM3MzEzMDYxNjYzNTY0Mzk2MTY2MzI2MzYzMzczNDMxMzAzMzM1NjMzMzMyNjUzMTM1",
  "MzYzMTMyMzE2MzMzPiBdCi9FbmNyeXB0IDYgMCBSCj4+CnN0YXJ0eHJlZgo4NTkKJSVFT0YK",
].join("");

export const pdfComSenha = (): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(PDF_COM_SENHA_BASE64), (letra) => letra.charCodeAt(0));

// ---------------------------------------------------------------------------------------------------
// O extrato do Bradesco (formato pesquisado; dados fictícios)
// ---------------------------------------------------------------------------------------------------

/** Uma linha da tabela: data, histórico, documento, crédito, débito e saldo. */
export type LinhaDoBradesco = readonly [
  data: string,
  historico: string,
  documento: string,
  credito: string,
  debito: string,
  saldo: string,
];

export const CABECALHO_DO_BRADESCO: LinhaDoBradesco = [
  "Data",
  "Histórico",
  "Docto.",
  "Crédito (R$)",
  "Débito (R$)",
  "Saldo (R$)",
];

/**
 * A página 1: a data só na primeira linha do dia (a do saldo anterior, sem crédito nem débito), o Pix recebido
 * (REM:), o Pix enviado (DES:), outro Pix recebido, uma transferência e um pagamento (débitos sem sinal: só a coluna
 * diz que são débitos).
 */
export const BRADESCO_PAGINA_1: readonly LinhaDoBradesco[] = [
  ["16/11/2026", "SALDO ANTERIOR", "", "", "", "1.000,00"],
  ["", "TRANSFERENCIA PIX", "1400200", "20,00", "", "1.020,00"],
  ["", `REM: ${PAGADORA_UM} 16/11`, "", "", "", ""],
  ["", "TRANSFERENCIA PIX", "1400201", "", "15,00", "1.005,00"],
  ["", "DES: Loja Ficticia 16/11", "", "", "", ""],
  ["", "TRANSFERENCIA PIX", "1400202", "40,00", "", "1.045,00"],
  ["", `REM: ${PAGADOR_DOIS} 16/11`, "", "", "", ""],
  ["", "TRANSF CC PARA CC PJ", "0000123", "", "100,00", "945,00"],
  ["", "PAGTO ELETRON COBRANCA", "0000001", "", "50,00", "895,00"],
];

/** A página 2 (o cabeçalho repetido): a data na linha do lançamento. */
export const BRADESCO_PAGINA_2: readonly LinhaDoBradesco[] = [
  ["17/11/2026", "TRANSFERENCIA PIX", "1400300", "1.234,56", "", "2.129,56"],
  ["", `REM: ${PAGADORA_TRES} 17/11`, "", "", "", ""],
];

/** As colunas: Data e Histórico pela esquerda; Docto. pela esquerda; os valores pela direita. */
const COLUNAS = [
  { x: 30, direita: false },
  { x: 80, direita: false },
  { x: 270, direita: false },
  { x: 390, direita: true },
  { x: 460, direita: true },
  { x: 540, direita: true },
] as const;
const ENTRE_LINHAS = 11;

/** Uma página do extrato: o título, a agência e a conta, o período, a tabela e o rodapé, como o Net Empresa. */
export function paginaDoBradesco(
  linhas: readonly LinhaDoBradesco[],
  pagina: number,
  total: number,
): TextoNaPagina[] {
  const textos: TextoNaPagina[] = [
    {
      x: 30,
      y: 800,
      texto: "Bradesco Net Empresa",
      tamanho: 12,
      negrito: true,
    },
    { x: 30, y: 784, texto: "Extrato Mensal / Por Período", tamanho: 10 },
    { x: 30, y: 770, texto: "Empresa: Associacao Ficticia de Teste" },
    { x: 30, y: 759, texto: "Agência: 0000 | Conta: 0000000-0" },
    { x: 30, y: 748, texto: "Período: 16/11/2026 a 17/11/2026" },
  ];
  const celulas = (linha: LinhaDoBradesco, y: number, negrito = false) =>
    linha.forEach((texto, indice) => {
      if (texto !== "") textos.push({ ...COLUNAS[indice], y, texto, negrito });
    });
  let y = 724;
  celulas(CABECALHO_DO_BRADESCO, y, true);
  for (const linha of linhas) {
    y -= ENTRE_LINHAS;
    celulas(linha, y);
  }
  textos.push(
    {
      x: 30,
      y: 60,
      texto: "Os dados acima têm como base 18/11/2026 às 09:00h.",
      tamanho: 7,
    },
    { x: 500, y: 48, texto: `Página ${pagina} de ${total}`, tamanho: 7 },
  );
  return textos;
}

/** O extrato do Bradesco em PDF, em duas páginas. */
export const pdfDoBradesco = (): Uint8Array<ArrayBuffer> =>
  criarPdf([
    paginaDoBradesco(BRADESCO_PAGINA_1, 1, 2),
    paginaDoBradesco(BRADESCO_PAGINA_2, 2, 2),
  ]);

/** A mesma tabela copiada da tela do banco e colada (tabulações): o PDF tem de dar o mesmo resultado. */
export const TEXTO_DO_BRADESCO = [
  CABECALHO_DO_BRADESCO,
  ...BRADESCO_PAGINA_1,
  ...BRADESCO_PAGINA_2,
]
  .map((linha) => linha.join("\t"))
  .join("\n");

/** Um extrato sem tabela (uma linha por lançamento, com a hora): o texto das linhas de TEXTO_LINHAS, em PDF. */
export const pdfDeLinhas = (): Uint8Array<ArrayBuffer> =>
  criarPdf([
    TEXTO_LINHAS.split(/\r?\n/).flatMap((linha, indice) => {
      // Cada linha em dois pedaços (a data e a hora; o resto), como os geradores de PDF costumam escrever.
      const corte = linha.indexOf(" ", linha.indexOf(" ") + 1);
      const [dataEHora, resto] = [
        linha.slice(0, corte),
        linha.slice(corte + 1),
      ];
      const y = 780 - indice * 12;
      return [
        { x: 40, y, texto: dataEHora },
        { x: 40 + largura(`${dataEHora} `, 8), y, texto: resto },
      ];
    }),
  ]);

/** Um PDF com texto, mas sem lançamentos (o PDF errado: um comprovante, uma carta). */
export const pdfSemLancamentos = (): Uint8Array<ArrayBuffer> =>
  criarPdf([
    [
      { x: 40, y: 780, texto: "Comprovante de cadastro", tamanho: 12 },
      { x: 40, y: 760, texto: "Associacao Ficticia de Teste" },
    ],
  ]);

/** Pedaços de texto para os testes do montador de linhas (pdf-linhas.ts), sem passar pelo pdf.js. */
export const pedaco = (
  texto: string,
  x: number,
  y: number,
  altura = 8,
): TextoDoPdf => ({ texto, x, y, largura: largura(texto, altura), altura });

// ---------------------------------------------------------------------------------------------------
// Os comprovantes de Pix (RIFA-074; formato pesquisado em fontes públicas; dados fictícios)
// ---------------------------------------------------------------------------------------------------

/** Uma linha do comprovante: o rótulo e, se houver, o valor (na coluna da direita, ou na linha de baixo). */
export type LinhaDoComprovante = readonly [rotulo: string, valor?: string];

/** O ID da transação (E2E) fictício de cada comprovante: "E", 20 algarismos e 11 letras ou algarismos. */
export const E2E_BRADESCO = "E00000000202611161305FICTICIO001";
export const E2E_NUBANK = "E11111111202611161730FICTICIO002";
export const E2E_ITAU = "E22222222202611161945FICTICIO003";

/** O comprovante do Bradesco (app e Net Empresa): os blocos de quem recebeu, de quem pagou e da transação. */
export const COMPROVANTE_BRADESCO: readonly LinhaDoComprovante[] = [
  ["Bradesco"],
  ["Comprovante de Transação Pix"],
  ["Dados de quem recebeu"],
  ["Nome", "Associacao Ficticia de Teste"],
  ["CPF/CNPJ", "00.000.000/0001-00"],
  ["Instituição", "BCO BRADESCO S.A."],
  ["Chave", "pix@exemplo.invalid"],
  ["Dados de quem pagou"],
  ["Nome", PAGADORA_UM],
  ["CPF/CNPJ", "***.000.000-**"],
  ["Instituição", "BANCO FICTICIO S.A."],
  ["Dados da transação"],
  ["Valor", "R$ 20,00"],
  ["Data e hora", "16/11/2026 - 10:05:33"],
  ["Identificador", "PEDTESTE0101"],
  ["ID da transação", E2E_BRADESCO],
  ["Número de controle", "0000000001"],
];

/** O de um banco digital (o jeito do Nubank): a data no topo, sem rótulo; "Destino" e "Origem"; sem identificador. */
export const COMPROVANTE_DIGITAL: readonly LinhaDoComprovante[] = [
  ["Comprovante de transferência"],
  ["16 NOV 2026 - 14:30:12"],
  ["Valor", "R$ 40,00"],
  ["Tipo de transferência", "Pix"],
  ["Destino"],
  ["Nome", "Associacao Ficticia de Teste"],
  ["CNPJ", "00.000.000/0001-00"],
  ["Instituição", "BCO BRADESCO S.A."],
  ["Origem"],
  ["Nome", PAGADOR_DOIS],
  ["Instituição", "INSTITUICAO FICTICIA"],
  ["CPF", "***.000.000-**"],
  ["ID da transação:", E2E_NUBANK],
];

/** O de outro banco (o jeito do Itaú): o rótulo com dois-pontos e o valor na linha de baixo; "de" e "para". */
export const COMPROVANTE_LINHA_DE_BAIXO: readonly LinhaDoComprovante[] = [
  ["Comprovante de pagamento Pix"],
  ["valor:"],
  ["R$ 20,00"],
  ["data e hora do pagamento:"],
  ["16/11/2026 às 16:45"],
  ["de:"],
  [PAGADORA_TRES],
  ["CPF ***.000.000-**"],
  ["para:"],
  ["Associacao Ficticia de Teste"],
  ["identificador:"],
  ["PEDTESTE0105"],
  ["ID da transação:"],
  [E2E_ITAU],
];

/** Um Pix agendado (ainda não pago). */
export const COMPROVANTE_AGENDADO: readonly LinhaDoComprovante[] = [
  ["Comprovante de agendamento Pix"],
  ["Pix agendado"],
  ["Dados de quem pagou"],
  ["Nome", PAGADORA_UM],
  ["Valor", "R$ 20,00"],
  ["Data", "20/11/2026"],
];

/** O comprovante em PDF: o rótulo à esquerda e o valor à direita, uma linha a cada 14 pontos, como os apps. */
export const pdfDeComprovante = (
  linhas: readonly LinhaDoComprovante[],
): Uint8Array<ArrayBuffer> =>
  criarPdf([
    linhas.flatMap(([rotulo, valor], indice): TextoNaPagina[] => {
      const y = 780 - indice * 14;
      return [
        { x: 40, y, texto: rotulo, tamanho: 9, negrito: valor !== undefined },
        ...(valor === undefined
          ? []
          : [{ x: 220, y, texto: valor, tamanho: 9 }]),
      ];
    }),
  ]);

/** O texto do comprovante, como o pdf-linhas monta (o rótulo e o valor na mesma linha, com espaço). */
export const textoDoComprovante = (
  linhas: readonly LinhaDoComprovante[],
): string => linhas.map((linha) => linha.join(" ")).join("\n");

// ---------------------------------------------------------------------------------------------------
// O relatório "Pix recebidos" do Bradesco (RIFA-077; o layout de um PDF real, com dados fictícios)
// ---------------------------------------------------------------------------------------------------

/** Um lançamento do relatório: um bloco vertical, com o nome e o banco quebrados em várias linhas. */
export interface BlocoDePixRecebido {
  /** O dia (o mês sai embaixo, "NOV"): só no primeiro lançamento do dia. */
  dia?: string;
  nome: readonly string[];
  banco: readonly string[];
  e2e: string;
  hora: string;
  entrada?: string;
  saida?: string;
}

export const E2E_PIX_UM = "E00000000202611191411FICTICIO101";
export const E2E_PIX_DOIS = "E11111111202611181741FICTICIO102";
export const E2E_PIX_TRES = "E22222222202611181403FICTICIO103";

/** Três lançamentos: um Pix de R$ 25,00 em 19/11, uma saída e um Pix de R$ 813,26 em 18/11 (sem a data: a de cima). */
export const BLOCOS_PIX_RECEBIDOS: readonly BlocoDePixRecebido[] = [
  {
    dia: "19",
    nome: ["Pagadora Ficticia", "Um da Silva", "Teste"],
    banco: ["ITAÚ", "UNIBANCO", "S.A."],
    e2e: E2E_PIX_UM,
    hora: "11:12:04",
    entrada: "25,00",
  },
  {
    dia: "18",
    nome: ["Empresa", "Ficticia de", "Testes e", "Servicos"],
    banco: ["Banco Bradesco", "S.A."],
    e2e: E2E_PIX_DOIS,
    hora: "14:41:43",
    saida: "2863,28",
  },
  {
    nome: ["Pagador", "Ficticio", "Dois de", "Oliveira", "Santos"],
    banco: ["NU", "PAGAMENTOS", "- IP"],
    e2e: E2E_PIX_TRES,
    hora: "11:03:38",
    entrada: "813,26",
  },
];

/** Os nomes de quem pagou, como devem sair (as linhas juntas, sem o banco). */
export const PAGADORES_PIX_RECEBIDOS = [
  "Pagadora Ficticia Um da Silva Teste",
  "Empresa Ficticia de Testes e Servicos",
  "Pagador Ficticio Dois de Oliveira Santos",
];

/**
 * A página do relatório, nas posições do PDF real (iText): o cabeçalho em duas linhas, e cada bloco com o nome e o
 * banco centrados na linha do meio (o E2E, o horário e o valor), o banco num parágrafo à parte (um vão maior), a data
 * em duas linhas e o "Ver detalhes" à direita.
 */
export function paginaDePixRecebidos(
  blocos: readonly BlocoDePixRecebido[] = BLOCOS_PIX_RECEBIDOS,
): TextoNaPagina[] {
  const textos: TextoNaPagina[] = [
    { x: 45.7, y: 790, texto: "Data", tamanho: 12 },
    { x: 90.5, y: 790, texto: "Referência", tamanho: 12 },
    { x: 177.8, y: 790, texto: "Identificação", tamanho: 12 },
    { x: 403.5, y: 796.9, texto: "Horário", tamanho: 12 },
    { x: 403.5, y: 783.1, texto: "até", tamanho: 12 },
    { x: 449.1, y: 796.9, texto: "Entradas", tamanho: 12 },
    { x: 473.8, y: 783.1, texto: "(R$)", tamanho: 12 },
    { x: 519.3, y: 796.9, texto: "Saídas", tamanho: 12 },
    { x: 530, y: 783.1, texto: "(R$)", tamanho: 12 },
  ];
  const alturaDoBloco = (bloco: BlocoDePixRecebido) =>
    (bloco.nome.length - 1) * 13.8 + 14.9 + (bloco.banco.length - 1) * 13.4;
  let meio = 730;
  blocos.forEach((bloco, indice) => {
    const linhas = [
      ...bloco.nome.map((texto, i) => ({ texto, desce: i * 13.8 })),
      ...bloco.banco.map((texto, i) => ({
        texto,
        desce: (bloco.nome.length - 1) * 13.8 + 14.9 + i * 13.4,
      })),
    ];
    const topo = meio + (linhas.at(-1)?.desce ?? 0) / 2;
    for (const linha of linhas)
      textos.push({
        x: 92,
        y: topo - linha.desce,
        texto: linha.texto,
        tamanho: 12,
      });
    if (bloco.dia) {
      textos.push(
        { x: 47.5, y: meio + 6.7, texto: bloco.dia, tamanho: 13.5 },
        { x: 44.3, y: meio - 8.5, texto: "NOV", tamanho: 9 },
      );
    }
    textos.push(
      { x: 184.5, y: meio, texto: bloco.e2e, tamanho: 12 },
      { x: 403.5, y: meio, texto: bloco.hora, tamanho: 12 },
      { x: 565.6, y: meio + 6.7, texto: "Ver", tamanho: 12 },
      { x: 545, y: meio - 6.7, texto: "detalhes", tamanho: 9 },
    );
    if (bloco.entrada)
      textos.push({
        x: 481.5,
        y: meio,
        texto: bloco.entrada,
        tamanho: 12,
        direita: true,
      });
    if (bloco.saida)
      textos.push({
        x: 537.7,
        y: meio,
        texto: bloco.saida,
        tamanho: 12,
        direita: true,
      });
    // A próxima linha da tabela: metade de cada célula e o espaço entre as linhas (20,6, como no PDF real).
    const proximo = blocos[indice + 1];
    if (proximo)
      meio -= alturaDoBloco(bloco) / 2 + alturaDoBloco(proximo) / 2 + 20.6;
  });
  return textos;
}

/** O relatório "Pix recebidos" em PDF, numa página. */
export const pdfDePixRecebidos = (
  blocos?: readonly BlocoDePixRecebido[],
): Uint8Array<ArrayBuffer> => criarPdf([paginaDePixRecebidos(blocos)]);
