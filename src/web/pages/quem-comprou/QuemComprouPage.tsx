import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import { Link, useSearchParams } from "react-router";
import type {
  CelulaQuemComprou,
  ItemCompradorDaCelula,
} from "../../../shared/contracts/api";
import {
  Button,
  ComDica,
  EmptyState,
  ErrorState,
  Icone,
  Input,
  Loading,
  PageHeader,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { ajuda } from "../ajuda-sob-demanda";
import { DICA_DO_MENU } from "../coordenacao/textos";
import { numeroDoWhatsApp, telefoneLegivel } from "../pedidos/comprador";
import {
  caminhoDosPedidosDaCelula,
  carregarCelulas,
  carregarCompradores,
  ehSemCampanha,
} from "./quem-comprou-api";
import {
  COMPRADOR_SEM_NOME,
  DICAS,
  bilhetes,
  compras,
  paraBusca,
  quandoComprou,
} from "./textos";
import "./quem-comprou.css";

type EstadoDasCelulas =
  | { tipo: "carregando" }
  | { tipo: "erro"; erro: unknown }
  | { tipo: "sem_campanha" }
  | { tipo: "ok"; celulas: CelulaQuemComprou[] };

/** Lê `?celula=<id>` (a célula aberta); qualquer outra coisa = nenhuma. */
function celulaDaUrl(parametros: URLSearchParams): number | null {
  const texto = parametros.get("celula");
  if (texto === null || !/^[1-9]\d{0,9}$/.test(texto)) return null;
  return Number(texto);
}

// Quem comprou (RIFA-093, adendo da D36; só o admin): todas as células em cartões compactos, de mais bilhetes para
// menos, com a busca pelo nome no topo. Tocar no cartão abre ali mesmo as compras pagas da célula (uma aberta por vez):
// nome, dia e hora no fuso da campanha, bilhetes e o telefone com o link do WhatsApp, como em Pedidos. A célula aberta
// fica na URL (`?celula=<id>`): o toque na célula em Rankings e na Hierarquia chega com ela aberta. Sem R$, sem DDD e
// sem o id do pedido na lista; "Abrir em Pedidos" leva à tela Pedidos filtrada pela célula.
export function QuemComprouPage() {
  const [parametros, setParametros] = useSearchParams();
  const aberta = celulaDaUrl(parametros);
  const [estado, setEstado] = useState<EstadoDasCelulas>({
    tipo: "carregando",
  });
  const [tentativa, setTentativa] = useState(0);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    const controle = new AbortController();
    carregarCelulas({ signal: controle.signal }).then(
      (resposta) => {
        if (controle.signal.aborted) return;
        setEstado({ tipo: "ok", celulas: resposta.celulas });
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setEstado(
          ehSemCampanha(erro)
            ? { tipo: "sem_campanha" }
            : { tipo: "erro", erro },
        );
      },
    );
    return () => controle.abort();
  }, [tentativa]);

  function alternar(celulaId: number) {
    setParametros(
      (atuais) => {
        const novos = new URLSearchParams(atuais);
        if (celulaDaUrl(atuais) === celulaId) novos.delete("celula");
        else novos.set("celula", String(celulaId));
        return novos;
      },
      { replace: true },
    );
  }

  return (
    <>
      <PageHeader
        titulo="Quem comprou"
        ajuda={DICA_DO_MENU["quem-comprou"]}
        descricao="Toque numa célula para ver quem comprou, com o telefone para agradecer. Só o administrador vê esta tela."
      />
      {estado.tipo === "carregando" ? (
        <Loading texto="Carregando as células…" />
      ) : estado.tipo === "erro" ? (
        <ErrorState
          titulo="Não foi possível carregar as células."
          mensagem={mensagemDoErro(estado.erro)}
          conexao={ehFalhaDeConexao(estado.erro)}
          aoTentarDeNovo={() => {
            setEstado({ tipo: "carregando" });
            setTentativa((atual) => atual + 1);
          }}
        />
      ) : estado.tipo === "sem_campanha" ? (
        <EmptyState
          titulo="Nenhuma campanha ativa."
          descricao={
            <>
              As compras aparecem quando houver uma campanha ativa. Configure em{" "}
              <Link to="/coordenacao/campanha">Campanha</Link>.
            </>
          }
        />
      ) : (
        <ListaDeCelulas
          celulas={estado.celulas}
          aberta={aberta}
          busca={busca}
          aoBuscar={setBusca}
          aoAlternar={alternar}
        />
      )}
    </>
  );
}

function ListaDeCelulas({
  celulas,
  aberta,
  busca,
  aoBuscar,
  aoAlternar,
}: {
  celulas: readonly CelulaQuemComprou[];
  aberta: number | null;
  busca: string;
  aoBuscar: (texto: string) => void;
  aoAlternar: (celulaId: number) => void;
}) {
  const termo = paraBusca(busca);
  const visiveis =
    termo === ""
      ? celulas
      : celulas.filter((celula) => paraBusca(celula.nome).includes(termo));
  // A célula que veio aberta pela URL (Rankings, Hierarquia) aparece na tela: rola até ela uma vez.
  const rolou = useRef(false);
  const refAberta = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (rolou.current || aberta === null) return;
    rolou.current = true;
    refAberta.current?.scrollIntoView?.({ block: "start" });
  }, [aberta]);

  return (
    <div className="quem-comprou">
      <div className="quem-comprou__busca">
        <Input
          ajuda={ajuda("buscaQuemComprou")}
          rotulo="Buscar célula"
          type="search"
          autoComplete="off"
          value={busca}
          onChange={(evento) => aoBuscar(evento.currentTarget.value)}
        />
      </div>
      <p className="quem-comprou__contagem" role="status">
        {termo === ""
          ? `${celulas.length.toLocaleString("pt-BR")} ${celulas.length === 1 ? "célula" : "células"}, de quem vendeu mais para quem vendeu menos`
          : `${visiveis.length.toLocaleString("pt-BR")} de ${celulas.length.toLocaleString("pt-BR")} células`}
      </p>
      {celulas.length === 0 ? (
        <EmptyState
          titulo="Nenhuma célula cadastrada."
          descricao={
            <>
              Cadastre as células em{" "}
              <Link to="/coordenacao/hierarquia">Hierarquia</Link>.
            </>
          }
        />
      ) : visiveis.length === 0 ? (
        <EmptyState
          titulo="Nenhuma célula com esse nome."
          acao={
            <ComDica texto={DICAS.limparBusca}>
              <Button variante="secundario" onClick={() => aoBuscar("")}>
                Limpar busca
              </Button>
            </ComDica>
          }
        />
      ) : (
        <ul className="quem-comprou__celulas">
          {visiveis.map((celula) => (
            <CartaoDaCelula
              key={celula.id}
              celula={celula}
              aberta={celula.id === aberta}
              refDoItem={celula.id === aberta ? refAberta : undefined}
              aoAlternar={() => aoAlternar(celula.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CartaoDaCelula({
  celula,
  aberta,
  refDoItem,
  aoAlternar,
}: {
  celula: CelulaQuemComprou;
  aberta: boolean;
  refDoItem?: Ref<HTMLLIElement>;
  aoAlternar: () => void;
}) {
  const idPainel = useId();
  return (
    <li
      ref={refDoItem}
      className="quem-comprou-celula"
      data-aberta={aberta ? "" : undefined}
    >
      <ComDica texto={aberta ? DICAS.fechar : DICAS.abrir}>
        <button
          type="button"
          className="quem-comprou-celula__cabeca"
          aria-expanded={aberta}
          aria-controls={aberta ? idPainel : undefined}
          onClick={aoAlternar}
        >
          <span className="quem-comprou-celula__textos">
            <span className="quem-comprou-celula__nome">{celula.nome}</span>
            <span className="visualmente-oculto">,</span>{" "}
            <span className="quem-comprou-celula__discipulador">
              {celula.discipulador}
            </span>
          </span>
          <span className="visualmente-oculto">,</span>{" "}
          <span className="quem-comprou-celula__totais">
            {bilhetes(celula.bilhetes)} · {compras(celula.pedidos)}
          </span>
          <Icone nome="abrir" className="quem-comprou-celula__seta" />
        </button>
      </ComDica>
      {aberta && (
        <div
          id={idPainel}
          className="quem-comprou-celula__painel"
          role="region"
          aria-label={`Compras da ${celula.nome}`}
        >
          <ComprasDaCelula celulaId={celula.id} />
        </div>
      )}
    </li>
  );
}

type EstadoDasCompras =
  | { tipo: "carregando" }
  | { tipo: "erro"; erro: unknown }
  | {
      tipo: "ok";
      fuso: string;
      itens: ItemCompradorDaCelula[];
      proximo: string | null;
      /** Onde começa o que o último "Ver mais" trouxe (recebe o foco); null na primeira página. */
      inicioDaUltima: number | null;
    };

// As compras pagas da célula aberta: a primeira página ao abrir e o "Ver mais" no fim. Fechar o cartão desmonta a lista
// (abrir de novo traz as compras de agora).
function ComprasDaCelula({ celulaId }: { celulaId: number }) {
  const [estado, setEstado] = useState<EstadoDasCompras>({
    tipo: "carregando",
  });
  const [tentativa, setTentativa] = useState(0);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [falhaNoMais, setFalhaNoMais] = useState<string | null>(null);
  const emAndamento = useRef(false);
  const refPrimeiroNovo = useRef<HTMLLIElement>(null);
  const focarNovo = useRef(false);

  useEffect(() => {
    const controle = new AbortController();
    carregarCompradores(celulaId, null, { signal: controle.signal }).then(
      (resposta) => {
        if (controle.signal.aborted) return;
        setEstado({
          tipo: "ok",
          fuso: resposta.fuso_horario,
          itens: resposta.itens,
          proximo: resposta.proximo,
          inicioDaUltima: null,
        });
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setEstado({ tipo: "erro", erro });
      },
    );
    return () => controle.abort();
  }, [celulaId, tentativa]);

  // Depois do "Ver mais", o foco vai para a primeira compra nova (o botão pode sumir na última página).
  useLayoutEffect(() => {
    if (!focarNovo.current) return;
    focarNovo.current = false;
    refPrimeiroNovo.current?.focus();
  });

  async function verMais() {
    if (estado.tipo !== "ok" || estado.proximo === null || emAndamento.current)
      return;
    emAndamento.current = true;
    setCarregandoMais(true);
    setFalhaNoMais(null);
    try {
      const resposta = await carregarCompradores(celulaId, estado.proximo);
      setEstado((anterior) =>
        anterior.tipo !== "ok"
          ? anterior
          : {
              ...anterior,
              itens: [...anterior.itens, ...resposta.itens],
              proximo: resposta.proximo,
              inicioDaUltima:
                resposta.itens.length > 0
                  ? anterior.itens.length
                  : anterior.inicioDaUltima,
            },
      );
      if (resposta.itens.length > 0) focarNovo.current = true;
    } catch (erro) {
      setFalhaNoMais(mensagemDoErro(erro));
    } finally {
      emAndamento.current = false;
      setCarregandoMais(false);
    }
  }

  if (estado.tipo === "carregando")
    return <Loading texto="Carregando as compras…" />;
  if (estado.tipo === "erro")
    return (
      <ErrorState
        titulo="Não foi possível carregar as compras."
        mensagem={mensagemDoErro(estado.erro)}
        conexao={ehFalhaDeConexao(estado.erro)}
        aoTentarDeNovo={() => {
          setEstado({ tipo: "carregando" });
          setTentativa((atual) => atual + 1);
        }}
      />
    );

  return (
    <>
      {estado.itens.length === 0 ? (
        <p className="quem-comprou-celula__vazio">
          Ainda não há compras pagas desta célula.
        </p>
      ) : (
        <ol className="quem-comprou-compras">
          {estado.itens.map((item, indice) => (
            <Compra
              key={item.pedido_id}
              item={item}
              fuso={estado.fuso}
              refDoItem={
                indice === estado.inicioDaUltima ? refPrimeiroNovo : undefined
              }
            />
          ))}
        </ol>
      )}
      {estado.proximo !== null && (
        <ComDica texto={carregandoMais ? DICAS.carregandoMais : DICAS.verMais}>
          <Button
            variante="secundario"
            larguraTotal
            aria-disabled={carregandoMais || undefined}
            onClick={() => void verMais()}
          >
            {carregandoMais ? "Carregando…" : "Ver mais"}
          </Button>
        </ComDica>
      )}
      {/* Região viva fixa: avisa quando o "Ver mais" falha. */}
      <p className="quem-comprou-celula__falha" role="status">
        {falhaNoMais
          ? `Não foi possível trazer mais compras: ${falhaNoMais}`
          : ""}
      </p>
      <Link
        className="quem-comprou-celula__pedidos"
        to={caminhoDosPedidosDaCelula(celulaId)}
      >
        Abrir em Pedidos
      </Link>
    </>
  );
}

function Compra({
  item,
  fuso,
  refDoItem,
}: {
  item: ItemCompradorDaCelula;
  fuso: string;
  refDoItem?: Ref<HTMLLIElement>;
}) {
  const whatsapp =
    item.telefone === null ? null : numeroDoWhatsApp(item.telefone);
  return (
    <li
      ref={refDoItem}
      tabIndex={refDoItem ? -1 : undefined}
      className="quem-comprou-compra"
    >
      <span className="quem-comprou-compra__quem">
        <span
          className={
            item.nome === null
              ? "quem-comprou-compra__nome quem-comprou-compra__nome--sem"
              : "quem-comprou-compra__nome"
          }
        >
          {item.nome ?? COMPRADOR_SEM_NOME}
        </span>{" "}
        <span className="quem-comprou-compra__detalhes">
          <time dateTime={item.aprovado_em}>
            {quandoComprou(item.aprovado_em, fuso)}
          </time>
          {item.origem_celula === "manual" && (
            <>
              {" · "}
              <span className="quem-comprou-compra__manual">
                atribuída à mão
              </span>
            </>
          )}
        </span>
      </span>{" "}
      <span className="quem-comprou-compra__bilhetes">
        {bilhetes(item.bilhetes)}
      </span>
      {item.telefone !== null && (
        <>
          {" "}
          {whatsapp !== null ? (
            <ComDica texto={DICAS.whatsapp}>
              <a
                className="quem-comprou-compra__telefone"
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icone nome="conversa" />
                {telefoneLegivel(item.telefone)}
                <span className="visualmente-oculto">
                  {" "}
                  (abre o WhatsApp em outra aba)
                </span>
              </a>
            </ComDica>
          ) : (
            <span className="quem-comprou-compra__telefone">
              {telefoneLegivel(item.telefone)}
            </span>
          )}
        </>
      )}
    </li>
  );
}
