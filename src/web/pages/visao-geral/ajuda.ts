// Ajuda da Visão geral (RIFA-066, D31): a explicação de cada título e rótulo, para quem nunca viu o sistema (o que é,
// para que serve e um exemplo). A tela carrega junto com o site: este módulo vem sob demanda, num pedaço à parte
// (`pages/ajuda-das-telas.ts`), para o JS inicial não levar os textos.

export const AJUDA = {
  hoje: "Quanto vender hoje para a campanha seguir em dia e quanto já entrou hoje. Se ontem faltou, a falta entra na meta de hoje; se sobrou, ela diminui.",
  metaDeHoje:
    "O que vender hoje para a campanha terminar o dia em dia com a meta. Ex.: se ontem faltaram 4 bilhetes, eles entram na meta de hoje.",
  campanha:
    "A campanha inteira (ou o recorte escolhido no filtro) contra a meta: se está em dia, o ritmo e onde deve chegar no fim. Só contam as vendas aprovadas.",
  periodo:
    "A etapa em que a campanha está agora, normalmente uma semana, com a sua parte da meta. Compara o que se esperava vender até ontem com o que foi vendido nela.",
  curva:
    "O gráfico do que se esperava vender até cada dia contra o que foi vendido de fato. Se a linha do realizado fica abaixo da do esperado, a campanha está atrasada.",
  relatorio:
    "Uma planilha com os números de agora, para guardar, prestar contas ou levar a uma reunião. Ex.: as vendas por célula para a reunião dos líderes.",
  oQueBaixar:
    "Qual planilha baixar: cada opção traz os números de um jeito. Ex.: “Por célula” tem uma linha por célula, para comparar as células entre si.",
  paraConferir:
    "Vendas que pedem atenção: as que chegaram sem célula e as de fora das datas da campanha. As sem célula contam na campanha, mas em nenhuma célula, até alguém vincular o afiliado.",
  referencia:
    "Em que ponto do calendário a campanha está: o dia de hoje, a etapa e quanto falta para ela acabar. Os números abaixo são do recorte escolhido no filtro.",
  filtro:
    "Escolhe o pedaço da campanha que a tela mostra: a campanha toda, um grupo, uma divisão (se houver mais de uma), uma rede, um discipulador ou uma célula. Ex.: escolha Adultos da manhã para ver só as células desse grupo.",
  esperado:
    "Quanto já deveria ter sido vendido até o fim de ontem para chegar à meta no prazo, seguindo o percentual de cada período. Hoje ainda não conta: o dia não acabou.",
  ritmo:
    "O vendido comparado com o esperado até ontem. Ex.: 120% quer dizer 20% a mais que o esperado; 80%, que a campanha está atrás.",
  projecao:
    "Onde a campanha deve chegar no último dia se continuar vendendo no ritmo de agora. Ex.: “chega a 110% da meta”. Depois do fim, vira o resultado final.",
  arrecadado:
    "Quanto entrou na rifa: a soma dos bilhetes pagos que a Rifei avisou, na campanha toda e só hoje, antes da tarifa da Efí. Só o administrador vê este cartão; o mesmo total abre os e-mails das 7h e das 17h.",
  vendasAprovadas:
    "Os pedidos pagos, que são os que contam para a meta. Os que aguardam pagamento, os expirados e os desconsiderados ficam de fora.",
} as const;
