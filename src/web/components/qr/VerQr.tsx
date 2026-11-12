import { useState } from "react";
import { Button, Dialogo } from "../ui";
import { QrCodeLinkVendasLazy } from "./QrCodeLazy";
import "./compartilhar.css";

type Props = {
  url: string;
  celulaNome: string;
  /** Quando a célula tem mais de um código: qual afiliado é este link (vai no título do diálogo). */
  affiliateId?: number;
};

/**
 * "Ver QR": abre o QR code de um link de vendas num diálogo (com "Baixar imagem" e "Imprimir"), para as listas com
 * várias células. O QR (e o `qr`) só carrega quando o diálogo abre.
 */
export function VerQr({ url, celulaNome, affiliateId }: Props) {
  const [aberto, setAberto] = useState(false);
  const doAfiliado =
    affiliateId === undefined ? "" : ` (afiliado ${affiliateId})`;
  return (
    <>
      <Button variante="secundario" onClick={() => setAberto(true)}>
        Ver QR{" "}
        <span className="visualmente-oculto">
          code da {celulaNome}
          {doAfiliado}
        </span>
      </Button>
      <Dialogo
        aberto={aberto}
        titulo={`QR code da ${celulaNome}${doAfiliado}`}
        descricao="Aponte a câmera do celular para abrir o link de vendas na Rifei."
        aoFechar={() => setAberto(false)}
        rodape={
          <Button variante="secundario" onClick={() => setAberto(false)}>
            Pronto
          </Button>
        }
      >
        <div className="qr-dialogo">
          <QrCodeLinkVendasLazy url={url} celulaNome={celulaNome} />
          <p className="qr-dialogo__link">{url}</p>
        </div>
      </Dialogo>
    </>
  );
}
