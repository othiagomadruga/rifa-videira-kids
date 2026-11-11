// Apoio dos testes da tela de acessos: pessoas e alvos da hierarquia de exemplo (nomes fictícios) e uma API
// falsa (o fetch simulado) que guarda tudo em memória e segue as regras da API de verdade (docs/acesso.md e
// docs/api.md): o link com o token só sai na criação, as listas nunca o trazem, ninguém desativa a si mesmo,
// o último admin ativo não é desativado e o último link válido de admin não é revogado; os links em lote da
// hierarquia são tudo ou nada (404 e 409 com os ids), criam o usuário do alvo quando falta, atualizam o nome
// dele para o da hierarquia e, com `revogar_anteriores`, revogam os links válidos e encerram as sessões. As
// respostas passam pelos schemas do contrato.
import { vi } from "vitest";
import {
  ACESSO_PADRAO,
  CHAVE_DE_ACESSO_DO_PAPEL,
  MENSAGENS_PADRAO,
  PUBLICO_PADRAO,
  respostaCampanhaSchema,
  type Campanha,
  consultaAcessosHierarquiaSchema,
  corpoGerarLinksHierarquiaSchema,
  linkAcessoCriadoSchema,
  respostaAcessosHierarquiaSchema,
  respostaCriarLinkSchema,
  respostaCriarUsuarioSchema,
  respostaGerarLinksHierarquiaSchema,
  respostaListaUsuariosSchema,
  usuarioSchema,
  type ItemAcessoHierarquia,
  type LinkAcesso,
  type LinkAcessoCriado,
  type PapelHierarquia,
  type Usuario,
} from "../../../shared/contracts";
import { ADMIN_DE_TESTE, respostaJson } from "../../test/renderizar";

const AGORA = "2026-11-10T22:00:00.000Z";
const VENCE = "2026-12-25T22:00:00.000Z";

export function link(id: number, dados: Partial<LinkAcesso> = {}): LinkAcesso {
  return {
    id,
    criado_em: AGORA,
    expira_em: VENCE,
    revogado_em: null,
    ultimo_uso_em: null,
    situacao: "valido",
    ...dados,
  };
}

/** O admin conectado nos testes (ADMIN_DE_TESTE), uma pessoa da coordenação e uma desativada. */
export function pessoasExemplo(): Usuario[] {
  return [
    {
      id: ADMIN_DE_TESTE.id,
      nome: ADMIN_DE_TESTE.nome,
      email: null,
      papel: "admin",
      ativo: true,
      criado_em: AGORA,
      sessoes_ativas: 1,
      links: [link(1, { ultimo_uso_em: "2026-11-10T22:05:00.000Z" })],
    },
    {
      id: 902,
      nome: "Felipe Coordenador",
      email: "felipe@example.com",
      papel: "coordenacao",
      ativo: true,
      criado_em: AGORA,
      sessoes_ativas: 2,
      links: [
        link(3, { criado_em: "2026-11-10T23:00:00.000Z" }),
        link(2, {
          revogado_em: "2026-11-10T22:30:00.000Z",
          situacao: "revogado",
        }),
      ],
    },
    {
      id: 903,
      nome: "Pastor Fictício",
      email: null,
      papel: "coordenacao",
      ativo: false,
      criado_em: AGORA,
      sessoes_ativas: 0,
      links: [link(4)],
    },
  ];
}

/** Os alvos de cada papel da hierarquia, pelo caminho na hierarquia (rede, discipulador, célula). */
export type AlvosPorPapel = Record<PapelHierarquia, ItemAcessoHierarquia[]>;

/**
 * Líderes: Ágape sem link; Betel com link válido usado; Canaã só com links revogados ou vencidos; Dorcas
 * desativada; Éfeso com link válido, mas a hierarquia trocou o líder depois do último link. Discipuladores:
 * Davi sem link, Elias com link. Redes: uma sem link e outra sem responsável na hierarquia.
 */
export function alvosExemplo(): AlvosPorPapel {
  return {
    lider: [
      {
        alvo: {
          tipo: "celula",
          id: 1,
          nome: "Célula Ágape",
          divisao: "jovens",
        },
        pessoa_nome: "Maria Fictícia",
        telefone: "(91) 98888-7777",
        usuario: null,
      },
      {
        alvo: {
          tipo: "celula",
          id: 2,
          nome: "Célula Betel",
          divisao: "jovens",
        },
        pessoa_nome: "João Fictício",
        telefone: "91 3222-1111",
        usuario: {
          id: 2002,
          nome: "João Fictício",
          ativo: true,
          sessoes_ativas: 1,
          links: [link(3001, { ultimo_uso_em: "2026-11-11T12:00:00.000Z" })],
        },
      },
      {
        alvo: {
          tipo: "celula",
          id: 3,
          nome: "Célula Canaã",
          divisao: "adultos",
        },
        pessoa_nome: "Ana Fictícia",
        telefone: null,
        usuario: {
          id: 2003,
          nome: "Ana Fictícia",
          ativo: true,
          sessoes_ativas: 0,
          links: [
            link(3003, { revogado_em: AGORA, situacao: "revogado" }),
            link(3002, {
              criado_em: "2026-09-20T22:00:00.000Z",
              expira_em: "2026-11-04T22:00:00.000Z",
              situacao: "expirado",
            }),
          ],
        },
      },
      {
        alvo: {
          tipo: "celula",
          id: 4,
          nome: "Célula Dorcas",
          divisao: "adultos",
        },
        pessoa_nome: "Pedro Fictício",
        telefone: "+55 91 99999-0000",
        usuario: {
          id: 2004,
          nome: "Pedro Fictício",
          ativo: false,
          sessoes_ativas: 0,
          links: [link(3004)],
        },
      },
      {
        alvo: {
          tipo: "celula",
          id: 5,
          nome: "Célula Éfeso",
          divisao: "adultos",
        },
        pessoa_nome: "Rute Fictícia",
        telefone: "98888-1234",
        usuario: {
          id: 2005,
          nome: "Lia Fictícia",
          ativo: true,
          sessoes_ativas: 2,
          links: [link(3005, { ultimo_uso_em: "2026-11-10T23:30:00.000Z" })],
        },
      },
    ],
    discipulador: [
      {
        alvo: {
          tipo: "discipulador",
          id: 10,
          nome: "Davi Fictício",
          divisao: "jovens",
        },
        pessoa_nome: "Davi Fictício",
        telefone: null,
        usuario: null,
      },
      {
        alvo: {
          tipo: "discipulador",
          id: 11,
          nome: "Elias Fictício",
          divisao: "jovens",
        },
        pessoa_nome: "Elias Fictício",
        telefone: null,
        usuario: {
          id: 2011,
          nome: "Elias Fictício",
          ativo: true,
          sessoes_ativas: 1,
          links: [link(3011)],
        },
      },
    ],
    rede: [
      {
        alvo: {
          tipo: "rede",
          id: 100,
          nome: "Rede Jovem Fictícia",
          divisao: "jovens",
        },
        pessoa_nome: "Pastor Fictício",
        telefone: null,
        usuario: null,
      },
      {
        alvo: {
          tipo: "rede",
          id: 101,
          nome: "Rede Adulta Fictícia",
          divisao: "adultos",
        },
        pessoa_nome: null,
        telefone: null,
        usuario: null,
      },
    ],
  };
}

export function respostaErro(
  status: number,
  codigo: string,
  mensagem: string,
  detalhes?: unknown,
): Response {
  return respostaJson(
    {
      erro:
        detalhes === undefined
          ? { codigo, mensagem }
          : { codigo, mensagem, detalhes },
    },
    status,
  );
}

/** `consulta`: o que vem depois do "?" (só nas chamadas com consulta). */
export type Chamada = {
  metodo: string;
  caminho: string;
  corpo: unknown;
  consulta?: string;
};
type Responder = (chamada: Chamada) => Response | Promise<Response>;

/** O usuário de um alvo, encontrado pelo id, com o papel e o alvo dele. */
type UsuarioDaHierarquia = {
  papel: PapelHierarquia;
  item: ItemAcessoHierarquia;
  usuario: NonNullable<ItemAcessoHierarquia["usuario"]>;
};

/** `eu`: id de quem está conectado (para a regra de não desativar a si mesmo). */
export function criarApiFalsa(
  inicial: Usuario[] = pessoasExemplo(),
  eu: number = ADMIN_DE_TESTE.id,
  alvosIniciais: AlvosPorPapel = alvosExemplo(),
) {
  const pessoas: Usuario[] = structuredClone(inicial);
  const alvos: AlvosPorPapel = structuredClone(alvosIniciais);
  const chamadas: Chamada[] = [];
  /** URLs com token que a API devolveu (cada uma só na resposta que a criou). */
  const urlsEmitidas: string[] = [];
  const marcadas: { metodo: string; caminho: string; responder: Responder }[] =
    [];
  let proximoId = 1000;
  /**
   * As regras da campanha (D20) que GET /api/admin/campanha devolve; null = sem campanha (404, valem os padrões).
   * Pode mudar com a tela aberta (ex.: desligar o acesso das redes antes de gerar).
   */
  const regras: {
    campanha: Pick<Campanha, "acesso" | "mensagens"> | null;
  } = { campanha: null };

  /** 409 `acao_desligada` se o papel é discipulador ou rede e o acesso dele está desligado. */
  function acessoDesligado(papel: PapelHierarquia): Response | null {
    if (papel === "lider" || !regras.campanha) return null;
    const chave = CHAVE_DE_ACESSO_DO_PAPEL[papel];
    return regras.campanha.acesso[chave]
      ? null
      : respostaErro(
          409,
          "acao_desligada",
          "O acesso está desligado na campanha",
          {
            chave: `acesso.${chave}`,
          },
        );
  }

  /** O link como a criação devolve (com a URL) e como a lista mostra (sem ela). */
  function novoLink(): { criado: LinkAcessoCriado; listado: LinkAcesso } {
    const id = proximoId++;
    const token = `tokenFicticioDoLink${id}`.padEnd(43, "x");
    const url = `${window.location.origin}/acesso/${token}`;
    urlsEmitidas.push(url);
    return {
      criado: linkAcessoCriadoSchema.parse({ ...link(id), url }),
      listado: link(id),
    };
  }

  const ehAdminAtivo = (pessoa: Usuario) =>
    pessoa.papel === "admin" && pessoa.ativo;

  function usuarioDaHierarquia(id: number): UsuarioDaHierarquia | null {
    for (const papel of Object.keys(alvos) as PapelHierarquia[])
      for (const item of alvos[papel])
        if (item.usuario?.id === id)
          return { papel, item, usuario: item.usuario };
    return null;
  }

  /** O usuário de um alvo como o PATCH devolve (usuarioSchema: com papel, alvo e e-mail). */
  function comoUsuario({ papel, item, usuario }: UsuarioDaHierarquia): Usuario {
    return usuarioSchema.parse({
      ...structuredClone(usuario),
      email: null,
      papel,
      alvo: item.alvo,
      criado_em: AGORA,
    });
  }

  function gerarLinksHierarquia(corpo: unknown): Response {
    const lido = corpoGerarLinksHierarquiaSchema.safeParse(corpo);
    if (!lido.success) {
      return respostaErro(400, "requisicao_invalida", "Dados inválidos");
    }
    const { papel, ids, revogar_anteriores } = lido.data;
    const desligado = acessoDesligado(papel);
    if (desligado) return desligado;
    const itens = ids.map((id) =>
      alvos[papel].find((item) => item.alvo.id === id),
    );
    const faltando = ids.filter((_, indice) => !itens[indice]);
    if (faltando.length > 0) {
      return respostaErro(
        404,
        "nao_encontrado",
        "Algum id não é alvo do papel",
        { ids: [...faltando].sort((a, b) => a - b) },
      );
    }
    const desativados = itens
      .filter((item) => item?.usuario && !item.usuario.ativo)
      .map((item) => item?.alvo.id ?? 0);
    if (desativados.length > 0) {
      return respostaErro(409, "em_uso", "Algum alvo tem o acesso desativado", {
        ids: desativados.sort((a, b) => a - b),
      });
    }
    const gerados = itens.map((item) => {
      if (!item) throw new Error("item conferido acima");
      const nome = item.pessoa_nome ?? item.alvo.nome;
      item.usuario ??= {
        id: proximoId++,
        nome,
        ativo: true,
        sessoes_ativas: 0,
        links: [],
      };
      item.usuario.nome = nome;
      if (revogar_anteriores) {
        for (const anterior of item.usuario.links)
          if (anterior.situacao === "valido") {
            anterior.situacao = "revogado";
            anterior.revogado_em = AGORA;
          }
        item.usuario.sessoes_ativas = 0;
      }
      const { criado, listado } = novoLink();
      item.usuario.links.unshift(listado);
      return {
        alvo: item.alvo,
        pessoa_nome: item.pessoa_nome,
        telefone: item.telefone,
        usuario_id: item.usuario.id,
        link: criado,
      };
    });
    return respostaJson(
      respostaGerarLinksHierarquiaSchema.parse({ itens: gerados }),
      201,
    );
  }

  function responderComoAApi({
    metodo,
    caminho,
    corpo,
    consulta,
  }: Chamada): Response {
    if (caminho === "/api/admin/campanha" && metodo === "GET") {
      return regras.campanha
        ? respostaJson(campanhaFicticia(regras.campanha))
        : respostaErro(
            404,
            "nao_encontrado",
            "A campanha ainda não foi configurada",
          );
    }
    if (caminho === "/api/admin/acessos-hierarquia" && metodo === "GET") {
      const lida = consultaAcessosHierarquiaSchema.safeParse(
        Object.fromEntries(new URLSearchParams(consulta)),
      );
      if (!lida.success) {
        return respostaErro(400, "requisicao_invalida", "Consulta inválida");
      }
      return respostaJson(
        respostaAcessosHierarquiaSchema.parse({
          itens: structuredClone(alvos[lida.data.papel]),
        }),
      );
    }
    if (
      caminho === "/api/admin/acessos-hierarquia/links" &&
      metodo === "POST"
    ) {
      return gerarLinksHierarquia(corpo);
    }
    if (caminho === "/api/admin/usuarios" && metodo === "GET") {
      return respostaJson(
        respostaListaUsuariosSchema.parse({ itens: structuredClone(pessoas) }),
      );
    }
    if (caminho === "/api/admin/usuarios" && metodo === "POST") {
      const dados = corpo as Pick<Usuario, "nome" | "email" | "papel">;
      const { criado, listado } = novoLink();
      const usuario = usuarioSchema.parse({
        id: proximoId++,
        nome: dados.nome,
        email: dados.email,
        papel: dados.papel,
        ativo: true,
        criado_em: AGORA,
        sessoes_ativas: 0,
        links: [listado],
      });
      pessoas.push(usuario);
      pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      return respostaJson(
        respostaCriarUsuarioSchema.parse({ usuario, link: criado }),
        201,
      );
    }
    const usuarioId = /^\/api\/admin\/usuarios\/(\d+)(\/links)?$/.exec(caminho);
    if (usuarioId) {
      const id = Number(usuarioId[1]);
      const pessoa = pessoas.find((item) => item.id === id);
      const daHierarquia = pessoa ? null : usuarioDaHierarquia(id);
      if (!pessoa && !daHierarquia) {
        return respostaErro(404, "nao_encontrado", "Usuário não encontrado");
      }
      const links = (pessoa ?? daHierarquia?.usuario)?.links ?? [];
      if (usuarioId[2] && metodo === "POST") {
        const desligado = daHierarquia && acessoDesligado(daHierarquia.papel);
        if (desligado) return desligado;
        const { criado, listado } = novoLink();
        links.unshift(listado);
        return respostaJson(
          respostaCriarLinkSchema.parse({ link: criado }),
          201,
        );
      }
      if (!usuarioId[2] && metodo === "PATCH") {
        const { ativo } = corpo as { ativo: boolean };
        if (daHierarquia) {
          daHierarquia.usuario.ativo = ativo;
          if (!ativo) daHierarquia.usuario.sessoes_ativas = 0;
          return respostaJson(comoUsuario(daHierarquia));
        }
        if (!pessoa) throw new Error("pessoa conferida acima");
        if (!ativo && pessoa.id === eu) {
          return respostaErro(
            409,
            "em_uso",
            "Você não pode desativar o seu próprio acesso: peça a outro admin",
          );
        }
        if (
          !ativo &&
          ehAdminAtivo(pessoa) &&
          pessoas.filter(ehAdminAtivo).length === 1
        ) {
          return respostaErro(409, "em_uso", "Este é o último admin ativo");
        }
        pessoa.ativo = ativo;
        if (!ativo) pessoa.sessoes_ativas = 0;
        return respostaJson(usuarioSchema.parse(structuredClone(pessoa)));
      }
    }
    const linkId = /^\/api\/admin\/links\/(\d+)$/.exec(caminho);
    if (linkId && metodo === "DELETE") {
      const id = Number(linkId[1]);
      const temOLink = (item: { links: LinkAcesso[] }) =>
        item.links.some((link) => link.id === id);
      const dono = pessoas.find(temOLink);
      const doAlvo = Object.values(alvos)
        .flat()
        .find((item) => item.usuario && temOLink(item.usuario))?.usuario;
      const alvo = (dono ?? doAlvo)?.links.find((item) => item.id === id);
      if (!alvo) {
        return respostaErro(404, "nao_encontrado", "Link não encontrado");
      }
      const sobraAdminComLink = pessoas.some(
        (pessoa) =>
          ehAdminAtivo(pessoa) &&
          pessoa.links.some(
            (item) => item.id !== id && item.situacao === "valido",
          ),
      );
      if (dono && alvo.situacao === "valido" && !sobraAdminComLink) {
        return respostaErro(
          409,
          "em_uso",
          "Este é o último link válido de um admin ativo",
        );
      }
      alvo.revogado_em ??= AGORA;
      alvo.situacao = "revogado";
      // Sem outro link válido, as sessões do usuário (abertas pelos links revogados) acabam.
      if (doAlvo && !doAlvo.links.some((item) => item.situacao === "valido")) {
        doAlvo.sessoes_ativas = 0;
      }
      return new Response(null, { status: 204 });
    }
    return respostaErro(404, "nao_encontrado", "Rota não encontrada");
  }

  const fetchFalso = vi.fn(
    async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      const chamada: Chamada = {
        metodo: init?.method ?? "GET",
        caminho: url.pathname,
        corpo:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      if (url.search !== "") chamada.consulta = url.search.slice(1);
      chamadas.push(chamada);
      const indice = marcadas.findIndex(
        (marcada) =>
          marcada.metodo === chamada.metodo &&
          marcada.caminho === chamada.caminho,
      );
      if (indice >= 0) {
        const [marcada] = marcadas.splice(indice, 1);
        return marcada.responder(chamada);
      }
      return responderComoAApi(chamada);
    },
  );

  return {
    fetch: fetchFalso,
    regras,
    pessoas,
    alvos,
    chamadas,
    urlsEmitidas,
    /** A próxima chamada a `metodo caminho` recebe esta resposta (uma vez só). */
    proxima(metodo: string, caminho: string, resposta: Response | Responder) {
      marcadas.push({
        metodo,
        caminho,
        responder: typeof resposta === "function" ? resposta : () => resposta,
      });
    },
    chamadasA(metodo: string, caminho: string) {
      return chamadas.filter(
        (chamada) => chamada.metodo === metodo && chamada.caminho === caminho,
      );
    },
  };
}

export type ApiFalsa = ReturnType<typeof criarApiFalsa>;

/** Uma campanha fictícia com as regras do admin dadas (o resto não importa à tela Acessos). */
export function campanhaFicticia(
  regras: Partial<Pick<Campanha, "acesso" | "mensagens">> = {},
): Campanha {
  return respostaCampanhaSchema.parse({
    id: 1,
    nome: "Rifa Ficticia",
    slug_rifei: "rifa-ficticia",
    fuso_horario: "America/Belem",
    data_inicio: "2026-11-23",
    data_fim: "2026-12-16",
    preco_bilhete_centavos: 2000,
    meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
    periodos: [
      {
        ordem: 1,
        nome: "Período 1",
        dias: 24,
        percentual_bp: 10000,
        data_inicio: "2026-11-23",
        data_fim: "2026-12-16",
      },
    ],
    soma_percentuais_bp: 10000,
    ranking: { criterio: "percentual_meta" },
    publico: { ...PUBLICO_PADRAO },
    pedidos: { desconsiderar: false },
    acesso: { ...ACESSO_PADRAO, ...regras.acesso },
    mensagens: { ...MENSAGENS_PADRAO, ...regras.mensagens },
    criado_em: "2026-11-06T18:00:00.000Z",
    atualizado_em: "2026-11-06T18:00:00.000Z",
  });
}
