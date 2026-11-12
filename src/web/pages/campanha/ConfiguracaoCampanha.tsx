// Primeiro de tudo: o zod sem eval, antes de o contrato criar os schemas (RIFA-044).
import "./zod-sem-eval";
import { useEffect, useState } from "react";
import type { Campanha } from "../../../shared/contracts";
import { ErrorState, Loading } from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { carregarCampanha } from "./campanha-api";
import { FormularioCampanha } from "./FormularioCampanha";
import "./campanha.css";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "erro"; erro: unknown }
  /** campanha null = ainda não configurada (a API respondeu 404 nao_encontrado). */
  | { tipo: "pronto"; campanha: Campanha | null };

/** Carrega a campanha ativa e mostra o formulário (vazio, se ela ainda não foi configurada). */
export function ConfiguracaoCampanha() {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    carregarCampanha({ signal: controle.signal }).then(
      (campanha) => setEstado({ tipo: "pronto", campanha }),
      (erro: unknown) => {
        if (!controle.signal.aborted) setEstado({ tipo: "erro", erro });
      },
    );
    return () => controle.abort();
  }, [tentativa]);

  if (estado.tipo === "carregando") {
    return <Loading texto="Carregando a campanha…" />;
  }
  if (estado.tipo === "erro") {
    return (
      <ErrorState
        titulo="Não foi possível carregar a campanha."
        mensagem={mensagemDoErro(estado.erro)}
        aoTentarDeNovo={() => {
          setEstado({ tipo: "carregando" });
          setTentativa((numero) => numero + 1);
        }}
      />
    );
  }
  return <FormularioCampanha campanhaInicial={estado.campanha} />;
}
