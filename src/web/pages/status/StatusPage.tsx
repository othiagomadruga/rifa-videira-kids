import { useEffect, useState } from "react";
import { Card, PageHeader } from "../../components/ui";
import { ApiStatus } from "./ApiStatus";
import { consultarStatusApi, type StatusApi } from "./status-api";

export function StatusPage() {
  const [status, setStatus] = useState<StatusApi | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    void consultarStatusApi({ signal: controle.signal }).then((resultado) => {
      if (!controle.signal.aborted) setStatus(resultado);
    });
    return () => controle.abort();
  }, [tentativa]);

  function tentarDeNovo() {
    setStatus(null);
    setTentativa((n) => n + 1);
  }

  return (
    <>
      <PageHeader
        titulo="Status do sistema"
        descricao="Saúde da API e do banco de dados."
      />
      <Card>
        <ApiStatus status={status} aoTentarDeNovo={tentarDeNovo} />
      </Card>
    </>
  );
}
