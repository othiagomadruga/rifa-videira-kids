import { describe, expect, it } from "vitest";
import type { CelulaAdesao } from "./adesao-api";
import {
  celulaCombina,
  formatarHoraComSegundos,
  lerCodigoAfiliado,
  linkTelefone,
  normalizar,
  ordenarParaEscolha,
  quantidade,
  situacaoDaCelula,
  tempoRelativo,
} from "./formatos";

function celula(dados: Partial<CelulaAdesao> = {}): CelulaAdesao {
  return {
    celula_id: 1,
    celula_nome: "Célula Ágape",
    qtd_pessoas: 12,
    lider_nome: "João Ficticio",
    lider_telefone: null,
    discipulador_id: 1,
    discipulador_nome: "Discipulador Ficticio A",
    rede_id: 1,
    rede_nome: "Rede Jovem Ficticia",
    divisao: "jovens",
    afiliados: [],
    vinculada: false,
    primeira_venda_em: null,
    pedidos_aprovados: 0,
    ...dados,
  };
}

describe("tempoRelativo", () => {
  const agora = Date.parse("2026-11-11T22:33:00.000Z");

  it.each([
    ["2026-11-11T22:32:30.000Z", "agora mesmo"],
    ["2026-11-11T22:32:00.000Z", "há 1 min"],
    ["2026-11-11T22:31:00.000Z", "há 2 min"],
    ["2026-11-11T21:34:00.000Z", "há 59 min"],
    ["2026-11-11T21:33:00.000Z", "há 1 h"],
    ["2026-11-10T22:34:00.000Z", "há 23 h"],
    ["2026-11-10T22:33:00.000Z", "há 1 dia"],
    ["2026-11-08T22:33:00.000Z", "há 3 dias"],
    // Relógio do aparelho atrasado em relação ao servidor.
    ["2026-11-11T22:35:00.000Z", "agora mesmo"],
  ])("%s → %s", (instante, esperado) => {
    expect(tempoRelativo(instante, agora)).toBe(esperado);
  });
});

describe("formatos da tela", () => {
  it("hora com segundos no fuso de Belém", () => {
    expect(
      formatarHoraComSegundos(Date.parse("2026-11-11T22:33:05.000Z")),
    ).toBe("19:33:05");
  });

  it("quantidade no singular e no plural", () => {
    expect(quantidade(1, "pedido aprovado", "pedidos aprovados")).toBe(
      "1 pedido aprovado",
    );
    expect(quantidade(0, "pedido aprovado", "pedidos aprovados")).toBe(
      "0 pedidos aprovados",
    );
    expect(quantidade(1200, "célula", "células")).toBe("1.200 células");
  });

  it("link de ligação só com os dígitos (e o + do país)", () => {
    expect(linkTelefone("(91) 90000-0001")).toBe("tel:91900000001");
    expect(linkTelefone("+55 91 90000-0001")).toBe("tel:+5591900000001");
  });
});

describe("lerCodigoAfiliado", () => {
  it.each([
    ["1043", 1043],
    [" 1043 ", 1043],
    ["007", 7],
  ])("aceita %j", (texto, codigo) => {
    expect(lerCodigoAfiliado(texto)).toBe(codigo);
  });

  it.each([
    "",
    "  ",
    "0",
    "12a",
    "-7",
    "10.5",
    "1e3",
    "1 043",
    "99999999999999999",
  ])("recusa %j", (texto) => {
    expect(lerCodigoAfiliado(texto)).toBeNull();
  });
});

describe("busca e situação das células", () => {
  it("normaliza acentos, maiúsculas e espaços", () => {
    expect(normalizar("  Célula ÁGAPE  ")).toBe("celula agape");
  });

  it("encontra pela célula, pelo líder, pelo discipulador, pela rede ou pelo código, palavra por palavra", () => {
    const agape = celula({ afiliados: [1043] });
    for (const busca of [
      "",
      "agape",
      "AGAPE",
      "joao",
      "ficticio a",
      "rede jovem",
      "1043",
      "agape joao",
    ]) {
      expect(celulaCombina(agape, busca), busca).toBe(true);
    }
    // O código do afiliado só casa inteiro.
    for (const busca of ["betel", "agape maria", "1044", "04", "104"]) {
      expect(celulaCombina(agape, busca), busca).toBe(false);
    }
  });

  it("situação: sem afiliado, vinculada ou já vendeu", () => {
    expect(situacaoDaCelula(celula())).toBe("sem_afiliado");
    expect(situacaoDaCelula(celula({ afiliados: [1], vinculada: true }))).toBe(
      "vinculada",
    );
    expect(
      situacaoDaCelula(
        celula({ afiliados: [1], vinculada: true, pedidos_aprovados: 2 }),
      ),
    ).toBe("ja_vendeu");
  });

  it("para escolher: as células sem afiliado primeiro, mantendo a ordem", () => {
    const ordem = ordenarParaEscolha([
      celula({ celula_id: 1, vinculada: true, afiliados: [9] }),
      celula({ celula_id: 2 }),
      celula({ celula_id: 3, vinculada: true, afiliados: [8] }),
      celula({ celula_id: 4 }),
    ]);
    expect(ordem.map((item) => item.celula_id)).toEqual([2, 4, 1, 3]);
  });
});
