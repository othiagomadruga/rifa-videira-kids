// Apoio dos testes da tela de rankings: respostas de exemplo de GET /api/painel/ranking (cada uma passa
// pelo schema do contrato, que é estrito: um campo a mais ou errado quebra o teste já na montagem) e uma
// API falsa que responde conforme a consulta e guarda os caminhos pedidos.
import { vi } from "vitest";
import {
  respostaMaioresCompradoresSchema,
  respostaRankingSchema,
} from "../../../shared/contracts/api";
import type {
  Divisao,
  ItemRanking,
  JanelaRankingResposta,
  ReferenciaCampanha,
  RespostaRanking,
} from "../../../shared/contracts/calculos";
import { ehListaDasRedes, respostaRedes } from "../../test/redes";
import { respostaJson } from "../../test/renderizar";

/** 04/12/2026 às 15:30 em Belém (o exemplo de docs/api.md: dia 12 de 24, 2º dia da Semana 2). */
export const AGORA = "2026-12-04T18:30:00.000Z";

export const REFERENCIA_DIA_12: ReferenciaCampanha = {
  data: "2026-12-04",
  fase: "durante",
  data_inicio: "2026-11-23",
  data_fim: "2026-12-16",
  duracao_dias: 24,
  dia_campanha: 12,
  dias_restantes: 13,
  dias_para_inicio: null,
  periodo: {
    ordem: 2,
    nome: "Semana 2",
    data_inicio: "2026-12-03",
    data_fim: "2026-12-09",
    dias: 7,
    dia_no_periodo: 2,
    dias_restantes: 6,
  },
};

export const JANELA_SEMANA_2: JanelaRankingResposta = {
  tipo: "atual",
  ordem: 2,
  nome: "Semana 2",
  data_inicio: "2026-12-03",
  data_fim: "2026-12-09",
};

export const JANELA_CAMPANHA: JanelaRankingResposta = {
  tipo: "campanha",
  ordem: null,
  nome: "Campanha inteira",
  data_inicio: "2026-11-23",
  data_fim: "2026-12-16",
};

const VINCULOS: Record<
  Divisao,
  { discipulador: ItemRanking["discipulador"]; rede: ItemRanking["rede"] }
> = {
  jovens: {
    discipulador: { id: 1, nome: "Discipulador Ficticio A" },
    rede: { id: 1, nome: "Rede Jovem Ficticia" },
  },
  adultos: {
    discipulador: { id: 2, nome: "Discipulador Ficticio B" },
    rede: { id: 2, nome: "Rede Adulta Ficticia" },
  },
};

type DadosItem = {
  posicao: number;
  id: number;
  nome: string;
  /** Na unidade da meta (bilhetes ou centavos). */
  realizado: number;
  meta: number;
  esperado: number;
  divisao?: Divisao;
  nivel?: RespostaRanking["nivel"];
};

/**
 * Um item coerente: % da meta truncado (null sem meta), diferença = realizado − esperado e situação pela
 * regra R4 (em dia quando realizado ≥ esperado; sem meta quando a meta é zero).
 */
export function item({
  posicao,
  id,
  nome,
  realizado,
  meta,
  esperado,
  divisao = "jovens",
  nivel = "celula",
}: DadosItem): ItemRanking {
  const vinculos = VINCULOS[divisao];
  return {
    posicao,
    id,
    nome,
    divisao,
    discipulador: nivel === "celula" ? vinculos.discipulador : null,
    rede: nivel === "rede" ? null : vinculos.rede,
    meta,
    esperado,
    realizado,
    diferenca: realizado - esperado,
    situacao:
      meta === 0 ? "sem_meta" : realizado >= esperado ? "em_dia" : "abaixo",
    percentual_meta_bp:
      meta === 0 ? null : Math.trunc((realizado * 10_000) / meta),
    vendas: {
      pedidos_aprovados: Math.ceil(realizado / 3),
      bilhetes: realizado,
      total_centavos: realizado * 2000,
    },
    acima: null,
    abaixo: null,
  };
}

/** Uma resposta da rota, conferida pelo schema estrito do contrato. */
export function respostaRanking(
  dados: Partial<RespostaRanking> & Pick<RespostaRanking, "itens">,
): RespostaRanking {
  return respostaRankingSchema.parse({
    nivel: "celula",
    divisao: null,
    janela: JANELA_SEMANA_2,
    criterio: "percentual_meta",
    unidade: "bilhetes",
    referencia: REFERENCIA_DIA_12,
    atualizado_em: AGORA,
    ...dados,
  });
}

/** O que a API falsa devolve para uma consulta: uma resposta, ou uma Response pronta (erro, por exemplo). */
export type Responder = (
  consulta: URLSearchParams,
) => RespostaRanking | Response | Promise<RespostaRanking | Response>;

/**
 * Troca o fetch por uma API que só conhece GET /api/painel/ranking. `caminhos` guarda cada caminho pedido
 * (com a consulta); outra rota responde 404 e fica em `inesperadas`. A lista das redes (RIFA-065, D30: a tela
 * pergunta quantas há) responde com `redes` redes (padrão: duas, a tela como sempre foi) e fica em `pedidosDasRedes`.
 * Os maiores compradores (RIFA-083, só o admin pede) respondem sem nenhuma compra na janela pedida e ficam em
 * `pedidosDosCompradores`.
 */
export function simularApiRanking(
  responder: Responder,
  { redes = 2 }: { redes?: number } = {},
) {
  const caminhos: string[] = [];
  const inesperadas: string[] = [];
  const pedidosDasRedes: string[] = [];
  const pedidosDosCompradores: string[] = [];
  const fetchMock = vi.fn(async (entrada: RequestInfo | URL) => {
    const caminho = String(entrada);
    const url = new URL(caminho, "http://localhost");
    if (ehListaDasRedes(caminho)) {
      pedidosDasRedes.push(caminho);
      return respostaRedes(redes);
    }
    if (url.pathname === "/api/admin/maiores-compradores") {
      pedidosDosCompradores.push(caminho);
      return respostaJson(
        respostaMaioresCompradoresSchema.parse({
          janela:
            url.searchParams.get("janela") === "campanha"
              ? JANELA_CAMPANHA
              : JANELA_SEMANA_2,
          itens: [],
          atualizado_em: AGORA,
        }),
      );
    }
    if (url.pathname !== "/api/painel/ranking") {
      inesperadas.push(caminho);
      return respostaJson(
        { erro: { codigo: "nao_encontrado", mensagem: "Rota inesperada" } },
        404,
      );
    }
    caminhos.push(caminho);
    const resultado = await responder(url.searchParams);
    return resultado instanceof Response ? resultado : respostaJson(resultado);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    caminhos,
    inesperadas,
    pedidosDasRedes,
    pedidosDosCompradores,
  };
}

/** Resposta coerente com a consulta: nível, divisão e janela pedidos, com os itens dados. */
export function respostaDaConsulta(
  consulta: URLSearchParams,
  itens: ItemRanking[],
  dados: Partial<RespostaRanking> = {},
): RespostaRanking {
  const nivel = (consulta.get("nivel") ?? "celula") as RespostaRanking["nivel"];
  const divisao = (consulta.get("divisao") as Divisao | null) ?? null;
  return respostaRanking({
    nivel,
    divisao,
    janela:
      consulta.get("periodo") === "campanha"
        ? JANELA_CAMPANHA
        : JANELA_SEMANA_2,
    itens,
    ...dados,
  });
}
