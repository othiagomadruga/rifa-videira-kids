import type { StatusApi } from "../api";

type Props = {
  // null enquanto a consulta à API não terminou.
  status: StatusApi | null;
};

export function ApiStatus({ status }: Props) {
  if (status === null) {
    return <p role="status">Verificando a API…</p>;
  }
  if (status.estado === "ok") {
    return <p role="status">API ok</p>;
  }
  return <p role="alert">Erro na API: {status.mensagem}</p>;
}
