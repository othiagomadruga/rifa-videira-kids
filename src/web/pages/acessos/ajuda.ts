// Ajuda de Acessos (RIFA-066, D31): a explicação de cada título e rótulo, para quem nunca viu o sistema (o que é, para
// que serve e um exemplo). A tela carrega junto com o site (as abas da hierarquia e do webhook, não): este módulo vem
// sob demanda (`pages/ajuda-das-telas.ts`), num pedaço à parte, para o JS inicial não levar os textos.

export const AJUDA = {
  pessoa:
    "Uma pessoa com acesso à coordenação, com o papel dela e o link pessoal de entrada. Crie um link novo se ela perdeu o dela, ou revogue se ele foi parar com outra pessoa.",
  nomePessoa:
    "O nome da pessoa, como aparece nos acessos, na trilha e na mensagem do WhatsApp com o link. Ex.: Ana Souza.",
  emailPessoa:
    "Só para saber quem é: a pessoa entra pelo link pessoal, nunca pelo e-mail. Pode ficar em branco.",
  papelPessoa:
    "O que a pessoa pode fazer no sistema. Coordenação acompanha e cuida das vendas; admin faz isso e também cria pessoas, gera e revoga links e muda as regras da campanha.",
  linkDeAcesso:
    "O link pessoal: quem abrir entra no sistema como esta pessoa, sem senha. Copie e mande só para ela, pelo WhatsApp.",
  papelDaHierarquia:
    "De quem ver os acessos: dos líderes de célula, dos discipuladores ou das redes. Cada um entra pelo próprio link e vê só a sua parte, sem valores em dinheiro.",
  mensagemComLink:
    "A mensagem pronta para o WhatsApp, com o link pessoal desta pessoa. Toque no campo para selecionar tudo e mande só para ela.",
  colarNaRifei:
    "Os dois dados que a Rifei precisa para avisar o sistema de cada venda: o endereço (URL) e o token. Sem isso, nenhuma venda chega.",
  situacaoWebhook:
    "Se a Rifei já tem como mandar as vendas para o sistema: qual token vale, desde quando e quando ela usou pela última vez. Serve para conferir se as vendas estão chegando.",
  urlWebhook:
    "O endereço do sistema que recebe os avisos de venda da Rifei. Copie e cole no campo URL do webhook, na Rifei.",
  tokenWebhook:
    "A senha que a Rifei manda junto com cada venda, para o sistema saber que o aviso é dela. Cole na Rifei e não guarde cópia.",
  comoColar:
    "O passo a passo, no painel da Rifei, para ligar a campanha a este sistema. Faça uma vez, no começo, ou de novo ao trocar o token.",
} as const;
