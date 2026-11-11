import { useEffect, useState } from "react";
import type {
  PedidoSuspeito,
  RespostaPedidosSuspeitos,
} from "../../../shared/contracts";
import {
  Aviso,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  type ColunaTabela,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import {
  formatarDataHora,
  formatarMoeda,
  formatarNumero,
} from "../../lib/formatadores";
import {
  carregarPedidosSuspeitos,
  ehSemPermissao,
} from "./pedidos-suspeitos-api";
import {
  pedidosMarcados,
  seloDesconsiderado,
  textoDaCelula,
  textoDoMotivo,
} from "./textos";
import "./pedidos-suspeitos.css";

type Carga =
  | { tipo: "carregando" }
  | { tipo: "erro"; erro: unknown }
  | { tipo: "ok"; resposta: RespostaPedidosSuspeitos };

const COLUNAS: ColunaTabela<PedidoSuspeito>[] = [
  {
    chave: "pedido",
    titulo: "Pedido",
    principal: true,
    celula: (pedido) => (
      <span className="suspeitos-celula suspeitos-pedido">
        <span className="suspeitos-pedido__id">{pedido.pedido_id}</span>
        {pedido.desconsiderado && (
          <span className="suspeitos-desconsiderado">
            {seloDesconsiderado(pedido.desconsiderado.motivo)}
          </span>
        )}
      </span>
    ),
  },
  {
    chave: "quando",
    titulo: "Quando",
    celula: (pedido) =>
      pedido.aprovado_em ? (
        <time dateTime={pedido.aprovado_em} className="suspeitos-celula">
          {formatarDataHora(pedido.aprovado_em)}
        </time>
      ) : (
        <span className="suspeitos-celula">
          Marcado em{" "}
          <time dateTime={pedido.marcado_em}>
            {formatarDataHora(pedido.marcado_em)}
          </time>
        </span>
      ),
  },
  {
    chave: "celula",
    titulo: "Célula",
    celula: (pedido) => (
      <span className="suspeitos-celula">{textoDaCelula(pedido)}</span>
    ),
  },
  {
    chave: "bilhetes",
    titulo: "Bilhetes",
    alinhamento: "fim",
    celula: (pedido) => (
      <span className="suspeitos-celula">
        {formatarNumero(pedido.qtd_bilhetes)}
      </span>
    ),
  },
  {
    chave: "total",
    titulo: "Total",
    alinhamento: "fim",
    celula: (pedido) => (
      <span className="suspeitos-celula suspeitos-valor">
        {formatarMoeda(pedido.total_centavos)}
      </span>
    ),
  },
  {
    chave: "motivos",
    titulo: "Motivos",
    celula: (pedido) => (
      <ul className="suspeitos-celula suspeitos-motivos">
        {pedido.motivos.map((motivo, indice) => {
          const { rotulo, detalhe } = textoDoMotivo(motivo, pedido);
          return (
            <li key={`${motivo.codigo}-${indice}`} className="suspeitos-motivo">
              <span className="suspeitos-motivo__rotulo">{rotulo}</span>{" "}
              <span className="suspeitos-motivo__detalhe">{detalhe}</span>
            </li>
          );
        })}
      </ul>
    ),
  },
];

// Lista de revisão dos pedidos suspeitos: pedido, quando foi aprovado (no fuso da campanha), a célula para a
// qual ele conta, bilhetes, total e os motivos da marcação, cada um com o detalhe. Sem dado do comprador (a
// API não manda). Até 500 pedidos (os mais recentes); a contagem diz quantos existem.
export function ListaPedidosSuspeitos() {
  const [carga, setCarga] = useState<Carga>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    carregarPedidosSuspeitos({ signal: controle.signal }).then(
      (resposta) => setCarga({ tipo: "ok", resposta }),
      (erro: unknown) => {
        if (!controle.signal.aborted) setCarga({ tipo: "erro", erro });
      },
    );
    return () => controle.abort();
  }, [tentativa]);

  if (carga.tipo === "carregando") {
    return <Loading texto="Carregando os pedidos marcados…" />;
  }
  if (carga.tipo === "erro") {
    return ehSemPermissao(carga.erro) ? (
      <Aviso tom="alerta" titulo="Sem permissão para ver os pedidos suspeitos">
        <p>
          A lista é da coordenação. Se o seu papel mudou, saia e entre de novo
          pelo seu link.
        </p>
      </Aviso>
    ) : (
      <ErrorState
        titulo="Não foi possível carregar os pedidos suspeitos."
        mensagem={mensagemDoErro(carga.erro)}
        aoTentarDeNovo={() => {
          setCarga({ tipo: "carregando" });
          setTentativa((atual) => atual + 1);
        }}
      />
    );
  }

  const { itens, total } = carga.resposta;
  if (itens.length === 0) {
    return (
      <EmptyState
        titulo="Nenhum pedido marcado."
        descricao="Quando um pedido aprovado vier com bilhetes demais ou com o total fora de bilhetes × preço do bilhete, ele aparece aqui."
      />
    );
  }

  return (
    <div className="suspeitos">
      <p className="suspeitos-contagem">
        {pedidosMarcados(total)}
        {itens.length < total &&
          `; mostrando ${itens.length === 1 ? "o mais recente" : `os ${formatarNumero(itens.length)} mais recentes`}`}
        .
      </p>
      <DataTable
        colunas={COLUNAS}
        linhas={itens}
        chaveDaLinha={(pedido) => pedido.pedido_id}
        legenda="Pedidos suspeitos, o mais recente primeiro"
      />
    </div>
  );
}
