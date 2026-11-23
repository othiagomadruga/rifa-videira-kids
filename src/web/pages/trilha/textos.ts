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
  // RIFA-064 (D29): cada entrada de uma célula com a senha padrão (tela Entrar; alvo `celula:<id>`).
  "sessao.entrar_com_senha": "Célula entrou com a senha padrão",
  // RIFA-082 (D37): cada entrada de um discipulador com a senha padrão (tela Entrar; alvo `discipulador:<id>`).
  "sessao.entrar_com_senha_discipulador":
    "Discipulador entrou com a senha padrão",
  // RIFA-073 (D33): o admin entrou com usuário e senha (tela Entrar) e a senha dele (tela Minha senha).
  "sessao.entrar_como_admin": "Administrador entrou com usuário e senha",
  "senha_admin.definir": "Senha do administrador criada",
  "senha_admin.trocar": "Senha do administrador trocada",
  "senha_admin.remover": "Senha do administrador removida",
  // RIFA-070 (D32): a API da Rifei (Conferência do extrato e Adesão; alvo `campanha:<id>` ou `rifei`).
  "rifei.marcar_pagos": "Pedidos marcados como pagos na Rifei",
  "rifei.sincronizar_afiliados": "Afiliados sincronizados com a Rifei",
  "rifei.gerar_convites": "Convites de afiliado gerados na Rifei",
  // RIFA-070 (D32): a conexão com a Rifei pela tela (Acessos → Conexão com a Rifei; alvo `rifei`).
  "rifei.conectar": "Conexão com a Rifei salva",
  "rifei.desconectar": "Conexão com a Rifei apagada",
  // RIFA-076 (D36): a planilha de compradores baixada pelo admin (tela Pedidos; alvo `compradores`, sem os dados).
  "compradores.exportar": "Planilha de compradores baixada",
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
  // D32: rifei.sincronizar_afiliados e rifei.gerar_convites (ALVO_AUDITORIA_AFILIADOS_RIFEI, sem id).
  rifei: "Conta da Rifei",
  // D36: compradores.exportar (sem id).
  compradores: "Compradores",
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
