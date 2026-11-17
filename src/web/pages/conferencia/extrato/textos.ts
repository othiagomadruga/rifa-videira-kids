// Textos da seção "Extrato do banco (Pix manual)" da Conferência (RIFA-059), para quem cuida do dinheiro: curtos, em
// português simples, sem jargão. As dicas (RIFA-045) dizem para que serve cada botão e campo e o que acontece.
import type { TomBadge } from "../../../components/ui";
import type { Grau, MotivoSemPedido, StatusDoPedido } from "./cruzamento";
import type { Ignorados } from "./lancamentos";

/** "1 pedido", "3 pedidos". */
export function plural(n: number, singular: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : varios}`;
}

export const TITULO = "Extrato do banco (Pix manual)";

export const PASSOS = [
  "No banco (no Bradesco Net Empresa: Saldos e Extratos), abra o extrato do período e salve como arquivo OFX. Sem essa opção, selecione a tabela do extrato na tela, copie e cole na caixa abaixo.",
  "Escolha o arquivo ou cole o texto. A tela lê o extrato aqui e compara cada Pix recebido com os pedidos da Rifei.",
  "Marque como pago no painel da Rifei os pedidos da lista. Se a venda não contar até o fim do dia, faça a conferência pelo CSV, mais abaixo.",
];

export const PRIVACIDADE = {
  titulo: "O extrato não sai do seu computador",
  texto:
    "O extrato é lido aqui, no navegador, e esquecido quando você sai da tela. Nada dele vai para o sistema: a tela só busca a lista de pedidos para comparar.",
};

export const CAMPOS = {
  arquivo: {
    rotulo: "Extrato do banco (OFX ou CSV)",
    dica: "O arquivo salvo no banco: OFX, de preferência.",
  },
  texto: {
    rotulo: "Ou cole aqui a tabela do extrato",
    dica: "Selecione as linhas do extrato na tela do banco (ou no PDF), copie e cole. Cada linha precisa da data e do valor.",
  },
  janela: {
    rotulo: "Tempo entre a reserva e o Pix",
    dica: "Até quanto tempo depois da reserva o Pix pode ter chegado.",
  },
  palavras: {
    rotulo: "Palavras do Pix",
    dica: "Só entram créditos com uma destas palavras (separe com vírgula).",
  },
};

/** As janelas do cruzamento, em horas (o padrão é 24). */
export const JANELAS_HORAS = [1, 3, 6, 12, 24, 48, 72] as const;
export const JANELA_PADRAO_HORAS = 24;

export const rotuloDaJanela = (horas: number) =>
  `${horas === 1 ? "1 hora" : `${horas} horas`}${horas === JANELA_PADRAO_HORAS ? " (padrão)" : ""}`;

export const LER_TEXTO = "Ler o texto colado";
export const COPIAR = "Copiar os números dos pedidos";

export const COLUNAS_CSV = {
  titulo: "Colunas do extrato",
  explicacao:
    "A tela reconheceu as colunas pelo nome. Troque a que estiver errada: o resultado muda na hora.",
  semColuna: "Não tem",
  campos: {
    data: "Data",
    hora: "Hora",
    descricao: "Descrição (histórico)",
    valor: "Valor ou crédito",
    debito: "Débito",
    identificador: "Documento ou identificador",
  },
} as const;

export const RESULTADO = {
  titulo: "Resultado do extrato",
  formato: { ofx: "arquivo OFX", csv: "arquivo CSV", texto: "texto colado" },
  semHora:
    "O extrato não traz a hora dos lançamentos: a comparação usa só o dia, e mais pedidos podem servir a cada Pix.",
  cortada:
    "A busca parou nos 12.000 pedidos mais recentes. Para os Pix mais antigos, use um extrato de um período menor.",
  semPix:
    "Nenhum Pix recebido neste extrato. Confira o período e as palavras do Pix.",
  carregando: "Buscando os pedidos da campanha…",
  numeros: {
    lidos: "Pix lidos",
    paraMarcar: "Para marcar na Rifei",
    ambiguos: "Ambíguos",
    semPedido: "Sem pedido",
    jaContados: "Já contados",
  },
};

/** "Ficaram de fora: 3 débitos, 2 créditos sem as palavras do Pix, 1 linha de saldo e 1 linha sem data ou valor." */
export function textoDosIgnorados(ignorados: Ignorados): string | null {
  const partes = [
    ignorados.debitos > 0 ? plural(ignorados.debitos, "débito", "débitos") : "",
    ignorados.semPalavra > 0
      ? plural(
          ignorados.semPalavra,
          "crédito sem as palavras do Pix",
          "créditos sem as palavras do Pix",
        )
      : "",
    ignorados.saldos > 0
      ? plural(ignorados.saldos, "linha de saldo", "linhas de saldo")
      : "",
    ignorados.ilegiveis > 0
      ? plural(
          ignorados.ilegiveis,
          "linha sem data ou valor",
          "linhas sem data ou valor",
        )
      : "",
  ].filter((parte) => parte !== "");
  if (partes.length === 0) return null;
  const lista =
    partes.length === 1
      ? partes[0]
      : `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`;
  return `Ficaram de fora: ${lista}.`;
}

export const GRUPOS = {
  paraMarcar: {
    titulo: "Para marcar como pago na Rifei",
    /** A ajuda do título (RIFA-066); os outros grupos usam a explicação que aparece abaixo dele. */
    explicacao:
      "Pix do extrato que bateram com um pedido ainda não pago no sistema. Marque cada um como pago no painel da Rifei: a venda passa a contar quando a Rifei avisar o sistema.",
    aviso:
      "Marque como pago no painel da Rifei; a venda passa a contar quando a Rifei avisar o sistema",
    vazio: "Nenhum pedido para marcar.",
  },
  ambiguos: {
    titulo: "Ambíguos",
    explicacao:
      "Mais de um pedido tem o valor e o horário deste Pix. Olhe o nome de quem pagou e os pedidos na Rifei antes de marcar.",
  },
  semPedido: {
    titulo: "Pix sem pedido",
    explicacao:
      "Nenhum pedido livre tem o valor deste Pix no horário. Pode ser um Pix de fora da campanha ou com o valor errado.",
  },
  jaContados: {
    titulo: "Já contados",
    explicacao:
      "O extrato confirma e o pedido já está pago no sistema: não precisa fazer nada.",
  },
};

export const GRAU: Record<Grau, { rotulo: string; tom: TomBadge }> = {
  certo: { rotulo: "Certo", tom: "sucesso" },
  provavel: { rotulo: "Provável", tom: "info" },
};

export const EXPLICACAO_DO_GRAU =
  "Certo: o Pix traz o número do pedido. Provável: sem o número, só este pedido tem o valor e o horário do Pix.";

export const STATUS: Record<StatusDoPedido, string> = {
  in_process: "Pendente",
  expired: "Expirado",
  approved: "Já pago",
};

export const AVISO_EXPIRADO =
  "Expirado na Rifei: confira se ela deixa marcar como pago.";

export const valorDiferente = (valorDoPix: string) =>
  `O Pix foi de ${valorDoPix}, outro valor: confira antes de marcar.`;

export function motivoSemPedido(
  motivo: MotivoSemPedido,
  pedidos: readonly string[],
): string {
  const lista = pedidos.join(", ");
  switch (motivo) {
    case "nenhum":
      return "Nenhum pedido com este valor no horário.";
    case "ja_casados":
      return `O pedido que servia (${lista}) ficou com outro Pix do extrato. Pix em dobro?`;
    case "pedido_repetido":
      return `Traz o número do pedido ${lista}, que ficou com outro Pix do extrato. Pix em dobro?`;
    case "desconsiderado":
      return `Traz o número do pedido ${lista}, que o admin desconsiderou.`;
  }
}

export const UM_DESTES = "Um destes pedidos, todos já pagos:";

/**
 * Os candidatos mostrados por Pix (ambíguo ou "um destes"): com muitos pedidos do mesmo valor na janela, a lista
 * inteira de cada Pix travaria a página num extrato grande. Os outros viram uma linha.
 */
export const MAXIMO_CANDIDATOS_NA_TELA = 8;
/** Os Pix ambíguos mostrados: num extrato grande (um mês), centenas deles travariam a página e não dá para olhar todos. */
export const MAXIMO_AMBIGUOS_NA_TELA = 100;
export const MAIS_AMBIGUOS = (n: number) =>
  `E mais ${plural(n, "Pix ambíguo", "Pix ambíguos")}. Diminua o tempo entre a reserva e o Pix, ou use um extrato de um período menor, para ver todos.`;
export const MAIS_CANDIDATOS = (n: number) =>
  `E mais ${plural(n, "pedido", "pedidos")}. Diminua o tempo entre a reserva e o Pix para ver menos.`;

export const FALHAS = {
  semCampanha: {
    titulo: "Não dá para conferir ainda",
    mensagem:
      "A campanha ainda não foi configurada: configure-a antes de conferir o extrato.",
  },
  campanha: "Não foi possível conferir agora",
  pedidos: "Não foi possível buscar os pedidos",
};

export const COPIADO = (n: number) =>
  `${plural(n, "número copiado", "números copiados")}: cole na busca de pedidos da Rifei.`;
export const SEM_AREA_DE_TRANSFERENCIA =
  "Não foi possível copiar sozinho: os números estão selecionados no campo abaixo. Copie com Ctrl+C (ou toque e segure no celular).";
export const ROTULO_NUMEROS = "Números dos pedidos para marcar";

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045)
// ---------------------------------------------------------------------------------------------------

const ESPERE = "Espere um instante.";

/**
 * Ajuda (RIFA-066, D31): a explicação dos títulos e dos rótulos, com o mouse no título (ou no campo) e no "?" ao lado
 * dele: o que é, para que serve e um exemplo. Nos campos, é também a dica do campo.
 */
export const AJUDA = {
  extrato:
    "Confere o Pix que caiu na conta da igreja com os pedidos da Rifei, para quem pagou por fora. Mostra quais pedidos marcar como pagos na Rifei.",
  arquivo:
    "O extrato da conta, salvo no site ou no aplicativo do banco, em OFX (de preferência) ou CSV. Ex.: “extrato.ofx” do mês da campanha.",
  texto:
    "Se o banco não salva arquivo, copie as linhas do extrato na tela (ou no PDF) e cole aqui. Cada linha precisa da data e do valor.",
  janela:
    "Até quanto tempo depois da reserva na Rifei o Pix pode ter chegado para contar como do mesmo pedido. Ex.: 24 horas.",
  palavras:
    "Só entram os créditos com uma destas palavras na descrição, separadas por vírgula. Ex.: “pix” deixa de fora transferências e depósitos.",
  colunas:
    "Qual coluna do CSV do banco traz cada dado: a data, a descrição, o valor... A tela reconhece pelo nome; troque o que estiver errado.",
  coluna:
    "Qual coluna do extrato do banco traz este dado. Ex.: a coluna “Valor” para o valor do Pix.",
  resultado:
    "O que o cruzamento achou: quantos Pix foram lidos, quais batem com um pedido e quais pedem atenção.",
  numeros:
    "Os números dos pedidos para marcar como pagos, um por linha, prontos para copiar. Ex.: cole numa conversa para quem tem acesso ao painel da Rifei.",
  lidos: "Quantos Pix de entrada o extrato tem, depois do filtro das palavras.",
  paraMarcar:
    "Pix que batem com um pedido ainda não pago no sistema: marque esses pedidos como pagos na Rifei.",
  ambiguos:
    "Pix que batem com mais de um pedido: confira o nome de quem pagou antes de marcar.",
  semPedido:
    "Pix que não batem com nenhum pedido livre: pode ser de fora da campanha ou com o valor errado.",
  jaContados:
    "Pix de pedidos que já estão pagos no sistema: não precisa fazer nada.",
} as const;

export const DICAS = {
  escolherArquivo:
    "Abre a escolha do arquivo no aparelho. O extrato é lido aqui e comparado com os pedidos; nada é gravado nem enviado.",
  escolherArquivoOcupado: `Indisponível enquanto o extrato é lido. ${ESPERE}`,
  lerTexto:
    "Lê o texto da caixa aqui no navegador e compara cada Pix com os pedidos. Nada é gravado nem enviado.",
  lerTextoVazio: "Indisponível: cole antes a tabela do extrato na caixa.",
  lerTextoOcupado: `Indisponível enquanto o extrato é lido. ${ESPERE}`,
  copiar:
    "Copia os números dos pedidos desta lista, um por linha, para procurar e marcar como pago na Rifei.",
};
