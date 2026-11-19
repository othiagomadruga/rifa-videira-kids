// Tipos de scripts/definir-senha-admin.mjs para os testes do Worker (o script roda no Node, fora do build).
import type { ResultadoWrangler } from "./criar-acesso.mjs";

export declare const MINIMO_SENHA_ADMIN: number;
export declare const MAXIMO_SENHA_ADMIN: number;
export declare const FORMATO_USUARIO_ADMIN: RegExp;
export declare const ITERACOES_SENHA: number;
export declare const BYTES_SAL_SENHA: number;
export declare const USO: string;

export declare class ErroDeUso extends Error {}

export type AdminAlvo = { id: number } | { nome: string };

export declare function validarUsuario(usuario: unknown): string;
export declare function validarAdmin(admin: unknown): AdminAlvo;
export declare function problemaDaSenha(
  senha: string,
  usuario: string,
): string | null;
export declare function lerArgumentos(
  argv: readonly string[],
):
  | { ajuda: false; admin: AdminAlvo; usuario: string; remoto: boolean }
  | { ajuda: true };

export declare function hashDaSenha(
  senha: string,
  salHex: string,
  iteracoes?: number,
): Promise<string>;
export declare function prepararSenha(
  senha: string,
): Promise<{ sal: string; hash: string; iteracoes: number }>;
export declare function montarConsulta(dados: {
  admin: AdminAlvo;
  usuario: string;
}): string[];
export declare function montarGravacao(dados: {
  usuarioId: number;
  usuario: string;
  senha: { sal: string; hash: string; iteracoes: number };
  trocar: boolean;
}): string[];
export declare function lerResultados(
  saidaJson: string,
): Record<string, unknown>[][] | null;

export declare function principal(opcoes: {
  argv: readonly string[];
  executarWrangler: (argumentos: string[]) => Promise<ResultadoWrangler>;
  lerSenha: () => Promise<string>;
  escrever?: (texto: string) => void;
  escreverErro?: (texto: string) => void;
}): Promise<number>;
