// Vários arquivos de uma vez (RIFA-074, D34), NO NAVEGADOR: extratos e comprovantes de Pix misturados viram um
// extrato só, para o mesmo cruzamento. O mesmo Pix em dois arquivos conta uma vez:
// - o mesmo ID da transação (o E2E do comprovante) é o mesmo Pix; IDs diferentes, Pix diferentes;
// - senão, o mesmo valor, a mesma hora (até 2 minutos de diferença; sem a hora num deles, o mesmo dia) e o mesmo nome
//   de quem pagou (o nome do comprovante na descrição do extrato, o "REM: <nome>"). Sem o nome num dos lados, só com a
//   hora dos dois a menos de 2 minutos;
// - dois extratos (períodos que se cruzam): o mesmo valor, o mesmo dia e hora e a mesma descrição.
// Os Pix de um mesmo arquivo nunca se juntam entre si (o extrato é a fonte; dois Pix iguais podem ser dois Pix).
// Quando o comprovante e o extrato são o mesmo Pix, fica o lançamento do extrato (o banco confirma), com o
// identificador e o nome do comprovante: o identificador ainda dá o "Certo".
import { normalizar, type ExtratoLido, type Lancamento } from "./lancamentos";

/** A diferença de hora que ainda é o mesmo Pix (o comprovante e o extrato podem diferir de um minuto). */
export const FOLGA_DO_MESMO_PIX_MS = 2 * 60_000;

/** Um arquivo lido, com o extrato (ou o comprovante) dele. */
export interface ParteLida {
  extrato: ExtratoLido;
}

export interface Juntado {
  extrato: ExtratoLido;
  /** Por arquivo, na ordem: quantos lançamentos já estavam num arquivo anterior. */
  repetidos: number[];
}

/** As palavras do nome (sem acento, maiúsculas, 2 letras ou mais, sem "DE", "DA", "DOS"...). */
function palavrasDoNome(nome: string): string[] {
  return normalizar(nome)
    .split(/[^A-Z]+/)
    .filter(
      (palavra) =>
        palavra.length >= 2 && !/^(?:DE|DA|DO|DAS|DOS|E)$/.test(palavra),
    );
}

/** O nome de quem pagou no comprovante aparece na descrição (o primeiro nome e, se houver, o último). */
function nomeNaDescricao(pagador: string, descricao: string): boolean {
  const palavras = palavrasDoNome(pagador);
  if (palavras.length === 0) return false;
  const texto = ` ${normalizar(descricao).replace(/[^A-Z]+/g, " ")} `;
  const tem = (palavra: string) => texto.includes(` ${palavra} `);
  return (
    tem(palavras[0]) &&
    (palavras.length === 1 || tem(palavras.at(-1) as string))
  );
}

/** A descrição traz algum nome (letras além das palavras do banco)? */
function descricaoTemNome(descricao: string): boolean {
  return palavrasDoNome(descricao).some(
    (palavra) =>
      palavra.length >= 3 &&
      !/^(?:PIX|TRANSFERENCIA|TRANSF|RECEBIDO|RECEBIDA|REM|DES|CREDITO|QR|CODE|CHAVE|TED|DOC|CC|PJ|PF|CONTA|SALDO|INTERNET|APP|CELULAR|EMPRESA)$/.test(
        palavra,
      ),
  );
}

const nomeDe = (lancamento: Lancamento): string | null =>
  lancamento.pagador ?? null;

/** O mesmo Pix em dois arquivos diferentes? */
export function mesmoPix(a: Lancamento, b: Lancamento): boolean {
  if (a.centavos !== b.centavos || a.centavos === 0) return false;
  if (a.idDaTransacao && b.idDaTransacao)
    return a.idDaTransacao === b.idDaTransacao;
  const comHora = a.instante !== null && b.instante !== null;
  if (comHora) {
    if (
      Math.abs((a.instante as number) - (b.instante as number)) >
      FOLGA_DO_MESMO_PIX_MS
    )
      return false;
  } else if (a.dia !== b.dia) return false;
  const comprovanteA = a.origem === "comprovante";
  const comprovanteB = b.origem === "comprovante";
  // Dois extratos: a mesma linha (a mesma hora e a mesma descrição).
  if (!comprovanteA && !comprovanteB)
    return (
      a.instante === b.instante &&
      normalizar(a.descricao).replace(/\s+/g, " ").trim() ===
        normalizar(b.descricao).replace(/\s+/g, " ").trim()
    );
  const nomeA = nomeDe(a);
  const nomeB = nomeDe(b);
  // Dois comprovantes: o mesmo nome (ou, sem nome, a mesma hora).
  if (comprovanteA && comprovanteB) {
    if (nomeA && nomeB)
      return (
        palavrasDoNome(nomeA).join(" ") === palavrasDoNome(nomeB).join(" ")
      );
    return comHora;
  }
  // O comprovante e o extrato: o nome do comprovante na descrição do extrato; sem nome num dos lados, a hora.
  const [comprovante, doExtrato] = comprovanteA ? [a, b] : [b, a];
  const nome = nomeDe(comprovante);
  if (nome && descricaoTemNome(doExtrato.descricao))
    return nomeNaDescricao(nome, doExtrato.descricao);
  return comHora;
}

/** Junta o comprovante ao lançamento do extrato (ou ao outro comprovante) que é o mesmo Pix. */
function juntarDois(base: Lancamento, outro: Lancamento): Lancamento {
  const [doExtrato, extra] =
    base.origem === "comprovante" && outro.origem !== "comprovante"
      ? [outro, base]
      : [base, outro];
  const juntado: Lancamento = {
    ...doExtrato,
    identificadores: [
      ...new Set([...doExtrato.identificadores, ...extra.identificadores]),
    ],
  };
  const pagador = doExtrato.pagador ?? extra.pagador;
  const idDaTransacao = doExtrato.idDaTransacao ?? extra.idDaTransacao;
  const txid = doExtrato.txid ?? extra.txid;
  if (pagador) juntado.pagador = pagador;
  if (idDaTransacao) juntado.idDaTransacao = idDaTransacao;
  if (txid) juntado.txid = txid;
  return juntado;
}

/** Os arquivos lidos num extrato só, sem contar duas vezes o mesmo Pix. */
export function juntarArquivos(partes: readonly ParteLida[]): Juntado {
  const lancamentos: Lancamento[] = [];
  /** De que arquivo veio cada lançamento juntado (os de um mesmo arquivo não se juntam). */
  const arquivoDe: number[] = [];
  const repetidos: number[] = [];
  partes.forEach((parte, arquivo) => {
    let repetidosAqui = 0;
    const usados = new Set<number>();
    for (const lancamento of parte.extrato.lancamentos) {
      const indice = lancamentos.findIndex(
        (outro, posicao) =>
          arquivoDe[posicao] !== arquivo &&
          !usados.has(posicao) &&
          mesmoPix(outro, lancamento),
      );
      if (indice >= 0) {
        lancamentos[indice] = juntarDois(lancamentos[indice], lancamento);
        usados.add(indice);
        repetidosAqui++;
        continue;
      }
      lancamentos.push(lancamento);
      arquivoDe.push(arquivo);
    }
    repetidos.push(repetidosAqui);
  });
  return {
    extrato: {
      ok: true,
      formato: partes.length === 1 ? partes[0].extrato.formato : "varios",
      lancamentos: lancamentos.map((lancamento, indice) => ({
        ...lancamento,
        ordem: indice + 1,
      })),
      ilegiveis: partes.reduce(
        (soma, parte) => soma + parte.extrato.ilegiveis,
        0,
      ),
      semHora: partes.some(
        (parte) =>
          parte.extrato.semHora && parte.extrato.formato !== "comprovante",
      ),
    },
    repetidos,
  };
}
