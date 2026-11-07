/**
 * Sessão da equipe (RIFA-007), montada em /api/sessao. Documentação: docs/acesso.md.
 *
 * - POST /api/sessao { token }: o link pessoal vira uma sessão (cookie `__Host-sessao`). Link inválido → 401.
 *   O mesmo link pode abrir outras sessões (outro aparelho, ou de novo) até expirar ou ser revogado, e
 *   nenhuma sessão dura mais que o link que a abriu.
 * - GET /api/sessao: quem está conectado (401 sem sessão válida).
 * - POST /api/sessao/sair: encerra a sessão deste navegador e expira o cookie (204, mesmo sem sessão).
 *
 * Os POSTs são abertos (não exigem sessão), mas só da mesma origem do site (CSRF). No login (RIFA-013b),
 * depois da origem: o limite de tentativas por IP (429, lib/limite-requisicoes.ts) e o de tamanho do corpo,
 * conferido ANTES de ler ou validar o JSON (413, middleware/limite-corpo.ts).
 */
import { Hono, type Context } from "hono";
import {
  FORMATO_TOKEN_ACESSO,
  PAPEIS,
  VALIDADE_SESSAO_DIAS,
  corpoCriarSessaoSchema,
  type RespostaSessao,
} from "../../shared/contracts";
import { apagarSessao, buscarLinkValido, criarSessao } from "../db/acessos";
import { gerarSegredo, sha256Hex } from "../lib/cripto";
import { LIMITE_LOGIN, limitarRequisicoes } from "../lib/limite-requisicoes";
import { responderErro } from "../lib/respostas-erro";
import {
  LIMITE_CORPO_SESSAO_BYTES,
  limitarCorpo,
} from "../middleware/limite-corpo";
import {
  apagarCookieSessao,
  exigirMesmaOrigem,
  exigirSessao,
  gravarCookieSessao,
  lerCookieSessao,
  type AmbienteSessao,
} from "../middleware/sessao";
import { validarJson } from "../middleware/validacao";

const DIA_MS = 24 * 60 * 60 * 1000;

export const sessao = new Hono<AmbienteSessao>();

function respostaLinkInvalido(c: Context) {
  return responderErro(
    c,
    "nao_autenticado",
    "Link de acesso inválido, expirado ou revogado",
  );
}

sessao.post(
  "/",
  exigirMesmaOrigem,
  limitarRequisicoes(LIMITE_LOGIN),
  limitarCorpo(LIMITE_CORPO_SESSAO_BYTES),
  validarJson(corpoCriarSessaoSchema),
  async (c) => {
    c.header("Cache-Control", "no-store");
    const { token } = c.req.valid("json");
    if (!FORMATO_TOKEN_ACESSO.test(token)) return respostaLinkInvalido(c);

    const agora = new Date();
    const link = await buscarLinkValido(
      c.env.DB,
      await sha256Hex(token),
      agora.toISOString(),
    );
    if (link === null) return respostaLinkInvalido(c);

    const idSessao = gerarSegredo();
    const anterior = lerCookieSessao(c);
    // Até o menor entre login + VALIDADE_SESSAO_DIAS e o fim do link (o banco aplica e devolve).
    const expiraEm = await criarSessao(c.env.DB, {
      idHash: await sha256Hex(idSessao),
      linkId: link.linkId,
      criadoEm: agora.toISOString(),
      expiraEm: new Date(
        agora.getTime() + VALIDADE_SESSAO_DIAS * DIA_MS,
      ).toISOString(),
      idHashAnterior: anterior === null ? null : await sha256Hex(anterior),
    });
    if (expiraEm === null) return respostaLinkInvalido(c);

    gravarCookieSessao(c, idSessao, expiraEm, agora);
    return c.json({ usuario: link.usuario } satisfies RespostaSessao, 200);
  },
);

sessao.get("/", exigirSessao(PAPEIS), (c) =>
  c.json({ usuario: c.var.usuario } satisfies RespostaSessao, 200),
);

sessao.post("/sair", exigirMesmaOrigem, async (c) => {
  const idSessao = lerCookieSessao(c);
  if (idSessao !== null)
    await apagarSessao(c.env.DB, await sha256Hex(idSessao));
  apagarCookieSessao(c);
  c.header("Cache-Control", "no-store");
  return c.body(null, 204);
});
