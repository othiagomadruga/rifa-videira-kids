// Tipos das ações de vínculo da tela de adesão (vincular, trocar, desvincular e pré-cadastro).

/** Onde a pessoa estava quando salvou: o aviso de sucesso aparece ali, perto do foco. */
export type LocalDoAviso =
  | {
      secao: "sem-celula";
      /**
       * O aviso ocupa o lugar do cartão que saiu da fila: antes deste órfão (o que vinha logo abaixo) ou,
       * com null, no fim da fila.
       */
      antesDe: number | null;
    }
  | { secao: "celula"; celulaId: number };

export type AvisoDeSucesso = { texto: string; local: LocalDoAviso };

/**
 * Salva o vínculo e, se der certo, mostra `sucesso` em `local` (e anuncia ao leitor de tela). Se falhar,
 * lança o erro (ErroApi), para o formulário mostrar.
 */
export type AoSalvarVinculo = (pedido: {
  affiliateId: number;
  /** null desvincula. */
  celulaId: number | null;
  sucesso: string;
  local: LocalDoAviso;
}) => Promise<void>;

/**
 * Remove o afiliado de teste (só admin; RIFA-031) e, se der certo, mostra `sucesso` em `local`. Se falhar, lança o
 * erro (ErroApi: o 409 `afiliado_com_pedidos` traz os pedidos que ainda contam), para o diálogo mostrar.
 */
export type AoRemoverAfiliado = (pedido: {
  affiliateId: number;
  sucesso: string;
  local: LocalDoAviso;
}) => Promise<void>;

/** Texto do aviso, se ele é da seção "Sem célula". */
export function avisoDaFila(aviso: AvisoDeSucesso | null): string | null {
  return aviso?.local.secao === "sem-celula" ? aviso.texto : null;
}

/** Texto do aviso, se ele é do cartão desta célula. */
export function avisoDaCelula(
  aviso: AvisoDeSucesso | null,
  celulaId: number,
): string | null {
  return aviso?.local.secao === "celula" && aviso.local.celulaId === celulaId
    ? aviso.texto
    : null;
}
