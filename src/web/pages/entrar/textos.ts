// Textos da tela Entrar (/entrar): o login da célula com a senha padrão (RIFA-064, D29), o do discipulador com a senha
// padrão (RIFA-082, D37), o do admin com usuário e senha (RIFA-073, D33) e as dicas (RIFA-045) dos campos e dos botões,
// em português simples: para que serve e o que acontece, sem repetir o rótulo.

/** Os textos de um formulário de entrada com nome e senha (a célula ou o admin). */
export type TextosFormulario = {
  tituloSenha: string;
  explicacaoSenha: string;
  rotuloNome: string;
  rotuloSenha: string;
  faltaNome: string;
  faltaSenha: string;
  recusada: string;
  recusadaDetalhe: string;
  muitasTentativas: string;
  muitasTentativasDetalhe: string;
  falha: string;
};

/** As dicas de um formulário de entrada com nome e senha. */
export type DicasFormulario = {
  nome: string;
  senha: string;
  entrar: string;
  entrando: string;
};

export const DICAS = {
  nome: "Escreva o nome da sua célula, como aparece no ranking. Maiúsculas, acentos e espaços não fazem diferença.",
  senha:
    "A senha que a coordenação passou para a sua célula. Não sabe? Peça ao seu discipulador.",
  entrar:
    "Confere a célula e a senha e conecta este aparelho. Depois, abre a página da sua célula.",
  entrando:
    "Indisponível enquanto a célula e a senha são conferidas. Espere um instante.",
  souAdmin:
    "Para o administrador da campanha que criou usuário e senha na tela Minha senha.",
} as const satisfies DicasFormulario & Record<string, string>;

export const TEXTOS = {
  tituloSenha: "Entrar com a sua célula",
  explicacaoSenha:
    "Para líderes de célula: o nome da célula e a senha que a coordenação passou.",
  rotuloNome: "Célula",
  rotuloSenha: "Senha",
  faltaNome: "Escreva o nome da célula.",
  faltaSenha: "Escreva a senha.",
  recusada: "Célula ou senha não conferem.",
  recusadaDetalhe:
    "Confira o nome da célula e a senha e tente de novo. Se não der certo, fale com a coordenação.",
  muitasTentativas: "Muitas tentativas seguidas.",
  muitasTentativasDetalhe: "Espere um minuto e tente de novo.",
  falha: "Não foi possível entrar agora.",
  souAdmin: "Sou administrador",
} as const satisfies TextosFormulario & Record<string, string>;

export const DICAS_ADMIN = {
  nome: "O usuário que você criou na tela Minha senha. Maiúsculas não fazem diferença.",
  senha: "A senha que você criou na tela Minha senha.",
  entrar:
    "Confere o usuário e a senha e conecta este aparelho. Depois, abre o painel da coordenação.",
  entrando:
    "Indisponível enquanto o usuário e a senha são conferidos. Espere um instante.",
  souCelula: "Volta para a entrada dos líderes, com o nome da célula.",
} as const satisfies DicasFormulario & Record<string, string>;

export const TEXTOS_ADMIN = {
  tituloSenha: "Entrar como administrador",
  explicacaoSenha:
    "Para o administrador: o usuário e a senha que você criou na tela Minha senha. Ainda não criou? Entre pelo seu link pessoal e crie lá.",
  rotuloNome: "Usuário",
  rotuloSenha: "Senha",
  faltaNome: "Escreva o usuário.",
  faltaSenha: "Escreva a senha.",
  recusada: "Usuário ou senha não conferem.",
  recusadaDetalhe:
    "Confira o usuário e a senha e tente de novo. Se esqueceu, entre pelo seu link pessoal e troque a senha em Minha senha.",
  muitasTentativas: "Muitas tentativas seguidas.",
  muitasTentativasDetalhe: "Espere um minuto e tente de novo.",
  falha: "Não foi possível entrar agora.",
  souCelula: "Sou líder de célula",
} as const satisfies TextosFormulario & Record<string, string>;

// RIFA-082 (D37): o discipulador entra com o nome dele e a mesma senha padrão das células. A regra da senha NUNCA
// aparece nas telas abertas (pedido do PO em 23/11): só na Hierarquia, para a coordenação.
export const DICAS_DISCIPULADOR = {
  nome: "Escreva o seu nome, como a coordenação cadastrou. Maiúsculas, acentos e espaços não fazem diferença.",
  senha:
    "A senha que a coordenação passou para você. Não sabe? Peça à coordenação.",
  entrar:
    "Confere o nome e a senha e conecta este aparelho. Depois, abre a página com as suas células.",
  entrando:
    "Indisponível enquanto o nome e a senha são conferidos. Espere um instante.",
  souDiscipulador:
    "Para o discipulador entrar com o nome dele e a senha que a coordenação passou, sem o link.",
} as const satisfies DicasFormulario & Record<string, string>;

export const TEXTOS_DISCIPULADOR = {
  tituloSenha: "Entrar como discipulador",
  explicacaoSenha:
    "Para discipuladores: o seu nome, como a coordenação cadastrou, e a senha que a coordenação passou.",
  rotuloNome: "Discipulador",
  rotuloSenha: "Senha",
  faltaNome: "Escreva o seu nome.",
  faltaSenha: "Escreva a senha.",
  recusada: "Nome ou senha não conferem.",
  recusadaDetalhe:
    "Confira o seu nome e a senha e tente de novo. Se não der certo, fale com a coordenação.",
  muitasTentativas: "Muitas tentativas seguidas.",
  muitasTentativasDetalhe: "Espere um minuto e tente de novo.",
  falha: "Não foi possível entrar agora.",
  souDiscipulador: "Sou discipulador",
} as const satisfies TextosFormulario & Record<string, string>;
