import { afterEach, describe, expect, it, vi } from "vitest";
import { textosIguaisEmTempoConstante } from "./tempo-constante";

describe("CA1: comparação do token em tempo constante", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["iguais", "token-forte-123", "token-forte-123", true],
    [
      "diferentes só no último caractere",
      "token-forte-124",
      "token-forte-123",
      false,
    ],
    ["recebido é prefixo do segredo", "token-forte", "token-forte-123", false],
    [
      "segredo é prefixo do recebido",
      "token-forte-1234",
      "token-forte-123",
      false,
    ],
    ["recebido vazio", "", "token-forte-123", false],
    ["maiúsculas diferentes", "TOKEN-FORTE-123", "token-forte-123", false],
    ["iguais com acentos (UTF-8)", "senha-ção-é", "senha-ção-é", true],
  ])("%s", async (_caso, recebido, esperado, iguais) => {
    expect(await textosIguaisEmTempoConstante(recebido, esperado)).toBe(iguais);
  });

  it("compara dois resumos de 32 bytes com crypto.subtle.timingSafeEqual, mesmo com tamanhos diferentes", async () => {
    const comparar = vi.spyOn(crypto.subtle, "timingSafeEqual");

    const iguais = await textosIguaisEmTempoConstante(
      "curto",
      "um-segredo-bem-mais-comprido-que-o-texto-recebido",
    );

    expect(iguais).toBe(false);
    expect(comparar).toHaveBeenCalledOnce();
    const [resumoRecebido, resumoEsperado] = comparar.mock.calls[0];
    expect(resumoRecebido.byteLength).toBe(32);
    expect(resumoEsperado.byteLength).toBe(32);
  });
});
