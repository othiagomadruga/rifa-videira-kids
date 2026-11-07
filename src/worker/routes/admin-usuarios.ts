/**
 * Administração dos acessos (RIFA-007), só para o papel admin. Montada em /api/admin.
 * Documentação: docs/acesso.md.
 *
 * - POST /api/admin/usuarios { nome, email?, papel } → 201 { usuario, link }: a URL do link só aparece aqui;
 * - GET /api/admin/usuarios → 200 { itens }: usuários com os links (sem token) e as sessões ativas;
 * - PATCH /api/admin/usuarios/:id { ativo } → 200 usuário: desativar encerra as sessões dele; 409 `em_uso`
 *   ao desativar a si mesmo ou o último admin ativo (não há troca de papel, então não há como rebaixá-lo);
 * - POST /api/admin/usuarios/:id/links → 201 { link }: link novo (os anteriores continuam valendo);
 * - DELETE /api/admin/links/:id → 204: revoga o link e encerra as sessões abertas por ele; 409 `em_uso` se
 *   nenhum admin ativo ficaria com link válido (a equipe perderia o acesso de admin).
 *
 * As quatro escritas deixam na trilha de auditoria (RIFA-013b, GET /api/admin/auditoria) quem fez e o
 * alvo, na mesma transação e só quando a ação acontece; o resumo nunca traz nome nem e-mail.
 */
import { Hono, type Context } from "hono";
import {
  PREFIXO_LINK_ACESSO,
  VALIDADE_LINK_DIAS,
  corpoAtualizarUsuarioSchema,
  corpoCriarUsuarioSchema,
  parametroIdSchema,
  type LinkAcessoCriado,
  type Usuario,
} from "../../shared/contracts";
import {
  buscarUsuario,
  criarLink,
  criarUsuarioComLink,
  definirAtivo,
  listarUsuarios,
  revogarLink,
  type NovoLink,
} from "../db/acessos";
import { gerarSegredo, sha256Hex } from "../lib/cripto";
import { responderErro } from "../lib/respostas-erro";
import {
  autoriaDaSessao,
  exigirSessao,
  type AmbienteSessao,
} from "../middleware/sessao";
import { validarJson, validarParametros } from "../middleware/validacao";

const DIA_MS = 24 * 60 * 60 * 1000;

export const adminUsuarios = new Hono<AmbienteSessao>();

// Só admin, mesmo que o app esqueça de pôr /api/admin/* atrás de exigirSessao. Os caminhos são específicos
// de propósito: um use("*") aqui valeria para todo /api/admin/* (hierarquia, campanha...).
adminUsuarios.use("/usuarios/*", exigirSessao(["admin"]));
adminUsuarios.use("/links/*", exigirSessao(["admin"]));

interface LinkGerado extends NovoLink {
  token: string;
}

async function gerarLink(agora: Date): Promise<LinkGerado> {
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

/** O link como sai na resposta de criação, com a URL `<origem>/acesso/<token>`. */
function linkCriado(
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
    url: `${new URL(c.req.url).origin}${PREFIXO_LINK_ACESSO}${link.token}`,
  };
}

function respostaUsuarioNaoEncontrado(c: Context) {
  return responderErro(c, "nao_encontrado", "Usuário não encontrado");
}

/** 409 `em_uso`: a desativação deixaria alguém (ou a equipe toda) sem acesso de admin. */
function respostaDesativacaoRecusada(c: Context, mensagem: string) {
  return responderErro(c, "em_uso", mensagem);
}

adminUsuarios.post(
  "/usuarios",
  validarJson(corpoCriarUsuarioSchema),
  async (c) => {
    const dados = c.req.valid("json");
    const agora = new Date();
    const link = await gerarLink(agora);
    const { usuarioId, linkId } = await criarUsuarioComLink(
      c.env.DB,
      dados,
      link,
      autoriaDaSessao(c, agora),
    );
    const { url, ...linkSemUrl } = linkCriado(c, linkId, link);
    const usuario: Usuario = {
      id: usuarioId,
      nome: dados.nome,
      email: dados.email,
      papel: dados.papel,
      ativo: true,
      criado_em: link.criadoEm,
      sessoes_ativas: 0,
      links: [linkSemUrl],
    };
    return c.json({ usuario, link: { ...linkSemUrl, url } }, 201);
  },
);

adminUsuarios.get("/usuarios", async (c) =>
  c.json(
    { itens: await listarUsuarios(c.env.DB, new Date().toISOString()) },
    200,
  ),
);

adminUsuarios.patch(
  "/usuarios/:id",
  validarParametros(parametroIdSchema),
  validarJson(corpoAtualizarUsuarioSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { ativo } = c.req.valid("json");
    if (!ativo && id === c.var.usuario.id)
      return respostaDesativacaoRecusada(
        c,
        "Você não pode desativar o seu próprio acesso: peça a outro admin",
      );
    const resultado = await definirAtivo(
      c.env.DB,
      id,
      ativo,
      autoriaDaSessao(c),
    );
    if (resultado === "nao_encontrado") return respostaUsuarioNaoEncontrado(c);
    if (resultado === "ultimo_admin")
      return respostaDesativacaoRecusada(
        c,
        "Este é o último admin ativo: crie ou reative outro admin antes de desativá-lo",
      );
    const usuario = await buscarUsuario(c.env.DB, id, new Date().toISOString());
    return usuario === null
      ? respostaUsuarioNaoEncontrado(c)
      : c.json(usuario, 200);
  },
);

adminUsuarios.post(
  "/usuarios/:id/links",
  validarParametros(parametroIdSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const agora = new Date();
    const link = await gerarLink(agora);
    const linkId = await criarLink(
      c.env.DB,
      id,
      link,
      autoriaDaSessao(c, agora),
    );
    return linkId === null
      ? respostaUsuarioNaoEncontrado(c)
      : c.json({ link: linkCriado(c, linkId, link) }, 201);
  },
);

adminUsuarios.delete(
  "/links/:id",
  validarParametros(parametroIdSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const agora = new Date();
    const resultado = await revogarLink(
      c.env.DB,
      id,
      agora.toISOString(),
      autoriaDaSessao(c, agora),
    );
    if (resultado === "nao_encontrado")
      return responderErro(c, "nao_encontrado", "Link não encontrado");
    if (resultado === "ultimo_link_admin")
      return responderErro(
        c,
        "em_uso",
        "Este é o último link válido de um admin ativo: gere um link novo para um admin antes de revogar este",
      );
    return c.body(null, 204);
  },
);
