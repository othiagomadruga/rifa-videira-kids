// Os bytes de um arquivo escolhido na Conferência como texto, NO NAVEGADOR: o CSV da Rifei (arquivo.ts) e o extrato do
// banco (extrato/, RIFA-059). Módulo pequeno e sem dependências, para o pacote do extrato não levar o leitor do CSV.
//
// Codificação: o export da Rifei e o OFX dos bancos brasileiros podem vir em UTF-8 ou em Windows-1252 (o OFX 1.x do
// Bradesco costuma declarar CHARSET:1252). O texto é lido como UTF-8 estrito; se não for UTF-8 válido, é lido de novo
// como Windows-1252, para os acentos ("Situação", "TRANSFERÊNCIA") saírem certos.

export type Codificacao = "utf-8" | "windows-1252";

const BOM = String.fromCharCode(0xfeff);

/** Os bytes como texto: UTF-8 estrito ou, se não for UTF-8, Windows-1252. Sem o BOM do início. */
export function decodificar(bytes: ArrayBuffer): {
  texto: string;
  codificacao: Codificacao;
} {
  let texto: string;
  let codificacao: Codificacao = "utf-8";
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
