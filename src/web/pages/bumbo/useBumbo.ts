import { useCallback, useEffect, useState } from "react";
import type { RespostaBumbo } from "../../../shared/contracts/calculos";
import { carregarBumbo, ehSemCampanha } from "./bumbo-api";
import type { DatasDaCampanha } from "./textos";

export type EstadoBumbo =
  | { tipo: "carregando" }
  /** 404: ainda não há campanha ativa. */
  | { tipo: "sem_campanha" }
  | { tipo: "erro"; erro: unknown }
  | { tipo: "ok"; bumbo: RespostaBumbo };

type Concluido = Exclude<EstadoBumbo, { tipo: "carregando" }>;

function abaVisivel(): boolean {
  return document.visibilityState !== "hidden";
}

/**
 * A mensagem do dia escolhido (`data` null = hoje) e as datas da campanha que as respostas trazem (para o
 * seletor, que fica na tela enquanto outro dia carrega):
 * - trocar o dia cancela a consulta em andamento e mostra "carregando" até chegar a mensagem nova (a do
 *   dia anterior some na hora: nunca se copia a mensagem errada);
 * - com a mensagem de hoje na tela, voltar para a aba consulta de novo sem tirar a mensagem da tela: o
 *   celular que ficou com a página aberta de um dia para o outro passa a mostrar a do dia novo. Se essa
 *   consulta falhar, a mensagem que estava fica;
 * - o "hoje" é o do servidor (a `data` da resposta sem `data`), não o relógio do aparelho.
 */
export function useBumbo(data: string | null) {
  const [concluido, setConcluido] = useState<{
    data: string | null;
    estado: Concluido;
  } | null>(null);
  const [datas, setDatas] = useState<DatasDaCampanha | null>(null);
  // Cada rodada é uma consulta: muda no "Tentar de novo" e ao voltar para a aba (só na de hoje).
  const [rodada, setRodada] = useState(0);

  useEffect(() => {
    if (data !== null) return;
    function aoMudarVisibilidade() {
      if (abaVisivel()) setRodada((n) => n + 1);
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () =>
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  }, [data]);

  useEffect(() => {
    const controle = new AbortController();
    carregarBumbo(data, { signal: controle.signal }).then(
      (bumbo) => {
        if (controle.signal.aborted) return;
        setConcluido({ data, estado: { tipo: "ok", bumbo } });
        setDatas((anteriores) => ({
          inicio: bumbo.referencia.data_inicio,
          fim: bumbo.referencia.data_fim,
          hoje: data === null ? bumbo.data : (anteriores?.hoje ?? bumbo.data),
        }));
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setConcluido((anterior) =>
          anterior?.data === data && anterior.estado.tipo === "ok"
            ? anterior
            : {
                data,
                estado: ehSemCampanha(erro)
                  ? { tipo: "sem_campanha" }
                  : { tipo: "erro", erro },
              },
        );
      },
    );
    return () => controle.abort();
  }, [data, rodada]);

  /** Depois de uma falha: volta a "carregando" e tenta de novo na hora. */
  const tentarDeNovo = useCallback(() => {
    setConcluido(null);
    setRodada((n) => n + 1);
  }, []);

  const estado: EstadoBumbo =
    concluido !== null && concluido.data === data
      ? concluido.estado
      : { tipo: "carregando" };
  return { estado, datas, tentarDeNovo };
}
