// A leitura do extrato escolhido ou colado (RIFA-059, D26), toda NO NAVEGADOR: o arquivo nunca vai para o servidor e
// nada é gravado (nem banco, nem localStorage, nem log). O formato é descoberto pelo conteúdo:
// - OFX (a tag <OFX> ou o cabeçalho OFXHEADER): ofx.ts;
// - CSV (a extensão .csv ou linhas com o mesmo separador), com o cabeçalho achado: csv.ts, com o mapeamento na tela;
// - o resto (e o CSV sem cabeçalho reconhecível): o leitor de texto colado, linha por linha (texto-colado.ts).
// O PDF fica fora desta versão (exigiria uma dependência nova): copie o texto do PDF e cole na caixa.
import { decodificar } from "../decodificar";
import { lerCsvDoExtrato, pareceCsv, type CsvDoExtrato } from "./csv";
import type {
  ContextoDeLeitura,
  ExtratoLido,
  FalhaDoExtrato,
} from "./lancamentos";
import { ehOfx, lerOfx } from "./ofx";
import { lerTextoColado } from "./texto-colado";

/** O maior arquivo aceito (um ano de OFX movimentado tem bem menos). */
export const MAXIMO_BYTES_EXTRATO = 5_000_000;

export type EntradaDoExtrato =
  | { tipo: "arquivo"; nome: string; texto: string }
  | { tipo: "texto"; texto: string };

export type LeituraDoExtrato =
  | FalhaDoExtrato
  | { ok: true; tipo: "lido"; extrato: ExtratoLido }
  | { ok: true; tipo: "csv"; csv: CsvDoExtrato };

const VAZIO: FalhaDoExtrato = {
  ok: false,
  titulo: "O extrato está vazio",
  mensagem: "Escolha o arquivo baixado do banco ou cole a tabela do extrato.",
};

/** Os bytes do arquivo como texto (UTF-8 ou Windows-1252), ou a falha. */
export async function lerArquivoDoExtrato(
  arquivo: File,
): Promise<{ ok: true; texto: string } | FalhaDoExtrato> {
  if (arquivo.size > MAXIMO_BYTES_EXTRATO)
    return {
      ok: false,
      titulo: "O arquivo é grande demais",
      mensagem:
        "O limite é de 5 MB. Baixe do banco um período menor (por exemplo, a última semana).",
    };
  if (/\.pdf$/i.test(arquivo.name) || arquivo.type === "application/pdf")
    return {
      ok: false,
      titulo: "O PDF ainda não é lido aqui",
      mensagem:
        "Baixe o extrato em OFX ou abra o PDF, selecione a tabela, copie e cole na caixa de texto abaixo.",
    };
  try {
    return { ok: true, texto: decodificar(await arquivo.arrayBuffer()).texto };
  } catch {
    return {
      ok: false,
      titulo: "Não foi possível ler o arquivo",
      mensagem: "Escolha o arquivo de novo.",
    };
  }
}

/** Lê o extrato pelo formato que o conteúdo mostra. */
export function lerExtrato(
  entrada: EntradaDoExtrato,
  contexto: ContextoDeLeitura,
): LeituraDoExtrato {
  const texto = entrada.texto;
  if (texto.trim() === "") return VAZIO;
  const lido = (extrato: ExtratoLido | FalhaDoExtrato): LeituraDoExtrato =>
    extrato.ok ? { ok: true, tipo: "lido", extrato } : extrato;
  if (ehOfx(texto)) return lido(lerOfx(texto, contexto));
  if (
    entrada.tipo === "arquivo" &&
    (/\.csv$/i.test(entrada.nome) || pareceCsv(texto))
  ) {
    const csv = lerCsvDoExtrato(texto);
    if (csv !== null) return "ok" in csv ? csv : { ok: true, tipo: "csv", csv };
  }
  return lido(lerTextoColado(texto, contexto));
}
