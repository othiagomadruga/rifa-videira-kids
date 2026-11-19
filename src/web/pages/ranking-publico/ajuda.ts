// Ajuda das telas abertas (RIFA-066, D31): o ranking aberto, o telão (só com o mouse, sem o "?": o telão não tem
// controles), a entrada, o link pessoal e as telas de aviso. Vem sob demanda (`ajuda-sob-demanda.ts`), num pedaço
// à parte, para o JS inicial não levar os textos. Só textos, sem dinheiro (guarda-publico.test.ts e guarda-telao).

export const AJUDA = {
  ranking:
    "A disputa entre as células na campanha da Projeto Videira Kids, atualizada a cada minuto. Mostra a posição de cada célula, sem valores em dinheiro.",
  disputa:
    "O tempo desta disputa: a etapa de agora (normalmente uma semana) ou a campanha inteira. A cada etapa, o ranking começa de novo.",
  divisao:
    "As células desta lista disputam entre si. Ex.: as células dos jovens disputam só com outras células de jovens.",
  todas:
    "Todas as células da campanha, numa disputa só, da que está na frente para a de trás.",
  entrar:
    "Como entrar no sistema da campanha: o líder entra com o nome da célula e a senha; a coordenação e os discipuladores, pelo link pessoal que chegou no WhatsApp.",
  entrarComCelula:
    "O jeito de o líder entrar: o nome da célula, como aparece no ranking, e a senha que a coordenação passou. Ex.: a senha começa com @ e termina com 1234.",
  entrarComoAdmin:
    "O jeito de o administrador entrar sem o link: o usuário e a senha que ele criou em Minha senha. Ex.: depois de trocar de celular, entre por aqui.",
  comoEntrar:
    "O passo a passo para entrar pelo link pessoal que chegou no WhatsApp, sem senha. Ex.: se perdeu o link, peça um novo à coordenação.",
  acesso:
    "A entrada pelo link pessoal: o sistema confere o link e abre a sua área. O link é só seu; não mande para ninguém.",
  status:
    "Mostra se o sistema está no ar: se a API e o banco de dados estão respondendo. Serve para conferir quando algo não carrega.",
  naoEncontrada:
    "O endereço aberto não existe no sistema, ou mudou. Use o botão abaixo para voltar ao início.",
  erro: "Algo inesperado aconteceu nesta tela. Recarregue a página; se continuar, avise a coordenação.",
} as const;
