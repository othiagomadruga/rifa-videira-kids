export type StatusApi = { estado: "ok" } | { estado: "erro"; mensagem: string };

// Consulta GET /api/health. Nunca lança: falhas viram { estado: "erro" } com uma
// mensagem que pode ser mostrada ao usuário.
export async function consultarStatusApi(): Promise<StatusApi> {
  let res: Response;
  try {
    res = await fetch("/api/health", {
      headers: { accept: "application/json" },
    });
  } catch {
    return { estado: "erro", mensagem: "Não foi possível conectar à API." };
  }

  const corpo: unknown = await res.json().catch(() => null);
  if (res.ok && isSaudavel(corpo)) {
    return { estado: "ok" };
  }
  return {
    estado: "erro",
    mensagem: `A API respondeu com falha (HTTP ${res.status}).`,
  };
}

function isSaudavel(corpo: unknown): boolean {
  return (
    typeof corpo === "object" &&
    corpo !== null &&
    "ok" in corpo &&
    corpo.ok === true &&
    "db" in corpo &&
    corpo.db === "ok"
  );
}
