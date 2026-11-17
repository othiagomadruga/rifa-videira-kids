import {
  createBrowserRouter,
  createHashRouter,
  type DataRouter,
  type RouteObject,
} from "react-router";

/**
 * O roteador do site (main.tsx). O padrão é o do navegador: a tela vem do caminho do endereço (/telao).
 *
 * Só o build da apresentação publicada em /exemplo (RIFA-063, D28) liga o de hash, com `VITE_ROTEADOR=hash`
 * no `vite build`: a tela vem do hash (/exemplo/#/telao), o servidor só vê /exemplo/ e serve a página da
 * apresentação, e recarregar não cai no site oficial (o fallback de SPA serve o index.html da raiz). O build
 * do site não define a variável (roteador.test.ts).
 */
export function criarRoteador(
  rotas: RouteObject[],
  modo: string | undefined = import.meta.env.VITE_ROTEADOR,
): DataRouter {
  return modo === "hash" ? createHashRouter(rotas) : createBrowserRouter(rotas);
}
