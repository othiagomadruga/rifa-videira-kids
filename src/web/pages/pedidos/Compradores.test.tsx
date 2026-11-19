// RIFA-076 (D36): na tela Pedidos, SÓ o admin vê a coluna "Comprador" (nome e telefone, com o link do WhatsApp) e o
// botão "Exportar compradores (Excel)"; a coordenação não vê nenhum dos dois (e a API nem manda o campo para ela).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
} from "../../test/renderizar";
import { pedido, simularApi } from "./teste-apoio";

const ROTA_COMPRADORES = "/api/admin/pedidos/compradores";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tabela = () =>
  screen.findByRole("table", {
    name: "Pedidos, do mais recente para o mais antigo",
  });

function pedidosDoTeste() {
  return [
    pedido(2, {
      id: "PED-COM",
      comprador: { nome: "Maria Ficticia", telefone: "+5511987654321" },
    }),
    pedido(1, { id: "PED-SEM", comprador: { nome: null, telefone: null } }),
  ];
}

describe("coluna Comprador e planilha de compradores", () => {
  it("admin: a coluna com nome e telefone legível (link do WhatsApp) e 'Sem nome'/'Sem telefone'", async () => {
    simularApi({ pedidos: pedidosDoTeste() });
    renderizarRota("/coordenacao/pedidos", { usuario: ADMIN_DE_TESTE });

    const lista = await tabela();
    expect(
      within(lista).getByRole("columnheader", { name: "Comprador" }),
    ).toBeInTheDocument();
    expect(within(lista).getByText("Maria Ficticia")).toBeInTheDocument();
    const link = within(lista).getByRole("link", { name: /\(11\) 98765-4321/ });
    expect(link).toHaveAttribute("href", "https://wa.me/5511987654321");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(lista).getByText("Sem nome")).toBeInTheDocument();
    expect(within(lista).getByText("Sem telefone")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Exportar compradores \(Excel\)/ }),
    ).toBeInTheDocument();
  });

  it("coordenação: sem a coluna e sem o botão", async () => {
    simularApi({ pedidos: [pedido(1, { id: "PED-COORD" })] });
    renderizarRota("/coordenacao/pedidos", { usuario: USUARIO_DE_TESTE });

    const lista = await tabela();
    expect(
      within(lista).queryByRole("columnheader", { name: "Comprador" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Exportar compradores/ }),
    ).not.toBeInTheDocument();
  });

  it("admin: 'Só quem pagou' + exportar baixa a planilha com so_pagou=true e anuncia o nome do arquivo", async () => {
    simularApi({ pedidos: pedidosDoTeste() });
    const daApi = globalThis.fetch;
    const pedidas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(entrada), "http://localhost");
        if (url.pathname !== ROTA_COMPRADORES) return daApi(entrada, init);
        pedidas.push(`${url.pathname}${url.search}`);
        return new Response("﻿Nome;Telefone\r\n", {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="rifa-videira-kids-compradores-2026-11-23.csv"',
          },
        });
      }),
    );
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:ficticio"),
        revokeObjectURL: vi.fn(),
      }),
    );
    const clique = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    renderizarRota("/coordenacao/pedidos", { usuario: ADMIN_DE_TESTE });

    await tabela();
    fireEvent.click(screen.getByRole("checkbox", { name: "Só quem pagou" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Exportar compradores \(Excel\)/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          /Baixado: rifa-videira-kids-compradores-2026-11-23\.csv/,
        ),
      ).toBeInTheDocument(),
    );
    expect(pedidas).toEqual([`${ROTA_COMPRADORES}?so_pagou=true`]);
    expect(clique).toHaveBeenCalledTimes(1);
  });
});
