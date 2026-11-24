// Apoio dos testes de "Quem comprou" do admin (RIFA-093): respostas que passam no schema estrito do contrato e uma API
// falsa que responde as duas rotas (o resto, 404). Nomes e telefones fictícios.
import { vi } from "vitest";
import {
  respostaCelulasQuemComprouSchema,
  respostaCompradoresDaCelulaSchema,
  type CelulaQuemComprou,
  type ItemCompradorDaCelula,
  type RespostaCompradoresDaCelula,
} from "../../../shared/contracts/api";
import { respostaJson } from "../../test/renderizar";

export const CELULAS: CelulaQuemComprou[] = [
  {
    id: 2,
    nome: "Célula Betel",
    discipulador: "Discipulador Abel",
    pedidos: 1,
    bilhetes: 12,
  },
  {
    id: 3,
    nome: "Célula Canaã",
    discipulador: "Discipulador Boaz",
    pedidos: 4,
    bilhetes: 12,
  },
  {
    id: 1,
    nome: "Célula Ágape",
    discipulador: "Discipulador Abel",
    pedidos: 1,
    bilhetes: 7,
  },
  {
    id: 4,
    nome: "Célula Dorcas",
    discipulador: "Discipulador Caleb",
    pedidos: 0,
    bilhetes: 0,
  },
];

/** As compras da Canaã, da mais recente para a mais antiga (a atribuída à mão primeiro). */
export const COMPRAS_DA_CANAA: ItemCompradorDaCelula[] = [
  {
    pedido_id: "ATRIBUIDA",
    nome: "Comprador Ficticio Atribuido",
    telefone: "+5591900000004",
    aprovado_em: "2026-11-24T13:00:00.000Z",
    bilhetes: 5,
    origem_celula: "manual",
  },
  {
    pedido_id: "CANAA-3",
    nome: "Compradora Ficticia Tres",
    telefone: null,
    aprovado_em: "2026-11-24T12:30:00.000Z",
    bilhetes: 1,
    origem_celula: "afiliado",
  },
  {
    pedido_id: "CANAA-2",
    nome: null,
    telefone: "+5591900000002",
    aprovado_em: "2026-11-23T17:03:00.000Z",
    bilhetes: 4,
    origem_celula: "afiliado",
  },
  {
    pedido_id: "CANAA-1",
    nome: "Comprador Ficticio Um",
    telefone: "+5591900000001",
    aprovado_em: "2026-11-23T15:01:00.000Z",
    bilhetes: 2,
    origem_celula: "afiliado",
  },
];

/** Quantas compras a primeira página traz (o "Ver mais" traz o resto). */
export const PRIMEIRA_PAGINA = 2;

function compradoresDe(
  celula: CelulaQuemComprou,
  itens: ItemCompradorDaCelula[],
  proximo: string | null,
): RespostaCompradoresDaCelula {
  return respostaCompradoresDaCelulaSchema.parse({
    celula: { id: celula.id, nome: celula.nome },
    fuso_horario: "America/Belem",
    totais: { pedidos: celula.pedidos, bilhetes: celula.bilhetes },
    itens,
    proximo,
    atualizado_em: "2026-11-24T18:00:00.000Z",
  });
}

type Opcoes = {
  /** Resposta da lista das células (padrão: CELULAS); um número = esse status de erro. */
  celulas?: CelulaQuemComprou[] | 404 | 500;
};

/**
 * A API falsa: a lista das células e as compras de cada uma (a Canaã com duas páginas; as outras, uma compra fictícia
 * ou nenhuma). Guarda os caminhos pedidos.
 */
export function criarApiQuemComprou({ celulas = CELULAS }: Opcoes = {}) {
  const pedidos: string[] = [];
  const fetch = vi.fn(async (entrada: RequestInfo | URL) => {
    const url = new URL(String(entrada), "https://site.example");
    pedidos.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/api/admin/quem-comprou/celulas") {
      if (typeof celulas === "number")
        return respostaJson(
          {
            erro: {
              codigo: celulas === 404 ? "nao_encontrado" : "erro_interno",
              mensagem:
                celulas === 404
                  ? "A campanha ainda não foi configurada"
                  : "Erro interno",
            },
          },
          celulas,
        );
      return respostaJson(
        respostaCelulasQuemComprouSchema.parse({
          celulas,
          atualizado_em: "2026-11-24T18:00:00.000Z",
        }),
      );
    }
    const compradores = /^\/api\/admin\/celulas\/(\d+)\/compradores$/.exec(
      url.pathname,
    );
    const celula = CELULAS.find(
      (item) => compradores !== null && item.id === Number(compradores[1]),
    );
    if (celula !== undefined) {
      if (celula.id !== 3)
        return respostaJson(
          compradoresDe(
            celula,
            celula.pedidos === 0
              ? []
              : [
                  {
                    pedido_id: `PED-${celula.id}`,
                    nome: `Comprador Ficticio da ${celula.nome}`,
                    telefone: "+5591900000009",
                    aprovado_em: "2026-11-24T10:00:00.000Z",
                    bilhetes: celula.bilhetes,
                    origem_celula: "afiliado",
                  },
                ],
            null,
          ),
        );
      const antesDe = url.searchParams.get("antes_de");
      return respostaJson(
        antesDe === null
          ? compradoresDe(
              celula,
              COMPRAS_DA_CANAA.slice(0, PRIMEIRA_PAGINA),
              "cursor-2",
            )
          : compradoresDe(
              celula,
              COMPRAS_DA_CANAA.slice(PRIMEIRA_PAGINA),
              null,
            ),
      );
    }
    return respostaJson(
      { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
      404,
    );
  });
  return { fetch, pedidos };
}
