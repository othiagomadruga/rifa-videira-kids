// Auxiliares dos testes do acesso (RIFA-007). O app de teste é montado como o src/worker/index.ts depois da
// integração (trecho em docs/acesso.md), mais rotas de exemplo da coordenação em /api/admin/exemplo e
// /api/painel/exemplo (no app real: campanha, hierarquia, painel...) e da hierarquia em /api/minha/exemplo
// (no app real: a visão individual, RIFA-014).
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { expect } from "vitest";
import {
  NOME_COOKIE_SESSAO,
  VALIDADE_LINK_DIAS,
  type PapelCoordenacao,
  type PapelHierarquia,
} from "../../shared/contracts";
import { criarSessao, criarUsuarioComLink } from "../db/acessos";
import { gerarLinksHierarquia } from "../db/acessos-hierarquia";
import { gerarSegredo, sha256Hex } from "../lib/cripto";
import { cabecalhosSeguranca } from "../middleware/cabecalhos-seguranca";
import { exigirSessao, type AmbienteSessao } from "../middleware/sessao";
import { sessao } from "../routes/acesso";
import {
  PREFIXO_ACESSOS_HIERARQUIA,
  acessosHierarquia,
} from "../routes/acessos-hierarquia";
import { adminUsuarios } from "../routes/admin-usuarios";

/** Origem das requisições de `app.request("/api/...")`. */
export const ORIGEM = "http://localhost";

const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function rotasDeExemplo() {
  const rotas = new Hono<AmbienteSessao>();
  rotas.on([...METODOS], "/", (c) =>
    c.json({ metodo: c.req.method, usuario: c.var.usuario }),
  );
  return rotas;
}

export function criarAppDeTeste() {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  // --- mesmo trecho que vai para o src/worker/index.ts ---
  app.use("*", cabecalhosSeguranca);
  app.route("/api/sessao", sessao);
  app.use("/api/admin/*", exigirSessao(["admin", "coordenacao"]));
  app.use("/api/painel/*", exigirSessao(["admin", "coordenacao"]));
  app.use("/api/minha/*", exigirSessao(["lider", "discipulador", "rede"]));
  app.route("/api/admin", adminUsuarios);
  app.route(PREFIXO_ACESSOS_HIERARQUIA, acessosHierarquia);
  // --- rotas da coordenação e da hierarquia montadas depois (como as das outras tarefas) ---
  app.route("/api/admin/exemplo", rotasDeExemplo());
  app.route("/api/painel/exemplo", rotasDeExemplo());
  app.route("/api/minha/exemplo", rotasDeExemplo());
  return app;
}

export type AppDeTeste = ReturnType<typeof criarAppDeTeste>;

export interface OpcoesChamada {
  corpo?: unknown;
  /** Valor do cookie da sessão (`__Host-sessao`). */
  sessao?: string;
  /** Cabeçalho Origin; padrão: ORIGEM nas escritas e nenhum no GET. null = sem Origin. */
  origem?: string | null;
  cabecalhos?: Record<string, string>;
}

export function chamar(
  app: AppDeTeste,
  metodo: (typeof METODOS)[number],
  caminho: string,
  opcoes: OpcoesChamada = {},
): Promise<Response> {
  const cabecalhos = new Headers(opcoes.cabecalhos);
  if (opcoes.corpo !== undefined)
    cabecalhos.set("Content-Type", "application/json");
  if (opcoes.sessao !== undefined)
    cabecalhos.set("Cookie", `${NOME_COOKIE_SESSAO}=${opcoes.sessao}`);
  const origem = opcoes.origem === undefined ? ORIGEM : opcoes.origem;
  if (metodo !== "GET" && origem !== null) cabecalhos.set("Origin", origem);
  const corpo =
    opcoes.corpo === undefined
      ? undefined
      : typeof opcoes.corpo === "string"
        ? opcoes.corpo
        : JSON.stringify(opcoes.corpo);
  return Promise.resolve(
    app.request(
      caminho,
      { method: metodo, headers: cabecalhos, body: corpo },
      env,
    ),
  );
}

/** O Set-Cookie da sessão (`__Host-sessao`) na resposta (valor e atributos), ou null. */
export function cookieDaResposta(
  res: Response,
): { valor: string; atributos: string[] } | null {
  const cabecalho = res.headers.get("Set-Cookie");
  const prefixo = `${NOME_COOKIE_SESSAO}=`;
  if (cabecalho === null || !cabecalho.startsWith(prefixo)) return null;
  const [par, ...atributos] = cabecalho.split(";").map((parte) => parte.trim());
  return { valor: par.slice(prefixo.length), atributos };
}

/** Um link novo (o token e o que vai para o banco), válido por VALIDADE_LINK_DIAS. */
async function linkNovo(): Promise<{
  token: string;
  tokenHash: string;
  criadoEm: string;
  expiraEm: string;
}> {
  const token = gerarSegredo();
  const agora = Date.now();
  return {
    token,
    tokenHash: await sha256Hex(token),
    criadoEm: new Date(agora).toISOString(),
    expiraEm: new Date(
      agora + VALIDADE_LINK_DIAS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

/** Cria uma pessoa da coordenação com um link direto no banco (como o bootstrap faz) e devolve o token. */
export async function criarAcessoNoBanco(
  papel: PapelCoordenacao,
  nome = `Pessoa de teste ${crypto.randomUUID()}`,
): Promise<{ token: string; usuarioId: number; linkId: number; nome: string }> {
  const link = await linkNovo();
  const { usuarioId, linkId } = await criarUsuarioComLink(
    env.DB,
    { nome, email: null, papel },
    link,
  );
  return { token: link.token, usuarioId, linkId, nome };
}

/**
 * Um link novo para o alvo de um papel da hierarquia (RIFA-014) pelo mesmo código do lote da administração
 * (db/acessos-hierarquia.ts, sem a trilha de auditoria): cria o usuário do alvo se faltar. O alvo precisa
 * existir na hierarquia. Devolve o token.
 */
export async function criarAcessoDaHierarquiaNoBanco(
  papel: PapelHierarquia,
  alvoId: number,
  opcoes: { revogarAnteriores?: boolean; db?: D1Database } = {},
): Promise<{ token: string; usuarioId: number; linkId: number }> {
  const link = await linkNovo();
  const resultado = await gerarLinksHierarquia(
    opcoes.db ?? env.DB,
    {
      papel,
      ids: [alvoId],
      revogarAnteriores: opcoes.revogarAnteriores ?? false,
    },
    [link],
  );
  if (!resultado.ok)
    throw new Error(
      `não foi possível criar o acesso de ${papel} ${alvoId}: ${resultado.codigo}`,
    );
  const [item] = resultado.itens;
  return {
    token: link.token,
    usuarioId: item.usuario_id,
    linkId: item.link_id,
  };
}

/** Abre uma sessão com o token (POST /api/sessao) e devolve o valor do cookie. */
export async function entrar(app: AppDeTeste, token: string): Promise<string> {
  const res = await chamar(app, "POST", "/api/sessao", { corpo: { token } });
  const cookie = cookieDaResposta(res);
  if (res.status !== 200 || cookie === null)
    throw new Error(`login falhou: ${res.status} ${await res.text()}`);
  return cookie.valor;
}

/** Cria a pessoa da coordenação no banco e já entra: devolve o cookie da sessão. */
export async function sessaoDe(
  app: AppDeTeste,
  papel: PapelCoordenacao,
): Promise<{
  sessao: string;
  token: string;
  usuarioId: number;
  linkId: number;
  nome: string;
}> {
  const acesso = await criarAcessoNoBanco(papel);
  return { ...acesso, sessao: await entrar(app, acesso.token) };
}

/**
 * Para os testes das rotas da coordenação no app real (`exports.default.fetch`): cria um usuário e uma
 * sessão direto no banco, sem HTTP, e devolve os cabeçalhos de uma requisição autenticada da mesma origem.
 *   await exports.default.fetch("http://localhost/api/admin/redes", { headers: await cabecalhosDeSessao("coordenacao") })
 */
export async function cabecalhosDeSessao(
  papel: PapelCoordenacao,
  origem = ORIGEM,
): Promise<Record<string, string>> {
  const { linkId } = await criarAcessoNoBanco(papel);
  return cabecalhosDoLink(linkId, origem);
}

/**
 * Como cabecalhosDeSessao, para um papel da hierarquia preso ao alvo `alvoId` (que precisa existir): cria o
 * usuário do alvo (ou um link novo, se ele já existe) e uma sessão direto no banco.
 */
export async function cabecalhosDeSessaoDaHierarquia(
  papel: PapelHierarquia,
  alvoId: number,
  origem = ORIGEM,
): Promise<Record<string, string>> {
  const { linkId } = await criarAcessoDaHierarquiaNoBanco(papel, alvoId);
  return cabecalhosDoLink(linkId, origem);
}

/** Uma sessão aberta direto no banco pelo link (24 h) e os cabeçalhos de uma requisição da mesma origem. */
async function cabecalhosDoLink(
  linkId: number,
  origem: string,
): Promise<Record<string, string>> {
  const idSessao = gerarSegredo();
  const agora = Date.now();
  const expiraEm = await criarSessao(env.DB, {
    idHash: await sha256Hex(idSessao),
    linkId,
    criadoEm: new Date(agora).toISOString(),
    expiraEm: new Date(agora + 24 * 60 * 60 * 1000).toISOString(),
    idHashAnterior: null,
  });
  if (expiraEm === null)
    throw new Error("não foi possível criar a sessão de teste");
  return { Cookie: `${NOME_COOKIE_SESSAO}=${idSessao}`, Origin: origem };
}

/** Corpo de erro no formato único. */
export function erro(codigo: string) {
  return {
    erro: { codigo, mensagem: expect.any(String) },
  };
}
