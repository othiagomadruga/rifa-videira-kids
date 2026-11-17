// RIFA-063 (D28): o site continua com o roteador do navegador; o de hash é só do build da apresentação de
// /exemplo (VITE_ROTEADOR=hash), que o build do site não define.
import {
  createBrowserRouter,
  createHashRouter,
  type DataRouter,
  type RouteObject,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import ci from "../../.github/workflows/ci.yml?raw";
import pacote from "../../package.json?raw";
import viteConfig from "../../vite.config.ts?raw";
import wrangler from "../../wrangler.jsonc?raw";
import mainTsx from "./main.tsx?raw";
import { criarRoteador } from "./roteador";

type ModuloFs = {
  readFileSync(caminho: string, codificacao: "utf8"): string;
  readdirSync(caminho: string): string[];
};
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
const fs = process.getBuiltinModule("node:fs");
// O caminho vai numa variável: com um texto fixo, o Vite trocaria o new URL(..., import.meta.url) pela URL do asset.
const RAIZ = "../../";
const pastaRaiz = decodeURIComponent(new URL(RAIZ, import.meta.url).pathname);

const ROTAS: RouteObject[] = [
  {
    path: "/",
    children: [
      { index: true, element: null },
      { path: "telao", element: null },
      { path: "minha", element: null },
    ],
  },
];

let roteador: DataRouter | null = null;

afterEach(() => {
  roteador?.dispose();
  roteador = null;
  vi.unstubAllEnvs();
  vi.resetModules();
  window.history.replaceState(null, "", "/");
});

/** O roteador.ts avaliado de novo com VITE_ROTEADOR=<valor> (como num build com a variável). */
async function roteadorDoBuildCom(valor: string) {
  vi.stubEnv("VITE_ROTEADOR", valor);
  vi.resetModules();
  return (await import("./roteador")).criarRoteador;
}

describe("criarRoteador", () => {
  it("sem VITE_ROTEADOR (o build do site): o do navegador, com a tela no caminho do endereço", async () => {
    expect(import.meta.env.VITE_ROTEADOR).toBeUndefined();
    expect(criarRoteador).toBe(createBrowserRouter);
    window.history.replaceState(null, "", "/telao");

    roteador = criarRoteador(ROTAS);

    expect(roteador.state.location.pathname).toBe("/telao");
    await roteador.navigate("/minha");
    expect(window.location.pathname).toBe("/minha");
    expect(window.location.hash).toBe("");
  });

  it("VITE_ROTEADOR=hash (só a apresentação): a tela no hash, e o caminho do endereço não muda", async () => {
    const doBuild = await roteadorDoBuildCom("hash");
    expect(doBuild).toBe(createHashRouter);
    window.history.replaceState(null, "", "/exemplo/#/telao");

    roteador = doBuild(ROTAS);

    expect(roteador.state.location.pathname).toBe("/telao");
    await roteador.navigate("/minha");
    expect(window.location.pathname).toBe("/exemplo/");
    expect(window.location.hash).toBe("#/minha");
  });

  it("outro valor qualquer: o do navegador", async () => {
    expect(await roteadorDoBuildCom("memoria")).toBe(createBrowserRouter);
  });
});

describe("o build do site não liga o roteador de hash", () => {
  it("main.tsx cria o roteador por criarRoteador(rotas), sem escolher o modo", () => {
    expect(mainTsx).toMatch(/criarRoteador\(rotas\)/);
    expect(mainTsx).not.toMatch(/createHashRouter|VITE_ROTEADOR|"hash"/);
  });

  it("nem a configuração do build, nem o CI, nem os .env da raiz definem VITE_ROTEADOR", () => {
    const envs = fs
      .readdirSync(pastaRaiz)
      .filter((nome) => /^\.env/.test(nome))
      .map((nome) => fs.readFileSync(`${pastaRaiz}${nome}`, "utf8"));
    for (const texto of [viteConfig, pacote, ci, wrangler, ...envs])
      expect(texto).not.toContain("VITE_ROTEADOR");
  });
});
