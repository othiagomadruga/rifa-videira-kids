import { useEffect, useState } from "react";
import type { Recuperacao } from "../../../shared/contracts";
import {
  Card,
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
import { plural } from "./textos";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "ok"; itens: Recuperacao[] }
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

// Auditoria das recuperações: quem, quando e quantas vendas cada "Recuperar" gravou (a mais recente
// primeiro). `versao` muda depois de cada gravação, para a lista carregar de novo.
export function Historico({ versao }: { versao: number }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    listarRecuperacoes({ signal: controle.signal }).then(
      (itens) => setEstado({ tipo: "ok", itens }),
      (erro: unknown) => {
        if (!controle.signal.aborted)
          setEstado({ tipo: "erro", mensagem: mensagemDoErro(erro) });
      },
    );
    return () => controle.abort();
  }, [versao, tentativa]);

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
            {estado.itens.length === 0
              ? "Toda venda recuperada fica registrada aqui, com quem recuperou e quando."
              : `${plural(estado.itens.length, "recuperação", "recuperações")}, a mais recente primeiro. As vendas recuperadas aparecem no sistema como “recuperado na conferência”.`}
          </p>
          <DataTable
            colunas={COLUNAS}
            linhas={estado.itens}
            chaveDaLinha={(item) => item.id}
            legenda="Recuperações feitas"
            vazio={<EmptyState titulo="Nenhuma venda recuperada ainda." />}
          />
        </div>
      )}
    </Card>
  );
}
