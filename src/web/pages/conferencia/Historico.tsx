import { useEffect, useRef, useState } from "react";
import type { Recuperacao } from "../../../shared/contracts";
import {
  Button,
  Card,
  ComDica,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  type ColunaTabela,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import {
  formatarDataHora,
  formatarMoeda,
  formatarNumero,
} from "../../lib/formatadores";
import { listarRecuperacoes } from "./conferencia-api";
import { DICAS, plural } from "./textos";

type Estado =
  | { tipo: "carregando" }
  /** `proximo`: o cursor da página seguinte (null = não há mais). */
  | { tipo: "ok"; itens: Recuperacao[]; proximo: number | null }
  | { tipo: "erro"; mensagem: string; conexao: boolean };

/** Id do "Quando" de uma recuperação: o foco vai para a primeira nova depois de "Carregar mais". */
export const idDaRecuperacao = (id: number) => `conferencia-recuperacao-${id}`;
/** O texto do histórico: recebe o foco se a página seguinte vier vazia e a lista também (o botão some). */
export const ID_TEXTO_DO_HISTORICO = "conferencia-historico-texto";

/**
 * O que a recuperação gravou (RIFA-056): vendas perdidas, pagamentos registrados (o pendente ou expirado que passou a
 * pago) ou os dois.
 */
export function tipoDaRecuperacao(item: Recuperacao): string {
  const pagamentos = item.pagamentos_registrados.length;
  const vendas = item.pedidos.length - pagamentos;
  if (pagamentos === 0)
    return vendas === 1 ? "Venda perdida" : "Vendas perdidas";
  if (vendas === 0)
    return pagamentos === 1 ? "Pagamento registrado" : "Pagamentos registrados";
  return `${plural(vendas, "venda perdida", "vendas perdidas")} e ${plural(pagamentos, "pagamento registrado", "pagamentos registrados")}`;
}

/** Os códigos; com os dois tipos, cada um no seu grupo. */
function PedidosDaRecuperacao({ item }: { item: Recuperacao }) {
  const pagamentos = new Set(item.pagamentos_registrados);
  const vendas = item.pedidos.filter((codigo) => !pagamentos.has(codigo));
  if (pagamentos.size === 0 || vendas.length === 0)
    return (
      <span className="conferencia-codigos">{item.pedidos.join(", ")}</span>
    );
  return (
    <span className="conferencia-codigos">
      Vendas perdidas: {vendas.join(", ")}. Pagamentos registrados:{" "}
      {item.pagamentos_registrados.join(", ")}.
    </span>
  );
}

const COLUNAS: ColunaTabela<Recuperacao>[] = [
  {
    chave: "quando",
    titulo: "Quando",
    principal: true,
    celula: (item) => (
      <span
        id={idDaRecuperacao(item.id)}
        tabIndex={-1}
        className="conferencia-foco"
      >
        {formatarDataHora(item.executado_em)}
      </span>
    ),
  },
  { chave: "quem", titulo: "Quem", celula: (item) => item.usuario.nome },
  { chave: "tipo", titulo: "Tipo", celula: tipoDaRecuperacao },
  {
    chave: "vendas",
    titulo: "Vendas",
    alinhamento: "fim",
    celula: (item) => formatarNumero(item.pedidos_recuperados),
  },
  {
    chave: "bilhetes",
    titulo: "Bilhetes",
    alinhamento: "fim",
    celula: (item) => formatarNumero(item.bilhetes),
  },
  {
    chave: "valor",
    titulo: "Valor",
    alinhamento: "fim",
    celula: (item) => formatarMoeda(item.total_centavos),
  },
  {
    chave: "pedidos",
    titulo: "Pedidos",
    celula: (item) => <PedidosDaRecuperacao item={item} />,
  },
];

/** O que a lista mostra: quantas (todas ou só as mais recentes) e onde as vendas recuperadas aparecem. */
function textoDoHistorico(quantas: number, temMais: boolean): string {
  if (quantas === 0)
    return "Toda venda recuperada e todo pagamento registrado ficam aqui, com quem gravou e quando.";
  const lista = !temMais
    ? `${plural(quantas, "recuperação", "recuperações")}, a mais recente primeiro.`
    : quantas === 1
      ? "A recuperação mais recente; as anteriores em “Carregar mais”."
      : `As ${quantas.toLocaleString("pt-BR")} recuperações mais recentes; as anteriores em “Carregar mais”.`;
  return `${lista} As vendas recuperadas aparecem no sistema como “recuperado na conferência”; os pagamentos registrados, como pagos.`;
}

// Auditoria das recuperações da campanha ativa: quem, quando e quantas vendas cada "Recuperar" gravou (a
// mais recente primeiro), de 50 em 50 ("Carregar mais"). `versao` muda depois de cada gravação, para a
// lista carregar de novo desde o começo. Como na Trilha (RIFA-047), o "Carregar mais" leva o foco à primeira
// recuperação nova (ou, se a página vier vazia, à última da lista: na última página o botão some, e o foco caía no
// <body>) e anuncia o que chegou numa região viva fixa.
export function Historico({ versao }: { versao: number }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erroDoMais, setErroDoMais] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  // Elemento que recebe o foco quando a página nova aparecer na tela.
  const focoPendente = useRef<string | null>(null);

  useEffect(() => {
    // A lista recomeça: o foco que esperava a página do "Carregar mais" não vale mais.
    focoPendente.current = null;
    const controle = new AbortController();
    listarRecuperacoes(null, { signal: controle.signal }).then(
      ({ itens, proximo }) => {
        setEstado({ tipo: "ok", itens, proximo });
        setErroDoMais(null);
      },
      (erro: unknown) => {
        if (!controle.signal.aborted)
          setEstado({
            tipo: "erro",
            mensagem: mensagemDoErro(erro),
            conexao: ehFalhaDeConexao(erro),
          });
      },
    );
    return () => controle.abort();
  }, [versao, tentativa]);

  useEffect(() => {
    if (focoPendente.current === null) return;
    const alvo = document.getElementById(focoPendente.current);
    focoPendente.current = null;
    if (!alvo) return;
    // A recuperação nova vai para o meio da tela (o foco sozinho a deixaria colada na borda de baixo). O jsdom não
    // tem scrollIntoView.
    alvo.focus({ preventScroll: true });
    alvo.scrollIntoView?.({ block: "center" });
  }, [estado]);

  /** `ultimaId`: a última recuperação da lista agora (recebe o foco se a página vier vazia). */
  async function carregarMais(antesDe: number, ultimaId: number | null) {
    setCarregandoMais(true);
    setErroDoMais(null);
    try {
      const pagina = await listarRecuperacoes(antesDe);
      const [primeiraNova] = pagina.itens;
      focoPendente.current = primeiraNova
        ? idDaRecuperacao(primeiraNova.id)
        : ultimaId !== null
          ? idDaRecuperacao(ultimaId)
          : ID_TEXTO_DO_HISTORICO;
      // Só junta se a lista ainda espera esta página (ela pode ter recarregado no meio do caminho).
      setEstado((atual) =>
        atual.tipo === "ok" && atual.proximo === antesDe
          ? {
              tipo: "ok",
              itens: [...atual.itens, ...pagina.itens],
              proximo: pagina.proximo,
            }
          : atual,
      );
      setAnuncio(
        `${plural(pagina.itens.length, "recuperação", "recuperações")} a mais na lista.${pagina.proximo === null ? " Não há recuperações mais antigas." : ""}`,
      );
    } catch (erro) {
      setErroDoMais(mensagemDoErro(erro));
    } finally {
      setCarregandoMais(false);
    }
  }

  const proximo = estado.tipo === "ok" ? estado.proximo : null;
  return (
    <Card titulo="Recuperações feitas">
      {estado.tipo === "carregando" && <Loading texto="Carregando…" />}
      {estado.tipo === "erro" && (
        <ErrorState
          titulo="Não foi possível carregar as recuperações"
          mensagem={estado.mensagem}
          conexao={estado.conexao}
          aoTentarDeNovo={() => {
            setEstado({ tipo: "carregando" });
            setTentativa((valor) => valor + 1);
          }}
        />
      )}
      {estado.tipo === "ok" && (
        <div className="conferencia-bloco">
          {/* Região viva fixa: anuncia o que o "Carregar mais" trouxe. */}
          <p className="visualmente-oculto" role="status">
            {anuncio}
          </p>
          <p
            id={ID_TEXTO_DO_HISTORICO}
            tabIndex={-1}
            className="conferencia-suave conferencia-foco"
          >
            {textoDoHistorico(estado.itens.length, proximo !== null)}
          </p>
          <DataTable
            colunas={COLUNAS}
            linhas={estado.itens}
            chaveDaLinha={(item) => item.id}
            legenda="Recuperações feitas"
            vazio={<EmptyState titulo="Nenhuma venda recuperada ainda." />}
          />
          {proximo !== null && (
            <div className="conferencia-acoes">
              {/* Carregando: indisponível com aria-disabled (RIFA-045), no Tab e com a dica; o clique é barrado. */}
              <ComDica
                texto={carregandoMais ? DICAS.carregando : DICAS.carregarMais}
              >
                <Button
                  variante="secundario"
                  aria-disabled={carregandoMais || undefined}
                  onClick={() => {
                    if (!carregandoMais)
                      void carregarMais(
                        proximo,
                        estado.itens.at(-1)?.id ?? null,
                      );
                  }}
                >
                  {carregandoMais ? "Carregando…" : "Carregar mais"}
                </Button>
              </ComDica>
              {erroDoMais !== null && (
                <p role="alert">Não foi possível carregar mais: {erroDoMais}</p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
