import { useCallback, useEffect, useState } from "react";
import type { RespostaPainelResumo } from "../../../shared/contracts/calculos";
import {
  carregarResumo,
  chaveDoEscopo,
  escopoDosParams,
  type Escopo,
} from "./visao-geral-api";

/** De quanto em quanto tempo o painel se atualiza sozinho, com a aba visível. */
export const INTERVALO_ATUALIZACAO_MS = 60_000;

/** Cada estado guarda a chave do recorte a que se refere (chaveDoEscopo). */
type EstadoInterno =
  | { tipo: "carregando"; chave: string }
  | { tipo: "erro"; chave: string; erro: unknown }
  | {
      tipo: "ok";
      chave: string;
      resumo: RespostaPainelResumo;
      falha: unknown;
    };

export type EstadoPainel =
  | { tipo: "carregando" }
  | { tipo: "erro"; erro: unknown }
  /** `falha`: a última atualização falhou e a tela mostra os dados da anterior (null quando deu certo). */
  | { tipo: "ok"; resumo: RespostaPainelResumo; falha: unknown }
  /** O filtro mudou: os dados do recorte anterior ficam na tela (esmaecidos) até chegarem os novos. */
  | { tipo: "trocando"; resumo: RespostaPainelResumo };

function abaVisivel(): boolean {
  return document.visibilityState !== "hidden";
}

/**
 * Carrega o resumo do painel do recorte e o mantém atualizado:
 * - a cada INTERVALO_ATUALIZACAO_MS, contados do fim da consulta anterior, enquanto a aba está visível;
 * - com a aba oculta, para (cancela a consulta em andamento e não agenda outra); ao voltar, atualiza na hora;
 * - trocar o recorte cancela a consulta em andamento e consulta o novo na hora;
 * - `atualizarAgora` (o botão "Atualizar") consulta de novo na hora.
 *
 * Uma falha depois da primeira carga do recorte não apaga a tela: os dados ficam e `falha` explica.
 */
export function usePainelResumo(escopo: Escopo) {
  const chave = chaveDoEscopo(escopo);
  const [estado, setEstado] = useState<EstadoInterno>({
    tipo: "carregando",
    chave,
  });
  const [visivel, setVisivel] = useState(abaVisivel);
  // Cada rodada é uma consulta: muda no "Atualizar", ao voltar para a aba e no temporizador.
  const [rodada, setRodada] = useState(0);
  const [concluida, setConcluida] = useState<{
    rodada: number;
    chave: string;
  } | null>(null);

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
      setConcluida({ rodada, chave });
      proxima = setTimeout(
        () => setRodada((n) => n + 1),
        INTERVALO_ATUALIZACAO_MS,
      );
    }

    carregarResumo(escopoDosParams(new URLSearchParams(chave)), {
      signal: controle.signal,
    }).then(
      (resumo) => {
        if (controle.signal.aborted) return;
        setEstado({ tipo: "ok", chave, resumo, falha: null });
        concluir();
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setEstado((anterior) =>
          anterior.tipo === "ok" && anterior.chave === chave
            ? { ...anterior, falha: erro }
            : { tipo: "erro", chave, erro },
        );
        concluir();
      },
    );

    return () => {
      controle.abort();
      clearTimeout(proxima);
    };
  }, [chave, rodada, visivel]);

  const atualizarAgora = useCallback(() => setRodada((n) => n + 1), []);

  /** Depois de uma falha sem dados na tela: volta a "Carregando…" e tenta de novo. */
  const tentarDeNovo = useCallback(() => {
    setEstado({ tipo: "carregando", chave });
    setRodada((n) => n + 1);
  }, [chave]);

  let publico: EstadoPainel;
  if (estado.tipo === "ok") {
    publico =
      estado.chave === chave
        ? { tipo: "ok", resumo: estado.resumo, falha: estado.falha }
        : { tipo: "trocando", resumo: estado.resumo };
  } else if (estado.tipo === "erro" && estado.chave === chave) {
    publico = { tipo: "erro", erro: estado.erro };
  } else {
    publico = { tipo: "carregando" };
  }

  return {
    estado: publico,
    atualizando: concluida?.rodada !== rodada || concluida.chave !== chave,
    atualizarAgora,
    tentarDeNovo,
  };
}
