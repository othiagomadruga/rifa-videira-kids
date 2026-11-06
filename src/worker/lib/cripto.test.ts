import { describe, expect, it } from "vitest";
import * as script from "../../../scripts/criar-acesso.mjs";
import { FORMATO_TOKEN_ACESSO } from "../../shared/contracts";
import {
  BYTES_SEGREDO,
  FORMATO_SEGREDO,
  gerarSegredo,
  sha256Hex,
} from "./cripto";

function decodificarBase64Url(texto: string): Uint8Array {
  const base64 = texto.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (caractere) => caractere.charCodeAt(0));
}

describe("segredos do acesso", () => {
  it("gerarSegredo: 32 bytes aleatórios em base64url sem '=' (43 caracteres), sem repetição", () => {
    const segredos = Array.from({ length: 2000 }, () => gerarSegredo());

    for (const segredo of segredos) {
      expect(segredo).toMatch(FORMATO_SEGREDO);
      expect(segredo).toMatch(FORMATO_TOKEN_ACESSO);
      expect(decodificarBase64Url(segredo)).toHaveLength(BYTES_SEGREDO);
    }
    expect(new Set(segredos).size).toBe(segredos.length);
    // Os 64 símbolos do base64url aparecem (não é hex nem um alfabeto reduzido).
    expect(new Set(segredos.join("")).size).toBe(64);
  });

  it("sha256Hex: vetores conhecidos do SHA-256, em hex minúsculo", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("o script de bootstrap gera e resume os segredos do mesmo jeito que o Worker", async () => {
    for (let i = 0; i < 50; i += 1) {
      const segredo = gerarSegredo();
      expect(await script.sha256Hex(segredo)).toBe(await sha256Hex(segredo));
      const tokenDoScript = script.gerarToken();
      expect(tokenDoScript).toMatch(FORMATO_SEGREDO);
      expect(decodificarBase64Url(tokenDoScript)).toHaveLength(BYTES_SEGREDO);
    }
    expect(await script.sha256Hex("Célula ✓")).toBe(
      await sha256Hex("Célula ✓"),
    );
  });
});
