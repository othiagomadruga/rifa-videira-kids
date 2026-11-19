// O leitor do extrato em PDF (RIFA-068, D26), NO NAVEGADOR e num pacote à parte: este módulo (com o pdf.js) só é
// carregado pelo import() de leitura.ts quando a pessoa escolhe um PDF; o JS inicial e o da seção não mudam.
// - O pdf.js (a versão `legacy`, que roda nos navegadores de alguns anos atrás) lê o PDF num Web Worker do próprio
//   site: o arquivo do worker vai no build, com a URL resolvida pelo Vite (`?url`), e a CSP de produção
//   (`default-src 'self'`, sem eval e sem inline) deixa. A versão 6 não usa eval (a opção `isEvalSupported` saiu);
//   o equivalente aqui é `useWasm: false` (a CSP não tem 'wasm-unsafe-eval'). Sem as fontes de fora
//   (`useSystemFonts`, `disableFontFace`), sem o worker de desenho e sem rede: os bytes vão do arquivo escolhido
//   direto para o worker. Nada é desenhado nem gravado, e o documento (com o worker) é destruído no fim.
// - Só o texto de cada página, com a posição; pdf-linhas.ts monta as linhas, que vão para o leitor do texto colado.
// - PDF sem texto (escaneado ou fotografado) e PDF com senha: falhas claras (a tela não pede a senha).
import {
  getDocument,
  GlobalWorkerOptions,
  InvalidPDFException,
  PasswordException,
  VerbosityLevel,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import enderecoDoWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { FalhaDoExtrato } from "./lancamentos";
import { temTexto, textoDasPaginas, type TextoDoPdf } from "./pdf-linhas";
import { FALHAS_DO_PDF, MAXIMO_PAGINAS_PDF } from "./textos";

GlobalWorkerOptions.workerSrc = enderecoDoWorker;

/** O nome da exceção do pdf.js (a classe, ou o nome dela quando o erro vem copiado do worker). */
const nomeDoErro = (erro: unknown): string =>
  erro instanceof PasswordException
    ? "PasswordException"
    : erro instanceof InvalidPDFException
      ? "InvalidPDFException"
      : typeof erro === "object" && erro !== null && "name" in erro
        ? String(erro.name)
        : "";

/** O texto do PDF, linha por linha (para o leitor do texto colado), ou a falha. */
export async function lerTextoDoPdf(
  bytes: ArrayBuffer,
): Promise<{ ok: true; texto: string } | FalhaDoExtrato> {
  const tarefa = getDocument({
    data: new Uint8Array(bytes),
    useWasm: false,
    useSystemFonts: true,
    disableFontFace: true,
    disableWorkerRendering: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    enableXfa: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const documento = await tarefa.promise;
    if (documento.numPages > MAXIMO_PAGINAS_PDF) return FALHAS_DO_PDF.paginas;
    const paginas: TextoDoPdf[][] = [];
    for (let numero = 1; numero <= documento.numPages; numero++) {
      const pagina = await documento.getPage(numero);
      const conteudo = await pagina.getTextContent();
      paginas.push(
        conteudo.items.flatMap((item) =>
          "str" in item
            ? [
                {
                  texto: item.str,
                  x: Number(item.transform[4]),
                  y: Number(item.transform[5]),
                  largura: item.width,
                  altura: item.height,
                },
              ]
            : [],
        ),
      );
      pagina.cleanup();
    }
    if (!temTexto(paginas)) return FALHAS_DO_PDF.imagem;
    return { ok: true, texto: textoDasPaginas(paginas) };
  } catch (erro) {
    switch (nomeDoErro(erro)) {
      case "PasswordException":
        return FALHAS_DO_PDF.senha;
      case "InvalidPDFException":
        return FALHAS_DO_PDF.invalido;
      default:
        return FALHAS_DO_PDF.ilegivel;
    }
  } finally {
    await tarefa.destroy();
  }
}
