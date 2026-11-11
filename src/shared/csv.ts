/**
 * Leitor de CSV próprio, sem dependências (e sem zod: vale no Worker e no navegador): RFC 4180 com as
 * tolerâncias que arquivos de planilha (Google Planilhas, Excel, LibreOffice) exigem. Usado pela importação
 * da hierarquia (src/worker/lib/csv.ts, que reexporta daqui) e pela conferência pelo CSV da Rifei, que lê
 * o arquivo no navegador (src/shared/conferencia).
 *
 * - Separador "," ou ";", detectado na primeira linha com conteúdo (o cabeçalho): vence o que aparece
 *   mais vezes fora de aspas; no empate, ",". O Excel em português grava com ";".
 * - Campo entre aspas pode ter o separador, quebras de linha e aspas escapadas (""). Espaços antes da
 *   aspa de abertura são ignorados; o que vier depois da aspa de fechamento entra no campo.
 * - BOM UTF-8 no início é descartado. Fim de linha CRLF, LF ou CR (dentro de aspas, vira LF).
 * - Linhas em branco (só espaços e separadores) são descartadas, mas contam na numeração: `linha` é a
 *   linha da planilha, a partir de 1. Uma quebra de linha dentro de aspas não abre linha nova.
 */

export type SeparadorCsv = "," | ";";

export interface RegistroCsv {
  /** Linha da planilha, a partir de 1. */
  linha: number;
  campos: string[];
}

export type LeituraCsv =
  | {
      ok: true;
      separador: SeparadorCsv;
      registros: RegistroCsv[];
      /** Só com `maximoRegistros`: o arquivo tem mais registros e a leitura parou no limite. */
      cortado?: true;
    }
  | { ok: false; linha: number; mensagem: string };

export interface OpcoesLerCsv {
  /**
   * Para de ler depois de tantos registros (linhas com conteúdo, o cabeçalho incluído) e marca `cortado`:
   * um arquivo de milhões de linhas não é lido inteiro só para ser recusado pelo limite.
   */
  maximoRegistros?: number;
}

const BOM = "\uFEFF";
const ASPAS = '"';

/** Separador do arquivo: o mais frequente, fora de aspas, na primeira linha com conteúdo. */
export function detectarSeparador(texto: string): SeparadorCsv {
  const contagem = { ",": 0, ";": 0 };
  let entreAspas = false;
  let temConteudo = false;
  for (const caractere of texto) {
    if (caractere === ASPAS) {
      entreAspas = !entreAspas;
      temConteudo = true;
    } else if (entreAspas) {
      // separador entre aspas não conta
    } else if (caractere === "\n" || caractere === "\r") {
      if (temConteudo) break;
    } else {
      if (caractere === "," || caractere === ";") contagem[caractere]++;
      if (caractere.trim() !== "") temConteudo = true;
    }
  }
  return contagem[";"] > contagem[","] ? ";" : ",";
}

/** Lê o arquivo inteiro em registros (linhas não vazias, com o número da linha). */
export function lerCsv(texto: string, opcoes: OpcoesLerCsv = {}): LeituraCsv {
  const maximo = opcoes.maximoRegistros ?? Number.POSITIVE_INFINITY;
  const conteudo = texto.startsWith(BOM) ? texto.slice(BOM.length) : texto;
  const separador = detectarSeparador(conteudo);
  const registros: RegistroCsv[] = [];
  let campos: string[] = [];
  let campo = "";
  let linha = 1;
  let citado = false;
  let entreAspas = false;
  let linhaDasAspas = 0;

  const fecharCampo = () => {
    campos.push(campo);
    campo = "";
    citado = false;
  };
  const fecharRegistro = () => {
    fecharCampo();
    if (campos.some((valor) => valor.trim() !== ""))
      registros.push({ linha, campos });
    campos = [];
    linha++;
  };

  for (let i = 0; i < conteudo.length; i++) {
    const caractere = conteudo[i];
    const proximo = conteudo[i + 1];
    if (entreAspas) {
      if (caractere === ASPAS && proximo === ASPAS) {
        campo += ASPAS;
        i++;
      } else if (caractere === ASPAS) {
        entreAspas = false;
      } else if (caractere === "\r") {
        campo += "\n";
        if (proximo === "\n") i++;
      } else {
        campo += caractere;
      }
    } else if (caractere === ASPAS && !citado && campo.trim() === "") {
      entreAspas = true;
      citado = true;
      campo = "";
      linhaDasAspas = linha;
    } else if (caractere === separador) {
      fecharCampo();
    } else if (caractere === "\n" || caractere === "\r") {
      if (caractere === "\r" && proximo === "\n") i++;
      fecharRegistro();
      if (registros.length > maximo)
        return {
          ok: true,
          separador,
          registros: registros.slice(0, maximo),
          cortado: true,
        };
    } else {
      campo += caractere;
    }
  }

  if (entreAspas)
    return {
      ok: false,
      linha: linhaDasAspas,
      mensagem: `As aspas abertas na linha ${linhaDasAspas} não foram fechadas`,
    };
  if (campo !== "" || citado || campos.length > 0) fecharRegistro();
  return { ok: true, separador, registros };
}

/** Nome de coluna para comparação: sem espaços nas pontas, sem acentos e em minúsculas. */
export function normalizarNomeDeColuna(nome: string): string {
  return nome.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

/** Texto do cabeçalho para citar numa mensagem: espaços normalizados e no máximo 40 caracteres. */
export function resumirNomeDeColuna(nome: string): string {
  const limpo = nome.replace(/\s+/g, " ").trim();
  return limpo.length > 40 ? `${limpo.slice(0, 39)}…` : limpo;
}
