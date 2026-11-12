/**
 * A ordem das listas pela hierarquia (rede → discipulador → célula ou alvo), em português: a dos acessos da hierarquia
 * (db/acessos-hierarquia.ts, RIFA-014) e a dos links de vendas (lib/links-vendas.ts, RIFA-046, D24). Puro, sem banco.
 */

/**
 * Nomes em português, como no ranking: sem diferenciar acentos e maiúsculas, "Célula 2" antes de "Célula 10".
 * (O COLLATE NOCASE do SQLite só ignora maiúsculas ASCII e poria "Célula Ágape" depois de "Célula Betel".)
 */
const ordemDosNomes = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  numeric: true,
});

/** Um nível do caminho: pelo nome, em português; empate de nome, pelo id. Null conta como vazio (e id 0). */
export function compararNivel(
  nomeA: string | null,
  idA: number | null,
  nomeB: string | null,
  idB: number | null,
): number {
  return (
    ordemDosNomes.compare(nomeA ?? "", nomeB ?? "") || (idA ?? 0) - (idB ?? 0)
  );
}
