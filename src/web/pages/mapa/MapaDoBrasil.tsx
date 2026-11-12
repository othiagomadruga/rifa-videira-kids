import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { RespostaMapaDdd } from "../../../shared/contracts/api";
import { NOME_DA_UF, type Uf } from "../../../shared/contracts/ddd";
import { ComDica, DataTable, type ColunaTabela } from "../../components/ui";
import { formatarMoeda, formatarNumero } from "../../lib/formatadores";
import {
  POSICAO_DA_UF,
  UFS_NA_ORDEM_DA_GRADE,
  vizinhaNaDirecao,
  type Direcao,
} from "./grade";
import {
  DICAS,
  ROTULO_DA_FAIXA,
  faixaDaUf,
  listaDeNomes,
  rotuloDaUf,
  temVenda,
  textoBilhetes,
  textoParte,
  textoPedidos,
  type Faixa,
  type TotaisMapa,
  type UfDoMapa,
} from "./textos";

const FAIXAS_DA_LEGENDA: readonly Faixa[] = [0, 1, 2, 3, 4, 5];

const DIRECAO_DA_SETA: Readonly<Record<string, Direcao>> = {
  ArrowUp: "cima",
  ArrowDown: "baixo",
  ArrowLeft: "esquerda",
  ArrowRight: "direita",
};

const PRIMEIRA_DA_GRADE: Uf = UFS_NA_ORDEM_DA_GRADE[0];
const ULTIMA_DA_GRADE = UFS_NA_ORDEM_DA_GRADE.at(-1) as Uf;

/** Para onde a tecla leva o foco a partir de `uf`; null se a tecla não é do mapa. */
function destinoDaTecla(uf: Uf, tecla: string): Uf | null {
  if (tecla === "Home") return PRIMEIRA_DA_GRADE;
  if (tecla === "End") return ULTIMA_DA_GRADE;
  const direcao = DIRECAO_DA_SETA[tecla];
  return direcao ? vizinhaNaDirecao(POSICAO_DA_UF, uf, direcao) : null;
}

const COLUNAS_UFS: ColunaTabela<UfDoMapa>[] = [
  {
    chave: "uf",
    titulo: "Estado",
    principal: true,
    celula: (item) => (
      <span className="mapa-celula">
        {NOME_DA_UF[item.uf]} ({item.uf})
      </span>
    ),
  },
  {
    chave: "pedidos",
    titulo: "Pedidos aprovados",
    alinhamento: "fim",
    celula: (item) => (
      <span className="mapa-celula">
        {formatarNumero(item.pedidos_aprovados)}
      </span>
    ),
  },
  {
    chave: "bilhetes",
    titulo: "Bilhetes",
    alinhamento: "fim",
    celula: (item) => (
      <span className="mapa-celula">{formatarNumero(item.bilhetes)}</span>
    ),
  },
  {
    chave: "valor",
    titulo: "Valor",
    alinhamento: "fim",
    celula: (item) => (
      <span className="mapa-celula mapa-valor">
        {formatarMoeda(item.total_centavos)}
      </span>
    ),
  },
  {
    chave: "parte",
    titulo: "Parte dos bilhetes",
    alinhamento: "fim",
    celula: (item) => <span className="mapa-celula">{textoParte(item)}</span>,
  },
];

// Mapa em grade (cartograma, D17): um quadrado por UF, na posição aproximada do Brasil (grade.ts), com a cor pela
// parte dos bilhetes. Cada quadrado é um botão com o rótulo completo (nome, pedidos, bilhetes, R$ e parte); passar
// o mouse, focar ou tocar mostra os números no quadro do canto vazio da grade (embaixo, à esquerda), perto de todos
// os estados também no celular. A mesma informação está na tabela dos estados (o mapa nunca é a única forma de
// ler) e, por DDD, na tabela da tela.
//
// Teclado (RIFA-027, tabindex móvel): o mapa é uma parada só do Tab. Entra na UF que está no quadro (a que mais
// vendeu, ao abrir; sem venda em nenhuma UF, a primeira da grade) e, com o foco dentro, fica na UF focada; as setas
// andam pela grade (grade.ts, vizinhaNaDirecao), Home e End vão à primeira e à última UF da ordem da grade, e o Tab
// seguinte sai do mapa.
export function MapaDoBrasil({ resposta }: { resposta: RespostaMapaDdd }) {
  const idTitulo = useId();
  const idTeclado = useId();
  const grade = useRef<HTMLDivElement>(null);
  const porUf = new Map<Uf, UfDoMapa>(
    resposta.ufs.map((item) => [item.uf, item]),
  );
  // O quadro começa no estado que mais vendeu.
  const [ativa, setAtiva] = useState<Uf | null>(resposta.ufs[0]?.uf ?? null);
  // A UF com o foco (null com o foco fora do mapa): o mouse troca o quadro, mas não tira o Tab de onde o foco está.
  const [focada, setFocada] = useState<Uf | null>(null);
  const parada = focada ?? ativa ?? PRIMEIRA_DA_GRADE;

  /** Seta, Home ou End: leva o foco (e, com ele, o quadro) à UF de destino; fica onde está se não há para onde ir. */
  function andar(evento: KeyboardEvent<HTMLButtonElement>, uf: Uf) {
    if (evento.altKey || evento.ctrlKey || evento.metaKey) return;
    const destino = destinoDaTecla(uf, evento.key);
    if (destino === null) return;
    evento.preventDefault();
    grade.current
      ?.querySelector<HTMLButtonElement>(`[data-uf="${destino}"]`)
      ?.focus();
  }

  const semVenda = UFS_NA_ORDEM_DA_GRADE.filter((uf) => !porUf.has(uf))
    .map((uf) => NOME_DA_UF[uf])
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return (
    <section className="mapa-secao mapa-brasil" aria-labelledby={idTitulo}>
      <h2 id={idTitulo} className="mapa-secao__titulo">
        Por estado
      </h2>
      <p className="mapa-secao__texto">
        Toque num estado ou passe o mouse: os números aparecem no quadro do
        canto do mapa.{" "}
        <span id={idTeclado}>
          No teclado, use as setas para andar pelo mapa.
        </span>
      </p>
      <div className="mapa-brasil__corpo">
        <div
          ref={grade}
          className="mapa-grade"
          role="group"
          aria-label="Mapa das vendas por estado"
          aria-describedby={idTeclado}
          onBlur={(evento) => {
            const destino = evento.relatedTarget;
            if (!(destino instanceof Node && grade.current?.contains(destino)))
              setFocada(null);
          }}
        >
          {UFS_NA_ORDEM_DA_GRADE.map((uf) => {
            const [linha, coluna] = POSICAO_DA_UF[uf];
            const totais = porUf.get(uf);
            return (
              <ComDica key={uf} texto={DICAS.uf}>
                <button
                  type="button"
                  className="mapa-uf"
                  data-linha={linha}
                  data-coluna={coluna}
                  data-faixa={faixaDaUf(totais)}
                  data-uf={uf}
                  data-ativa={ativa === uf ? "" : undefined}
                  tabIndex={uf === parada ? 0 : -1}
                  aria-label={rotuloDaUf(uf, totais)}
                  onPointerEnter={() => setAtiva(uf)}
                  onFocus={() => {
                    setAtiva(uf);
                    setFocada(uf);
                  }}
                  onClick={() => setAtiva(uf)}
                  onKeyDown={(evento) => andar(evento, uf)}
                >
                  <span aria-hidden="true">{uf}</span>
                </button>
              </ComDica>
            );
          })}
          <Quadro uf={ativa} totais={ativa ? porUf.get(ativa) : undefined} />
        </div>
        <div className="mapa-brasil__lado">
          <Legenda />
          <NotaDoDdd />
        </div>
      </div>
      <details className="mapa-detalhes">
        <ComDica texto={DICAS.tabelaDosEstados}>
          <summary>Ver os estados em tabela</summary>
        </ComDica>
        <div className="mapa-detalhes__conteudo">
          <DataTable
            colunas={COLUNAS_UFS}
            linhas={resposta.ufs}
            chaveDaLinha={(item) => item.uf}
            legenda="Vendas por estado, do que mais vendeu bilhetes para o que menos vendeu"
          />
          {semVenda.length > 0 && (
            <p className="mapa-detalhes__sem-venda">
              {semVenda.length === 1
                ? "Sem venda: "
                : `Sem venda (${semVenda.length} estados): `}
              {listaDeNomes(semVenda)}.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

/** Os números do estado escolhido (pelo mouse, pelo foco ou pelo toque), no canto vazio da grade. */
function Quadro({ uf, totais }: { uf: Uf | null; totais?: TotaisMapa }) {
  if (uf === null) {
    return (
      <div className="mapa-quadro" data-faixa={0}>
        <p className="mapa-quadro__linha">Escolha um estado.</p>
      </div>
    );
  }
  return (
    <div className="mapa-quadro" data-faixa={faixaDaUf(totais)}>
      <p className="mapa-quadro__nome">{NOME_DA_UF[uf]}</p>
      {totais && temVenda(totais) ? (
        <>
          <p className="mapa-quadro__parte">
            <strong
              data-longo={
                textoParte(totais).startsWith("menos") ? "" : undefined
              }
            >
              {textoParte(totais)}
            </strong>{" "}
            dos bilhetes
          </p>
          <p className="mapa-quadro__linha">
            {textoPedidos(totais.pedidos_aprovados)}
          </p>
          <p className="mapa-quadro__linha">{textoBilhetes(totais.bilhetes)}</p>
          <p className="mapa-quadro__linha mapa-valor">
            {formatarMoeda(totais.total_centavos)}
          </p>
        </>
      ) : (
        <p className="mapa-quadro__linha">Sem venda aprovada.</p>
      )}
    </div>
  );
}

/** A escala de cor (a parte dos bilhetes de cada estado), com o texto de cada faixa: a cor nunca fala sozinha. */
function Legenda() {
  return (
    <div className="mapa-legenda">
      <p className="mapa-legenda__titulo">Parte dos bilhetes do estado</p>
      <ul className="mapa-legenda__faixas" role="list">
        {FAIXAS_DA_LEGENDA.map((faixa) => (
          <li key={faixa} className="mapa-legenda__faixa">
            <span
              className="mapa-legenda__amostra"
              data-faixa={faixa}
              aria-hidden="true"
            />
            {ROTULO_DA_FAIXA[faixa]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A nota da legenda: o que o DDD diz (e o que não diz). */
function NotaDoDdd() {
  return (
    <div className="mapa-nota">
      <p className="mapa-nota__titulo">Como ler</p>
      <ul className="mapa-nota__itens">
        <li>
          O DDD é o do telefone cadastrado na Rifei, não onde a pessoa mora.
        </li>
        <li>O DDD 61 inclui o Entorno do DF (cidades de Goiás).</li>
        <li>
          “Sem DDD”: sem telefone, telefone fora do padrão ou DDD desconhecido.
        </li>
      </ul>
    </div>
  );
}
