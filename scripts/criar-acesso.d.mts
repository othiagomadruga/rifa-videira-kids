// Tipos de scripts/criar-acesso.mjs para os testes do Worker (o script roda no Node, fora do build).

export type PapelAcesso = "admin" | "coordenacao";

export declare const PAPEIS: readonly PapelAcesso[];
export declare const VALIDADE_LINK_DIAS: number;
export declare const ORIGEM_LOCAL: string;
export declare const PREFIXO_LINK_ACESSO: string;
export declare const USO: string;

export declare class ErroDeUso extends Error {}

export interface OpcoesAcesso {
  ajuda: false;
  nome: string;
  papel: PapelAcesso;
  remoto: boolean;
  origem: string;
}

export declare function validarNome(nome: unknown): string;
export declare function validarPapel(papel: unknown): PapelAcesso;
export declare function normalizarOrigem(
  origem: string,
  remoto?: boolean,
): string;
export declare function lerArgumentos(
  argv: readonly string[],
): OpcoesAcesso | { ajuda: true };

export declare function gerarToken(): string;
export declare function sha256Hex(texto: string): Promise<string>;

export declare function montarComandos(dados: {
  nome: string;
  papel: PapelAcesso;
  tokenHash: string;
  diasValidade?: number;
}): string[];

export interface AcessoPreparado {
  token: string;
  tokenHash: string;
  link: string;
  comandos: string[];
}

export declare function prepararAcesso(dados: {
  nome: string;
  papel: PapelAcesso;
  origem: string;
  diasValidade?: number;
}): Promise<AcessoPreparado>;

export interface ConfirmacaoAcesso {
  usuario_id: number;
  nome: string;
  papel: PapelAcesso;
  link_id: number;
  expira_em: string;
}

export declare function lerConfirmacao(
  saidaJson: string,
): ConfirmacaoAcesso | null;

export interface ResultadoWrangler {
  status: number;
  stdout: string;
  stderr: string;
}

export declare function principal(opcoes: {
  argv: readonly string[];
  executarWrangler: (argumentos: string[]) => Promise<ResultadoWrangler>;
  escrever?: (texto: string) => void;
  escreverErro?: (texto: string) => void;
}): Promise<number>;
