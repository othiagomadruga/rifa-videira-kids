// Textos da Trilha: a ação em português (uma para cada ação de ACOES_AUDITORIA, conferida por
// trilha-contrato.test.ts) e o alvo legível ("usuario:3" → "Usuário 3").
import type { AcaoAuditoria, Papel } from "../../../shared/contracts";
import { ROTULO_PAPEL } from "../../lib/sessao";

export const ROTULO_ACAO: Record<AcaoAuditoria, string> = {
  "campanha.salvar": "Campanha salva",
  "afiliado.salvar": "Vínculo de afiliado salvo",
  "hierarquia.importar": "Hierarquia importada",
  "hierarquia.criar": "Item da hierarquia criado",
  "hierarquia.atualizar": "Item da hierarquia alterado",
  "hierarquia.remover": "Item da hierarquia removido",
  "usuario.criar": "Acesso criado",
  "usuario.ativar": "Acesso reativado",
  "usuario.desativar": "Acesso desativado",
  "link.criar": "Link de acesso gerado",
  "link.revogar": "Link de acesso revogado",
  "acessos_hierarquia.gerar_links": "Links da hierarquia gerados",
  "conferencia.recuperar": "Vendas recuperadas na conferência",
  // Sprint 6 (D20): desconsiderar e desfazer pedido (tela Pedidos) e remover afiliado (tela Adesão).
  "pedido.desconsiderar": "Pedido desconsiderado",
  "pedido.reconsiderar": "Pedido voltou a contar",
  "afiliado.remover": "Afiliado removido",
  // RIFA-039 (D21): o token do webhook gerado pela tela (aba Webhook da Rifei de Acessos; alvo `webhook`).
  "webhook.gerar_token": "Token do webhook gerado",
};

/** A ação em português; uma ação nova, que o site ainda não conhece, aparece como veio da API. */
export function rotuloDaAcao(acao: string): string {
  return Object.hasOwn(ROTULO_ACAO, acao)
    ? ROTULO_ACAO[acao as AcaoAuditoria]
    : acao;
}

/** Tipos de alvo (`<tipo>:<id>` ou só `<tipo>`) que a API grava hoje. */
const TIPO_DO_ALVO: Record<string, string> = {
  campanha: "Campanha",
  afiliado: "Afiliado",
  hierarquia: "Hierarquia",
  usuario: "Usuário",
  link: "Link",
  rede: "Rede",
  discipulador: "Discipulador",
  celula: "Célula",
  // D20: pedido.desconsiderar e pedido.reconsiderar (`pedido:<id>`, ou só `pedido` quando o id não cabe).
  pedido: "Pedido",
  // D21: webhook.gerar_token (ALVO_AUDITORIA_TOKEN_WEBHOOK, sem id: há um token só).
  webhook: "Webhook da Rifei",
};

/**
 * O alvo legível: "campanha:1" → "Campanha 1", "hierarquia" → "Hierarquia", "papel:lider" → "Papel: Líder".
 * Um tipo que o site não conhece aparece como veio da API.
 */
export function textoDoAlvo(alvo: string): string {
  const separador = alvo.indexOf(":");
  const tipo = separador < 0 ? alvo : alvo.slice(0, separador);
  const resto = separador < 0 ? "" : alvo.slice(separador + 1);
  if (tipo === "papel" && Object.hasOwn(ROTULO_PAPEL, resto)) {
    return `Papel: ${ROTULO_PAPEL[resto as Papel]}`;
  }
  if (!Object.hasOwn(TIPO_DO_ALVO, tipo)) return alvo;
  return resto ? `${TIPO_DO_ALVO[tipo]} ${resto}` : TIPO_DO_ALVO[tipo];
}

/** "1 registro" / "12 registros". */
export function registros(quantidade: number): string {
  return quantidade === 1 ? "1 registro" : `${quantidade} registros`;
}

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045): a explicação que aparece com o mouse parado (ou o foco do teclado) em cada botão da tela.
// Dizem para que serve e o que acontece, sem repetir o rótulo.
// ---------------------------------------------------------------------------------------------------

export const DICAS = {
  carregarMais: "Traz os registros mais antigos para o fim da lista.",
  carregando:
    "Indisponível enquanto a próxima parte da lista chega. Espere um instante.",
} as const;
