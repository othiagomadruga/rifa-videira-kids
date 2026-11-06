import { useId, useState, type FormEvent } from "react";
import { Button, Input } from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import type { CelulaAdesao } from "./adesao-api";
import { celulaCombina, ordenarParaEscolha } from "./formatos";

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

  const opcoes = ordenarParaEscolha(
    celulas.filter((celula) => celula.celula_id !== celulaAtualId),
  );
  const encontradas = opcoes.filter((celula) => celulaCombina(celula, busca));
  const visiveis = encontradas.slice(0, LIMITE_OPCOES);
  const escolhida =
    opcoes.find((celula) => celula.celula_id === escolhidaId) ?? null;

  async function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
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
        rotulo="Buscar célula ou líder"
        type="search"
        autoComplete="off"
        value={busca}
        onChange={(evento) => setBusca(evento.target.value)}
        autoFocus
      />
      <fieldset className="adesao-escolha__opcoes">
        <legend className="visualmente-oculto">{legenda}</legend>
        {visiveis.map((celula) => (
          <label key={celula.celula_id} className="adesao-opcao">
            <input
              type="radio"
              name={grupo}
              value={celula.celula_id}
              checked={celula.celula_id === escolhidaId}
              onChange={() => {
                setEscolhidaId(celula.celula_id);
                setErro(null);
              }}
            />
            <span className="adesao-opcao__textos">
              <span className="adesao-opcao__nome">{celula.celula_nome}</span>
              <span className="adesao-opcao__detalhe">
                Líder: {celula.lider_nome} ·{" "}
                {celula.afiliados.length > 0
                  ? `já tem o afiliado ${celula.afiliados.join(", ")}`
                  : "sem afiliado"}
              </span>
            </span>
          </label>
        ))}
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
        <Button type="submit" disabled={enviando}>
          {enviando
            ? "Salvando…"
            : escolhida
              ? textoConfirmar(escolhida)
              : "Confirmar"}
        </Button>
        <Button variante="secundario" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
