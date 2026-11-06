import { api, mensagemDoErro } from "../../lib/api";

export type StatusApi = { estado: "ok" } | { estado: "erro"; mensagem: string };

// Consulta GET /api/health. Nunca lança: falhas viram { estado: "erro" } com uma
// mensagem que pode ser mostrada ao usuário.
export async function consultarStatusApi(
  opcoes: { signal?: AbortSignal } = {},
): Promise<StatusApi> {
  try {
    const corpo = await api.get("/api/health", opcoes);
    if (isSaudavel(corpo)) return { estado: "ok" };
    return {
      estado: "erro",
      mensagem: "A API respondeu, mas o banco de dados não está ok.",
    };
  } catch (erro) {
    return { estado: "erro", mensagem: mensagemDoErro(erro) };
  }
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
