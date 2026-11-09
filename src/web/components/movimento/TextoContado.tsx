import { useMemo } from "react";
import { lerNumero, useContagem } from "../../lib/contagem";
import "./TextoContado.css";

type Props = {
  /** O texto já formatado (ex.: "35%", "1.234", "R$ 1.234,56"). Sem um número só, fica parado. */
  texto: string;
};

// Número que conta até o valor quando aparece e quando muda (count-up). Parado, e sempre com movimento
// reduzido, é só o texto, sem elemento a mais. Contando, o texto final fica no lugar, transparente: reserva o
// espaço (nada muda de tamanho) e é o que o leitor de tela lê; o número que conta passa por cima, aria-hidden.
export function TextoContado({ texto }: Props) {
  const numero = useMemo(() => lerNumero(texto), [texto]);
  const { valor, animando } = useContagem(numero?.valor ?? 0, {
    desligada: numero === null,
  });
  if (!numero || !animando) return texto;
  return (
    <span className="mov-contagem">
      <span className="mov-contagem__final">{texto}</span>
      <span className="mov-contagem__quadro" aria-hidden="true">
        {numero.escrever(valor)}
      </span>
    </span>
  );
}
