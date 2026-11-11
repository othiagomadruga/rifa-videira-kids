// Setup dos testes do site (jsdom): matchers do jest-dom, limpeza do DOM e do estado guardado em módulo.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { esquecerEstadoWebhook } from "../pages/pedidos/useEstadoWebhook";

afterEach(() => {
  cleanup();
  // O alerta de webhook guarda a última consulta no módulo (vale 5 min entre as telas): cada teste começa
  // como uma página recém-aberta, seja qual for a ordem.
  esquecerEstadoWebhook();
});
