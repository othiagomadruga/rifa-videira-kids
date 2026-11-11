// RIFA-025: os textos da tela Pedidos e do alerta, sem renderizar (os casos de borda que a tela não mostra todos).
import { describe, expect, it } from "vitest";
import {
  haQuanto,
  horasEntre,
  sugereConferirSlug,
  textoDoAlerta,
} from "./alerta-webhook";
import { estado } from "./teste-apoio";
import {
  rotuloDoEvento,
  textoDaCelula,
  textoDoCampo,
  textoDoDetalhe,
  transicao,
} from "./textos";

describe("erro e avisos legíveis", () => {
  it.each([
    [
      { campo: "total", codigo: "invalid_type", ocorrencias: 1 },
      "total: tipo inválido",
    ],
    [
      { campo: "numbers.*", codigo: "invalid_type", ocorrencias: 5000 },
      "numbers (cada item): tipo inválido (5.000 vezes)",
    ],
    [
      { campo: "buyer.address.*.zip", codigo: "too_big", ocorrencias: 2 },
      "buyer.address (cada item).zip: acima do limite (2 vezes)",
    ],
    [
      { campo: "", codigo: "json_invalido", ocorrencias: 1 },
      "O corpo não era um JSON válido",
    ],
    [
      { campo: "", codigo: "itens_omitidos", ocorrencias: 7 },
      "Outros problemas, omitidos da lista (7 vezes)",
    ],
    [
      { campo: "slug", codigo: "codigo_que_ainda_nao_existe", ocorrencias: 1 },
      "slug: outro problema (codigo_que_ainda_nao_existe)",
    ],
    [
      { campo: "event", codigo: "constructor", ocorrencias: 1 },
      "event: outro problema (constructor)",
    ],
    // O que a API manda no lugar de um código ou de uma parte do caminho fora da forma (docs/api.md).
    [
      { campo: "buyer.?", codigo: "codigo_desconhecido", ocorrencias: 2 },
      "buyer.(campo não identificado): problema não identificado (2 vezes)",
    ],
  ])("%o → %s", (detalhe, texto) => {
    expect(textoDoDetalhe(detalhe)).toBe(texto);
  });

  it("campo: o asterisco das listas vira 'cada item', mesmo no começo", () => {
    expect(textoDoCampo("*")).toBe("item");
    expect(textoDoCampo("numbers.*")).toBe("numbers (cada item)");
    expect(textoDoCampo("total")).toBe("total");
  });
});

describe("transição de status, evento e célula", () => {
  it.each([
    [{ status_anterior: null, status_resultante: null }, { tipo: "nenhuma" }],
    [
      { status_anterior: null, status_resultante: "in_process" },
      { tipo: "novo", status: "Aguardando pagamento" },
    ],
    [
      { status_anterior: "expired", status_resultante: "expired" },
      { tipo: "igual", status: "Expirado" },
    ],
    [
      { status_anterior: "expired", status_resultante: "approved" },
      { tipo: "mudou", de: "Expirado", para: "Aprovado" },
    ],
    [
      { status_anterior: "approved", status_resultante: null },
      { tipo: "nenhuma" },
    ],
  ] as const)("%o", (entrega, esperado) => {
    expect(transicao(entrega)).toEqual(esperado);
  });

  it("evento: os da Rifei em português; outro, como veio; sem corpo, 'Não lido'", () => {
    expect(rotuloDoEvento("new_order")).toBe("Pedido novo");
    expect(rotuloDoEvento("paid_order")).toBe("Pedido pago");
    expect(rotuloDoEvento("expired_order")).toBe("Pedido expirado");
    expect(rotuloDoEvento("refund_order")).toBe("refund_order");
    expect(rotuloDoEvento("toString")).toBe("toString");
    expect(rotuloDoEvento(null)).toBe("Não lido");
  });

  it("célula: o nome, 'Sem célula (afiliado N)' ou 'Sem afiliado'", () => {
    expect(
      textoDaCelula({ celula_nome: "Célula Ágape", affiliate_id: 1 }),
    ).toBe("Célula Ágape");
    expect(textoDaCelula({ celula_nome: null, affiliate_id: 1042 })).toBe(
      "Sem célula (afiliado 1042)",
    );
    expect(textoDaCelula({ celula_nome: null, affiliate_id: null })).toBe(
      "Sem afiliado",
    );
  });
});

describe("alerta: tempo e slug", () => {
  const BASE = "2026-11-25T15:00:00.000Z";

  it("horas inteiras, nunca negativas (relógio adiantado)", () => {
    expect(horasEntre("2026-11-25T10:59:00.000Z", BASE)).toBe(4);
    expect(horasEntre("2026-11-25T16:00:00.000Z", BASE)).toBe(0);
    expect(haQuanto("2026-11-25T16:00:00.000Z", BASE)).toBe(
      "há menos de 1 min",
    );
    expect(haQuanto("2026-11-24T15:00:00.000Z", BASE)).toBe("há 24 h");
    expect(haQuanto("2026-11-23T15:00:00.000Z", BASE)).toBe("há 2 dias");
  });

  it("sugere o slug só com entrega de outra campanha e nada da campanha nas 24 h", () => {
    const comOutra = (parcial: object) =>
      estado("nunca_recebeu", {
        ultimas_24h: {
          processado: 0,
          duplicado: 0,
          ignorado_outra_campanha: 1,
          ignorado_transicao: 0,
          erro_validacao: 0,
          ...parcial,
        },
      });
    expect(sugereConferirSlug(comOutra({}))).toBe(true);
    expect(sugereConferirSlug(comOutra({ erro_validacao: 3 }))).toBe(true);
    expect(sugereConferirSlug(comOutra({ processado: 1 }))).toBe(false);
    expect(sugereConferirSlug(comOutra({ duplicado: 1 }))).toBe(false);
    expect(sugereConferirSlug(comOutra({ ignorado_transicao: 1 }))).toBe(false);
    expect(sugereConferirSlug(comOutra({ ignorado_outra_campanha: 0 }))).toBe(
      false,
    );
  });

  it("erros_recentes sem erro contado nas 24 h (só o slug errado tem erro): não inventa um número", () => {
    const texto = textoDoAlerta(estado("erros_recentes"));
    expect(texto).toMatchObject({ tipo: "aviso", tom: "perigo" });
    expect(texto.tipo === "aviso" && texto.paragrafos[0]).toBe(
      "Pedido recusado não é gravado: veja quais foram e confira cada um na Rifei.",
    );
  });

  it("ok sem nenhuma entrega da campanha (não deveria acontecer): nada na tela", () => {
    expect(textoDoAlerta(estado("ok"))).toEqual({ tipo: "nada" });
  });

  it("1 hora e 1 entrega no singular", () => {
    const umaHora = textoDoAlerta(
      estado("sem_entregas_recentes", {
        ultima_processada_em: "2026-11-25T13:30:00.000Z",
      }),
    );
    expect(umaHora.tipo === "aviso" && umaHora.titulo).toBe(
      "Nenhuma venda chegou há 1 hora",
    );
    const umErro = textoDoAlerta(
      estado("erros_recentes", {
        ultimas_24h: {
          processado: 0,
          duplicado: 0,
          ignorado_outra_campanha: 0,
          ignorado_transicao: 0,
          erro_validacao: 1,
        },
      }),
    );
    expect(umErro.tipo === "aviso" && umErro.paragrafos[0]).toMatch(
      /^Nas últimas 24 h, 1 entrega foi recusada por erro, contando qualquer slug \(também de outras campanhas da conta na Rifei\)\./,
    );
  });
});
