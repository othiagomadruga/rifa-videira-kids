import { juntarClasses } from "./classes";
import "./Esqueleto.css";

/** Um bloco do esqueleto: a altura (e a largura) do que vem, em medidas do CSS (ex.: "8rem", "40%"). */
export type BlocoEsqueleto = {
  altura: string;
  /** Padrão: a largura toda. */
  largura?: string;
};

type Props = {
  /** Os blocos, de cima para baixo, cada um no tamanho do conteúdo que vai chegar (nada pula quando ele chega). */
  blocos: readonly BlocoEsqueleto[];
  /**
   * O que o leitor de tela ouve (role="status", escondido só da vista). Padrão: "Carregando…". Passe null quando
   * outro esqueleto (ou um Loading) da mesma tela já anuncia: um anúncio por tela.
   */
  texto?: string | null;
  /** Os blocos dentro de um cartão (a superfície, a borda e o raio do Card). */
  cartao?: boolean;
  className?: string;
};

// Esqueleto do carregando (RIFA-049, D25): blocos no tamanho do que vem, com o brilho que passa (só sem
// prefers-reduced-motion; tema/movimento.css), em vez de uma linha de texto. Os blocos são só visuais (aria-hidden);
// o leitor de tela continua ouvindo o carregando. Serve também no telão (os tokens do tema dele).
export function Esqueleto({
  blocos,
  texto = "Carregando…",
  cartao = false,
  className,
}: Props) {
  return (
    <div
      className={juntarClasses(
        "ui-esqueleto",
        cartao && "ui-esqueleto--cartao",
        className,
      )}
    >
      {blocos.map((bloco, indice) => (
        <div
          // A lista é fixa (o desenho do que vem): o índice é a identidade do bloco.
          key={indice}
          className="mov-esqueleto ui-esqueleto__bloco"
          aria-hidden="true"
          style={{ height: bloco.altura, width: bloco.largura }}
        />
      ))}
      {texto !== null && (
        <p className="visualmente-oculto" role="status">
          {texto}
        </p>
      )}
    </div>
  );
}
