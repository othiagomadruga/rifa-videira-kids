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
 *
 * `vinculos`: quantos afiliados a visão diz que a célula tem (`afiliados_vinculados`, só do líder; null nos outros).
 * Quando muda numa atualização da visão (a coordenação vinculou ou desvinculou), os links são pedidos de novo, sem
 * voltar ao "carregando": na reunião dos líderes (lancamento.md 5.2), o aviso amarelo some e o link e o QR aparecem
 * juntos, sem recarregar a página (RIFA-036, ensaio geral 2). Sem mudança, nenhum pedido a mais.
 */
export function useMeusLinksVendas(vinculos: number | null = null) {
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
  }, [rodada, vinculos]);

  const tentarDeNovo = useCallback(() => {
    setEstado({ tipo: "carregando" });
    setRodada((n) => n + 1);
  }, []);

  return { estado, tentarDeNovo };
}
