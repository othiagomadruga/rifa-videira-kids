import { useEffect, useRef, useState, type MouseEvent } from "react";
import { bitLigado } from "../../../shared/contracts/bilhetes";
import { formatarNumero } from "../../lib/formatadores";
import { escalaDoCanvas, indiceNoPonto, medirGrade, type Grade } from "./grade";
import type { FiltroGrade } from "./textos";

type Props = {
  grade: Grade;
  filtro: FiltroGrade;
  /** O número escolhido (contornado na grade). */
  selecionado: number | null;
  aoEscolher: (numero: number) => void;
  /** Texto para leitores de tela (o resumo da grade). */
  descricao: string;
};

const LARGURA_PADRAO = 320;

/** A cor de uma variável CSS do contêiner (o canvas não lê var()). */
function cor(elemento: Element, nome: string, reserva: string): string {
  return getComputedStyle(elemento).getPropertyValue(nome).trim() || reserva;
}

/**
 * A grade de todos os números num canvas (RIFA-075, D35): um quadrado por número, da esquerda para a direita e de cima
 * para baixo, começando no número inicial. Três passadas (uma por cor), sem nó do DOM por número: 7.005 números saem
 * em poucos milissegundos, e 100.000 também. A largura acompanha o contêiner (sem rolagem lateral em 390 px).
 */
export function GradeBilhetes({
  grade,
  filtro,
  selecionado,
  aoEscolher,
  descricao,
}: Props) {
  const contem = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [largura, setLargura] = useState(LARGURA_PADRAO);

  useEffect(() => {
    const elemento = contem.current;
    if (!elemento) return;
    const medir = () => setLargura(elemento.clientWidth || LARGURA_PADRAO);
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);

  const medidas = medirGrade(largura, grade.quantidade);

  useEffect(() => {
    const elemento = canvas.current;
    const contexto = elemento?.getContext?.("2d");
    if (!elemento || !contexto || !contem.current) return;
    const { lado, colunas, linhas } = medidas;
    const escala = escalaDoCanvas(
      window.devicePixelRatio || 1,
      colunas * lado,
      linhas * lado,
    );
    elemento.width = Math.floor(colunas * lado * escala);
    elemento.height = Math.floor(linhas * lado * escala);
    contexto.setTransform(escala, 0, 0, escala, 0, 0);
    contexto.clearRect(0, 0, colunas * lado, linhas * lado);

    const cores = {
      pago: cor(contem.current, "--bilhete-pago", "#17633a"),
      reservado: cor(contem.current, "--bilhete-reservado", "#d18b00"),
      livre: cor(contem.current, "--bilhete-livre", "#dcdfeb"),
      apagado: cor(contem.current, "--bilhete-apagado", "#f1f2f6"),
      selecao: cor(contem.current, "--bilhete-selecao", "#5e297c"),
    };
    const situacoes = ["livre", "reservado", "pago"] as const;
    for (const situacao of situacoes) {
      contexto.fillStyle =
        filtro === "todos" || filtro === situacao
          ? cores[situacao]
          : cores.apagado;
      for (let i = 0; i < grade.quantidade; i += 1) {
        const pago = bitLigado(grade.pagos, i);
        const reservado = !pago && bitLigado(grade.reservados, i);
        const atual = pago ? "pago" : reservado ? "reservado" : "livre";
        if (atual !== situacao) continue;
        contexto.fillRect(
          (i % colunas) * lado,
          Math.floor(i / colunas) * lado,
          lado - 1,
          lado - 1,
        );
      }
    }
    if (selecionado !== null) {
      const i = selecionado - grade.inicial;
      if (i >= 0 && i < grade.quantidade) {
        contexto.strokeStyle = cores.selecao;
        contexto.lineWidth = 2;
        contexto.strokeRect(
          (i % colunas) * lado - 1,
          Math.floor(i / colunas) * lado - 1,
          lado + 1,
          lado + 1,
        );
      }
    }
  }, [grade, filtro, selecionado, medidas]);

  function aoClicar(evento: MouseEvent<HTMLCanvasElement>) {
    const caixa = evento.currentTarget.getBoundingClientRect();
    const indice = indiceNoPonto(
      medidas,
      grade.quantidade,
      evento.clientX - caixa.left,
      evento.clientY - caixa.top,
    );
    if (indice !== null) aoEscolher(grade.inicial + indice);
  }

  const ultimo = grade.inicial + grade.quantidade - 1;
  return (
    <div className="bilhetes-grade" ref={contem}>
      <p className="bilhetes-grade__nota">
        Cada quadrado é um número, do {formatarNumero(grade.inicial)} ao{" "}
        {formatarNumero(ultimo)}, da esquerda para a direita; cada linha tem{" "}
        {medidas.colunas} números. Toque num quadrado para ver o pedido.
      </p>
      <canvas
        ref={canvas}
        className="bilhetes-grade__canvas"
        role="img"
        aria-label={descricao}
        style={{
          width: `${medidas.colunas * medidas.lado}px`,
          height: `${medidas.linhas * medidas.lado}px`,
        }}
        onClick={aoClicar}
      />
    </div>
  );
}
