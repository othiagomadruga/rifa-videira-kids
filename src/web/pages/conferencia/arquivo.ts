// O arquivo escolhido, lido no navegador: o texto fica só na memória da tela (nunca no localStorage, no
// endereço ou no log) e vai inteiro para a API, que o descarta depois de conferir. Aqui só se confere o
// que dá para conferir sem a API: tamanho, vazio e a codificação.
//
// Codificação: o export da Rifei pode vir em UTF-8 ou, se passou pelo Excel, em Windows-1252. O texto é
// lido como UTF-8 estrito; se não for UTF-8 válido, é lido de novo como Windows-1252, para os acentos
// ("Situação", "Não pago") chegarem certos à API.
import { LIMITE_CARACTERES_CSV, LIMITE_LINHAS_CSV } from "./conferencia-api";

export type LeituraArquivo =
  | { tipo: "ok"; csv: string; codificacao: "utf-8" | "windows-1252" }
  | { tipo: "problema"; titulo: string; mensagem: string };

const LIMITE_MB = LIMITE_CARACTERES_CSV / 1_000_000;

const ARQUIVO_GRANDE: LeituraArquivo = {
  tipo: "problema",
  titulo: "O arquivo é grande demais",
  mensagem: `O limite é de ${LIMITE_MB} MB e ${LIMITE_LINHAS_CSV.toLocaleString("pt-BR")} linhas. Exporte da Rifei só as colunas da conferência (sem nome, e-mail e telefone) ou um período menor.`,
};

const ARQUIVO_VAZIO: LeituraArquivo = {
  tipo: "problema",
  titulo: "O arquivo está vazio",
  mensagem:
    "Confira se escolheu o arquivo certo: o que a Rifei baixa em “Exportar Pedidos”.",
};

const BOM = String.fromCharCode(0xfeff);

/** Os bytes como texto: UTF-8 estrito ou, se não for UTF-8, Windows-1252. Sem o BOM do início. */
export function decodificar(bytes: ArrayBuffer): {
  texto: string;
  codificacao: "utf-8" | "windows-1252";
} {
  let texto: string;
  let codificacao: "utf-8" | "windows-1252" = "utf-8";
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    texto = new TextDecoder("windows-1252").decode(bytes);
    codificacao = "windows-1252";
  }
  return {
    texto: texto.startsWith(BOM) ? texto.slice(1) : texto,
    codificacao,
  };
}

/** Lê o arquivo escolhido. Arquivo muito maior que o limite nem é lido. */
export async function lerArquivo(arquivo: File): Promise<LeituraArquivo> {
  // Em UTF-8 cada caractere ocupa até 4 bytes: acima disso, com certeza passa do limite.
  if (arquivo.size > LIMITE_CARACTERES_CSV * 4) return ARQUIVO_GRANDE;
  let bytes: ArrayBuffer;
  try {
    bytes = await arquivo.arrayBuffer();
  } catch {
    return {
      tipo: "problema",
      titulo: "Não foi possível ler o arquivo",
      mensagem: "Escolha o arquivo de novo.",
    };
  }
  const { texto, codificacao } = decodificar(bytes);
  if (texto.trim() === "") return ARQUIVO_VAZIO;
  if (texto.length > LIMITE_CARACTERES_CSV) return ARQUIVO_GRANDE;
  return { tipo: "ok", csv: texto, codificacao };
}
