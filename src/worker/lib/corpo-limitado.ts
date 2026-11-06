// Leitura do corpo da requisição com limite de bytes, sem guardar na memória mais que o limite:
// um Content-Length acima dele recusa sem ler nada, e o fluxo é contado enquanto chega (o
// Content-Length pode faltar, como no envio em partes).

/** Texto UTF-8 do corpo, ou null se ele passa de `limite` bytes. */
export async function lerCorpoComLimite(
  requisicao: Request,
  limite: number,
): Promise<string | null> {
  const declarado = requisicao.headers.get("Content-Length");
  if (declarado !== null && Number(declarado) > limite) return null;
  if (requisicao.body === null) return "";

  const leitor = requisicao.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    const pedaco: Uint8Array = value;
    total += pedaco.byteLength;
    if (total > limite) {
      await leitor.cancel();
      return null;
    }
    pedacos.push(pedaco);
  }

  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, posicao);
    posicao += pedaco.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
