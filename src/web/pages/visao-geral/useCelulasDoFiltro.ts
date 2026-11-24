import { useCallback, useEffect, useState } from "react";
import {
  carregarCelulas,
  carregarGrupos,
  type CelulaDoFiltro,
  type GrupoDoFiltro,
} from "./visao-geral-api";

export type EstadoCelulas =
  | { tipo: "carregando" }
  | {
      tipo: "ok";
      celulas: CelulaDoFiltro[];
      /** A ordem dos grupos (RIFA-092); null se a lista falhou (os grupos das células saem pelo nome). */
      grupos: GrupoDoFiltro[] | null;
    }
  | { tipo: "erro"; erro: unknown };

/**
 * As células com a hierarquia, para as opções do filtro, e a lista dos grupos, que dá a ordem do grupo no filtro
 * (RIFA-092). As duas vão juntas e carregam uma vez ao abrir a tela (a hierarquia quase não muda durante a campanha);
 * a falha dos grupos não derruba o filtro. `recarregar` tenta de novo (ex.: depois de uma falha).
 */
export function useCelulasDoFiltro() {
  const [estado, setEstado] = useState<EstadoCelulas>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    const grupos = carregarGrupos({ signal: controle.signal }).catch(
      () => null,
    );
    carregarCelulas({ signal: controle.signal }).then(
      async (celulas) => {
        const ordem = await grupos;
        if (!controle.signal.aborted)
          setEstado({ tipo: "ok", celulas, grupos: ordem });
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
