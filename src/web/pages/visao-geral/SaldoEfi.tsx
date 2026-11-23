import { useEffect, useState } from "react";
import type { RespostaSaldoEfi } from "../../../shared/contracts/api";
import {
  Button,
  Card,
  ComDica,
  ErrorState,
  Loading,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { formatarHora, formatarMoeda } from "../../lib/formatadores";
import { ajuda } from "../ajuda-sob-demanda";
import { DICAS } from "./textos";
import { carregarSaldoEfi } from "./visao-geral-api";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "ok"; saldo: RespostaSaldoEfi }
  | { tipo: "erro"; erro: unknown };

// O saldo da conta Efí (RIFA-086, D40), SÓ para o admin (a VisaoGeralPage nem monta o cartão para a coordenação, e a
// API dá 403 a ela): um cartão discreto com o valor e a hora da consulta. Sem a Efí ligada, diz que ainda não foi
// ligada; com a Efí fora do ar (200 com `erro`), "indisponível agora" e o botão para consultar de novo. Carrega uma vez
// ao abrir a tela (a API guarda a resposta por um minuto); não acompanha a atualização automática do painel.
export function SaldoEfi() {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    carregarSaldoEfi({ signal: controle.signal }).then(
      (saldo) => {
        if (!controle.signal.aborted) setEstado({ tipo: "ok", saldo });
      },
      (erro: unknown) => {
        if (!controle.signal.aborted) setEstado({ tipo: "erro", erro });
      },
    );
    return () => controle.abort();
  }, [tentativa]);

  const consultarDeNovo = () => {
    setEstado({ tipo: "carregando" });
    setTentativa((atual) => atual + 1);
  };

  return (
    <Card
      titulo="Saldo na Efí"
      ajuda={ajuda("saldoEfi")}
      className="visao-saldo"
    >
      {estado.tipo === "carregando" ? (
        <Loading texto="Consultando o saldo…" />
      ) : estado.tipo === "erro" ? (
        <ErrorState
          titulo="Não foi possível consultar o saldo."
          mensagem={mensagemDoErro(estado.erro)}
          conexao={ehFalhaDeConexao(estado.erro)}
          aoTentarDeNovo={consultarDeNovo}
        />
      ) : (
        <Saldo saldo={estado.saldo} consultarDeNovo={consultarDeNovo} />
      )}
    </Card>
  );
}

function Saldo({
  saldo,
  consultarDeNovo,
}: {
  saldo: RespostaSaldoEfi;
  consultarDeNovo: () => void;
}) {
  if (!saldo.configurado)
    return (
      <p className="visao-saldo__nota">
        A consulta do saldo ainda não foi ligada. Quando for, o valor aparece
        aqui e no e-mail diário.
      </p>
    );
  if (saldo.saldo_centavos === null)
    return (
      <div className="visao-saldo__corpo">
        <p className="visao-saldo__nota">
          Saldo indisponível agora: a Efí não respondeu. Tente de novo em um
          minuto.
        </p>
        <ComDica texto={DICAS.consultarSaldo}>
          <Button
            variante="secundario"
            tamanho="pequeno"
            onClick={consultarDeNovo}
          >
            Consultar de novo
          </Button>
        </ComDica>
      </div>
    );
  return (
    <div className="visao-saldo__corpo">
      <p className="visao-saldo__valor">
        {formatarMoeda(saldo.saldo_centavos)}
      </p>
      <p className="visao-saldo__nota">
        Consultado às {formatarHora(saldo.consultado_em)}. Só o administrador vê
        este saldo.
      </p>
    </div>
  );
}
