// Leitor do texto colado (RIFA-059, D26), NO NAVEGADOR: a pessoa seleciona a tabela do extrato na tela do banco (ou no
// PDF) e cola numa caixa. Funciona com qualquer banco, linha por linha:
// - a data da linha ("16/11/2026", "16/11/26", "16/11", "2026-11-16", "16 nov 2026", "Hoje"); uma linha só com a data
//   (o cabeçalho do dia, como nos apps) vale para as linhas seguintes que não têm data;
// - a hora, se houver ("10:05", "10h05");
// - o valor no formato brasileiro ("1.234,56", "R$ 20,00", "+ R$ 20,00", "-20,00", "20,00 D", "20,00 C"). Com mais de
//   um valor na linha, vale o primeiro (o último costuma ser o saldo). Numa tabela com cabeçalho e colunas separadas por
//   tabulação (o que o navegador copia de uma tabela), valem as colunas Crédito, Débito ou Valor do cabeçalho;
// - a descrição: o resto da linha, mais as linhas sem valor logo abaixo (o Bradesco põe "REM: <nome>" na linha de baixo
//   do "TRANSFERENCIA PIX").
// Sem sinal, o valor é crédito, a não ser que a descrição diga o contrário ("ENVIADO", "DES:", "DEBITO", "TARIFA"...).
import type {
  ContextoDeLeitura,
  DataLocal,
  ExtratoLido,
  FalhaDoExtrato,
  Lancamento,
} from "./lancamentos";
import { criarRelogio, normalizar } from "./lancamentos";
import {
  acharData,
  acharHora,
  lerValorComSinal,
  limparSinais,
  type DataNoTexto,
  type HoraNoTexto,
} from "./valores";

export const MAXIMO_CARACTERES_TEXTO = 2_000_000;
export const MAXIMO_LINHAS_TEXTO = 20_000;
/** Uma linha sem valor abaixo de um lançamento só entra na descrição dele se for curta (não um rodapé). */
const MAXIMO_CONTINUACAO = 80;

/** Um valor no formato brasileiro, com o sinal (antes ou depois), o "R$" e o C ou D do fim. */
const VALOR =
  /(?<![\p{L}\d_,./])(?:([+-])\s*)?(?:R\$\s*)?(?:([+-])\s*)?(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?![\d,])(-(?!\d))?(?:\s*([CD])(?![\p{L}\d]))?/gu;

interface ValorNoTexto {
  centavos: number;
  /** O sinal estava escrito (+, -, C ou D). */
  explicito: boolean;
  inicio: number;
  fim: number;
}

function acharValores(texto: string): ValorNoTexto[] {
  const valores: ValorNoTexto[] = [];
  for (const achado of texto.matchAll(VALOR)) {
    const [, antes, depoisDoReal, inteiro, fracao, menosNoFim, letra] = achado;
    const centavos = Number(inteiro.replaceAll(".", "")) * 100 + Number(fracao);
    if (!Number.isSafeInteger(centavos)) continue;
    const negativo =
      antes === "-" ||
      depoisDoReal === "-" ||
      menosNoFim === "-" ||
      letra === "D";
    valores.push({
      centavos: negativo ? -centavos : centavos,
      explicito: Boolean(antes || depoisDoReal || menosNoFim || letra),
      inicio: achado.index,
      fim: achado.index + achado[0].length,
    });
  }
  return valores;
}

/** As colunas de valor de uma tabela colada, achadas no cabeçalho (células separadas por tabulação). */
interface ColunasDaTabela {
  credito?: number;
  debito?: number;
  valor?: number;
  saldo?: number;
}

const ehColunaDeValor = (colunas: ColunasDaTabela, indice: number) =>
  [colunas.credito, colunas.debito, colunas.valor, colunas.saldo].includes(
    indice,
  );

function colunasDoCabecalho(celulas: string[]): ColunasDaTabela | null {
  if (celulas.length < 3) return null;
  const nomes = celulas.map((celula) => normalizar(celula));
  const indice = (palavra: string) => {
    const achado = nomes.findIndex((nome) =>
      new RegExp(`\\b${palavra}`).test(nome),
    );
    return achado < 0 ? undefined : achado;
  };
  const colunas: ColunasDaTabela = {
    credito: indice("CREDITO") ?? indice("ENTRADA"),
    debito: indice("DEBITO") ?? indice("SAIDA"),
    valor: indice("VALOR"),
    saldo: indice("SALDO"),
  };
  const temData = indice("DATA") !== undefined;
  const temValor =
    (colunas.credito !== undefined && colunas.debito !== undefined) ||
    colunas.valor !== undefined;
  return temData && temValor && acharValores(celulas.join("\t")).length === 0
    ? colunas
    : null;
}

const PALAVRAS_DE_CREDITO = /RECEBID|\bREM\b|\bCREDITO\b|\bDEPOSITO\b/;
const PALAVRAS_DE_DEBITO =
  /ENVIAD|\bDES\b|\bDEBITO\b|\bSAQUE\b|\bTARIFA\b|\bPAGTO\b|\bCOMPRA\b/;
/** O que sobra numa linha que é só a data (o cabeçalho do dia): dia da semana, "feira", pontuação. */
const SO_DATA =
  /^(?:SEGUNDA|TERCA|QUARTA|QUINTA|SEXTA|SABADO|DOMINGO|FEIRA|SEG|TER|QUA|QUI|SEX|SAB|DOM|[\s,.\-–|·:])*$/;

interface Trecho {
  inicio: number;
  fim: number;
}

/** O texto com o trecho trocado por espaços (as posições do resto não mudam). */
const apagar = (texto: string, trecho: Trecho) =>
  texto.slice(0, trecho.inicio) +
  " ".repeat(trecho.fim - trecho.inicio) +
  texto.slice(trecho.fim);

/** O texto sem os trechos (data, hora, valores), com os espaços e os separadores das pontas limpos. */
function semTrechos(texto: string, trechos: readonly Trecho[]): string {
  let resultado = "";
  let posicao = 0;
  for (const trecho of [...trechos].sort((a, b) => a.inicio - b.inicio)) {
    if (trecho.inicio < posicao) continue;
    resultado += `${texto.slice(posicao, trecho.inicio)} `;
    posicao = trecho.fim;
  }
  resultado += texto.slice(posicao);
  return resultado
    .replace(/R\$/g, " ")
    .replace(/[\t\s]+/g, " ")
    .replace(/^[\s\-–|·:;,]+|[\s\-–|·:;,]+$/g, "")
    .trim();
}

interface Rascunho {
  ordem: number;
  data: DataLocal;
  hora: HoraNoTexto | null;
  centavos: number;
  explicito: boolean;
  partes: string[];
}

const dataLocal = (data: DataNoTexto): DataLocal => ({
  ano: data.ano,
  mes: data.mes,
  dia: data.dia,
});

/** O valor da linha pelas colunas da tabela (null se as células não batem com o cabeçalho ou estão vazias). */
function valorPelasColunas(
  celulas: string[],
  colunas: ColunasDaTabela,
): ValorNoTexto | null {
  const usadas = [colunas.credito, colunas.debito, colunas.valor].filter(
    (i): i is number => i !== undefined,
  );
  if (celulas.length <= Math.max(...usadas)) return null;
  const ler = (indice: number | undefined) =>
    indice === undefined ? null : lerValorComSinal(celulas[indice]);
  const credito = ler(colunas.credito);
  const debito = ler(colunas.debito);
  const centavos =
    credito !== null && credito !== 0
      ? Math.abs(credito)
      : debito !== null && debito !== 0
        ? -Math.abs(debito)
        : ler(colunas.valor);
  return centavos === null
    ? null
    : {
        centavos,
        explicito: credito !== null || debito !== null,
        inicio: 0,
        fim: 0,
      };
}

/** Lê os lançamentos do texto colado. */
export function lerTextoColado(
  texto: string,
  contexto: ContextoDeLeitura,
): ExtratoLido | FalhaDoExtrato {
  if (texto.length > MAXIMO_CARACTERES_TEXTO)
    return {
      ok: false,
      titulo: "O texto é grande demais",
      mensagem:
        "Cole um período menor do extrato (por exemplo, a última semana).",
    };
  const linhas = limparSinais(texto).split(/\r\n|\r|\n/);
  if (linhas.length > MAXIMO_LINHAS_TEXTO)
    return {
      ok: false,
      titulo: "O texto tem linhas demais",
      mensagem: `O limite é de ${MAXIMO_LINHAS_TEXTO.toLocaleString("pt-BR")} linhas. Cole um período menor do extrato.`,
    };
  const relogio = criarRelogio(contexto);
  const rascunhos: Rascunho[] = [];
  let ilegiveis = 0;
  let dataAtual: DataLocal | null = null;
  let colunas: ColunasDaTabela | null = null;
  let pendente: Rascunho | null = null;

  for (const linha of linhas) {
    if (linha.trim() === "") {
      pendente = null;
      continue;
    }
    const celulas = linha.split("\t");
    const cabecalho = colunasDoCabecalho(celulas);
    if (cabecalho) {
      colunas = cabecalho;
      pendente = null;
      continue;
    }
    const data = acharData(linha, relogio.hoje);
    // A hora, procurada com a data apagada (do mesmo tamanho, para as posições continuarem as da linha).
    const hora = acharHora(data ? apagar(linha, data) : linha);
    const valores = acharValores(linha);
    const tabela = colunas !== null && celulas.length > 1 ? colunas : null;
    const valor = tabela
      ? valorPelasColunas(celulas, tabela)
      : (valores[0] ?? null);

    if (valor === null) {
      // Sem valor: a data sozinha (o cabeçalho do dia) ou o complemento da linha de cima ("REM: <nome>").
      if (data && SO_DATA.test(normalizar(semTrechos(linha, [data])))) {
        dataAtual = dataLocal(data);
        pendente = null;
      } else if (
        pendente &&
        linha.trim().length <= MAXIMO_CONTINUACAO &&
        !/\bSALDO\b/.test(normalizar(linha))
      ) {
        pendente.partes.push(semTrechos(linha, []));
      }
      continue;
    }
    if (data) dataAtual = dataLocal(data);
    if (dataAtual === null) {
      ilegiveis++;
      pendente = null;
      continue;
    }
    // A descrição: na tabela, as células que não são de valor; fora dela, a linha sem os valores. Nos dois, sem a data
    // e a hora.
    const fonte = tabela
      ? celulas
          .map((celula, indice) =>
            ehColunaDeValor(tabela, indice) ? "" : celula,
          )
          .join("\t")
      : linha;
    const dataNaFonte = tabela ? acharData(fonte, relogio.hoje) : data;
    const horaNaFonte = tabela
      ? acharHora(dataNaFonte ? apagar(fonte, dataNaFonte) : fonte)
      : hora;
    const trechos: Trecho[] = [dataNaFonte, horaNaFonte].filter(
      (trecho) => trecho !== null,
    );
    const descricao = semTrechos(
      fonte,
      tabela ? trechos : [...trechos, ...valores],
    );
    pendente = {
      ordem: rascunhos.length + 1,
      data: dataAtual,
      hora,
      centavos: valor.centavos,
      explicito: valor.explicito,
      partes: [descricao],
    };
    rascunhos.push(pendente);
  }

  const lancamentos: Lancamento[] = [];
  for (const rascunho of rascunhos) {
    const descricao = rascunho.partes
      .filter((parte) => parte !== "")
      .join(" · ");
    const local = relogio.local(
      rascunho.data.ano,
      rascunho.data.mes,
      rascunho.data.dia,
      rascunho.hora ?? undefined,
    );
    if (local === null) {
      ilegiveis++;
      continue;
    }
    let centavos = rascunho.centavos;
    if (!rascunho.explicito) {
      const palavras = normalizar(descricao);
      if (
        !PALAVRAS_DE_CREDITO.test(palavras) &&
        PALAVRAS_DE_DEBITO.test(palavras)
      )
        centavos = -Math.abs(centavos);
    }
    lancamentos.push({
      ordem: rascunho.ordem,
      dia: local.dia,
      instante: local.instante,
      centavos,
      descricao: descricao || "(sem descrição)",
      identificadores: [],
    });
  }
  if (lancamentos.length === 0 && ilegiveis === 0)
    return {
      ok: false,
      titulo: "Não achamos lançamentos no texto",
      mensagem:
        "Cada linha precisa ter a data (ou estar abaixo de uma linha com a data) e o valor, como 16/11/2026 PIX RECEBIDO R$ 20,00. Copie a tabela do extrato inteira e cole de novo.",
    };
  return {
    ok: true,
    formato: "texto",
    lancamentos,
    ilegiveis,
    semHora: lancamentos.every((item) => item.instante === null),
  };
}
