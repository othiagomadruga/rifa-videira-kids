import { EmConstrucao } from "../../components/EmConstrucao";
import { PageHeader } from "../../components/ui";

// Tela pública (link do grupo de WhatsApp): só posições e top 3, nunca valores
// em dinheiro (regra em docs/frontend.md, conferida em rotas.test.tsx).
export function RankingPublicoPage() {
  return (
    <>
      <PageHeader titulo="Ranking da campanha" />
      <EmConstrucao tarefa="RIFA-010/011" />
    </>
  );
}
