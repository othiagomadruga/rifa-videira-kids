import { useCallback, useEffect, useRef, useState } from "react";
import type { FaseCampanha } from "../../../shared/contracts/calculos";
import {
  carregarRankingPublico,
  ehSemCampanha,
  type RankingPublico,
} from "./ranking-publico-api";

/** De quanto em quanto tempo o ranking se atualiza sozinho, com a aba visível. */
export const INTERVALO_ATUALIZACAO_MS = 60_000;

export type EstadoRankingPublico =
  | { tipo: "carregando" }
  /** 404: ainda não há campanha ativa. */
  | { tipo: "sem_campanha" }
  | { tipo: "erro"; erro: unknown }
  /** `falha`: a última atualização falhou e a tela mostra os dados da anterior (null quando deu certo). */
  | { tipo: "ok"; ranking: RankingPublico; falha: unknown };

function abaVisivel(): boolean {
  return document.visibilityState !== "hidden";
}

/**
 * Carrega o ranking público e o mantém atualizado:
 * - a cada INTERVALO_ATUALIZACAO_MS, contados do fim da consulta anterior, enquanto a aba está visível;
 * - com a aba oculta, para (cancela a consulta em andamento e não agenda outra); ao voltar, atualiza na hora;
 * - uma falha depois da primeira carga não apaga a tela: os dados ficam e `falha` explica o problema.
 */
export function useRankingPublico() {
  const [estado, setEstado] = useState<EstadoRankingPublico>({
    tipo: "carregando",
  });
  const [visivel, setVisivel] = useState(abaVisivel);
  // Cada rodada é uma consulta. Muda no temporizador, ao voltar para a aba e no "Tentar de novo".
  const [rodada, setRodada] = useState(0);
  // Fase da última resposta: depois do fim da campanha, a próxima consulta já pede a janela certa.
  const faseConhecida = useRef<FaseCampanha | null>(null);

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
    const agendar = () => {
      proxima = setTimeout(
        () => setRodada((n) => n + 1),
        INTERVALO_ATUALIZACAO_MS,
      );
    };

    carregarRankingPublico(faseConhecida.current, {
      signal: controle.signal,
    }).then(
      (ranking) => {
        if (controle.signal.aborted) return;
        faseConhecida.current = ranking.referencia.fase;
        setEstado({ tipo: "ok", ranking, falha: null });
        agendar();
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setEstado((anterior) => {
          if (anterior.tipo === "ok") return { ...anterior, falha: erro };
          return ehSemCampanha(erro)
            ? { tipo: "sem_campanha" }
            : { tipo: "erro", erro };
        });
        agendar();
      },
    );

    return () => {
      controle.abort();
      clearTimeout(proxima);
    };
  }, [rodada, visivel]);

  /** Depois de uma falha na primeira carga: volta a "Carregando…" e tenta de novo na hora. */
  const tentarDeNovo = useCallback(() => {
    setEstado({ tipo: "carregando" });
    setRodada((n) => n + 1);
  }, []);

  return { estado, tentarDeNovo };
}
