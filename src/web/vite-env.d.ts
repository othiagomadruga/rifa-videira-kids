// Variáveis de build do site (import.meta.env). Só o build da apresentação de /exemplo define VITE_ROTEADOR
// (roteador.ts, D28); o do site não define nenhuma.
interface ImportMetaEnv {
  readonly VITE_ROTEADOR?: string;
}
