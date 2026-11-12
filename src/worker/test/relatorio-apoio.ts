// Apoio aos testes do relatório para baixar (RIFA-038, D23): o corpo da resposta como ele chega ao disco.
import { expect } from "vitest";
import { respostaRelatorioCsvSchema } from "../../shared/contracts";

/** Os bytes do BOM do UTF-8 (EF BB BF), que o Excel em português precisa para ler os acentos. */
export const BYTES_DO_BOM = [0xef, 0xbb, 0xbf];

/**
 * O texto do CSV COM o BOM. `Response.text()` decodifica pelo padrão do Fetch, que descarta o BOM do começo: o
 * arquivo baixado (o `Blob` dos bytes) o tem, mas o texto lido assim não. Aqui os bytes são conferidos e decodificados
 * com `ignoreBOM: true`, que o mantém, e o texto passa pelo schema do contrato (`respostaRelatorioCsvSchema`, que
 * exige o BOM).
 */
export async function textoDoCsv(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect([...bytes.subarray(0, BYTES_DO_BOM.length)]).toEqual(BYTES_DO_BOM);
  return respostaRelatorioCsvSchema.parse(
    new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(bytes),
  );
}
