// Textos do cartão "Avisos de venda no celular" (RIFA-095, D43), no ranking aberto e na /minha. Nunca o nome de
// quem comprou nem valores em R$: a notificação é a da célula ("A célula X vendeu N bilhetes!").

export const TEXTOS_AVISOS = {
  titulo: "Avisos de venda no celular",
  descricao:
    "Receba uma notificação a cada venda paga, mesmo com o site fechado.",
  ligar: "Receber avisos de venda",
  ligando: "Ligando…",
  ligado: "Avisos ligados neste aparelho",
  ligadoDetalhe: "A cada venda paga, chega uma notificação aqui.",
  desligar: "Desligar",
  desligando: "Desligando…",
  iphone:
    "No iPhone: toque em Compartilhar → Adicionar à Tela de Início, abra pelo ícone e ative aqui.",
  negado: "Os avisos estão bloqueados neste aparelho.",
  negadoComoLiberar:
    "Para liberar, toque no cadeado ao lado do endereço do site, em Notificações escolha Permitir e recarregue a página.",
  negadoComoLiberarNoIphone:
    "Para liberar, abra Ajustes → Notificações → Videira Kids, ligue Permitir Notificações e abra o app de novo.",
  falhouLigar: "Não foi possível ligar os avisos agora. Tente de novo.",
  falhouDesligar: "Não foi possível desligar os avisos agora. Tente de novo.",
} as const;

/** As dicas dos botões (RIFA-045: todo botão fora da coordenação tem dica). */
export const DICAS_AVISOS = {
  ligar:
    "O navegador pede a sua permissão. Depois, cada venda paga aparece como notificação neste aparelho.",
  desligar: "Para de mostrar os avisos de venda neste aparelho.",
  ocupado: "Aguarde um instante.",
} as const;
