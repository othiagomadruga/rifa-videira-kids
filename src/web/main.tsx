// O CSS global vem antes dos componentes, que trazem o próprio CSS.
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { App } from "./App";
import { rotas } from "./rotas";

const raiz = document.getElementById("root");
if (!raiz) {
  throw new Error("Elemento #root não encontrado no index.html");
}

const roteador = createBrowserRouter(rotas);

createRoot(raiz).render(
  <StrictMode>
    <App roteador={roteador} />
  </StrictMode>,
);
