// Textos do botão "Avisos no celular" (RIFA-095, D43; compacto desde a RIFA-096), no ranking aberto e na /minha.
// Nunca o nome de quem comprou nem valores em R$: a notificação é a da célula ("A célula X vendeu N bilhetes!"). Na
// página, só o rótulo do botão; as explicações ficam no balão (uma frase) e na dica.

export const TEXTOS_AVISOS = {
  /** O rótulo do botão (e o nome do balão). */
  rotulo: "Avisos no celular",
  titulo: "Avisos no celular",
  ligando: "Ligando…",
  ligado: "Avisos ligados",
  desligando: "Desligando…",
  iphone:
    "No iPhone: Compartilhar → Adicionar à Tela de Início. Depois abra pelo ícone e toque aqui.",
  negado:
    "Os avisos estão bloqueados neste navegador: toque no cadeado ao lado do endereço, em Notificações escolha Permitir e recarregue a página.",
  negadoNoIphone:
    "Os avisos estão bloqueados neste aparelho: abra Ajustes → Notificações → Videira Kids, ligue Permitir Notificações e abra o app de novo.",
  falhouLigar: "Não foi possível ligar os avisos agora. Tente de novo.",
  falhouDesligar: "Não foi possível desligar os avisos agora. Tente de novo.",
  fechar: "Fechar",
} as const;

/** As dicas (RIFA-045: todo botão fora da coordenação tem dica). */
export const DICAS_AVISOS = {
  ligar:
    "Receba uma notificação a cada venda paga, mesmo com o site fechado. O navegador pede a sua permissão.",
  desligar: "Os avisos de venda chegam neste aparelho. Clique para desligar.",
  ocupado: "Aguarde um instante.",
  iphone:
    "No iPhone, os avisos chegam pelo app da Tela de Início. Clique para ver como.",
  negado:
    "Os avisos estão bloqueados neste aparelho. Clique para ver como liberar.",
  fechar: "Fecha a explicação.",
} as const;
