import { useEffect, useState } from "react";
import type { RespostaMeusMaioresCompradores } from "../../../shared/contracts/api";
import type { JanelaRanking } from "../../../shared/contracts/calculos";
import {
  Button,
  Card,
  ComDica,
  ErrorState,
  Loading,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { carregarMeusMaioresCompradores } from "./maiores-compradores-api";
import {
  AJUDA,
  DICAS,
  TEXTO_JANELA_COMPRADORES,
  bilhetes,
  formatarPosicao,
  semCompras,
  textoDaJanelaDosCompradores,
} from "./textos";

const JANELAS: readonly JanelaRanking[] = ["atual", "campanha"];

type Resultado =
  | { tipo: "ok"; resposta: RespostaMeusMaioresCompradores }
  | { tipo: "erro"; erro: unknown };

/** O resultado da janela pedida (a troca de janela nunca mostra a lista da outra). */
type Carga = { janela: JanelaRanking; resultado: Resultado };

// Os maiores compradores das células do discipulador (RIFA-083, D38), depois da equipe: a troca "Esta semana" /
// "Campanha toda" e a lista com a posição, o nome, a célula e os bilhetes. Nunca telefone nem dinheiro (a rota não
// devolve; guarda-minha.test.ts confere o código). Acompanha a atualização da visão (a cada minuto): `atualizadoEm`
// muda e a lista é pedida de novo, sem sumir da tela enquanto chega; se essa atualização falha, a lista de antes fica.
export function MaioresCompradores({ atualizadoEm }: { atualizadoEm: string }) {
  const [janela, setJanela] = useState<JanelaRanking>("atual");
  const [carga, setCarga] = useState<Carga | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    carregarMeusMaioresCompradores(janela, { signal: controle.signal }).then(
      (resposta) => {
        if (controle.signal.aborted) return;
        setCarga({ janela, resultado: { tipo: "ok", resposta } });
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setCarga((anterior) =>
          anterior?.janela === janela && anterior.resultado.tipo === "ok"
            ? anterior
            : { janela, resultado: { tipo: "erro", erro } },
        );
      },
    );
    return () => controle.abort();
  }, [janela, atualizadoEm, tentativa]);

  const resultado = carga?.janela === janela ? carga.resultado : null;

  return (
    <Card
      titulo="Maiores compradores"
      ajuda={AJUDA.compradores}
      className="minha-compradores"
    >
      <div className="minha-compradores__corpo">
        <div
          className="minha-compradores__janelas"
          role="group"
          aria-label="Período dos maiores compradores"
        >
          {JANELAS.map((opcao) => (
            <ComDica key={opcao} texto={DICAS.janelaCompradores[opcao]}>
              <Button
                variante={opcao === janela ? "primario" : "secundario"}
                tamanho="pequeno"
                aria-pressed={opcao === janela}
                onClick={() => setJanela(opcao)}
              >
                {TEXTO_JANELA_COMPRADORES[opcao]}
              </Button>
            </ComDica>
          ))}
        </div>
        {resultado === null ? (
          <Loading texto="Carregando os compradores…" />
        ) : resultado.tipo === "erro" ? (
          <ErrorState
            titulo="Não foi possível carregar os compradores."
            mensagem={mensagemDoErro(resultado.erro)}
            conexao={ehFalhaDeConexao(resultado.erro)}
            aoTentarDeNovo={() => {
              setCarga(null);
              setTentativa((atual) => atual + 1);
            }}
          />
        ) : (
          <Lista resposta={resultado.resposta} />
        )}
      </div>
    </Card>
  );
}

function Lista({ resposta }: { resposta: RespostaMeusMaioresCompradores }) {
  const { janela, itens } = resposta;
  return (
    <>
      <p className="minha-compradores__janela">
        {textoDaJanelaDosCompradores(janela)}
      </p>
      {itens.length === 0 ? (
        <p className="minha-compradores__vazio">{semCompras(janela.tipo)}</p>
      ) : (
        <ol className="minha-compradores__lista">
          {itens.map((item, indice) => (
            <li key={indice} className="minha-compradores__item">
              <span className="minha-compradores__posicao">
                {formatarPosicao(item.posicao)}
              </span>{" "}
              <span className="minha-compradores__quem">
                <span className="minha-compradores__nome">
                  {item.nome ?? "Sem nome"}
                </span>
                {item.celula !== null && (
                  <>
                    {" "}
                    <span className="minha-compradores__celula">
                      {item.celula}
                    </span>
                  </>
                )}
              </span>{" "}
              <span className="minha-compradores__bilhetes">
                {bilhetes(item.bilhetes)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
