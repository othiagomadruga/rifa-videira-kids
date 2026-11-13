// Comemoração da meta batida (RIFA-049, D25): o pulso de sempre (usePulsoDaMeta) e, uma vez, 12 partículas no amarelo
// do Kids e nas cores da marca que saem do elemento e somem. Regras (docs/frontend.md, "Movimento"):
// - cada partícula anima só transform e opacity, pela Web Animations API (animar, que não faz nada com reduce nem
//   sem matchMedia), com até 450 ms e atraso de até 300 ms; com reduce, nenhuma partícula entra no DOM;
// - as partículas são <span> criados pelo React, numa camada `position: absolute; inset: 0; pointer-events: none`
//   (Comemoracao.css), e saem do DOM no fim. Quem usa põe `confete` dentro do elemento do `ref` (com position:
//   relative, ou a classe CLASSE_COMEMORA) e `overflow: clip` no item em volta (nada de rolagem lateral);
// - "ao-bater": só quando a meta passa a estar batida depois de aparecer (o telão e o ranking: abrir a página com a
//   meta já batida só pulsa); "ao-aparecer-e-ao-bater": também ao aparecer já batida (a /minha);
// - umaVezPor "dia": a data (no fuso da campanha) fica no sessionStorage com a `chave`; sem armazenamento, uma vez por
//   montagem.
import {
  createElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import "../components/movimento/Comemoracao.css";
import { FUSO_HORARIO } from "./formatadores";
import { CURVA_SAIDA, animar, prefereMenosMovimento } from "./movimento";
import { pulsarMeta } from "./usePulsoDaMeta";

export type QuandoComemorar = "ao-bater" | "ao-aparecer-e-ao-bater";

export type OpcoesComemoracao = {
  quando: QuandoComemorar;
  /** "dia": no máximo uma comemoração por dia nesta aba (recarregar a página não repete). Use com `chave`. */
  umaVezPor?: "dia";
  /** O nome desta comemoração no sessionStorage (com umaVezPor), ex.: "minha". Padrão: "meta". */
  chave?: string;
  /** O pulso do elemento (como o usePulsoDaMeta). Padrão: true. */
  pulso?: boolean;
};

/** A classe que dá position: relative ao elemento que comemora (a camada das partículas se ancora nele). */
export const CLASSE_COMEMORA = "mov-comemora";
/** Duração de cada partícula (no máximo 450 ms, a regra do movimento). */
export const DURACAO_PARTICULA_MAXIMA_MS = 440;
/** O atraso da última partícula a sair (no máximo 300 ms). */
export const ATRASO_PARTICULA_MAXIMO_MS = 264;
/** Quando as partículas saem do DOM: a última termina. */
export const DURACAO_COMEMORACAO_MS =
  ATRASO_PARTICULA_MAXIMO_MS + DURACAO_PARTICULA_MAXIMA_MS;
/** Prefixo da chave no sessionStorage. */
export const PREFIXO_ARMAZENAMENTO = "rifa-comemoracao:";

type CorParticula = "amarelo" | "verde-agua" | "azul" | "roxo";

type Particula = {
  cor: CorParticula;
  forma: "quadrado" | "circulo";
  /** Para onde vai, em px (multiplicado pela escala do texto do elemento), e quanto gira. */
  dx: number;
  dy: number;
  giro: number;
  duracao: number;
  atraso: number;
};

// O amarelo do Kids aparece mais (é a cor da comemoração); as cores da marca completam.
const CORES: CorParticula[] = [
  "amarelo",
  "verde-agua",
  "amarelo",
  "azul",
  "amarelo",
  "roxo",
];
const QUANTAS = 12;

/** As 12 partículas, fixas (o mesmo desenho sempre): em volta do elemento, cada uma com distância e giro próprios. */
export const PARTICULAS: readonly Particula[] = Array.from(
  { length: QUANTAS },
  (_, i) => {
    const angulo =
      ((i * 360) / QUANTAS + (i % 2 === 0 ? -9 : 11)) * (Math.PI / 180);
    const distancia = 30 + ((i * 5) % 4) * 8;
    return {
      cor: CORES[i % CORES.length],
      forma: i % 3 === 0 ? "circulo" : "quadrado",
      dx: Math.round(Math.cos(angulo) * distancia),
      // Um pouco mais para cima: o confete sobe e cai.
      dy: Math.round(Math.sin(angulo) * distancia * 0.8 - 6),
      giro: (i % 2 === 0 ? 1 : -1) * (120 + i * 15),
      duracao: 380 + (i % 3) * 30,
      atraso: ((i * 7) % QUANTAS) * 24,
    };
  },
);

/** Quanto as partículas se afastam: acompanha o tamanho do texto (o % do telão é bem maior que o do celular). */
function escalaDoElemento(elemento: Element | null): number {
  if (!elemento) return 1;
  const tamanho = Number.parseFloat(getComputedStyle(elemento).fontSize);
  return Number.isFinite(tamanho)
    ? Math.min(2.5, Math.max(1, tamanho / 18))
    : 1;
}

function quadrosDa(particula: Particula, escala: number): Keyframe[] {
  const dx = particula.dx * escala;
  const dy = particula.dy * escala;
  return [
    { transform: "translate(0px, 0px) rotate(0deg) scale(0.4)", opacity: 0 },
    {
      transform: `translate(${dx * 0.35}px, ${dy * 0.35}px) rotate(${particula.giro * 0.3}deg) scale(1)`,
      opacity: 1,
      offset: 0.2,
    },
    {
      transform: `translate(${dx}px, ${dy}px) rotate(${particula.giro}deg) scale(0.7)`,
      opacity: 0,
    },
  ];
}

/** Hoje, no fuso da campanha (aaaa-mm-dd). */
function hoje(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_HORARIO }).format(
    new Date(),
  );
}

/** Marca a comemoração de hoje; false se ela já aconteceu hoje nesta aba. Sem armazenamento, deixa comemorar. */
function primeiraDeHoje(chave: string): boolean {
  try {
    const nome = `${PREFIXO_ARMAZENAMENTO}${chave}`;
    const dia = hoje();
    if (window.sessionStorage.getItem(nome) === dia) return false;
    window.sessionStorage.setItem(nome, dia);
    return true;
  } catch {
    return true;
  }
}

/**
 * Comemora a meta batida no elemento do `ref`: o pulso e, conforme `quando` e `umaVezPor`, as partículas. Devolve o
 * `ref` e o `confete` (a camada das partículas, ou null), que vai dentro do elemento:
 *
 *   const { ref, confete } = useComemoracao<HTMLSpanElement>(batida, { quando: "ao-bater" });
 *   <span ref={ref} className={`x__percentual ${CLASSE_COMEMORA}`}>{texto}{confete}</span>
 */
export function useComemoracao<T extends HTMLElement>(
  batida: boolean,
  { quando, umaVezPor, chave = "meta", pulso = true }: OpcoesComemoracao,
): { ref: RefObject<T | null>; confete: ReactNode } {
  const ref = useRef<T>(null);
  const camada = useRef<HTMLSpanElement>(null);
  // null: ainda não apareceu (a primeira passada decide o "ao aparecer").
  const anterior = useRef<boolean | null>(null);
  const comemorouNestaMontagem = useRef(false);
  const [rodada, setRodada] = useState<number | null>(null);

  useLayoutEffect(() => {
    const antes = anterior.current;
    anterior.current = batida;
    if (!batida || antes === true) return;
    if (pulso && ref.current) pulsarMeta(ref.current);
    if (antes === null && quando === "ao-bater") return;
    if (prefereMenosMovimento()) return;
    if (umaVezPor === "dia") {
      if (comemorouNestaMontagem.current || !primeiraDeHoje(chave)) return;
      comemorouNestaMontagem.current = true;
    }
    setRodada((atual) => (atual ?? 0) + 1);
  }, [batida, quando, umaVezPor, chave, pulso]);

  // As partículas entraram no DOM: anima cada uma e tira a camada quando a última termina.
  useLayoutEffect(() => {
    if (rodada === null) return;
    const escala = escalaDoElemento(ref.current);
    const animacoes = [...(camada.current?.children ?? [])].map(
      (elemento, indice) => {
        const particula = PARTICULAS[indice];
        return animar(elemento, quadrosDa(particula, escala), {
          duration: particula.duracao,
          delay: particula.atraso,
          easing: CURVA_SAIDA,
        });
      },
    );
    const temporizador = setTimeout(
      () => setRodada(null),
      animacoes.some(Boolean) ? DURACAO_COMEMORACAO_MS : 0,
    );
    return () => {
      clearTimeout(temporizador);
      for (const animacao of animacoes) animacao?.cancel();
    };
  }, [rodada]);

  const confete =
    rodada === null
      ? null
      : createElement(
          "span",
          {
            key: rodada,
            ref: camada,
            className: "mov-comemoracao",
            "aria-hidden": "true",
          },
          PARTICULAS.map((particula, indice) =>
            createElement("span", {
              key: indice,
              className: `mov-confete mov-confete--${particula.cor}`,
              "data-forma": particula.forma,
            }),
          ),
        );

  return { ref, confete };
}
