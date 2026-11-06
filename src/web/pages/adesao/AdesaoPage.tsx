import { EmConstrucao } from "../../components/EmConstrucao";
import { PageHeader } from "../../components/ui";

export function AdesaoPage() {
  return (
    <>
      <PageHeader
        titulo="Adesão"
        descricao="Quem já virou afiliado e quem falta."
      />
      <EmConstrucao tarefa="RIFA-006" />
    </>
  );
}
