import { useEffect, useRef, useState } from "react";
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
 * (contados do fim da consulta anterior), só com a aba visível. Cada consulta custa centenas de linhas do D1, então
 * nunca vem antes da hora: com a aba oculta, para; ao voltar, consulta na hora só se o intervalo já passou desde a
 * última, senão espera o resto. Uma falha não apaga o último estado: a tela continua de pé e a próxima rodada tenta
 * de novo.
 */
export function useEstadoWebhook(): CargaEstadoWebhook {
  const [carga, setCarga] = useState<CargaEstadoWebhook>({
    estado: null,
    falha: null,
  });
  const [visivel, setVisivel] = useState(abaVisivel);
  // Cada rodada é uma consulta devida: muda quando o temporizador dispara.
  const [rodada, setRodada] = useState(0);
  // Quando terminou a última consulta (Date.now()) e se o temporizador já disse que a próxima é devida.
  const ultimaConsulta = useRef<number | null>(null);
  const devida = useRef(false);

  useEffect(() => {
    function aoMudarVisibilidade() {
      setVisivel(abaVisivel());
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () =>
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  }, []);

  useEffect(() => {
    if (!visivel) return;
    let proxima: ReturnType<typeof setTimeout> | undefined;
    const agendar = (espera: number) => {
      proxima = setTimeout(() => {
        devida.current = true;
        setRodada((n) => n + 1);
      }, espera);
    };

    const ultima = ultimaConsulta.current;
    const passou = ultima === null ? Infinity : Date.now() - ultima;
    if (!devida.current && passou < INTERVALO_ESTADO_MS) {
      // Voltou para a aba antes de completar o intervalo: espera o resto.
      agendar(INTERVALO_ESTADO_MS - passou);
      return () => clearTimeout(proxima);
    }

    devida.current = false;
    const controle = new AbortController();
    const concluir = () => {
      ultimaConsulta.current = Date.now();
      agendar(INTERVALO_ESTADO_MS);
    };
    carregarEstadoWebhook({ signal: controle.signal }).then(
      (estado) => {
        if (controle.signal.aborted) return;
        setCarga({ estado, falha: null });
        concluir();
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setCarga((anterior) => ({ ...anterior, falha: erro }));
        concluir();
      },
    );

    return () => {
      controle.abort();
      clearTimeout(proxima);
    };
  }, [rodada, visivel]);

  return carga;
}
