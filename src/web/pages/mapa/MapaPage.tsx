import { Suspense, lazy } from "react";
import { Loading, PageHeader } from "../../components/ui";
import { DICA_DO_MENU } from "../coordenacao/textos";

// Mapa de vendas por DDD (RIFA-015, D17; coordenação, com valores). O mapa, a lista e os filtros vêm num pacote à
// parte, carregado só aqui (como os Pedidos suspeitos e a Trilha), com o próprio CSS.
const MapaDeVendas = lazy(() =>
  import("./MapaDeVendas").then((modulo) => ({
    default: modulo.MapaDeVendas,
  })),
);

export function MapaPage() {
  return (
    <>
      <PageHeader
        titulo="Mapa"
        ajuda={DICA_DO_MENU.mapa}
        descricao="De onde vêm as vendas aprovadas, pelo DDD do telefone do comprador: por estado e por DDD."
      />
      <Suspense fallback={<Loading texto="Carregando o mapa…" />}>
        <MapaDeVendas />
      </Suspense>
    </>
  );
}
