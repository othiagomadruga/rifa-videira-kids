// Ajudantes de teste do site.
import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { App } from "../App";
import { rotas } from "../rotas";

/**
 * Renderiza o site inteiro (rotas reais) a partir de `caminho`, com roteador em
 * memória. Devolve também o roteador, para conferir roteador.state.location.
 */
export function renderizarRota(caminho: string) {
  const roteador = createMemoryRouter(rotas, { initialEntries: [caminho] });
  return { roteador, ...render(<App roteador={roteador} />) };
}

/** Resposta JSON para usar em mocks de fetch. */
export function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}
