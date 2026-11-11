import { useId, type ReactNode } from "react";
import type { RespostaMapaDdd } from "../../../shared/contracts/api";
import { NOME_DA_UF, type Uf } from "../../../shared/contracts/ddd";
import { DataTable, type ColunaTabela } from "../../components/ui";
import { formatarMoeda, formatarNumero } from "../../lib/formatadores";
import { posicoesDoTop3, textoParte, type TotaisMapa } from "./textos";

type Linha =
  | { tipo: "ddd"; ddd: string; uf: Uf; totais: TotaisMapa; posicao?: number }
  | { tipo: "exterior" | "sem_ddd" | "total"; totais: TotaisMapa };

const NOME_DA_LINHA = {
  exterior: { nome: "Exterior", uf: "Fora do Brasil" },
  sem_ddd: { nome: "Sem DDD", uf: "Não identificada" },
  total: { nome: "Total", uf: "Todas" },
} as const;

/** O tipo da linha vai no bloco da célula: o CSS separa as linhas de fechamento e destaca o total. */
function bloco(linha: Linha, conteudo: ReactNode, extra = "") {
  return (
    <span
      className={`mapa-celula${extra ? ` ${extra}` : ""}`}
      data-linha-tipo={linha.tipo}
    >
      {conteudo}
    </span>
  );
}

const COLUNAS: ColunaTabela<Linha>[] = [
  {
    chave: "ddd",
    titulo: "DDD",
    principal: true,
    celula: (linha) =>
      linha.tipo === "ddd"
        ? bloco(
            linha,
            <>
              {linha.ddd}
              {linha.posicao !== undefined && (
                <>
                  {" "}
                  <span className="mapa-top">
                    {linha.posicao}º
                    <span className="visualmente-oculto"> em bilhetes</span>
                  </span>
                </>
              )}
            </>,
          )
        : bloco(linha, NOME_DA_LINHA[linha.tipo].nome),
  },
  {
    chave: "uf",
    titulo: "UF",
    celula: (linha) =>
      bloco(
        linha,
        linha.tipo === "ddd"
          ? NOME_DA_UF[linha.uf]
          : NOME_DA_LINHA[linha.tipo].uf,
      ),
  },
  {
    chave: "pedidos",
    titulo: "Pedidos aprovados",
    alinhamento: "fim",
    celula: (linha) =>
      bloco(linha, formatarNumero(linha.totais.pedidos_aprovados)),
  },
  {
    chave: "bilhetes",
    titulo: "Bilhetes",
    alinhamento: "fim",
    celula: (linha) => bloco(linha, formatarNumero(linha.totais.bilhetes)),
  },
  {
    chave: "valor",
    titulo: "Valor",
    alinhamento: "fim",
    celula: (linha) =>
      bloco(linha, formatarMoeda(linha.totais.total_centavos), "mapa-valor"),
  },
  {
    chave: "parte",
    titulo: "Parte dos bilhetes",
    alinhamento: "fim",
    celula: (linha) => bloco(linha, textoParte(linha.totais)),
  },
];

/** As linhas da tabela: os DDDs na ordem da API, depois exterior, sem DDD e o total. */
export function linhasDaTabela(resposta: RespostaMapaDdd): Linha[] {
  const top3 = posicoesDoTop3(resposta.ddds);
  return [
    ...resposta.ddds.map((item): Linha => ({
      tipo: "ddd",
      ddd: item.ddd,
      uf: item.uf,
      totais: item,
      posicao: top3.get(item.ddd),
    })),
    { tipo: "exterior", totais: resposta.exterior },
    { tipo: "sem_ddd", totais: resposta.sem_ddd },
    { tipo: "total", totais: resposta.total },
  ];
}

// Lista por DDD: uma linha por DDD com venda, na ordem que vem da API (por UF, da que mais vendeu, e dentro dela
// do DDD que mais vendeu), mais "Exterior", "Sem DDD" e o total. Os 3 DDDs que mais venderam bilhetes ganham a
// posição ao lado do número, discreta (a ordem da tabela continua a da API).
export function TabelaDdd({ resposta }: { resposta: RespostaMapaDdd }) {
  const idTitulo = useId();
  return (
    <section className="mapa-secao mapa-ddds" aria-labelledby={idTitulo}>
      <h2 id={idTitulo} className="mapa-secao__titulo">
        Por DDD
      </h2>
      <p className="mapa-secao__texto">
        Os DDDs com venda, agrupados por estado. Os 3 que mais venderam bilhetes
        têm a posição ao lado do número.
      </p>
      <DataTable
        colunas={COLUNAS}
        linhas={linhasDaTabela(resposta)}
        chaveDaLinha={(linha) =>
          linha.tipo === "ddd" ? linha.ddd : linha.tipo
        }
        legenda="Vendas por DDD, com exterior, sem DDD e o total"
      />
    </section>
  );
}
