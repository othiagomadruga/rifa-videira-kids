// Setup dos testes do site (jsdom): matchers do jest-dom e limpeza do DOM.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
