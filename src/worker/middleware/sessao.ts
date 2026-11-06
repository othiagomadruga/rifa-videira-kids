/**
 * Sessão da equipe (RIFA-007): cookie `__Host-sessao` → usuário em `c.var.usuario`, papéis e proteção
 * contra CSRF. Documentação: docs/acesso.md.
 *
 * Montagem no app (src/worker/index.ts), antes de qualquer rota de /api/admin/* e /api/painel/*:
 *   app.use("/api/admin/*", exigirSessao(["admin", "coordenacao"]));
 *   app.use("/api/painel/*", exigirSessao(["admin", "coordenacao"]));
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import {
  NOME_COOKIE_SESSAO,
  criarErroApi,
  type Papel,
  type UsuarioSessao,
} from "../../shared/contracts";
import { buscarUsuarioDaSessao } from "../db/acessos";
import { FORMATO_SEGREDO, sha256Hex } from "../lib/cripto";

/** `__Host-sessao` (contrato): o navegador só aceita esse nome com Secure, Path=/ e sem Domain. */
export const COOKIE_SESSAO = NOME_COOKIE_SESSAO;

/** Env das rotas que usam a sessão: depois de exigirSessao, `c.var.usuario` é quem está conectado. */
export interface AmbienteSessao {
  Bindings: Cloudflare.Env;
  Variables: { usuario: UsuarioSessao };
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
  return c.json(
    criarErroApi("proibido", "Requisição de outra origem não é aceita"),
    403,
  );
}

/** Só a proteção contra CSRF, para as rotas abertas que escrevem (POST /api/sessao e /api/sessao/sair). */
export const exigirMesmaOrigem = createMiddleware(async (c, next) => {
  if (!requisicaoDaMesmaOrigem(c)) return respostaOrigemProibida(c);
  await next();
});

/**
 * Exige uma sessão válida de um dos `papeis` e põe o usuário em `c.var.usuario`:
 * - escrita de outra origem: 403 `proibido`, antes de olhar a sessão;
 * - sem cookie, ou sessão inexistente, vencida ou de usuário desativado: 401 `nao_autenticado` (e o cookie
 *   inválido é expirado);
 * - papel fora de `papeis`: 403 `proibido`.
 * Pode ser empilhado (/api/admin/* para a equipe e /api/admin/usuarios/* só admin): a sessão é lida uma vez
 * por requisição. As respostas autenticadas saem com `Cache-Control: no-store`.
 */
export function exigirSessao(papeis: readonly Papel[]) {
  return createMiddleware<AmbienteSessao>(async (c, next) => {
    if (!requisicaoDaMesmaOrigem(c)) return respostaOrigemProibida(c);

    let usuario = c.get("usuario") as UsuarioSessao | undefined;
    if (usuario === undefined) {
      const idSessao = lerCookieSessao(c);
      const encontrado =
        idSessao === null
          ? null
          : await buscarUsuarioDaSessao(
              c.env.DB,
              await sha256Hex(idSessao),
              new Date().toISOString(),
            );
      if (encontrado === null) {
        if (getCookie(c, COOKIE_SESSAO) !== undefined) apagarCookieSessao(c);
        return c.json(
          criarErroApi(
            "nao_autenticado",
            "Sessão ausente ou expirada: abra o seu link de acesso",
          ),
          401,
        );
      }
      usuario = encontrado;
      c.set("usuario", usuario);
    }

    if (!papeis.includes(usuario.papel)) {
      return c.json(
        criarErroApi("proibido", "Seu acesso não permite esta ação"),
        403,
      );
    }
    await next();
    c.header("Cache-Control", "no-store");
  });
}
