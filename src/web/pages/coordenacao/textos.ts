// Textos da moldura da coordenação (RIFA-045): a dica de cada link do menu, que diz o que a tela faz. Toda tela nova
// de telas.ts precisa da dela (o campo `dica` é obrigatório lá).

/** A dica do link de cada tela no menu, pelo segmento depois de /coordenacao ("" é a Visão geral). */
export const DICA_DO_MENU = {
  "": "O resumo da campanha: quanto já vendeu, como está a meta e quem está na frente.",
  campanha:
    "As regras da campanha: datas, preço, meta, o que o público vê, o que pode ser feito com os pedidos e as mensagens do link.",
  hierarquia:
    "As redes, os discipuladores e as células, com o número de pessoas de cada célula.",
  adesao:
    "Quais células já têm o código de afiliado da Rifei. Sem ele, as vendas não contam para a célula.",
  pedidos:
    "Todos os pedidos que chegaram da Rifei, com filtros, e os avisos de venda que a Rifei mandou.",
  bilhetes:
    "Quais números da rifa estão pagos, reservados ou livres, com a busca do pedido de cada número.",
  "pedidos-suspeitos":
    "Pedidos aprovados com bilhetes demais ou com o total fora do esperado, para conferir na Rifei.",
  rankings:
    "A disputa entre células, discipuladores e redes: posição, quanto da meta já fizeram e quem está em dia.",
  mapa: "De onde vêm as vendas, pelo DDD do telefone de quem comprou.",
  bumbo:
    "A mensagem do dia para o grupo de WhatsApp dos líderes, pronta para copiar.",
  conferencia:
    "Compara as vendas da Rifei com as do sistema e recupera as que se perderam.",
  acessos:
    "Quem entra no sistema: cria pessoas, gera e revoga os links pessoais e o token do webhook da Rifei.",
  trilha:
    "O registro de quem mudou o quê no sistema, do mais novo para o mais antigo.",
} as const;
