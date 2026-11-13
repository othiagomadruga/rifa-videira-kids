import type { Alvo } from "../../../shared/contracts/dominio";
import { NOMES_DIVISAO } from "../../../shared/contracts/calculos";
import {
  Esqueleto,
  PageHeader,
  type BlocoEsqueleto,
} from "../../components/ui";
import "./minha-moldura.css";

/** Tipo do alvo para mostrar ao lado do nome. */
const ROTULO_DO_ALVO: Record<Alvo["tipo"], string> = {
  celula: "Célula",
  discipulador: "Discipulador",
  rede: "Rede",
};

/** "Célula · Jovens". */
export function descricaoDoAlvo(alvo: Pick<Alvo, "tipo" | "divisao">): string {
  return `${ROTULO_DO_ALVO[alvo.tipo]} · ${NOMES_DIVISAO[alvo.divisao]}`;
}

// O cabeçalho da visão individual: o alvo (o <h1> e o título da aba), o tipo e a divisão dele e quem entrou.
// Fica no pacote principal (é o que aparece enquanto o resto da tela carrega).
export function Cabecalho({
  alvo,
  nome,
}: {
  alvo: Alvo | null;
  /** Quem entrou (o nome do usuário da sessão). */
  nome: string;
}) {
  return (
    <PageHeader
      titulo={alvo?.nome ?? "Sua visão da campanha"}
      descricao={
        <>
          {alvo && (
            <span className="minha-cabecalho__alvo">
              {descricaoDoAlvo(alvo)}
            </span>
          )}{" "}
          <span className="minha-cabecalho__pessoa">
            Você entrou como <strong>{nome}</strong>.
          </span>
        </>
      }
    />
  );
}

/** O que o leitor de tela ouve enquanto os números chegam (o resto do esqueleto é só visual). */
export const TEXTO_CARREGANDO_VISAO = "Carregando os seus números…";

// Os blocos do esqueleto, de cima para baixo, no tamanho do que vem (medido na captura a 390 px, RIFA-051: o
// destaque com 503 px e o período com 266 px; no computador, o destaque tem ~480 px e o período estica até ele). Entre
// os blocos, o mesmo espaço dos cartões (--espaco-3).
// O destaque: a fase (2 linhas no celular), "Meta da campanha", o número grande, a barra, a situação, a projeção e a
// meta de hoje. O número tem a altura do número grande (o mesmo clamp do font-size em minha.css, line-height 1: cresce
// com a tela); a fase, a situação e a projeção cabem numa linha a menos no computador (as variáveis vêm de
// minha-moldura.css, a partir de 64rem; a medida do celular é a reserva). Revisão da RIFA-051: antes, o esqueleto
// ficava ~40 px mais alto que o destaque no computador.
const BLOCOS_DO_DESTAQUE: readonly BlocoEsqueleto[] = [
  { altura: "var(--minha-esqueleto-fase, 2.625rem)", largura: "90%" },
  { altura: "1.375rem", largura: "50%" },
  {
    altura: "clamp(var(--texto-4xl), 1.5rem + 6vw, calc(2 * var(--texto-4xl)))",
    largura: "55%",
  },
  { altura: "2.75rem" },
  { altura: "var(--minha-esqueleto-situacao, 5.25rem)" },
  { altura: "var(--minha-esqueleto-projecao, 2.625rem)", largura: "85%" },
  { altura: "7.125rem" },
];
// O período atual: o título, o dia dentro dele, a situação, a barra e os vendidos no período.
const BLOCOS_DO_PERIODO: readonly BlocoEsqueleto[] = [
  { altura: "1.375rem", largura: "40%" },
  { altura: "1.25rem", largura: "55%" },
  { altura: "5rem" },
  { altura: "2.75rem" },
  { altura: "1.25rem", largura: "60%" },
];

// O carregando da visão (RIFA-051, A-17): no lugar dos dois cartões de cima (o destaque, com a borda roxa, e o
// período), os blocos do tamanho do que vem, em vez de uma linha de texto; o leitor de tela continua ouvindo
// "Carregando os seus números…" (um anúncio só: o segundo esqueleto fica calado). Fica no pacote principal, como o
// cabeçalho: aparece enquanto o pacote da visão chega (MinhaPage) e enquanto os números chegam (VisaoIndividual).
export function EsqueletoDaVisao() {
  return (
    <div className="minha-moldura__esqueleto">
      <Esqueleto
        cartao
        className="minha-moldura__esqueleto-destaque"
        blocos={BLOCOS_DO_DESTAQUE}
        texto={TEXTO_CARREGANDO_VISAO}
      />
      <Esqueleto cartao blocos={BLOCOS_DO_PERIODO} texto={null} />
    </div>
  );
}
