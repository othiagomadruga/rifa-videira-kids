import { Suspense, lazy } from "react";
import { Aviso, Loading, PageHeader } from "../../components/ui";
import { DICA_DO_MENU } from "../coordenacao/textos";

// Pedidos suspeitos (RIFA-024, coordenação): os pedidos aprovados que o webhook marcou para conferir na Rifei.
// A lista vem num pacote à parte, carregado só aqui (como a configuração da Campanha e a /minha), com o
// próprio CSS.
const ListaPedidosSuspeitos = lazy(() =>
  import("./ListaPedidosSuspeitos").then((modulo) => ({
    default: modulo.ListaPedidosSuspeitos,
  })),
);

export function PedidosSuspeitosPage() {
  return (
    <>
      <PageHeader
        titulo="Pedidos suspeitos"
        ajuda={DICA_DO_MENU["pedidos-suspeitos"]}
        descricao="Pedidos aprovados que o sistema marcou para conferir na Rifei: bilhetes demais num pedido só ou total fora de bilhetes × preço do bilhete."
      />
      <Aviso
        tom="info"
        titulo="Estes pedidos contam nas vendas"
        anuncio="nenhum"
      >
        <p>
          Cada pedido desta lista continua contando nas vendas, no painel e nos
          rankings até o admin desconsiderá-lo na tela Pedidos (com “Permitir
          desconsiderar pedidos” ligado na Campanha). O desconsiderado fica
          aqui, com o selo. Esta tela só aponta o que conferir.
        </p>
      </Aviso>
      <Suspense fallback={<Loading texto="Carregando os pedidos marcados…" />}>
        <ListaPedidosSuspeitos />
      </Suspense>
    </>
  );
}
