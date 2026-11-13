import { MARCA } from "../../tema/marca";
import "./Marca.css";

type Props = {
  /** Texto menor ao lado do nome (ex.: "Coordenação"). */
  complemento?: string;
  /**
   * O fundo em que a marca fica (RIFA-049). "escuro" (a faixa do degradê forte das telas abertas): o logo vai no selo
   * claro, como no telão, e o nome fica em branco. Padrão: "claro". O logo nunca é recolorido.
   */
  fundo?: "claro" | "escuro";
};

/** O logo chegou: o selo claro (fundo escuro) pode aparecer. Atributo fora do React, que não o controla. */
function marcarCarregado(logo: HTMLImageElement) {
  logo.closest(".ui-marca__selo")?.setAttribute("data-carregado", "");
}

// Marca: o logo da Videira (WebP, com PNG de reserva para navegador antigo) e o nome do produto em texto.
// width e height reservam o lugar do logo antes de ele carregar (nada pula). Em fundo escuro (telão, e a faixa das
// telas abertas com fundo="escuro"), o logo fica num selo claro, porque o nome "Videira" do logo é marinho; o selo só
// aparece com o logo carregado (data-carregado), para não ficar um retângulo branco vazio enquanto a imagem chega
// (Marca.css).
export function Marca({ complemento, fundo = "claro" }: Props) {
  const { logo } = MARCA;
  return (
    <span
      className="ui-marca"
      data-fundo={fundo === "escuro" ? "escuro" : undefined}
    >
      <span className="ui-marca__selo">
        <picture className="ui-marca__imagem">
          <source srcSet={logo.webp} type="image/webp" />
          <img
            className="ui-marca__logo"
            src={logo.png}
            alt={logo.alt}
            width={logo.largura}
            height={logo.altura}
            decoding="async"
            fetchPriority="high"
            // Já no cache: o load pode ter acontecido antes do React ouvir.
            ref={(imagem) => {
              if (imagem?.complete && imagem.naturalWidth > 0)
                marcarCarregado(imagem);
            }}
            onLoad={(evento) => marcarCarregado(evento.currentTarget)}
          />
        </picture>
      </span>
      <span className="ui-marca__textos">
        <span className="ui-marca__nome">{MARCA.produto}</span>
        {complemento && (
          <span className="ui-marca__complemento">{complemento}</span>
        )}
      </span>
    </span>
  );
}
