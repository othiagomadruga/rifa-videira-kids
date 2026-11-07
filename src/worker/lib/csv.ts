/**
 * CSV com cabeçalho para a importação da hierarquia: colunas conhecidas, obrigatórias, sugestões e as
 * falhas no formato de `detalhesCsvInvalidoSchema`. O leitor (lerCsv) está em src/shared/csv.ts, com as
 * regras abaixo, e é reexportado daqui.
 *
 * - Separador "," ou ";", detectado na primeira linha com conteúdo (o cabeçalho): vence o que aparece
 *   mais vezes fora de aspas; no empate, ",". O Excel em português grava com ";".
 * - Campo entre aspas pode ter o separador, quebras de linha e aspas escapadas (""). Espaços antes da
 *   aspa de abertura são ignorados; o que vier depois da aspa de fechamento entra no campo.
 * - BOM UTF-8 no início é descartado. Fim de linha CRLF, LF ou CR (dentro de aspas, vira LF).
 * - Linhas em branco (só espaços e separadores) são descartadas, mas contam na numeração: `linha` é a
 *   linha da planilha, a partir de 1. Uma quebra de linha dentro de aspas não abre linha nova.
 */
import type { DetalhesCsvInvalido } from "../../shared/contracts";
import {
  lerCsv,
  normalizarNomeDeColuna,
  resumirNomeDeColuna,
} from "../../shared/csv";

// O leitor mora em src/shared/csv.ts (vale também no navegador); quem importava daqui continua igual.
export {
  detectarSeparador,
  lerCsv,
  normalizarNomeDeColuna,
  resumirNomeDeColuna,
  type LeituraCsv,
  type OpcoesLerCsv,
  type RegistroCsv,
  type SeparadorCsv,
} from "../../shared/csv";

// ---------------------------------------------------------------------------------------------------
// Tabela com cabeçalho
// ---------------------------------------------------------------------------------------------------

export interface OpcoesTabelaCsv<C extends string> {
  /** Colunas conhecidas (nomes sem acento, em minúsculas). As demais são ignoradas. */
  colunas: readonly C[];
  obrigatorias: readonly C[];
  /** Máximo de linhas de dados (sem contar o cabeçalho e as linhas em branco). */
  limiteLinhas: number;
  /** Palavra do cabeçalho → palavra das colunas, para sugerir a coluna certa ({ celular: "telefone" }). */
  sinonimos?: Readonly<Record<string, string>>;
}

export interface LinhaTabelaCsv<C extends string> {
  linha: number;
  /** Só as colunas conhecidas do cabeçalho. Campo que falta no fim da linha vem vazio (""). */
  valores: Partial<Record<C, string>>;
}

/** Coluna do cabeçalho que não é conhecida (foi ignorada), com a coluna conhecida mais parecida. */
export interface ColunaIgnorada<C extends string> {
  nome: string;
  sugestao: C | null;
}

/** O arquivo não pôde ser lido linha a linha (para a API, 400 `csv_invalido`). */
export interface FalhaCsv {
  ok: false;
  mensagem: string;
  detalhes: DetalhesCsvInvalido;
}

export type TabelaCsv<C extends string> =
  | {
      ok: true;
      /** Linha do cabeçalho (a primeira com conteúdo). */
      cabecalho: number;
      colunas: ReadonlySet<C>;
      ignoradas: ColunaIgnorada<C>[];
      linhas: LinhaTabelaCsv<C>[];
    }
  | FalhaCsv;

/** O que o decodificador põe no lugar de bytes que não são UTF-8 (ex.: arquivo salvo em Windows-1252). */
const CARACTERE_INVALIDO = "\uFFFD";

export function arquivoVazio(): FalhaCsv {
  return {
    ok: false,
    mensagem:
      "O arquivo está vazio: a primeira linha precisa ser o cabeçalho com os nomes das colunas",
    detalhes: { motivo: "sem_cabecalho" },
  };
}

export function arquivoGrandeDemais(limiteCaracteres: number): FalhaCsv {
  const megabytes = (limiteCaracteres / 1_000_000).toLocaleString("pt-BR");
  return {
    ok: false,
    mensagem: `O arquivo passa de ${megabytes} MB: divida a planilha em arquivos menores e importe um de cada vez.`,
    detalhes: { motivo: "arquivo_grande", limite_caracteres: limiteCaracteres },
  };
}

const PALAVRAS_VAZIAS = new Set([
  "a",
  "as",
  "o",
  "os",
  "e",
  "de",
  "da",
  "das",
  "do",
  "dos",
  "na",
  "no",
]);

function palavrasDaColuna(
  nome: string,
  sinonimos: Readonly<Record<string, string>>,
): Set<string> {
  return new Set(
    normalizarNomeDeColuna(nome)
      .split(/[^a-z0-9]+/)
      .filter((palavra) => palavra !== "" && !PALAVRAS_VAZIAS.has(palavra))
      .map((palavra) =>
        Object.hasOwn(sinonimos, palavra) ? sinonimos[palavra] : palavra,
      ),
  );
}

function distanciaDeEdicao(a: string, b: string): number {
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++)
      atual[j] = Math.min(
        anterior[j] + 1,
        atual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * A coluna conhecida mais parecida com um nome do cabeçalho, ou null se nenhuma for parecida o bastante:
 * metade das palavras em comum (sem "de", "do"... e com os sinônimos) ou erro de digitação pequeno
 * (até 1/4 das letras). Ex.: "Telefone do líder" → lider_telefone; "Discipuladora" → discipulador.
 */
export function sugerirColuna<C extends string>(
  nome: string,
  colunas: readonly C[],
  sinonimos: Readonly<Record<string, string>> = {},
): C | null {
  const palavras = palavrasDaColuna(nome, sinonimos);
  const compacto = normalizarNomeDeColuna(nome).replace(/[^a-z0-9]/g, "");
  if (compacto === "") return null;
  let melhor: C | null = null;
  let melhorNota = 0;
  for (const coluna of colunas) {
    const daColuna = palavrasDaColuna(coluna, sinonimos);
    const comuns = [...palavras].filter((palavra) => daColuna.has(palavra));
    const emComum = comuns.length / new Set([...palavras, ...daColuna]).size;
    const alvo = coluna.replace(/[^a-z0-9]/g, "");
    const digitacao =
      1 -
      distanciaDeEdicao(compacto, alvo) /
        Math.max(compacto.length, alvo.length);
    const nota = Math.max(
      emComum >= 0.5 ? emComum : 0,
      digitacao >= 0.75 ? digitacao : 0,
    );
    if (nota > melhorNota) {
      melhor = coluna;
      melhorNota = nota;
    }
  }
  return melhor;
}

/**
 * Lê um CSV cuja primeira linha com conteúdo é o cabeçalho e devolve as linhas de dados com as colunas
 * conhecidas, mais as colunas do cabeçalho que foram ignoradas. Falha (`detalhes` no formato
 * detalhesCsvInvalidoSchema) quando o arquivo não tem cabeçalho, tem aspas abertas, não está em UTF-8,
 * repete uma coluna conhecida, não tem uma coluna obrigatória ou passa do limite de linhas.
 */
export function lerTabelaCsv<C extends string>(
  texto: string,
  opcoes: OpcoesTabelaCsv<C>,
): TabelaCsv<C> {
  const leitura = lerCsv(texto);
  if (!leitura.ok)
    return {
      ok: false,
      mensagem: leitura.mensagem,
      detalhes: { motivo: "aspas_abertas", linha: leitura.linha },
    };
  const [cabecalho, ...dados] = leitura.registros;
  if (!cabecalho) return arquivoVazio();

  const comCaractereInvalido = leitura.registros.find((registro) =>
    registro.campos.some((valor) => valor.includes(CARACTERE_INVALIDO)),
  );
  if (comCaractereInvalido)
    return {
      ok: false,
      mensagem: `O arquivo não está em UTF-8 (caractere inválido na linha ${comCaractereInvalido.linha}). No Excel, salve como "CSV UTF-8"; no Google Planilhas, use Arquivo > Fazer download > CSV.`,
      detalhes: {
        motivo: "codificacao_invalida",
        linha: comCaractereInvalido.linha,
      },
    };

  const indices = new Map<C, number>();
  const ignoradas: ColunaIgnorada<C>[] = [];
  const nomesIgnorados = new Set<string>();
  for (const [indice, nome] of cabecalho.campos.entries()) {
    const normalizado = normalizarNomeDeColuna(nome);
    const coluna = opcoes.colunas.find(
      (conhecida) => conhecida === normalizado,
    );
    if (coluna === undefined) {
      if (normalizado !== "" && !nomesIgnorados.has(normalizado)) {
        nomesIgnorados.add(normalizado);
        ignoradas.push({
          nome: resumirNomeDeColuna(nome),
          sugestao: sugerirColuna(nome, opcoes.colunas, opcoes.sinonimos),
        });
      }
      continue;
    }
    if (indices.has(coluna))
      return {
        ok: false,
        mensagem: `A coluna "${coluna}" aparece mais de uma vez no cabeçalho`,
        detalhes: { motivo: "coluna_repetida", coluna },
      };
    indices.set(coluna, indice);
  }

  const faltando = opcoes.obrigatorias.filter((coluna) => !indices.has(coluna));
  if (faltando.length > 0) {
    const parecidas = ignoradas.filter(
      (ignorada) =>
        ignorada.sugestao !== null && faltando.includes(ignorada.sugestao),
    );
    const dica =
      parecidas.length === 0
        ? ""
        : `. Talvez estejam com outro nome: ${parecidas
            .map(({ nome, sugestao }) => `"${nome}" (use "${sugestao}")`)
            .join(", ")}`;
    return {
      ok: false,
      mensagem: `Faltam colunas obrigatórias no cabeçalho (linha ${cabecalho.linha}): ${faltando.join(", ")}${dica}`,
      detalhes: { motivo: "colunas_faltando", colunas: faltando },
    };
  }

  if (dados.length > opcoes.limiteLinhas)
    return {
      ok: false,
      mensagem: `O arquivo tem ${dados.length} linhas de dados; o limite é ${opcoes.limiteLinhas}. Divida em mais de um arquivo.`,
      detalhes: {
        motivo: "linhas_demais",
        limite: opcoes.limiteLinhas,
        total_linhas: dados.length,
      },
    };

  const colunas = [...indices];
  return {
    ok: true,
    cabecalho: cabecalho.linha,
    colunas: new Set(indices.keys()),
    ignoradas,
    linhas: dados.map((registro) => {
      const valores: Partial<Record<C, string>> = {};
      for (const [coluna, indice] of colunas)
        valores[coluna] = registro.campos[indice] ?? "";
      return { linha: registro.linha, valores };
    }),
  };
}
