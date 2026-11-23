import { useEffect, useState } from "react";
import type {
  ItemMaiorComprador,
  RespostaMaioresCompradores,
} from "../../../shared/contracts/api";
import type { JanelaRanking } from "../../../shared/contracts/calculos";
import {
  Button,
  Card,
  ComDica,
  ErrorState,
  Loading,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { formatarData, formatarMoeda } from "../../lib/formatadores";
import { ajuda } from "../ajuda-sob-demanda";
import { JANELAS } from "./filtros";
import { carregarMaioresCompradores } from "./maiores-compradores-api";
import {
  DICAS,
  TEXTO_JANELA_COMPRADORES,
  formatarPosicao,
  semCompras,
  textoDasCelulas,
  textoDosBilhetes,
} from "./textos";

type Resultado =
  | { tipo: "ok"; resposta: RespostaMaioresCompradores }
  | { tipo: "erro"; erro: unknown };

/** O resultado da janela pedida (a troca de janela nunca mostra a lista da outra). */
type Carga = { janela: JanelaRanking; resultado: Resultado };

// Os maiores compradores (RIFA-083, D38), SÓ para o admin (a RankingsPage nem monta o bloco para a coordenação): a
// troca "Esta semana" / "Campanha toda" e os 10 que mais compraram, com a posição, o nome, as células, os bilhetes, o
// total pago e o telefone com o link do WhatsApp (como a coluna Comprador de Pedidos, D36). Sem campanha ativa, o
// ranking acima já explica; aqui fica só o vazio.
export function MaioresCompradores() {
  const [janela, setJanela] = useState<JanelaRanking>("atual");
  const [carga, setCarga] = useState<Carga | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    carregarMaioresCompradores(janela, { signal: controle.signal }).then(
      (resposta) => {
        if (controle.signal.aborted) return;
        setCarga({ janela, resultado: { tipo: "ok", resposta } });
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setCarga({ janela, resultado: { tipo: "erro", erro } });
      },
    );
    return () => controle.abort();
  }, [janela, tentativa]);

  const resultado = carga?.janela === janela ? carga.resultado : null;

  return (
    <Card
      titulo="Maiores compradores"
      ajuda={ajuda("maioresCompradores")}
      className="rankings-compradores"
    >
      <div className="rankings-compradores__corpo">
        <p className="rankings-compradores__descricao">
          Quem mais comprou bilhetes, com o telefone para agradecer. Só o
          administrador vê esta lista.
        </p>
        <div
          className="rankings-compradores__janelas"
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

function Lista({ resposta }: { resposta: RespostaMaioresCompradores }) {
  const { janela, itens } = resposta;
  const nome = janela.tipo === "campanha" ? "Campanha inteira" : janela.nome;
  return (
    <>
      <p className="rankings-compradores__janela">
        <strong>{nome}</strong>: {formatarData(janela.data_inicio)} a{" "}
        {formatarData(janela.data_fim)}
      </p>
      {itens.length === 0 ? (
        <p className="rankings-compradores__vazio">{semCompras(janela.tipo)}</p>
      ) : (
        <ol className="rankings-compradores__lista">
          {itens.map((item, indice) => (
            <Comprador key={indice} item={item} />
          ))}
        </ol>
      )}
    </>
  );
}

function Comprador({ item }: { item: ItemMaiorComprador }) {
  return (
    <li className="rankings-comprador">
      <span className="rankings-comprador__posicao">
        {formatarPosicao(item.posicao)}
      </span>{" "}
      <span className="rankings-comprador__quem">
        <span
          className={
            item.nome === null
              ? "rankings-comprador__sem"
              : "rankings-comprador__nome"
          }
        >
          {item.nome ?? "Sem nome"}
        </span>{" "}
        <span className="rankings-comprador__celulas">
          {textoDasCelulas(item.celulas, item.sem_celula)}
        </span>{" "}
        {item.telefone !== null && item.whatsapp !== null ? (
          <ComDica texto={DICAS.whatsapp}>
            <a
              className="rankings-comprador__telefone"
              href={`https://wa.me/${item.whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {item.telefone}
              <span className="visualmente-oculto">
                {" "}
                (abre o WhatsApp em outra aba)
              </span>
            </a>
          </ComDica>
        ) : (
          <span className="rankings-comprador__sem">Sem telefone</span>
        )}
      </span>{" "}
      <span className="rankings-comprador__numeros">
        <span className="rankings-comprador__bilhetes">
          {textoDosBilhetes(item.bilhetes)}
        </span>{" "}
        <span className="rankings-comprador__total">
          {formatarMoeda(item.total_centavos)}
        </span>
      </span>
    </li>
  );
}
