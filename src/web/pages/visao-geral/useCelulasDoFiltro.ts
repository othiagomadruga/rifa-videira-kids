import { useCallback, useEffect, useState } from "react";
import { carregarCelulas, type CelulaDoFiltro } from "./visao-geral-api";

export type EstadoCelulas =
  | { tipo: "carregando" }
  | { tipo: "ok"; celulas: CelulaDoFiltro[] }
  | { tipo: "erro"; erro: unknown };

/**
 * As células com a hierarquia, para as opções do filtro. Carrega uma vez ao abrir a tela (a hierarquia
 * quase não muda durante a campanha); `recarregar` tenta de novo (ex.: depois de uma falha).
 */
export function useCelulasDoFiltro() {
  const [estado, setEstado] = useState<EstadoCelulas>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    carregarCelulas({ signal: controle.signal }).then(
      (celulas) => {
        if (!controle.signal.aborted) setEstado({ tipo: "ok", celulas });
      },
      (erro: unknown) => {
        if (!controle.signal.aborted) setEstado({ tipo: "erro", erro });
      },
    );
    return () => controle.abort();
  }, [tentativa]);

  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);

  return { estado, recarregar };
}
