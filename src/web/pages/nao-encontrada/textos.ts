// Dicas (RIFA-045) da página não encontrada: o "Voltar ao início" diz para onde leva, conforme a área em que a pessoa
// está (as telas abertas, a coordenação ou a visão individual).

export const DICAS = {
  /** Pelo `inicio` da página; `outro`, para um endereço fora destes. */
  voltarAoInicio: {
    "/": "Abre a página inicial do site, com o ranking da campanha.",
    "/coordenacao": "Abre a Visão geral, a primeira tela da coordenação.",
    "/minha": "Abre a sua visão da campanha, com os seus números.",
    outro: "Sai deste endereço e abre a primeira tela da sua área.",
  },
} as const;

/** A dica do "Voltar ao início" para o `inicio` da página. */
export function dicaVoltarAoInicio(inicio: string): string {
  const { voltarAoInicio } = DICAS;
  return inicio === "/" || inicio === "/coordenacao" || inicio === "/minha"
    ? voltarAoInicio[inicio]
    : voltarAoInicio.outro;
}
