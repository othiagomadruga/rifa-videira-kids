/**
 * Sessão da equipe (RIFA-007): cookie `__Host-sessao` → usuário em `c.var.usuario`, papéis e proteção
 * contra CSRF. Documentação: docs/acesso.md.
 *
 * Montagem no app (src/worker/index.ts), antes de qualquer rota de /api/admin/*, /api/painel/* e /api/minha/*:
 *   app.use("/api/admin/*", exigirSessao(["admin", "coordenacao"]));
 *   app.use("/api/painel/*", exigirSessao(["admin", "coordenacao"]));
 *   app.use("/api/minha/*", exigirSessao(["lider", "discipulador", "rede"], { acessoDaCampanha: true }));
 * Nos papéis da hierarquia (RIFA-014, D12), `c.var.usuario.alvo` traz o alvo (célula, discipulador ou rede),
 * lido da hierarquia na hora: é dele, e só dele, que as rotas de /api/minha tiram o alvo.
 * Com `acessoDaCampanha` (RIFA-029, D20), o discipulador e a rede com o acesso do papel desligado na campanha levam
 * 403 `acesso_desligado` com `{ papel }`, depois do papel conferido; a sessão não é apagada.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import {
  NOME_COOKIE_SESSAO,
  type Papel,
  type PapelComChaveDeAcesso,
  type UsuarioSessao,
} from "../../shared/contracts";
import { buscarSessao } from "../db/acessos";
import type { Autoria } from "../db/auditoria";
import { FORMATO_SEGREDO, sha256Hex } from "../lib/cripto";
import { responderErro } from "../lib/respostas-erro";

/** `__Host-sessao` (contrato): o navegador só aceita esse nome com Secure, Path=/ e sem Domain. */
export const COOKIE_SESSAO = NOME_COOKIE_SESSAO;

/**
 * Env das rotas que usam a sessão: depois de exigirSessao, `c.var.usuario` é quem está conectado e
 * `c.var.acessoLigado`, a chave de acesso do papel dele na campanha ativa (RIFA-029; sempre true fora do
 * discipulador e da rede), lida junto com a sessão.
 */
export interface AmbienteSessao {
  Bindings: Cloudflare.Env;
  Variables: { usuario: UsuarioSessao; acessoLigado: boolean };
}

/**
 * Quem faz a escrita, para a trilha de auditoria (RIFA-013b): o usuário que exigirSessao pôs em
 * `c.var.usuario`, e o instante. undefined sem sessão, o que só acontece com o sub-app montado sem o login
 * (testes de unidade de uma rota): no app real (index.ts), toda rota da coordenação passa pelo login antes.
 */
export function autoriaDaSessao(
  c: Context,
  agora: Date = new Date(),
): Autoria | undefined {
  const usuario = c.get("usuario") as UsuarioSessao | undefined;
  return usuario === undefined
    ? undefined
    : { usuarioId: usuario.id, em: agora.toISOString() };
}

const OPCOES_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

/**
 * `Set-Cookie: __Host-sessao=<id>; Max-Age=<segundos até expiraEm>; Path=/; HttpOnly; Secure; SameSite=Lax`.
 * O Max-Age acompanha a validade da sessão no banco (arredondado para baixo): o cookie não dura mais que ela.
 */
export function gravarCookieSessao(
  c: Context,
  idSessao: string,
  expiraEm: string,
  agora: Date,
): void {
  setCookie(c, COOKIE_SESSAO, idSessao, {
    ...OPCOES_COOKIE,
    maxAge: Math.max(
      0,
      Math.floor((Date.parse(expiraEm) - agora.getTime()) / 1000),
    ),
  });
}

/** Expira o cookie no navegador (`Max-Age=0`). */
export function apagarCookieSessao(c: Context): void {
  deleteCookie(c, COOKIE_SESSAO, OPCOES_COOKIE);
}

/** O valor do cookie `__Host-sessao`, se tiver o formato de um id de sessão. */
export function lerCookieSessao(c: Context): string | null {
  const valor = getCookie(c, COOKIE_SESSAO);
  return valor !== undefined && FORMATO_SEGREDO.test(valor) ? valor : null;
}

const METODOS_SEM_ESCRITA = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF: escrita (POST, PUT, PATCH, DELETE...) só vale da mesma origem do site, com `Origin` igual à origem
 * da requisição ou `Sec-Fetch-Site: same-origin`. Os navegadores mandam esses cabeçalhos e uma página de
 * outro site não consegue forjá-los. Sem nenhum dos dois, a escrita é recusada.
 */
export function requisicaoDaMesmaOrigem(c: Context): boolean {
  if (METODOS_SEM_ESCRITA.has(c.req.method)) return true;
  const origem = c.req.header("Origin");
  if (origem !== undefined && origem === new URL(c.req.url).origin) return true;
  return c.req.header("Sec-Fetch-Site") === "same-origin";
}

function respostaOrigemProibida(c: Context) {
  return responderErro(
    c,
    "proibido",
    "Requisição de outra origem não é aceita",
  );
}

/** Só a proteção contra CSRF, para as rotas abertas que escrevem (POST /api/sessao e /api/sessao/sair). */
export const exigirMesmaOrigem = createMiddleware(async (c, next) => {
  if (!requisicaoDaMesmaOrigem(c)) return respostaOrigemProibida(c);
  await next();
});

/** A mensagem do 403 `acesso_desligado` (RIFA-029): a coordenação desligou o acesso do papel na campanha. */
export function mensagemAcessoDesligado(papel: PapelComChaveDeAcesso): string {
  return `A coordenação desligou por enquanto o acesso ${papel === "discipulador" ? "dos discipuladores" : "das redes"} ao sistema da rifa`;
}

/**
 * Exige uma sessão válida de um dos `papeis` e põe o usuário em `c.var.usuario`:
 * - escrita de outra origem: 403 `proibido`, antes de olhar a sessão;
 * - sem cookie, ou sessão inexistente, vencida ou de usuário desativado: 401 `nao_autenticado` (e o cookie
 *   inválido é expirado);
 * - papel fora de `papeis`: 403 `proibido`;
 * - com `acessoDaCampanha` (/api/minha/*, RIFA-029): discipulador ou rede com o acesso do papel desligado na
 *   campanha ativa, 403 `acesso_desligado` com `{ papel }` (a sessão continua; volta a valer com a chave).
 * Pode ser empilhado (/api/admin/* para a equipe e /api/admin/usuarios/* só admin): a sessão é lida uma vez
 * por requisição. As respostas autenticadas saem com `Cache-Control: no-store`.
 */
export function exigirSessao(
  papeis: readonly Papel[],
  opcoes: { acessoDaCampanha?: boolean } = {},
) {
  return createMiddleware<AmbienteSessao>(async (c, next) => {
    if (!requisicaoDaMesmaOrigem(c)) return respostaOrigemProibida(c);

    let usuario = c.get("usuario") as UsuarioSessao | undefined;
    if (usuario === undefined) {
      const idSessao = lerCookieSessao(c);
      const encontrado =
        idSessao === null
          ? null
          : await buscarSessao(
              c.env.DB,
              await sha256Hex(idSessao),
              new Date().toISOString(),
            );
      if (encontrado === null) {
        if (getCookie(c, COOKIE_SESSAO) !== undefined) apagarCookieSessao(c);
        return responderErro(
          c,
          "nao_autenticado",
          "Sessão ausente ou expirada: abra o seu link de acesso",
        );
      }
      usuario = encontrado.usuario;
      c.set("usuario", usuario);
      c.set("acessoLigado", encontrado.acessoLigado);
    }

    if (!papeis.includes(usuario.papel)) {
      return responderErro(c, "proibido", "Seu acesso não permite esta ação");
    }
    if (
      opcoes.acessoDaCampanha === true &&
      c.get("acessoLigado") === false &&
      (usuario.papel === "discipulador" || usuario.papel === "rede")
    ) {
      c.header("Cache-Control", "no-store");
      return responderErro(
        c,
        "acesso_desligado",
        mensagemAcessoDesligado(usuario.papel),
        { papel: usuario.papel },
      );
    }
    await next();
    c.header("Cache-Control", "no-store");
  });
}
