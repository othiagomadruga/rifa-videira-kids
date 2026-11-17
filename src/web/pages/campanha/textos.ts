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

/** RIFA-061 (D27): a opção do ranking por divisão, com uma linha do que acontece ligada e desligada. */
export const TEXTO_POR_DIVISAO = {
  rotulo: "Separar o ranking por divisão (jovens e adultos)",
  ligada:
    "Ligada: Jovens e Adultos disputam cada um o seu ranking, no telão, no ranking aberto, nos rankings e no bumbo.",
  desligada:
    "Desligada: um ranking só, com todas as células juntas, em todos esses lugares.",
} as const;

// ---------------------------------------------------------------------------------------------------
// Ajuda (RIFA-066, D31): a explicação dos títulos e dos rótulos, com o mouse no título (ou no rótulo) e no "?" ao
// lado dele (foco e toque). Para quem nunca viu o sistema: o que é, para que serve na campanha e, quando há algo a
// escolher, um exemplo, em 2 ou 3 frases curtas. Os campos usam o mesmo texto na dica do controle (DICAS, abaixo).
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

export const AJUDA = {
  tela: "É onde a coordenação monta a rifa: nome, datas, preço do bilhete, metas e o que o público vê. O painel, os rankings e o telão seguem estas regras.",
  situacao:
    "Diz se a campanha está ligada e em que fase ela está: antes do início, em andamento ou encerrada. Só com a campanha ativa as vendas da Rifei entram nas contas.",
  regras:
    "Um resumo, em frases simples, de todas as regras que estão valendo agora. Serve para conferir tudo de uma vez; toque no nome de uma regra para ir ao campo dela.",
  identificacao:
    "O nome da campanha e o slug, o código que liga este sistema à campanha certa na Rifei. Com o slug errado, nenhuma venda conta.",
  datasEPeriodos:
    "Quando a campanha começa e como ela se divide em etapas. As metas de cada dia, as datas das etapas e os rankings da semana saem daqui.",
  periodos:
    "A campanha é dividida em etapas, normalmente semanas. Cada etapa tem uma parte da meta e um ranking próprio, então toda semana as células têm uma nova chance. Ex.: 3 períodos de 7 dias = 3 semanas.",
  bilheteEMeta:
    "Quanto custa cada bilhete e quanto cada célula deve vender. A meta é o alvo que aparece no painel, na visão dos líderes e nos rankings.",
  rankingEPublico:
    "Como as células são comparadas nos rankings e o que o público vê no telão e no ranking aberto. Ex.: ranking pelo percentual da meta, mostrando só as 3 primeiras.",
  oQueOPublicoVe:
    "O que aparece no telão do culto e no ranking aberto (o link do grupo do WhatsApp). Serve para animar a igreja sem expor ninguém: valores em R$ nunca aparecem.",
  pedidosEAcessos:
    "Regras que só o admin muda: se dá para tirar um pedido das contas e quem, além dos líderes de célula, entra no sistema pelo link pessoal.",
  mensagens:
    'O texto que vai pelo WhatsApp junto com o link de entrada de cada pessoa. Ex.: "{saudacao} Este é o seu link: {link}" chega como "Olá, Ana! Este é o seu link: …".',
  nome: "O nome da campanha neste sistema, que a coordenação vê nas telas. Ex.: Rifa Videira Kids 2026. Mudar o nome não muda nada na Rifei.",
  slug: "O código da campanha na Rifei: a parte final do link dela. Ex.: no link rifei.com.br/videira-kids, o slug é videira-kids. Só as vendas com este slug contam.",
  dataInicio:
    "O primeiro dia de vendas que conta para a campanha. O primeiro período começa nesta data. Ex.: 23/11/2026.",
  fuso: "Diz em que hora o dia vira, para as metas do dia e os rankings. Ex.: America/Belem, o horário de Brasília. Na dúvida, deixe o padrão.",
  nomeDoPeriodo:
    "Como esta etapa aparece no painel, no telão e nos rankings. Ex.: Semana 1.",
  diasDoPeriodo:
    "Quantos dias esta etapa dura. As datas de início e de fim de cada etapa saem desta conta. Ex.: 7 dias = uma semana.",
  percentualDoPeriodo:
    "Quanto da meta total se espera vender nesta etapa. Ex.: meta de 40 bilhetes e 25% → 10 bilhetes nesta etapa. O ideal é que a soma dê 100% (se não der, o sistema ajusta a proporção).",
  preco:
    "Quanto custa cada bilhete na Rifei. Serve para conferir se o valor de cada pedido bate com a quantidade de bilhetes. Ex.: 20,00.",
  unidadeMeta:
    "Em que a meta é contada: bilhetes vendidos ou reais arrecadados. Ex.: com bilhetes, a meta de uma célula pode ser 40 bilhetes.",
  regraMeta:
    "Como sai a meta de cada célula: um valor por pessoa, um total dividido entre as células ou o mesmo número para todas. Ex.: 5 por pessoa numa célula de 8 pessoas → meta de 40.",
  /** A meta muda de sentido com a regra: o rótulo e a explicação acompanham. */
  valorMeta: {
    por_pessoa:
      "Quanto cada pessoa da célula deve vender na campanha inteira (não por semana). Ex.: 5 bilhetes numa célula de 8 pessoas → meta de 40. O sistema reparte a meta entre os períodos.",
    total_proporcional:
      "A meta da campanha inteira, somando todas as células. Cada célula fica com a parte do tamanho dela. Ex.: 1.000 bilhetes; a célula com 10% das pessoas fica com 100.",
    fixa_por_celula:
      "Quantos bilhetes cada célula deve vender na campanha inteira (não por semana). O sistema reparte esse total entre os períodos. Ex.: 40.",
    semRegra:
      "O número da meta. Escolha antes a unidade e a regra: o que este número quer dizer depende delas.",
  } satisfies Record<RegraMeta | "semRegra", string>,
  criterioRanking:
    "O que decide quem fica na frente nos rankings, no telão e no ranking aberto. Ex.: pelo percentual da meta, uma célula pequena que fez 80% passa uma grande que fez 50%.",
  porDivisao:
    "Separa o ranking em dois, Jovens e Adultos, cada um com o seu primeiro lugar. Serve para células parecidas disputarem entre si. Desmarcada, todas disputam um ranking só.",
  mostraPercentual:
    "Mostra no telão e no ranking aberto quanto da meta cada célula já fez. Ex.: Célula Betel, 80%. Valores em R$ nunca aparecem.",
  limiteRanking:
    "Quantas células aparecem no telão e no ranking aberto. Ex.: 3 mostra só as três primeiras. Em branco, aparecem todas.",
  chave: {
    pedidos_desconsiderar:
      "Deixa o admin tirar das contas um pedido de teste, fraude ou estorno, na tela Pedidos. Ex.: um pedido de teste de R$ 1,00 deixa de contar na meta. Dá para desfazer.",
    acesso_discipuladores:
      "Deixa os discipuladores entrarem pelo link pessoal para acompanhar as células deles. Desligar não apaga os links: eles voltam a valer ao ligar de novo.",
    acesso_redes:
      "Deixa as redes entrarem pelo link pessoal para acompanhar os discipuladores e as células delas. Desligar não apaga os links: eles voltam a valer ao ligar de novo.",
  } satisfies Record<ChaveDica, string>,
  mensagem: (tipo: TipoMensagem) =>
    `O texto que vai pelo WhatsApp com o link pessoal ${QUEM_RECEBE[tipo]}. Os marcadores entre chaves viram os dados de quem recebe. Ex.: {nome} vira Ana.`,
} as const;

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045): a explicação que aparece com o mouse parado (ou o foco do teclado) em cada botão e campo da
// tela. Dizem para que serve e o que acontece, sem repetir o rótulo. Os campos usam o texto da ajuda do rótulo
// (RIFA-066: um texto só por campo, que diz o que é, para que serve e dá um exemplo).
// ---------------------------------------------------------------------------------------------------

export const DICAS = {
  nome: AJUDA.nome,
  slug: AJUDA.slug,
  usarSoOSlug:
    "Troca o link colado no campo só pela parte final dele, que é o slug.",
  dataInicio: AJUDA.dataInicio,
  fuso: AJUDA.fuso,
  modeloSantoAndre:
    "Preenche os períodos com o modelo usado em Santo André (3 períodos, 24 dias), um ponto de partida que dá para mudar depois. Preço e meta não mudam.",
  nomeDoPeriodo: AJUDA.nomeDoPeriodo,
  diasDoPeriodo: AJUDA.diasDoPeriodo,
  percentualDoPeriodo: AJUDA.percentualDoPeriodo,
  removerPeriodo:
    "Tira este período da lista. Os seguintes andam para o lugar dele. Só vale depois de salvar.",
  adicionarPeriodo:
    "Põe mais uma etapa no fim da campanha, logo depois da última. A data final anda junto.",
  adicionarPeriodoNoLimite: (limite: number) =>
    `Indisponível: a campanha já tem o máximo de ${limite} períodos.`,
  preco: AJUDA.preco,
  unidadeMeta: AJUDA.unidadeMeta,
  regraMeta: AJUDA.regraMeta,
  valorMeta: AJUDA.valorMeta,
  criterioRanking: AJUDA.criterioRanking,
  porDivisao: AJUDA.porDivisao,
  mostraPercentual: AJUDA.mostraPercentual,
  limiteRanking: AJUDA.limiteRanking,
  chave: AJUDA.chave,
  chaveSoLeitura:
    "Indisponível: só o admin muda esta regra. Aqui você vê como ela está valendo.",
  mensagem: AJUDA.mensagem,
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
