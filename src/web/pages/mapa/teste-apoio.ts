// Apoio dos testes da tela Mapa: respostas de exemplo de GET /api/painel/mapa-ddd montadas a partir dos DDDs (as UFs,
// as partes e o total saem da soma, na ordem da API) e passadas pelo respostaMapaDddSchema (estrito, com as
// invariantes de soma: um número que não fecha quebra o teste já na montagem), e uma API falsa que confere cada
// consulta pelo schema da rota e guarda os caminhos pedidos. A API de verdade é da RIFA-015-api.
import { vi } from "vitest";
import {
  consultaMapaDddSchema,
  respostaMapaDddSchema,
  type ConsultaMapaDdd,
  type RespostaMapaDdd,
} from "../../../shared/contracts/api";
import type { Divisao } from "../../../shared/contracts/calculos";
import { UF_DO_DDD, type Uf } from "../../../shared/contracts/ddd";
import { respostaJson } from "../../test/renderizar";

export const ROTA_MAPA = "/api/painel/mapa-ddd";

/** 04/12/2026 às 15:30 em Belém. */
export const ATUALIZADO_EM = "2026-12-04T18:30:00.000Z";

export const JANELA_CAMPANHA: RespostaMapaDdd["janela"] = {
  tipo: "campanha",
  ordem: null,
  nome: "Campanha inteira",
  data_inicio: "2026-11-23",
  data_fim: "2026-12-16",
};

export const JANELA_SEMANA_2: RespostaMapaDdd["janela"] = {
  tipo: "atual",
  ordem: 2,
  nome: "Semana 2",
  data_inicio: "2026-12-03",
  data_fim: "2026-12-09",
};

/** Um recorte de entrada: pedidos aprovados, bilhetes e (padrão: R$ 10,00 por bilhete) centavos. */
export type Recorte = {
  pedidos: number;
  bilhetes: number;
  centavos?: number;
};

type Entrada = {
  /** DDD → recorte; a UF vem da tabela da Anatel. */
  ddds: Record<string, Recorte>;
  exterior?: Recorte;
  sem_ddd?: Recorte;
  janela?: RespostaMapaDdd["janela"];
  divisao?: Divisao | null;
};

const VAZIO: Recorte = { pedidos: 0, bilhetes: 0 };

/** A resposta da API para estes DDDs, com as UFs, as partes (pontos-base truncados) e o total calculados. */
export function mapaDe({
  ddds,
  exterior = VAZIO,
  sem_ddd = VAZIO,
  janela = JANELA_CAMPANHA,
  divisao = null,
}: Entrada): RespostaMapaDdd {
  const somar = (recortes: Recorte[]) => ({
    pedidos: recortes.reduce((soma, r) => soma + r.pedidos, 0),
    bilhetes: recortes.reduce((soma, r) => soma + r.bilhetes, 0),
    centavos: recortes.reduce(
      (soma, r) => soma + (r.centavos ?? r.bilhetes * 1000),
      0,
    ),
  });
  const listaDdds = Object.entries(ddds).map(([ddd, recorte]) => ({
    ddd,
    uf: UF_DO_DDD[ddd] as Uf,
    recorte,
  }));
  const total = somar([...listaDdds.map((d) => d.recorte), exterior, sem_ddd]);
  const totais = (recorte: Recorte) => {
    const { pedidos, bilhetes, centavos } = somar([recorte]);
    return {
      pedidos_aprovados: pedidos,
      bilhetes,
      total_centavos: centavos,
      parte_bilhetes_bp:
        total.bilhetes === 0
          ? 0
          : Math.floor((bilhetes * 10000) / total.bilhetes),
    };
  };
  const porUf = new Map<Uf, Recorte[]>();
  for (const { uf, recorte } of listaDdds)
    porUf.set(uf, [...(porUf.get(uf) ?? []), recorte]);
  const ufs = [...porUf.entries()]
    .map(([uf, recortes]) => {
      const { pedidos, bilhetes, centavos } = somar(recortes);
      return { uf, ...totais({ pedidos, bilhetes, centavos }) };
    })
    .sort((a, b) => b.bilhetes - a.bilhetes || a.uf.localeCompare(b.uf));
  const ordemDaUf = new Map(ufs.map((item, indice) => [item.uf, indice]));
  const itensDdd = listaDdds
    .map(({ ddd, uf, recorte }) => ({ ddd, uf, ...totais(recorte) }))
    .sort(
      (a, b) =>
        (ordemDaUf.get(a.uf) ?? 0) - (ordemDaUf.get(b.uf) ?? 0) ||
        b.bilhetes - a.bilhetes ||
        a.ddd.localeCompare(b.ddd),
    );
  return respostaMapaDddSchema.parse({
    janela,
    divisao,
    ufs,
    ddds: itensDdd,
    exterior: totais(exterior),
    sem_ddd: totais(sem_ddd),
    total: totais({
      pedidos: total.pedidos,
      bilhetes: total.bilhetes,
      centavos: total.centavos,
    }),
    atualizado_em: ATUALIZADO_EM,
  });
}

/**
 * Vendas plausíveis de uma campanha em Belém: quase tudo do 91, um pouco do 94 e do 93 (interior do Pará), alguns
 * de outras UFs (parentes em São Paulo, Brasília, Manaus...), do exterior e sem DDD.
 */
export function mapaDeBelem(
  opcoes: Omit<Entrada, "ddds" | "exterior" | "sem_ddd"> = {},
): RespostaMapaDdd {
  return mapaDe({
    ...opcoes,
    ddds: {
      "91": { pedidos: 412, bilhetes: 1236 },
      "94": { pedidos: 18, bilhetes: 54 },
      "93": { pedidos: 9, bilhetes: 27 },
      "11": { pedidos: 6, bilhetes: 18 },
      "19": { pedidos: 1, bilhetes: 2 },
      "61": { pedidos: 4, bilhetes: 15 },
      "92": { pedidos: 3, bilhetes: 9 },
      "98": { pedidos: 3, bilhetes: 6 },
      "85": { pedidos: 2, bilhetes: 5 },
      "21": { pedidos: 2, bilhetes: 4 },
      "62": { pedidos: 1, bilhetes: 3 },
    },
    exterior: { pedidos: 2, bilhetes: 6 },
    sem_ddd: { pedidos: 5, bilhetes: 12 },
  });
}

/**
 * 10.000 bilhetes, para as partes saírem exatas: uma UF em cada faixa da cor (PA 65%, SP 20%, DF 8%, AM 3%, MA
 * 0,5%) e o RS com 1 bilhete (0,01%: faixa 1, nunca neutro). Os outros estados ficam sem venda.
 */
export function mapaDasFaixas(): RespostaMapaDdd {
  return mapaDe({
    ddds: {
      "91": { pedidos: 2000, bilhetes: 6000, centavos: 6_000_000 },
      "94": { pedidos: 130, bilhetes: 400, centavos: 400_000 },
      "93": { pedidos: 40, bilhetes: 100, centavos: 100_000 },
      "11": { pedidos: 700, bilhetes: 2000, centavos: 2_000_000 },
      "61": { pedidos: 300, bilhetes: 800, centavos: 800_000 },
      "92": { pedidos: 100, bilhetes: 300, centavos: 300_000 },
      "98": { pedidos: 20, bilhetes: 50, centavos: 50_000 },
      "51": { pedidos: 1, bilhetes: 1, centavos: 1000 },
    },
    exterior: { pedidos: 40, bilhetes: 100 },
    sem_ddd: { pedidos: 90, bilhetes: 249 },
  });
}

/** Nenhuma venda aprovada na janela. */
export function mapaSemVendas(
  opcoes: Omit<Entrada, "ddds"> = {},
): RespostaMapaDdd {
  return mapaDe({ ...opcoes, ddds: {} });
}

type Responder = (
  consulta: ConsultaMapaDdd,
  ordem: number,
) => Response | Promise<Response>;

export const respostaErro = (
  status: number,
  codigo: string,
  mensagem: string,
) => respostaJson({ erro: { codigo, mensagem } }, status);

export const SEM_CAMPANHA = () =>
  respostaErro(404, "nao_encontrado", "Nenhuma campanha ativa");

/**
 * API falsa: GET /api/painel/mapa-ddd responde `responder(consulta, ordem)` (ordem 0 = primeira chamada), com a
 * consulta conferida pelo schema da rota (padrão: a resposta de Belém na janela e na divisão pedidas). Outras
 * rotas recebem 404. Guarda os caminhos pedidos.
 */
export function simularApi(responder?: Responder) {
  const chamadas: string[] = [];
  const consultas: ConsultaMapaDdd[] = [];
  const fetchMock = vi.fn(async (caminho: string) => {
    const url = new URL(caminho, "https://site.example");
    if (url.pathname !== ROTA_MAPA) {
      return respostaErro(404, "nao_encontrado", "Rota não encontrada");
    }
    const ordem = chamadas.length;
    chamadas.push(caminho);
    const consulta = consultaMapaDddSchema.parse(
      Object.fromEntries(url.searchParams),
    );
    consultas.push(consulta);
    if (responder) return responder(consulta, ordem);
    return respostaJson(
      mapaDeBelem({
        janela:
          consulta.periodo === "atual" ? JANELA_SEMANA_2 : JANELA_CAMPANHA,
        divisao: consulta.divisao ?? null,
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { chamadas, consultas, fetchMock };
}
