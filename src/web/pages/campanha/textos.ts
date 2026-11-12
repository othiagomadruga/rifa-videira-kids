// Textos da tela Campanha que o formulário e o resumo das regras usam: a unidade, a regra da meta e o critério do
// ranking em português.
import type {
  CriterioRanking,
  RegraMeta,
  TipoMensagem,
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

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045): a explicação que aparece com o mouse parado (ou o foco do teclado) em cada botão e campo da
// tela. Dizem para que serve e o que acontece, sem repetir o rótulo.
// ---------------------------------------------------------------------------------------------------

/** As chaves da campanha (os nomes do formulário, como em RegrasDoAdmin.tsx). */
type ChaveDica =
  "pedidos_desconsiderar" | "acesso_discipuladores" | "acesso_redes";

/** De quem é cada mensagem do link pessoal. */
const QUEM_RECEBE: Record<TipoMensagem, string> = {
  link_coordenacao: "de quem é da coordenação",
  link_lider: "dos líderes de célula",
  link_discipulador: "dos discipuladores",
  link_rede: "das redes",
};

export const DICAS = {
  nome: "Serve para identificar a campanha no sistema. Mudar o nome não muda nada na Rifei.",
  slug: "Liga o sistema à campanha certa na Rifei: só as vendas que chegam com este slug contam.",
  usarSoOSlug:
    "Troca o link colado no campo só pela parte final dele, que é o slug.",
  dataInicio:
    "O dia em que as vendas começam a contar. O primeiro período começa nesta data.",
  fuso: "Diz a hora em que cada dia vira, para as metas do dia e os rankings. Na dúvida, deixe America/Belem.",
  modeloSantoAndre:
    "Preenche os períodos com o modelo pronto (3 períodos, 24 dias). Preço e meta não mudam.",
  nomeDoPeriodo:
    "Como este período aparece no painel e nos rankings da semana.",
  diasDoPeriodo:
    "Quantos dias o período dura. As datas de cada período saem desta conta.",
  percentualDoPeriodo:
    "Quanto da meta se espera vender neste período. A soma não precisa dar 100%: o sistema ajusta.",
  removerPeriodo:
    "Tira este período da lista. Os seguintes andam para o lugar dele. Só vale depois de salvar.",
  adicionarPeriodo:
    "Põe mais um período no fim da lista, logo depois do último.",
  adicionarPeriodoNoLimite: (limite: number) =>
    `Indisponível: a campanha já tem o máximo de ${limite} períodos.`,
  preco:
    "Quanto custa cada bilhete na Rifei. O sistema usa para conferir se o valor de cada pedido bate com os bilhetes.",
  unidadeMeta:
    "Escolha se a meta conta bilhetes vendidos ou reais arrecadados.",
  regraMeta:
    "Escolha como a meta é dividida entre as células: por pessoa, pelo total ou igual para todas.",
  valorMeta:
    "O número da meta, na unidade e na regra escolhidas. A meta de cada célula sai dele.",
  criterioRanking:
    "Decide quem fica na frente nos rankings, no telão e no ranking aberto.",
  mostraPercentual:
    "Marcado, o telão e o ranking aberto também mostram quanto da meta cada célula já fez, em %. Nunca mostram R$.",
  limiteRanking:
    "Quantas células aparecem no telão e no ranking aberto. Em branco, aparecem todas.",
  chave: {
    pedidos_desconsiderar:
      "Marcada, o admin vê o botão Desconsiderar na tela Pedidos, para tirar das contas um pedido de teste, fraude ou estorno.",
    acesso_discipuladores:
      "Marcada, os discipuladores entram pelo link pessoal. Desmarcar não apaga os links: eles voltam a valer ao marcar de novo.",
    acesso_redes:
      "Marcada, as redes entram pelo link pessoal. Desmarcar não apaga os links: eles voltam a valer ao marcar de novo.",
  } satisfies Record<ChaveDica, string>,
  chaveSoLeitura:
    "Indisponível: só o admin muda esta regra. Aqui você vê como ela está valendo.",
  mensagem: (tipo: TipoMensagem) =>
    `O texto que vai pelo WhatsApp com o link pessoal ${QUEM_RECEBE[tipo]}. Os marcadores entre chaves viram os dados de quem recebe.`,
  mensagemSoLeitura: (tipo: TipoMensagem) =>
    `Só o admin muda esta mensagem. É o texto que vai pelo WhatsApp com o link pessoal ${QUEM_RECEBE[tipo]}.`,
  voltarAoPadrao:
    "Troca o texto do campo pelo texto padrão do sistema. Só vale depois de salvar.",
  voltarAoPadraoJaEstaNele: "Indisponível: o campo já está com o texto padrão.",
  salvar:
    "Grava as mudanças. Aqui valem na hora; no telão, no ranking aberto e nos links pessoais, em até 2 minutos.",
  ativar:
    "Grava a campanha e começa a contar as vendas da Rifei com este slug. Antes, pede para você confirmar.",
  confirmarAtivar:
    "Confirma: a partir de agora, as vendas da Rifei com este slug contam para a campanha.",
  confirmarTrocaDoSlug:
    "Confirma a troca: daqui em diante, só as vendas com o slug novo contam.",
  voltarERevisar: "Não salva nada e volta para o formulário, para conferir.",
  salvando:
    "Indisponível enquanto as mudanças são gravadas. Espere um instante.",
} as const;
