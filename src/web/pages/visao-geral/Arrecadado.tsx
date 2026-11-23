import { useEffect, useState } from "react";
import type { RespostaArrecadado } from "../../../shared/contracts/api";
import { Card, ErrorState, Loading } from "../../components/ui";
import { ErroApi, ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { formatarMoeda } from "../../lib/formatadores";
import { ajuda } from "../ajuda-sob-demanda";
import { contagem } from "./textos";
import { carregarArrecadado } from "./visao-geral-api";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "ok"; arrecadado: RespostaArrecadado }
  | { tipo: "erro"; erro: unknown };

/** A legenda do cartão (decisão do PO, 23/11). */
export const LEGENDA_ARRECADADO =
  "Soma dos bilhetes pagos recebidos da Rifei, antes da tarifa da Efí.";

const semCampanha = (erro: unknown) =>
  erro instanceof ErroApi &&
  erro.status === 404 &&
  erro.codigo === "nao_encontrado";

// Quanto entrou (RIFA-087, adendo da D40), SÓ para o admin (a VisaoGeralPage nem monta o cartão para a coordenação, e a
// API dá 403 a ela): o total pago na campanha, os bilhetes pagos e o valor de hoje, do banco (os pedidos pagos que a
// Rifei manda pelo webhook). Carrega ao abrir a tela e de novo a cada atualização do painel (`sinal` é o instante da
// última; a primeira, que chega logo depois da abertura, não pede de novo). Numa atualização que falha, os números de
// antes ficam.
export function Arrecadado({ sinal }: { sinal: string | null }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  // Cada atualização do painel depois da primeira vira uma consulta (ajuste de estado no render, sem efeito).
  const [sinalVisto, setSinalVisto] = useState(sinal);
  const [rodada, setRodada] = useState(0);
  if (sinal !== sinalVisto) {
    setSinalVisto(sinal);
    if (sinalVisto !== null && sinal !== null) setRodada(rodada + 1);
  }

  useEffect(() => {
    const controle = new AbortController();
    carregarArrecadado({ signal: controle.signal }).then(
      (arrecadado) => {
        if (!controle.signal.aborted) setEstado({ tipo: "ok", arrecadado });
      },
      (erro: unknown) => {
        if (!controle.signal.aborted)
          setEstado((atual) =>
            atual.tipo === "ok" ? atual : { tipo: "erro", erro },
          );
      },
    );
    return () => controle.abort();
  }, [rodada, tentativa]);

  const tentarDeNovo = () => {
    setEstado({ tipo: "carregando" });
    setTentativa((atual) => atual + 1);
  };

  return (
    <Card
      titulo="Arrecadado"
      ajuda={ajuda("arrecadado")}
      className="visao-arrecadado"
    >
      {estado.tipo === "carregando" ? (
        <Loading texto="Somando os bilhetes pagos…" />
      ) : estado.tipo === "erro" ? (
        semCampanha(estado.erro) ? (
          <p className="visao-arrecadado__nota">
            Sem campanha ativa: o valor aparece quando a campanha for ativada.
          </p>
        ) : (
          <ErrorState
            titulo="Não foi possível somar o arrecadado."
            mensagem={mensagemDoErro(estado.erro)}
            conexao={ehFalhaDeConexao(estado.erro)}
            aoTentarDeNovo={tentarDeNovo}
          />
        )
      ) : (
        <Valores arrecadado={estado.arrecadado} />
      )}
    </Card>
  );
}

function Valores({ arrecadado }: { arrecadado: RespostaArrecadado }) {
  const { campanha, hoje } = arrecadado;
  return (
    <div className="visao-arrecadado__corpo">
      <p className="visao-arrecadado__valor">
        {formatarMoeda(campanha.total_centavos)}
      </p>
      <p>
        {contagem(campanha.bilhetes, "bilhete pago", "bilhetes pagos")} na
        campanha
      </p>
      <p className="visao-arrecadado__hoje">
        {hoje === null ? (
          "Hoje fica fora das datas da campanha."
        ) : (
          <>
            Hoje: <strong>{formatarMoeda(hoje.total_centavos)}</strong> ·{" "}
            {contagem(hoje.bilhetes, "bilhete", "bilhetes")}
          </>
        )}
      </p>
      <p className="visao-arrecadado__nota">{LEGENDA_ARRECADADO}</p>
    </div>
  );
}
