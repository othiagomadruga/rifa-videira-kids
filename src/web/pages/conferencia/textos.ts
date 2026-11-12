// Textos da tela da conferência, para quem não é técnico: o que é cada campo do arquivo, o que cada tipo de
// diferença quer dizer e o que fazer. As chaves seguem as listas do contrato (CAMPOS_RECONCILIACAO,
// TIPOS_DIVERGENCIA...), e conferencia-contrato.test.ts confere que nenhuma falta.
import type {
  CampoReconciliacao,
  CodigoAvisoReconciliacao,
  MotivoDesconsideracao,
  StatusArquivoReconciliacao,
  StatusPedido,
  TipoDivergencia,
} from "../../../shared/contracts";
import type { TomAviso, TomBadge } from "../../components/ui";

/** "1 pedido", "3 pedidos". */
export function plural(n: number, singular: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : varios}`;
}

/** Campos do mapeamento, na ordem do contrato (CAMPOS_RECONCILIACAO). */
export const CAMPOS: Record<
  CampoReconciliacao,
  { rotulo: string; dica: string; semColuna?: string }
> = {
  pedido_id: {
    rotulo: "Código do pedido",
    dica: "Com ele, o sistema compara pedido a pedido e pode recuperar vendas. Sem ele, compara só os totais.",
    semColuna: "Não tem (comparar só os totais)",
  },
  status: {
    rotulo: "Status do pagamento",
    dica: "Pago, pendente, expirado… Sem ele, todos os pedidos do arquivo contam como pagos.",
    semColuna: "Não tem (todos estão pagos)",
  },
  qtd_bilhetes: {
    rotulo: "Quantidade de bilhetes",
    dica: "Quantos bilhetes o pedido tem.",
  },
  bilhetes: {
    rotulo: "Números dos bilhetes",
    dica: "Sem a quantidade, ela é contada pelos números.",
  },
  valor: {
    rotulo: "Valor pago",
    dica: "Precisa dele para recuperar uma venda.",
  },
  afiliado: {
    rotulo: "Afiliado",
    dica: "O número do afiliado ou o usuário dele na Rifei (igual ao rótulo cadastrado na tela Adesão).",
  },
  data: {
    rotulo: "Data do pagamento",
    dica: "Sem ela, uma venda recuperada entra com a data de hoje.",
  },
};

/** Tipos de diferença, na ordem do contrato (TIPOS_DIVERGENCIA). */
export const DIVERGENCIAS: Record<
  TipoDivergencia,
  { titulo: string; explicacao: string; tom: TomBadge }
> = {
  venda_perdida: {
    titulo: "Vendas perdidas",
    explicacao:
      "Pagas na Rifei, mas não chegaram ao sistema: não contam no painel nem no ranking. Escolha as que quer recuperar.",
    tom: "perigo",
  },
  pagamento_nao_registrado: {
    titulo: "Pagamento não registrado",
    explicacao:
      "Pagas na Rifei, mas no sistema ainda estão pendentes ou expiradas: o aviso do pagamento não chegou e elas não contam no ranking. A conferência ainda não corrige este caso: avise a equipe técnica.",
    tom: "perigo",
  },
  nao_pago_na_rifei: {
    titulo: "Não pagas na Rifei",
    explicacao:
      "Contam como pagas no sistema, mas na Rifei estão pendentes, expiradas ou canceladas (por exemplo, um estorno). Confira o pedido na Rifei.",
    tom: "alerta",
  },
  ausente_no_arquivo: {
    titulo: "Só no sistema",
    explicacao:
      "Pagas no sistema, mas não estão no arquivo. Pode ser um arquivo de outro período ou uma compra de teste.",
    tom: "alerta",
  },
  valor_diferente: {
    titulo: "Valor diferente",
    explicacao: "Pagas nos dois lados, mas com valores diferentes.",
    tom: "alerta",
  },
  quantidade_diferente: {
    titulo: "Quantidade de bilhetes diferente",
    explicacao:
      "Pagas nos dois lados, mas com quantidades de bilhetes diferentes.",
    tom: "alerta",
  },
  afiliado_diferente: {
    titulo: "Afiliado diferente",
    explicacao:
      "A venda está com um afiliado no sistema e com outro (ou sem nenhum) na Rifei. O ranking usa o do sistema.",
    tom: "alerta",
  },
};

export const STATUS_DO_ARQUIVO: Record<StatusArquivoReconciliacao, string> = {
  aprovado: "Pago",
  pendente: "Pendente",
  expirado: "Expirado",
  cancelado: "Cancelado",
  desconhecido: "Status não reconhecido",
};

export const STATUS_DO_SISTEMA: Record<StatusPedido, string> = {
  approved: "Pago",
  in_process: "Pendente",
  expired: "Expirado",
};

/** Observações dos itens (OBSERVACOES_DIVERGENCIA). */
export const OBSERVACOES: Record<string, string> = {
  sem_quantidade:
    "Sem a quantidade de bilhetes no arquivo: não dá para recuperar.",
  sem_valor: "Sem o valor no arquivo: não dá para recuperar.",
  valor_ambiguo:
    "As linhas do pedido repetem um valor que não é o preço do bilhete: não dá para saber se é o de um bilhete ou o do pedido inteiro. Confira na Rifei.",
  data_no_futuro: "A data do arquivo é depois de agora: confira o arquivo.",
  codigo_nao_confere:
    "A coluna do código não confere com o sistema: troque a coluna para recuperar.",
  fora_do_periodo_do_arquivo: "De um dia que o arquivo não cobre.",
};

/** Por que um pedido escolhido não foi recuperado (MOTIVOS_NAO_RECUPERADO). */
export const MOTIVOS: Record<string, string> = {
  ja_existe: "Já está no sistema (nada foi mudado)",
  nao_esta_no_arquivo: "Não está no arquivo",
  nao_aprovado_no_arquivo: "Não está pago no arquivo",
  inconsistente_no_arquivo: "As linhas dele no arquivo não batem entre si",
  sem_quantidade: "Sem a quantidade de bilhetes",
  sem_valor: "Sem o valor",
  valor_ambiguo:
    "Valor ambíguo (o mesmo em todas as linhas, e não é o preço do bilhete)",
  data_no_futuro: "Data depois de agora",
};

/** De onde vem a data gravada (ORIGENS_DATA_RECUPERADA). */
export const ORIGEM_DA_DATA: Record<string, string> = {
  arquivo: "data e hora do arquivo",
  dia_do_arquivo: "o arquivo só tem o dia",
  recuperacao: "sem data no arquivo: entra agora",
};

/** Avisos informativos (os demais pedem atenção; a trava do código é um perigo). */
const AVISOS_INFORMATIVOS: readonly CodigoAvisoReconciliacao[] = [
  "colunas_pessoais_ignoradas",
  "um_bilhete_por_linha",
  "valor_por_bilhete",
  "valor_do_pedido_repetido",
  "sem_coluna_pedido",
];

export function tomDoAviso(codigo: string): TomAviso {
  if (codigo === "codigo_nao_confere") return "perigo";
  return (AVISOS_INFORMATIVOS as readonly string[]).includes(codigo)
    ? "info"
    : "alerta";
}

/** O motivo da desconsideração (D20), como no selo da tela Pedidos: "Desconsiderado (teste)". */
export const MOTIVO_DESCONSIDERACAO: Record<MotivoDesconsideracao, string> = {
  teste: "teste",
  fraude: "fraude",
  estorno: "estorno",
  outro: "outro",
};

/** O grupo dos pedidos do arquivo que o admin desconsiderou (D20): à parte, nunca "faltando". */
export const DESCONSIDERADOS = {
  titulo: "Desconsiderados",
  explicacao:
    "Estão no arquivo e no sistema, mas o admin os tirou das contas (teste, fraude ou estorno). Não são diferença nem venda faltando, não entram nos totais do sistema e o “Recuperar” não os grava de novo.",
};

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045): a explicação que aparece com o mouse parado (ou o foco do teclado) em cada botão e campo da
// tela. Dizem para que serve e o que acontece, sem repetir o rótulo.
// ---------------------------------------------------------------------------------------------------

const ESPERE = "Espere um instante.";

export const DICAS = {
  escolherArquivo:
    "Abre a escolha do arquivo no aparelho. A tela lê o arquivo aqui e já compara com as vendas do sistema; nada é gravado.",
  escolherArquivoOcupado: `Indisponível enquanto o arquivo é lido e conferido. ${ESPERE}`,
  // Colunas do arquivo
  coluna:
    "A coluna do arquivo que tem este dado. Trocou? Confira de novo para ver o resultado com a coluna nova.",
  colunaOcupada: `Indisponível enquanto a conferência roda. ${ESPERE}`,
  conferirColunas:
    "Compara o arquivo de novo com as vendas do sistema, usando as colunas escolhidas. Nada é gravado.",
  conferirSemTroca:
    "Indisponível: as colunas são as da última conferência. Troque alguma para conferir de novo.",
  conferindo: `Conferindo agora. ${ESPERE}`,
  desfazerTrocas:
    "Volta as colunas para as da última conferência, sem conferir de novo.",
  // Vendas perdidas
  marcarTodas: "Marca todas as vendas perdidas que dá para recuperar.",
  desmarcarTodas: "Tira a marca de todas as vendas perdidas.",
  vendaRecuperavel:
    "Marque para incluir esta venda no “Recuperar”. Nada é gravado antes da confirmação.",
  vendaNaoRecuperavel:
    "Esta venda não pode ser recuperada agora: o motivo aparece logo abaixo do pedido ou no aviso do topo do resultado.",
  recuperar:
    "Abre a confirmação com o que vai entrar no sistema. Só grava depois que você confirmar.",
  recuperarIndisponivel: "Indisponível agora: a frase logo acima diz por quê.",
  // Confirmação do "Recuperar"
  cancelarRecuperar:
    "Fecha sem gravar nada. As vendas continuam marcadas na conferência.",
  fecharRecuperar: "Fecha esta janela. Nada foi gravado.",
  gravar:
    "Grava agora as vendas da lista, num lote só. Depois, a conferência é refeita e a gravação entra nas recuperações feitas.",
  gravando: `Gravando as vendas. ${ESPERE}`,
  // Recuperações feitas
  carregarMais: "Traz as recuperações mais antigas para o fim da lista.",
  carregando: `Indisponível enquanto a próxima parte da lista chega. ${ESPERE}`,
} as const;
