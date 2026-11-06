// Comparação de segredos em tempo constante (D6 da integração com a Rifei).
//
// Compara os SHA-256 dos dois textos com crypto.subtle.timingSafeEqual (extensão do workerd).
// Os resumos têm sempre 32 bytes, então o tempo não depende de onde os textos diferem nem do
// tamanho do segredo (o timingSafeEqual exige tamanhos iguais e lançaria erro com os textos crus).

const codificador = new TextEncoder();

function resumoSha256(texto: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", codificador.encode(texto));
}

export async function textosIguaisEmTempoConstante(
  recebido: string,
  esperado: string,
): Promise<boolean> {
  const [resumoRecebido, resumoEsperado] = await Promise.all([
    resumoSha256(recebido),
    resumoSha256(esperado),
  ]);
  return crypto.subtle.timingSafeEqual(resumoRecebido, resumoEsperado);
}
