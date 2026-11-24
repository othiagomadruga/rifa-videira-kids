/**
 * A conexão com a API da Rifei que vale numa requisição (RIFA-070, docs/decisions.md D32; separada de routes/rifei.ts
 * na RIFA-091 para a atribuição de célula, em routes/pedidos.ts, usar a mesma):
 * - o token da tela (no D1, cifrado com o segredo RIFEI_CHAVE_CIFRA) tem prioridade; sem ele, o segredo
 *   RIFEI_API_TOKEN; sem nenhum dos dois, `sem_token`; com o da tela que a chave não abre, `token_ilegivel`;
 * - `uso` junta o que a Rifei respondeu nesta requisição, e `registrarUsoDaConexao` grava na linha da tela o último
 *   sucesso ou a recusa do token (401/403).
 * O token nunca sai daqui: nem para log, nem para resposta, nem para a trilha.
 */
import {
  SEGREDO_API_RIFEI,
  SEGREDO_CHAVE_CIFRA_RIFEI,
  apiRifeiConfigurada,
  chaveCifraRifeiConfigurada,
} from "../../shared/contracts";
import {
  lerConexaoRifei,
  registrarUsoDaConexaoRifei,
  type LinhaConexaoRifei,
} from "../db/rifei";
import { decifrarTokenRifei } from "./cifra-rifei";
import { criarClienteRifei, type ClienteRifei } from "./rifei-api";

export interface ConexaoEmUso {
  api: ClienteRifei;
  /** O token cifrado da linha da tela (null quando vale o segredo do Worker). */
  tokenCifrado: string | null;
  uso: { ok: boolean; recusado: boolean };
}

/** Por que não há conexão: nenhum token, ou o da tela não pode ser lido (a chave mudou ou sumiu). */
export type SemConexaoRifei = "sem_token" | "token_ilegivel";

/** O token da tela aberto com a chave; null sem chave ou se a chave não abre. */
export async function abrirTokenDaTela(
  env: Cloudflare.Env,
  linha: LinhaConexaoRifei,
): Promise<string | null> {
  const chave = env[SEGREDO_CHAVE_CIFRA_RIFEI];
  if (!chaveCifraRifeiConfigurada(chave)) return null;
  return decifrarTokenRifei(linha.token_cifrado, chave ?? "");
}

function clienteComUso(token: string, uso: ConexaoEmUso["uso"]): ClienteRifei {
  return criarClienteRifei(token, {
    aoResponder: (status) => {
      if (status === 401 || status === 403) uso.recusado = true;
      else if (status < 500 && status !== 429) uso.ok = true;
    },
  });
}

/** A conexão para chamar a Rifei, ou por que não há. */
export async function abrirConexaoRifei(
  env: Cloudflare.Env,
): Promise<ConexaoEmUso | SemConexaoRifei> {
  const uso = { ok: false, recusado: false };
  const linha = await lerConexaoRifei(env.DB);
  if (linha) {
    const token = await abrirTokenDaTela(env, linha);
    if (token === null) return "token_ilegivel";
    return {
      api: clienteComUso(token, uso),
      tokenCifrado: linha.token_cifrado,
      uso,
    };
  }
  const segredo = env[SEGREDO_API_RIFEI];
  if (!apiRifeiConfigurada(segredo)) return "sem_token";
  return { api: clienteComUso(segredo ?? "", uso), tokenCifrado: null, uso };
}

/** Grava o que a Rifei respondeu ao token da tela nesta requisição: recusa (401/403) ou sucesso. */
export async function registrarUsoDaConexao(
  db: D1Database,
  { uso, tokenCifrado }: ConexaoEmUso,
): Promise<void> {
  if (tokenCifrado !== null && (uso.ok || uso.recusado))
    await registrarUsoDaConexaoRifei(
      db,
      tokenCifrado,
      uso.recusado ? "recusado" : "ok",
      new Date().toISOString(),
    );
}
