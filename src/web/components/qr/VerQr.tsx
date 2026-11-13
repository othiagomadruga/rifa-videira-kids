import { useState } from "react";
import { Button, ComDica, Dialogo, Icone } from "../ui";
import { QrCodeLinkVendasLazy } from "./QrCodeLazy";
import { DICAS } from "./textos";
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
      <ComDica texto={DICAS.verQr}>
        <Button variante="secundario" onClick={() => setAberto(true)}>
          <Icone nome="qr" />
          Ver QR{" "}
          <span className="visualmente-oculto">
            code da {celulaNome}
            {doAfiliado}
          </span>
        </Button>
      </ComDica>
      <Dialogo
        aberto={aberto}
        titulo={`QR code da ${celulaNome}${doAfiliado}`}
        descricao="Aponte a câmera do celular para abrir o link de vendas na Rifei."
        aoFechar={() => setAberto(false)}
        dicaFechar={DICAS.fecharQr}
        rodape={
          <ComDica texto={DICAS.fecharQr}>
            <Button variante="secundario" onClick={() => setAberto(false)}>
              Pronto
            </Button>
          </ComDica>
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
