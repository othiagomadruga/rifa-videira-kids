// Ajuda da Hierarquia (RIFA-066, D31): a explicação de cada título e rótulo, para quem nunca viu o sistema (o que é,
// para que serve e um exemplo). A tela carrega junto com o site: este módulo vem sob demanda (`pages/ajuda-das-telas.ts`),
// num pedaço à parte, para o JS inicial não levar os textos.

export const AJUDA = {
  redes:
    "Quantas redes a igreja tem cadastradas. Uma rede junta vários discipuladores e as células deles, e tem um ranking próprio.",
  discipuladores:
    "Quantos discipuladores estão cadastrados. Cada um acompanha algumas células e vê os números delas pelo link pessoal.",
  celulas:
    "Quantas células disputam a campanha. Cada célula vende pelo seu link da Rifei e tem a sua meta.",
  pessoas:
    "A soma das pessoas de todas as células. É a base das metas: com a meta por pessoa, uma célula de 10 pessoas tem o dobro da meta de uma de 5.",
  filtroDivisao:
    "Mostra só as células de Jovens ou de Adultos; a lista de redes ao lado segue a escolha. Ex.: escolha Jovens para conferir as células dos jovens.",
  filtroRede:
    "Mostra só as células de uma rede, com a contagem de células e de pessoas dela. Ex.: escolha uma rede para conferir se todas as células dela estão cadastradas.",
  busca:
    "Procura pelo nome da célula, do líder ou do discipulador enquanto você digita (acentos e maiúsculas não importam). Ex.: “betel” acha a Célula Betel.",
  loginDasCelulas:
    "Um jeito simples de o líder e o discipulador entrarem: o nome (da célula ou do discipulador) e uma senha padrão, sem precisar do link. Ex.: a senha da Célula Betel começa com @ e termina com 1234. Aqui você vê a senha de cada um para repassar.",
  importar:
    "Uma forma de cadastrar de uma vez as redes, os discipuladores e as células, a partir de uma planilha. Serve para começar a campanha sem digitar célula por célula.",
  passoModelo:
    "Uma planilha vazia com as colunas certas, para preencher no Excel ou no Google Planilhas. Ex.: uma linha por célula, com a rede, o discipulador, o líder e as pessoas.",
  passoArquivo:
    "A planilha preenchida, salva em CSV. Ao escolher, o sistema só lê o arquivo no aparelho: nada é gravado ainda.",
  passoConferir:
    "Mostra o que a importação vai fazer antes de gravar: quantas redes, discipuladores e células serão criados ou mudados, e os erros de cada linha.",
  passoImportar:
    "Grava o que foi conferido. Nunca apaga nada: o que não está na planilha continua como está.",
  planilha:
    "O arquivo da planilha das células, em CSV. Ex.: no Excel, Arquivo > Salvar como > CSV UTF-8.",
  nomeCelula:
    "Como a célula aparece nas tabelas, nos rankings e no telão. Ex.: Célula Betel. Não pode repetir o nome de outra célula.",
  discipuladorDaCelula:
    "Quem acompanha esta célula. Ao trocar, a célula passa a contar, com as vendas de antes, para o novo discipulador e a rede dele.",
  qtdPessoas:
    "Quantas pessoas a célula tem hoje. É a base da meta: com 5 bilhetes por pessoa, uma célula de 8 pessoas tem meta de 40. Com a meta total dividida, mudar aqui muda a das outras células.",
  lider:
    "Quem cuida da célula na campanha. É quem recebe o link de vendas e o link pessoal para acompanhar a meta.",
  liderNome:
    "Quem lidera a célula na campanha. Aparece na tabela das células e no relatório por célula. Ex.: Ana Souza.",
  liderEmail:
    "Para a coordenação falar com o líder: vira um link de e-mail na tabela das células. Pode ficar em branco.",
  liderTelefone:
    "O telefone do líder, com DDD, para a coordenação falar com ele: no celular, vira um link que liga. Ex.: (91) 90000-0001.",
  nomeDiscipulador:
    "Como o discipulador aparece nas tabelas, no ranking dos discipuladores e no link pessoal dele. Ex.: Carlos Lima. Não pode repetir o de outro.",
  redeDoDiscipulador:
    "A rede a que o discipulador pertence. Mude quando ele passar para outra rede: ele e as células dele vão junto e ficam com a divisão da rede nova.",
  nomeRede:
    "Como a rede aparece nas tabelas, no ranking das redes e no painel. Ex.: Rede Jovem. Não pode repetir o de outra rede.",
  divisaoRede:
    "Se a rede é de Jovens ou de Adultos. As células da rede ficam nessa divisão: o painel e o mapa filtram por ela, e os rankings a separam se a Campanha pedir.",
  responsavel:
    "Quem responde pela rede, como o pastor ou o obreiro. Aparece na tabela das redes. Pode ficar em branco.",
} as const;
