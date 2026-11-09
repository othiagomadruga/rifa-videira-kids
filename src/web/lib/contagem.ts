// Números contando até o valor (count-up), RIFA-020. Sem movimento (prefers-reduced-motion ou sem
// matchMedia), o valor final aparece na hora, no primeiro render.
import { useEffect, useState } from "react";
import { DURACAO_CONTAGEM_MS, usePrefereMenosMovimento } from "./movimento";

/** Um número escrito em pt-BR dentro de um texto ("R$ 1.234,56", "35%", "1.234 células"). */
export type NumeroNoTexto = {
  valor: number;
  /** Escreve outro valor no mesmo formato: prefixo, casas decimais, separador de milhar e sufixo. */
  escrever: (valor: number) => string;
};

// Prefixo sem dígitos, o número (com ou sem pontos de milhar), a vírgula decimal opcional e um sufixo sem
// dígitos. Texto com dois números ("12 de 24"), hora ("19:30") ou data ("03/12") não casa: fica parado.
const NUMERO_PT_BR = /^(\D*?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(\D*)$/;

/** O número de um texto formatado pelos formatadores do site, ou null se o texto não for só um número. */
export function lerNumero(texto: string): NumeroNoTexto | null {
  const achado = NUMERO_PT_BR.exec(texto);
  if (!achado) return null;
  const [, prefixo, inteiro, decimais = "", sufixo] = achado;
  const valor = Number(`${inteiro.replaceAll(".", "")}.${decimais || "0"}`);
  const formato = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimais.length,
    maximumFractionDigits: decimais.length,
    useGrouping: inteiro.includes("."),
  });
  return {
    valor,
    escrever: (outro) => `${prefixo}${formato.format(outro)}${sufixo}`,
  };
}

type Animacao = { de: number; para: number; progresso: number };

/** Desacelera no fim (ease-out cúbica). */
const suavizar = (t: number) => 1 - (1 - t) ** 3;

const valorEm = ({ de, para, progresso }: Animacao) =>
  de + (para - de) * suavizar(progresso);

export type Contagem = {
  /** O valor a mostrar agora (o alvo, quando parado). */
  valor: number;
  /** Ainda contando: o valor mostrado não é o final. */
  animando: boolean;
};

type OpcoesContagem = {
  duracaoMs?: number;
  /** Não anima (ex.: o texto não é um número). */
  desligada?: boolean;
};

/**
 * Conta até `alvo`: na primeira vez, de 0; depois, do valor que está na tela até o novo alvo. Usa
 * requestAnimationFrame e termina exatamente no alvo. Com movimento reduzido, devolve o alvo na hora.
 */
export function useContagem(
  alvo: number,
  { duracaoMs = DURACAO_CONTAGEM_MS, desligada = false }: OpcoesContagem = {},
): Contagem {
  const parada = usePrefereMenosMovimento() || desligada;
  const [animacao, setAnimacao] = useState<Animacao | null>(() =>
    parada || alvo === 0 ? null : { de: 0, para: alvo, progresso: 0 },
  );
  const [alvoVisto, setAlvoVisto] = useState(alvo);

  // Estado derivado do alvo (padrão do React para "informação do render anterior"): quando o alvo muda, a
  // contagem recomeça do valor que está na tela.
  if (alvo !== alvoVisto) {
    setAlvoVisto(alvo);
    const naTela = animacao ? valorEm(animacao) : alvoVisto;
    setAnimacao(parada ? null : { de: naTela, para: alvo, progresso: 0 });
  } else if (parada && animacao !== null) {
    setAnimacao(null);
  }

  const de = animacao?.de;
  const para = animacao?.para;
  useEffect(() => {
    if (de === undefined || para === undefined) return;
    let quadro = 0;
    let inicio: number | undefined;
    const passo = (agora: number) => {
      inicio ??= agora;
      const progresso = Math.min(1, (agora - inicio) / duracaoMs);
      setAnimacao(progresso >= 1 ? null : { de, para, progresso });
      if (progresso < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [de, para, duracaoMs]);

  return animacao
    ? { valor: valorEm(animacao), animando: true }
    : { valor: alvo, animando: false };
}
