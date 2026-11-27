// @vitest-environment node
// RIFA-095 (D43): scripts/gerar-chaves-vapid.mjs. O par sai no formato que o Worker aceita (a pública com 87
// caracteres, a privada com 43), as duas são do mesmo par, a privada vai só para um arquivo novo com permissão 600 e
// nunca para o terminal.
import { webcrypto } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  gerarChavesVapid,
  lerArquivoDaPrivada,
  principal,
} from "./gerar-chaves-vapid.mjs";

const pasta = mkdtempSync(join(tmpdir(), "vapid-teste-"));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe("gerar-chaves-vapid", () => {
  it("o par no formato do Worker, e a privada assina o que a pública confere", async () => {
    const { publica, privada } = await gerarChavesVapid();
    expect(publica).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(privada).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const bytes = Buffer.from(publica, "base64url");
    const chavePrivada = await webcrypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        d: privada,
        x: bytes.subarray(1, 33).toString("base64url"),
        y: bytes.subarray(33, 65).toString("base64url"),
      },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const chavePublica = await webcrypto.subtle.importKey(
      "raw",
      bytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const texto = new TextEncoder().encode("teste");
    const assinatura = await webcrypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      chavePrivada,
      texto,
    );
    expect(
      await webcrypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        chavePublica,
        assinatura,
        texto,
      ),
    ).toBe(true);
  });

  it("a privada vai só para o arquivo novo (600, sem quebra de linha); o terminal mostra só a pública", async () => {
    const arquivo = join(pasta, "vapid-privada");
    const linhas = [];
    const { publica } = await principal(["--privada", arquivo], (linha) =>
      linhas.push(linha),
    );
    const privada = readFileSync(arquivo, "utf8");
    expect(privada).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(statSync(arquivo).mode & 0o777).toBe(0o600);
    const terminal = linhas.join("\n");
    expect(terminal).toContain(publica);
    expect(terminal).not.toContain(privada);
    expect(terminal).toContain("wrangler secret put VAPID_PRIVATE_KEY");
  });

  it("não escreve por cima de um arquivo que existe e exige --privada", async () => {
    const arquivo = join(pasta, "ja-existe");
    writeFileSync(arquivo, "outra coisa");
    await expect(principal(["--privada", arquivo], () => {})).rejects.toThrow(
      /EEXIST/,
    );
    expect(readFileSync(arquivo, "utf8")).toBe("outra coisa");
    await expect(principal([], () => {})).rejects.toThrow(/--privada/);
    expect(lerArquivoDaPrivada(["--privada", "--outra"])).toBeNull();
  });
});
