import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router";
import type {
  ItemPedido,
  RespostaPedidos,
  RifeiNaAtribuicao,
} from "../../../shared/contracts";
import {
  Aviso,
  Badge,
  Button,
  ComAjuda,
  ComDica,
  DataTable,
  EmptyState,
  ErrorState,
  Icone,
  Input,
  Loading,
  Select,
  type ColunaTabela,
  type NomeIcone,
} from "../../components/ui";
import { TextoContado } from "../../components/movimento";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { contarRedes, useRedes } from "../../lib/redes";
import { useUsuarioConectado } from "../../lib/sessao";
import { numeroDoWhatsApp, telefoneLegivel } from "./comprador";
import { ExportarCompradores } from "./ExportarCompradores";
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
import { DialogoAtribuirCelula } from "./AtribuirCelula";
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
  quantosFiltros,
  temFiltro,
  type CelulaDoFiltro,
  type FiltrosPedidos,
} from "./pedidos-api";
import {
  AJUDA,
  DICAS,
  MARCA_ATRIBUIDA,
  MARCA_RECUPERADO,
  ROTULO_STATUS,
  ROTULO_STATUS_PLURAL,
  TOM_STATUS,
  filtrosAtivos,
  pedidos,
  podeAtribuirCelula,
  textoDaRifeiNaAtribuicao,
  seloDesconsiderado,
  textoDaCelula,
  totaisDepoisDe,
} from "./textos";
import {
  useFiltrosRecolhidos,
  type FiltrosRecolhidos,
} from "./useFiltrosRecolhidos";
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
// antigo, com "Carregar mais" pelo cursor. Do comprador, a API manda o DDD e, SÓ ao admin (RIFA-076, D36), o nome e o
// telefone: a coluna "Comprador" (com o link do WhatsApp) e a planilha de compradores aparecem só para ele.
export function ListaPedidos({ filtros, aoMudar }: Props) {
  const consulta = new URLSearchParams(paramsDosPedidos(filtros)).toString();
  const { estado, mais, anuncio, carregarMais, tentarDeNovo, substituirItem } =
    usePaginas(consulta, CONFIG);
  const celulas = useCelulas();
  const recolhidos = useFiltrosRecolhidos();
  const primeiroFiltro = useRef<HTMLSelectElement>(null);
  const admin = useUsuarioConectado().papel === "admin";
  const [chave, setChave] = useChaveDesconsiderar(admin);
  const [acao, setAcao] = useState<{
    tipo: "desconsiderar" | "desfazer";
    pedido: ItemPedido;
  } | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  // RIFA-091: a Rifei não ligou a venda ao afiliado da célula: o aviso do resultado fica em alerta.
  const [resultadoTom, setResultadoTom] = useState<"sucesso" | "alerta">(
    "sucesso",
  );
  // RIFA-088 (D41): a venda sem célula pelo afiliado em que o admin escolhe a célula à mão.
  const [atribuindo, setAtribuindo] = useState<ItemPedido | null>(null);
  // Depois da ação, o botão troca de nome ("Desconsiderar" ↔ "Desfazer"): o foco vai para o id do pedido.
  const refFocoAposAcao = useRef<HTMLElement | null>(null);

  function abrirAcao(tipo: "desconsiderar" | "desfazer", pedido: ItemPedido) {
    refFocoAposAcao.current = null;
    setResultado(null);
    setAcao({ tipo, pedido });
  }

  function abrirAtribuicao(pedido: ItemPedido) {
    refFocoAposAcao.current = null;
    setResultado(null);
    setAtribuindo(pedido);
  }

  /**
   * A célula mudou: o item troca na lista (os totais seguem os filtros e só mudam ao recarregar). RIFA-091: o aviso diz
   * também o resultado na Rifei (nada quando não se aplica).
   */
  function aoConcluirAtribuicao(
    depois: ItemPedido,
    rifei: RifeiNaAtribuicao | null,
  ) {
    substituirItem(depois);
    refFocoAposAcao.current = document.getElementById(idDoPedido(depois.id));
    setAtribuindo(null);
    const naRifei = textoDaRifeiNaAtribuicao(rifei);
    setResultadoTom(
      naRifei !== null && rifei?.situacao !== "vinculado"
        ? "alerta"
        : "sucesso",
    );
    setResultado(
      `${
        depois.celula_nome === null
          ? `Pedido ${depois.id} sem célula de novo: não conta para nenhuma.`
          : `Pedido ${depois.id} atribuído à ${depois.celula_nome}: a venda conta para ela em todo o sistema.`
      }${naRifei === null ? "" : ` ${naRifei}`}`,
    );
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
    setResultadoTom("sucesso");
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
    // O "Limpar filtros" some com a lista vazia: o foco vai para o primeiro filtro, pronto para outra escolha. No
    // celular, os filtros recolhidos abrem antes (fechados, o campo não recebe o foco).
    if (!recolhidos.abertos) flushSync(() => recolhidos.mudar(true));
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
        recolhidos={recolhidos}
      />
      {admin && chave === "desligada" && <AvisoChaveDesligada />}
      {/* Região viva fixa: anuncia o resultado de desconsiderar e de desfazer. */}
      <p className="visualmente-oculto" role="status">
        {resultado ?? ""}
      </p>
      {resultado && (
        <Aviso
          tom={resultadoTom}
          anuncio="nenhum"
          aoFechar={() => setResultado(null)}
        >
          <p>{resultado}</p>
        </Aviso>
      )}
      {/* RIFA-076 (D36): a planilha de compradores, só admin (a região viva dela vem depois das de cima). */}
      {admin && <ExportarCompradores />}
      <Conteudo
        estado={estado}
        filtros={filtros}
        mais={mais}
        acoes={acoes}
        aoAtribuir={admin ? abrirAtribuicao : null}
        comComprador={admin}
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
      {atribuindo && (
        <DialogoAtribuirCelula
          pedido={atribuindo}
          grupos={
            celulas.tipo === "ok" ? celulasPorRede(celulas.celulas) : null
          }
          celulasFalharam={celulas.tipo === "erro"}
          aoFechar={() => setAtribuindo(null)}
          aoConcluir={aoConcluirAtribuicao}
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
  recolhidos,
}: {
  filtros: FiltrosPedidos;
  celulas: EstadoCelulas;
  aoMudar: (filtros: FiltrosPedidos) => void;
  /** O campo Status: recebe o foco depois de "Limpar filtros". */
  primeiroFiltro: RefObject<HTMLSelectElement | null>;
  /** No celular, os filtros num <details> (RIFA-051, P3.7); no computador, sempre abertos, como antes. */
  recolhidos: FiltrosRecolhidos;
}) {
  const ativos = quantosFiltros(filtros);
  const grupos = celulas.tipo === "ok" ? celulasPorRede(celulas.celulas) : [];
  // As células trazem a hierarquia toda: com uma rede só, a lista sai sem o grupo com o nome dela (RIFA-065, D30).
  const redeUnica = useRedes(
    celulas.tipo === "ok"
      ? contarRedes(celulas.celulas.map((celula) => celula.rede_id))
      : null,
  ).unica;
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
    // No celular (abaixo de 48rem), os filtros ficam recolhidos ao abrir a tela, para o primeiro pedido aparecer
    // logo (A-04); o <summary> diz quantos estão escolhidos. No computador, o <summary> some (pedidos.css) e o
    // <details> fica sempre aberto: igual a antes.
    <details
      className="pedidos-filtros-caixa"
      open={recolhidos.abertos}
      onToggle={(evento) => {
        if (recolhidos.recolhiveis) recolhidos.mudar(evento.currentTarget.open);
      }}
    >
      <ComDica texto={DICAS.filtros}>
        <summary className="pedidos-filtros-caixa__resumo mov-toque">
          Filtros
          {ativos > 0 && (
            <>
              {" "}
              <span className="pedidos-filtros-caixa__ativos">
                {filtrosAtivos(ativos)}
              </span>
            </>
          )}
          {/* O chevron (RIFA-053): para baixo fechado, para cima aberto; só visual (o <details> diz se está aberto). */}
          <Icone nome="abrir" className="pedidos-filtros-caixa__seta" />
        </summary>
      </ComDica>
      <div className="pedidos-filtros">
        <Select
          ajuda={AJUDA.filtroStatus}
          ref={primeiroFiltro}
          rotulo="Status"
          value={filtros.status ?? ""}
          onChange={(evento) =>
            aoMudar({
              ...filtros,
              status:
                STATUS_PEDIDO.find(
                  (status) => status === evento.target.value,
                ) ?? null,
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
          ajuda={AJUDA.filtroCelula}
          rotulo="Célula"
          value={valorDoFiltroCelula(celulaAtual)}
          onChange={(evento) =>
            aoMudar({
              ...filtros,
              celula: celulaDoValor(evento.target.value),
            })
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
          {grupos.map((grupo) => {
            const opcoes = grupo.celulas.map((celula) => (
              <option key={celula.id} value={valorDaCelula(celula.id)}>
                {celula.nome}
              </option>
            ));
            return redeUnica ? (
              <Fragment key={grupo.rede}>{opcoes}</Fragment>
            ) : (
              <optgroup key={grupo.rede} label={grupo.rede}>
                {opcoes}
              </optgroup>
            );
          })}
        </Select>

        <Select
          ajuda={AJUDA.filtroDesconsiderados}
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
          <option value="todos">Todos os pedidos</option>
          <option value="sem">Só os que contam</option>
          <option value="so">Só os desconsiderados</option>
        </Select>

        <BuscaPorId
          aplicada={filtros.id}
          aoBuscar={(id) => aoMudar({ ...filtros, id })}
        />
      </div>
    </details>
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
        ajuda={AJUDA.campoBusca}
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
        <ComDica texto={DICAS.buscar}>
          <Button type="submit" variante="secundario">
            Buscar
          </Button>
        </ComDica>
        {aplicada !== null && (
          <ComDica texto={DICAS.limparBusca}>
            <Button variante="discreto" onClick={limpar}>
              Limpar busca
            </Button>
          </ComDica>
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
  aoAtribuir,
  comComprador,
  aoCarregarMais,
  aoTentarDeNovo,
  aoLimpar,
}: {
  estado: EstadoPaginas<ItemPedido, string, RespostaPedidos>;
  filtros: FiltrosPedidos;
  mais: { carregando: boolean; erro: unknown };
  acoes: AcoesDaTabela | null;
  /** RIFA-088 (D41): só admin; null = sem o botão "Atribuir a uma célula". */
  aoAtribuir: ((pedido: ItemPedido) => void) | null;
  comComprador: boolean;
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
        conexao={ehFalhaDeConexao(estado.erro)}
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
              <ComDica texto={DICAS.limparFiltros}>
                <Button variante="secundario" onClick={aoLimpar}>
                  Limpar filtros
                </Button>
              </ComDica>
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
            aoAtribuir={aoAtribuir}
            comComprador={comComprador}
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
              <ComDica
                texto={
                  mais.carregando ? DICAS.carregando : DICAS.carregarMaisPedidos
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
      )}
    </>
  );
}

/** Ordem dos totais: o que conta nas vendas primeiro. */
const ORDEM_TOTAIS = ["approved", "in_process", "expired"] as const;

/**
 * O chip de cada total (RIFA-051, P3.5): o ícone e o tom, como o `tom` do Stat (no lugar da borda colorida de cima).
 * Nunca é só cor: o título do cartão diz o status.
 */
const CHIP_DO_TOTAL: Record<
  (typeof ORDEM_TOTAIS)[number],
  { icone: NomeIcone; tom: "sucesso" | "marca" | "neutro" }
> = {
  approved: { icone: "check", tom: "sucesso" },
  in_process: { icone: "atualizar", tom: "marca" },
  expired: { icone: "menos", tom: "neutro" },
};

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
      <ComAjuda texto={AJUDA.totais} idDoTitulo="pedidos-totais-titulo">
        <h2 id="pedidos-totais-titulo" className="pedidos-totais__titulo">
          Totais por status
        </h2>
      </ComAjuda>
      <p className="pedidos-totais__nota">
        Só os aprovados contam nas vendas. Os desconsiderados ficam fora dos
        totais.
        {celulaOuBusca &&
          " Os totais seguem a célula e a busca escolhidas, com todos os status."}
      </p>
      <ul className="pedidos-totais__lista">
        {ORDEM_TOTAIS.map((status) => {
          const total = totais[status];
          const { icone, tom } = CHIP_DO_TOTAL[status];
          return (
            <li key={status} className="pedidos-total">
              <div className="pedidos-total__topo">
                <span
                  className={`pedidos-total__icone pedidos-total__icone--${tom}`}
                  aria-hidden="true"
                >
                  <Icone nome={icone} />
                </span>
                <ComAjuda
                  texto={AJUDA.status[status]}
                  idDoTitulo={`pedidos-total-${status}`}
                >
                  <h3
                    id={`pedidos-total-${status}`}
                    className="pedidos-total__status"
                  >
                    {ROTULO_STATUS_PLURAL[status]}
                  </h3>
                </ComAjuda>
              </div>
              <dl className="pedidos-total__numeros">
                <div>
                  <dt>Pedidos</dt>
                  <dd className="pedidos-total__principal">
                    <TextoContado texto={formatarNumero(total.pedidos)} />
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

/** RIFA-076 (D36): o nome e o telefone de quem fez o pedido (só admin), com o link do WhatsApp. */
function Comprador({ pedido }: { pedido: ItemPedido }) {
  const nome = pedido.comprador?.nome ?? null;
  const telefone = pedido.comprador?.telefone ?? null;
  const whatsapp = telefone === null ? null : numeroDoWhatsApp(telefone);
  return (
    <>
      <span
        className={
          nome === null ? "pedidos-comprador__sem" : "pedidos-comprador__nome"
        }
      >
        {nome ?? "Sem nome"}
      </span>
      {telefone !== null && whatsapp !== null ? (
        <ComDica texto={DICAS.whatsapp}>
          <a
            className="pedidos-comprador__telefone"
            href={`https://wa.me/${whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {telefoneLegivel(telefone)}
            <span className="visualmente-oculto">
              {" "}
              (abre o WhatsApp em outra aba)
            </span>
          </a>
        </ComDica>
      ) : (
        <span className="pedidos-comprador__sem">Sem telefone</span>
      )}
    </>
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
  aoAtribuir,
  comComprador,
}: {
  itens: ItemPedido[];
  inicioDaUltima: number | null;
  acoes: AcoesDaTabela | null;
  /** RIFA-088 (D41): só admin, nas vendas sem célula pelo afiliado. */
  aoAtribuir: ((pedido: ItemPedido) => void) | null;
  /** RIFA-076 (D36): a coluna "Comprador", só para o admin. */
  comComprador: boolean;
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
            <ComDica texto={DICAS.seloSuspeito}>
              <Link to={CAMINHO_PEDIDOS_SUSPEITOS} className="pedidos-selo">
                Suspeito{" "}
                <span className="visualmente-oculto">
                  (ver em Pedidos suspeitos)
                </span>
              </Link>
            </ComDica>
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
    ...(comComprador
      ? [
          {
            chave: "comprador",
            titulo: "Comprador",
            celula: (pedido: ItemPedido) => (
              <span className={bloco(pedido, "pedidos-comprador")}>
                <Comprador pedido={pedido} />
              </span>
            ),
          },
        ]
      : []),
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
        <span className={bloco(pedido, "pedidos-celula-da-venda")}>
          <span
            className={pedido.celula_nome === null ? "pedidos-sem-celula" : ""}
          >
            {textoDaCelula(pedido)}
          </span>
          {/* RIFA-088 (D41): a célula escolhida à mão pelo admin (a coordenação vê o sinal, sem o botão). */}
          {pedido.celula_origem === "manual" && (
            <span className="pedidos-atribuida">{MARCA_ATRIBUIDA}</span>
          )}
          {aoAtribuir && podeAtribuirCelula(pedido) && (
            <ComDica
              texto={
                pedido.celula_origem === "manual"
                  ? DICAS.trocarCelula
                  : DICAS.atribuirCelula
              }
            >
              <Button
                variante="secundario"
                tamanho="pequeno"
                onClick={() => aoAtribuir(pedido)}
              >
                {pedido.celula_origem === "manual"
                  ? "Trocar a célula"
                  : "Atribuir a uma célula"}{" "}
                <span className="visualmente-oculto">
                  do pedido {pedido.id}
                </span>
              </Button>
            </ComDica>
          )}
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
                  <ComDica texto={DICAS.desfazer}>
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
                  </ComDica>
                ) : (
                  <ComDica texto={DICAS.desconsiderar}>
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
                  </ComDica>
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
