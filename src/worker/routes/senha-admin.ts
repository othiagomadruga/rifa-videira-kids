/**
 * A senha de login do próprio admin (RIFA-073; docs/decisions.md D33), montada em /api/admin (atrás do login do passo 4
 * do index.ts). Só o papel admin: o sub-app exige no caminho dele, nunca num use("*") (que valeria para todo
 * /api/admin/*). Sempre a senha do admin DA SESSÃO: não há como mexer na senha de outra pessoa.
 *
 * - GET /api/admin/minha-senha → 200 { definida, usuario, atualizada_em } (nunca a senha nem o hash);
 * - PUT /api/admin/minha-senha { usuario, senha } → 200 o mesmo: define ou troca (a trilha registra
 *   `senha_admin.definir` ou `senha_admin.trocar`); trocar encerra as OUTRAS sessões dele abertas pela senha.
 *   409 `em_uso`: o usuário de login já é de outro admin;
 * - DELETE /api/admin/minha-senha → 204: remove a senha e encerra as sessões abertas por ela (`senha_admin.remover`).
 */
import { Hono } from "hono";
import {
  ROTAS_ACESSO,
  corpoDefinirSenhaAdminSchema,
  type RespostaSenhaAdmin,
} from "../../shared/contracts";
import {
  gravarSenhaDoAdmin,
  lerSenhaDoAdmin,
  removerSenhaDoAdmin,
} from "../db/senha-admin";
import { sha256Hex } from "../lib/cripto";
import { responderErro } from "../lib/respostas-erro";
import { prepararSenha } from "../lib/senha";
import {
  exigirSessao,
  lerCookieSessao,
  type AmbienteSessao,
} from "../middleware/sessao";
import { validarJson } from "../middleware/validacao";

export const PREFIXO_SENHA_ADMIN = "/api/admin";
const CAMINHO = ROTAS_ACESSO.obterMinhaSenhaAdmin.caminho.slice(
  PREFIXO_SENHA_ADMIN.length,
);

export const senhaAdmin = new Hono<AmbienteSessao>();

senhaAdmin.use(CAMINHO, exigirSessao(["admin"]));

senhaAdmin.get(CAMINHO, async (c) => {
  const senha = await lerSenhaDoAdmin(c.env.DB, c.var.usuario.id);
  return c.json(
    {
      definida: senha !== null,
      usuario: senha?.usuario ?? null,
      atualizada_em: senha?.atualizadaEm ?? null,
    } satisfies RespostaSenhaAdmin,
    200,
  );
});

senhaAdmin.put(
  CAMINHO,
  validarJson(corpoDefinirSenhaAdminSchema),
  async (c) => {
    const { usuario, senha } = c.req.valid("json");
    const cookie = lerCookieSessao(c);
    const resultado = await gravarSenhaDoAdmin(
      c.env.DB,
      {
        usuarioId: c.var.usuario.id,
        usuario,
        senha: await prepararSenha(senha),
        idHashAtual: cookie === null ? null : await sha256Hex(cookie),
      },
      { usuarioId: c.var.usuario.id, em: new Date().toISOString() },
    );
    if (resultado.tipo === "em_uso")
      return responderErro(
        c,
        "em_uso",
        "Este usuário já é de outra pessoa: escolha outro",
      );
    return c.json(
      {
        definida: true,
        usuario,
        atualizada_em: resultado.atualizadaEm,
      } satisfies RespostaSenhaAdmin,
      200,
    );
  },
);

senhaAdmin.delete(CAMINHO, async (c) => {
  await removerSenhaDoAdmin(c.env.DB, c.var.usuario.id, {
    usuarioId: c.var.usuario.id,
    em: new Date().toISOString(),
  });
  return c.body(null, 204);
});
