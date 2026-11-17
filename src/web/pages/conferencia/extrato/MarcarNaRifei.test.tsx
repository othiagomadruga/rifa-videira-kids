// RIFA-070 (D28): "Marcar como pago na Rifei" na lista "Para marcar" do extrato, pela rota de verdade e com a API
// falsa. Só o admin vê o botão; a confirmação mostra os números; para a API vão só os NÚMEROS dos pedidos (nada do
// extrato); o resultado diz quantos foram marcados e quais não, com o motivo; sem a configuração, a tela manda usar o
// "Copiar os números". O caminho é a cópia do contrato.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROTAS_RIFEI_API } from "../../../../shared/contracts/api";
import {
  ADMIN_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../../test/renderizar";
import { CAMINHO_MARCAR_PAGOS } from "./marcar-na-rifei-api";
import { AGORA, OFX_SGML, PAGADORA_UM, criarApiDoExtrato } from "./teste-apoio";
import { CAMPOS, GRUPOS, MARCAR_NA_RIFEI } from "./textos";

const CAMINHO = "/coordenacao/conferencia";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: AGORA });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function abrirComExtrato(
  api: ReturnType<typeof criarApiDoExtrato>,
  admin = true,
) {
  vi.stubGlobal("fetch", api.fetch);
  renderizarRota(CAMINHO, admin ? { usuario: ADMIN_DE_TESTE } : undefined);
  const campo = await screen.findByLabelText(CAMPOS.arquivo.rotulo, undefined, {
    timeout: 5000,
  });
  fireEvent.change(campo, {
    target: { files: [new File([OFX_SGML], "extrato.ofx")] },
  });
  return screen.findByRole(
    "region",
    { name: GRUPOS.paraMarcar.titulo },
    {
      timeout: 5000,
    },
  );
}

describe("RIFA-070: Marcar como pago na Rifei", () => {
  it("o caminho é a cópia do contrato (POST, só admin)", () => {
    expect(CAMINHO_MARCAR_PAGOS).toBe(ROTAS_RIFEI_API.marcarPagosRifei.caminho);
    expect(ROTAS_RIFEI_API.marcarPagosRifei.metodo).toBe("POST");
    expect(ROTAS_RIFEI_API.marcarPagosRifei.papeis).toEqual(["admin"]);
  });

  it("a coordenação não vê o botão (só o Copiar)", async () => {
    const grupo = await abrirComExtrato(criarApiDoExtrato(), false);
    expect(
      within(grupo).queryByRole("button", { name: MARCAR_NA_RIFEI.botao(2) }),
    ).toBeNull();
  });

  it("o admin confirma, só os números vão à API e a tela mostra o resultado de cada pedido", async () => {
    const api = criarApiDoExtrato({
      marcarNaRifei: (pedidos) =>
        respostaJson({
          itens: pedidos.map((pedido_id, indice) => ({
            pedido_id,
            resultado: indice === 0 ? "marcado" : "recusado_pela_rifei",
            mensagem: indice === 0 ? null : "Este pedido não pode ser aprovado",
          })),
          marcados: 1,
        }),
    });
    const grupo = await abrirComExtrato(api);
    fireEvent.click(
      within(grupo).getByRole("button", { name: MARCAR_NA_RIFEI.botao(2) }),
    );
    const dialogo = await screen.findByRole("alertdialog");
    expect(
      within(dialogo).getByText("PEDTESTE0101, PEDTESTE0103"),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialogo).getByRole("button", { name: MARCAR_NA_RIFEI.confirmar }),
    );

    expect(
      await within(grupo).findByText(MARCAR_NA_RIFEI.resultadoTitulo(1, 2)),
    ).toBeInTheDocument();
    expect(
      within(grupo).getByText("Este pedido não pode ser aprovado"),
    ).toBeInTheDocument();
    expect(
      within(grupo).getByText(MARCAR_NA_RIFEI.resultados.recusado_pela_rifei),
    ).toBeInTheDocument();

    const posts = api.chamadas.filter((chamada) => chamada.metodo === "POST");
    expect(posts).toEqual([
      {
        metodo: "POST",
        url: CAMINHO_MARCAR_PAGOS,
        corpo: JSON.stringify({ pedidos: ["PEDTESTE0101", "PEDTESTE0103"] }),
      },
    ]);
    // Nada do extrato (o nome de quem pagou, o FITID) sai da tela.
    expect(JSON.stringify(api.chamadas)).not.toContain(PAGADORA_UM);

    // "Buscar de novo" busca os pedidos mesmo com a busca de antes cobrindo o extrato.
    const antes = api.pedidos().length;
    fireEvent.click(
      within(grupo).getByRole("button", { name: MARCAR_NA_RIFEI.buscarDeNovo }),
    );
    await waitFor(() => expect(api.pedidos().length).toBeGreaterThan(antes));
  });

  it("sem a configuração no servidor (503): a tela manda usar o Copiar os números", async () => {
    const api = criarApiDoExtrato({
      marcarNaRifei: () =>
        respostaJson(
          { erro: { codigo: "nao_configurado", mensagem: "Falta o segredo" } },
          503,
        ),
    });
    const grupo = await abrirComExtrato(api);
    fireEvent.click(
      within(grupo).getByRole("button", { name: MARCAR_NA_RIFEI.botao(2) }),
    );
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: MARCAR_NA_RIFEI.confirmar,
      }),
    );
    expect(
      await within(grupo).findByText(MARCAR_NA_RIFEI.semConfiguracao),
    ).toBeInTheDocument();
  });
});
