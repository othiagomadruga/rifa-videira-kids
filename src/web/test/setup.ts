// Setup dos testes do site (jsdom): matchers do jest-dom, limpeza do DOM e do estado guardado em módulo.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { esquecerTecladoDaDica } from "../components/ui/Dica";
import { esquecerRedes } from "../lib/redes";
import { esquecerEstadoWebhook } from "../pages/pedidos/useEstadoWebhook";

afterEach(() => {
  cleanup();
  // O alerta de webhook guarda a última consulta no módulo (vale 5 min entre as telas): cada teste começa
  // como uma página recém-aberta, seja qual for a ordem.
  esquecerEstadoWebhook();
  // As dicas (RIFA-045) guardam no módulo a última tecla de navegação (o foco do teclado abre a dica).
  esquecerTecladoDaDica();
  // Quantas redes a hierarquia tem (RIFA-065) também fica no módulo, entre as telas.
  esquecerRedes();
});
