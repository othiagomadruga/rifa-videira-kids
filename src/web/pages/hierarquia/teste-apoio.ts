// Apoio dos testes da tela da hierarquia: registros de exemplo e uma API falsa (o fetch simulado) que
// guarda os dados em memória como a API de verdade: GET lê, PUT altera (e os nomes derivados mudam
// junto), DELETE remove. Uma resposta específica pode ser marcada para a próxima chamada de uma rota.
import { vi } from "vitest";
import type {
  Celula,
  Discipulador,
  Divisao,
  Rede,
  RespostaImportarHierarquia,
} from "../../../shared/contracts";
import { respostaJson } from "../../test/renderizar";
import type { Hierarquia } from "./hierarquia-api";

const INSTANTE = "2026-11-06T18:00:00.000Z";

export function criarRede(
  id: number,
  nome: string,
  divisao: Divisao,
  responsavel_nome: string | null = null,
): Rede {
  return {
    id,
    nome,
    divisao,
    responsavel_nome,
    criado_em: INSTANTE,
    atualizado_em: INSTANTE,
  };
}

export function criarDiscipulador(
  id: number,
  nome: string,
  rede: Rede,
): Discipulador {
  return {
    id,
    rede_id: rede.id,
    nome,
    rede_nome: rede.nome,
    divisao: rede.divisao,
    // RIFA-084 (D39): sem grupo, como todo discipulador antes de a coordenação escolher.
    grupo_id: null,
    grupo_nome: null,
    criado_em: INSTANTE,
    atualizado_em: INSTANTE,
  };
}

export function criarCelula(
  id: number,
  nome: string,
  discipulador: Discipulador,
  dados: Partial<
    Pick<
      Celula,
      "qtd_pessoas" | "lider_nome" | "lider_email" | "lider_telefone"
    >
  > = {},
): Celula {
  return {
    id,
    discipulador_id: discipulador.id,
    nome,
    qtd_pessoas: 10,
    lider_nome: `Líder da ${nome}`,
    lider_email: null,
    lider_telefone: null,
    ...dados,
    discipulador_nome: discipulador.nome,
    rede_id: discipulador.rede_id,
    rede_nome: discipulador.rede_nome,
    divisao: discipulador.divisao,
    criado_em: INSTANTE,
    atualizado_em: INSTANTE,
  };
}

/** 2 redes (jovens e adultos), 3 discipuladores e 4 células, com 54 pessoas. Nomes fictícios. */
export function hierarquiaExemplo(): Hierarquia {
  const jovem = criarRede(1, "Rede Jovem Norte", "jovens", "Pastor Fictício");
  const adulta = criarRede(2, "Rede Adulta Sul", "adultos");
  const ana = criarDiscipulador(11, "Ana Discipuladora", jovem);
  const bruno = criarDiscipulador(12, "Bruno Discipulador", jovem);
  const carla = criarDiscipulador(13, "Carla Discipuladora", adulta);
  return {
    redes: [jovem, adulta],
    discipuladores: [ana, bruno, carla],
    celulas: [
      criarCelula(101, "Célula Esperança", ana, {
        qtd_pessoas: 12,
        lider_nome: "Lucas Líder",
        lider_email: "lucas@example.com",
        lider_telefone: "(91) 90000-0001",
      }),
      criarCelula(102, "Célula Fé", bruno, {
        qtd_pessoas: 9,
        lider_nome: "Marta Líder",
      }),
      criarCelula(103, "Célula Ágape", carla, {
        qtd_pessoas: 15,
        lider_nome: "Nina Líder",
        lider_email: "nina@example.com",
      }),
      criarCelula(104, "Célula Vida", carla, {
        qtd_pessoas: 18,
        lider_nome: "Otávio Líder",
        lider_telefone: "(91) 90000-0004",
      }),
    ],
  };
}

export function hierarquiaVazia(): Hierarquia {
  return { redes: [], discipuladores: [], celulas: [] };
}

/** Corpo de erro no formato da API. */
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

/** Relatório da importação com tudo zerado, para completar nos testes. */
export function relatorio(
  dados: Partial<RespostaImportarHierarquia> = {},
): RespostaImportarHierarquia {
  const zero = { redes: 0, discipuladores: 0, celulas: 0 };
  return {
    aplicado: false,
    simulado: true,
    total_linhas: 0,
    criados: zero,
    atualizados: zero,
    inalterados: zero,
    erros: [],
    ...dados,
    // A RIFA-005b tornou `avisos` obrigatório na resposta (lista possivelmente vazia).
    avisos: dados.avisos ?? [],
  };
}

export type Chamada = { metodo: string; caminho: string; corpo: unknown };
type Responder = (chamada: Chamada) => Response | Promise<Response>;

export function criarApiFalsa(inicial: Hierarquia = hierarquiaExemplo()) {
  const dados: Hierarquia = structuredClone(inicial);
  const chamadas: Chamada[] = [];
  const marcadas: { metodo: string; caminho: string; responder: Responder }[] =
    [];

  const fetchFalso = vi.fn(
    async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(entrada), "http://localhost");
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

  function responderComoAApi({ metodo, caminho, corpo }: Chamada): Response {
    const [, , , recurso, textoId] = caminho.split("/");
    const id = Number(textoId);
    if (
      recurso === "redes" ||
      recurso === "discipuladores" ||
      recurso === "celulas"
    ) {
      const lista: { id: number }[] = dados[recurso];
      if (metodo === "GET" && textoId === undefined) {
        return respostaJson({ itens: structuredClone(lista) });
      }
      const atual = lista.find((item) => item.id === id);
      if (!atual) return respostaErro(404, "nao_encontrado", "Não encontrado");
      if (metodo === "DELETE") {
        lista.splice(lista.indexOf(atual), 1);
        return new Response(null, { status: 204 });
      }
      if (metodo === "PUT") {
        Object.assign(atual, corpo);
        recalcularDerivados();
        return respostaJson(structuredClone(atual));
      }
    }
    return respostaErro(404, "nao_encontrado", "Rota não encontrada");
  }

  // Nomes e divisão vêm da rede e do discipulador, como nos SELECTs da API.
  function recalcularDerivados() {
    for (const discipulador of dados.discipuladores) {
      const rede = dados.redes.find((item) => item.id === discipulador.rede_id);
      if (rede) {
        discipulador.rede_nome = rede.nome;
        discipulador.divisao = rede.divisao;
      }
    }
    for (const celula of dados.celulas) {
      const discipulador = dados.discipuladores.find(
        (item) => item.id === celula.discipulador_id,
      );
      if (discipulador) {
        celula.discipulador_nome = discipulador.nome;
        celula.rede_id = discipulador.rede_id;
        celula.rede_nome = discipulador.rede_nome;
        celula.divisao = discipulador.divisao;
      }
    }
  }

  return {
    fetch: fetchFalso,
    /** Estado atual (os testes podem mexer, ex.: simular o que uma importação gravou). */
    dados,
    chamadas,
    /** A próxima chamada a `metodo caminho` recebe esta resposta (uma vez só). */
    proxima(metodo: string, caminho: string, resposta: Response | Responder) {
      marcadas.push({
        metodo,
        caminho,
        responder: typeof resposta === "function" ? resposta : () => resposta,
      });
    },
    /** Chamadas feitas a `metodo caminho`. */
    chamadasA(metodo: string, caminho: string) {
      return chamadas.filter(
        (chamada) => chamada.metodo === metodo && chamada.caminho === caminho,
      );
    },
  };
}

export type ApiFalsa = ReturnType<typeof criarApiFalsa>;
