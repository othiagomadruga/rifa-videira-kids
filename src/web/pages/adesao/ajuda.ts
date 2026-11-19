// Ajuda da Adesão (RIFA-066, D31): a explicação de cada título e rótulo, para quem nunca viu o sistema (o que é, para
// que serve e um exemplo). A tela carrega junto com o site: este módulo vem sob demanda (`pages/ajuda-das-telas.ts`),
// num pedaço à parte, para o JS inicial não levar os textos (o dos links de vendas, que é `lazy`, também: o textos.ts
// da Adesão é dividido com a parte que carrega com o site).

export const AJUDA = {
  vinculadas:
    "Quantas células já têm o código de afiliado da Rifei ligado a elas. Só as vendas pelo link de uma célula vinculada contam para ela.",
  comVenda:
    "Quantas células já têm pelo menos uma venda aprovada pelo link delas. Mostra quem já começou a vender.",
  afiliadosSemCelula:
    "Códigos de afiliado que chegaram nas vendas e ainda não estão ligados a uma célula. As vendas deles contam na campanha, mas em nenhuma célula, até alguém vincular.",
  quemFalta:
    "As células que ainda não têm código de afiliado da Rifei, com o telefone do líder. Serve para cobrar a adesão: sem o código, as vendas não contam para a célula.",
  todasAsCelulas:
    "Todas as células, com o código de afiliado de cada uma. É aqui que se liga, troca ou tira o código. Ex.: o líder virou afiliado na Rifei e mandou o código 1043.",
  semCelula:
    "Códigos de afiliado que apareceram nas vendas sem estar ligados a uma célula. Vincule cada um à célula certa: as vendas dele, de antes e de depois, passam a contar para ela.",
  buscarCelulas:
    "Procura pelo nome da célula, do líder, do discipulador, da rede ou pelo código de afiliado. Ex.: digite o código que o líder mandou para achar a célula dele.",
  codigoAfiliado:
    "O número que a Rifei dá a quem vira afiliado (vendedor) da campanha. Ligado à célula, toda venda com esse código conta para ela. Ex.: 1043.",
  buscarNaEscolha:
    "Procura a célula que vai receber este afiliado, pelo nome dela, do líder, do discipulador, da rede ou por um código. Ex.: “betel”.",
  linksDeVendas:
    "O link da Rifei de cada célula, que o líder manda para quem vai comprar: toda compra por ele conta para a célula. Sai do modelo abaixo e do código de afiliado da célula.",
  linkDeCadaCelula:
    "A lista dos links, um por célula, com o QR code para mandar ou imprimir. Serve para entregar a cada líder o link certo.",
  modelo:
    "O endereço que vira o link de cada célula: o sistema troca {slug} pelo da campanha e {codigo} (ou {afiliado}) pelo código de cada líder. Ex.: https://rifei.com.br/{slug}?afiliado={codigo}.",
  modeloSoLeitura:
    "O endereço que vira o link de cada célula, com {slug} e {codigo} (ou {afiliado}). Só o admin muda o modelo; aqui você vê o que está valendo.",
  buscarLinks:
    "Procura nos links pelo nome da célula, do líder ou pelo código de afiliado. Ex.: o nome da célula de quem pediu o link.",
} as const;
