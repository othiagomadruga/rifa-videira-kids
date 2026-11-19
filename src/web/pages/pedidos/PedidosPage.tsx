import { Suspense, lazy } from "react";
import { Loading, PageHeader } from "../../components/ui";
import { AlertaWebhook } from "./AlertaWebhook";
import { DICA_DO_MENU } from "../coordenacao/textos";

// Pedidos (RIFA-025, coordenação, com R$): os pedidos da campanha e as entregas do webhook, em abas, com o alerta
// de webhook parado no topo. As abas vêm num pacote à parte, carregado só aqui (como a Trilha e a configuração da
// Campanha), com o próprio CSS; o alerta fica no pacote inicial, porque aparece também na Visão geral.
const TelaPedidos = lazy(() =>
  import("./TelaPedidos").then((modulo) => ({
    default: modulo.TelaPedidos,
  })),
);

export function PedidosPage() {
  return (
    <>
      <PageHeader
        titulo="Pedidos"
        ajuda={DICA_DO_MENU.pedidos}
        descricao="Os pedidos da campanha que chegaram da Rifei e cada entrega do webhook, do mais recente para o mais antigo."
      />
      <AlertaWebhook />
      <Suspense fallback={<Loading texto="Carregando os pedidos…" />}>
        <TelaPedidos />
      </Suspense>
    </>
  );
}
