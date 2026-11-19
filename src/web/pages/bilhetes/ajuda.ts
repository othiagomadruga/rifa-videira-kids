// Ajuda de Bilhetes (RIFA-066, D31): a explicação de cada título e rótulo, para quem nunca viu o sistema (o que é, para
// que serve e um exemplo). A tela carrega junto com o site: este módulo vem sob demanda (`pages/ajuda-das-telas.ts`).

export const AJUDA = {
  pagos:
    "Quantos números da rifa já foram pagos e estão garantidos para quem comprou. São os que contam nas vendas.",
  reservados:
    "Números escolhidos num pedido que ainda espera o pagamento. Se o prazo da Rifei passar sem pagar, eles voltam a ficar livres.",
  livres:
    "Números que ninguém pegou ainda e podem ser vendidos. Ex.: com 7005 números e 5000 pagos ou reservados, sobram 2005.",
  vendido:
    "Quanto da rifa inteira já foi pago, em %. Ex.: 50% quer dizer que metade dos números já tem dono.",
  buscarUmNumero:
    "Procura um número da rifa para ver se está pago, reservado ou livre. Serve para responder a quem pergunta se o número dele já foi vendido.",
  numeroDoBilhete:
    "O número da rifa que você quer conferir: aparecem o pedido dele, a célula, a situação e a data. Ex.: 1234 (também dá para tocar num quadrado da grade).",
  todosOsNumeros:
    "A grade com todos os números da rifa, cada um com a cor da situação dele. Serve para ver de relance o que ainda está livre.",
  mostrarNaGrade:
    "Escolhe quais números aparecem na grade: todos ou só os pagos, os reservados ou os livres. Ex.: só os livres, para oferecer a quem quer comprar.",
  afiliadosNaRifei:
    "Os afiliados (vendedores) da campanha lidos direto da Rifei, para ligar cada um à célula certa sem digitar o código. Os convites servem para as células que ainda não têm afiliado.",
  convites:
    "O link de convite da Rifei para o líder virar afiliado da campanha. Ex.: mande pelo WhatsApp ao líder da célula que ainda não vende.",
} as const;
