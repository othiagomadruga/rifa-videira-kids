// Ajudante dos testes de download (baixarArquivo, em lib/api.ts): o jsdom não tem URL.createObjectURL nem baixa
// arquivos. espiarDownloads() troca o createObjectURL e o revokeObjectURL por espiões (cada endereço guarda o seu
// Blob) e o click() dos links com `download` por um que só anota o que seria baixado: o endereço, o nome e se o
// link estava na página durante o clique. O click() dos outros elementos continua o de sempre. No afterEach,
// desfazer().
import { vi } from "vitest";

export type CliqueDeDownload = {
  endereco: string;
  nome: string;
  /** O link estava no documento durante o clique (alguns navegadores só baixam assim). */
  naPagina: boolean;
};

type Descritor = PropertyDescriptor | undefined;

function restaurar(
  nome: "createObjectURL" | "revokeObjectURL",
  antes: Descritor,
) {
  if (antes) Object.defineProperty(URL, nome, antes);
  else Reflect.deleteProperty(URL, nome);
}

export function espiarDownloads() {
  const arquivos = new Map<string, Blob>();
  const liberados: string[] = [];
  const cliques: CliqueDeDownload[] = [];
  const antes = {
    criar: Object.getOwnPropertyDescriptor(URL, "createObjectURL"),
    liberar: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL"),
  };
  let contador = 0;
  const criar = vi.fn((arquivo: Blob) => {
    contador += 1;
    const endereco = `blob:${window.location.origin}/arquivo-${contador}`;
    arquivos.set(endereco, arquivo);
    return endereco;
  });
  const liberar = vi.fn((endereco: string) => {
    liberados.push(endereco);
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: criar,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: liberar,
  });
  const clickOriginal = HTMLElement.prototype.click;
  const clique = vi
    .spyOn(HTMLElement.prototype, "click")
    .mockImplementation(function (this: HTMLElement) {
      if (this instanceof HTMLAnchorElement && this.download) {
        cliques.push({
          endereco: this.href,
          nome: this.download,
          naPagina: this.isConnected,
        });
        return;
      }
      clickOriginal.call(this);
    });

  return {
    criar,
    liberar,
    arquivos,
    liberados,
    cliques,
    /** O texto do arquivo baixado no clique `indice`, com o BOM (o Blob.text() o tiraria). */
    async texto(indice = 0): Promise<string> {
      const arquivo = arquivos.get(cliques[indice]?.endereco ?? "");
      if (!arquivo) throw new Error(`nenhum arquivo no clique ${indice}`);
      return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
        await arquivo.arrayBuffer(),
      );
    },
    desfazer() {
      clique.mockRestore();
      restaurar("createObjectURL", antes.criar);
      restaurar("revokeObjectURL", antes.liberar);
    },
  };
}
