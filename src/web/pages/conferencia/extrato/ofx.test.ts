// RIFA-059: o leitor do OFX (1.x em SGML e 2.x em XML), com extratos sintéticos: valores com ponto e com vírgula,
// datas com e sem o deslocamento, só o dia, meia-noite, o MEMO e o NAME juntos, o FITID e as entidades do XML.
import { describe, expect, it } from "vitest";
import { criarRelogio } from "./lancamentos";
import { ehOfx, lerDataOfx, lerOfx } from "./ofx";
import {
  CONTEXTO,
  FITID_UM,
  OFX_SEM_HORA,
  OFX_SGML,
  OFX_XML,
  PAGADOR_DOIS,
  PAGADORA_UM,
} from "./teste-apoio";

const relogio = criarRelogio(CONTEXTO);
const belem = (texto: string) => Date.parse(`${texto}-03:00`);

function lido(texto: string) {
  const resultado = lerOfx(texto, CONTEXTO);
  if (!resultado.ok) throw new Error(resultado.mensagem);
  return resultado;
}

describe("ehOfx", () => {
  it("reconhece o OFX 1.x pelo cabeçalho e o 2.x pela tag", () => {
    expect(ehOfx(OFX_SGML)).toBe(true);
    expect(ehOfx(OFX_XML)).toBe(true);
    expect(ehOfx("OFXHEADER:100\nDATA:OFXSGML")).toBe(true);
    expect(ehOfx("16/11/2026 PIX RECEBIDO R$ 20,00")).toBe(false);
    expect(ehOfx("Data;Valor\n16/11/2026;20,00")).toBe(false);
  });
});

describe("lerDataOfx", () => {
  it("com o deslocamento: o instante exato", () => {
    expect(lerDataOfx("20261116100500[-3:BRT]", relogio)).toEqual({
      dia: "2026-11-16",
      instante: belem("2026-11-16T10:05:00"),
    });
    expect(lerDataOfx("20261116100500.000[-03:EST]", relogio)?.instante).toBe(
      belem("2026-11-16T10:05:00"),
    );
    expect(lerDataOfx("20261116130500[0:GMT]", relogio)?.instante).toBe(
      belem("2026-11-16T10:05:00"),
    );
    expect(lerDataOfx("20261116100500[-3]", relogio)?.instante).toBe(
      belem("2026-11-16T10:05:00"),
    );
  });

  it("um instante da noite em outro fuso cai no dia certo de Belém", () => {
    expect(lerDataOfx("20261117013000[0:GMT]", relogio)).toEqual({
      dia: "2026-11-16",
      instante: belem("2026-11-16T22:30:00"),
    });
  });

  it("sem o deslocamento: a hora local do fuso da campanha", () => {
    expect(lerDataOfx("20261116100500", relogio)?.instante).toBe(
      belem("2026-11-16T10:05:00"),
    );
    expect(lerDataOfx("202611161005", relogio)?.instante).toBe(
      belem("2026-11-16T10:05:00"),
    );
  });

  it("só o dia, ou meia-noite em ponto (o banco não tem a hora): só o dia escrito no arquivo", () => {
    expect(lerDataOfx("20261116", relogio)).toEqual({
      dia: "2026-11-16",
      instante: null,
    });
    expect(lerDataOfx("20261116000000[-3:BRT]", relogio)).toEqual({
      dia: "2026-11-16",
      instante: null,
    });
    expect(lerDataOfx("20261116000000[0:GMT]", relogio)).toEqual({
      dia: "2026-11-16",
      instante: null,
    });
  });

  it("recusa o que não é data", () => {
    expect(lerDataOfx("20261332", relogio)).toBeNull();
    expect(lerDataOfx("20261116250000", relogio)).toBeNull();
    expect(lerDataOfx("16/11/2026", relogio)).toBeNull();
    expect(lerDataOfx("", relogio)).toBeNull();
  });
});

describe("lerOfx: OFX 1.x (SGML)", () => {
  const extrato = lido(OFX_SGML);

  it("lê cada STMTTRN, com as tags de valor sem fechamento", () => {
    expect(extrato.formato).toBe("ofx");
    expect(extrato.lancamentos.map((item) => item.centavos)).toEqual([
      2000, 4000, -1500, 30000, 2000, 777,
    ]);
    expect(extrato.ilegiveis).toBe(0);
    expect(extrato.semHora).toBe(false);
  });

  it("guarda o dia, o instante, a descrição (MEMO e NAME) e os identificadores (FITID, CHECKNUM)", () => {
    const [primeiro, segundo] = extrato.lancamentos;
    expect(primeiro).toEqual({
      ordem: 1,
      dia: "2026-11-16",
      instante: belem("2026-11-16T10:05:00"),
      centavos: 2000,
      descricao: `TRANSFERENCIA PIX PEDTESTE0101 REM: ${PAGADORA_UM}`,
      identificadores: [FITID_UM, "1400200"],
    });
    expect(segundo.descricao).toBe(`TRANSFERENCIA PIX · REM: ${PAGADOR_DOIS}`);
    expect(segundo.centavos).toBe(4000);
  });

  it("um arquivo sem a hora (tudo à meia-noite) fica só com o dia", () => {
    const semHora = lido(OFX_SEM_HORA);
    expect(semHora.semHora).toBe(true);
    expect(semHora.lancamentos.every((item) => item.instante === null)).toBe(
      true,
    );
    expect(semHora.lancamentos[0].dia).toBe("2026-11-16");
  });

  it("a mesma hora em todos os lançamentos (ex.: 12:00) também não vale", () => {
    const meioDia = lido(
      OFX_SGML.replace(
        /<DTPOSTED>(\d{8})\d{6}\[-3:BRT\]/g,
        "<DTPOSTED>$1120000[-3:BRT]",
      ),
    );
    expect(meioDia.semHora).toBe(true);
    expect(meioDia.lancamentos.every((item) => item.instante === null)).toBe(
      true,
    );
  });

  it("conta como ilegível o lançamento sem valor ou sem data", () => {
    const quebrado = lido(
      OFX_SGML.replace("<TRNAMT>40,00", "<TRNAMT>quarenta").replace(
        "<DTPOSTED>20261116150000[-3:BRT]",
        "<DTPOSTED>ontem",
      ),
    );
    expect(quebrado.ilegiveis).toBe(2);
    expect(quebrado.lancamentos).toHaveLength(4);
  });

  it("usa o DTUSER quando o DTPOSTED falta", () => {
    const comDtuser = lido(
      OFX_SGML.replace(
        "<DTPOSTED>20261116100500[-3:BRT]",
        "<DTUSER>20261116100700[-3:BRT]",
      ),
    );
    expect(comDtuser.lancamentos[0].instante).toBe(
      belem("2026-11-16T10:07:00"),
    );
  });
});

describe("lerOfx: OFX 2.x (XML)", () => {
  const extrato = lido(OFX_XML);

  it("lê as tags fechadas numa linha só, com valores com ponto, sinal e uma casa decimal", () => {
    expect(extrato.lancamentos.map((item) => item.centavos)).toEqual([
      123456, 2550, -990,
    ]);
  });

  it("datas com milissegundos, com outro nome de fuso e sem deslocamento", () => {
    expect(extrato.lancamentos.map((item) => item.instante)).toEqual([
      belem("2026-11-17T09:12:45"),
      belem("2026-11-17T12:00:00"),
      belem("2026-11-17T13:00:00"),
    ]);
  });

  it("desfaz as entidades do XML e junta o MEMO e o NAME", () => {
    expect(extrato.lancamentos[0].descricao).toBe(
      "PIX RECEBIDO & CONFIRMADO · Pagador Ficticio Dois",
    );
    expect(extrato.lancamentos[0].identificadores).toEqual(["E2E0001"]);
  });
});

describe("lerOfx: falhas", () => {
  it("sem nenhum STMTTRN", () => {
    const resultado = lerOfx(
      "<OFX><BANKTRANLIST></BANKTRANLIST></OFX>",
      CONTEXTO,
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok)
      expect(resultado.titulo).toBe("O extrato não tem lançamentos");
  });
});
