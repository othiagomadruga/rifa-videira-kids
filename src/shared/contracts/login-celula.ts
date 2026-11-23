/**
 * Login da célula com a senha padrão (RIFA-064; docs/decisions.md D29). Pedido do PO (17/11): cada célula entra com
 * o nome dela e a senha padrão "@" + nome da célula + "1234" (ex.: "@celula1234"). O máximo que se vê é o que o
 * líder vê na /minha: o ranking, a meta e o link e o QR de vendas da célula, nunca R$ (D12).
 *
 * A senha NÃO é segredo: quem conhece a regra e o nome de uma célula (que aparece no ranking aberto) entra como ela.
 * Por isso ela não é gravada em lugar nenhum: o Worker a deriva do nome da célula na hora e compara em tempo
 * constante. Quem desliga é o admin, na Campanha (`acesso.celulas_senha`, regras.ts).
 *
 * Sem zod, como regras.ts: o site importa daqui (a coordenação vê a senha de cada célula e o aviso de nomes
 * repetidos) sem levar o zod para o pacote.
 */

/** Começo da senha padrão. */
export const PREFIXO_SENHA_CELULA = "@";
/** Fim da senha padrão. */
export const SUFIXO_SENHA_CELULA = "1234";

/**
 * O nome da célula como o login compara: minúsculas, sem acentos, sem espaços e sem pontuação (só sobram as letras
 * de a a z e os dígitos). "Geração que Clama" → "geracaoqueclama"; "Kairós1" → "kairos1"; "Pão Vivo" → "paovivo".
 * Vale para o nome gravado na hierarquia e para o que a pessoa digita no campo "Célula": maiúsculas, acentos e
 * espaços a mais não atrapalham.
 */
export function normalizarNomeCelula(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * A mesma normalização com o nome de quem a usa fora da célula: o login do discipulador (RIFA-082, D37;
 * login-discipulador.ts) compara o nome dele exatamente assim.
 */
export const normalizarNomeLogin = normalizarNomeCelula;

/**
 * A senha padrão da célula: "@" + o nome normalizado + "1234" ("Geração que Clama" → "@geracaoqueclama1234"). null
 * quando o nome não tem letra nem dígito (nada sobra na normalização): essa célula não entra por senha.
 */
export function senhaPadraoDaCelula(nome: string): string | null {
  const normalizado = normalizarNomeCelula(nome);
  return normalizado === ""
    ? null
    : `${PREFIXO_SENHA_CELULA}${normalizado}${SUFIXO_SENHA_CELULA}`;
}

/**
 * A senha digitada na forma em que é comparada: sem os espaços das pontas, o "@" do começo obrigatório e o resto
 * normalizado como o nome (o teclado do celular que põe maiúscula, um acento ou um espaço não atrapalha:
 * "@Geração que Clama 1234" vale). Sem o "@" do começo, devolve "" (nunca confere).
 */
export function formaDaSenhaDigitada(senha: string): string {
  const texto = senha.trim();
  return texto.startsWith(PREFIXO_SENHA_CELULA)
    ? `${PREFIXO_SENHA_CELULA}${normalizarNomeCelula(texto.slice(PREFIXO_SENHA_CELULA.length))}`
    : "";
}

/**
 * O que impede uma célula de entrar por senha, para o aviso da coordenação (tela Hierarquia):
 * - `repetidas`: grupos de células com o mesmo nome normalizado ("Pão Vivo" e "Pao Vivo"): o login é ambíguo e é
 *   recusado para todas elas até a coordenação renomear uma;
 * - `semSenha`: células cujo nome não tem letra nem dígito (senhaPadraoDaCelula devolve null).
 * Na ordem em que vieram (dentro de cada grupo e entre os grupos, pela primeira de cada um).
 */
export function problemasDoLoginDasCelulas<T extends { nome: string }>(
  celulas: readonly T[],
): { repetidas: T[][]; semSenha: T[] } {
  const porNome = new Map<string, T[]>();
  const semSenha: T[] = [];
  for (const celula of celulas) {
    const normalizado = normalizarNomeCelula(celula.nome);
    if (normalizado === "") {
      semSenha.push(celula);
      continue;
    }
    const grupo = porNome.get(normalizado);
    if (grupo === undefined) porNome.set(normalizado, [celula]);
    else grupo.push(celula);
  }
  return {
    repetidas: [...porNome.values()].filter((grupo) => grupo.length > 1),
    semSenha,
  };
}
