import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Link } from "react-router";
import type { ItemPedido, RespostaPedidos } from "../../../shared/contracts";
import {
  Aviso,
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Loading,
  Select,
  type ColunaTabela,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { useUsuarioConectado } from "../../lib/sessao";
import {
  LOCALIDADE,
  formatarDataHora,
  formatarMoeda,
  formatarNumero,
} from "../../lib/formatadores";
import {
  AvisoChaveDesligada,
  DialogoDesconsiderar,
  DialogoDesfazer,
} from "./Desconsiderar";
import {
  SEM_FILTROS,
  STATUS_PEDIDO,
  TAMANHO_MAXIMO_ID,
  carregarCelulas,
  carregarDesconsiderarLigado,
  carregarPedidos,
  ehCursorInvalido,
  ehSemPermissao,
  filtrosDosPedidos,
  idDaBusca,
  paramsDosPedidos,
  temFiltro,
  type CelulaDoFiltro,
  type FiltrosPedidos,
} from "./pedidos-api";
import {
  MARCA_RECUPERADO,
  ROTULO_STATUS,
  ROTULO_STATUS_PLURAL,
  TOM_STATUS,
  pedidos,
  seloDesconsiderado,
  textoDaCelula,
  totaisDepoisDe,
} from "./textos";
import {
  usePaginas,
  type ConfigPaginas,
  type EstadoPaginas,
} from "./usePaginas";

/** Id do bloco do pedido na lista: o foco vai para o primeiro pedido novo depois de "Carregar mais". */
export const idDoPedido = (id: string) => `pedido-${encodeURIComponent(id)}`;
/** A linha do fim da lista: recebe o foco se a página seguinte vier vazia (o botão some). */
export const ID_FIM_DOS_PEDIDOS = "pedidos-fim";

export const CAMINHO_PEDIDOS_SUSPEITOS = "/coordenacao/pedidos-suspeitos";

const CONFIG: ConfigPaginas<ItemPedido, string, RespostaPedidos> = {
  carregar: (consulta, cursor, signal) =>
    carregarPedidos(filtrosDosPedidos(new URLSearchParams(consulta)), cursor, {
      signal,
    }),
  idDoItem: (pedido) => pedido.id,
  idDoFoco: (pedido) => idDoPedido(pedido.id),
  idDoFim: ID_FIM_DOS_PEDIDOS,
  anunciarMais: (novos, fim) =>
    `${pedidos(novos)} a mais na lista.${fim ? " Não há pedidos mais antigos." : ""}`,
  anunciarPrimeira: ({ itens, proximo }) =>
    itens.length === 0
      ? "Lista atualizada: nenhum pedido com estes filtros."
      : `Lista atualizada: ${pedidos(itens.length)}${proximo === null ? "" : " e há mais"}.`,
  cursorInvalido: ehCursorInvalido,
};

type Props = {
  filtros: FiltrosPedidos;
  aoMudar: (filtros: FiltrosPedidos) => void;
};

// Pedidos da campanha ativa (coordenação, com R$): os totais por status (da primeira página: a API manda só nela),
// os filtros (status, célula ou "só sem célula" e a busca pelo id) e a lista, do registrado mais novo para o mais
// antigo, com "Carregar mais" pelo cursor. Sem dado pessoal: do comprador, a API manda só o DDD.
export function ListaPedidos({ filtros, aoMudar }: Props) {
  const consulta = new URLSearchParams(paramsDosPedidos(filtros)).toString();
  const { estado, mais, anuncio, carregarMais, tentarDeNovo, substituirItem } =
    usePaginas(consulta, CONFIG);
  const celulas = useCelulas();
  const primeiroFiltro = useRef<HTMLSelectElement>(null);
  const admin = useUsuarioConectado().papel === "admin";
  const [chave, setChave] = useChaveDesconsiderar(admin);
  const [acao, setAcao] = useState<{
    tipo: "desconsiderar" | "desfazer";
    pedido: ItemPedido;
  } | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  // Depois da ação, o botão troca de nome ("Desconsiderar" ↔ "Desfazer"): o foco vai para o id do pedido.
  const refFocoAposAcao = useRef<HTMLElement | null>(null);

  function abrirAcao(tipo: "desconsiderar" | "desfazer", pedido: ItemPedido) {
    refFocoAposAcao.current = null;
    setResultado(null);
    setAcao({ tipo, pedido });
  }

  function aoConcluirAcao(antes: ItemPedido, depois: ItemPedido) {
    substituirItem(depois, (primeira) =>
      primeira.totais
        ? {
            ...primeira,
            totais: totaisDepoisDe(primeira.totais, antes, depois),
          }
        : primeira,
    );
    refFocoAposAcao.current = document.getElementById(idDoPedido(depois.id));
    setAcao(null);
    setResultado(
      depois.desconsiderado
        ? `Pedido ${depois.id} desconsiderado: saiu de todas as contas e dos totais.`
        : `Pedido ${depois.id} voltou a contar em todas as contas.`,
    );
  }

  /** 409 `acao_desligada`: as ações saem da lista, e com elas o botão que abriu o diálogo; o foco volta ao id. */
  function aoDesligarNaAcao(pedido: ItemPedido) {
    refFocoAposAcao.current = document.getElementById(idDoPedido(pedido.id));
    setChave("desligada");
  }

  const acoes: AcoesDaTabela | null =
    admin && chave === "ligada"
      ? {
          aoDesconsiderar: (pedido) => abrirAcao("desconsiderar", pedido),
          aoDesfazer: (pedido) => abrirAcao("desfazer", pedido),
        }
      : null;

  function limparFiltros() {
    // O "Limpar filtros" some com a lista vazia: o foco vai para o primeiro filtro, pronto para outra escolha.
    primeiroFiltro.current?.focus();
    aoMudar(SEM_FILTROS);
  }

  return (
    <div className="pedidos">
      {/* Região viva fixa: anuncia o que o filtro e o "Carregar mais" trouxeram. */}
      <p className="visualmente-oculto" role="status">
        {anuncio}
      </p>
      <Filtros
        filtros={filtros}
        celulas={celulas}
        aoMudar={aoMudar}
        primeiroFiltro={primeiroFiltro}
      />
      {admin && chave === "desligada" && <AvisoChaveDesligada />}
      {/* Região viva fixa: anuncia o resultado de desconsiderar e de desfazer. */}
      <p className="visualmente-oculto" role="status">
        {resultado ?? ""}
      </p>
      {resultado && (
        <Aviso
          tom="sucesso"
          anuncio="nenhum"
          aoFechar={() => setResultado(null)}
        >
          <p>{resultado}</p>
        </Aviso>
      )}
      <Conteudo
        estado={estado}
        filtros={filtros}
        mais={mais}
        acoes={acoes}
        aoCarregarMais={() => void carregarMais()}
        aoTentarDeNovo={tentarDeNovo}
        aoLimpar={limparFiltros}
      />
      {acao?.tipo === "desconsiderar" && (
        <DialogoDesconsiderar
          pedido={acao.pedido}
          aoFechar={() => setAcao(null)}
          aoConcluir={(depois) => aoConcluirAcao(acao.pedido, depois)}
          aoDesligada={() => aoDesligarNaAcao(acao.pedido)}
          focoAoFechar={refFocoAposAcao}
        />
      )}
      {acao?.tipo === "desfazer" && (
        <DialogoDesfazer
          pedido={acao.pedido}
          aoFechar={() => setAcao(null)}
          aoConcluir={(depois) => aoConcluirAcao(acao.pedido, depois)}
          aoDesligada={() => aoDesligarNaAcao(acao.pedido)}
          focoAoFechar={refFocoAposAcao}
        />
      )}
    </div>
  );
}

type Chave = "desconhecida" | "ligada" | "desligada";

/**
 * A chave `pedidos.desconsiderar` da campanha, só para o admin (as ações são só dele). Lida uma vez, ao abrir; um
 * 409 `acao_desligada` numa ação a desliga aqui também. Falha ao ler: as ações ficam escondidas.
 */
function useChaveDesconsiderar(
  admin: boolean,
): [Chave, (chave: Chave) => void] {
  const [chave, setChave] = useState<Chave>("desconhecida");
  useEffect(() => {
    if (!admin) return;
    const controle = new AbortController();
    carregarDesconsiderarLigado({ signal: controle.signal }).then(
      (ligada) => {
        if (!controle.signal.aborted) setChave(ligada ? "ligada" : "desligada");
      },
      () => undefined,
    );
    return () => controle.abort();
  }, [admin]);
  return [chave, setChave];
}

/** As ações de cada pedido (só admin, com a chave ligada). */
type AcoesDaTabela = {
  aoDesconsiderar: (pedido: ItemPedido) => void;
  aoDesfazer: (pedido: ItemPedido) => void;
};

type EstadoCelulas =
  | { tipo: "carregando" }
  | { tipo: "ok"; celulas: CelulaDoFiltro[] }
  | { tipo: "erro" };

/** As células da hierarquia, para o filtro (carrega uma vez: a hierarquia quase não muda na campanha). */
function useCelulas(): EstadoCelulas {
  const [estado, setEstado] = useState<EstadoCelulas>({ tipo: "carregando" });
  useEffect(() => {
    const controle = new AbortController();
    carregarCelulas({ signal: controle.signal }).then(
      (celulas) => {
        if (!controle.signal.aborted) setEstado({ tipo: "ok", celulas });
      },
      () => {
        if (!controle.signal.aborted) setEstado({ tipo: "erro" });
      },
    );
    return () => controle.abort();
  }, []);
  return estado;
}

const colacao = new Intl.Collator(LOCALIDADE, {
  numeric: true,
  sensitivity: "base",
});

/** As células agrupadas por rede, redes e células em ordem de nome ("Célula 2" antes de "Célula 10"). */
export function celulasPorRede(
  celulas: readonly CelulaDoFiltro[],
): { rede: string; celulas: CelulaDoFiltro[] }[] {
  const redes = new Map<number, { rede: string; celulas: CelulaDoFiltro[] }>();
  for (const celula of celulas) {
    const grupo = redes.get(celula.rede_id) ?? {
      rede: celula.rede_nome,
      celulas: [],
    };
    grupo.celulas.push(celula);
    redes.set(celula.rede_id, grupo);
  }
  return [...redes.values()]
    .sort((a, b) => colacao.compare(a.rede, b.rede))
    .map((grupo) => ({
      ...grupo,
      celulas: grupo.celulas.sort((a, b) => colacao.compare(a.nome, b.nome)),
    }));
}

const VALOR_TODAS = "todas";
const VALOR_SEM_CELULA = "sem_celula";
const valorDaCelula = (id: number) => `celula:${id}`;

function valorDoFiltroCelula(celula: FiltrosPedidos["celula"]): string {
  if (celula.tipo === "id") return valorDaCelula(celula.id);
  return celula.tipo === "sem_celula" ? VALOR_SEM_CELULA : VALOR_TODAS;
}

function celulaDoValor(valor: string): FiltrosPedidos["celula"] {
  if (valor === VALOR_SEM_CELULA) return { tipo: "sem_celula" };
  const id = /^celula:(\d+)$/.exec(valor)?.[1];
  return id ? { tipo: "id", id: Number(id) } : { tipo: "todas" };
}

function Filtros({
  filtros,
  celulas,
  aoMudar,
  primeiroFiltro,
}: {
  filtros: FiltrosPedidos;
  celulas: EstadoCelulas;
  aoMudar: (filtros: FiltrosPedidos) => void;
  /** O campo Status: recebe o foco depois de "Limpar filtros". */
  primeiroFiltro: RefObject<HTMLSelectElement | null>;
}) {
  const grupos = celulas.tipo === "ok" ? celulasPorRede(celulas.celulas) : [];
  const celulaAtual = filtros.celula;
  // A célula da URL ainda não está na lista (não chegou, falhou ou saiu da hierarquia): uma opção só para ela.
  const avulsa =
    celulaAtual.tipo === "id" &&
    !grupos.some((grupo) =>
      grupo.celulas.some((celula) => celula.id === celulaAtual.id),
    )
      ? celulaAtual.id
      : null;

  return (
    <div className="pedidos-filtros">
      <Select
        ref={primeiroFiltro}
        rotulo="Status"
        value={filtros.status ?? ""}
        onChange={(evento) =>
          aoMudar({
            ...filtros,
            status:
              STATUS_PEDIDO.find((status) => status === evento.target.value) ??
              null,
          })
        }
      >
        <option value="">Todos os status</option>
        {STATUS_PEDIDO.map((status) => (
          <option key={status} value={status}>
            {ROTULO_STATUS[status]}
          </option>
        ))}
      </Select>
      <Select
        rotulo="Célula"
        value={valorDoFiltroCelula(celulaAtual)}
        onChange={(evento) =>
          aoMudar({ ...filtros, celula: celulaDoValor(evento.target.value) })
        }
        dica={
          celulas.tipo === "erro"
            ? "Não foi possível carregar as células; recarregue a página para tentar de novo."
            : undefined
        }
      >
        <option value={VALOR_TODAS}>Todas as células</option>
        <option value={VALOR_SEM_CELULA}>Só os sem célula</option>
        {avulsa !== null && (
          <option value={valorDaCelula(avulsa)}>Célula {avulsa}</option>
        )}
        {grupos.map((grupo) => (
          <optgroup key={grupo.rede} label={grupo.rede}>
            {grupo.celulas.map((celula) => (
              <option key={celula.id} value={valorDaCelula(celula.id)}>
                {celula.nome}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <Select
        rotulo="Desconsiderados"
        value={VALOR_DESCONSIDERADO[String(filtros.desconsiderado)]}
        onChange={(evento) =>
          aoMudar({
            ...filtros,
            desconsiderado:
              evento.target.value === "so"
                ? true
                : evento.target.value === "sem"
                  ? false
                  : null,
          })
        }
      >
        <option value="todos">Com os desconsiderados</option>
        <option value="sem">Só os que contam</option>
        <option value="so">Só os desconsiderados</option>
      </Select>
      <BuscaPorId
        aplicada={filtros.id}
        aoBuscar={(id) => aoMudar({ ...filtros, id })}
      />
    </div>
  );
}

/** O valor do filtro "Desconsiderados" para cada valor de `desconsiderado`. */
const VALOR_DESCONSIDERADO: Record<string, string> = {
  null: "todos",
  false: "sem",
  true: "so",
};

function BuscaPorId({
  aplicada,
  aoBuscar,
}: {
  aplicada: string | null;
  aoBuscar: (id: string | null) => void;
}) {
  const [texto, setTexto] = useState(aplicada ?? "");
  // A busca aplicada mudou (o Buscar, "Limpar filtros", o "voltar"): o campo mostra a nova. Sem recriar o campo
  // (uma `key` o recriava), o foco fica onde estava: no Buscar, ou no campo depois do Enter.
  const [aplicadaAntes, setAplicadaAntes] = useState(aplicada);
  if (aplicada !== aplicadaAntes) {
    setAplicadaAntes(aplicada);
    setTexto(aplicada ?? "");
  }
  const campo = useRef<HTMLInputElement>(null);

  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    aoBuscar(idDaBusca(texto));
  }

  function limpar() {
    // O "Limpar busca" some com a busca: o foco vai para o campo, vazio, pronto para outra.
    campo.current?.focus();
    aoBuscar(null);
  }

  return (
    <form className="pedidos-busca" role="search" onSubmit={buscar}>
      <Input
        ref={campo}
        rotulo="Buscar pelo id do pedido"
        dica="O id completo, como aparece na Rifei."
        value={texto}
        maxLength={TAMANHO_MAXIMO_ID}
        autoComplete="off"
        spellCheck={false}
        onChange={(evento) => setTexto(evento.target.value)}
      />
      <div className="pedidos-busca__botoes">
        <Button type="submit" variante="secundario">
          Buscar
        </Button>
        {aplicada !== null && (
          <Button variante="discreto" onClick={limpar}>
            Limpar busca
          </Button>
        )}
      </div>
    </form>
  );
}

function Conteudo({
  estado,
  filtros,
  mais,
  acoes,
  aoCarregarMais,
  aoTentarDeNovo,
  aoLimpar,
}: {
  estado: EstadoPaginas<ItemPedido, string, RespostaPedidos>;
  filtros: FiltrosPedidos;
  mais: { carregando: boolean; erro: unknown };
  acoes: AcoesDaTabela | null;
  aoCarregarMais: () => void;
  aoTentarDeNovo: () => void;
  aoLimpar: () => void;
}) {
  if (estado.tipo === "carregando") {
    return <Loading texto="Carregando os pedidos…" />;
  }
  if (estado.tipo === "erro") {
    return ehSemPermissao(estado.erro) ? (
      <Aviso tom="alerta" titulo="Sem permissão para ver os pedidos">
        <p>
          A lista é da coordenação. Se o seu papel mudou, saia e entre de novo
          pelo seu link.
        </p>
      </Aviso>
    ) : (
      <ErrorState
        titulo="Não foi possível carregar os pedidos."
        mensagem={mensagemDoErro(estado.erro)}
        aoTentarDeNovo={aoTentarDeNovo}
      />
    );
  }

  const { itens, proximo, inicioDaUltima, primeira } = estado;
  const comFiltro = temFiltro(filtros);
  return (
    <>
      {primeira.totais && (
        <Totais
          totais={primeira.totais}
          celulaOuBusca={filtros.celula.tipo !== "todas" || filtros.id !== null}
        />
      )}
      {itens.length === 0 ? (
        comFiltro ? (
          <EmptyState
            titulo="Nenhum pedido com estes filtros."
            acao={
              <Button variante="secundario" onClick={aoLimpar}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            titulo="Nenhum pedido ainda."
            descricao="Os pedidos chegam da Rifei pelo webhook e aparecem aqui assim que são feitos."
          />
        )
      ) : (
        <>
          <TabelaPedidos
            itens={itens}
            inicioDaUltima={inicioDaUltima}
            acoes={acoes}
          />
          <div className="pedidos-rodape">
            <p
              id={ID_FIM_DOS_PEDIDOS}
              tabIndex={-1}
              className="pedidos-contagem"
            >
              {proximo === null
                ? `${pedidos(itens.length)}; não há pedidos mais antigos.`
                : `Mostrando ${pedidos(itens.length)}; há pedidos mais antigos.`}
            </p>
            {mais.erro !== null && (
              <Aviso
                tom="perigo"
                titulo="Não foi possível carregar mais pedidos"
              >
                <p>{mensagemDoErro(mais.erro)}</p>
              </Aviso>
            )}
            {proximo !== null && (
              <Button
                variante="secundario"
                aria-disabled={mais.carregando || undefined}
                onClick={aoCarregarMais}
              >
                {mais.carregando ? "Carregando…" : "Carregar mais"}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Ordem dos totais: o que conta nas vendas primeiro. */
const ORDEM_TOTAIS = ["approved", "in_process", "expired"] as const;

function Totais({
  totais,
  celulaOuBusca,
}: {
  totais: NonNullable<RespostaPedidos["totais"]>;
  /** Há célula (ou "só os sem célula") ou busca escolhida: os totais seguem esses filtros. */
  celulaOuBusca: boolean;
}) {
  return (
    <section className="pedidos-totais" aria-labelledby="pedidos-totais-titulo">
      <h2 id="pedidos-totais-titulo" className="pedidos-totais__titulo">
        Totais por status
      </h2>
      <p className="pedidos-totais__nota">
        Só os aprovados contam nas vendas. Os desconsiderados ficam fora dos
        totais.
        {celulaOuBusca &&
          " Os totais seguem a célula e a busca escolhidas, com todos os status."}
      </p>
      <ul className="pedidos-totais__lista">
        {ORDEM_TOTAIS.map((status) => {
          const total = totais[status];
          return (
            <li
              key={status}
              className={`pedidos-total pedidos-total--${status}`}
            >
              <h3 className="pedidos-total__status">
                {ROTULO_STATUS_PLURAL[status]}
              </h3>
              <dl className="pedidos-total__numeros">
                <div>
                  <dt>Pedidos</dt>
                  <dd className="pedidos-total__principal">
                    {formatarNumero(total.pedidos)}
                  </dd>
                </div>
                <div>
                  <dt>Bilhetes</dt>
                  <dd>{formatarNumero(total.bilhetes)}</dd>
                </div>
                <div>
                  <dt>Valor</dt>
                  <dd>{formatarMoeda(total.total_centavos)}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Quando o pedido foi feito (na Rifei; sem a data da Rifei, quando chegou) e, se for o caso, quando mudou. */
function Quando({ pedido }: { pedido: ItemPedido }) {
  const feito = pedido.criado_em ?? pedido.registrado_em;
  const mudou =
    pedido.status === "approved" && pedido.aprovado_em
      ? { texto: "Aprovado em", em: pedido.aprovado_em }
      : pedido.status === "expired" && pedido.expirado_em
        ? { texto: "Expirou em", em: pedido.expirado_em }
        : null;
  return (
    <>
      <time dateTime={feito}>{formatarDataHora(feito)}</time>
      {mudou && (
        <span className="pedidos-quando__mudou">
          {mudou.texto}{" "}
          <time dateTime={mudou.em}>{formatarDataHora(mudou.em)}</time>
        </span>
      )}
    </>
  );
}

function TabelaPedidos({
  itens,
  inicioDaUltima,
  acoes,
}: {
  itens: ItemPedido[];
  inicioDaUltima: number | null;
  acoes: AcoesDaTabela | null;
}) {
  const novos = new Set(
    inicioDaUltima === null
      ? []
      : itens.slice(inicioDaUltima).map((pedido) => pedido.id),
  );
  // Os pedidos que chegaram com "Carregar mais" entram com movimento (só com prefers-reduced-motion:
  // no-preference, no pedidos.css).
  const bloco = (pedido: ItemPedido, classe = "") =>
    `pedidos-celula${classe ? ` ${classe}` : ""}${novos.has(pedido.id) ? " pedidos-celula--nova" : ""}`;

  const colunas: ColunaTabela<ItemPedido>[] = [
    {
      chave: "pedido",
      titulo: "Pedido",
      principal: true,
      celula: (pedido) => (
        <span className={bloco(pedido, "pedidos-pedido")}>
          <span
            id={idDoPedido(pedido.id)}
            tabIndex={-1}
            className="pedidos-pedido__id"
          >
            {pedido.id}
          </span>
          {pedido.suspeito && (
            <Link to={CAMINHO_PEDIDOS_SUSPEITOS} className="pedidos-selo">
              Suspeito{" "}
              <span className="visualmente-oculto">
                (ver em Pedidos suspeitos)
              </span>
            </Link>
          )}
          {pedido.desconsiderado && (
            <span className="pedidos-desconsiderado">
              {seloDesconsiderado(pedido.desconsiderado.motivo)}
            </span>
          )}
          {pedido.origem === "conferencia" && (
            <span className="pedidos-recuperado">{MARCA_RECUPERADO}</span>
          )}
          {pedido.desconsiderado && (
            <span className="pedidos-desconsiderado__detalhe">
              Fora das contas desde{" "}
              <time dateTime={pedido.desconsiderado.em}>
                {formatarDataHora(pedido.desconsiderado.em)}
              </time>
              {pedido.desconsiderado.observacao &&
                `. Observação: ${pedido.desconsiderado.observacao}`}
              .
            </span>
          )}
        </span>
      ),
    },
    {
      chave: "status",
      titulo: "Status",
      celula: (pedido) => (
        <span className={bloco(pedido)}>
          <Badge tom={TOM_STATUS[pedido.status]}>
            {ROTULO_STATUS[pedido.status]}
          </Badge>
        </span>
      ),
    },
    {
      chave: "quando",
      titulo: "Quando",
      celula: (pedido) => (
        <span className={bloco(pedido, "pedidos-quando")}>
          <Quando pedido={pedido} />
        </span>
      ),
    },
    {
      chave: "celula",
      titulo: "Célula",
      celula: (pedido) => (
        <span
          className={bloco(
            pedido,
            pedido.celula_nome === null ? "pedidos-sem-celula" : "",
          )}
        >
          {textoDaCelula(pedido)}
        </span>
      ),
    },
    {
      chave: "bilhetes",
      titulo: "Bilhetes",
      alinhamento: "fim",
      celula: (pedido) => (
        <span className={bloco(pedido)}>
          {formatarNumero(pedido.qtd_bilhetes)}
        </span>
      ),
    },
    {
      chave: "valor",
      titulo: "Valor",
      alinhamento: "fim",
      celula: (pedido) => (
        <span className={bloco(pedido, "pedidos-valor")}>
          {formatarMoeda(pedido.total_centavos)}
        </span>
      ),
    },
    {
      chave: "ddd",
      titulo: "DDD",
      celula: (pedido) => (
        <span
          className={bloco(
            pedido,
            pedido.ddd === null ? "pedidos-sem-ddd" : "",
          )}
        >
          {pedido.ddd ?? "Sem DDD"}
        </span>
      ),
    },
    ...(acoes
      ? [
          {
            chave: "acoes",
            titulo: "Ações",
            celula: (pedido: ItemPedido) => (
              <span className={bloco(pedido)}>
                {pedido.desconsiderado ? (
                  <Button
                    variante="secundario"
                    tamanho="pequeno"
                    onClick={() => acoes.aoDesfazer(pedido)}
                  >
                    Desfazer{" "}
                    <span className="visualmente-oculto">
                      a desconsideração do pedido {pedido.id}
                    </span>
                  </Button>
                ) : (
                  <Button
                    variante="secundario"
                    tamanho="pequeno"
                    onClick={() => acoes.aoDesconsiderar(pedido)}
                  >
                    Desconsiderar{" "}
                    <span className="visualmente-oculto">
                      o pedido {pedido.id}
                    </span>
                  </Button>
                )}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <DataTable
      colunas={colunas}
      linhas={itens}
      chaveDaLinha={(pedido) => pedido.id}
      legenda="Pedidos, do mais recente para o mais antigo"
    />
  );
}
