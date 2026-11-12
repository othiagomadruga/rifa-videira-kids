import { Suspense, lazy, type ComponentProps } from "react";
import "./compartilhar.css";

// O QR code com o `qr` vem num pedaço à parte, carregado só quando um QR aparece na tela (D24: o pacote inicial não
// leva o gerador). Enquanto ele chega, um quadrado do mesmo tamanho (nada pula quando o QR aparece).
const QrCodeLinkVendas = lazy(() =>
  import("./QrCodeLinkVendas").then((modulo) => ({
    default: modulo.QrCodeLinkVendas,
  })),
);

export function QrCodeLinkVendasLazy(
  props: ComponentProps<typeof QrCodeLinkVendas>,
) {
  return (
    <Suspense
      fallback={
        <div className="qr-carregando">
          <p role="status">Gerando o QR code…</p>
        </div>
      }
    >
      <QrCodeLinkVendas {...props} />
    </Suspense>
  );
}
