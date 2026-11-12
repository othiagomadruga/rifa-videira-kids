import { useEffect, useState } from "react";
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
import { mensagemDoErro } from "../../lib/api";
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
  | { tipo: "erro"; mensagem: string };

const COLUNAS: ColunaTabela<Recuperacao>[] = [
  {
    chave: "quando",
    titulo: "Quando",
    principal: true,
    celula: (item) => formatarDataHora(item.executado_em),
  },
  { chave: "quem", titulo: "Quem", celula: (item) => item.usuario.nome },
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
    celula: (item) => (
      <span className="conferencia-codigos">{item.pedidos.join(", ")}</span>
    ),
  },
];

/** O que a lista mostra: quantas (todas ou só as mais recentes) e onde as vendas recuperadas aparecem. */
function textoDoHistorico(quantas: number, temMais: boolean): string {
  if (quantas === 0)
    return "Toda venda recuperada fica registrada aqui, com quem recuperou e quando.";
  const lista = !temMais
    ? `${plural(quantas, "recuperação", "recuperações")}, a mais recente primeiro.`
    : quantas === 1
      ? "A recuperação mais recente; as anteriores em “Carregar mais”."
      : `As ${quantas.toLocaleString("pt-BR")} recuperações mais recentes; as anteriores em “Carregar mais”.`;
  return `${lista} As vendas recuperadas aparecem no sistema como “recuperado na conferência”.`;
}

// Auditoria das recuperações da campanha ativa: quem, quando e quantas vendas cada "Recuperar" gravou (a
// mais recente primeiro), de 50 em 50 ("Carregar mais"). `versao` muda depois de cada gravação, para a
// lista carregar de novo desde o começo.
export function Historico({ versao }: { versao: number }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erroDoMais, setErroDoMais] = useState<string | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    listarRecuperacoes(null, { signal: controle.signal }).then(
      ({ itens, proximo }) => {
        setEstado({ tipo: "ok", itens, proximo });
        setErroDoMais(null);
      },
      (erro: unknown) => {
        if (!controle.signal.aborted)
          setEstado({ tipo: "erro", mensagem: mensagemDoErro(erro) });
      },
    );
    return () => controle.abort();
  }, [versao, tentativa]);

  async function carregarMais(antesDe: number) {
    setCarregandoMais(true);
    setErroDoMais(null);
    try {
      const pagina = await listarRecuperacoes(antesDe);
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
          aoTentarDeNovo={() => {
            setEstado({ tipo: "carregando" });
            setTentativa((valor) => valor + 1);
          }}
        />
      )}
      {estado.tipo === "ok" && (
        <div className="conferencia-bloco">
          <p className="conferencia-suave">
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
                    if (!carregandoMais) void carregarMais(proximo);
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
