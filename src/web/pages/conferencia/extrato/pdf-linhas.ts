// As linhas do extrato em PDF (RIFA-068, D26), montadas NO NAVEGADOR a partir dos pedaços de texto que o pdf.js tira
// de cada página, com a posição de cada um. O resultado é o mesmo texto que a pessoa colaria na caixa, e vai para o
// mesmo leitor (texto-colado.ts):
// - o y agrupa a linha (com uma tolerância pelo tamanho da letra) e o x ordena os pedaços dentro dela;
// - pedaços colados (a mesma palavra quebrada em dois) se juntam sem espaço; os próximos, com um espaço; um vão
//   maior que a letra separa as colunas;
// - achado o cabeçalho da tabela (a mesma regra do texto colado: Data e Crédito e Débito, ou Valor), cada linha
//   seguinte vira as células do cabeçalho, separadas por tabulação, com as vazias no lugar (o que o navegador copia de
//   uma tabela). Assim o valor da coluna Débito é débito mesmo sem o sinal, e o saldo nunca é lido como o valor.
//   Sem cabeçalho, a linha é o texto, com espaços;
// - um vão vertical grande (o rodapé, outro bloco) e a troca de página viram uma linha em branco, que encerra o
//   lançamento de cima (o "REM: <nome>" do Bradesco só entra na descrição quando vem logo abaixo).
// O relatório "Pix recebidos" do Bradesco (RIFA-077), em blocos verticais, sai pelo pix-recebidos.ts.
// Módulo puro (sem o pdf.js), testado com pedaços sintéticos em pdf-linhas.test.ts.
import { textoDosPixRecebidos } from "./pix-recebidos";
import { colunasDoCabecalho } from "./texto-colado";

/** Um pedaço de texto da página, como o pdf.js entrega (TextItem), no sistema do PDF (o y cresce para cima). */
export interface TextoDoPdf {
  texto: string;
  /** A esquerda e a linha de base, em pontos. */
  x: number;
  y: number;
  largura: number;
  /** A altura da letra (o tamanho da fonte), para as tolerâncias. */
  altura: number;
}

/** A diferença de linha de base que ainda é a mesma linha, em alturas da letra. */
const MESMA_LINHA = 0.4;
/** Até este vão (em alturas da letra) os pedaços são a mesma palavra; até MESMA_CELULA, a mesma célula. */
const MESMA_PALAVRA = 0.12;
const MESMA_CELULA = 1;
/** Um vão vertical maior que isto (em alturas da letra) separa os blocos: vira uma linha em branco. */
const NOVO_BLOCO = 2.5;
/** A altura usada quando o PDF não diz (pedaço sem altura). */
const ALTURA_PADRAO = 10;

/** Um trecho contínuo da linha: as palavras próximas juntas. */
interface Trecho {
  texto: string;
  inicio: number;
  fim: number;
}

interface Linha {
  y: number;
  altura: number;
  trechos: Trecho[];
}

const alturaDe = (pedaco: TextoDoPdf) =>
  pedaco.altura > 0 ? pedaco.altura : ALTURA_PADRAO;

/** As linhas da página, de cima para baixo, cada uma com os trechos da esquerda para a direita. */
function linhasDaPagina(pedacos: readonly TextoDoPdf[]): Linha[] {
  const validos = pedacos
    .filter(
      (pedaco) =>
        pedaco.texto.trim() !== "" &&
        Number.isFinite(pedaco.x) &&
        Number.isFinite(pedaco.y),
    )
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const grupos: { y: number; altura: number; pedacos: TextoDoPdf[] }[] = [];
  for (const pedaco of validos) {
    const ultimo = grupos.at(-1);
    const altura = alturaDe(pedaco);
    if (
      ultimo &&
      ultimo.y - pedaco.y <= Math.max(ultimo.altura, altura) * MESMA_LINHA
    ) {
      ultimo.pedacos.push(pedaco);
      ultimo.altura = Math.max(ultimo.altura, altura);
    } else grupos.push({ y: pedaco.y, altura, pedacos: [pedaco] });
  }
  return grupos.map((grupo) => ({
    y: grupo.y,
    altura: grupo.altura,
    trechos: trechosDaLinha(grupo.pedacos),
  }));
}

function trechosDaLinha(pedacos: TextoDoPdf[]): Trecho[] {
  const trechos: Trecho[] = [];
  let anterior: TextoDoPdf | null = null;
  for (const pedaco of [...pedacos].sort((a, b) => a.x - b.x)) {
    const texto = pedaco.texto.replace(/\s+/g, " ");
    const fim = pedaco.x + Math.max(0, pedaco.largura);
    const atual = trechos.at(-1);
    if (atual && anterior) {
      const vao = pedaco.x - atual.fim;
      const altura = Math.max(alturaDe(anterior), alturaDe(pedaco));
      if (vao <= altura * MESMA_CELULA) {
        const junto = vao <= altura * MESMA_PALAVRA;
        atual.texto = junto
          ? `${atual.texto}${texto}`
          : `${atual.texto.trimEnd()} ${texto.trimStart()}`;
        atual.fim = Math.max(atual.fim, fim);
        anterior = pedaco;
        continue;
      }
    }
    trechos.push({ texto, inicio: pedaco.x, fim });
    anterior = pedaco;
  }
  return trechos
    .map((trecho) => ({ ...trecho, texto: trecho.texto.trim() }))
    .filter((trecho) => trecho.texto !== "");
}

/** A coluna do cabeçalho em que o trecho cai: a de maior sobreposição (sem nenhuma, a mais próxima). */
function colunaDoTrecho(trecho: Trecho, colunas: readonly Trecho[]): number {
  let melhor = 0;
  let melhorSobreposicao = -Infinity;
  colunas.forEach((coluna, indice) => {
    // Negativa quando não se tocam: menos a distância entre os dois.
    const sobreposicao =
      Math.min(trecho.fim, coluna.fim) - Math.max(trecho.inicio, coluna.inicio);
    if (sobreposicao > melhorSobreposicao) {
      melhor = indice;
      melhorSobreposicao = sobreposicao;
    }
  });
  return melhor;
}

/** A linha nas células do cabeçalho, separadas por tabulação (as vazias no lugar). */
function celulas(linha: Linha, colunas: readonly Trecho[]): string {
  const textos: string[] = colunas.map(() => "");
  for (const trecho of linha.trechos) {
    const indice = colunaDoTrecho(trecho, colunas);
    textos[indice] = textos[indice]
      ? `${textos[indice]} ${trecho.texto}`
      : trecho.texto;
  }
  return textos.join("\t");
}

const ehCabecalho = (linha: Linha) =>
  linha.trechos.length >= 3 &&
  colunasDoCabecalho(linha.trechos.map((trecho) => trecho.texto)) !== null;

/**
 * O texto do extrato a partir dos pedaços de cada página, uma linha do extrato por linha do texto, pronto para o
 * leitor do texto colado. As colunas do cabeçalho valem até o próximo cabeçalho (a página sem cabeçalho usa o da
 * anterior).
 */
export function textoDasPaginas(
  paginas: readonly (readonly TextoDoPdf[])[],
): string {
  // O relatório "Pix recebidos" do Bradesco (RIFA-077): blocos verticais, lidos pelas posições (pix-recebidos.ts).
  const pixRecebidos = textoDosPixRecebidos(paginas);
  if (pixRecebidos !== null) return pixRecebidos;
  const saida: string[] = [];
  let colunas: Trecho[] | null = null;
  for (const pedacos of paginas) {
    const linhas = linhasDaPagina(pedacos);
    // Na página com o cabeçalho, as linhas de cima dele (o título, a agência, o período) ficam fora da tabela.
    if (linhas.some(ehCabecalho)) colunas = null;
    if (saida.length > 0) saida.push("");
    let anterior: Linha | null = null;
    for (const linha of linhas) {
      if (
        anterior &&
        anterior.y - linha.y >
          Math.max(anterior.altura, linha.altura) * NOVO_BLOCO
      )
        saida.push("");
      anterior = linha;
      if (ehCabecalho(linha)) {
        colunas = linha.trechos;
        saida.push(linha.trechos.map((trecho) => trecho.texto).join("\t"));
        continue;
      }
      saida.push(
        colunas
          ? celulas(linha, colunas)
          : linha.trechos.map((trecho) => trecho.texto).join(" "),
      );
    }
  }
  return saida.join("\n");
}

/** Se alguma página tem texto (sem nenhum, o PDF é uma imagem: escaneado ou fotografado). */
export function temTexto(paginas: readonly (readonly TextoDoPdf[])[]): boolean {
  return paginas.some((pedacos) =>
    pedacos.some((pedaco) => pedaco.texto.trim() !== ""),
  );
}
