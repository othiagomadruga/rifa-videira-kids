import { describe, expect, it } from "vitest";
import { lerCorpoComLimite } from "./corpo-limitado";

function requisicao(
  corpo: BodyInit | null,
  headers?: Record<string, string>,
): Request {
  return new Request("http://localhost/", {
    method: "POST",
    body: corpo,
    headers,
  });
}

/** Fluxo com os bytes em pedaços de `tamanho` (sem Content-Length). */
function emPedacos(
  bytes: Uint8Array,
  tamanho: number,
): ReadableStream<Uint8Array> {
  let posicao = 0;
  return new ReadableStream({
    pull(controle) {
      if (posicao >= bytes.length) return controle.close();
      controle.enqueue(bytes.subarray(posicao, posicao + tamanho));
      posicao += tamanho;
    },
  });
}

describe("lerCorpoComLimite", () => {
  it("devolve o texto quando cabe no limite, inclusive no limite exato", async () => {
    expect(await lerCorpoComLimite(requisicao("abcde"), 5)).toBe("abcde");
    expect(await lerCorpoComLimite(requisicao("abcdef"), 5)).toBeNull();
  });

  it("sem corpo devolve texto vazio", async () => {
    expect(await lerCorpoComLimite(requisicao(null), 5)).toBe("");
  });

  it("conta bytes (não caracteres) e junta UTF-8 partido entre pedaços", async () => {
    const bytes = new TextEncoder().encode("ação é ótima");
    expect(bytes.length).toBe(16);

    expect(await lerCorpoComLimite(requisicao(emPedacos(bytes, 1)), 16)).toBe(
      "ação é ótima",
    );
    expect(
      await lerCorpoComLimite(requisicao(emPedacos(bytes, 3)), 15),
    ).toBeNull();
  });

  it("Content-Length acima do limite recusa antes de ler o corpo", async () => {
    const req = requisicao("abc", { "Content-Length": "999" });

    expect(await lerCorpoComLimite(req, 5)).toBeNull();
    expect(req.bodyUsed).toBe(false);
  });
});
