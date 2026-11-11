import { useState } from "react";
import { useSearchParams } from "react-router";
import { Abas } from "../../components/ui";
import { ABA_ENTREGAS, PARAM_ABA } from "./alerta-webhook";
import { EntregasWebhook } from "./EntregasWebhook";
import { ListaPedidos } from "./ListaPedidos";
import {
  filtrosDasEntregas,
  filtrosDosPedidos,
  paramsDasEntregas,
  paramsDosPedidos,
  type FiltrosEntregas,
  type FiltrosPedidos,
} from "./pedidos-api";
import "./pedidos.css";

type AbaPedidos = "pedidos" | "entregas";

/** Os parâmetros da URL de cada lista (os mesmos nomes da consulta da API). */
const PARAMS_PEDIDOS = ["status", "celula_id", "sem_celula", "id"] as const;
const PARAMS_ENTREGAS = ["resultado"] as const;

// A tela Pedidos em duas abas (vem num pacote à parte, com o próprio CSS): os pedidos e as entregas do webhook. A
// aba e os filtros ficam na URL (`?aba=entregas&resultado=erro_validacao`), para o alerta levar direto às entregas
// com erro e para o "voltar" e o recarregar manterem o que está na tela. Cada aba só carrega quando é aberta.
export function TelaPedidos() {
  const [params, setParams] = useSearchParams();
  const aba: AbaPedidos =
    params.get(PARAM_ABA) === ABA_ENTREGAS ? "entregas" : "pedidos";
  const [abertas, setAbertas] = useState<ReadonlySet<AbaPedidos>>(
    () => new Set([aba]),
  );
  const montada = (qual: AbaPedidos) => qual === aba || abertas.has(qual);

  function mudarParams(mudar: (novos: URLSearchParams) => void) {
    setParams(
      (anteriores) => {
        const novos = new URLSearchParams(anteriores);
        mudar(novos);
        return novos;
      },
      { replace: true },
    );
  }

  function mudarAba(nova: AbaPedidos) {
    setAbertas((anteriores) => new Set([...anteriores, aba, nova]));
    mudarParams((novos) => {
      if (nova === "entregas") novos.set(PARAM_ABA, ABA_ENTREGAS);
      else novos.delete(PARAM_ABA);
    });
  }

  function mudarFiltrosPedidos(filtros: FiltrosPedidos) {
    mudarParams((novos) => {
      for (const nome of PARAMS_PEDIDOS) novos.delete(nome);
      for (const [nome, valor] of paramsDosPedidos(filtros))
        novos.set(nome, valor);
    });
  }

  function mudarFiltrosEntregas(filtros: FiltrosEntregas) {
    mudarParams((novos) => {
      for (const nome of PARAMS_ENTREGAS) novos.delete(nome);
      for (const [nome, valor] of paramsDasEntregas(filtros))
        novos.set(nome, valor);
    });
  }

  return (
    <Abas
      id="pedidos"
      rotulo="Pedidos e entregas do webhook"
      abaAtiva={aba}
      aoMudar={mudarAba}
      abas={[
        {
          id: "pedidos",
          rotulo: "Pedidos",
          conteudo: montada("pedidos") ? (
            <ListaPedidos
              filtros={filtrosDosPedidos(params)}
              aoMudar={mudarFiltrosPedidos}
            />
          ) : null,
        },
        {
          id: "entregas",
          rotulo: "Entregas do webhook",
          conteudo: montada("entregas") ? (
            <EntregasWebhook
              filtros={filtrosDasEntregas(params)}
              aoMudar={mudarFiltrosEntregas}
            />
          ) : null,
        },
      ]}
    />
  );
}
