/**
 * Link pessoal novo (RIFA-007): o token (256 bits, só na resposta que cria o link), o hash que vai para o banco e
 * a URL `<origem>/acesso/<token>`. Usado na administração dos usuários (routes/admin-usuarios.ts) e nos links em
 * lote da hierarquia (routes/acessos-hierarquia.ts, RIFA-014).
 */
import type { Context } from "hono";
import {
  PREFIXO_LINK_ACESSO,
  VALIDADE_LINK_DIAS,
  type LinkAcessoCriado,
} from "../../shared/contracts";
import type { NovoLink } from "../db/acessos";
import { gerarSegredo, sha256Hex } from "./cripto";

const DIA_MS = 24 * 60 * 60 * 1000;

/** O link a gravar (só o hash vai para o banco) e o token, que só a resposta leva. */
export interface LinkGerado extends NovoLink {
  token: string;
}

/** Um link novo, válido por VALIDADE_LINK_DIAS a partir de `agora`. */
export async function gerarLink(agora: Date): Promise<LinkGerado> {
  const token = gerarSegredo();
  return {
    token,
    tokenHash: await sha256Hex(token),
    criadoEm: agora.toISOString(),
    expiraEm: new Date(
      agora.getTime() + VALIDADE_LINK_DIAS * DIA_MS,
    ).toISOString(),
  };
}

/** O link como sai na resposta de criação, com a URL `<origem>/acesso/<token>` (origem da requisição). */
export function linkCriado(
  c: Context,
  id: number,
  link: LinkGerado,
): LinkAcessoCriado {
  return {
    id,
    criado_em: link.criadoEm,
    expira_em: link.expiraEm,
    revogado_em: null,
    ultimo_uso_em: null,
    situacao: "valido",
    // Recém-criado: ainda não abriu nenhuma sessão (RIFA-043).
    desta_sessao: false,
    url: `${new URL(c.req.url).origin}${PREFIXO_LINK_ACESSO}${link.token}`,
  };
}
