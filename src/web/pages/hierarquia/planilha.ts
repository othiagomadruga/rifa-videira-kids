// Planilha da hierarquia no navegador: lê o arquivo escolhido como texto UTF-8 e confere o que dá para
// conferir antes de chamar a API (codificação, vazio, tamanho). O resto (cabeçalho, linhas) é a API que
// valida, na conferência (simular=true).
import type { ColunaCsvHierarquia } from "../../../shared/contracts";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { LIMITE_CARACTERES_CSV, LIMITE_LINHAS_CSV } from "./hierarquia-api";

/** Caractere que o decodificador UTF-8 põe no lugar de bytes inválidos (ex.: arquivo em Windows-1252). */
export const CARACTERE_SUBSTITUICAO = "\uFFFD";

/** Colunas da planilha, na ordem do contrato (COLUNAS_CSV_HIERARQUIA), com o que vai em cada uma. */
export const COLUNAS_DA_PLANILHA = {
  // RIFA-065 (D30): com uma rede só, a coluna continua, com o mesmo nome em todas as linhas.
  rede: {
    obrigatoria: true,
    conteudo: "nome da rede (pode ser uma só: o mesmo nome em todas as linhas)",
  },
  divisao: { obrigatoria: true, conteudo: "jovens ou adultos" },
  rede_responsavel: {
    obrigatoria: false,
    conteudo: "pastor ou obreiro da rede",
  },
  discipulador: { obrigatoria: true, conteudo: "nome do discipulador" },
  celula: {
    obrigatoria: true,
    conteudo: "nome da célula (cada célula em uma linha só)",
  },
  qtd_pessoas: {
    obrigatoria: true,
    conteudo: "número inteiro de 1 a 1000, sem ponto nem vírgula",
  },
  lider_nome: { obrigatoria: true, conteudo: "nome do líder" },
  lider_email: { obrigatoria: false, conteudo: "e-mail do líder" },
  lider_telefone: {
    obrigatoria: false,
    conteudo: "telefone do líder, com DDD",
  },
} as const satisfies Record<
  ColunaCsvHierarquia,
  { obrigatoria: boolean; conteudo: string }
>;

export type LeituraPlanilha =
  | { tipo: "ok"; csv: string }
  | { tipo: "problema"; titulo: string; mensagem: string };

const LIMITE_MB = LIMITE_CARACTERES_CSV / 1_000_000;

const ARQUIVO_GRANDE: LeituraPlanilha = {
  tipo: "problema",
  titulo: "O arquivo é grande demais",
  mensagem: `O limite é de ${LIMITE_MB} MB e ${LIMITE_LINHAS_CSV.toLocaleString("pt-BR")} linhas. Divida a planilha em mais de um arquivo.`,
};

/** Confere o texto lido do arquivo (já decodificado como UTF-8). */
export function conferirTexto(texto: string): LeituraPlanilha {
  if (texto.includes(CARACTERE_SUBSTITUICAO)) {
    return {
      tipo: "problema",
      titulo: "O arquivo não está em UTF-8",
      mensagem:
        "Os acentos iriam se perder. Salve como CSV UTF-8 e escolha o arquivo de novo: no Excel, Arquivo > Salvar como > “CSV UTF-8 (delimitado por vírgulas)”; no Google Planilhas, Arquivo > Fazer download > “Valores separados por vírgula (.csv)”.",
    };
  }
  if (texto.trim() === "") {
    return {
      tipo: "problema",
      titulo: "O arquivo está vazio",
      mensagem:
        "Confira se escolheu o arquivo certo: a primeira linha precisa ser o cabeçalho do modelo.",
    };
  }
  if (texto.length > LIMITE_CARACTERES_CSV) return ARQUIVO_GRANDE;
  return { tipo: "ok", csv: texto };
}

/**
 * Lê o arquivo como texto UTF-8 (`File.text()` decodifica em UTF-8, tira o BOM e troca bytes inválidos
 * por U+FFFD) e confere. Arquivo muito maior que o limite nem é lido.
 */
export async function lerPlanilha(arquivo: File): Promise<LeituraPlanilha> {
  // Em UTF-8 cada caractere ocupa até 4 bytes: acima disso, com certeza passa do limite.
  if (arquivo.size > LIMITE_CARACTERES_CSV * 4) return ARQUIVO_GRANDE;
  try {
    return conferirTexto(await arquivo.text());
  } catch {
    return {
      tipo: "problema",
      titulo: "Não foi possível ler o arquivo",
      mensagem: "Escolha o arquivo de novo.",
    };
  }
}

/**
 * Mensagem de uma falha da importação (sem relatório por linha). No 400 `csv_invalido` (sem cabeçalho,
 * coluna obrigatória faltando, linhas demais...) vale a mensagem da API, que diz o que corrigir.
 */
export function mensagemDaImportacao(erro: unknown): string {
  if (erro instanceof ErroApi && erro.codigo === "requisicao_invalida") {
    return `O arquivo está vazio ou passa do limite de ${LIMITE_MB} MB.`;
  }
  return mensagemDoErro(erro);
}
