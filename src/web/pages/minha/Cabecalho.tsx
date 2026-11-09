import type { Alvo } from "../../../shared/contracts/dominio";
import { NOMES_DIVISAO } from "../../../shared/contracts/calculos";
import { PageHeader } from "../../components/ui";
import "./minha-moldura.css";

/** Tipo do alvo para mostrar ao lado do nome. */
const ROTULO_DO_ALVO: Record<Alvo["tipo"], string> = {
  celula: "Célula",
  discipulador: "Discipulador",
  rede: "Rede",
};

/** "Célula · Jovens". */
export function descricaoDoAlvo(alvo: Pick<Alvo, "tipo" | "divisao">): string {
  return `${ROTULO_DO_ALVO[alvo.tipo]} · ${NOMES_DIVISAO[alvo.divisao]}`;
}

// O cabeçalho da visão individual: o alvo (o <h1> e o título da aba), o tipo e a divisão dele e quem entrou.
// Fica no pacote principal (é o que aparece enquanto o resto da tela carrega).
export function Cabecalho({
  alvo,
  nome,
}: {
  alvo: Alvo | null;
  /** Quem entrou (o nome do usuário da sessão). */
  nome: string;
}) {
  return (
    <PageHeader
      titulo={alvo?.nome ?? "Sua visão da campanha"}
      descricao={
        <>
          {alvo && (
            <span className="minha-cabecalho__alvo">
              {descricaoDoAlvo(alvo)}
            </span>
          )}{" "}
          <span className="minha-cabecalho__pessoa">
            Você entrou como <strong>{nome}</strong>.
          </span>
        </>
      }
    />
  );
}
