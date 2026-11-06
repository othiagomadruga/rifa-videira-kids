/**
 * Contrato do acesso da equipe da campanha (RIFA-007): link pessoal → sessão por cookie, papéis e
 * administração de usuários e links. Documentação: docs/acesso.md.
 *
 * - Cada pessoa recebe um link `<origem>/acesso/<token>`. O site mostra uma confirmação e só o
 *   `POST /api/sessao` cria a sessão: o preview de link do WhatsApp abre a URL, mas não faz o POST.
 * - A sessão vai no cookie `sessao` (HttpOnly, Secure, SameSite=Lax). O site não lê o cookie: pergunta a
 *   `GET /api/sessao` quem está conectado.
 * - O link (com o token) só aparece na resposta que o cria. Nenhuma outra resposta devolve token ou hash.
 * - Escritas (POST, PUT, PATCH, DELETE) só são aceitas da mesma origem do site (proteção contra CSRF).
 * - Erros: formato único de ./erros (401 `nao_autenticado`, 403 `proibido`, 404 `nao_encontrado`...).
 */
import { z } from "zod";
import {
  lista,
  parametroIdSchema,
  type DefinicaoRota,
  type MetodoHttp,
} from "./api";
import { idSchema, instanteSchema } from "./dominio";

// ---------------------------------------------------------------------------------------------------
// Papéis e parâmetros do acesso
// ---------------------------------------------------------------------------------------------------

/**
 * - admin: tudo da coordenação e, além disso, cria usuários, gera e revoga links;
 * - coordenacao: equipe da campanha (`/api/admin/*` e `/api/painel/*`, exceto usuários e links).
 */
export const PAPEIS = ["admin", "coordenacao"] as const;
export const papelSchema = z.enum(PAPEIS);
export type Papel = z.infer<typeof papelSchema>;

/**
 * Validade de um link novo e de uma sessão nova, em dias. 45 dias cobrem a campanha (vendas de 23/11 a meados de
 * dezembro de 2026): com 30, um link entregue antes do início venceria no meio das vendas.
 */
export const VALIDADE_LINK_DIAS = 45;
export const VALIDADE_SESSAO_DIAS = 45;

/** Caminho do link no site: `<origem>/acesso/<token>`. */
export const PREFIXO_LINK_ACESSO = "/acesso/";

/** Token do link: 32 bytes aleatórios em base64url, sem `=` (43 caracteres). */
export const FORMATO_TOKEN_ACESSO = /^[A-Za-z0-9_-]{43}$/;

// ---------------------------------------------------------------------------------------------------
// POST /api/sessao, GET /api/sessao e POST /api/sessao/sair
// ---------------------------------------------------------------------------------------------------

/** Quem está conectado. */
export const usuarioSessaoSchema = z.object({
  id: idSchema,
  nome: z.string().min(1).max(120),
  papel: papelSchema,
});
export type UsuarioSessao = z.infer<typeof usuarioSessaoSchema>;

export const corpoCriarSessaoSchema = z.object({
  /**
   * O que vem depois de `/acesso/` no link. Texto fora de FORMATO_TOKEN_ACESSO (vazio, cortado...) é um
   * link inválido: 401, como um token inexistente. Só a falta do campo (ou um não texto) dá 400.
   */
  token: z.string().max(512),
});

/** 200 de POST /api/sessao (junto com o Set-Cookie) e de GET /api/sessao. */
export const respostaSessaoSchema = z.object({ usuario: usuarioSessaoSchema });
export type RespostaSessao = z.infer<typeof respostaSessaoSchema>;

// ---------------------------------------------------------------------------------------------------
// Administração (papel admin): /api/admin/usuarios e /api/admin/links
// ---------------------------------------------------------------------------------------------------

/** valido = abre sessão; expirado = passou de expira_em; revogado = cancelado pela administração. */
export const SITUACOES_LINK = ["valido", "expirado", "revogado"] as const;
export type SituacaoLink = (typeof SITUACOES_LINK)[number];

/** Um link como a listagem mostra: sem token e sem hash. */
export const linkAcessoSchema = z.object({
  id: idSchema,
  criado_em: instanteSchema,
  expira_em: instanteSchema,
  revogado_em: instanteSchema.nullable(),
  /** Última vez que o link abriu uma sessão. */
  ultimo_uso_em: instanteSchema.nullable(),
  situacao: z.enum(SITUACOES_LINK),
});
export type LinkAcesso = z.infer<typeof linkAcessoSchema>;

/** Link recém-criado: a única vez em que a URL com o token aparece. Quem tem a URL entra como o usuário. */
export const linkAcessoCriadoSchema = linkAcessoSchema.extend({
  url: z.url(),
});
export type LinkAcessoCriado = z.infer<typeof linkAcessoCriadoSchema>;

export const usuarioSchema = z.object({
  id: idSchema,
  nome: z.string().min(1).max(120),
  email: z.email().max(254).nullable(),
  papel: papelSchema,
  /** false = os links não abrem sessão e as sessões foram encerradas. */
  ativo: z.boolean(),
  criado_em: instanteSchema,
  /** Sessões dentro da validade (aparelhos conectados). */
  sessoes_ativas: z.number().int().nonnegative(),
  /** Do mais novo para o mais antigo, inclusive expirados e revogados. */
  links: z.array(linkAcessoSchema),
});
export type Usuario = z.infer<typeof usuarioSchema>;

export const corpoCriarUsuarioSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  /** Opcional: ausente ou null. Texto vazio não é e-mail (400). */
  email: z.email().max(254).nullable().default(null),
  papel: papelSchema,
});
export type CorpoCriarUsuario = z.input<typeof corpoCriarUsuarioSchema>;

/** 201 de POST /api/admin/usuarios: o usuário e o primeiro link. */
export const respostaCriarUsuarioSchema = z.object({
  usuario: usuarioSchema,
  link: linkAcessoCriadoSchema,
});

export const respostaListaUsuariosSchema = lista(usuarioSchema);

/** 201 de POST /api/admin/usuarios/:id/links. Os links anteriores continuam valendo até expirar ou ser revogados. */
export const respostaCriarLinkSchema = z.object({
  link: linkAcessoCriadoSchema,
});

/**
 * PATCH /api/admin/usuarios/:id. Desativar encerra as sessões do usuário; reativar não cria link.
 * 409 `em_uso`: ninguém desativa o próprio acesso, e o último admin ativo não pode ser desativado.
 */
export const corpoAtualizarUsuarioSchema = z.strictObject({
  ativo: z.boolean(),
});

// ---------------------------------------------------------------------------------------------------
// Catálogo das rotas de acesso (à parte de ROTAS: inclui PATCH e diz os papéis aceitos)
// ---------------------------------------------------------------------------------------------------

export type MetodoHttpAcesso = MetodoHttp | "PATCH";

export interface DefinicaoRotaAcesso extends Omit<DefinicaoRota, "metodo"> {
  readonly metodo: MetodoHttpAcesso;
  /** Papéis aceitos; null = rota aberta (sem sessão). */
  readonly papeis: readonly Papel[] | null;
}

export const ROTAS_ACESSO = {
  entrar: {
    metodo: "POST",
    caminho: "/api/sessao",
    grupo: "aberto",
    papeis: null,
    situacao: "detalhada",
    corpo: corpoCriarSessaoSchema,
    sucesso: { status: 200, corpo: respostaSessaoSchema },
  },
  obterSessao: {
    metodo: "GET",
    caminho: "/api/sessao",
    grupo: "coordenacao",
    papeis: PAPEIS,
    situacao: "detalhada",
    sucesso: { status: 200, corpo: respostaSessaoSchema },
  },
  sair: {
    metodo: "POST",
    caminho: "/api/sessao/sair",
    grupo: "aberto",
    papeis: null,
    situacao: "detalhada",
    sucesso: { status: 204, corpo: null },
  },
  criarUsuario: {
    metodo: "POST",
    caminho: "/api/admin/usuarios",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    corpo: corpoCriarUsuarioSchema,
    sucesso: { status: 201, corpo: respostaCriarUsuarioSchema },
  },
  listarUsuarios: {
    metodo: "GET",
    caminho: "/api/admin/usuarios",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    sucesso: { status: 200, corpo: respostaListaUsuariosSchema },
  },
  atualizarUsuario: {
    metodo: "PATCH",
    caminho: "/api/admin/usuarios/:id",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    parametros: parametroIdSchema,
    corpo: corpoAtualizarUsuarioSchema,
    sucesso: { status: 200, corpo: usuarioSchema },
  },
  criarLink: {
    metodo: "POST",
    caminho: "/api/admin/usuarios/:id/links",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    parametros: parametroIdSchema,
    sucesso: { status: 201, corpo: respostaCriarLinkSchema },
  },
  revogarLink: {
    metodo: "DELETE",
    caminho: "/api/admin/links/:id",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    parametros: parametroIdSchema,
    sucesso: { status: 204, corpo: null },
  },
} as const satisfies Record<string, DefinicaoRotaAcesso>;

export type NomeRotaAcesso = keyof typeof ROTAS_ACESSO;
