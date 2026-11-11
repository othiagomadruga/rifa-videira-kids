import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import type { RespostaMapaDdd } from "../../../shared/contracts/api";
import {
  NOMES_DIVISAO,
  ORDEM_DIVISOES,
} from "../../../shared/contracts/calculos";
import {
  Aviso,
  Button,
  EmptyState,
  ErrorState,
  Loading,
  Select,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import {
  formatarData,
  formatarHora,
  formatarMoeda,
} from "../../lib/formatadores";
import {
  PERIODOS,
  caminhoDoMapa,
  carregarMapa,
  ehSemCampanha,
  lerDivisao,
  lerFiltros,
  lerPeriodo,
  parametrosDosFiltros,
  type FiltrosMapa,
} from "./mapa-api";
import { MapaDoBrasil } from "./MapaDoBrasil";
import { TabelaDdd } from "./TabelaDdd";
import {
  TEXTO_PERIODO,
  temVenda,
  textoBilhetes,
  textoDaDivisao,
  textoPedidos,
} from "./textos";
import "./mapa.css";

type Resultado =
  | { tipo: "ok"; resposta: RespostaMapaDdd }
  | { tipo: "sem_campanha" }
  | { tipo: "erro"; erro: unknown };

/**
 * A resposta de uma consulta: o caminho identifica os filtros e `pedido`, qual pedido ela atendeu (o "Atualizar" e
 * o "Tentar de novo" fazem um pedido novo). `falhaAoAtualizar`: o "Atualizar" falhou e os números na tela são os
 * da resposta anterior.
 */
type Carga = {
  caminho: string;
  pedido: number;
  resultado: Resultado;
  falhaAoAtualizar: unknown;
};

// Mapa de vendas por DDD (RIFA-015, D17; só a coordenação, com valores): de onde vêm as vendas aprovadas, pelo DDD
// do telefone do comprador. Filtros de período e divisão na URL; nada se atualiza sozinho (a rota não tem cache e
// custa ~2 linhas do D1 por pedido aprovado): o botão "Atualizar" pede de novo, sem tirar os números da tela.
export function MapaDeVendas() {
  const [parametros, setParametros] = useSearchParams();
  const filtros = lerFiltros(parametros);
  const caminho = caminhoDoMapa(filtros);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [pedido, setPedido] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    carregarMapa(caminho, { signal: controle.signal }).then(
      (resposta) =>
        setCarga({
          caminho,
          pedido,
          resultado: { tipo: "ok", resposta },
          falhaAoAtualizar: null,
        }),
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setCarga((anterior) => {
          // O "Atualizar" falhou com os números na tela: eles ficam, com o aviso (a tela não cai).
          if (
            anterior?.caminho === caminho &&
            anterior.resultado.tipo === "ok" &&
            !ehSemCampanha(erro)
          ) {
            return { ...anterior, pedido, falhaAoAtualizar: erro };
          }
          return {
            caminho,
            pedido,
            resultado: ehSemCampanha(erro)
              ? { tipo: "sem_campanha" }
              : { tipo: "erro", erro },
            falhaAoAtualizar: null,
          };
        });
      },
    );
    return () => controle.abort();
  }, [caminho, pedido]);

  // Só vale a resposta dos filtros atuais (nunca o mapa de outro filtro).
  const atual = carga?.caminho === caminho ? carga : null;
  const respondido = atual?.pedido === pedido;
  const resultado = atual?.resultado ?? null;
  const resposta = resultado?.tipo === "ok" ? resultado.resposta : null;

  function mudarFiltros(mudanca: Partial<FiltrosMapa>) {
    setParametros(parametrosDosFiltros({ ...filtros, ...mudanca }), {
      replace: true,
    });
  }

  function pedirDeNovo() {
    setPedido((anterior) => anterior + 1);
  }

  return (
    <div className="pilha mapa-tela">
      {/* Região viva fixa: anuncia o resultado de cada consulta (filtro, "Atualizar"). */}
      <p className="visualmente-oculto" role="status">
        {atual && respondido ? anuncio(atual) : ""}
      </p>
      <div className="mapa-filtros">
        <Select
          rotulo="Período"
          value={filtros.periodo}
          onChange={(evento) =>
            mudarFiltros({ periodo: lerPeriodo(evento.target.value) })
          }
        >
          {PERIODOS.map((periodo) => (
            <option key={periodo} value={periodo}>
              {TEXTO_PERIODO[periodo]}
            </option>
          ))}
        </Select>
        <Select
          rotulo="Divisão"
          value={filtros.divisao ?? ""}
          onChange={(evento) =>
            mudarFiltros({ divisao: lerDivisao(evento.target.value) })
          }
        >
          <option value="">Todas</option>
          {ORDEM_DIVISOES.map((divisao) => (
            <option key={divisao} value={divisao}>
              {NOMES_DIVISAO[divisao]}
            </option>
          ))}
        </Select>
      </div>
      {filtros.divisao && (
        <p className="mapa-nota-divisao">
          Só as vendas das células da divisão {NOMES_DIVISAO[filtros.divisao]}:
          vendas sem célula ficam de fora.
        </p>
      )}
      <Conteudo
        resultado={respondido || resposta ? resultado : null}
        falhaAoAtualizar={atual?.falhaAoAtualizar ?? null}
        aoTentarDeNovo={pedirDeNovo}
        botaoAtualizar={
          // Sem atualização automática (D17): só este botão pede de novo, sem tirar os números da tela.
          <Button
            variante="secundario"
            className="mapa-atualizar"
            aria-disabled={respondido ? undefined : true}
            onClick={() => {
              if (respondido) pedirDeNovo();
            }}
          >
            {respondido ? "Atualizar" : "Atualizando…"}
          </Button>
        }
      />
    </div>
  );
}

type PropsConteudo = {
  /** null = carregando. */
  resultado: Resultado | null;
  falhaAoAtualizar: unknown;
  aoTentarDeNovo: () => void;
  /** Vai no resumo, ao lado da hora da consulta (só quando há números na tela). */
  botaoAtualizar: ReactNode;
};

function Conteudo({
  resultado,
  falhaAoAtualizar,
  aoTentarDeNovo,
  botaoAtualizar,
}: PropsConteudo) {
  if (resultado === null) return <Loading texto="Carregando o mapa…" />;
  if (resultado.tipo === "erro") {
    return (
      <ErrorState
        titulo="Não foi possível carregar o mapa."
        mensagem={mensagemDoErro(resultado.erro)}
        aoTentarDeNovo={aoTentarDeNovo}
      />
    );
  }
  if (resultado.tipo === "sem_campanha") {
    return (
      <EmptyState
        titulo="Nenhuma campanha ativa."
        descricao={
          <>
            O mapa mostra as vendas da campanha ativa. Configure a campanha em{" "}
            <Link to="/coordenacao/campanha">Campanha</Link>.
          </>
        }
      />
    );
  }

  const { resposta } = resultado;
  return (
    <>
      {falhaAoAtualizar !== null && (
        <Aviso
          tom="alerta"
          titulo="Não foi possível atualizar agora."
          anuncio="nenhum"
        >
          <p>{mensagemDoErro(falhaAoAtualizar)}</p>
          <p>
            Os números abaixo são os das {formatarHora(resposta.atualizado_em)}.
          </p>
        </Aviso>
      )}
      <Resumo resposta={resposta} botaoAtualizar={botaoAtualizar} />
      {temVenda(resposta.total) ? (
        <>
          <MapaDoBrasil resposta={resposta} />
          <TabelaDdd resposta={resposta} />
        </>
      ) : (
        <SemVendas resposta={resposta} />
      )}
    </>
  );
}

/** A janela (nome e datas), o total e a hora da consulta. */
function Resumo({
  resposta,
  botaoAtualizar,
}: {
  resposta: RespostaMapaDdd;
  botaoAtualizar: ReactNode;
}) {
  const { janela, total, atualizado_em } = resposta;
  return (
    <div className="mapa-resumo">
      <p className="mapa-resumo__janela">
        <strong>{janela.nome}</strong>: {formatarData(janela.data_inicio)} a{" "}
        {formatarData(janela.data_fim)}
        {resposta.divisao && `, divisão ${NOMES_DIVISAO[resposta.divisao]}`}
      </p>
      {temVenda(total) && (
        <p className="mapa-resumo__total">
          {textoPedidos(total.pedidos_aprovados)},{" "}
          {textoBilhetes(total.bilhetes)},{" "}
          <span className="mapa-valor">
            {formatarMoeda(total.total_centavos)}
          </span>
          .
        </p>
      )}
      <div className="mapa-resumo__rodape">
        <p className="mapa-resumo__hora">
          Atualizado às {formatarHora(atualizado_em)}. O mapa não se atualiza
          sozinho.
        </p>
        {botaoAtualizar}
      </div>
    </div>
  );
}

function SemVendas({ resposta }: { resposta: RespostaMapaDdd }) {
  const filtro =
    resposta.janela.tipo === "atual" || resposta.divisao
      ? ` (${resposta.janela.nome}${textoDaDivisao(resposta.divisao)})`
      : "";
  return (
    <EmptyState
      titulo={`Nenhuma venda aprovada ainda${filtro}.`}
      descricao={
        <>
          Quando a Rifei aprovar um pedido, ele aparece aqui pelo DDD do
          telefone do comprador. Se você esperava vendas, confira as entregas do
          webhook em <Link to="/coordenacao/pedidos">Pedidos</Link>.
        </>
      }
    />
  );
}

/** "Mapa da Campanha inteira, divisão Jovens: 1.234 pedidos aprovados. Atualizado às 15:30." */
function anuncio(carga: Carga): string {
  const { resultado } = carga;
  if (resultado.tipo !== "ok") return "";
  const { resposta } = resultado;
  if (carga.falhaAoAtualizar !== null) {
    return `Não foi possível atualizar agora. Os números continuam os das ${formatarHora(resposta.atualizado_em)}.`;
  }
  return `Mapa da ${resposta.janela.nome}${textoDaDivisao(resposta.divisao)}: ${textoPedidos(resposta.total.pedidos_aprovados)}. Atualizado às ${formatarHora(resposta.atualizado_em)}.`;
}
