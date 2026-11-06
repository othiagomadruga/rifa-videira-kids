// Importação de arquivo como texto pelo Vite (`import conteudo from "./arquivo.csv?raw"`), usada nos
// testes do Worker para ler arquivos do repositório (ex.: docs/modelos/hierarquia-modelo.csv).
declare module "*?raw" {
  const conteudo: string;
  export default conteudo;
}
