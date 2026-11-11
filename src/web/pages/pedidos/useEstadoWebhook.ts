import { useEffect, useRef, useState } from "react";
import type { RespostaEstadoWebhook } from "../../../shared/contracts";
import { INTERVALO_ESTADO_MS, carregarEstadoWebhook } from "./alerta-webhook";

export type CargaEstadoWebhook = {
  /** O último estado que chegou (null até a primeira resposta). */
  estado: RespostaEstadoWebhook | null;
  /** A última consulta falhou (null quando deu certo). */
  falha: unknown;
};

const NADA: CargaEstadoWebhook = { estado: null, falha: null };

/**
 * O que a última consulta deixou, guardado no módulo: sobrevive a sair e voltar da tela (Visão geral ↔ Pedidos),
 * para a outra tela mostrar o alerta na hora e não consultar de novo antes de INTERVALO_ESTADO_MS.
 */
let guardado: { carga: CargaEstadoWebhook; consultadoEm: number } | null = null;

/** Esquece o estado guardado: cada teste começa como uma página recém-aberta. */
export function esquecerEstadoWebhook(): void {
  guardado = null;
}

function guardar(carga: CargaEstadoWebhook): CargaEstadoWebhook {
  guardado = { carga, consultadoEm: Date.now() };
  return carga;
}

function abaVisivel(): boolean {
  return document.visibilityState !== "hidden";
}

/**
 * O estado do webhook (GET /api/admin/webhook/estado), consultado de novo a cada INTERVALO_ESTADO_MS (contados do
 * fim da consulta anterior), só com a aba visível. Cada consulta custa centenas de linhas do D1, então nunca vem
 * antes da hora: o resultado fica guardado no módulo e vale por esse tempo entre as telas; com a aba oculta, para;
 * ao voltar (para a aba ou para a tela), consulta na hora só se o intervalo já passou, senão espera o resto. Uma
 * falha não apaga o último estado: a tela continua de pé e a próxima rodada tenta de novo.
 */
export function useEstadoWebhook(): CargaEstadoWebhook {
  const [carga, setCarga] = useState<CargaEstadoWebhook>(
    () => guardado?.carga ?? NADA,
  );
  const [visivel, setVisivel] = useState(abaVisivel);
  // Cada rodada é uma consulta devida: muda quando o temporizador dispara.
  const [rodada, setRodada] = useState(0);
  // Quando terminou a última consulta (Date.now()) e se o temporizador já disse que a próxima é devida.
  const ultimaConsulta = useRef<number | null>(guardado?.consultadoEm ?? null);
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
      // Voltou para a aba (ou para a tela) antes de completar o intervalo: espera o resto.
      agendar(INTERVALO_ESTADO_MS - passou);
      return () => clearTimeout(proxima);
    }

    devida.current = false;
    const controle = new AbortController();
    const concluir = (nova: CargaEstadoWebhook) => {
      setCarga(guardar(nova));
      ultimaConsulta.current = Date.now();
      agendar(INTERVALO_ESTADO_MS);
    };
    carregarEstadoWebhook({ signal: controle.signal }).then(
      (estado) => {
        if (!controle.signal.aborted) concluir({ estado, falha: null });
      },
      (erro: unknown) => {
        // O último estado que chegou continua (o guardado é o mesmo que está na tela).
        if (!controle.signal.aborted)
          concluir({ estado: guardado?.carga.estado ?? null, falha: erro });
      },
    );

    return () => {
      controle.abort();
      clearTimeout(proxima);
    };
  }, [rodada, visivel]);

  return carga;
}
