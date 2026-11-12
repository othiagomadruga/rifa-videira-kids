import { useRef } from "react";
import type {
  EntregaWebhook,
  RespostaEntregasWebhook,
} from "../../../shared/contracts";
import {
  Aviso,
  Badge,
  Button,
  ComDica,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  Select,
  type ColunaTabela,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { formatarDataHora } from "../../lib/formatadores";
import {
  HORA_FIM_ALERTA,
  HORA_INICIO_ALERTA,
  HORAS_SEM_ENTREGA_ALERTA,
} from "./alerta-webhook";
import {
  RESULTADOS_ENTREGA,
  carregarEntregas,
  ehCursorInvalido,
  ehSemPermissao,
  filtrosDasEntregas,
  paramsDasEntregas,
  type FiltrosEntregas,
} from "./pedidos-api";
import {
  DICAS,
  RESULTADO,
  ROTULO_FILTRO_RESULTADO,
  ROTULO_RECUSA,
  entregas,
  rotuloDoEvento,
  textoDoDetalhe,
  transicao,
} from "./textos";
import {
  usePaginas,
  type ConfigPaginas,
  type EstadoPaginas,
} from "./usePaginas";

/** Id do bloco "Quando" de uma entrega: o foco vai para a primeira entrega nova depois de "Carregar mais". */
export const idDaEntrega = (id: number) => `entrega-${id}`;
/** A linha do fim da lista: recebe o foco se a página seguinte vier vazia (o botão some). */
export const ID_FIM_DAS_ENTREGAS = "entregas-fim";

const CONFIG: ConfigPaginas<EntregaWebhook, number, RespostaEntregasWebhook> = {
  carregar: (consulta, cursor, signal) =>
    carregarEntregas(
      filtrosDasEntregas(new URLSearchParams(consulta)),
      cursor,
      { signal },
    ),
  idDoItem: (entrega) => entrega.id,
  idDoFoco: (entrega) => idDaEntrega(entrega.id),
  idDoFim: ID_FIM_DAS_ENTREGAS,
  anunciarMais: (novas, fim) =>
    `${entregas(novas)} a mais na lista.${fim ? " Não há entregas mais antigas." : ""}`,
  anunciarPrimeira: ({ itens, proximo }) =>
    itens.length === 0
      ? "Lista atualizada: nenhuma entrega com este resultado."
      : `Lista atualizada: ${entregas(itens.length)}${proximo === null ? "" : " e há mais"}.`,
  cursorInvalido: ehCursorInvalido,
};

type Props = {
  filtros: FiltrosEntregas;
  aoMudar: (filtros: FiltrosEntregas) => void;
};

// Entregas do webhook (coordenação): cada entrega autenticada da Rifei, da mais nova para a mais antiga, com o
// resultado em português, a transição de status e o erro e os avisos legíveis (a API manda só campo, código e
// ocorrências: nunca a mensagem gravada nem dado pessoal). Filtro por resultado e "Carregar mais" pelo cursor.
export function EntregasWebhook({ filtros, aoMudar }: Props) {
  const consulta = new URLSearchParams(paramsDasEntregas(filtros)).toString();
  const { estado, mais, anuncio, carregarMais, tentarDeNovo } = usePaginas(
    consulta,
    CONFIG,
  );
  const filtroResultado = useRef<HTMLSelectElement>(null);

  function verTodas() {
    // O "Ver todas as entregas" some com a lista vazia: o foco vai para o filtro de resultado.
    filtroResultado.current?.focus();
    aoMudar({ resultado: null });
  }

  return (
    <div className="pedidos">
      <p className="visualmente-oculto" role="status">
        {anuncio}
      </p>
      <p className="pedidos-explicacao">
        Cada vez que a Rifei avisa o sistema de um pedido novo, pago ou
        expirado, a entrega aparece aqui com o que o sistema fez. O aviso de
        webhook parado acende com mais de {HORAS_SEM_ENTREGA_ALERTA} h sem venda
        entre {HORA_INICIO_ALERTA}h e {HORA_FIM_ALERTA}h (horário de Belém), nos
        dias da campanha, ou quando chega pedido com erro.
      </p>
      <div className="pedidos-filtros">
        <ComDica texto={DICAS.filtroResultado}>
          <Select
            ref={filtroResultado}
            rotulo="Resultado"
            value={filtros.resultado ?? ""}
            onChange={(evento) =>
              aoMudar({
                resultado:
                  RESULTADOS_ENTREGA.find(
                    (resultado) => resultado === evento.target.value,
                  ) ?? null,
              })
            }
          >
            <option value="">Todos os resultados</option>
            {RESULTADOS_ENTREGA.map((resultado) => (
              <option key={resultado} value={resultado}>
                {ROTULO_FILTRO_RESULTADO[resultado]}
              </option>
            ))}
          </Select>
        </ComDica>
      </div>
      <Conteudo
        estado={estado}
        filtrado={filtros.resultado !== null}
        mais={mais}
        aoCarregarMais={() => void carregarMais()}
        aoTentarDeNovo={tentarDeNovo}
        aoLimpar={verTodas}
      />
    </div>
  );
}

function Conteudo({
  estado,
  filtrado,
  mais,
  aoCarregarMais,
  aoTentarDeNovo,
  aoLimpar,
}: {
  estado: EstadoPaginas<EntregaWebhook, number, RespostaEntregasWebhook>;
  filtrado: boolean;
  mais: { carregando: boolean; erro: unknown };
  aoCarregarMais: () => void;
  aoTentarDeNovo: () => void;
  aoLimpar: () => void;
}) {
  if (estado.tipo === "carregando") {
    return <Loading texto="Carregando as entregas…" />;
  }
  if (estado.tipo === "erro") {
    return ehSemPermissao(estado.erro) ? (
      <Aviso tom="alerta" titulo="Sem permissão para ver as entregas">
        <p>
          A lista é da coordenação. Se o seu papel mudou, saia e entre de novo
          pelo seu link.
        </p>
      </Aviso>
    ) : (
      <ErrorState
        titulo="Não foi possível carregar as entregas."
        mensagem={mensagemDoErro(estado.erro)}
        aoTentarDeNovo={aoTentarDeNovo}
      />
    );
  }

  const { itens, proximo, inicioDaUltima } = estado;
  if (itens.length === 0) {
    return filtrado ? (
      <EmptyState
        titulo="Nenhuma entrega com este resultado."
        acao={
          <ComDica texto={DICAS.verTodasAsEntregas}>
            <Button variante="secundario" onClick={aoLimpar}>
              Ver todas as entregas
            </Button>
          </ComDica>
        }
      />
    ) : (
      <EmptyState
        titulo="Nenhuma entrega do webhook ainda."
        descricao="Quando a Rifei mandar o primeiro pedido, a entrega aparece aqui."
      />
    );
  }

  return (
    <>
      <TabelaEntregas itens={itens} inicioDaUltima={inicioDaUltima} />
      <div className="pedidos-rodape">
        <p id={ID_FIM_DAS_ENTREGAS} tabIndex={-1} className="pedidos-contagem">
          {proximo === null
            ? `${entregas(itens.length)}; não há entregas mais antigas.`
            : `Mostrando ${entregas(itens.length)}; há entregas mais antigas.`}
        </p>
        {mais.erro !== null && (
          <Aviso tom="perigo" titulo="Não foi possível carregar mais entregas">
            <p>{mensagemDoErro(mais.erro)}</p>
          </Aviso>
        )}
        {proximo !== null && (
          <ComDica
            texto={
              mais.carregando ? DICAS.carregando : DICAS.carregarMaisEntregas
            }
          >
            <Button
              variante="secundario"
              aria-disabled={mais.carregando || undefined}
              onClick={aoCarregarMais}
            >
              {mais.carregando ? "Carregando…" : "Carregar mais"}
            </Button>
          </ComDica>
        )}
      </div>
    </>
  );
}

function Transicao({ entrega }: { entrega: EntregaWebhook }) {
  const mudanca = transicao(entrega);
  switch (mudanca.tipo) {
    case "nenhuma":
      return <span className="pedidos-suave">Nenhuma</span>;
    case "novo":
      return <>Novo: {mudanca.status}</>;
    case "igual":
      return <>Continua {mudanca.status}</>;
    case "mudou":
      return (
        <>
          {mudanca.de}{" "}
          <span aria-hidden="true" className="pedidos-seta">
            →
          </span>
          {/* O leitor de tela ouve "de ... para ..." (a seta fica só na tela). */}
          <span className="visualmente-oculto">{" para"}</span> {mudanca.para}
        </>
      );
  }
}

function ErroEAvisos({ entrega }: { entrega: EntregaWebhook }) {
  const { erro, avisos } = entrega;
  // A recusa sem campo (JSON inválido, corpo grande demais) já está no título: não se repete na lista.
  const problemas =
    erro?.problemas.filter(
      ({ campo, codigo }) => !(campo === "" && codigo === erro.codigo),
    ) ?? [];
  if (erro === null && avisos.length === 0) {
    return <span className="pedidos-suave">Nenhum</span>;
  }
  return (
    <>
      {erro && (
        <div className="pedidos-detalhes pedidos-detalhes--erro">
          <p className="pedidos-detalhes__titulo">
            Erro: {ROTULO_RECUSA[erro.codigo]}
          </p>
          {problemas.length > 0 && (
            <ul>
              {problemas.map((problema, indice) => (
                <li key={`${problema.campo}-${problema.codigo}-${indice}`}>
                  {textoDoDetalhe(problema)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {avisos.length > 0 && (
        <div className="pedidos-detalhes pedidos-detalhes--aviso">
          <p className="pedidos-detalhes__titulo">
            {avisos.length === 1 ? "Aviso" : "Avisos"}
          </p>
          <ul>
            {avisos.map((aviso, indice) => (
              <li key={`${aviso.campo}-${aviso.codigo}-${indice}`}>
                {textoDoDetalhe(aviso)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function TabelaEntregas({
  itens,
  inicioDaUltima,
}: {
  itens: EntregaWebhook[];
  inicioDaUltima: number | null;
}) {
  const novas = new Set(
    inicioDaUltima === null
      ? []
      : itens.slice(inicioDaUltima).map((entrega) => entrega.id),
  );
  const bloco = (entrega: EntregaWebhook, classe = "") =>
    `pedidos-celula${classe ? ` ${classe}` : ""}${novas.has(entrega.id) ? " pedidos-celula--nova" : ""}`;

  const colunas: ColunaTabela<EntregaWebhook>[] = [
    {
      chave: "quando",
      titulo: "Quando",
      principal: true,
      celula: (entrega) => (
        <span
          id={idDaEntrega(entrega.id)}
          tabIndex={-1}
          className={bloco(entrega, "pedidos-quando")}
        >
          <time dateTime={entrega.recebido_em}>
            {formatarDataHora(entrega.recebido_em)}
          </time>
        </span>
      ),
    },
    {
      chave: "evento",
      titulo: "Evento",
      celula: (entrega) => (
        <span className={bloco(entrega)}>{rotuloDoEvento(entrega.evento)}</span>
      ),
    },
    {
      chave: "pedido",
      titulo: "Pedido",
      celula: (entrega) => (
        <span className={bloco(entrega, "pedidos-pedido__id")}>
          {entrega.pedido_id ?? <span className="pedidos-suave">Não lido</span>}
        </span>
      ),
    },
    {
      chave: "slug",
      titulo: "Slug",
      celula: (entrega) => (
        <span className={bloco(entrega, "pedidos-slug")}>
          {entrega.slug ?? <span className="pedidos-suave">Não lido</span>}
        </span>
      ),
    },
    {
      chave: "resultado",
      titulo: "Resultado",
      celula: (entrega) => {
        const { rotulo, tom, explicacao } = RESULTADO[entrega.resultado];
        return (
          <span className={bloco(entrega, "pedidos-resultado")}>
            <Badge tom={tom}>{rotulo}</Badge>
            {explicacao && (
              <span className="pedidos-resultado__explicacao">
                {explicacao}
              </span>
            )}
          </span>
        );
      },
    },
    {
      chave: "status",
      titulo: "Status",
      celula: (entrega) => (
        <span className={bloco(entrega)}>
          <Transicao entrega={entrega} />
        </span>
      ),
    },
    {
      chave: "detalhes",
      titulo: "Erro e avisos",
      celula: (entrega) => (
        <div className={bloco(entrega, "pedidos-texto-longo")}>
          <ErroEAvisos entrega={entrega} />
        </div>
      ),
    },
  ];

  return (
    <DataTable
      colunas={colunas}
      linhas={itens}
      chaveDaLinha={(entrega) => entrega.id}
      legenda="Entregas do webhook, da mais recente para a mais antiga"
    />
  );
}
