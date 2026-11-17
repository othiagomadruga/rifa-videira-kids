// O CSS global vem antes dos componentes, que trazem o próprio CSS.
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { criarRoteador } from "./roteador";
import { rotas } from "./rotas";

const raiz = document.getElementById("root");
if (!raiz) {
  throw new Error("Elemento #root não encontrado no index.html");
}

// O do navegador; só o build da apresentação de /exemplo usa o de hash (roteador.ts, D28).
const roteador = criarRoteador(rotas);

createRoot(raiz).render(
  <StrictMode>
    <App roteador={roteador} />
  </StrictMode>,
);
