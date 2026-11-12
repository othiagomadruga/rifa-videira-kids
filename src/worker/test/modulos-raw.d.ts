// Importação de arquivo como texto pelo Vite (`import conteudo from "./arquivo.csv?raw"`), usada nos
// testes do Worker para ler arquivos do repositório (ex.: docs/modelos/hierarquia-modelo.csv).
declare module "*?raw" {
  const conteudo: string;
  export default conteudo;
}

// `import.meta.glob` do Vite com os arquivos como texto (sem os tipos de vite/client no Worker): só a forma usada
// nos testes (ex.: os workflows em src/worker/config-publicacao.test.ts).
interface ImportMeta {
  glob(
    padrao: string,
    opcoes: { query: "?raw"; import: "default"; eager: true },
  ): Record<string, string>;
}
