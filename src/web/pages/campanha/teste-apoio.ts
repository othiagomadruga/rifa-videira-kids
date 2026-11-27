// Apoio dos testes da tela Campanha: a resposta da API para um corpo de PUT (como a API monta), uma campanha já
// configurada e a API falsa (GET e PUT /api/admin/campanha). Toda resposta passa pelo schema do contrato.
import { vi } from "vitest";
import {
  ACESSO_PADRAO,
  AVISOS_DE_VENDA_PADRAO,
  BILHETES_PADRAO,
  MENSAGENS_PADRAO,
  NOTIFICACOES_PADRAO,
  PEDIDOS_PADRAO,
  RANKING_POR_DIVISAO_PADRAO,
  calcularCalendario,
  respostaCampanhaSchema,
  somarPercentuais,
  type Campanha,
  type CampanhaEntrada,
} from "../../../shared/contracts";
import { ehListaDasRedes, respostaRedes } from "../../test/redes";
import { respostaJson } from "../../test/renderizar";

type Chamada = { metodo: string; caminho: string; corpo: unknown };

/** Resposta da API para um corpo de PUT (as datas saem do mesmo calendário que a API usa). */
export function campanhaDaEntrada(
  entrada: CampanhaEntrada,
  extra: Partial<Campanha> = {},
): Campanha {
  const calendario = calcularCalendario(entrada.data_inicio, entrada.periodos);
  return {
    id: 1,
    nome: entrada.nome.trim(),
    slug_rifei: entrada.slug_rifei.trim(),
    fuso_horario: entrada.fuso_horario ?? "America/Belem",
    data_inicio: entrada.data_inicio,
    data_fim: calendario.data_fim,
    preco_bilhete_centavos: entrada.preco_bilhete_centavos,
    meta: entrada.meta,
    periodos: entrada.periodos.map((periodo, indice) => ({
      ordem: indice + 1,
      ...periodo,
      ...calendario.periodos[indice],
    })),
    soma_percentuais_bp: somarPercentuais(entrada.periodos),
    // RIFA-061: a API devolve sempre a opção (ausente no PUT, o padrão).
    ranking: {
      criterio: entrada.ranking.criterio,
      por_divisao: entrada.ranking.por_divisao ?? RANKING_POR_DIVISAO_PADRAO,
    },
    // RIFA-094 (D42): a API devolve sempre os avisos de venda (ausente no PUT, o padrão: ligados).
    publico: {
      mostra_percentual_meta: false,
      limite_ranking: 3,
      ...entrada.publico,
      avisos_de_venda:
        entrada.publico?.avisos_de_venda ?? AVISOS_DE_VENDA_PADRAO,
    },
    // Regras do admin (D20): a API devolve sempre (o grupo ausente no PUT fica com o padrão).
    pedidos: entrada.pedidos ?? { ...PEDIDOS_PADRAO },
    // RIFA-064 (D29): a chave do login das células com senha ausente no PUT fica como estava (aqui, o padrão).
    acesso: { ...ACESSO_PADRAO, ...entrada.acesso },
    mensagens: entrada.mensagens ?? { ...MENSAGENS_PADRAO },
    bilhetes: entrada.bilhetes ?? { ...BILHETES_PADRAO },
    // RIFA-095 (D43): as notificações de venda ausentes no PUT ficam com o padrão (ligadas).
    notificacoes: entrada.notificacoes ?? { ...NOTIFICACOES_PADRAO },
    criado_em: "2026-11-06T18:00:00.000Z",
    atualizado_em: "2026-11-06T18:00:00.000Z",
    ...extra,
  };
}

/** A campanha como a API devolve: passa pelo schema da resposta (os padrões entram onde faltar). */
export function campanhaDaApi(campanha: Campanha): Campanha {
  return respostaCampanhaSchema.parse(campanha);
}

/** Campanha já configurada (valores fictícios de teste). */
export const CONFIGURADA = campanhaDaEntrada({
  nome: "Rifa de teste",
  slug_rifei: "rifa-teste",
  data_inicio: "2026-11-23",
  preco_bilhete_centavos: 1234,
  meta: { unidade: "centavos", regra: "total_proporcional", valor: 456789 },
  periodos: [
    { nome: "Período 1", dias: 10, percentual_bp: 3500 },
    { nome: "Período 2", dias: 7, percentual_bp: 2500 },
    { nome: "Período 3", dias: 7, percentual_bp: 4500 },
  ],
  ranking: { criterio: "bilhetes" },
  publico: { mostra_percentual_meta: true, limite_ranking: null },
});

export const NAO_ENCONTRADA = () =>
  respostaJson(
    {
      erro: {
        codigo: "nao_encontrado",
        mensagem: "A campanha ainda não foi configurada",
      },
    },
    404,
  );

/**
 * Troca o fetch: GET devolve a campanha (ou 404); PUT responde com `aoSalvar` (padrão: a API, em que o grupo
 * `pedidos`, `acesso` ou `mensagens` ausente mantém o gravado; o PUT da coordenação não os manda, RIFA-042). A lista
 * das redes (RIFA-065, D30: a tela pergunta quantas há) responde com `redes` redes (padrão: duas, a tela como sempre
 * foi) e fica em `pedidosDasRedes`, fora de `chamadas` (que são as da campanha).
 */
export function simularApi({
  campanha = null,
  aoSalvar = (corpo) =>
    respostaJson(
      campanhaDaEntrada({
        ...corpo,
        pedidos: corpo.pedidos ?? campanha?.pedidos,
        acesso: corpo.acesso ?? campanha?.acesso,
        mensagens: corpo.mensagens ?? campanha?.mensagens,
      }),
    ),
  aoCarregar,
  redes = 2,
}: {
  campanha?: Campanha | null;
  aoSalvar?: (corpo: CampanhaEntrada) => Response | Promise<Response>;
  aoCarregar?: () => Response;
  redes?: number;
} = {}) {
  const chamadas: Chamada[] = [];
  const pedidosDasRedes: string[] = [];
  const fetchMock = vi.fn(async (caminho: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    if (ehListaDasRedes(caminho, metodo)) {
      pedidosDasRedes.push(caminho);
      return respostaRedes(redes);
    }
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    chamadas.push({ metodo, caminho, corpo });
    if (metodo === "PUT") return aoSalvar(corpo as CampanhaEntrada);
    if (aoCarregar) return aoCarregar();
    return campanha ? respostaJson(campanhaDaApi(campanha)) : NAO_ENCONTRADA();
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    chamadas,
    pedidosDasRedes,
    puts: () => chamadas.filter((chamada) => chamada.metodo === "PUT"),
  };
}
