// afiliados (D7): affiliate_id da Rifei → célula. celula_id NULL = não vinculado (fila de órfãos).

/**
 * affiliate_id que chega no webhook e ainda não existe entra como não vinculado (origem 'webhook').
 * Se já existe (de outra venda ou pré-cadastrado pela coordenação), nada muda.
 */
export function prepararRegistroAfiliadoOrfao(
  db: D1Database,
  affiliateId: number,
  agora: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO afiliados (affiliate_id, origem, criado_em, atualizado_em)
       VALUES (?1, 'webhook', ?2, ?2)
       ON CONFLICT (affiliate_id) DO NOTHING`,
    )
    .bind(affiliateId, agora);
}
