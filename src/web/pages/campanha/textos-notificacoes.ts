// RIFA-095 (D43): os textos da opção "Enviar notificações de venda" da tela Campanha (à parte de textos.ts).

export const AJUDA_NOTIFICACOES = {
  vendas:
    'Manda uma notificação ao celular de quem ativou os avisos no ranking aberto ou no painel dos líderes, a cada venda paga. Ex.: "A célula Betel vendeu 3 bilhetes!". Nunca o nome de quem comprou nem valores em R$.',
} as const;

/** O item do resumo "Regras da campanha". */
export function textoDoResumoDasNotificacoes(ligadas: boolean): string {
  return ligadas
    ? "Ligadas: quem ativou os avisos recebe no celular cada venda paga, com a célula e os bilhetes."
    : "Desligadas: o botão some e nenhuma notificação é enviada.";
}
