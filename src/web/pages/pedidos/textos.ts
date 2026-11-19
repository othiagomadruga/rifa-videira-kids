// Textos da tela Pedidos (RIFA-025): status, eventos, resultados das entregas e o erro e os avisos de cada entrega
// em português. O erro e os avisos chegam da API reduzidos a campo (caminho do schema), código e ocorrências (a
// mensagem gravada não sai, D16): aqui o código vira texto ("invalid_type" no campo "total" → "total: tipo
// inválido"), sem inventar o que não veio. Área da coordenação: os valores em R$ podem aparecer.
import type {
  EntregaWebhook,
  ItemPedido,
  MotivoDesconsideracao,
  RespostaPedidos,
  ResultadoEventoWebhook,
  StatusPedido,
} from "../../../shared/contracts";
import type { CODIGOS_RECUSA_WEBHOOK } from "../../../shared/contracts/api";
import type { TomBadge } from "../../components/ui";
import { formatarNumero } from "../../lib/formatadores";

type CodigoRecusa = (typeof CODIGOS_RECUSA_WEBHOOK)[number];

export const ROTULO_STATUS: Record<StatusPedido, string> = {
  in_process: "Aguardando pagamento",
  approved: "Aprovado",
  expired: "Expirado",
};

/** Os totais no plural (o título de cada cartão). */
export const ROTULO_STATUS_PLURAL: Record<StatusPedido, string> = {
  in_process: "Aguardando pagamento",
  approved: "Aprovados",
  expired: "Expirados",
};

export const TOM_STATUS: Record<StatusPedido, TomBadge> = {
  in_process: "info",
  approved: "sucesso",
  expired: "neutro",
};

/** Os eventos que a Rifei documenta; outro aparece como veio. */
const ROTULO_EVENTO: Record<string, string> = {
  new_order: "Pedido novo",
  paid_order: "Pedido pago",
  expired_order: "Pedido expirado",
};

/** O evento em português; null = o corpo nem foi lido (ex.: JSON inválido). */
export function rotuloDoEvento(evento: string | null): string {
  if (evento === null) return "Não lido";
  return Object.hasOwn(ROTULO_EVENTO, evento) ? ROTULO_EVENTO[evento] : evento;
}

export const RESULTADO: Record<
  ResultadoEventoWebhook,
  { rotulo: string; tom: TomBadge; explicacao: string | null }
> = {
  processado: { rotulo: "Processada", tom: "sucesso", explicacao: null },
  duplicado: {
    rotulo: "Repetida",
    tom: "neutro",
    explicacao: "O pedido já estava neste status.",
  },
  ignorado_outra_campanha: {
    rotulo: "Outra campanha",
    tom: "alerta",
    explicacao: "O slug não é o da campanha ativa: o pedido não foi gravado.",
  },
  ignorado_transicao: {
    rotulo: "Ignorada",
    tom: "neutro",
    explicacao:
      "Mudança de status que não vale (ex.: expirar um pedido já aprovado).",
  },
  erro_validacao: {
    rotulo: "Recusada",
    tom: "perigo",
    explicacao: "A entrega veio com erro: o pedido não foi gravado.",
  },
};

/** O resultado, para o filtro ("Processadas", "Recusadas (com erro)"...). */
export const ROTULO_FILTRO_RESULTADO: Record<ResultadoEventoWebhook, string> = {
  processado: "Processadas",
  duplicado: "Repetidas",
  ignorado_outra_campanha: "De outra campanha",
  ignorado_transicao: "Ignoradas",
  erro_validacao: "Recusadas (com erro)",
};

/** O que a recusa da entrega quer dizer (o código do erro). */
export const ROTULO_RECUSA: Record<CodigoRecusa, string> = {
  json_invalido: "O corpo não era um JSON válido",
  payload_invalido: "Faltou o essencial do pedido ou veio com valor inválido",
  corpo_muito_grande: "O corpo passou do tamanho máximo",
};

/**
 * Os códigos de problema do zod (o vocabulário fixo da validação do payload) e os da D11 e da recusa. Um código
 * que o site não conhece aparece como "outro problema", com o código entre parênteses (nunca uma mensagem).
 */
export const TEXTO_DO_CODIGO: Record<string, string> = {
  // zod
  invalid_type: "tipo inválido",
  invalid_format: "formato inválido",
  invalid_value: "valor fora dos aceitos",
  invalid_union: "valor em nenhum dos formatos aceitos",
  invalid_key: "chave inválida",
  invalid_element: "item inválido",
  too_big: "acima do limite",
  too_small: "abaixo do mínimo",
  not_multiple_of: "fora do múltiplo exigido",
  unrecognized_keys: "campos não reconhecidos",
  custom: "fora da regra do campo",
  // D11 (plausibilidade do pedido aprovado) e conversão de valores
  quantidade_acima_do_teto: "bilhetes acima do teto por pedido",
  total_acima_do_esperado: "total acima de bilhetes × preço do bilhete",
  total_abaixo_do_esperado:
    "total abaixo de bilhetes × preço do bilhete, além do desconto aceito",
  fracao_de_centavo: "fração de centavo arredondada",
  // o webhook (worker/db/pedidos.ts): o evento trouxe outro afiliado para um pedido que já existia
  afiliado_alterado:
    "afiliado diferente do que estava no pedido (vale o deste evento)",
  // recusa da rota (problema único, sem campo) e o corte da lista gravada
  json_invalido: "o corpo não era um JSON válido",
  corpo_muito_grande: "o corpo passou do tamanho máximo",
  payload_invalido: "pedido inválido",
  itens_omitidos: "outros problemas, omitidos da lista",
  // a API troca por este um código fora da forma do vocabulário (nada do que veio na entrega sai)
  codigo_desconhecido: "problema não identificado",
};

/**
 * O campo legível: "total", "buyer.phone", "numbers.*" → "numbers (cada item)"; vazio = a entrega toda. A API troca
 * por "?" uma parte do caminho que não tem a forma de um nome de campo: ela vira "(campo não identificado)".
 */
export function textoDoCampo(campo: string): string {
  return campo
    .split(".")
    .map((parte) => (parte === "?" ? "(campo não identificado)" : parte))
    .join(".")
    .replace(/\.\*(?=\.|$)/g, " (cada item)")
    .replace(/^\*/, "item");
}

type Detalhe = EntregaWebhook["avisos"][number];

/** "total: tipo inválido", "numbers (cada item): tipo inválido (5.000 vezes)", "o corpo não era um JSON válido". */
export function textoDoDetalhe({
  campo,
  codigo,
  ocorrencias,
}: Detalhe): string {
  const texto = Object.hasOwn(TEXTO_DO_CODIGO, codigo)
    ? TEXTO_DO_CODIGO[codigo]
    : `outro problema (${codigo})`;
  const vezes =
    ocorrencias > 1 ? ` (${formatarNumero(ocorrencias)} vezes)` : "";
  return campo === ""
    ? `${texto.charAt(0).toUpperCase()}${texto.slice(1)}${vezes}`
    : `${textoDoCampo(campo)}: ${texto}${vezes}`;
}

/** A transição de status da entrega, para o texto: "Aguardando pagamento → Aprovado", "Novo: Aprovado"... */
export function transicao(
  entrega: Pick<EntregaWebhook, "status_anterior" | "status_resultante">,
):
  | { tipo: "nenhuma" }
  | { tipo: "novo"; status: string }
  | { tipo: "igual"; status: string }
  | { tipo: "mudou"; de: string; para: string } {
  const { status_anterior: de, status_resultante: para } = entrega;
  if (para === null) return { tipo: "nenhuma" };
  if (de === null) return { tipo: "novo", status: ROTULO_STATUS[para] };
  if (de === para) return { tipo: "igual", status: ROTULO_STATUS[para] };
  return { tipo: "mudou", de: ROTULO_STATUS[de], para: ROTULO_STATUS[para] };
}

/** A célula do pedido, ou por que não há uma. */
export function textoDaCelula(
  pedido: Pick<ItemPedido, "celula_nome" | "affiliate_id">,
): string {
  if (pedido.celula_nome !== null) return pedido.celula_nome;
  return pedido.affiliate_id === null
    ? "Sem afiliado"
    : `Sem célula (afiliado ${pedido.affiliate_id})`;
}

/** O que o <summary> "Filtros" diz no celular (RIFA-051, P3.7): "1 ativo" / "3 ativos". */
export function filtrosAtivos(quantidade: number): string {
  return quantidade === 1 ? "1 ativo" : `${formatarNumero(quantidade)} ativos`;
}

/** "1 pedido" / "1.234 pedidos". */
export function pedidos(quantidade: number): string {
  return quantidade === 1
    ? "1 pedido"
    : `${formatarNumero(quantidade)} pedidos`;
}

/** "1 bilhete" / "12 bilhetes". */
export function bilhetes(quantidade: number): string {
  return quantidade === 1
    ? "1 bilhete"
    : `${formatarNumero(quantidade)} bilhetes`;
}

/** "1 entrega" / "12 entregas". */
export function entregas(quantidade: number): string {
  return quantidade === 1
    ? "1 entrega"
    : `${formatarNumero(quantidade)} entregas`;
}

// ---------------------------------------------------------------------------------------------------
// Desconsiderar pedido (RIFA-028, D20)
// ---------------------------------------------------------------------------------------------------

/** O motivo, como opção do formulário. */
export const ROTULO_MOTIVO: Record<MotivoDesconsideracao, string> = {
  teste: "Teste",
  fraude: "Fraude",
  estorno: "Estorno",
  outro: "Outro",
};

/** O selo do pedido desconsiderado: "Desconsiderado (teste)". */
export function seloDesconsiderado(motivo: MotivoDesconsideracao): string {
  return `Desconsiderado (${ROTULO_MOTIVO[motivo].toLowerCase()})`;
}

/** A marca do pedido que entrou pela conferência pelo CSV (`origem`, D16 e D19). */
export const MARCA_RECUPERADO = "Recuperado na conferência";

type Totais = NonNullable<RespostaPedidos["totais"]>;

/**
 * Os totais depois de desconsiderar ou desfazer um pedido da lista, sem pedir a primeira página de novo (ela custa
 * milhares de linhas do D1): o pedido sai do status em que estava, se contava, e entra no status que tem agora, se
 * voltou a contar. Ele está na lista, então segue os filtros de célula e de busca dos totais.
 */
export function totaisDepoisDe(
  totais: Totais,
  antes: ItemPedido,
  depois: ItemPedido,
): Totais {
  const novos: Totais = {
    in_process: { ...totais.in_process },
    approved: { ...totais.approved },
    expired: { ...totais.expired },
  };
  const somar = (pedido: ItemPedido, sinal: 1 | -1) => {
    const total = novos[pedido.status];
    total.pedidos += sinal;
    total.bilhetes += sinal * pedido.qtd_bilhetes;
    total.total_centavos += sinal * pedido.total_centavos;
  };
  if (antes.desconsiderado === null) somar(antes, -1);
  if (depois.desconsiderado === null) somar(depois, 1);
  return novos;
}

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045): a explicação que aparece com o mouse parado (ou o foco do teclado) em cada botão e campo da
// tela. Dizem para que serve e o que acontece, sem repetir o rótulo.
// ---------------------------------------------------------------------------------------------------

export const DICAS = {
  // RIFA-076 (D36): só admin.
  exportarCompradores:
    "Baixa uma planilha (abre no Excel) com cada comprador: nome, telefone, célula, pedidos, bilhetes, total pago e se pagou ou só reservou. O download fica registrado na Trilha.",
  soQuemPagou:
    "Marcado: a planilha traz só quem pagou ao menos um pedido. Desmarcado: traz também quem só reservou.",
  whatsapp: "Abre uma conversa no WhatsApp com quem fez o pedido.",
  abaPedidos:
    "Os pedidos que chegaram da Rifei, do mais novo para o mais antigo, com os totais por status.",
  abaEntregas:
    "Cada aviso de venda que a Rifei mandou e o que o sistema fez com ele. Serve para achar pedido com erro.",
  filtros:
    "Mostra ou esconde os filtros da lista: status, célula, desconsiderados e a busca pelo id do pedido.",
  filtroStatus:
    "Mostra só os pedidos com o status escolhido. Só os aprovados contam nas vendas.",
  filtroCelula:
    "Mostra só os pedidos de uma célula, ou os que chegaram sem célula. Os totais seguem a escolha.",
  filtroDesconsiderados:
    "Mostra todos os pedidos, só os que contam nas vendas ou só os que foram tirados das contas.",
  campoBusca:
    "Procura um pedido pelo id completo da Rifei, junto com os outros filtros.",
  buscar: "Procura o pedido com o id digitado no campo.",
  limparBusca:
    "Apaga o id da busca e volta a mostrar os pedidos dos outros filtros.",
  limparFiltros:
    "Tira todos os filtros e a busca e mostra a lista inteira de novo.",
  carregarMaisPedidos:
    "Traz os próximos pedidos, mais antigos, para o fim da lista.",
  carregarMaisEntregas:
    "Traz as próximas entregas, mais antigas, para o fim da lista.",
  carregando:
    "Indisponível enquanto a próxima parte da lista chega. Espere um instante.",
  seloSuspeito:
    "O sistema marcou este pedido para conferir. Abre a tela Pedidos suspeitos, com o motivo.",
  desconsiderar:
    "Tira este pedido das contas: metas, rankings, painel e telão. Antes, pede o motivo. Dá para desfazer.",
  desfazer:
    "Faz este pedido voltar a contar nas metas e nos rankings. Antes, pede confirmação.",
  motivo:
    "Por que o pedido sai das contas. Fica gravado junto com o pedido e na trilha.",
  observacao:
    "Um detalhe para quem conferir depois, como o número do estorno. Não escreva dados do comprador.",
  cancelarDesconsiderar:
    "Fecha sem desconsiderar. O pedido continua contando nas vendas.",
  confirmarDesconsiderar:
    "Tira o pedido das contas agora. Ele continua nesta lista, com o selo.",
  cancelarDesfazer: "Fecha sem mudar nada. O pedido continua fora das contas.",
  confirmarDesfazer: "O pedido volta a contar em todas as contas agora.",
  desconsiderando:
    "Indisponível enquanto o pedido sai das contas. Espere um instante.",
  desfazendo:
    "Indisponível enquanto o pedido volta para as contas. Espere um instante.",
  entendi:
    "Fecha esta janela. Para voltar a desconsiderar, o admin liga a regra na tela Campanha.",
  filtroResultado:
    "Mostra só as entregas com o resultado escolhido, como as que deram erro.",
  verTodasAsEntregas:
    "Tira o filtro de resultado e mostra todas as entregas de novo.",
} as const;
