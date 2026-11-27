// RIFA-095 (D43): a opção "Enviar notificações de venda" na tela Campanha: a caixa (com a ajuda), o que vai no PUT e o
// que se lê da campanha salva.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  formularioDaCampanha,
  formularioVazio,
  montarCorpo,
} from "./formulario";
import { CAMPO_NOTIFICACOES, OpcaoNotificacoes } from "./OpcaoNotificacoes";
import { CONFIGURADA } from "./teste-apoio";
import {
  AJUDA_NOTIFICACOES,
  textoDoResumoDasNotificacoes,
} from "./textos-notificacoes";

describe("Enviar notificações de venda", () => {
  it("a caixa marcada por padrão, com o rótulo e a ajuda; desmarcar avisa a tela", () => {
    const aoAlterar = vi.fn();
    render(
      <OpcaoNotificacoes
        ligada
        idDoCampo={(chave) => `campanha-${chave}`}
        aoAlterar={aoAlterar}
      />,
    );
    const caixa = screen.getByRole("checkbox", {
      name: "Enviar notificações de venda",
    });
    expect(caixa).toBeChecked();
    // A ajuda (RIFA-066) é a descrição da caixa, pelo id do "?" do rótulo.
    expect(caixa).toHaveAttribute(
      "aria-describedby",
      "campanha-notificacoes.vendas-dica",
    );
    expect(AJUDA_NOTIFICACOES.vendas).toMatch(
      /cada venda paga.*Nunca o nome de quem comprou nem valores em R\$/,
    );
    fireEvent.click(caixa);
    expect(aoAlterar).toHaveBeenCalledWith(false);
    expect(CAMPO_NOTIFICACOES).toBe("notificacoes.vendas");
  });

  it("o formulário: padrão ligado, lê a campanha salva e manda sempre o grupo no PUT", () => {
    expect(formularioVazio().notificacoes_vendas).toBe(true);
    expect(formularioDaCampanha(CONFIGURADA).notificacoes_vendas).toBe(true);
    const desligada = formularioDaCampanha({
      ...CONFIGURADA,
      notificacoes: { vendas: false },
    });
    expect(desligada.notificacoes_vendas).toBe(false);
    const corpo = montarCorpo(desligada, { regrasDoAdmin: false });
    expect(corpo.ok && corpo.corpo.notificacoes).toEqual({ vendas: false });
  });

  it("o resumo das regras", () => {
    expect(textoDoResumoDasNotificacoes(true)).toMatch(/^Ligadas:/);
    expect(textoDoResumoDasNotificacoes(false)).toBe(
      "Desligadas: o botão some e nenhuma notificação é enviada.",
    );
  });
});
