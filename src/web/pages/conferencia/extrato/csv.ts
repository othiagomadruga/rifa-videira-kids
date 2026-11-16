// Leitor do extrato em CSV (RIFA-059, D26), NO NAVEGADOR, se o banco gerar: o mesmo leitor de CSV da conferência
// (src/shared/csv.ts: separador "," ou ";", aspas do RFC 4180) e um mapeamento simples de colunas, no padrão da
// conferência: a tela detecta pelo nome (Data, Hora, Histórico, Valor, Crédito, Débito, Documento) e a pessoa troca o
// que estiver errado. O cabeçalho pode vir depois de umas linhas de título (agência, conta, período): vale a primeira
// linha, entre as 15 primeiras, que tem uma coluna de data e uma de valor.
import {
  lerCsv,
  normalizarNomeDeColuna,
  type RegistroCsv,
} from "../../../../shared/csv";
import type {
  ContextoDeLeitura,
  ExtratoLido,
  FalhaDoExtrato,
  Lancamento,
} from "./lancamentos";
import { criarRelogio, semHoraRepetida } from "./lancamentos";
import { acharHora, lerDataDoCampo, lerValorComSinal } from "./valores";

export const CAMPOS_CSV = [
  "data",
  "hora",
  "descricao",
  "valor",
  "debito",
  "identificador",
] as const;
export type CampoCsv = (typeof CAMPOS_CSV)[number];
/** O índice da coluna de cada campo (null = o arquivo não tem). */
export type MapeamentoCsv = Record<CampoCsv, number | null>;

export const MAXIMO_LINHAS_CSV = 20_000;
const LINHAS_ANTES_DO_CABECALHO = 15;

/** O CSV do extrato: o cabeçalho, as linhas (só na memória) e o mapeamento detectado. */
export interface CsvDoExtrato {
  colunas: string[];
  registros: RegistroCsv[];
  mapeamentoDetectado: MapeamentoCsv;
}

const palavrasDe = (nome: string) =>
  new Set(
    normalizarNomeDeColuna(nome)
      .split(/[^a-z0-9]+/)
      .filter((palavra) => palavra !== ""),
  );

/** As palavras de cada campo, da preferida para a fraca (a coluna com a palavra de mais peso vence). */
const PALAVRAS: Record<CampoCsv, string[][]> = {
  data: [["data", "date", "dt"], ["dia"]],
  hora: [["hora", "horario", "time"]],
  descricao: [
    [
      "historico",
      "descricao",
      "lancamento",
      "lancamentos",
      "memo",
      "description",
    ],
    [
      "detalhe",
      "detalhes",
      "complemento",
      "nome",
      "titulo",
      "remetente",
      "pagador",
    ],
  ],
  valor: [
    ["credito", "creditos", "entrada", "entradas", "credit"],
    ["valor", "amount", "montante", "quantia"],
  ],
  debito: [["debito", "debitos", "saida", "saidas", "debit"]],
  identificador: [
    ["fitid", "txid", "identificador", "e2e", "autenticacao"],
    [
      "documento",
      "dcto",
      "doc",
      "docto",
      "id",
      "codigo",
      "referencia",
      "ref",
      "numero",
    ],
  ],
};

/** O campo e o peso que o nome indica (o saldo nunca é campo nenhum). */
function classificar(nome: string): { campo: CampoCsv; peso: number } | null {
  const palavras = palavrasDe(nome);
  if (palavras.has("saldo")) return null;
  // "Data/Hora" é data (a hora vem junto); "Valor (R$)" é valor.
  for (const campo of CAMPOS_CSV) {
    const grupos = PALAVRAS[campo];
    for (const [posicao, grupo] of grupos.entries())
      if (grupo.some((palavra) => palavras.has(palavra)))
        return { campo, peso: grupos.length - posicao };
  }
  return null;
}

export function detectarColunasDoExtrato(
  colunas: readonly string[],
): MapeamentoCsv {
  const mapeamento: MapeamentoCsv = {
    data: null,
    hora: null,
    descricao: null,
    valor: null,
    debito: null,
    identificador: null,
  };
  const pesos = new Map<CampoCsv, number>();
  for (const [indice, nome] of colunas.entries()) {
    const achado = classificar(nome);
    if (!achado) continue;
    if ((pesos.get(achado.campo) ?? 0) >= achado.peso) continue;
    pesos.set(achado.campo, achado.peso);
    mapeamento[achado.campo] = indice;
  }
  return mapeamento;
}

/** O texto parece um CSV (linhas com o mesmo separador várias vezes)? */
export function pareceCsv(texto: string): boolean {
  const linhas = texto
    .split(/\r\n|\r|\n/)
    .filter((linha) => linha.trim() !== "")
    .slice(0, 20);
  if (linhas.length < 2) return false;
  return [";", ","].some((separador) => {
    const contagens = linhas.map((linha) => linha.split(separador).length - 1);
    return (
      contagens.filter((contagem) => contagem >= 2).length >=
      Math.ceil(linhas.length * 0.6)
    );
  });
}

/** Lê o CSV e acha o cabeçalho. null quando não acha (a tela tenta como texto colado). */
export function lerCsvDoExtrato(
  texto: string,
): CsvDoExtrato | FalhaDoExtrato | null {
  // O cabeçalho é achado antes de ler o CSV: as linhas de título de cima (sem separador) enganariam a detecção do
  // separador, que olha a primeira linha com conteúdo.
  const linhas = texto.split(/\r\n|\r|\n/);
  const posicao = linhas
    .slice(0, LINHAS_ANTES_DO_CABECALHO)
    .findIndex((linha) =>
      [";", ","].some((separador) => {
        const mapeamento = detectarColunasDoExtrato(linha.split(separador));
        return (
          mapeamento.data !== null &&
          (mapeamento.valor !== null || mapeamento.debito !== null)
        );
      }),
    );
  if (posicao < 0) return null;
  const leitura = lerCsv(linhas.slice(posicao).join("\n"), {
    maximoRegistros: MAXIMO_LINHAS_CSV + 1,
  });
  if (!leitura.ok || leitura.registros.length === 0) return null;
  if (leitura.cortado)
    return {
      ok: false,
      titulo: "O extrato tem linhas demais",
      mensagem: `O limite é de ${MAXIMO_LINHAS_CSV.toLocaleString("pt-BR")} linhas. Baixe um período menor.`,
    };
  const [cabecalho, ...registros] = leitura.registros;
  const colunas = cabecalho.campos.map(
    (nome, indice) => nome.trim() || `Coluna ${indice + 1}`,
  );
  return {
    colunas,
    registros,
    mapeamentoDetectado: detectarColunasDoExtrato(colunas),
  };
}

/** Os lançamentos do CSV com o mapeamento escolhido. Sem a data ou sem o valor (nem crédito nem débito), falha. */
export function lancamentosDoCsv(
  csv: CsvDoExtrato,
  mapeamento: MapeamentoCsv,
  contexto: ContextoDeLeitura,
): ExtratoLido | FalhaDoExtrato {
  if (
    mapeamento.data === null ||
    (mapeamento.valor === null && mapeamento.debito === null)
  )
    return {
      ok: false,
      titulo: "Faltam colunas",
      mensagem: "Escolha a coluna da data e a do valor (ou a do crédito).",
    };
  const relogio = criarRelogio(contexto);
  const celula = (registro: RegistroCsv, indice: number | null) =>
    indice === null ? "" : (registro.campos[indice] ?? "").trim();
  const lancamentos: Lancamento[] = [];
  let ilegiveis = 0;
  for (const [posicao, registro] of csv.registros.entries()) {
    const credito =
      mapeamento.valor === null
        ? null
        : lerValorComSinal(celula(registro, mapeamento.valor));
    const debito =
      mapeamento.debito === null
        ? null
        : lerValorComSinal(celula(registro, mapeamento.debito));
    const centavos =
      credito !== null && credito !== 0
        ? credito
        : debito !== null && debito !== 0
          ? -Math.abs(debito)
          : credito;
    const textoDaData = celula(registro, mapeamento.data);
    const textoDaHora = celula(registro, mapeamento.hora);
    const hora = textoDaHora === "" ? null : acharHora(textoDaHora);
    const data = lerDataDoCampo(
      hora
        ? `${textoDaData} ${hora.h}:${String(hora.m).padStart(2, "0")}:${String(hora.s).padStart(2, "0")}`
        : textoDaData,
      relogio,
    );
    if (centavos === null || data === null) {
      // Linha sem nada de valor nem de data (um rodapé, um total): não conta como ilegível.
      if (
        textoDaData !== "" ||
        celula(registro, mapeamento.valor) !== "" ||
        celula(registro, mapeamento.debito) !== ""
      )
        ilegiveis++;
      continue;
    }
    // Meia-noite em ponto: o banco completou a hora com zeros.
    const meiaNoite =
      data.instante !== null &&
      data.instante === relogio.limitesDoDia(data.dia).inicio;
    const identificador = celula(registro, mapeamento.identificador);
    lancamentos.push({
      ordem: posicao + 1,
      dia: data.dia,
      instante: meiaNoite ? null : data.instante,
      centavos,
      descricao:
        celula(registro, mapeamento.descricao).replace(/\s+/g, " ") ||
        "(sem descrição)",
      identificadores: identificador === "" ? [] : [identificador],
    });
  }
  const comHora = semHoraRepetida(lancamentos, relogio);
  return {
    ok: true,
    formato: "csv",
    lancamentos: comHora.lancamentos,
    ilegiveis,
    semHora: comHora.semHora,
  };
}
