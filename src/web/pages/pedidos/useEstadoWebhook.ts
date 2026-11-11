import { useEffect, useState } from "react";
import type { RespostaEstadoWebhook } from "../../../shared/contracts";
import { INTERVALO_ESTADO_MS, carregarEstadoWebhook } from "./alerta-webhook";

export type CargaEstadoWebhook = {
  /** O último estado que chegou (null até a primeira resposta). */
  estado: RespostaEstadoWebhook | null;
  /** A última consulta falhou (null quando deu certo). */
  falha: unknown;
};

function abaVisivel(): boolean {
  return document.visibilityState !== "hidden";
}

/**
 * O estado do webhook (GET /api/admin/webhook/estado), consultado ao abrir e de novo a cada INTERVALO_ESTADO_MS
 * (contados do fim da consulta anterior) enquanto a aba está visível; com a aba oculta, para, e ao voltar consulta
 * na hora. Uma falha não apaga o último estado: a tela continua de pé e a próxima rodada tenta de novo.
 */
export function useEstadoWebhook(): CargaEstadoWebhook {
  const [carga, setCarga] = useState<CargaEstadoWebhook>({
    estado: null,
    falha: null,
  });
  const [visivel, setVisivel] = useState(abaVisivel);
  // Cada rodada é uma consulta: muda no temporizador e ao voltar para a aba.
  const [rodada, setRodada] = useState(0);

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
      proxima = setTimeout(() => setRodada((n) => n + 1), INTERVALO_ESTADO_MS);
    };

    carregarEstadoWebhook({ signal: controle.signal }).then(
      (estado) => {
        if (controle.signal.aborted) return;
        setCarga({ estado, falha: null });
        agendar();
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setCarga((anterior) => ({ ...anterior, falha: erro }));
        agendar();
      },
    );

    return () => {
      controle.abort();
      clearTimeout(proxima);
    };
  }, [rodada, visivel]);

  return carga;
}
