import { useCallback, useEffect, useState } from "react";
import { carregarPainel, type PainelAdesao } from "./adesao-api";

/** De quanto em quanto tempo o painel se atualiza sozinho, com a aba visível. */
export const INTERVALO_ATUALIZACAO_MS = 15_000;

export type EstadoPainel =
  | { tipo: "carregando" }
  | { tipo: "erro"; erro: unknown }
  /** `falha`: a última atualização falhou e a tela mostra os dados da anterior (null quando deu certo). */
  | { tipo: "ok"; painel: PainelAdesao; falha: unknown };

function abaVisivel(): boolean {
  return document.visibilityState !== "hidden";
}

/**
 * Carrega o painel de adesão e o mantém atualizado:
 * - a cada INTERVALO_ATUALIZACAO_MS, contados do fim da consulta anterior, enquanto a aba está visível;
 * - com a aba oculta, para (cancela a consulta em andamento e não agenda outra); ao voltar, atualiza na hora;
 * - `atualizarAgora` (botão e depois de salvar um vínculo) cancela a consulta em andamento e consulta de novo.
 *
 * Uma falha depois da primeira carga não apaga a tela: os dados ficam e `falha` explica o problema.
 */
export function usePainelAdesao() {
  const [estado, setEstado] = useState<EstadoPainel>({ tipo: "carregando" });
  const [visivel, setVisivel] = useState(abaVisivel);
  // Cada rodada é uma consulta. Muda no "Atualizar agora", ao voltar para a aba e no temporizador.
  const [rodada, setRodada] = useState(0);
  const [rodadaConcluida, setRodadaConcluida] = useState(-1);

  useEffect(() => {
    function aoMudarVisibilidade() {
      const agoraVisivel = abaVisivel();
      setVisivel(agoraVisivel);
      if (agoraVisivel) setRodada((n) => n + 1);
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () =>
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  }, []);

  useEffect(() => {
    if (!visivel) return;
    const controle = new AbortController();
    let proxima: ReturnType<typeof setTimeout> | undefined;

    function concluir() {
      setRodadaConcluida(rodada);
      proxima = setTimeout(
        () => setRodada((n) => n + 1),
        INTERVALO_ATUALIZACAO_MS,
      );
    }

    carregarPainel({ signal: controle.signal }).then(
      (painel) => {
        if (controle.signal.aborted) return;
        setEstado({ tipo: "ok", painel, falha: null });
        concluir();
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setEstado((anterior) =>
          anterior.tipo === "ok"
            ? { ...anterior, falha: erro }
            : { tipo: "erro", erro },
        );
        concluir();
      },
    );

    return () => {
      controle.abort();
      clearTimeout(proxima);
    };
  }, [rodada, visivel]);

  const atualizarAgora = useCallback(() => setRodada((n) => n + 1), []);

  /** Depois de uma falha na primeira carga: volta a "Carregando…" e tenta de novo. */
  const tentarDeNovo = useCallback(() => {
    setEstado({ tipo: "carregando" });
    setRodada((n) => n + 1);
  }, []);

  return {
    estado,
    atualizando: rodadaConcluida !== rodada,
    atualizarAgora,
    tentarDeNovo,
  };
}
