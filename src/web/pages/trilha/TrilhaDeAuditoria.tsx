import { useEffect, useRef, useState } from "react";
import type { RegistroAuditoria } from "../../../shared/contracts";
import {
  Aviso,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  type ColunaTabela,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { formatarDataHora } from "../../lib/formatadores";
import { carregarPagina, ehSemPermissao } from "./trilha-api";
import { registros, rotuloDaAcao, textoDoAlvo } from "./textos";
import "./trilha.css";

type PrimeiraPagina =
  { tipo: "carregando" } | { tipo: "erro"; erro: unknown } | { tipo: "ok" };

type Trilha = {
  itens: RegistroAuditoria[];
  /** Cursor da página seguinte (`antes_de`); null = não há registros mais antigos. */
  proximo: number | null;
  /** Índice do primeiro item da última página que chegou com "Carregar mais" (eles entram com movimento). */
  inicioDaUltima: number | null;
};

/** Id do bloco "Quando" de um registro: o foco vai para o primeiro registro novo depois de "Carregar mais". */
export const idDoRegistro = (id: number) => `trilha-registro-${id}`;
/** A linha do fim da lista: recebe o foco se a última página vier vazia (o botão some). */
export const ID_FIM_DA_TRILHA = "trilha-fim";

// Trilha de auditoria (só admin): do mais novo para o mais antigo, com quando (no fuso da campanha), quem, a
// ação em português, o alvo e o resumo (a API nunca põe dados pessoais nele). "Carregar mais" pede a página
// seguinte pelo cursor e leva o foco ao primeiro registro novo, com o anúncio numa região viva fixa.
export function TrilhaDeAuditoria() {
  const [primeira, setPrimeira] = useState<PrimeiraPagina>({
    tipo: "carregando",
  });
  const [trilha, setTrilha] = useState<Trilha>({
    itens: [],
    proximo: null,
    inicioDaUltima: null,
  });
  const [tentativa, setTentativa] = useState(0);
  const [mais, setMais] = useState<{ carregando: boolean; erro: unknown }>({
    carregando: false,
    erro: null,
  });
  const [anuncio, setAnuncio] = useState("");
  // Trava síncrona do "Carregar mais" (dois toques rápidos pedem a mesma página uma vez só).
  const carregandoMais = useRef(false);
  const controleMais = useRef<AbortController | null>(null);
  // Elemento que recebe o foco quando a página nova aparecer na tela.
  const focoPendente = useRef<string | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    carregarPagina(null, { signal: controle.signal }).then(
      ({ itens, proximo }) => {
        setTrilha({ itens, proximo, inicioDaUltima: null });
        setPrimeira({ tipo: "ok" });
      },
      (erro: unknown) => {
        if (!controle.signal.aborted) setPrimeira({ tipo: "erro", erro });
      },
    );
    return () => controle.abort();
  }, [tentativa]);

  // Ao sair da tela, cancela o "Carregar mais" em andamento.
  useEffect(() => () => controleMais.current?.abort(), []);

  useEffect(() => {
    if (focoPendente.current === null) return;
    document.getElementById(focoPendente.current)?.focus();
    focoPendente.current = null;
  }, [trilha]);

  function tentarDeNovo() {
    setPrimeira({ tipo: "carregando" });
    setTentativa((atual) => atual + 1);
  }

  async function carregarMais() {
    const { proximo, itens } = trilha;
    if (carregandoMais.current || proximo === null) return;
    carregandoMais.current = true;
    const controle = new AbortController();
    controleMais.current = controle;
    setMais({ carregando: true, erro: null });
    try {
      const pagina = await carregarPagina(proximo, { signal: controle.signal });
      const vistos = new Set(itens.map((item) => item.id));
      const novos = pagina.itens.filter((item) => !vistos.has(item.id));
      focoPendente.current =
        novos.length > 0 ? idDoRegistro(novos[0].id) : ID_FIM_DA_TRILHA;
      setTrilha({
        itens: [...itens, ...novos],
        proximo: pagina.proximo,
        inicioDaUltima: itens.length,
      });
      setMais({ carregando: false, erro: null });
      setAnuncio(
        `${registros(novos.length)} a mais na lista.${pagina.proximo === null ? " Não há registros mais antigos." : ""}`,
      );
    } catch (erro) {
      if (!controle.signal.aborted) setMais({ carregando: false, erro });
    } finally {
      carregandoMais.current = false;
    }
  }

  if (primeira.tipo === "carregando") {
    return <Loading texto="Carregando a trilha…" />;
  }
  if (primeira.tipo === "erro") {
    return ehSemPermissao(primeira.erro) ? (
      <Aviso tom="alerta" titulo="Sem permissão para ver a trilha">
        <p>
          A trilha é só para quem tem o papel Admin. Se o seu papel mudou, saia
          e entre de novo pelo seu link.
        </p>
      </Aviso>
    ) : (
      <ErrorState
        titulo="Não foi possível carregar a trilha."
        mensagem={mensagemDoErro(primeira.erro)}
        aoTentarDeNovo={tentarDeNovo}
      />
    );
  }

  const { itens, proximo, inicioDaUltima } = trilha;
  if (itens.length === 0) {
    return (
      <EmptyState
        titulo="Nenhuma ação registrada ainda."
        descricao="Cada mudança na campanha, nos vínculos de afiliado, na hierarquia e nos acessos aparece aqui, com quem fez e quando."
      />
    );
  }

  const novos = new Set(
    inicioDaUltima === null
      ? []
      : itens.slice(inicioDaUltima).map((item) => item.id),
  );
  // Os registros que chegaram com "Carregar mais" entram com movimento (só com prefers-reduced-motion:
  // no-preference, no trilha.css).
  const bloco = (registro: RegistroAuditoria, classe: string) =>
    `trilha-celula ${classe}${novos.has(registro.id) ? " trilha-celula--nova" : ""}`;

  // A ordem da leitura de um registro: quando (título do cartão no celular), quem, o quê, em quê e o resumo.
  const colunas: ColunaTabela<RegistroAuditoria>[] = [
    {
      chave: "quando",
      titulo: "Quando",
      principal: true,
      celula: (registro) => (
        <span
          id={idDoRegistro(registro.id)}
          tabIndex={-1}
          className={bloco(registro, "trilha-quando")}
        >
          <time dateTime={registro.em}>{formatarDataHora(registro.em)}</time>
        </span>
      ),
    },
    {
      chave: "quem",
      titulo: "Quem",
      celula: (registro) => (
        <span className={bloco(registro, "trilha-quem")}>
          {registro.usuario_nome}
        </span>
      ),
    },
    {
      chave: "acao",
      titulo: "Ação",
      celula: (registro) => (
        <span className={bloco(registro, "trilha-acao")}>
          {rotuloDaAcao(registro.acao)}
        </span>
      ),
    },
    {
      chave: "alvo",
      titulo: "Alvo",
      celula: (registro) => (
        <span className={bloco(registro, "trilha-alvo")}>
          {textoDoAlvo(registro.alvo)}
        </span>
      ),
    },
    {
      chave: "resumo",
      titulo: "Resumo",
      celula: (registro) => (
        <span className={bloco(registro, "trilha-texto-longo")}>
          {registro.resumo}
        </span>
      ),
    },
  ];

  return (
    <div className="trilha">
      {/* Região viva fixa: anuncia o que o "Carregar mais" trouxe. */}
      <p className="visualmente-oculto" role="status">
        {anuncio}
      </p>
      <DataTable
        colunas={colunas}
        linhas={itens}
        chaveDaLinha={(registro) => registro.id}
        legenda="Trilha de auditoria, do mais novo para o mais antigo"
      />
      <div className="trilha-rodape">
        <p id={ID_FIM_DA_TRILHA} tabIndex={-1} className="trilha-contagem">
          {proximo === null
            ? `${registros(itens.length)}; não há registros mais antigos.`
            : `Mostrando ${registros(itens.length)}; há registros mais antigos.`}
        </p>
        {mais.erro !== null && (
          <Aviso tom="perigo" titulo="Não foi possível carregar mais registros">
            <p>{mensagemDoErro(mais.erro)}</p>
          </Aviso>
        )}
        {proximo !== null && (
          <Button
            variante="secundario"
            aria-disabled={mais.carregando || undefined}
            onClick={() => void carregarMais()}
          >
            {mais.carregando ? "Carregando…" : "Carregar mais"}
          </Button>
        )}
      </div>
    </div>
  );
}
