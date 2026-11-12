import { useCallback, useEffect, useState } from "react";
import type { RespostaMeusLinksVendas } from "../../../shared/contracts/api";
import {
  ehAcessoDesligado,
  textoAcessoDesligado,
} from "../../lib/acesso-desligado";
import { carregarMeusLinks } from "./links-vendas-api";
import { ehSemCampanha } from "./minha-api";

export type EstadoLinks =
  | { tipo: "carregando" }
  | { tipo: "erro"; erro: unknown }
  /** 403 `acesso_desligado` (D20), como a visão. */
  | { tipo: "desligado"; texto: string }
  /** 404: ainda não há campanha ativa. */
  | { tipo: "sem_campanha" }
  | { tipo: "ok"; dados: RespostaMeusLinksVendas };

/**
 * Os links de vendas do alvo, pedidos uma vez ao abrir a tela (D24: sem a atualização de 60 s da visão; o link só
 * muda quando a coordenação vincula um afiliado ou o admin muda o modelo). "Tentar de novo" pede outra vez.
 */
export function useMeusLinksVendas() {
  const [estado, setEstado] = useState<EstadoLinks>({ tipo: "carregando" });
  const [rodada, setRodada] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    carregarMeusLinks({ signal: controle.signal }).then(
      (dados) => {
        if (!controle.signal.aborted) setEstado({ tipo: "ok", dados });
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setEstado(
          ehAcessoDesligado(erro)
            ? { tipo: "desligado", texto: textoAcessoDesligado(erro) }
            : ehSemCampanha(erro)
              ? { tipo: "sem_campanha" }
              : { tipo: "erro", erro },
        );
      },
    );
    return () => controle.abort();
  }, [rodada]);

  const tentarDeNovo = useCallback(() => {
    setEstado({ tipo: "carregando" });
    setRodada((n) => n + 1);
  }, []);

  return { estado, tentarDeNovo };
}
