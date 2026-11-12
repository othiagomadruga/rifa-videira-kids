import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ComDica } from "./Dica";
import { indicesDoEixoX, marcasDoEixoY } from "./escalaGrafico";
import "./GraficoLinhas.css";

/**
 * destaque: a série principal (linha cheia na cor de destaque, área suave e marcador no último ponto);
 * referencia: a base de comparação (linha tracejada, cinza), ex.: o esperado ou a meta.
 */
export type EstiloSerie = "destaque" | "referencia";

export type SerieGrafico = {
  /** Nome na legenda, na dica e na tabela. */
  rotulo: string;
  /** Um valor por ponto do eixo X; null = sem dado (ex.: um dia que ainda não chegou). */
  valores: readonly (number | null)[];
  estilo: EstiloSerie;
  /** Rótulo direto no último ponto com valor. Padrão: o valor formatado; null: sem rótulo. */
  rotuloFinal?: string | null;
};

/** Coluna que aparece só na dica e na tabela (ex.: o vendido no dia). */
export type ColunaExtraGrafico = {
  rotulo: string;
  valores: readonly (number | null)[];
};

type Props = {
  /** Nome do gráfico: título do SVG (leitor de tela) e legenda da tabela. */
  titulo: string;
  /** O que o gráfico mostra, em texto (descrição do SVG): a conclusão, não a lista de valores. */
  descricao: string;
  /** Rótulos curtos do eixo X, um por ponto (ex.: "23/11"). */
  rotulosX: readonly string[];
  /** Rótulos completos de cada ponto, na dica e na tabela (ex.: "Dia 1 · 23/11/2026"). Padrão: rotulosX. */
  rotulosPonto?: readonly string[];
  /** Título da primeira coluna da tabela (ex.: "Dia"). */
  tituloColunaX: string;
  /** Até 4 séries; a legenda aparece sempre. */
  series: readonly SerieGrafico[];
  extras?: readonly ColunaExtraGrafico[];
  /** Valor completo (dica, tabela e rótulos diretos). Os valores são inteiros. */
  formatarValor: (valor: number) => string;
  /** Marcas do eixo Y (curto). Padrão: formatarValor. */
  formatarEixo?: (valor: number) => string;
  /** Ponto atual (ex.: hoje): marcado na tabela, e onde a mira começa ao focar o gráfico. */
  indiceAtual?: number | null;
  /** Como o ponto atual é chamado na dica e na tabela (ex.: "hoje"). */
  rotuloAtual?: string;
  /**
   * Dica (tooltip, RIFA-045) do "Ver os dados em tabela": o que a tabela traz. Sem ela, o `<summary>` fica sem dica
   * (a tela que usa o gráfico diz o texto, no `textos.ts` dela).
   */
  dicaDados?: ReactNode;
};

// Medidas em px (o SVG é desenhado na largura real, para o texto não encolher no celular).
const LARGURA_PADRAO = 640;
const LARGURA_ALTURA_MAIOR = 560;
const ALTURA_CELULAR = 220;
const ALTURA_COMPUTADOR = 300;
const MARGEM_TOPO = 28;
const MARGEM_DIREITA = 12;
const MARGEM_BASE = 32;
const ESPACO_EIXO_Y = 10;
/** Largura média de um caractere do texto do gráfico (13 px), para estimar rótulos sem medir. */
const PX_POR_CARACTERE = 7.5;
const ALTURA_TEXTO = 14;
/** A dica fica ao lado da mira, sem cobri-la: larga quando cabe, mais estreita no celular. */
const LARGURA_DICA = 208;
const LARGURA_DICA_MINIMA = 140;
const AFASTAMENTO_DICA = 12;
const RAIO_MARCADOR = 4;

type Ponto = { indice: number; valor: number };
type Caixa = { x1: number; x2: number; y1: number; y2: number };
type RotuloDireto = {
  texto: string;
  x: number;
  y: number;
  ancora: "start" | "middle" | "end";
  caixa: Caixa;
};
type Mira = { indice: number; teclado: boolean };

const arredondar = (valor: number) => Math.round(valor * 10) / 10;

/** Trechos contínuos de valores (um null interrompe a linha). */
function trechos(valores: readonly (number | null)[]): Ponto[][] {
  const lista: Ponto[][] = [];
  let atual: Ponto[] = [];
  valores.forEach((valor, indice) => {
    if (valor === null) {
      if (atual.length > 0) lista.push(atual);
      atual = [];
    } else {
      atual.push({ indice, valor });
    }
  });
  if (atual.length > 0) lista.push(atual);
  return lista;
}

function ultimoPonto(valores: readonly (number | null)[]): Ponto | null {
  for (let indice = valores.length - 1; indice >= 0; indice--) {
    const valor = valores[indice];
    if (valor !== null) return { indice, valor };
  }
  return null;
}

/**
 * Onde a dica fica, ao lado da mira (em `px`) e dentro do gráfico: à direita se couber larga, senão à
 * esquerda; se nenhum lado couber a largura cheia (celular), no lado com mais espaço, mais estreita. Só
 * num gráfico estreito demais para a largura mínima ela pode cobrir a mira.
 */
function posicaoDaDica(
  px: number,
  largura: number,
): { esquerda: number; largura: number } {
  const aDireita = largura - px - AFASTAMENTO_DICA;
  const aEsquerda = px - AFASTAMENTO_DICA;
  if (aDireita >= LARGURA_DICA)
    return { esquerda: px + AFASTAMENTO_DICA, largura: LARGURA_DICA };
  if (aEsquerda >= LARGURA_DICA)
    return { esquerda: aEsquerda - LARGURA_DICA, largura: LARGURA_DICA };
  const larguraDica = Math.min(
    largura,
    Math.max(LARGURA_DICA_MINIMA, Math.max(aDireita, aEsquerda)),
  );
  return aDireita >= aEsquerda
    ? {
        esquerda: Math.min(px + AFASTAMENTO_DICA, largura - larguraDica),
        largura: larguraDica,
      }
    : {
        esquerda: Math.max(0, aEsquerda - larguraDica),
        largura: larguraDica,
      };
}

type Trecho = { x1: number; y1: number; x2: number; y2: number };

/** O segmento passa pela caixa (com uma folga de 3 px)? Só a parte dele na faixa horizontal da caixa conta. */
function trechoColide(trecho: Trecho, caixa: Caixa, folga = 3): boolean {
  const xMin = Math.max(Math.min(trecho.x1, trecho.x2), caixa.x1);
  const xMax = Math.min(Math.max(trecho.x1, trecho.x2), caixa.x2);
  if (xMin > xMax) return false;
  const yEm = (px: number) =>
    trecho.y1 +
    ((px - trecho.x1) / (trecho.x2 - trecho.x1)) * (trecho.y2 - trecho.y1);
  const ys =
    trecho.x1 === trecho.x2 ? [trecho.y1, trecho.y2] : [yEm(xMin), yEm(xMax)];
  return (
    Math.min(...ys) - folga < caixa.y2 && caixa.y1 < Math.max(...ys) + folga
  );
}

const colidem = (a: Caixa, b: Caixa) =>
  a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/**
 * Largura do elemento em px, acompanhando o redimensionamento. Sem medida (ex.: jsdom, sem
 * ResizeObserver e com largura 0), fica o `padrao`.
 */
function useLarguraDoElemento(
  ref: RefObject<HTMLElement | null>,
  padrao: number,
): number {
  const [largura, setLargura] = useState(padrao);
  useLayoutEffect(() => {
    const elemento = ref.current;
    if (!elemento) return;
    const medir = (valor: number) => {
      if (valor > 0) setLargura(Math.floor(valor));
    };
    medir(elemento.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(([entrada]) =>
      medir(entrada.contentRect.width),
    );
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [ref]);
  return largura;
}

/** Traço da série (legenda e dica): o mesmo da linha do gráfico. */
function ChaveSerie({ estilo }: { estilo: EstiloSerie }) {
  return (
    <svg
      className="ui-grafico__chave"
      width="24"
      height="10"
      viewBox="0 0 24 10"
      aria-hidden="true"
      focusable="false"
    >
      <line
        className={`ui-grafico__linha ui-grafico__linha--${estilo}`}
        x1="1"
        y1="5"
        x2="23"
        y2="5"
      />
    </svg>
  );
}

// Gráfico de linhas acessível (docs/frontend.md): SVG com título e descrição, legenda sempre visível,
// rótulo direto só no fim das linhas, mira com dica no ponteiro, no toque e no teclado (setas, Home e
// End, anunciadas ao leitor de tela) e a tabela com todos os valores. Cores do tema (claro e telão).
export function GraficoLinhas({
  titulo,
  descricao,
  rotulosX,
  rotulosPonto = rotulosX,
  tituloColunaX,
  series,
  extras = [],
  formatarValor,
  formatarEixo = formatarValor,
  indiceAtual = null,
  rotuloAtual = "atual",
  dicaDados,
}: Props) {
  const idTitulo = useId();
  const idDescricao = useId();
  const idInstrucoes = useId();
  const refArea = useRef<HTMLDivElement>(null);
  const largura = useLarguraDoElemento(refArea, LARGURA_PADRAO);
  const [mira, setMira] = useState<Mira | null>(null);

  const total = rotulosX.length;
  const altura =
    largura >= LARGURA_ALTURA_MAIOR ? ALTURA_COMPUTADOR : ALTURA_CELULAR;
  const todosOsValores = series.flatMap((serie) =>
    serie.valores.filter((valor): valor is number => valor !== null),
  );
  const marcasY = marcasDoEixoY(Math.max(0, ...todosOsValores));
  const topoDoEixo = marcasY[marcasY.length - 1];
  const rotulosY = marcasY.map((marca) => formatarEixo(marca));
  const esquerda =
    Math.ceil(
      Math.max(...rotulosY.map((rotulo) => rotulo.length)) * PX_POR_CARACTERE,
    ) + ESPACO_EIXO_Y;
  const larguraUtil = Math.max(1, largura - esquerda - MARGEM_DIREITA);
  const alturaUtil = altura - MARGEM_TOPO - MARGEM_BASE;
  const base = MARGEM_TOPO + alturaUtil;
  const direita = esquerda + larguraUtil;

  const x = (indice: number) =>
    esquerda +
    (total <= 1 ? larguraUtil / 2 : (indice * larguraUtil) / (total - 1));
  const y = (valor: number) => base - (valor / topoDoEixo) * alturaUtil;

  const caminho = (trecho: Ponto[]) =>
    trecho
      .map(
        ({ indice, valor }, posicao) =>
          `${posicao === 0 ? "M" : "L"}${arredondar(x(indice))} ${arredondar(y(valor))}`,
      )
      .join(" ");
  const area = (trecho: Ponto[]) =>
    `${caminho(trecho)} L${arredondar(x(trecho[trecho.length - 1].indice))} ${base} L${arredondar(x(trecho[0].indice))} ${base} Z`;

  // As de referência são desenhadas antes, por baixo; as de destaque, por cima (a legenda segue a ordem dada).
  const ordemDeDesenho = [...series].sort(
    (a, b) => Number(a.estilo === "destaque") - Number(b.estilo === "destaque"),
  );

  /** A ponta de uma linha: o marcador do último ponto e o último trecho (do ponto anterior até ele). */
  const pontaDaLinha = (
    serie: SerieGrafico,
  ): { marcador: Caixa; trecho: Trecho | null } | null => {
    const fim = ultimoPonto(serie.valores);
    if (!fim) return null;
    const px = x(fim.indice);
    const py = y(fim.valor);
    const folga = RAIO_MARCADOR + 2;
    const anterior = serie.valores
      .slice(0, fim.indice)
      .findLastIndex((valor) => valor !== null);
    return {
      marcador: {
        x1: px - folga,
        x2: px + folga,
        y1: py - folga,
        y2: py + folga,
      },
      trecho:
        anterior < 0
          ? null
          : {
              x1: x(anterior),
              y1: y(serie.valores[anterior] ?? 0),
              x2: px,
              y2: py,
            },
    };
  };
  // Rótulos diretos no fim das linhas, primeiro os de destaque. Cada um tenta ficar acima do próprio
  // ponto e, se encostar noutro rótulo ou na ponta de uma linha de destaque (o marcador e o último
  // trecho), abaixo; se não couber em nenhum dos dois, sai (a legenda, a dica e a tabela continuam
  // dizendo o valor).
  const rotulosDiretos: RotuloDireto[] = [];
  for (const serie of [...ordemDeDesenho].reverse()) {
    const fim = ultimoPonto(serie.valores);
    if (!fim || serie.rotuloFinal === null) continue;
    const texto = serie.rotuloFinal ?? formatarValor(fim.valor);
    const larguraTexto = texto.length * PX_POR_CARACTERE;
    const px = x(fim.indice);
    const py = y(fim.valor);
    let ancora: RotuloDireto["ancora"] = "middle";
    if (px + larguraTexto / 2 > direita) ancora = "end";
    else if (px - larguraTexto / 2 < esquerda) ancora = "start";
    const x1 =
      ancora === "start"
        ? px
        : ancora === "end"
          ? px - larguraTexto
          : px - larguraTexto / 2;
    // A ponta das linhas de destaque (desenhadas por cima) também é obstáculo; a da referência, não.
    const pontas = series
      .filter((outra) => outra !== serie && outra.estilo === "destaque")
      .map(pontaDaLinha)
      .filter((ponta) => ponta !== null);
    const obstaculos = [
      ...rotulosDiretos.map((outro) => outro.caixa),
      ...pontas.map((ponta) => ponta.marcador),
    ];
    const trechosNaPonta = pontas
      .map((ponta) => ponta.trecho)
      .filter((trecho) => trecho !== null);
    const posicao = [py - 10, py + 20]
      .map((yTexto) => ({
        yTexto,
        caixa: {
          x1,
          x2: x1 + larguraTexto,
          y1: yTexto - ALTURA_TEXTO + 2,
          y2: yTexto + 4,
        },
      }))
      .find(
        ({ caixa }) =>
          caixa.y1 >= 0 &&
          caixa.y2 <= base &&
          !obstaculos.some((obstaculo) => colidem(obstaculo, caixa)) &&
          !trechosNaPonta.some((trecho) => trechoColide(trecho, caixa)),
      );
    if (posicao)
      rotulosDiretos.push({
        texto,
        x: px,
        y: posicao.yTexto,
        ancora,
        caixa: posicao.caixa,
      });
  }

  const indicesX = indicesDoEixoX(
    total,
    larguraUtil,
    Math.max(0, ...rotulosX.map((rotulo) => rotulo.length)) * PX_POR_CARACTERE,
  );
  const indiceInicial =
    indiceAtual ??
    ultimoPonto(
      series.find((serie) => serie.estilo === "destaque")?.valores ?? [],
    )?.indice ??
    total - 1;

  const valorOuTraco = (valor: number | null | undefined) =>
    valor === null || valor === undefined ? "—" : formatarValor(valor);
  const nomeDoPonto = (indice: number) =>
    indice === indiceAtual
      ? `${rotulosPonto[indice]} (${rotuloAtual})`
      : rotulosPonto[indice];
  const textoDoPonto = (indice: number) =>
    `${nomeDoPonto(indice)}: ${[...series, ...extras]
      .map(
        (coluna) =>
          `${coluna.rotulo} ${coluna.valores[indice] === null ? "sem dado" : valorOuTraco(coluna.valores[indice])}`,
      )
      .join("; ")}.`;

  function indiceDoPonteiro(evento: PointerEvent<SVGSVGElement>): number {
    const caixa = evento.currentTarget.getBoundingClientRect();
    const escala = caixa.width > 0 ? largura / caixa.width : 1;
    const px = (evento.clientX - caixa.left) * escala;
    if (total <= 1) return 0;
    const indice = Math.round(((px - esquerda) / larguraUtil) * (total - 1));
    return Math.min(total - 1, Math.max(0, indice));
  }

  function aoMoverPonteiro(evento: PointerEvent<SVGSVGElement>) {
    if (total === 0) return;
    setMira({ indice: indiceDoPonteiro(evento), teclado: false });
  }

  function aoSairPonteiro(evento: PointerEvent<SVGSVGElement>) {
    // No toque, a dica fica até o próximo toque ou até o foco sair do gráfico.
    if (evento.pointerType !== "touch") setMira(null);
  }

  function aoTeclar(evento: KeyboardEvent<SVGSVGElement>) {
    if (total === 0) return;
    const atual = mira?.indice ?? indiceInicial;
    let proximo: number;
    switch (evento.key) {
      case "ArrowLeft":
      case "ArrowDown":
        proximo = Math.max(0, atual - 1);
        break;
      case "ArrowRight":
      case "ArrowUp":
        proximo = Math.min(total - 1, atual + 1);
        break;
      case "Home":
        proximo = 0;
        break;
      case "End":
        proximo = total - 1;
        break;
      case "Escape":
        setMira(null);
        return;
      default:
        return;
    }
    evento.preventDefault();
    setMira({ indice: proximo, teclado: true });
  }

  const indiceMira = mira && mira.indice < total ? mira.indice : null;
  const dica =
    indiceMira === null ? null : posicaoDaDica(x(indiceMira), largura);

  return (
    <div className="ui-grafico">
      <ul className="ui-grafico__legenda" aria-label="Legenda">
        {series.map((serie) => (
          <li key={serie.rotulo} className="ui-grafico__legenda-item">
            <ChaveSerie estilo={serie.estilo} />
            {serie.rotulo}
          </li>
        ))}
      </ul>

      <div ref={refArea} className="ui-grafico__area">
        <svg
          className="ui-grafico__svg"
          width={largura}
          height={altura}
          viewBox={`0 0 ${largura} ${altura}`}
          role="img"
          aria-labelledby={idTitulo}
          aria-describedby={`${idDescricao} ${idInstrucoes}`}
          tabIndex={total > 0 ? 0 : undefined}
          onPointerMove={aoMoverPonteiro}
          onPointerDown={aoMoverPonteiro}
          onPointerLeave={aoSairPonteiro}
          onFocus={() =>
            setMira(
              (atual) => atual ?? { indice: indiceInicial, teclado: true },
            )
          }
          onBlur={() => setMira(null)}
          onKeyDown={aoTeclar}
        >
          <title id={idTitulo}>{titulo}</title>
          <desc id={idDescricao}>{descricao}</desc>

          <g className="ui-grafico__eixo-y">
            {marcasY.map((marca, posicao) => (
              <g key={marca}>
                <line
                  className="ui-grafico__grade"
                  x1={esquerda}
                  x2={direita}
                  y1={arredondar(y(marca))}
                  y2={arredondar(y(marca))}
                />
                <text
                  className="ui-grafico__texto-eixo"
                  x={esquerda - ESPACO_EIXO_Y}
                  y={arredondar(y(marca))}
                  dy="0.32em"
                  textAnchor="end"
                >
                  {rotulosY[posicao]}
                </text>
              </g>
            ))}
          </g>

          <g className="ui-grafico__eixo-x">
            {indicesX.map((indice, posicao) => (
              <text
                key={indice}
                className="ui-grafico__texto-eixo"
                x={arredondar(x(indice))}
                y={base + 20}
                textAnchor={
                  total > 1 && posicao === 0
                    ? "start"
                    : total > 1 && posicao === indicesX.length - 1
                      ? "end"
                      : "middle"
                }
              >
                {rotulosX[indice]}
              </text>
            ))}
          </g>

          {ordemDeDesenho.map((serie) =>
            trechos(serie.valores).map((trecho) => (
              <g key={`${serie.rotulo}-${trecho[0].indice}`}>
                {serie.estilo === "destaque" && trecho.length > 1 && (
                  <path className="ui-grafico__area-serie" d={area(trecho)} />
                )}
                <path
                  className={`ui-grafico__linha ui-grafico__linha--${serie.estilo}`}
                  d={caminho(trecho)}
                />
              </g>
            )),
          )}

          {ordemDeDesenho.map((serie) => {
            const fim = ultimoPonto(serie.valores);
            const mostrar =
              fim &&
              (serie.estilo === "destaque" ||
                serie.valores.filter((valor) => valor !== null).length === 1);
            return mostrar ? (
              <circle
                key={serie.rotulo}
                className={`ui-grafico__marcador ui-grafico__marcador--${serie.estilo}`}
                cx={arredondar(x(fim.indice))}
                cy={arredondar(y(fim.valor))}
                r={RAIO_MARCADOR}
              />
            ) : null;
          })}

          {rotulosDiretos.map((rotulo, posicao) => (
            <text
              key={posicao}
              className="ui-grafico__rotulo"
              x={arredondar(rotulo.x)}
              y={arredondar(rotulo.y)}
              textAnchor={rotulo.ancora}
            >
              {rotulo.texto}
            </text>
          ))}

          {indiceMira !== null && (
            <g className="ui-grafico__mira">
              <line
                className="ui-grafico__mira-linha"
                x1={arredondar(x(indiceMira))}
                x2={arredondar(x(indiceMira))}
                y1={MARGEM_TOPO}
                y2={base}
              />
              {ordemDeDesenho.map((serie) => {
                const valor = serie.valores[indiceMira];
                return valor === null || valor === undefined ? null : (
                  <circle
                    key={serie.rotulo}
                    className={`ui-grafico__marcador ui-grafico__marcador--${serie.estilo}`}
                    cx={arredondar(x(indiceMira))}
                    cy={arredondar(y(valor))}
                    r={RAIO_MARCADOR}
                  />
                );
              })}
            </g>
          )}
        </svg>

        {indiceMira !== null && dica && (
          <div
            className="ui-grafico__dica"
            style={{
              left: dica.esquerda,
              top: MARGEM_TOPO,
              width: dica.largura,
            }}
            aria-hidden="true"
          >
            <p className="ui-grafico__dica-titulo">{nomeDoPonto(indiceMira)}</p>
            <ul className="ui-grafico__dica-lista">
              {series.map((serie) => (
                <li key={serie.rotulo}>
                  <ChaveSerie estilo={serie.estilo} />
                  <strong>{valorOuTraco(serie.valores[indiceMira])}</strong>
                  <span>{serie.rotulo}</span>
                </li>
              ))}
              {extras.map((extra) => (
                <li key={extra.rotulo} className="ui-grafico__dica-extra">
                  <strong>{valorOuTraco(extra.valores[indiceMira])}</strong>
                  <span>{extra.rotulo}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p id={idInstrucoes} className="visualmente-oculto">
        Com o gráfico em foco, as setas percorrem os pontos; a tabela abaixo
        traz todos os valores.
      </p>
      <p className="visualmente-oculto" aria-live="polite">
        {mira?.teclado && indiceMira !== null ? textoDoPonto(indiceMira) : ""}
      </p>

      <details className="ui-grafico__dados">
        <ComDica texto={dicaDados}>
          <summary>Ver os dados em tabela</summary>
        </ComDica>
        <div
          className="ui-grafico__rolagem"
          role="region"
          aria-label={`Tabela: ${titulo}`}
          tabIndex={0}
        >
          <table className="ui-grafico__tabela">
            <caption className="visualmente-oculto">{titulo}</caption>
            <thead>
              <tr>
                <th scope="col">{tituloColunaX}</th>
                {[...series, ...extras].map((coluna) => (
                  <th key={coluna.rotulo} scope="col">
                    {coluna.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rotulosPonto.map((rotulo, indice) => (
                <tr
                  key={indice}
                  aria-current={indice === indiceAtual ? "true" : undefined}
                >
                  <th scope="row">
                    {rotulo}
                    {indice === indiceAtual && (
                      <span className="ui-grafico__atual">
                        {" "}
                        ({rotuloAtual})
                      </span>
                    )}
                  </th>
                  {[...series, ...extras].map((coluna) => (
                    <td key={coluna.rotulo}>
                      {coluna.valores[indice] === null ? (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="visualmente-oculto">sem dado</span>
                        </>
                      ) : (
                        valorOuTraco(coluna.valores[indice])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
