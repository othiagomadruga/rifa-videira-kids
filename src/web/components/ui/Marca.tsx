import { MARCA } from "../../tema/marca";
import "./Marca.css";

type Props = {
  /** Texto menor ao lado do nome (ex.: "Coordenação"). */
  complemento?: string;
};

// Marca provisória (símbolo em texto + nome). Quando chegarem os arquivos
// oficiais, o símbolo vira a imagem do logotipo aqui mesmo.
export function Marca({ complemento }: Props) {
  return (
    <span className="ui-marca">
      <span className="ui-marca__simbolo" aria-hidden="true">
        {MARCA.simbolo}
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
