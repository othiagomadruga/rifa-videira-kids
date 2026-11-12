// RIFA-044: o zod 4 testava `new Function("")` (eval) ao criar o primeiro schema de objeto, e o CSP do site
// (public/_headers, sem 'unsafe-eval') registrava a violação no console da tela Campanha. O pacote da Campanha (o
// único do site com o zod) liga o `jitless` antes de qualquer schema. A conferência no navegador, com o CSP do
// _headers, está no relatório da tarefa (build servido + Playwright).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import "./zod-sem-eval";

// O Vitest esvazia os imports de CSS e serve os módulos transformados: o texto do código vem do disco.
type ModuloFs = { readFileSync(caminho: string, codificacao: "utf8"): string };
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(nome: "node:fs"): ModuloFs };
};
const ler = (relativo: string) =>
  process
    .getBuiltinModule("node:fs")
    .readFileSync(
      decodeURIComponent(new URL(relativo, import.meta.url).pathname),
      "utf8",
    );

describe("RIFA-044: o zod sem eval no site", () => {
  it("o módulo liga o jitless do zod (sem o teste de eval)", () => {
    expect(z.config().jitless).toBe(true);
  });

  it("é o primeiro import do pacote da Campanha, antes do contrato criar os schemas", () => {
    const imports = ler("./ConfiguracaoCampanha.tsx")
      .split("\n")
      .filter((linha) => /^import\b/.test(linha));
    expect(imports[0]).toBe('import "./zod-sem-eval";');
  });

  it("o pacote da Campanha é carregado à parte (lazy), e é ele que traz o zod", () => {
    const pagina = ler("./CampanhaPage.tsx");
    expect(pagina).toMatch(
      /lazy\(\(\) =>\s*import\("\.\/ConfiguracaoCampanha"\)/,
    );
    expect(pagina).not.toMatch(/from "\.\.\/\.\.\/\.\.\/shared\/contracts"/);
  });
});
