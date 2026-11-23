// RIFA-086 (D40): o cartão "Saldo na Efí" na Visão geral, SÓ para o admin. Pela rota de verdade (/coordenacao), com a
// API simulada do painel e GET /api/admin/efi/saldo (cada resposta passa pelo schema estrito do contrato). A
// coordenação não vê o cartão nem pede a rota. Valores fictícios.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  respostaSaldoEfiSchema,
  type RespostaSaldoEfi,
} from "../../../shared/contracts/api";
import { controlesSemDica, titulosSemAjuda } from "../../test/dicas";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import { CENARIOS, simularApi } from "./teste-apoio";
import { CAMINHO_SALDO_EFI } from "./visao-geral-api";

const CONSULTADO_EM = "2026-11-24T10:00:00.000Z"; // 07:00 em Belém

/** A API do painel e, por cima, a do saldo (as respostas do saldo na ordem dada; a última se repete). */
function simular(...saldos: (RespostaSaldoEfi | Response)[]) {
  const api = simularApi(CENARIOS.emDia);
  const doPainel = globalThis.fetch;
  const pedidosDoSaldo: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), "http://localhost");
      if (url.pathname !== CAMINHO_SALDO_EFI) return doPainel(entrada, init);
      pedidosDoSaldo.push(url.pathname);
      const resposta = saldos.length > 1 ? saldos.shift()! : saldos[0];
      return resposta instanceof Response
        ? resposta
        : respostaJson(respostaSaldoEfiSchema.parse(resposta));
    }),
  );
  return { api, pedidosDoSaldo };
}

async function abrirComoAdmin(...saldos: (RespostaSaldoEfi | Response)[]) {
  const simulado = simular(...saldos);
  renderizarRota("/coordenacao", { usuario: ADMIN_DE_TESTE });
  const titulo = await screen.findByRole("heading", {
    level: 2,
    name: "Saldo na Efí",
  });
  return {
    ...simulado,
    cartao: within(titulo.closest<HTMLElement>(".ui-card")!),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cartão Saldo na Efí (só o admin)", () => {
  it("admin: o saldo em R$ e a hora da consulta (em Belém)", async () => {
    const { cartao, pedidosDoSaldo } = await abrirComoAdmin({
      configurado: true,
      saldo_centavos: 1_234_567,
      consultado_em: CONSULTADO_EM,
    });

    expect(await cartao.findByText("R$ 12.345,67")).toBeInTheDocument();
    expect(cartao.getByText(/Consultado às 07:00\./)).toBeInTheDocument();
    expect(pedidosDoSaldo).toEqual([CAMINHO_SALDO_EFI]);
  });

  it("Efí ainda não ligada: diz que a consulta não foi ligada, sem valor", async () => {
    const { cartao } = await abrirComoAdmin({
      configurado: false,
      saldo_centavos: null,
      consultado_em: CONSULTADO_EM,
    });

    expect(
      await cartao.findByText(/A consulta do saldo ainda não foi ligada/),
    ).toBeInTheDocument();
    expect(cartao.queryByText(/R\$/)).not.toBeInTheDocument();
    expect(
      cartao.queryByRole("button", { name: "Consultar de novo" }),
    ).not.toBeInTheDocument();
  });

  it("Efí fora do ar: 'indisponível agora' e 'Consultar de novo', que pede de novo e mostra o valor", async () => {
    const { cartao, pedidosDoSaldo } = await abrirComoAdmin(
      {
        configurado: true,
        saldo_centavos: null,
        consultado_em: CONSULTADO_EM,
        erro: "tempo_esgotado",
      },
      {
        configurado: true,
        saldo_centavos: 50_000,
        consultado_em: CONSULTADO_EM,
      },
    );

    expect(
      await cartao.findByText(/Saldo indisponível agora/),
    ).toBeInTheDocument();
    // O cartão tem a ajuda no título e a dica no botão (as varreduras da RIFA-045 e da RIFA-066).
    expect(controlesSemDica()).toEqual([]);
    expect(await titulosSemAjuda()).toEqual([]);
    fireEvent.click(cartao.getByRole("button", { name: "Consultar de novo" }));

    expect(await cartao.findByText("R$ 500,00")).toBeInTheDocument();
    expect(pedidosDoSaldo).toHaveLength(2);
  });

  it("a API falhou: o aviso de erro com 'Tentar de novo'", async () => {
    const { cartao } = await abrirComoAdmin(
      respostaJson(
        { erro: { codigo: "erro_interno", mensagem: "Erro interno" } },
        500,
      ),
    );

    expect(
      await cartao.findByText("Não foi possível consultar o saldo."),
    ).toBeInTheDocument();
    expect(
      cartao.getByRole("button", { name: "Tentar de novo" }),
    ).toBeInTheDocument();
  });

  it("coordenação: sem o cartão e sem pedir a rota do saldo", async () => {
    const { pedidosDoSaldo } = simular({
      configurado: true,
      saldo_centavos: 1,
      consultado_em: CONSULTADO_EM,
    });
    renderizarRota("/coordenacao", { usuario: USUARIO_DE_TESTE });
    await screen.findByText(/^Atualizado às/, undefined, { timeout: 5000 });
    await screen.findByRole("heading", {
      level: 2,
      name: "Relatório da campanha",
    });

    expect(
      screen.queryByRole("heading", { level: 2, name: "Saldo na Efí" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(pedidosDoSaldo).toEqual([]));
  });
});
