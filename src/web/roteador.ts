import { createBrowserRouter, createHashRouter } from "react-router";

/**
 * O roteador do site (main.tsx): o do navegador, com a tela no caminho do endereço (/telao).
 *
 * Só o build da apresentação publicada em /exemplo (RIFA-063, D28) usa o de hash, com `VITE_ROTEADOR=hash` no
 * `vite build`: a tela fica no hash (/exemplo/#/telao), o servidor só vê /exemplo/ e serve a página da apresentação,
 * e recarregar não cai no site oficial (o fallback de SPA serve o index.html da raiz). O build do site não define a
 * variável (roteador.test.ts): o Vite troca a comparação por `false` e o roteador de hash nem entra no pacote.
 */
export const criarRoteador =
  import.meta.env.VITE_ROTEADOR === "hash"
    ? createHashRouter
    : createBrowserRouter;
