// Campanha ativa (no máximo uma: índice parcial campanhas_uma_ativa). O webhook só processa
// eventos cujo slug é o slug_rifei dela (D5).

export interface CampanhaAtiva {
  id: number;
  slug_rifei: string;
}

export async function buscarCampanhaAtiva(
  db: D1Database,
): Promise<CampanhaAtiva | null> {
  return db
    .prepare("SELECT id, slug_rifei FROM campanhas WHERE ativa = 1 LIMIT 1")
    .first<CampanhaAtiva>();
}
