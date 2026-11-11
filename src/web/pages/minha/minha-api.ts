// Chamadas da visão individual (/minha: líder, discipulador e rede; RIFA-014, D12): só GET /api/minha/visao.
// O alvo vem só da sessão: a tela não manda id de nada. A resposta nunca traz dinheiro (schema estrito do
// contrato); com a meta em centavos, as quantidades da meta chegam null e a tela mostra só percentuais.
//
// Do contrato vêm os tipos e os valores puros de calculos.ts (módulo sem zod) e, de api.ts, só TIPOS: o
// caminho abaixo é uma cópia, conferida por minha-contrato.test.ts (importar o catálogo ROTAS poria o zod
// no pacote do site).
import type {
  ROTAS,
  RespostaVisaoIndividual,
} from "../../../shared/contracts/api";
import type {
  FaseCampanha,
  JanelaRanking,
} from "../../../shared/contracts/calculos";
import { ErroApi, api } from "../../lib/api";

export const CAMINHO_VISAO: (typeof ROTAS)["visaoIndividual"]["caminho"] =
  "/api/minha/visao";

/**
 * A janela do ranking que a tela pede: antes e durante a campanha, o período atual (o "ranking da semana");
 * depois do fim, a campanha inteira (o resultado final, como no ranking público).
 */
export function periodoDaFase(fase: FaseCampanha | null): JanelaRanking {
  return fase === "encerrada" ? "campanha" : "atual";
}

/** "/api/minha/visao?periodo=atual". */
export function caminhoDaVisao(periodo: JanelaRanking): string {
  return `${CAMINHO_VISAO}?${new URLSearchParams({ periodo }).toString()}`;
}

type Opcoes = { signal?: AbortSignal };

/**
 * A visão do alvo da sessão. `faseConhecida` (a da resposta anterior) escolhe a janela do ranking; se a
 * resposta mostrar outra fase (ex.: a campanha acabou desde a última consulta), pede de novo na janela certa.
 */
export async function carregarVisao(
  faseConhecida: FaseCampanha | null,
  opcoes: Opcoes = {},
): Promise<RespostaVisaoIndividual> {
  const periodo = periodoDaFase(faseConhecida);
  const visao = await api.get<RespostaVisaoIndividual>(
    caminhoDaVisao(periodo),
    opcoes,
  );
  const certo = periodoDaFase(visao.referencia.fase);
  return certo === periodo
    ? visao
    : api.get<RespostaVisaoIndividual>(caminhoDaVisao(certo), opcoes);
}

/** 404 nao_encontrado: ainda não há campanha ativa. */
export function ehSemCampanha(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 404 &&
    erro.codigo === "nao_encontrado"
  );
}
