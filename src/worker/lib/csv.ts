/**
 * Leitor de CSV próprio, sem dependências: RFC 4180 com as tolerâncias que arquivos de planilha
 * (Google Planilhas, Excel, LibreOffice) exigem.
 *
 * - Separador "," ou ";", detectado na primeira linha com conteúdo (o cabeçalho): vence o que aparece
 *   mais vezes fora de aspas; no empate, ",". O Excel em português grava com ";".
 * - Campo entre aspas pode ter o separador, quebras de linha e aspas escapadas (""). Espaços antes da
 *   aspa de abertura são ignorados; o que vier depois da aspa de fechamento entra no campo.
 * - BOM UTF-8 no início é descartado. Fim de linha CRLF, LF ou CR (dentro de aspas, vira LF).
 * - Linhas em branco (só espaços e separadores) são descartadas, mas contam na numeração: `linha` é a
 *   linha da planilha, a partir de 1. Uma quebra de linha dentro de aspas não abre linha nova.
 */
import type { z } from "zod";

export type SeparadorCsv = "," | ";";

export interface RegistroCsv {
  /** Linha da planilha, a partir de 1. */
  linha: number;
  campos: string[];
}

export type LeituraCsv =
  | { ok: true; separador: SeparadorCsv; registros: RegistroCsv[] }
  | { ok: false; linha: number; mensagem: string };

const BOM = "\uFEFF";
const ASPAS = '"';
/** O que o decodificador põe no lugar de bytes que não são UTF-8 (ex.: arquivo salvo em Windows-1252). */
const CARACTERE_INVALIDO = "\uFFFD";

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
export function lerCsv(texto: string): LeituraCsv {
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

// ---------------------------------------------------------------------------------------------------
// Tabela com cabeçalho
// ---------------------------------------------------------------------------------------------------

export interface OpcoesTabelaCsv<C extends string> {
  /** Colunas conhecidas (nomes sem acento, em minúsculas). As demais são ignoradas. */
  colunas: readonly C[];
  obrigatorias: readonly C[];
  /** Máximo de linhas de dados (sem contar o cabeçalho e as linhas em branco). */
  limiteLinhas: number;
}

export interface LinhaTabelaCsv<C extends string> {
  linha: number;
  /** Só as colunas conhecidas do cabeçalho. Campo que falta no fim da linha vem vazio (""). */
  valores: Partial<Record<C, string>>;
}

export type TabelaCsv<C extends string> =
  | { ok: true; colunas: ReadonlySet<C>; linhas: LinhaTabelaCsv<C>[] }
  /** `detalhes`: as colunas obrigatórias que faltam no cabeçalho, quando é esse o problema. */
  | { ok: false; mensagem: string; detalhes?: C[] };

/** Nome de coluna para comparação: sem espaços nas pontas, sem acentos e em minúsculas. */
export function normalizarNomeDeColuna(nome: string): string {
  return nome.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

/**
 * Lê um CSV cuja primeira linha com conteúdo é o cabeçalho e devolve as linhas de dados com as colunas
 * conhecidas. Falha (para a API, `csv_invalido`) quando o arquivo não tem cabeçalho, tem aspas abertas,
 * não está em UTF-8, repete uma coluna conhecida, não tem uma coluna obrigatória ou passa do limite.
 */
export function lerTabelaCsv<C extends string>(
  texto: string,
  opcoes: OpcoesTabelaCsv<C>,
): TabelaCsv<C> {
  const leitura = lerCsv(texto);
  if (!leitura.ok) return { ok: false, mensagem: leitura.mensagem };
  const [cabecalho, ...dados] = leitura.registros;
  if (!cabecalho)
    return {
      ok: false,
      mensagem:
        "O arquivo está vazio: a primeira linha precisa ser o cabeçalho com os nomes das colunas",
    };

  const comCaractereInvalido = leitura.registros.find((registro) =>
    registro.campos.some((valor) => valor.includes(CARACTERE_INVALIDO)),
  );
  if (comCaractereInvalido)
    return {
      ok: false,
      mensagem: `O arquivo não está em UTF-8 (caractere inválido na linha ${comCaractereInvalido.linha}). No Excel, salve como "CSV UTF-8"; no Google Planilhas, use Arquivo > Fazer download > CSV.`,
    };

  const indices = new Map<C, number>();
  for (const [indice, nome] of cabecalho.campos.entries()) {
    const normalizado = normalizarNomeDeColuna(nome);
    const coluna = opcoes.colunas.find(
      (conhecida) => conhecida === normalizado,
    );
    if (coluna === undefined) continue;
    if (indices.has(coluna))
      return {
        ok: false,
        mensagem: `A coluna "${coluna}" aparece mais de uma vez no cabeçalho`,
      };
    indices.set(coluna, indice);
  }

  const faltando = opcoes.obrigatorias.filter((coluna) => !indices.has(coluna));
  if (faltando.length > 0)
    return {
      ok: false,
      mensagem: `Faltam colunas obrigatórias no cabeçalho (linha ${cabecalho.linha}): ${faltando.join(", ")}`,
      detalhes: faltando,
    };

  if (dados.length > opcoes.limiteLinhas)
    return {
      ok: false,
      mensagem: `O arquivo tem ${dados.length} linhas de dados; o limite é ${opcoes.limiteLinhas}. Divida em mais de um arquivo.`,
    };

  const colunas = [...indices];
  return {
    ok: true,
    colunas: new Set(indices.keys()),
    linhas: dados.map((registro) => {
      const valores: Partial<Record<C, string>> = {};
      for (const [coluna, indice] of colunas)
        valores[coluna] = registro.campos[indice] ?? "";
      return { linha: registro.linha, valores };
    }),
  };
}

/**
 * Mensagens em português para os problemas de validação de uma célula da planilha, usadas como mapa de
 * erros por chamada (`schema.safeParse(valor, { error: mensagemDeCelula })`). A mensagem definida no
 * próprio schema (ex.: "Use um número inteiro") continua valendo: o zod dá prioridade a ela.
 */
export const mensagemDeCelula: z.core.$ZodErrorMap = (problema) => {
  switch (problema.code) {
    case "invalid_type":
      return problema.input === null || problema.input === undefined
        ? "Preencha esta coluna"
        : "Valor inválido";
    case "invalid_value":
      return `Use ${problema.values.map((valor) => `"${String(valor)}"`).join(" ou ")}`;
    case "invalid_format":
      return problema.format === "email"
        ? "E-mail inválido"
        : "Formato inválido";
    case "too_big":
      return problema.origin === "string"
        ? `Use no máximo ${problema.maximum} caracteres`
        : `Use um número até ${problema.maximum}`;
    case "too_small":
      return problema.origin === "string"
        ? "Preencha esta coluna"
        : `Use um número a partir de ${problema.minimum}`;
    default:
      return "Valor inválido";
  }
};
