// Auxiliares dos testes do acesso (RIFA-007). O app de teste é montado como o src/worker/index.ts depois da
// integração (trecho em docs/acesso.md), mais rotas de exemplo da coordenação em /api/admin/exemplo e
// /api/painel/exemplo (no app real: campanha, hierarquia, painel...).
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { expect } from "vitest";
import { VALIDADE_LINK_DIAS, type Papel } from "../../shared/contracts";
import { criarSessao, criarUsuarioComLink } from "../db/acessos";
import { gerarSegredo, sha256Hex } from "../lib/cripto";
import { exigirSessao, type AmbienteSessao } from "../middleware/sessao";
import { sessao } from "../routes/acesso";
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
  app.route("/api/sessao", sessao);
  app.use("/api/admin/*", exigirSessao(["admin", "coordenacao"]));
  app.use("/api/painel/*", exigirSessao(["admin", "coordenacao"]));
  app.route("/api/admin", adminUsuarios);
  // --- rotas da coordenação montadas depois (como as das outras tarefas) ---
  app.route("/api/admin/exemplo", rotasDeExemplo());
  app.route("/api/painel/exemplo", rotasDeExemplo());
  return app;
}

export type AppDeTeste = ReturnType<typeof criarAppDeTeste>;

export interface OpcoesChamada {
  corpo?: unknown;
  /** Valor do cookie `sessao`. */
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
    cabecalhos.set("Cookie", `sessao=${opcoes.sessao}`);
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

/** O Set-Cookie de `sessao` da resposta (valor e atributos), ou null. */
export function cookieDaResposta(
  res: Response,
): { valor: string; atributos: string[] } | null {
  const cabecalho = res.headers.get("Set-Cookie");
  if (cabecalho === null || !cabecalho.startsWith("sessao=")) return null;
  const [par, ...atributos] = cabecalho.split(";").map((parte) => parte.trim());
  return { valor: par.slice("sessao=".length), atributos };
}

/** Cria um usuário com um link direto no banco (como o bootstrap faz) e devolve o token. */
export async function criarAcessoNoBanco(
  papel: Papel,
  nome = `Pessoa de teste ${crypto.randomUUID()}`,
): Promise<{ token: string; usuarioId: number; linkId: number; nome: string }> {
  const token = gerarSegredo();
  const agora = Date.now();
  const { usuarioId, linkId } = await criarUsuarioComLink(
    env.DB,
    { nome, email: null, papel },
    {
      tokenHash: await sha256Hex(token),
      criadoEm: new Date(agora).toISOString(),
      expiraEm: new Date(
        agora + VALIDADE_LINK_DIAS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    },
  );
  return { token, usuarioId, linkId, nome };
}

/** Abre uma sessão com o token (POST /api/sessao) e devolve o valor do cookie. */
export async function entrar(app: AppDeTeste, token: string): Promise<string> {
  const res = await chamar(app, "POST", "/api/sessao", { corpo: { token } });
  const cookie = cookieDaResposta(res);
  if (res.status !== 200 || cookie === null)
    throw new Error(`login falhou: ${res.status} ${await res.text()}`);
  return cookie.valor;
}

/** Cria o usuário no banco e já entra: devolve o cookie da sessão. */
export async function sessaoDe(
  app: AppDeTeste,
  papel: Papel,
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
  papel: Papel,
  origem = ORIGEM,
): Promise<Record<string, string>> {
  const { linkId } = await criarAcessoNoBanco(papel);
  const idSessao = gerarSegredo();
  const agora = Date.now();
  const criada = await criarSessao(env.DB, {
    idHash: await sha256Hex(idSessao),
    linkId,
    criadoEm: new Date(agora).toISOString(),
    expiraEm: new Date(agora + 24 * 60 * 60 * 1000).toISOString(),
    idHashAnterior: null,
  });
  if (!criada) throw new Error("não foi possível criar a sessão de teste");
  return { Cookie: `sessao=${idSessao}`, Origin: origem };
}

/** Corpo de erro no formato único. */
export function erro(codigo: string) {
  return {
    erro: { codigo, mensagem: expect.any(String) },
  };
}
