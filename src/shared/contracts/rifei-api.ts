/**
 * Integração com a API interna do painel da Rifei (RIFA-070; docs/decisions.md D32; docs/integracao-rifei.md, seção
 * 13). A Rifei não tem API pública: o painel (app.rifei.com.br) fala com `https://api.rifei.com.br/` com o token do
 * login (`Authorization: Bearer`). O sistema usa o MESMO token, guardado como segredo do Worker (`RIFEI_API_TOKEN`),
 * para fazer pelo admin o que ele faria à mão no painel:
 * - marcar como pagos os pedidos que a Conferência do extrato achou (RIFA-059, D26);
 * - ler os afiliados da conta, ligar cada um à célula pelo e-mail do líder e guardar o código dele (o `ref` do link de
 *   vendas);
 * - gerar o convite de afiliado de cada célula (uso único, vale 1 dia, a Rifei não deixa criar a conta do afiliado).
 *
 * Nada aqui roda sozinho: cada chamada parte de um clique do admin, e o caminho manual continua valendo.
 *
 * Sem zod, como token-webhook.ts: o site importa daqui (os limites, os resultados e os textos) sem levar o zod para o
 * pacote. Os schemas e o catálogo das rotas (ROTAS_RIFEI_API) ficam em api.ts.
 */

/** O segredo do Worker com o token do login na Rifei (`wrangler secret put RIFEI_API_TOKEN`). */
export const SEGREDO_API_RIFEI = "RIFEI_API_TOKEN";

/** O `alvo` da trilha nas ações dos afiliados da Rifei (sem id: é a conta inteira). */
export const ALVO_AUDITORIA_AFILIADOS_RIFEI = "rifei";

/** O endereço da API do painel da Rifei (o `baseURL` do próprio painel). */
export const URL_API_RIFEI = "https://api.rifei.com.br/";

/** Pedidos por clique em "Marcar como pago na Rifei": uma chamada por pedido, para saber o resultado de cada um. */
export const LIMITE_PEDIDOS_MARCAR_NA_RIFEI = 100;

/** Células por clique em "Gerar convites": uma chamada por convite. */
export const LIMITE_CONVITES_RIFEI = 50;

/** Tempo máximo de cada chamada à Rifei. */
export const TEMPO_LIMITE_API_RIFEI_MS = 10_000;

/** Tamanho máximo da mensagem da Rifei repassada à tela (é texto da Rifei, nunca dado do comprador). */
export const LIMITE_MENSAGEM_RIFEI = 300;

/**
 * O que aconteceu com cada pedido em "Marcar como pago na Rifei":
 * - marcado: a Rifei aprovou o pedido; ele passa a contar quando o "Pedido pago" chegar pelo webhook;
 * - restaurado_e_marcado: o pedido tinha expirado na Rifei; foi restaurado e aprovado;
 * - ja_pago: no sistema ele já está pago (nada foi pedido à Rifei);
 * - desconsiderado: desconsiderado no sistema (D20): nunca é marcado daqui;
 * - fora_do_sistema: o número não é de um pedido da campanha ativa;
 * - recusado_pela_rifei: a Rifei respondeu que não dá (a mensagem dela vai junto): marque à mão no painel;
 * - falhou: a Rifei não respondeu a tempo ou deu erro: tente de novo ou marque à mão.
 */
export const RESULTADOS_MARCAR_NA_RIFEI = [
  "marcado",
  "restaurado_e_marcado",
  "ja_pago",
  "desconsiderado",
  "fora_do_sistema",
  "recusado_pela_rifei",
  "falhou",
] as const;
export type ResultadoMarcarNaRifei =
  (typeof RESULTADOS_MARCAR_NA_RIFEI)[number];

/** Os resultados em que a Rifei aprovou o pedido. */
export const RESULTADOS_MARCADOS_NA_RIFEI: readonly ResultadoMarcarNaRifei[] = [
  "marcado",
  "restaurado_e_marcado",
];

/**
 * Por que a chamada inteira à Rifei falhou (os `detalhes` do 502 `rifei_falhou`):
 * - token_invalido: a Rifei recusou o token (401/403): o login expirou ou alguém clicou em "Sair" na Rifei com ele;
 * - campanha_nao_encontrada: o slug da campanha ativa não é uma campanha desta conta na Rifei;
 * - indisponivel: a Rifei não respondeu, respondeu 5xx ou limitou as chamadas (429);
 * - resposta_inesperada: a Rifei respondeu num formato que o sistema não conhece (a API interna mudou?).
 */
export const MOTIVOS_FALHA_RIFEI = [
  "token_invalido",
  "campanha_nao_encontrada",
  "indisponivel",
  "resposta_inesperada",
] as const;
export type MotivoFalhaRifei = (typeof MOTIVOS_FALHA_RIFEI)[number];

/** A mensagem de cada motivo, para a API e para a tela. */
export const MENSAGEM_FALHA_RIFEI: Record<MotivoFalhaRifei, string> = {
  token_invalido:
    "A Rifei recusou o token: cole um novo em Conexão com a Rifei (Acessos → Conexão com a Rifei).",
  campanha_nao_encontrada:
    "A campanha do sistema não foi achada na conta da Rifei: confira o slug da campanha.",
  indisponivel:
    "A Rifei não respondeu agora. Tente de novo em alguns minutos ou faça no painel da Rifei.",
  resposta_inesperada:
    "A Rifei respondeu de um jeito que o sistema não conhece. Faça no painel da Rifei e avise o suporte do sistema.",
};

/**
 * O convite de afiliado gerado por célula: comissão zero e todas as campanhas da conta (a venda de um líder não rende
 * comissão; o que importa é a venda contar para a célula). É o corpo do POST `affiliates` do painel.
 */
export const CONVITE_AFILIADO_RIFEI = {
  commission_type: "percentage",
  commission_value: 0,
  products_type: "all",
  products: [],
} as const;

/** O segredo do Worker conta como configurado quando existe e não é só espaço. */
export function apiRifeiConfigurada(valor: string | undefined): boolean {
  return valor !== undefined && valor.trim() !== "";
}

/** E-mail para comparar (o do afiliado na Rifei com o do líder no sistema): sem espaços nas pontas, minúsculo. */
export function emailParaComparar(
  email: string | null | undefined,
): string | null {
  if (typeof email !== "string") return null;
  const limpo = email.trim().toLowerCase();
  return limpo.includes("@") ? limpo : null;
}

/** O link do convite de afiliado só sai da API se for da Rifei: `https:` em rifei.com.br ou num subdomínio dele. */
export function eLinkDeConviteRifei(texto: string): boolean {
  try {
    const url = new URL(texto);
    return (
      url.protocol === "https:" &&
      (url.hostname === "rifei.com.br" ||
        url.hostname.endsWith(".rifei.com.br")) &&
      url.username === "" &&
      url.password === "" &&
      url.port === ""
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------
// Conexão com a Rifei pela tela (RIFA-070, D32): o admin cola o token do login na Rifei no painel (sem terminal).
// O token fica no D1 CIFRADO (AES-GCM com a chave do segredo do Worker RIFEI_CHAVE_CIFRA) e nunca volta ao
// navegador, ao log ou à trilha: a tela vê só desde quando e os 4 últimos caracteres.
// ---------------------------------------------------------------------------------------------------

/** O segredo do Worker com a chave que cifra o token no D1 (`openssl rand -base64 32`; ao menos 32 caracteres). */
export const SEGREDO_CHAVE_CIFRA_RIFEI = "RIFEI_CHAVE_CIFRA";

/** Tamanho mínimo da chave (o segredo RIFEI_CHAVE_CIFRA): menor que isso conta como não configurada. */
export const MINIMO_CARACTERES_CHAVE_CIFRA_RIFEI = 32;

/**
 * De onde vem o token que o sistema usa na Rifei:
 * - tela: o colado em Conexão com a Rifei (no D1, cifrado); tem prioridade;
 * - segredo: o segredo do Worker RIFEI_API_TOKEN (pelo terminal), só quando não há token da tela.
 */
export const ORIGENS_TOKEN_RIFEI = ["tela", "segredo"] as const;
export type OrigemTokenRifei = (typeof ORIGENS_TOKEN_RIFEI)[number];

/** Quantos caracteres do fim do token a tela mostra ("termina em …abcd"). */
export const CARACTERES_FINAL_TOKEN_RIFEI = 4;

/** Limites do token colado (o token do login da Rifei é um texto longo, sem espaços). */
export const MINIMO_CARACTERES_TOKEN_RIFEI = 20;
export const LIMITE_CARACTERES_TOKEN_RIFEI = 4096;

/** O `alvo` da trilha nas ações da conexão (rifei.conectar e rifei.desconectar). */
export const ALVO_AUDITORIA_CONEXAO_RIFEI = "rifei";

/**
 * O token como o sistema guarda: sem espaços nas pontas, sem aspas em volta (o `copy()` do console às vezes as
 * traz) e sem o "Bearer " na frente. Null se não parece um token: curto, longo demais ou com espaço/controle no meio.
 */
export function limparTokenRifei(texto: string): string | null {
  let token = texto.trim();
  if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, "");
  if (
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")))
  )
    token = token.slice(1, -1).trim();
  if (
    token.length < MINIMO_CARACTERES_TOKEN_RIFEI ||
    token.length > LIMITE_CARACTERES_TOKEN_RIFEI
  )
    return null;
  // Só ASCII visível (o token do login é JWT ou parecido): nada de espaço, quebra de linha ou caractere invisível.
  if (!/^[\x21-\x7e]+$/.test(token)) return null;
  return token;
}

/** Os últimos caracteres do token, para a tela ("…abcd"). */
export function finalDoTokenRifei(token: string): string {
  return token.slice(-CARACTERES_FINAL_TOKEN_RIFEI);
}

/** A chave de cifra conta como configurada com ao menos MINIMO_CARACTERES_CHAVE_CIFRA_RIFEI caracteres. */
export function chaveCifraRifeiConfigurada(valor: string | undefined): boolean {
  return (
    valor !== undefined &&
    valor.trim().length >= MINIMO_CARACTERES_CHAVE_CIFRA_RIFEI
  );
}

// ---------------------------------------------------------------------------------------------------
// Marcar à mão (RIFA-070, D32): o admin digita o número do pedido ou de um bilhete e o sistema acha o pedido.
// ---------------------------------------------------------------------------------------------------

/** Tamanho máximo do que se digita no campo "Número do pedido ou do bilhete". */
export const LIMITE_CARACTERES_BUSCA_PEDIDO_RIFEI = 128;

/** Quantos pedidos a busca devolve no máximo (um bilhete pode estar num pedido expirado e num novo). */
export const LIMITE_PEDIDOS_BUSCA_RIFEI = 10;

/** Como o pedido foi achado: pelo número do pedido ou por um bilhete dele. */
export const ACHADO_POR_BUSCA_RIFEI = ["pedido", "bilhete"] as const;
export type AchadoPorBuscaRifei = (typeof ACHADO_POR_BUSCA_RIFEI)[number];

/** O número de bilhete digitado (só dígitos, zeros à esquerda aceitos: "0042" = 42), ou null se não é um. */
export function numeroDeBilhete(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,9}$/.test(limpo)) return null;
  return Number(limpo);
}

/**
 * A validade que o próprio token traz, se ele for um JWT com `exp` (segundos desde 1970), como instante ISO; null se
 * não for JWT, não tiver `exp` ou o `exp` for inválido. Só lê o meio do token (não confere a assinatura).
 */
export function expiracaoDoTokenRifei(token: string): string | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const base64 = partes[1].replaceAll("-", "+").replaceAll("_", "/");
    const conteudo = JSON.parse(
      atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)),
    ) as unknown;
    const exp =
      conteudo && typeof conteudo === "object"
        ? (conteudo as Record<string, unknown>).exp
        : undefined;
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0)
      return null;
    const data = new Date(exp * 1000);
    return Number.isNaN(data.getTime()) ? null : data.toISOString();
  } catch {
    return null;
  }
}
