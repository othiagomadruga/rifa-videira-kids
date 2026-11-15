import { Esqueleto, type BlocoEsqueleto } from "../../components/ui";

// O carregando da Visão geral (RIFA-053, D25): no lugar do painel, os blocos no tamanho do que vem (a referência, os
// três cartões e a curva), em vez de uma linha de texto. Medidas da captura (dados da demonstração, "Dia 12 de 24"), a
// 390 e a 1366 px: o cartão Hoje com 214 px no celular, a Campanha com 506 e a Semana com 325; no computador, os três
// esticam até a altura da Campanha (546 px), que tem o rótulo da barra em 2 linhas. A curva tem 403 px no celular e
// 499 no computador. O que muda no computador vem de variáveis (visao-geral.css, a partir de 64rem); a medida do
// celular é a reserva. O leitor de tela ouve um carregando só ("Carregando o painel…").

// A referência: o recorte, a fase (2 linhas no celular) e o detalhe.
const REFERENCIA: readonly BlocoEsqueleto[] = [
  { altura: "1.25rem", largura: "45%" },
  { altura: "var(--visao-esqueleto-fase, 3.3rem)", largura: "85%" },
  { altura: "1.125rem", largura: "60%" },
];
// Hoje: o título, o rótulo e o número da meta de hoje, a nota e o vendido hoje.
const HOJE: readonly BlocoEsqueleto[] = [
  { altura: "1.375rem", largura: "40%" },
  { altura: "1rem", largura: "30%" },
  { altura: "2.75rem", largura: "55%" },
  { altura: "1.9rem", largura: "90%" },
  { altura: "1.25rem", largura: "70%" },
];
// Campanha: o título, o subtítulo, a situação, a barra e os dados (esperado, ritmo, projeção e vendas).
const CAMPANHA: readonly BlocoEsqueleto[] = [
  { altura: "1.375rem", largura: "45%" },
  { altura: "1.25rem", largura: "55%" },
  { altura: "5.25rem" },
  { altura: "var(--visao-esqueleto-barra, 2.75rem)" },
  { altura: "15.85rem", largura: "90%" },
];
// O período: o título, o dia dentro dele, a situação, o esperado × realizado, a barra e o ritmo.
const PERIODO: readonly BlocoEsqueleto[] = [
  { altura: "1.375rem", largura: "40%" },
  { altura: "1.25rem", largura: "60%" },
  { altura: "5.25rem" },
  { altura: "2.625rem", largura: "85%" },
  { altura: "var(--visao-esqueleto-barra, 2.75rem)" },
  { altura: "1.25rem", largura: "80%" },
];
// A curva: o título, o subtítulo, a legenda, o gráfico e o "Ver os dados em tabela".
const CURVA: readonly BlocoEsqueleto[] = [
  { altura: "1.375rem", largura: "50%" },
  { altura: "1.25rem", largura: "45%" },
  { altura: "1.25rem", largura: "50%" },
  { altura: "var(--visao-esqueleto-grafico, 14.66rem)" },
  { altura: "1.5rem", largura: "35%" },
];

export function EsqueletoDoPainel() {
  return (
    <div className="visao-painel visao-esqueleto">
      <Esqueleto
        className="visao-esqueleto__referencia"
        blocos={REFERENCIA}
        texto="Carregando o painel…"
      />
      <div className="visao-cartoes">
        <Esqueleto cartao blocos={HOJE} texto={null} />
        <Esqueleto cartao blocos={CAMPANHA} texto={null} />
        <Esqueleto cartao blocos={PERIODO} texto={null} />
      </div>
      <Esqueleto cartao blocos={CURVA} texto={null} />
    </div>
  );
}
