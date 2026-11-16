// O arquivo escolhido, lido NO NAVEGADOR: o texto fica só na memória da tela (nunca no localStorage, no
// endereço, no log ou na API). A tela lê as colunas e as linhas aqui (src/shared/conferencia) e manda à API
// só o corpo compacto, sem os dados pessoais; do texto, sai só o SHA-256 (para a auditoria).
//
// Codificação: o export da Rifei pode vir em UTF-8 ou, se passou pelo Excel, em Windows-1252 (decodificar.ts).
import { LIMITE_CARACTERES_CSV_RECONCILIACAO } from "../../../shared/contracts/conferencia";
import {
  FALHA_ARQUIVO_GRANDE,
  FALHA_ARQUIVO_VAZIO,
} from "../../../shared/conferencia/leitura";
import { decodificar } from "./decodificar";

export type ArquivoDecodificado =
  | { tipo: "ok"; texto: string; codificacao: "utf-8" | "windows-1252" }
  | { tipo: "problema"; titulo: string; mensagem: string };

const problema = (falha: {
  titulo: string;
  mensagem: string;
}): ArquivoDecodificado => ({
  tipo: "problema",
  titulo: falha.titulo,
  mensagem: falha.mensagem,
});

/** Lê o arquivo escolhido. Arquivo muito maior que o limite nem é lido. */
export async function lerArquivo(arquivo: File): Promise<ArquivoDecodificado> {
  // Em UTF-8 cada caractere ocupa até 4 bytes: acima disso, com certeza passa do limite.
  if (arquivo.size > LIMITE_CARACTERES_CSV_RECONCILIACAO * 4)
    return problema(FALHA_ARQUIVO_GRANDE);
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
  if (texto.trim() === "") return problema(FALHA_ARQUIVO_VAZIO);
  if (texto.length > LIMITE_CARACTERES_CSV_RECONCILIACAO)
    return problema(FALHA_ARQUIVO_GRANDE);
  return { tipo: "ok", texto, codificacao };
}

/** SHA-256 (hex minúsculo) do texto do arquivo: identifica o arquivo na auditoria, sem o conteúdo. */
export async function sha256DoTexto(texto: string): Promise<string> {
  const resumo = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return Array.from(new Uint8Array(resumo), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
