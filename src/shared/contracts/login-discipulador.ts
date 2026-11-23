/**
 * Login do discipulador com o nome e a senha padrão (RIFA-082; docs/decisions.md D37). Pedido do PO (23/11, no dia em
 * que a campanha começou): o discipulador também entra em /entrar, como a célula (D29), com o nome dele e a senha
 * "@" + nome normalizado + "1234" ("Pr. Fábio" → "@prfabio1234"). O que ele vê é a /minha dele: só números das células
 * dele (ranking, metas e links de vendas), nunca R$ (D12).
 *
 * A regra é a MESMA da célula (login-celula.ts): a mesma normalização, o mesmo "@" e "1234", e a senha digitada
 * comparada na mesma forma (formaDaSenhaDigitada). Como a da célula, ela não é segredo e não é gravada em lugar
 * nenhum: o Worker a deriva do nome do discipulador na hora e compara em tempo constante. Quem desliga é o admin, na
 * Campanha: o login só abre com `acesso.discipuladores` (o papel tem acesso, D20) E `acesso.celulas_senha` (o login
 * com senha padrão, D29) ligadas. Nenhuma chave nova.
 *
 * Sem zod, como login-celula.ts: o site importa daqui (a coordenação vê a senha de cada discipulador e o aviso de
 * nomes repetidos) sem levar o zod para o pacote.
 */
import {
  problemasDoLoginDasCelulas,
  senhaPadraoDaCelula,
} from "./login-celula";

/**
 * A senha padrão do discipulador: "@" + o nome normalizado (normalizarNomeLogin) + "1234" ("Fábio" →
 * "@fabio1234", "Pr. Fábio" → "@prfabio1234"). null quando o nome não tem letra nem dígito: esse discipulador não entra
 * por senha.
 */
export function senhaPadraoDoDiscipulador(nome: string): string | null {
  return senhaPadraoDaCelula(nome);
}

/**
 * O que impede um discipulador de entrar por senha, para o aviso da coordenação (tela Hierarquia), como o das células:
 * - `repetidas`: grupos de discipuladores com o mesmo nome normalizado ("Fábio" e "Fabio"): o login é ambíguo e é
 *   recusado para todos eles até a coordenação renomear um;
 * - `semSenha`: discipuladores cujo nome não tem letra nem dígito (senhaPadraoDoDiscipulador devolve null).
 * Na ordem em que vieram (dentro de cada grupo e entre os grupos, pelo primeiro de cada um). Os nomes das células não
 * entram na conta: a célula e o discipulador entram por rotas diferentes, e o mesmo nome nos dois não é ambíguo.
 */
export function problemasDoLoginDosDiscipuladores<T extends { nome: string }>(
  discipuladores: readonly T[],
): { repetidas: T[][]; semSenha: T[] } {
  return problemasDoLoginDasCelulas(discipuladores);
}
