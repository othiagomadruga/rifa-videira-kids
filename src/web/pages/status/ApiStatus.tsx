import { Badge, ErrorState, Loading } from "../../components/ui";
import type { StatusApi } from "./status-api";

type Props = {
  // null enquanto a consulta à API não terminou.
  status: StatusApi | null;
  aoTentarDeNovo: () => void;
};

export function ApiStatus({ status, aoTentarDeNovo }: Props) {
  if (status === null) {
    return <Loading texto="Verificando a API…" />;
  }
  if (status.estado === "ok") {
    return (
      <p role="status">
        <Badge tom="sucesso">API ok</Badge>
      </p>
    );
  }
  return (
    <ErrorState
      titulo={`Erro na API: ${status.mensagem}`}
      aoTentarDeNovo={aoTentarDeNovo}
    />
  );
}
