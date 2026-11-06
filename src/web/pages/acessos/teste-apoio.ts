// Apoio dos testes da tela de acessos: pessoas de exemplo (nomes fictícios) e uma API falsa (o fetch
// simulado) que guarda tudo em memória e segue as regras da API de verdade (docs/acesso.md): o link com o
// token só sai na criação, a lista nunca o traz, ninguém desativa a si mesmo, o último admin ativo não é
// desativado e o último link válido de admin não é revogado. As respostas passam pelos schemas do contrato.
import { vi } from "vitest";
import {
  linkAcessoCriadoSchema,
  respostaCriarLinkSchema,
  respostaCriarUsuarioSchema,
  respostaListaUsuariosSchema,
  usuarioSchema,
  type LinkAcesso,
  type LinkAcessoCriado,
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

export type Chamada = { metodo: string; caminho: string; corpo: unknown };
type Responder = (chamada: Chamada) => Response | Promise<Response>;

/** `eu`: id de quem está conectado (para a regra de não desativar a si mesmo). */
export function criarApiFalsa(
  inicial: Usuario[] = pessoasExemplo(),
  eu: number = ADMIN_DE_TESTE.id,
) {
  const pessoas: Usuario[] = structuredClone(inicial);
  const chamadas: Chamada[] = [];
  /** URLs com token que a API devolveu (cada uma só na resposta que a criou). */
  const urlsEmitidas: string[] = [];
  const marcadas: { metodo: string; caminho: string; responder: Responder }[] =
    [];
  let proximoId = 1000;

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

  function responderComoAApi({ metodo, caminho, corpo }: Chamada): Response {
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
      const pessoa = pessoas.find((item) => item.id === Number(usuarioId[1]));
      if (!pessoa) {
        return respostaErro(404, "nao_encontrado", "Usuário não encontrado");
      }
      if (usuarioId[2] && metodo === "POST") {
        const { criado, listado } = novoLink();
        pessoa.links.unshift(listado);
        return respostaJson(
          respostaCriarLinkSchema.parse({ link: criado }),
          201,
        );
      }
      if (!usuarioId[2] && metodo === "PATCH") {
        const { ativo } = corpo as { ativo: boolean };
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
      const dono = pessoas.find((pessoa) =>
        pessoa.links.some((item) => item.id === id),
      );
      const alvo = dono?.links.find((item) => item.id === id);
      if (!dono || !alvo) {
        return respostaErro(404, "nao_encontrado", "Link não encontrado");
      }
      const sobraAdminComLink = pessoas.some(
        (pessoa) =>
          ehAdminAtivo(pessoa) &&
          pessoa.links.some(
            (item) => item.id !== id && item.situacao === "valido",
          ),
      );
      if (alvo.situacao === "valido" && !sobraAdminComLink) {
        return respostaErro(
          409,
          "em_uso",
          "Este é o último link válido de um admin ativo",
        );
      }
      alvo.revogado_em ??= AGORA;
      alvo.situacao = "revogado";
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
    pessoas,
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
