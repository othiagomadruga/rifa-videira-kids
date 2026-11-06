import { useEffect, useState } from "react";
import { consultarStatusApi, type StatusApi } from "../api";
import { ApiStatus } from "../components/ApiStatus";

export function StatusPage() {
  const [status, setStatus] = useState<StatusApi | null>(null);

  useEffect(() => {
    let ativo = true;
    void consultarStatusApi().then((resultado) => {
      if (ativo) setStatus(resultado);
    });
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <section>
      <h2>Status do sistema</h2>
      <ApiStatus status={status} />
    </section>
  );
}
