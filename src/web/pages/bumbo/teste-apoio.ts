// Apoio dos testes do bumbo. A campanha fictícia é a do cenário dos testes do Worker (21 dias a partir de
// 23/11/2026, três semanas de 7 dias com 35/25/45, 10 bilhetes por pessoa), com quatro células. A API
// simulada responde como a de verdade: o texto sai de montarBumbo (calculos.ts), a mesma função que o
// Worker chama, e a janela do `data` é a da rota (do 1º dia ao dia seguinte ao último, nunca depois de
// hoje), com os mesmos erros.
import { vi } from "vitest";
import { respostaBumboSchema } from "../../../shared/contracts/api";
import {
  montarBumbo,
  type CampanhaCalculo,
  type CelulaCalculo,
  type RespostaBumbo,
  type VendasDoDia,
} from "../../../shared/contracts/calculos";
import { respostaJson } from "../../test/renderizar";
import { somarDias } from "./textos";

export const CAMPANHA: CampanhaCalculo = {
  nome: "Rifa Videira Kids",
  fuso_horario: "America/Belem",
  data_inicio: "2026-11-23",
  meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
  periodos: [
    { nome: "Semana 1", dias: 7, percentual_bp: 3500 },
    { nome: "Semana 2", dias: 7, percentual_bp: 2500 },
    { nome: "Semana 3", dias: 7, percentual_bp: 4500 },
  ],
  ranking: { criterio: "percentual_meta" },
  publico: { mostra_percentual_meta: false, limite_ranking: 3 },
};

/** Último dia de vendas do cenário e o último dia que a rota aceita no `data`. */
export const FIM = "2026-12-13";
export const DIA_SEGUINTE_AO_FIM = "2026-12-14";

function celula(
  id: number,
  nome: string,
  qtd_pessoas: number,
  divisao: CelulaCalculo["divisao"],
): CelulaCalculo {
  const jovens = divisao === "jovens";
  return {
    id,
    nome,
    qtd_pessoas,
    discipulador_id: jovens ? 1 : 2,
    discipulador_nome: jovens
      ? "Discipulador Ficticio A"
      : "Discipulador Ficticio B",
    rede_id: jovens ? 1 : 2,
    rede_nome: jovens ? "Rede Jovem Ficticia" : "Rede Adulta Ficticia",
    divisao,
  };
}

export const CELULAS: CelulaCalculo[] = [
  celula(1, "Célula Ágape", 12, "jovens"),
  celula(2, "Célula Betel", 6, "jovens"),
  celula(3, "Célula Dorcas", 20, "adultos"),
  celula(4, "Célula Éfeso", 10, "adultos"),
];

/** Vendas de todas as células em todos os dias da campanha (bilhetes = pedidos; 20 reais cada). */
export const VENDAS: VendasDoDia[] = Array.from({ length: 21 }, (_, dia) =>
  CELULAS.map(({ id }) => {
    const bilhetes = 1 + ((dia + id) % 3);
    return {
      celula_id: id,
      dia: somarDias(CAMPANHA.data_inicio, dia),
      pedidos: bilhetes,
      bilhetes,
      centavos: bilhetes * 2000,
    };
  }),
).flat();

/** Instantes (meio-dia em Belém) das fases do cenário. */
export const INSTANTES = {
  /** 20/11: faltam 3 dias para começar. */
  antes: new Date("2026-11-20T15:00:00.000Z"),
  /** 23/11: o 1º dia (a mensagem da largada). */
  primeiroDia: new Date("2026-11-23T15:00:00.000Z"),
  /** 01/12: o dia 9 de 21 (2º dia da Semana 2). */
  durante: new Date("2026-12-01T15:00:00.000Z"),
  /** 20/12: a campanha acabou em 13/12. */
  encerrada: new Date("2026-12-20T15:00:00.000Z"),
} as const;

/** Hoje (em Belém) de um dos instantes acima. */
export const hojeDe = (agora: Date) =>
  new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

/** A mesma campanha com a meta em R$ (R$ 200,00 por pessoa): o texto continua só com percentuais. */
export const CAMPANHA_EM_REAIS: CampanhaCalculo = {
  ...CAMPANHA,
  meta: { unidade: "centavos", regra: "por_pessoa", valor: 20_000 },
};

/** A resposta de GET /api/publico/bumbo como a API daria (conferida no schema estrito do contrato). */
export function respostaDoBumbo(
  agora: Date,
  data?: string,
  vendas: readonly VendasDoDia[] = VENDAS,
  campanha: CampanhaCalculo = CAMPANHA,
): RespostaBumbo {
  return respostaBumboSchema.parse(
    montarBumbo({ campanha, celulas: CELULAS, vendas }, { data }, agora),
  );
}

const dataPorExtenso = (data: string) =>
  `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`;

/** O 400 da rota para um `data` fora da janela da campanha. */
export const MENSAGEM_FORA_DA_JANELA = `A data precisa estar entre ${dataPorExtenso(CAMPANHA.data_inicio)} e ${dataPorExtenso(DIA_SEGUINTE_AO_FIM)} (do 1º dia da campanha ao dia seguinte ao último)`;

export type ApiDoBumbo = {
  /** "Agora" da API (muda o hoje). */
  agora: Date;
  campanha: CampanhaCalculo;
  vendas: readonly VendasDoDia[];
  /** Texto fixo no lugar do montado (ex.: com caracteres que precisam de codificação na URL). */
  texto: string | null;
  /** Quantas das próximas chamadas falham sem conexão. */
  falhas: number;
  /** Erro fixo da API (ex.: 404 sem campanha ativa) para as próximas chamadas. */
  erro: { status: number; codigo: string; mensagem: string } | null;
  /** Todos os caminhos pedidos, na ordem. */
  caminhos: string[];
};

/** Troca o fetch por uma API do bumbo que responde conforme o `data` pedido. */
export function simularApi(
  cenario: Partial<Omit<ApiDoBumbo, "caminhos">> = {},
): ApiDoBumbo {
  const api: ApiDoBumbo = {
    agora: INSTANTES.durante,
    campanha: CAMPANHA,
    vendas: VENDAS,
    texto: null,
    falhas: 0,
    erro: null,
    ...cenario,
    caminhos: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const caminho = String(entrada);
      api.caminhos.push(caminho);
      const url = new URL(caminho, "http://localhost");
      if (url.pathname !== "/api/publico/bumbo")
        return respostaJson(
          { erro: { codigo: "nao_encontrado", mensagem: "Rota inesperada" } },
          404,
        );
      if (api.falhas > 0) {
        api.falhas -= 1;
        throw new TypeError("Failed to fetch");
      }
      if (api.erro) {
        const { status, codigo, mensagem } = api.erro;
        return respostaJson({ erro: { codigo, mensagem } }, status);
      }
      const data = url.searchParams.get("data") ?? undefined;
      if (
        data !== undefined &&
        (data < CAMPANHA.data_inicio || data > DIA_SEGUINTE_AO_FIM)
      )
        return respostaJson(
          {
            erro: {
              codigo: "requisicao_invalida",
              mensagem: MENSAGEM_FORA_DA_JANELA,
              detalhes: [
                {
                  caminho: ["data"],
                  codigo: "fora_da_campanha",
                  mensagem: MENSAGEM_FORA_DA_JANELA,
                },
              ],
            },
          },
          400,
        );
      if (data !== undefined && data > hojeDe(api.agora))
        return respostaJson(
          {
            erro: {
              codigo: "requisicao_invalida",
              mensagem: "Consulta inválida",
              detalhes: [
                {
                  caminho: ["data"],
                  codigo: "data_futura",
                  mensagem: "A data não pode ser depois de hoje",
                },
              ],
            },
          },
          400,
        );
      const resposta = respostaDoBumbo(
        api.agora,
        data,
        api.vendas,
        api.campanha,
      );
      return respostaJson(
        api.texto === null ? resposta : { ...resposta, texto: api.texto },
      );
    }),
  );
  return api;
}
