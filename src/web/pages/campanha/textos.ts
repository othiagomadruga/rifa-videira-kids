// Textos da tela Campanha que o formulário e o resumo das regras usam: a unidade, a regra da meta e o critério do
// ranking em português.
import type {
  CriterioRanking,
  RegraMeta,
  UnidadeMeta,
} from "../../../shared/contracts";

export const TEXTO_UNIDADE: Record<UnidadeMeta, string> = {
  bilhetes: "Bilhetes vendidos",
  centavos: "Valor arrecadado (R$)",
};

export const TEXTO_REGRA: Record<
  RegraMeta,
  { opcao: string; explicacao: string; campo: string }
> = {
  por_pessoa: {
    opcao: "Por pessoa da célula",
    explicacao:
      "A meta de cada célula é este valor vezes o número de pessoas dela.",
    campo: "Meta por pessoa",
  },
  total_proporcional: {
    opcao: "Total da campanha, dividido pelas células",
    explicacao:
      "O valor é a meta da campanha inteira. Cada célula fica com uma parte proporcional ao número de pessoas.",
    campo: "Meta total da campanha",
  },
  fixa_por_celula: {
    opcao: "Igual para todas as células",
    explicacao:
      "Todas as células têm a mesma meta, qualquer que seja o tamanho.",
    campo: "Meta de cada célula",
  },
};

export const TEXTO_CRITERIO: Record<
  CriterioRanking,
  { opcao: string; explicacao: string }
> = {
  percentual_meta: {
    opcao: "Percentual da meta atingido",
    explicacao:
      "Compara células de tamanhos diferentes pelo quanto já fizeram da própria meta.",
  },
  bilhetes: {
    opcao: "Bilhetes vendidos",
    explicacao: "Fica na frente quem vendeu mais bilhetes.",
  },
  arrecadacao: {
    opcao: "Valor arrecadado",
    explicacao:
      "Fica na frente quem arrecadou mais. O público continua sem ver valores em R$.",
  },
};
