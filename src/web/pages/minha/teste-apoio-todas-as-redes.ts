// Apoio dos testes do ranking geral (RIFA-090) na /minha: a resposta de GET /api/minha/todas-as-redes para o alvo e a
// janela pedidos, passada pelo schema estrito do contrato. Nomes fictícios. Só dos testes (fora do pacote do site:
// guarda-minha.test.ts não o trata como código da tela).
//
// 12 discipuladores e 14 células (mais que as 10 linhas de cada lista, para o "Ver todas"). O Davi (o discipulador dos
// testes) é o 3º na semana; as células dele são a Ágape (2ª), a Betel (5ª) e a Canaã (13ª, abaixo do corte). A rede dos
// testes (Rede Jovem Fictícia) tem o Davi, a Ester e o Helio. Na campanha toda, a ordem dos dois primeiros se inverte.
import {
  respostaTodasAsRedesSchema,
  type Alvo,
  type RespostaTodasAsRedes,
} from "../../../shared/contracts";
import { JANELAS_DOS_COMPRADORES, REFERENCIAS } from "./teste-apoio";

/** [nome, % da meta em pontos-base (null = sem meta), bilhetes]. */
type LinhaDiscipulador = [string, number | null, number];
/** [nome, discipulador, % da meta em pontos-base (null = sem meta), bilhetes]. */
type LinhaCelula = [string, string, number | null, number];

/** Na ordem do ranking da semana. Natã e Otávio empatam (9º e 9º). */
const DISCIPULADORES: LinhaDiscipulador[] = [
  ["Ester Fictícia", 8200, 120],
  ["Gabriel Fictício", 7500, 98],
  ["Davi Fictício", 6400, 87],
  ["Helio Fictício", 6000, 70],
  ["Isaque Fictício", 5500, 66],
  ["Joana Fictícia", 5000, 61],
  ["Lucas Fictício", 4100, 50],
  ["Marta Fictícia", 3800, 47],
  ["Natã Fictício", 3000, 33],
  ["Otávio Fictício", 3000, 31],
  ["Paula Fictícia", 2200, 20],
  ["Rute Fictícia", 0, 0],
];

const CELULAS: LinhaCelula[] = [
  ["Célula Siloé", "Ester Fictícia", 9500, 40],
  ["Célula Ágape", "Davi Fictício", 8800, 44],
  ["Célula Hebrom", "Gabriel Fictício", 8000, 38],
  ["Célula Moriá", "Ester Fictícia", 7700, 31],
  ["Célula Betel", "Davi Fictício", 7000, 28],
  ["Célula Sião", "Helio Fictício", 6600, 26],
  ["Célula Jope", "Isaque Fictício", 6000, 25],
  ["Célula Efrata", "Joana Fictícia", 5200, 22],
  ["Célula Gileade", "Lucas Fictício", 4500, 20],
  ["Célula Sarom", "Marta Fictícia", 4000, 17],
  ["Célula Tabor", "Natã Fictício", 3100, 13],
  ["Célula Carmelo", "Otávio Fictício", 2800, 11],
  ["Célula Canaã", "Davi Fictício", 1200, 6],
  ["Célula Elim", "Rute Fictícia", null, 0],
];

/** Os discipuladores da rede dos testes (para o `eu` da rede). */
const DA_REDE = new Set(["Davi Fictício", "Ester Fictícia", "Helio Fictício"]);

/** Posições do ranking: empates (o mesmo %) dividem a posição (1, 1, 3). */
function posicoes(percentuais: readonly (number | null)[]): number[] {
  return percentuais.map((percentual, indice) => {
    let primeiro = indice;
    while (primeiro > 0 && percentuais[primeiro - 1] === percentual)
      primeiro -= 1;
    return primeiro + 1;
  });
}

/** Na campanha toda, os dois primeiros trocam de lugar (os números ficam na ordem) e os bilhetes triplicam. */
function naJanela<T extends unknown[]>(
  linhas: readonly T[],
  janela: string,
  quem: number,
): T[] {
  const copia = linhas.map((linha) => [...linha] as T);
  if (janela === "campanha" && copia.length >= 2) {
    const [primeira, segunda] = copia;
    const trocados = primeira.slice(0, quem);
    primeira.splice(0, quem, ...segunda.slice(0, quem));
    segunda.splice(0, quem, ...trocados);
  }
  return copia;
}

export type OpcoesTodasAsRedes = {
  /** Nenhuma célula na campanha: as duas listas vazias. */
  vazia?: boolean;
};

/** A resposta de GET /api/minha/todas-as-redes na janela pedida, para o alvo (o `eu`), passada pelo schema. */
export function todasAsRedesDe(
  janela: string,
  alvo: Alvo,
  { vazia = false }: OpcoesTodasAsRedes = {},
): RespostaTodasAsRedes {
  const campanha = janela === "campanha";
  const multiplicador = campanha ? 3 : 1;
  const discipuladores = vazia ? [] : naJanela(DISCIPULADORES, janela, 1);
  const celulas = vazia ? [] : naJanela(CELULAS, janela, 2);
  const minhaLinha = (nome: string) =>
    alvo.tipo === "rede" ? DA_REDE.has(nome) : nome === alvo.nome;
  const posicoesDisc = posicoes(discipuladores.map((linha) => linha[1]));
  const posicoesCel = posicoes(celulas.map((linha) => linha[2]));
  return respostaTodasAsRedesSchema.parse({
    janela: campanha
      ? JANELAS_DOS_COMPRADORES.campanha
      : JANELAS_DOS_COMPRADORES.atual,
    criterio: "percentual_meta",
    referencia: REFERENCIAS.durante,
    discipuladores: discipuladores.map(
      ([nome, percentual, bilhetes], indice) => ({
        posicao: posicoesDisc[indice],
        nome,
        percentual_meta_bp: percentual,
        bilhetes: bilhetes * multiplicador,
        eu: minhaLinha(nome),
      }),
    ),
    celulas: celulas.map(
      ([nome, discipulador, percentual, bilhetes], indice) => ({
        posicao: posicoesCel[indice],
        nome,
        discipulador,
        percentual_meta_bp: percentual,
        bilhetes: bilhetes * multiplicador,
        eu: minhaLinha(discipulador),
      }),
    ),
    atualizado_em: "2026-12-04T15:00:00.000Z",
  });
}
