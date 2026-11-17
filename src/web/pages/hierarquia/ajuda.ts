// Ajuda da Hierarquia (RIFA-066, D31): a explicação de cada título e rótulo, para quem nunca viu o sistema (o que é,
// para que serve e um exemplo). A tela carrega junto com o site: este módulo vem sob demanda (`ajuda-sob-demanda.ts`),
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
    "Mostra só as células de uma divisão: Jovens ou Adultos. Ex.: escolha Jovens para conferir as células dos jovens.",
  filtroRede:
    "Mostra só as células de uma rede. Ex.: escolha uma rede para conferir se todas as células dela estão cadastradas.",
  busca:
    "Procura pelo nome da célula, do líder ou do discipulador. Ex.: digite “Betel” para achar a Célula Betel.",
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
    "Como a célula aparece nos rankings, no telão e no painel. Ex.: Célula Betel. Não pode repetir o nome de outra célula.",
  discipuladorDaCelula:
    "Quem acompanha esta célula. A célula entra na rede e na divisão desse discipulador, e conta nos rankings dele.",
  qtdPessoas:
    "Quantas pessoas a célula tem hoje. É a base da meta: com 5 bilhetes por pessoa, uma célula de 8 pessoas tem meta de 40.",
  lider:
    "Quem cuida da célula na campanha. É quem recebe o link de vendas e o link pessoal para acompanhar a meta.",
  liderNome:
    "O nome de quem lidera a célula, como aparece para a coordenação e no link pessoal. Ex.: Ana Souza.",
  liderEmail:
    "Um contato extra do líder, só para a coordenação. Pode ficar em branco.",
  liderTelefone:
    "O WhatsApp do líder, com DDD. Serve para a coordenação mandar o link de vendas e o link pessoal. Ex.: (91) 90000-0001.",
  nomeDiscipulador:
    "Como o discipulador aparece no ranking dos discipuladores e no link pessoal dele. Ex.: Carlos Lima.",
  redeDoDiscipulador:
    "A rede a que o discipulador pertence. As células dele contam no ranking dessa rede.",
  nomeRede:
    "Como a rede aparece no ranking das redes e no painel. Ex.: Rede Jovem.",
  divisaoRede:
    "Se a rede é de Jovens ou de Adultos. Todas as células da rede ficam nessa divisão, que separa os rankings quando a campanha pede.",
  responsavel:
    "Quem responde pela rede, como o pastor ou o obreiro. Só aparece para a coordenação. Pode ficar em branco.",
} as const;
