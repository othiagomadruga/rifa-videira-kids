// Leitor do OFX do banco (RIFA-059, D26), NO NAVEGADOR: o OFX 1.x (SGML, em que as tags de valor não fecham:
// "<TRNAMT>-50.00" e a quebra de linha) e o OFX 2.x (XML, "<TRNAMT>-50.00</TRNAMT>"), numa leitura tolerante por texto
// (nada de parser XML: o SGML não fecha as tags, e os bancos brasileiros não seguem o padrão à risca).
//
// De cada <STMTTRN>: TRNAMT (o valor, com ponto ou vírgula), DTPOSTED (ou DTUSER), MEMO e NAME (a descrição), FITID,
// CHECKNUM e REFNUM (onde o número do pedido pode aparecer). TRNTYPE não decide nada: o sinal do valor decide.
//
// Datas (especificação do OFX: "YYYYMMDDHHMMSS.XXX[gmt offset:tz name]", com os campos da direita opcionais):
// - com o deslocamento ("[-3:BRT]", "[-03:EST]", "[-3]"): o instante exato;
// - sem o deslocamento: a hora local do fuso da campanha (a especificação manda ler como GMT, mas os bancos brasileiros
//   costumam gravar a hora local sem o deslocamento; GMT trocaria o dia dos lançamentos da noite);
// - só o dia ("20261116") ou meia-noite em ponto ("20261116000000[-3:BRT]"): só o dia, o escrito no arquivo.
import type {
  ContextoDeLeitura,
  ExtratoLido,
  FalhaDoExtrato,
  Lancamento,
} from "./lancamentos";
import { criarRelogio, semHoraRepetida, type Relogio } from "./lancamentos";
import { lerValorComSinal } from "./valores";

/** Teto de lançamentos num arquivo (um ano de extrato movimentado cabe com folga). */
export const MAXIMO_LANCAMENTOS_OFX = 20_000;

/** O texto é um OFX (tem a tag <OFX> ou o cabeçalho OFXHEADER)? */
export function ehOfx(texto: string): boolean {
  return /<OFX>/i.test(texto) || /^\s*(?:OFXHEADER\s*:|<\?OFX\b)/i.test(texto);
}

/** Cada <STMTTRN> até o fechamento, o próximo <STMTTRN> ou o fim da lista (no SGML, o fechamento é opcional). */
const BLOCO =
  /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|<\/OFX>|$)/gi;

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function desescapar(texto: string): string {
  return texto.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (inteiro, nome: string) => {
      if (nome.startsWith("#x") || nome.startsWith("#X"))
        return String.fromCodePoint(Number.parseInt(nome.slice(2), 16) || 32);
      if (nome.startsWith("#"))
        return String.fromCodePoint(Number(nome.slice(1)) || 32);
      return ENTIDADES[nome.toLowerCase()] ?? inteiro;
    },
  );
}

/** O valor de uma tag no bloco: o texto depois de <TAG> até a próxima tag ou o fim da linha. */
function campo(bloco: string, tag: string): string | null {
  const achado = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(bloco);
  if (!achado) return null;
  const valor = desescapar(achado[1]).replace(/\s+/g, " ").trim();
  return valor === "" ? null : valor;
}

const DATA_OFX =
  /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?(?:\.\d{1,6})?\s*(?:\[\s*([+-]?\d{1,2})(?:[.,](\d{1,2}))?\s*(?::[^\]]*)?\])?$/;

/** A data do OFX no fuso da campanha; null se não é uma data. */
export function lerDataOfx(
  texto: string,
  relogio: Relogio,
): { dia: string; instante: number | null } | null {
  const achado = DATA_OFX.exec(texto.trim());
  if (!achado) return null;
  const [, a, me, d, h, mi, s, deslocamento, fracao] = achado;
  const [ano, mes, dia] = [Number(a), Number(me), Number(d)];
  const soODia = relogio.local(ano, mes, dia);
  if (soODia === null) return null;
  if (h === undefined || mi === undefined) return soODia;
  const [hora, minuto, segundo] = [Number(h), Number(mi), Number(s ?? 0)];
  if (hora > 23 || minuto > 59 || segundo > 59) return null;
  // Meia-noite em ponto: o banco não tem a hora e completou com zeros.
  if (hora === 0 && minuto === 0 && segundo === 0) return soODia;
  if (deslocamento === undefined)
    return relogio.local(ano, mes, dia, { h: hora, m: minuto, s: segundo });
  const horas = Number(deslocamento);
  // "[-3.30]" ou "[+5.30]": os minutos depois do ponto (2 algarismos) ou décimos de hora (1 algarismo).
  const minutosExtras =
    fracao === undefined
      ? 0
      : fracao.length === 2
        ? Number(fracao)
        : Number(fracao) * 6;
  const minutosDoFuso =
    (Math.abs(horas) * 60 + minutosExtras) *
    (deslocamento.startsWith("-") ? -1 : 1);
  if (Math.abs(minutosDoFuso) > 14 * 60) return null;
  const instante =
    Date.UTC(ano, mes - 1, dia, hora, minuto, segundo) - minutosDoFuso * 60_000;
  return { dia: relogio.diaDoInstante(instante), instante };
}

/** Lê os lançamentos do OFX. */
export function lerOfx(
  texto: string,
  contexto: ContextoDeLeitura,
): ExtratoLido | FalhaDoExtrato {
  const relogio = criarRelogio(contexto);
  const lancamentos: Lancamento[] = [];
  let ilegiveis = 0;
  let blocos = 0;
  for (const achado of texto.matchAll(BLOCO)) {
    blocos++;
    if (blocos > MAXIMO_LANCAMENTOS_OFX)
      return {
        ok: false,
        titulo: "O extrato tem lançamentos demais",
        mensagem: `O limite é de ${MAXIMO_LANCAMENTOS_OFX.toLocaleString("pt-BR")} lançamentos. Baixe um período menor (por exemplo, a última semana).`,
      };
    const bloco = achado[1];
    const valor = campo(bloco, "TRNAMT");
    const centavos = valor === null ? null : lerValorComSinal(valor);
    // A data do lançamento; se ela faltar ou não for uma data, a da transação (DTUSER).
    let data: ReturnType<typeof lerDataOfx> = null;
    for (const tag of ["DTPOSTED", "DTUSER"]) {
      const textoDaData = campo(bloco, tag);
      data ??= textoDaData === null ? null : lerDataOfx(textoDaData, relogio);
    }
    if (centavos === null || data === null) {
      ilegiveis++;
      continue;
    }
    const memo = campo(bloco, "MEMO");
    const nome = campo(bloco, "NAME");
    const descricao = [memo, nome !== memo ? nome : null]
      .filter((parte) => parte !== null)
      .join(" · ");
    lancamentos.push({
      ordem: blocos,
      dia: data.dia,
      instante: data.instante,
      centavos,
      descricao: descricao || "(sem descrição)",
      identificadores: ["FITID", "CHECKNUM", "REFNUM"]
        .map((tag) => campo(bloco, tag))
        .filter((valor): valor is string => valor !== null),
    });
  }
  if (blocos === 0)
    return {
      ok: false,
      titulo: "O extrato não tem lançamentos",
      mensagem:
        "O arquivo OFX não tem nenhum lançamento. Confira o período escolhido no banco e baixe de novo.",
    };
  const comHora = semHoraRepetida(lancamentos, relogio);
  return {
    ok: true,
    formato: "ofx",
    lancamentos: comHora.lancamentos,
    ilegiveis,
    semHora: comHora.semHora,
  };
}
