import { MARCA } from "../../tema/marca";
import "./Marca.css";

type Props = {
  /** Texto menor ao lado do nome (ex.: "Coordenação"). */
  complemento?: string;
};

// Marca: o logo da Videira (WebP, com PNG de reserva para navegador antigo) e o nome do produto em texto.
// width e height reservam o lugar do logo antes de ele carregar (nada pula). Em fundo escuro (telão), o
// logo fica num selo claro, porque o nome "Videira" do logo é marinho (Marca.css).
export function Marca({ complemento }: Props) {
  const { logo } = MARCA;
  return (
    <span className="ui-marca">
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
