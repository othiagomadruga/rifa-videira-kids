/**
 * Contrato do acesso da equipe da campanha (RIFA-007): link pessoal → sessão por cookie, papéis e
 * administração de usuários e links. Documentação: docs/acesso.md.
 *
 * - Cada pessoa recebe um link `<origem>/acesso/<token>`. O site mostra uma confirmação e só o
 *   `POST /api/sessao` cria a sessão: o preview de link do WhatsApp abre a URL, mas não faz o POST.
 * - A sessão vai no cookie `__Host-sessao` (HttpOnly, Secure, SameSite=Lax, Path=/, sem Domain). O site não
 *   lê o cookie: pergunta a `GET /api/sessao` quem está conectado.
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
import {
  alvoSchema,
  idSchema,
  instanteSchema,
  type Alvo,
  type TipoAlvo,
} from "./dominio";
import { PAPEIS_COM_CHAVE_DE_ACESSO } from "./regras";
import {
  FORMATO_USUARIO_ADMIN,
  LIMITE_CAMPO_LOGIN_ADMIN,
  MAXIMO_USUARIO_ADMIN,
  MENSAGEM_PROBLEMA_SENHA_ADMIN,
  MENSAGEM_USUARIO_ADMIN_INVALIDO,
  normalizarUsuarioAdmin,
  problemaDaSenhaAdmin,
} from "./senha-admin";

// ---------------------------------------------------------------------------------------------------
// Papéis e parâmetros do acesso
// ---------------------------------------------------------------------------------------------------

/**
 * Coordenação (RIFA-007):
 * - admin: tudo da coordenação e, além disso, cria usuários, gera e revoga links;
 * - coordenacao: equipe da campanha (`/api/admin/*` e `/api/painel/*`, exceto usuários e links).
 *
 * Hierarquia (RIFA-014, D12): cada usuário destes papéis é preso a UM alvo da hierarquia (TIPO_ALVO_DO_PAPEL)
 * e só vê a visão individual dele (`/api/minha/*`). Nunca entram em `/api/admin/*` nem em `/api/painel/*` (403).
 * - lider: a célula;
 * - discipulador: o discipulador (e as células dele);
 * - rede: a rede (e os discipuladores e células dela).
 */
export const PAPEIS_COORDENACAO = ["admin", "coordenacao"] as const;
export const PAPEIS_HIERARQUIA = ["lider", "discipulador", "rede"] as const;
export const PAPEIS = [...PAPEIS_COORDENACAO, ...PAPEIS_HIERARQUIA] as const;
export const papelSchema = z.enum(PAPEIS);
export type Papel = z.infer<typeof papelSchema>;
export const papelCoordenacaoSchema = z.enum(PAPEIS_COORDENACAO);
export type PapelCoordenacao = z.infer<typeof papelCoordenacaoSchema>;
export const papelHierarquiaSchema = z.enum(PAPEIS_HIERARQUIA);
export type PapelHierarquia = z.infer<typeof papelHierarquiaSchema>;

/**
 * Tipo do alvo de cada papel da hierarquia. O banco garante que o usuário tem exatamente o alvo do papel
 * (e nenhum alvo nos papéis da coordenação), e no máximo um usuário por alvo (D12).
 */
export const TIPO_ALVO_DO_PAPEL = {
  lider: "celula",
  discipulador: "discipulador",
  rede: "rede",
} as const satisfies Record<PapelHierarquia, TipoAlvo>;

/**
 * Validade de um link novo e de uma sessão nova, em dias. 45 dias cobrem a campanha (vendas de 23/11 a meados de
 * dezembro de 2026): com 30, um link entregue antes do início venceria no meio das vendas.
 * A sessão nunca dura mais que o link que a abriu: vale até o menor entre (login + 45 dias) e o fim do link.
 */
export const VALIDADE_LINK_DIAS = 45;
export const VALIDADE_SESSAO_DIAS = 45;

/**
 * Nome do cookie da sessão. Com o prefixo `__Host-`, o navegador só aceita o cookie com Secure, Path=/ e sem
 * Domain, gravado pelo próprio host: outro site do mesmo domínio-pai (ex.: outro Worker em *.workers.dev) não
 * consegue gravar um cookie com este nome por cima do nosso.
 */
export const NOME_COOKIE_SESSAO = "__Host-sessao";

/** Caminho do link no site: `<origem>/acesso/<token>`. */
export const PREFIXO_LINK_ACESSO = "/acesso/";

/** Token do link: 32 bytes aleatórios em base64url, sem `=` (43 caracteres). */
export const FORMATO_TOKEN_ACESSO = /^[A-Za-z0-9_-]{43}$/;

// ---------------------------------------------------------------------------------------------------
// POST /api/sessao, GET /api/sessao e POST /api/sessao/sair
// ---------------------------------------------------------------------------------------------------

/**
 * O alvo combina com o papel: papel da hierarquia com o alvo do tipo dele; papel da coordenação sem alvo (ausente
 * ou null). Vale para a sessão e para o usuário da administração.
 */
function conferirAlvoDoPapel(
  usuario: { papel: Papel; alvo?: Alvo | null },
  ctx: z.RefinementCtx,
) {
  const tipos: Partial<Record<Papel, TipoAlvo>> = TIPO_ALVO_DO_PAPEL;
  const tipo = tipos[usuario.papel];
  if (tipo === undefined ? usuario.alvo != null : usuario.alvo?.tipo !== tipo)
    ctx.addIssue({
      code: "custom",
      path: ["alvo"],
      message: "O alvo não combina com o papel",
    });
}

/** Quem está conectado. */
export const usuarioSessaoSchema = z
  .object({
    id: idSchema,
    nome: z.string().min(1).max(120),
    papel: papelSchema,
    /**
     * Papéis da hierarquia: o alvo da visão individual (sempre presente, lido da hierarquia na hora).
     * Papéis da coordenação: ausente ou null.
     */
    alvo: alvoSchema.nullable().optional(),
  })
  .superRefine(conferirAlvoDoPapel);
export type UsuarioSessao = z.infer<typeof usuarioSessaoSchema>;

export const corpoCriarSessaoSchema = z.object({
  /**
   * O que vem depois de `/acesso/` no link. Texto fora de FORMATO_TOKEN_ACESSO (vazio, cortado...) é um
   * link inválido: 401, como um token inexistente. Só a falta do campo (ou um não texto) dá 400.
   */
  token: z.string().max(512),
});

/**
 * Tamanho máximo de cada campo do login da célula (RIFA-064): o nome da célula tem até 120 caracteres e a senha
 * padrão, "@" + o nome normalizado + "1234". Acima disso, 400 (nada a ver com a célula existir).
 */
export const LIMITE_CAMPO_LOGIN_CELULA = 200;

/**
 * POST /api/sessao/senha (RIFA-064, D29): o login da célula com a senha padrão (login-celula.ts). Os dois campos são
 * texto livre: vazio, um nome que não é de célula ou uma senha errada dão o MESMO 401 (a resposta não diz se a
 * célula existe). Só a falta de um campo (ou um não texto) e o texto acima do limite dão 400.
 */
export const corpoEntrarComSenhaSchema = z.object({
  /** O nome da célula, como a pessoa digitou: comparado normalizado (sem maiúsculas, acentos, espaços e pontuação). */
  celula: z.string().max(LIMITE_CAMPO_LOGIN_CELULA),
  /** A senha padrão: "@" + o nome da célula normalizado + "1234" (comparada com formaDaSenhaDigitada). */
  senha: z.string().max(LIMITE_CAMPO_LOGIN_CELULA),
});
export type CorpoEntrarComSenha = z.input<typeof corpoEntrarComSenhaSchema>;

/**
 * POST /api/sessao/admin (RIFA-073, D33): o login do admin com usuário e senha (senha-admin.ts). Os dois campos são
 * texto livre: vazio, um usuário que não existe ou uma senha errada dão o MESMO 401 (a resposta não diz se o usuário
 * existe). Só a falta de um campo (ou um não texto) e o texto acima do limite dão 400.
 */
export const corpoEntrarComoAdminSchema = z.object({
  /** O usuário de login, como a pessoa digitou: comparado normalizado (sem espaços nas pontas, em minúsculas). */
  usuario: z.string().max(LIMITE_CAMPO_LOGIN_ADMIN),
  senha: z.string().max(LIMITE_CAMPO_LOGIN_ADMIN),
});
export type CorpoEntrarComoAdmin = z.input<typeof corpoEntrarComoAdminSchema>;

/**
 * PUT /api/admin/minha-senha (RIFA-073, D33): define ou troca o usuário e a senha de login do PRÓPRIO admin (o da
 * sessão). O usuário é gravado normalizado (normalizarUsuarioAdmin) e tem de seguir FORMATO_USUARIO_ADMIN; a senha,
 * problemaDaSenhaAdmin (mínimo de 10 caracteres, diferente do usuário). A confirmação da senha é da tela.
 */
export const corpoDefinirSenhaAdminSchema = z
  .object({
    usuario: z
      .string()
      .max(LIMITE_CAMPO_LOGIN_ADMIN)
      .transform(normalizarUsuarioAdmin)
      .pipe(
        z
          .string()
          .max(MAXIMO_USUARIO_ADMIN)
          .regex(FORMATO_USUARIO_ADMIN, MENSAGEM_USUARIO_ADMIN_INVALIDO),
      ),
    senha: z.string().max(LIMITE_CAMPO_LOGIN_ADMIN),
  })
  .superRefine(({ usuario, senha }, ctx) => {
    const problema = problemaDaSenhaAdmin(senha, usuario);
    if (problema !== null)
      ctx.addIssue({
        code: "custom",
        path: ["senha"],
        message: MENSAGEM_PROBLEMA_SENHA_ADMIN[problema],
      });
  });
export type CorpoDefinirSenhaAdmin = z.input<
  typeof corpoDefinirSenhaAdminSchema
>;

/**
 * 200 de GET e de PUT /api/admin/minha-senha: se o admin da sessão tem senha, o usuário de login e quando foi
 * definida ou trocada pela última vez. Nunca a senha nem o hash.
 */
export const respostaSenhaAdminSchema = z.strictObject({
  definida: z.boolean(),
  /** null quando não há senha. */
  usuario: z.string().regex(FORMATO_USUARIO_ADMIN).nullable(),
  /** null quando não há senha. */
  atualizada_em: instanteSchema.nullable(),
});
export type RespostaSenhaAdmin = z.infer<typeof respostaSenhaAdminSchema>;

/** 200 de POST /api/sessao, de POST /api/sessao/senha e de POST /api/sessao/admin (junto com o Set-Cookie) e de GET /api/sessao. */
export const respostaSessaoSchema = z.object({ usuario: usuarioSessaoSchema });
export type RespostaSessao = z.infer<typeof respostaSessaoSchema>;

/**
 * `detalhes` do 403 `acesso_desligado` (RIFA-029, D20): o papel cujo acesso a coordenação desligou na campanha
 * (`acesso.discipuladores` ou `acesso.redes`). O site diz que a coordenação desligou esse acesso por enquanto.
 */
export const detalhesAcessoDesligadoSchema = z.strictObject({
  papel: z.enum(PAPEIS_COM_CHAVE_DE_ACESSO),
});

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
  /**
   * RIFA-043: true só no link que abriu a sessão de quem fez a requisição ("este aparelho"): revogá-lo derruba essa
   * sessão. Calculado pela API em cada resposta (`sessoes.link_id`, migração 0002). false nos demais, no link
   * recém-criado (ainda não abriu sessão) e na lista da hierarquia (nenhum link dela abre sessão da coordenação).
   */
  desta_sessao: z.boolean(),
});
export type LinkAcesso = z.infer<typeof linkAcessoSchema>;

/** Link recém-criado: a única vez em que a URL com o token aparece. Quem tem a URL entra como o usuário. */
export const linkAcessoCriadoSchema = linkAcessoSchema.extend({
  url: z.url(),
});
export type LinkAcessoCriado = z.infer<typeof linkAcessoCriadoSchema>;

export const usuarioSchema = z
  .object({
    id: idSchema,
    nome: z.string().min(1).max(120),
    email: z.email().max(254).nullable(),
    papel: papelSchema,
    /** Papéis da hierarquia: o alvo (como em usuarioSessaoSchema). Papéis da coordenação: ausente ou null. */
    alvo: alvoSchema.nullable().optional(),
    /** false = os links não abrem sessão e as sessões foram encerradas. */
    ativo: z.boolean(),
    criado_em: instanteSchema,
    /** Sessões dentro da validade (aparelhos conectados). */
    sessoes_ativas: z.number().int().nonnegative(),
    /** Do mais novo para o mais antigo, inclusive expirados e revogados. */
    links: z.array(linkAcessoSchema),
  })
  .superRefine(conferirAlvoDoPapel);
export type Usuario = z.infer<typeof usuarioSchema>;

/**
 * Cria uma pessoa da COORDENAÇÃO. Os usuários da hierarquia (líder, discipulador, rede) nascem só pelos links em
 * lote (ROTAS_ACESSO_HIERARQUIA.gerarLinksHierarquia), que prendem cada um ao seu alvo: papel da hierarquia aqui
 * dá 400.
 */
export const corpoCriarUsuarioSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  /** Opcional: ausente ou null. Texto vazio não é e-mail (400). */
  email: z.email().max(254).nullable().default(null),
  papel: papelCoordenacaoSchema,
});
export type CorpoCriarUsuario = z.input<typeof corpoCriarUsuarioSchema>;

/** 201 de POST /api/admin/usuarios: o usuário e o primeiro link. */
export const respostaCriarUsuarioSchema = z.object({
  usuario: usuarioSchema,
  link: linkAcessoCriadoSchema,
});

/** GET /api/admin/usuarios: só as pessoas da coordenação (admin e coordenacao). A hierarquia tem a lista própria. */
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
  /**
   * 401: link inválido, expirado ou revogado. 403 `acesso_desligado` (RIFA-029, D20; detalhes:
   * detalhesAcessoDesligadoSchema): link VÁLIDO de discipulador ou rede com o acesso do papel desligado na campanha
   * ativa; a sessão não é criada e o link continua valendo (entra quando a chave volta). Líder e coordenação não
   * têm chave. A chave é lida na hora, sem cache.
   */
  entrar: {
    metodo: "POST",
    caminho: "/api/sessao",
    grupo: "aberto",
    papeis: null,
    situacao: "detalhada",
    corpo: corpoCriarSessaoSchema,
    sucesso: { status: 200, corpo: respostaSessaoSchema },
  },
  /**
   * RIFA-064 (D29): o login da célula com o nome dela e a senha padrão ("@" + nome normalizado + "1234";
   * login-celula.ts). Abre a sessão do papel `lider` preso à célula, igual à do link (cookie `__Host-sessao`, 45 dias,
   * parada há 7 dias deixa de valer), com o mesmo usuário do link do líder; a célula que ainda não tem esse usuário
   * ganha um, com o `lider_nome` da hierarquia (o líder da importação, mesmo provisório). Mesma origem (CSRF), o mesmo
   * limite de tentativas por IP do POST /api/sessao (429) e o mesmo teto do corpo (413).
   * 401 `nao_autenticado`, com a MESMA mensagem em todos os casos (a resposta não diz se a célula existe): senha
   * errada, nome que não é de nenhuma célula, dois nomes de célula iguais depois da normalização (ambíguo: a
   * coordenação vê o aviso na Hierarquia), o usuário da célula desativado e a chave `acesso.celulas_senha` desligada
   * na Campanha. A senha nunca é gravada (nem na trilha, que registra cada login por senha, sem ela).
   */
  entrarComSenha: {
    metodo: "POST",
    caminho: "/api/sessao/senha",
    grupo: "aberto",
    papeis: null,
    situacao: "detalhada",
    corpo: corpoEntrarComSenhaSchema,
    sucesso: { status: 200, corpo: respostaSessaoSchema },
  },
  /**
   * RIFA-073 (D33): o login do admin com usuário e senha (definidos por ele em PUT /api/admin/minha-senha). Abre a
   * MESMA sessão do link do admin (cookie `__Host-sessao`, 45 dias, parada há 7 dias deixa de valer), sem link
   * (`sessoes.link_id` NULL). Mesma origem (CSRF), o mesmo limite de tentativas por IP do POST /api/sessao (429) e o
   * mesmo teto do corpo (413). 401 `nao_autenticado`, com a MESMA mensagem em todos os casos (a resposta não diz se o
   * usuário existe): usuário que não existe, senha errada, usuário desativado ou que não é mais admin. A trilha
   * registra cada login que abriu sessão (`sessao.entrar_como_admin`), sem a senha.
   */
  entrarComoAdmin: {
    metodo: "POST",
    caminho: "/api/sessao/admin",
    grupo: "aberto",
    papeis: null,
    situacao: "detalhada",
    corpo: corpoEntrarComoAdminSchema,
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
  /**
   * 409 `acao_desligada` (RIFA-029, D20; detalhes: detalhesAcaoDesligadaSchema): o usuário é discipulador ou rede e
   * o acesso do papel está desligado na campanha (a chave `acesso.discipuladores` ou `acesso.redes`). Depois do 404
   * (o papel é o do usuário encontrado).
   */
  criarLink: {
    metodo: "POST",
    caminho: "/api/admin/usuarios/:id/links",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    parametros: parametroIdSchema,
    sucesso: { status: 201, corpo: respostaCriarLinkSchema },
  },
  /**
   * Revoga o link e encerra as sessões abertas por ele. 409 `em_uso` se a revogação deixaria nenhum admin
   * ativo com link válido (gere outro link antes).
   */
  revogarLink: {
    metodo: "DELETE",
    caminho: "/api/admin/links/:id",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    parametros: parametroIdSchema,
    sucesso: { status: 204, corpo: null },
  },
  /** RIFA-073 (D33): a senha de login do admin da sessão (sem a senha e sem o hash). */
  obterMinhaSenhaAdmin: {
    metodo: "GET",
    caminho: "/api/admin/minha-senha",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    sucesso: { status: 200, corpo: respostaSenhaAdminSchema },
  },
  /**
   * RIFA-073 (D33): define ou troca o usuário e a senha de login do admin da sessão. Trocar encerra as OUTRAS sessões
   * dele abertas pela senha (a deste aparelho continua; as abertas pelo link também). A trilha registra
   * `senha_admin.definir` ou `senha_admin.trocar` (alvo `usuario:<id>`), sem a senha e sem o usuário de login.
   * 409 `em_uso`: o usuário de login já é de outro admin.
   */
  definirMinhaSenhaAdmin: {
    metodo: "PUT",
    caminho: "/api/admin/minha-senha",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    corpo: corpoDefinirSenhaAdminSchema,
    sucesso: { status: 200, corpo: respostaSenhaAdminSchema },
  },
  /**
   * RIFA-073 (D33): remove a senha de login do admin da sessão e encerra as sessões dele abertas pela senha (inclusive
   * a deste aparelho, se foi aberta pela senha); as do link continuam. Sem senha, 204 sem mudar nada. A trilha
   * registra `senha_admin.remover` só quando havia senha.
   */
  removerMinhaSenhaAdmin: {
    metodo: "DELETE",
    caminho: "/api/admin/minha-senha",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    sucesso: { status: 204, corpo: null },
  },
} as const satisfies Record<string, DefinicaoRotaAcesso>;

export type NomeRotaAcesso = keyof typeof ROTAS_ACESSO;

// ---------------------------------------------------------------------------------------------------
// Acessos da hierarquia (RIFA-014, D12; papel admin): /api/admin/acessos-hierarquia
// ---------------------------------------------------------------------------------------------------

export const consultaAcessosHierarquiaSchema = z.object({
  papel: papelHierarquiaSchema,
});
export type ConsultaAcessosHierarquia = z.output<
  typeof consultaAcessosHierarquiaSchema
>;

/** O usuário de um alvo, como a lista mostra: sem token e sem hash. */
export const usuarioDoAlvoSchema = z.strictObject({
  id: idSchema,
  /** Para quem o último lote gerou o link (pode ser diferente de `pessoa_nome` se a hierarquia mudou depois). */
  nome: z.string().min(1).max(120),
  ativo: z.boolean(),
  /** Sessões dentro da validade (aparelhos conectados). */
  sessoes_ativas: z.number().int().nonnegative(),
  /** Do mais novo para o mais antigo, inclusive expirados e revogados. */
  links: z.array(linkAcessoSchema),
});

/** Um alvo do papel pedido. A lista traz TODOS os alvos do papel na hierarquia, com ou sem acesso. */
export const itemAcessoHierarquiaSchema = z.strictObject({
  alvo: alvoSchema,
  /**
   * Quem deve receber o link, lido da hierarquia na hora: o lider_nome da célula, o nome do discipulador ou o
   * responsavel_nome da rede (null quando a rede não tem responsável).
   */
  pessoa_nome: z.string().min(1).max(120).nullable(),
  /** Só no papel lider: o lider_telefone da célula, para abrir o WhatsApp. Nos outros papéis, null. */
  telefone: z.string().min(1).max(40).nullable(),
  /** null = o alvo ainda não tem usuário (nenhum link foi gerado para ele). */
  usuario: usuarioDoAlvoSchema.nullable(),
});
export type ItemAcessoHierarquia = z.infer<typeof itemAcessoHierarquiaSchema>;

/**
 * Itens pelo caminho na hierarquia: nome da rede, depois do discipulador, depois da célula (só os níveis que o
 * papel tem; empate de nome, pelo id).
 */
export const respostaAcessosHierarquiaSchema = lista(
  itemAcessoHierarquiaSchema,
);

/** Quantos alvos um lote aceita (a campanha tem 36 células, uns 12 discipuladores e poucas redes). */
export const LIMITE_ALVOS_POR_LOTE = 200;

/** `detalhes` dos 404 e 409 de POST /api/admin/acessos-hierarquia/links: os ids recusados, em ordem crescente. */
export const detalhesIdsRecusadosSchema = z.strictObject({
  ids: z.array(idSchema).min(1),
});

/**
 * POST /api/admin/acessos-hierarquia/links: um link NOVO para cada alvo de `ids`.
 * - Alvo sem usuário: cria o usuário (papel do corpo, preso ao alvo). Alvo com usuário: o nome do usuário passa a
 *   ser o `pessoa_nome` atual (o líder pode ter mudado). Sem `pessoa_nome`, o nome do usuário é o nome do alvo.
 * - `revogar_anteriores: true` revoga, no mesmo lote, os links ainda válidos de cada alvo e encerra as sessões
 *   abertas por eles (ex.: o líder da célula mudou). Sem ela, os links anteriores continuam valendo, como em
 *   criarLink.
 * - Tudo ou nada (um lote só no D1), e uma linha na trilha de auditoria por chamada:
 *   - 409 `acao_desligada` (RIFA-029, D20; detalhes: detalhesAcaoDesligadaSchema) se o papel é discipulador ou rede
 *     e o acesso dele está desligado na campanha, antes de conferir os ids;
 *   - 404 `nao_encontrado` se algum id não é um alvo do papel (detalhes: detalhesIdsRecusadosSchema);
 *   - 409 `em_uso` se algum alvo tem usuário desativado (detalhes: detalhesIdsRecusadosSchema): reative antes com o
 *     PATCH.
 */
export const corpoGerarLinksHierarquiaSchema = z.strictObject({
  papel: papelHierarquiaSchema,
  /** ids de células (lider), discipuladores (discipulador) ou redes (rede), sem repetição. */
  ids: z
    .array(idSchema)
    .min(1)
    .max(LIMITE_ALVOS_POR_LOTE)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "ids repetidos",
    }),
  revogar_anteriores: z.boolean().default(false),
});
export type CorpoGerarLinksHierarquia = z.input<
  typeof corpoGerarLinksHierarquiaSchema
>;

export const linkGeradoHierarquiaSchema = z.strictObject({
  alvo: alvoSchema,
  pessoa_nome: z.string().min(1).max(120).nullable(),
  telefone: z.string().min(1).max(40).nullable(),
  usuario_id: idSchema,
  /** A única vez em que esta URL aparece. Quem tem a URL entra como o usuário do alvo. */
  link: linkAcessoCriadoSchema,
});
export type LinkGeradoHierarquia = z.infer<typeof linkGeradoHierarquiaSchema>;

/** 201: um item por id, na ordem de `ids`. */
export const respostaGerarLinksHierarquiaSchema = z.strictObject({
  itens: z.array(linkGeradoHierarquiaSchema),
});

/**
 * Rotas dos acessos da hierarquia: catálogo à parte de ROTAS_ACESSO (os testes de proteção e de admin passam a
 * percorrer os dois quando a API montar estas rotas). Desativar, gerar um link avulso e revogar usam as rotas
 * que já existem (PATCH /api/admin/usuarios/:id, POST /api/admin/usuarios/:id/links e DELETE
 * /api/admin/links/:id), que aceitam usuários de qualquer papel.
 */
export const ROTAS_ACESSO_HIERARQUIA = {
  listarAcessosHierarquia: {
    metodo: "GET",
    caminho: "/api/admin/acessos-hierarquia",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    consulta: consultaAcessosHierarquiaSchema,
    sucesso: { status: 200, corpo: respostaAcessosHierarquiaSchema },
  },
  gerarLinksHierarquia: {
    metodo: "POST",
    caminho: "/api/admin/acessos-hierarquia/links",
    grupo: "coordenacao",
    papeis: ["admin"],
    situacao: "detalhada",
    corpo: corpoGerarLinksHierarquiaSchema,
    sucesso: { status: 201, corpo: respostaGerarLinksHierarquiaSchema },
  },
} as const satisfies Record<string, DefinicaoRotaAcesso>;
