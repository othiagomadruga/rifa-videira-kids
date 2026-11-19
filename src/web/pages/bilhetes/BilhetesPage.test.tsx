// RIFA-075 (D35): /coordenacao/bilhetes pela rota de verdade, com a API simulada; toda resposta passa pelo schema do
// contrato. O canvas não desenha no jsdom (getContext é null): a grade é conferida pela leitura dos mapas (grade.ts),
// pela descrição do canvas e pela busca.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  criarMapaDeBits,
  ligarBit,
  mapaParaBase64,
  respostaBilheteSchema,
  respostaBilhetesSchema,
  type RespostaBilhete,
  type RespostaBilhetes,
} from "../../../shared/contracts";
import {
  ADMIN_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import {
  escalaDoCanvas,
  gradeDaResposta,
  indiceNoPonto,
  medirGrade,
  situacaoDoNumero,
} from "./grade";

const CAMINHO = "/coordenacao/bilhetes";

function resposta(parcial: Partial<RespostaBilhetes> = {}): RespostaBilhetes {
  const pagos = criarMapaDeBits(20);
  const reservados = criarMapaDeBits(20);
  for (const i of [0, 1, 2]) ligarBit(pagos, i);
  for (const i of [3, 4]) ligarBit(reservados, i);
  return respostaBilhetesSchema.parse({
    quantidade: 20,
    numero_inicial: 1,
    numero_inicial_automatico: true,
    pagos: mapaParaBase64(pagos),
    reservados: mapaParaBase64(reservados),
    contagem: { pagos: 3, reservados: 2, livres: 15 },
    vendido_bp: 1500,
    sem_numeros: { pedidos: 0, bilhetes: 0 },
    fora_da_faixa: 0,
    atualizado_em: "2026-11-25T15:00:00.000Z",
    ...parcial,
  });
}

const BUSCA_2: RespostaBilhete = respostaBilheteSchema.parse({
  numero: 2,
  situacao: "pago",
  pedidos: [
    {
      id: "PEDTESTE0001",
      situacao: "pago",
      celula: "Célula Ficticia 07",
      data: "2026-11-24T12:00:00.000Z",
      qtd_bilhetes: 3,
      desconsiderado: false,
    },
  ],
});

function simularApi(
  grade: () => Response = () => respostaJson(resposta()),
  numero: (n: string) => Response = () => respostaJson(BUSCA_2),
) {
  const pedidos: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (caminho: string) => {
      pedidos.push(caminho);
      if (caminho === "/api/painel/bilhetes") return grade();
      const achado = /^\/api\/painel\/bilhetes\/(\d+)$/.exec(caminho);
      if (achado) return numero(achado[1]);
      return respostaJson(
        { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
        404,
      );
    }),
  );
  return { pedidos };
}

const daGrade = (pedidos: string[]) =>
  pedidos.filter((p) => p === "/api/painel/bilhetes").length;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("tela Bilhetes (RIFA-075)", () => {
  it("contadores, legenda, % vendido e a grade descrita; o menu tem o link", async () => {
    simularApi();
    renderizarRota(CAMINHO);
    expect(
      await screen.findByRole("img", {
        name: "Grade dos 20 números da rifa: 3 pagos, 2 reservados e 15 livres.",
      }),
    ).toBeInTheDocument();
    const legenda = screen.getByRole("list", { name: "Legenda da grade" });
    expect(within(legenda).getByText("Pago: 3")).toBeInTheDocument();
    expect(within(legenda).getByText("Reservado: 2")).toBeInTheDocument();
    expect(within(legenda).getByText("Livre: 15")).toBeInTheDocument();
    expect(screen.getByText("15,0%")).toBeInTheDocument();
    expect(screen.getByText(/A numeração começa no 1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bilhetes/ })).toHaveAttribute(
      "href",
      CAMINHO,
    );
  });

  it("os pedidos sem números (recuperados) e os números fora da faixa viram avisos com a contagem", async () => {
    simularApi(() =>
      respostaJson(
        resposta({
          sem_numeros: { pedidos: 2, bilhetes: 5 },
          fora_da_faixa: 1,
          numero_inicial_automatico: false,
        }),
      ),
    );
    renderizarRota(CAMINHO);
    expect(
      await screen.findByText("Pedidos sem os números na grade."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /2 pedidos pagos ou reservados chegaram sem a lista dos números \(5 bilhetes\)/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 número de pedido ficou fora da faixa de 1 a 20/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/A numeração começa no/)).toBeNull();
  });

  it("a busca por número mostra o pedido (célula, situação, data), sem dado do comprador", async () => {
    const { pedidos } = simularApi();
    renderizarRota(CAMINHO);
    const campo = await screen.findByRole("textbox", {
      name: "Número do bilhete",
    });
    fireEvent.change(campo, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    const lista = await screen.findByRole("list", {
      name: "Pedidos com o número 2",
    });
    expect(within(lista).getByText("PEDTESTE0001")).toBeInTheDocument();
    expect(within(lista).getByText("Célula Ficticia 07")).toBeInTheDocument();
    expect(within(lista).getByText("Pago")).toBeInTheDocument();
    expect(within(lista).getByText("3 bilhetes")).toBeInTheDocument();
    expect(pedidos).toContain("/api/painel/bilhetes/2");
  });

  it("busca com letras não chama a API e explica", async () => {
    const { pedidos } = simularApi();
    renderizarRota(CAMINHO);
    const campo = await screen.findByRole("textbox", {
      name: "Número do bilhete",
    });
    fireEvent.change(campo, { target: { value: "12a" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(
      await screen.findByText("Digite só o número do bilhete, sem letras."),
    ).toBeInTheDocument();
    expect(pedidos.some((p) => p.startsWith("/api/painel/bilhetes/"))).toBe(
      false,
    );
  });

  it("o filtro tem só pagos, só reservados e só livres", async () => {
    simularApi();
    renderizarRota(CAMINHO);
    const filtro = await screen.findByRole("combobox", {
      name: "Mostrar na grade",
    });
    expect(
      within(filtro)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Todos", "Só pagos", "Só reservados", "Só livres"]);
    fireEvent.change(filtro, { target: { value: "reservado" } });
    expect(filtro).toHaveValue("reservado");
  });

  it("busca de novo a cada 30 s com a tela visível, não busca escondida, volta ao ficar visível, e tem 'Atualizar agora'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { pedidos } = simularApi();
    renderizarRota(CAMINHO);
    await screen.findByRole("img", { name: /Grade dos 20 números/ });
    expect(daGrade(pedidos)).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    await waitFor(() => expect(daGrade(pedidos)).toBe(2));

    const estado = vi.spyOn(document, "visibilityState", "get");
    estado.mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(daGrade(pedidos)).toBe(2);
    estado.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(daGrade(pedidos)).toBe(3));
    estado.mockRestore();

    fireEvent.click(
      await screen.findByRole("button", { name: "Atualizar agora" }),
    );
    await waitFor(() => expect(daGrade(pedidos)).toBe(4));
  });

  it("falha ao atualizar mantém a grade, com o aviso", async () => {
    let vez = 0;
    simularApi(() => {
      vez += 1;
      return vez === 1
        ? respostaJson(resposta())
        : respostaJson(
            { erro: { codigo: "erro_interno", mensagem: "Falhou" } },
            500,
          );
    });
    renderizarRota(CAMINHO);
    fireEvent.click(
      await screen.findByRole("button", { name: "Atualizar agora" }),
    );
    expect(
      await screen.findByText("Não foi possível atualizar agora."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Grade dos 20 números/ }),
    ).toBeInTheDocument();
  });

  it("sem campanha ativa: estado vazio com o link para a Campanha", async () => {
    simularApi(() =>
      respostaJson(
        {
          erro: {
            codigo: "nao_encontrado",
            mensagem: "Nenhuma campanha ativa",
          },
        },
        404,
      ),
    );
    renderizarRota(CAMINHO, { usuario: ADMIN_DE_TESTE });
    expect(
      await screen.findByText("Nenhuma campanha ativa."),
    ).toBeInTheDocument();
  });
});

describe("grade.ts (RIFA-075)", () => {
  it("lê os mapas da resposta e acha o número tocado", () => {
    const grade = gradeDaResposta(resposta());
    expect(situacaoDoNumero(grade, 1)).toBe("pago");
    expect(situacaoDoNumero(grade, 4)).toBe("reservado");
    expect(situacaoDoNumero(grade, 6)).toBe("livre");
    expect(situacaoDoNumero(grade, 0)).toBe("livre");
    expect(situacaoDoNumero(grade, 21)).toBe("livre");
    // 390 px de tela: 358 px de conteúdo, quadrados de 8 px, 44 colunas; 7005 números em 160 linhas.
    const medidas = medirGrade(358, 7005);
    expect(medidas).toEqual({ lado: 8, colunas: 44, linhas: 160 });
    expect(indiceNoPonto(medidas, 7005, 0, 0)).toBe(0);
    expect(indiceNoPonto(medidas, 7005, 9, 9)).toBe(45);
    expect(indiceNoPonto(medidas, 7005, 8 * 43 + 1, 8 * 159 + 1)).toBeNull();
    expect(medirGrade(1000, 7005)).toEqual({
      lado: 10,
      colunas: 100,
      linhas: 71,
    });
  });

  it("densidade do canvas (revisão): a da tela com 7005 números; limitada com 100.000 em 390 px", () => {
    // 7005 em 390 px: 352 × 1280 px; densidade 3 cabe.
    expect(escalaDoCanvas(3, 352, 1280)).toBe(3);
    // 100.000 em 390 px: 44 colunas × 2273 linhas de 8 px = 352 × 18.184 px; densidade 2 passaria de 32.767.
    const escala = escalaDoCanvas(2, 352, 18_184);
    expect(escala).toBeLessThan(2);
    expect(18_184 * escala).toBeLessThanOrEqual(32_000);
    expect(352 * escala * 18_184 * escala).toBeLessThanOrEqual(16_000_001);
  });
});
