/**
 * Login do admin com usuário e senha (RIFA-073; docs/decisions.md D33). Pedido do PO (19/11): o pastor (admin) entra
 * no painel com usuário e senha, além do link pessoal. Só o papel admin tem essa senha; coordenação, líder,
 * discipulador e rede continuam como estão (link pessoal; a célula, também com a senha padrão da D29).
 *
 * - O admin define o usuário e a senha na tela "Minha senha" (/coordenacao/minha-senha), entrando antes pelo link.
 * - A senha nunca é gravada: o Worker guarda só o PBKDF2-SHA256 dela (sal aleatório por usuário, 100.000 iterações,
 *   o máximo que o Workers aceita), e nunca vai para log, trilha ou resposta.
 * - O login (POST /api/sessao/admin) tem o limite de tentativas por IP do POST /api/sessao e a MESMA recusa para
 *   tudo (usuário que não existe, senha errada, usuário desativado), sem dizer se o usuário existe.
 *
 * Sem zod, como login-celula.ts: o site importa daqui (os limites e a conferência do formulário) sem levar o zod. Os
 * schemas (com zod) ficam em acesso.ts.
 */

/** Mínimo de caracteres da senha do admin. */
export const MINIMO_SENHA_ADMIN = 10;
/** Máximo de caracteres da senha do admin (o PBKDF2 aceita mais; o teto só barra corpo absurdo). */
export const MAXIMO_SENHA_ADMIN = 128;

/** Tamanho do usuário de login do admin: de 3 a 40 caracteres. */
export const MINIMO_USUARIO_ADMIN = 3;
export const MAXIMO_USUARIO_ADMIN = 40;

/**
 * O usuário de login: minúsculas, dígitos, ponto, hífen e sublinhado, começando por letra ou dígito
 * ("pastor.joao", "admin2"). É gravado já em minúsculas (normalizarUsuarioAdmin) e é único entre os admins.
 */
export const FORMATO_USUARIO_ADMIN = /^[a-z0-9][a-z0-9._-]{2,39}$/;

/** Como o usuário é gravado e comparado: sem os espaços das pontas e em minúsculas ("Pastor.Joao " → "pastor.joao"). */
export function normalizarUsuarioAdmin(usuario: string): string {
  return usuario.trim().toLowerCase();
}

/** Tamanho máximo de cada campo do POST /api/sessao/admin: acima disso, 400 (nada a ver com o usuário existir). */
export const LIMITE_CAMPO_LOGIN_ADMIN = 200;

/** Os problemas da senha nova, na ordem em que a tela os mostra. */
export type ProblemaSenhaAdmin = "curta" | "longa" | "igual_ao_usuario";

/**
 * O que impede a senha nova (a tela e o Worker usam a mesma regra): menos de MINIMO_SENHA_ADMIN caracteres, mais de
 * MAXIMO_SENHA_ADMIN, ou igual ao usuário (sem diferença de maiúsculas). null = a senha serve.
 * Conta os caracteres como o usuário os vê (pontos de código, não unidades UTF-16: um emoji conta 1).
 */
export function problemaDaSenhaAdmin(
  senha: string,
  usuario: string,
): ProblemaSenhaAdmin | null {
  const tamanho = [...senha].length;
  if (tamanho < MINIMO_SENHA_ADMIN) return "curta";
  if (tamanho > MAXIMO_SENHA_ADMIN) return "longa";
  if (senha.trim().toLowerCase() === normalizarUsuarioAdmin(usuario))
    return "igual_ao_usuario";
  return null;
}

/** As mensagens de cada problema (a tela e o 400 do Worker). */
export const MENSAGEM_PROBLEMA_SENHA_ADMIN: Record<ProblemaSenhaAdmin, string> =
  {
    curta: `A senha precisa ter pelo menos ${MINIMO_SENHA_ADMIN} caracteres`,
    longa: `A senha pode ter no máximo ${MAXIMO_SENHA_ADMIN} caracteres`,
    igual_ao_usuario: "A senha não pode ser igual ao usuário",
  };

/** A mensagem do usuário fora do formato (a tela e o 400 do Worker). */
export const MENSAGEM_USUARIO_ADMIN_INVALIDO = `O usuário deve ter de ${MINIMO_USUARIO_ADMIN} a ${MAXIMO_USUARIO_ADMIN} caracteres: letras sem acento, números, ponto, hífen ou sublinhado, começando por letra ou número`;
