import { useId, useState, type FormEvent } from "react";
import { Button, ComDica, Input } from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { useRedes } from "../../lib/redes";
import type { CelulaAdesao } from "./adesao-api";
import { celulaCombina, ordenarParaEscolha } from "./formatos";
import { DICAS, DICAS_REDE_UNICA } from "./textos";
import { ajuda } from "../ajuda-sob-demanda";

/** Quantas células a lista mostra de uma vez (a busca encontra as outras). */
export const LIMITE_OPCOES = 8;

type Props = {
  celulas: CelulaAdesao[];
  /** Na troca, a célula atual do afiliado fica fora da lista. */
  celulaAtualId?: number;
  /** Nome do grupo de opções para leitores de tela, ex.: "Célula do afiliado 1043". */
  legenda: string;
  /** Texto do botão de confirmar com a célula escolhida, ex.: "Vincular à Célula Ágape". */
  textoConfirmar: (celula: CelulaAdesao) => string;
  /** Salva a escolha. Se falhar (lançar), o erro aparece aqui e o formulário continua aberto. */
  aoConfirmar: (celula: CelulaAdesao) => Promise<void>;
  aoCancelar: () => void;
};

// Escolha da célula com busca (nome da célula, líder, discipulador ou rede). As células ainda sem
// afiliado vêm primeiro: é o caso comum na reunião de cadastro dos líderes.
export function EscolherCelula({
  celulas,
  celulaAtualId,
  legenda,
  textoConfirmar,
  aoConfirmar,
  aoCancelar,
}: Props) {
  const [busca, setBusca] = useState("");
  const [escolhidaId, setEscolhidaId] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const grupo = useId();
  const redeUnica = useRedes().unica;

  const opcoes = ordenarParaEscolha(
    celulas.filter((celula) => celula.celula_id !== celulaAtualId),
  );
  const encontradas = opcoes.filter((celula) => celulaCombina(celula, busca));
  const visiveis = encontradas.slice(0, LIMITE_OPCOES);
  const escolhida =
    opcoes.find((celula) => celula.celula_id === escolhidaId) ?? null;

  async function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    // Gravando, o botão fica com aria-disabled (RIFA-045: continua no Tab, com a dica dizendo por quê) e o envio é
    // barrado aqui: o clique, o Enter e o espaço nele e o Enter no campo de busca chegam como envio do formulário.
    if (enviando) return;
    if (!escolhida) {
      setErro("Escolha a célula na lista.");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await aoConfirmar(escolhida);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      setEnviando(false);
    }
  }

  return (
    <form className="adesao-escolha" onSubmit={confirmar} noValidate>
      <Input
        ajuda={
          redeUnica
            ? DICAS_REDE_UNICA.buscarNaEscolha
            : ajuda("buscarNaEscolha")
        }
        rotulo="Buscar célula ou líder"
        type="search"
        autoComplete="off"
        value={busca}
        onChange={(evento) => setBusca(evento.target.value)}
        autoFocus
      />

      <fieldset className="adesao-escolha__opcoes">
        <legend className="visualmente-oculto">{legenda}</legend>
        {visiveis.map((celula) => {
          // A dica fica na linha toda (rádio e textos); o rádio a tem no fim da descrição (`id` da dica).
          const idDica = `${grupo}-${celula.celula_id}-dica`;
          return (
            <ComDica
              key={celula.celula_id}
              id={idDica}
              texto={DICAS.opcaoCelula}
            >
              <label className="adesao-opcao">
                <input
                  type="radio"
                  name={grupo}
                  value={celula.celula_id}
                  checked={celula.celula_id === escolhidaId}
                  aria-describedby={idDica}
                  onChange={() => {
                    setEscolhidaId(celula.celula_id);
                    setErro(null);
                  }}
                />
                <span className="adesao-opcao__textos">
                  <span className="adesao-opcao__nome">
                    {celula.celula_nome}
                  </span>
                  <span className="adesao-opcao__detalhe">
                    Líder: {celula.lider_nome} ·{" "}
                    {celula.afiliados.length > 0
                      ? `já tem o afiliado ${celula.afiliados.join(", ")}`
                      : "sem afiliado"}
                  </span>
                </span>
              </label>
            </ComDica>
          );
        })}
      </fieldset>
      <p className="adesao-escolha__contagem">
        {encontradas.length === 0
          ? "Nenhuma célula encontrada com essa busca."
          : encontradas.length > visiveis.length
            ? `Mostrando ${visiveis.length} de ${encontradas.length} células. Digite para encontrar as outras.`
            : null}
      </p>
      {erro && (
        <p className="adesao-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="adesao-acoes">
        <ComDica
          texto={
            enviando
              ? DICAS.salvandoEscolha
              : escolhida
                ? DICAS.confirmarEscolha
                : DICAS.confirmarSemEscolha
          }
        >
          <Button type="submit" aria-disabled={enviando || undefined}>
            {enviando
              ? "Salvando…"
              : escolhida
                ? textoConfirmar(escolhida)
                : "Confirmar"}
          </Button>
        </ComDica>
        <ComDica
          texto={enviando ? DICAS.salvandoEscolha : DICAS.cancelarEscolha}
        >
          <Button
            variante="secundario"
            aria-disabled={enviando || undefined}
            onClick={() => {
              if (!enviando) aoCancelar();
            }}
          >
            Cancelar
          </Button>
        </ComDica>
      </div>
    </form>
  );
}
