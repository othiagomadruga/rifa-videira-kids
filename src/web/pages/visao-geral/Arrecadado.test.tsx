// RIFA-087 (adendo da D40): o cartão "Arrecadado" na Visão geral, SÓ para o admin, no lugar do "Saldo na Efí". Pela rota
// de verdade (/coordenacao), com a API simulada do painel e GET /api/admin/arrecadado (cada resposta passa pelo schema
// estrito do contrato). A coordenação não vê o cartão nem pede a rota. Valores fictícios.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  respostaArrecadadoSchema,
  type RespostaArrecadado,
} from "../../../shared/contracts/api";
import { controlesSemDica, titulosSemAjuda } from "../../test/dicas";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import { LEGENDA_ARRECADADO } from "./Arrecadado";
import {
  CENARIOS,
  ESCOPO_CAMPANHA_RESOLVIDO,
  resumoDoCenario,
  simularApi,
} from "./teste-apoio";
import { CAMINHO_ARRECADADO } from "./visao-geral-api";

const ARRECADADO: RespostaArrecadado = {
  data: "2026-11-23",
  campanha: {
    pedidos_aprovados: 120,
    bilhetes: 1_234,
    total_centavos: 2_468_000,
  },
  hoje: { pedidos_aprovados: 40, bilhetes: 61, total_centavos: 144_000 },
  atualizado_em: "2026-11-23T20:00:00.000Z",
};

/** A API do painel e, por cima, a do Arrecadado (as respostas na ordem dada; a última se repete). */
function simular(...respostas: (RespostaArrecadado | Response)[]) {
  const api = simularApi(CENARIOS.emDia);
  const doPainel = globalThis.fetch;
  const pedidosDoArrecadado: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), "http://localhost");
      if (url.pathname !== CAMINHO_ARRECADADO) return doPainel(entrada, init);
      pedidosDoArrecadado.push(url.pathname);
      const resposta = respostas.length > 1 ? respostas.shift()! : respostas[0];
      return resposta instanceof Response
        ? resposta
        : respostaJson(respostaArrecadadoSchema.parse(resposta));
    }),
  );
  return { api, pedidosDoArrecadado };
}

async function abrirComoAdmin(...respostas: (RespostaArrecadado | Response)[]) {
  const simulado = simular(...respostas);
  renderizarRota("/coordenacao", { usuario: ADMIN_DE_TESTE });
  const titulo = await screen.findByRole("heading", {
    level: 2,
    name: "Arrecadado",
  });
  return {
    ...simulado,
    cartao: within(titulo.closest<HTMLElement>(".ui-card")!),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cartão Arrecadado (só o admin)", () => {
  it("admin: o total pago, os bilhetes pagos, o valor de hoje e a legenda, sem nada da Efí além da tarifa", async () => {
    const { cartao, pedidosDoArrecadado } = await abrirComoAdmin(ARRECADADO);

    expect(await cartao.findByText("R$ 24.680,00")).toBeInTheDocument();
    expect(
      cartao.getByText("1.234 bilhetes pagos na campanha"),
    ).toBeInTheDocument();
    const hoje = cartao.getByText(/^Hoje:/);
    expect(hoje).toHaveTextContent("Hoje: R$ 1.440,00 · 61 bilhetes");
    expect(cartao.getByText(LEGENDA_ARRECADADO)).toBeInTheDocument();
    expect(LEGENDA_ARRECADADO).toBe(
      "Soma dos bilhetes pagos recebidos da Rifei, antes da tarifa da Efí.",
    );
    expect(screen.queryByText(/saldo/i)).not.toBeInTheDocument();
    // O cartão tem a ajuda no título (a varredura da RIFA-066) e nenhum controle sem dica (RIFA-045).
    expect(controlesSemDica()).toEqual([]);
    expect(await titulosSemAjuda()).toEqual([]);
    // A primeira resposta do painel não pede o Arrecadado de novo.
    await screen.findByText(/^Atualizado às/, undefined, { timeout: 5000 });
    expect(pedidosDoArrecadado).toEqual([CAMINHO_ARRECADADO]);
  });

  it("fora das datas da campanha: o total e 'Hoje fica fora das datas da campanha'", async () => {
    const { cartao } = await abrirComoAdmin({ ...ARRECADADO, hoje: null });

    expect(await cartao.findByText("R$ 24.680,00")).toBeInTheDocument();
    expect(
      cartao.getByText("Hoje fica fora das datas da campanha."),
    ).toBeInTheDocument();
  });

  it("acompanha a atualização do painel: 'Atualizar' traz o painel novo e o Arrecadado de novo", async () => {
    const { api, cartao, pedidosDoArrecadado } = await abrirComoAdmin(
      ARRECADADO,
      {
        ...ARRECADADO,
        campanha: { ...ARRECADADO.campanha, total_centavos: 2_500_000 },
      },
    );
    expect(await cartao.findByText("R$ 24.680,00")).toBeInTheDocument();
    await screen.findByText(/^Atualizado às/, undefined, { timeout: 5000 });
    api.resumo = () =>
      respostaJson({
        ...resumoDoCenario(api.cenario, ESCOPO_CAMPANHA_RESOLVIDO),
        atualizado_em: "2026-11-06T18:01:00.000Z",
      });

    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));

    expect(await cartao.findByText("R$ 25.000,00")).toBeInTheDocument();
    expect(pedidosDoArrecadado).toHaveLength(2);
  });

  it("sem campanha ativa (404): uma nota, sem erro", async () => {
    const { cartao } = await abrirComoAdmin(
      respostaJson(
        {
          erro: {
            codigo: "nao_encontrado",
            mensagem: "A campanha ainda não foi configurada",
          },
        },
        404,
      ),
    );

    expect(
      await cartao.findByText(/Sem campanha ativa: o valor aparece/),
    ).toBeInTheDocument();
    expect(
      cartao.queryByRole("button", { name: "Tentar de novo" }),
    ).not.toBeInTheDocument();
  });

  it("a API falhou: o aviso de erro com 'Tentar de novo', que pede de novo e mostra o valor", async () => {
    const { cartao, pedidosDoArrecadado } = await abrirComoAdmin(
      respostaJson(
        { erro: { codigo: "erro_interno", mensagem: "Erro interno" } },
        500,
      ),
      ARRECADADO,
    );

    expect(
      await cartao.findByText("Não foi possível somar o arrecadado."),
    ).toBeInTheDocument();
    expect(controlesSemDica()).toEqual([]);
    fireEvent.click(cartao.getByRole("button", { name: "Tentar de novo" }));

    expect(await cartao.findByText("R$ 24.680,00")).toBeInTheDocument();
    expect(pedidosDoArrecadado).toHaveLength(2);
  });

  it("coordenação: sem o cartão e sem pedir a rota do Arrecadado", async () => {
    const { pedidosDoArrecadado } = simular(ARRECADADO);
    renderizarRota("/coordenacao", { usuario: USUARIO_DE_TESTE });
    await screen.findByText(/^Atualizado às/, undefined, { timeout: 5000 });
    await screen.findByRole("heading", {
      level: 2,
      name: "Relatório da campanha",
    });

    expect(
      screen.queryByRole("heading", { level: 2, name: "Arrecadado" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(pedidosDoArrecadado).toEqual([]));
  });
});
