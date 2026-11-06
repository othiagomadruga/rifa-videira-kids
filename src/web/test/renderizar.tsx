// Ajudantes de teste do site.
import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import type { UsuarioSessao } from "../../shared/contracts";
import { App } from "../App";
import { SessaoInicial } from "../lib/sessao";
import { rotas } from "../rotas";

/** Quem está conectado nos testes que não tratam da sessão (papel coordenacao, nome fictício). */
export const USUARIO_DE_TESTE: UsuarioSessao = {
  id: 900,
  nome: "Pessoa de Teste",
  papel: "coordenacao",
};

/** Admin fictício, para as telas que só o admin vê (ex.: /coordenacao/acessos). */
export const ADMIN_DE_TESTE: UsuarioSessao = {
  id: 901,
  nome: "Admin de Teste",
  papel: "admin",
};

type OpcoesRenderizar = {
  /**
   * Sessão já conhecida ao abrir, sem GET /api/sessao (padrão: USUARIO_DE_TESTE). Com `null`, o site
   * pergunta à API como no navegador: o fetch simulado precisa responder GET /api/sessao.
   */
  usuario?: UsuarioSessao | null;
};

/**
 * Renderiza o site inteiro (rotas reais) a partir de `caminho`, com roteador em
 * memória. Devolve também o roteador, para conferir roteador.state.location.
 */
export function renderizarRota(
  caminho: string,
  { usuario = USUARIO_DE_TESTE }: OpcoesRenderizar = {},
) {
  const roteador = createMemoryRouter(rotas, { initialEntries: [caminho] });
  return {
    roteador,
    ...render(
      <SessaoInicial value={usuario}>
        <App roteador={roteador} />
      </SessaoInicial>,
    ),
  };
}

/** Resposta JSON para usar em mocks de fetch. */
export function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}
