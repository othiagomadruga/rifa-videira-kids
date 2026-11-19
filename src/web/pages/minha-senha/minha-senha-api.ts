// Chamadas da tela Minha senha (RIFA-073, D33; só admin): a senha de login do próprio admin. Do contrato vêm só os TIPOS
// (os valores trariam o zod para o pacote do site); o caminho é cópia de ROTAS_ACESSO, conferida por
// MinhaSenhaPage.test.tsx.
import type { RespostaSenhaAdmin } from "../../../shared/contracts";
import { api } from "../../lib/api";

/** ROTAS_ACESSO.obterMinhaSenhaAdmin, definirMinhaSenhaAdmin e removerMinhaSenhaAdmin (.caminho). */
export const CAMINHO_MINHA_SENHA = "/api/admin/minha-senha";

export function lerMinhaSenha(signal?: AbortSignal) {
  return api.get<RespostaSenhaAdmin>(CAMINHO_MINHA_SENHA, { signal });
}

export function salvarMinhaSenha(usuario: string, senha: string) {
  return api.put<RespostaSenhaAdmin>(CAMINHO_MINHA_SENHA, { usuario, senha });
}

export function removerMinhaSenha() {
  return api.delete(CAMINHO_MINHA_SENHA);
}
