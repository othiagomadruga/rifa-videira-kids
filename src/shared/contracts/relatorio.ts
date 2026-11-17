/**
 * Relatório da campanha para baixar (RIFA-038; docs/decisions.md D23): a coordenação baixa, a qualquer momento e no
 * fim da campanha, uma planilha por tipo (`GET /api/painel/relatorio?tipo=...`, catálogo ROTAS_RELATORIO em api.ts)
 * para guardar, prestar contas e mostrar o resultado.
 *
 * Sem zod, como regras.ts e token-webhook.ts: o site importa daqui (os tipos, o nome do arquivo) sem levar o zod para o
 * pacote. Aqui ficam as regras executáveis do arquivo, para o Worker e o site não divergirem:
 * - os tipos de relatório e as colunas de cada um (chaves, títulos e ordem);
 * - o formato dos números (inteiros, R$, % e datas) e dos textos (proteção contra fórmula e aspas);
 * - o arquivo: UTF-8 com BOM, separador ";", fim de linha CRLF;
 * - o nome do arquivo e os cabeçalhos da resposta.
 * As linhas de cada tipo são montadas pela rota (-api) a partir das MESMAS leituras e montadores do painel e do
 * mapa (db/painel.ts, calculos.ts, db/mapa-ddd.ts): a fonte de cada coluna está na D23.
 *
 * Nunca entra no arquivo: dado de comprador (o banco só tem o DDD, e aqui só agregado por DDD), telefone ou e-mail de
 * líder, id de pedido, affiliate_id, nome de quem desconsiderou. Os pedidos desconsiderados (D20) não contam em
 * nada; só o NÚMERO deles aparece nos totais.
 */
import type { FaseCampanha } from "./calendario";
import type { CriterioRanking, UnidadeMeta } from "./dominio";

// ---------------------------------------------------------------------------------------------------
// Tipos de relatório e colunas
// ---------------------------------------------------------------------------------------------------

/**
 * Um arquivo por tipo (a ordem é a da tela):
 * - totais: uma linha com os totais da campanha;
 * - celulas, discipuladores, redes: uma linha por instância, por divisão e na ordem do ranking da divisão (sem ranking
 *   por divisão, D27: na ordem do ranking único, de todas as células);
 * - periodos, dias: bilhetes e R$ de cada período e de cada dia já começado;
 * - ddd: o mapa por DDD (uma linha por DDD com venda, mais "Exterior" e "Sem DDD").
 */
export const TIPOS_RELATORIO = [
  "totais",
  "celulas",
  "discipuladores",
  "redes",
  "periodos",
  "dias",
  "ddd",
] as const;
export type TipoRelatorio = (typeof TIPOS_RELATORIO)[number];

/**
 * Título de cada coluna no cabeçalho do arquivo. A meta está na unidade da meta da campanha, então o título dela
 * depende da unidade ("Meta (bilhetes)" ou "Meta (R$)"); as demais são fixas. "% da meta" e "% dos bilhetes" são
 * percentuais com 2 casas (38,61 = 38,61%).
 */
export const TITULOS_COLUNAS_RELATORIO = {
  campanha: "Campanha",
  data_referencia: "Data de referência",
  fase: "Situação da campanha",
  data_inicio: "Início",
  data_fim: "Fim",
  divisao: "Divisão",
  rede: "Rede",
  discipulador: "Discipulador",
  celula: "Célula",
  lider: "Líder",
  periodo: "Período",
  data: "Data",
  dia_campanha: "Dia da campanha",
  uf: "UF",
  ddd: "DDD",
  meta: { bilhetes: "Meta (bilhetes)", centavos: "Meta (R$)" },
  pedidos: "Pedidos aprovados",
  bilhetes: "Bilhetes",
  arrecadacao: "Arrecadação (R$)",
  percentual_meta: "% da meta",
  posicao_divisao: "Posição na divisão",
  parte_bilhetes: "% dos bilhetes",
  pedidos_sem_celula: "Pedidos sem célula",
  bilhetes_sem_celula: "Bilhetes sem célula",
  arrecadacao_sem_celula: "Arrecadação sem célula (R$)",
  pedidos_fora_das_datas: "Pedidos fora das datas da campanha",
  bilhetes_fora_das_datas: "Bilhetes fora das datas da campanha",
  arrecadacao_fora_das_datas: "Arrecadação fora das datas da campanha (R$)",
  pedidos_desconsiderados: "Pedidos desconsiderados",
  criterio_ranking: "Critério do ranking",
} as const satisfies Record<string, string | Record<UnidadeMeta, string>>;

export type ColunaRelatorio = keyof typeof TITULOS_COLUNAS_RELATORIO;

/** As colunas de cada tipo, NA ORDEM do arquivo. A fonte de cada uma está na D23 (docs/decisions.md). */
export const COLUNAS_RELATORIO = {
  totais: [
    "campanha",
    "data_referencia",
    "fase",
    "data_inicio",
    "data_fim",
    "meta",
    "pedidos",
    "bilhetes",
    "arrecadacao",
    "percentual_meta",
    "pedidos_sem_celula",
    "bilhetes_sem_celula",
    "arrecadacao_sem_celula",
    "pedidos_fora_das_datas",
    "bilhetes_fora_das_datas",
    "arrecadacao_fora_das_datas",
    "pedidos_desconsiderados",
    "criterio_ranking",
  ],
  celulas: [
    "divisao",
    "rede",
    "discipulador",
    "celula",
    "lider",
    "meta",
    "pedidos",
    "bilhetes",
    "arrecadacao",
    "percentual_meta",
    "posicao_divisao",
  ],
  discipuladores: [
    "divisao",
    "rede",
    "discipulador",
    "meta",
    "pedidos",
    "bilhetes",
    "arrecadacao",
    "percentual_meta",
    "posicao_divisao",
  ],
  redes: [
    "divisao",
    "rede",
    "meta",
    "pedidos",
    "bilhetes",
    "arrecadacao",
    "percentual_meta",
    "posicao_divisao",
  ],
  periodos: [
    "periodo",
    "data_inicio",
    "data_fim",
    "pedidos",
    "bilhetes",
    "arrecadacao",
  ],
  dias: [
    "data",
    "dia_campanha",
    "periodo",
    "pedidos",
    "bilhetes",
    "arrecadacao",
  ],
  ddd: ["uf", "ddd", "pedidos", "bilhetes", "arrecadacao", "parte_bilhetes"],
} as const satisfies Record<TipoRelatorio, readonly ColunaRelatorio[]>;

/**
 * O título da coluna `posicao_divisao` quando a campanha não separa o ranking por divisão (`ranking.por_divisao`
 * desligado, D27): a posição é a do ranking único, de todas as células. A coluna "Divisão" continua (é o dado da
 * hierarquia, como "Rede").
 */
export const TITULO_POSICAO_RANKING_UNICO = "Posição no ranking";

/**
 * O título de uma coluna na unidade da meta da campanha. `porDivisao` é o `ranking.por_divisao` da campanha (padrão:
 * separa); só muda o título da posição.
 */
export function tituloDaColuna(
  coluna: ColunaRelatorio,
  unidade: UnidadeMeta,
  porDivisao = true,
): string {
  if (coluna === "posicao_divisao" && !porDivisao)
    return TITULO_POSICAO_RANKING_UNICO;
  const titulo: string | Record<UnidadeMeta, string> =
    TITULOS_COLUNAS_RELATORIO[coluna];
  return typeof titulo === "string" ? titulo : titulo[unidade];
}

/** A linha do cabeçalho de um tipo: os títulos das colunas, na ordem de COLUNAS_RELATORIO. */
export function cabecalhoDoRelatorio(
  tipo: TipoRelatorio,
  unidade: UnidadeMeta,
  porDivisao = true,
): string[] {
  return COLUNAS_RELATORIO[tipo].map((coluna) =>
    tituloDaColuna(coluna, unidade, porDivisao),
  );
}

// ---------------------------------------------------------------------------------------------------
// Textos fixos de algumas células
// ---------------------------------------------------------------------------------------------------

/** "Situação da campanha" nos totais (a fase da referência). */
export const TEXTO_FASE_RELATORIO = {
  antes: "Antes do início",
  durante: "Em andamento",
  encerrada: "Encerrada",
} as const satisfies Record<FaseCampanha, string>;

/** "Critério do ranking" nos totais: o que ordena a "Posição na divisão" (ou "Posição no ranking") dos outros tipos. */
export const TEXTO_CRITERIO_RELATORIO = {
  percentual_meta: "% da meta",
  bilhetes: "Bilhetes",
  arrecadacao: "Arrecadação",
} as const satisfies Record<CriterioRanking, string>;

/** Na coluna "UF" do tipo ddd, as duas linhas que não são de um DDD (a coluna "DDD" fica vazia nelas). */
export const LINHA_EXTERIOR_RELATORIO = "Exterior";
export const LINHA_SEM_DDD_RELATORIO = "Sem DDD";

// ---------------------------------------------------------------------------------------------------
// Formato dos números (D23): o que o Excel e o Google Planilhas em português leem como número
// ---------------------------------------------------------------------------------------------------

function exigirInteiroNaoNegativo(valor: number, nome: string): void {
  if (!Number.isSafeInteger(valor) || valor < 0)
    throw new RangeError(
      `${nome} precisa ser um inteiro não negativo: ${valor}`,
    );
}

/** Quantidade (pedidos, bilhetes, posição, dia, meta em bilhetes): só os dígitos, sem separador de milhar. 1234 → "1234". */
export function formatarInteiroCsv(valor: number): string {
  exigirInteiroNaoNegativo(valor, "A quantidade");
  return String(valor);
}

/**
 * Centavos em reais, com vírgula e sempre 2 casas, sem "R$" e sem separador de milhar (o título da coluna diz "R$").
 * 123456 → "1234,56"; 5 → "0,05"; 0 → "0,00". Por texto, sem float (D2).
 */
export function formatarCentavosCsv(centavos: number): string {
  exigirInteiroNaoNegativo(centavos, "O valor em centavos");
  const texto = String(centavos).padStart(3, "0");
  return `${texto.slice(0, -2)},${texto.slice(-2)}`;
}

/**
 * Pontos-base (já truncados, R11) em percentual com vírgula e 2 casas, sem o "%": 3861 → "38,61"; 10000 → "100,00";
 * 12345 → "123,45" (acima da meta passa de 100). Null (sem meta) → célula vazia.
 */
export function formatarPercentualBpCsv(bp: number | null): string {
  if (bp === null) return "";
  exigirInteiroNaoNegativo(bp, "O percentual em pontos-base");
  return formatarCentavosCsv(bp);
}

/** A meta na unidade da campanha: bilhetes como quantidade, centavos como R$. */
export function formatarMetaCsv(valor: number, unidade: UnidadeMeta): string {
  return unidade === "centavos"
    ? formatarCentavosCsv(valor)
    : formatarInteiroCsv(valor);
}

const DATA_CSV = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Datas do calendário em AAAA-MM-DD, como a API: sem ambiguidade de dia e mês em nenhum idioma, e o Excel e o
 * Google Planilhas em português as reconhecem como data (e mostram 23/11/2026).
 */
export function formatarDataCsv(data: string): string {
  if (!DATA_CSV.test(data))
    throw new RangeError(`Data fora do formato AAAA-MM-DD: ${data}`);
  return data;
}

// ---------------------------------------------------------------------------------------------------
// Textos: proteção contra fórmula e aspas
// ---------------------------------------------------------------------------------------------------

/**
 * O texto seria lido como fórmula por uma planilha (injeção de fórmula, "CSV injection"): começa com `=`, `+`, `-` ou
 * `@` (ou as formas de largura total ＝ ＋ － ＠), mesmo depois de espaços, ou começa com tabulação ou retorno de
 * carro. É a mesma família de sinais que a conferência trata como fórmula ao LER o CSV da Rifei (`pareceFormula`,
 * src/shared/conferencia/valores.ts, D19), mais estrita: no relatório, o "-" seguido de número também conta, porque
 * os números do arquivo nunca são negativos e saem pelos formatadores acima, nunca como texto.
 */
export function pareceFormulaNoCsv(texto: string): boolean {
  return /^(?:[\t\r]|\s*[=+\-@＝＋－＠])/.test(texto);
}

/** Pede aspas: o separador, aspas, quebra de linha (ou espaço nas pontas, que algumas planilhas cortam). */
const PRECISA_DE_ASPAS = /[;"\r\n]|^\s|\s$/;

/**
 * Uma célula do arquivo. Toda célula passa por aqui (montarCsvRelatorio), inclusive as numéricas, que nunca mudam:
 * 1. texto que parece fórmula ganha um apóstrofo na frente (`=HYPERLINK(...)` → `'=HYPERLINK(...)`): a planilha
 *    mostra como texto e nunca executa (o apóstrofo pode aparecer na célula, e é o preço);
 * 2. com `;`, aspas, quebra de linha ou espaço nas pontas, vai entre aspas, com as aspas internas dobradas.
 */
export function celulaCsv(valor: string): string {
  const protegido = pareceFormulaNoCsv(valor) ? `'${valor}` : valor;
  return PRECISA_DE_ASPAS.test(protegido)
    ? `"${protegido.replace(/"/g, '""')}"`
    : protegido;
}

// ---------------------------------------------------------------------------------------------------
// O arquivo
// ---------------------------------------------------------------------------------------------------

/** Marca de ordem de bytes do UTF-8 (EF BB BF): sem ela, o Excel abre o arquivo como Windows-1252 e quebra os acentos. */
export const BOM_UTF8 = "﻿";
/** Separador de colunas: o do Excel em português (lá, a vírgula é o decimal). */
export const SEPARADOR_CSV_RELATORIO = ";";
/** Fim de linha CRLF, como o modelo da planilha da hierarquia; também depois da última linha. */
export const FIM_DE_LINHA_CSV_RELATORIO = "\r\n";
/** Content-Type da resposta 200. */
export const TIPO_CONTEUDO_CSV = "text/csv; charset=utf-8";

/**
 * O arquivo inteiro: BOM, o cabeçalho e as linhas, cada célula por `celulaCsv`, separadas por ";" e terminadas em
 * CRLF. Sem nenhuma linha de dados, sai só o cabeçalho (ex.: os dias, antes do início). Uma linha com um número de
 * células diferente do cabeçalho é erro de programação (RangeError).
 */
export function montarCsvRelatorio(
  cabecalho: readonly string[],
  linhas: readonly (readonly string[])[],
): string {
  if (cabecalho.length === 0)
    throw new RangeError("O cabeçalho precisa de ao menos uma coluna");
  const texto = [cabecalho, ...linhas].map((linha, indice) => {
    if (linha.length !== cabecalho.length)
      throw new RangeError(
        `A linha ${indice} tem ${linha.length} células, e o cabeçalho tem ${cabecalho.length}`,
      );
    return (
      linha.map(celulaCsv).join(SEPARADOR_CSV_RELATORIO) +
      FIM_DE_LINHA_CSV_RELATORIO
    );
  });
  return BOM_UTF8 + texto.join("");
}

/** Início do nome de todo arquivo do relatório. */
export const PREFIXO_ARQUIVO_RELATORIO = "rifa-videira-kids";

/**
 * Nome do arquivo: `rifa-videira-kids-<tipo>-<data>.csv`, com a data de referência (hoje no fuso da campanha, a
 * `referencia.data` do painel). Só letras sem acento, números e hífen: não precisa de `filename*`.
 */
export function nomeDoArquivoRelatorio(
  tipo: TipoRelatorio,
  data: string,
): string {
  return `${PREFIXO_ARQUIVO_RELATORIO}-${tipo}-${formatarDataCsv(data)}.csv`;
}

/**
 * Os cabeçalhos da resposta 200 (a rota os põe todos): o tipo do conteúdo, o anexo com o nome do arquivo e o
 * `no-store` (valores da coordenação nunca ficam em cache, D10). Os de segurança vêm do middleware de sempre.
 */
export function cabecalhosDoRelatorio(
  tipo: TipoRelatorio,
  data: string,
): {
  "Content-Type": typeof TIPO_CONTEUDO_CSV;
  "Content-Disposition": string;
  "Cache-Control": "no-store";
} {
  return {
    "Content-Type": TIPO_CONTEUDO_CSV,
    "Content-Disposition": `attachment; filename="${nomeDoArquivoRelatorio(tipo, data)}"`,
    "Cache-Control": "no-store",
  };
}
