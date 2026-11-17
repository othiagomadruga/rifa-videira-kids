import {
  NOMES_DIVISAO,
  ORDEM_DIVISOES,
} from "../../../shared/contracts/calculos";
import { Select } from "../../components/ui";
import { LOCALIDADE } from "../../lib/formatadores";
import { ajuda } from "../ajuda-sob-demanda";
import { ROTULO_DO_ESCOPO } from "./textos";
import type { EstadoCelulas } from "./useCelulasDoFiltro";
import {
  chaveDoEscopo,
  escopoDosParams,
  type CelulaDoFiltro,
  type Escopo,
} from "./visao-geral-api";

type Opcao = { id: number; nome: string };

export type GruposDoFiltro = {
  redes: Opcao[];
  discipuladores: Opcao[];
  celulas: Opcao[];
};

const colacao = new Intl.Collator(LOCALIDADE, {
  numeric: true,
  sensitivity: "base",
});
const porNome = (a: Opcao, b: Opcao) => colacao.compare(a.nome, b.nome);

/** Redes, discipuladores e células das células cadastradas, cada grupo em ordem de nome ("Célula 2" antes de "Célula 10"). */
export function gruposDoFiltro(
  celulas: readonly CelulaDoFiltro[],
): GruposDoFiltro {
  const redes = new Map<number, string>();
  const discipuladores = new Map<number, string>();
  for (const celula of celulas) {
    redes.set(celula.rede_id, celula.rede_nome);
    discipuladores.set(celula.discipulador_id, celula.discipulador_nome);
  }
  const lista = (mapa: Map<number, string>) =>
    [...mapa].map(([id, nome]) => ({ id, nome })).sort(porNome);
  return {
    redes: lista(redes),
    discipuladores: lista(discipuladores),
    celulas: celulas.map(({ id, nome }) => ({ id, nome })).sort(porNome),
  };
}

/** Os grupos de opções com id, na ordem do campo. */
const GRUPO_DO_TIPO = {
  rede: "redes",
  discipulador: "discipuladores",
  celula: "celulas",
} as const;
const TIPOS_COM_ID = ["rede", "discipulador", "celula"] as const;

type Props = {
  escopo: Escopo;
  celulas: EstadoCelulas;
  /** Nome do recorte atual dado pela API (para mostrá-lo antes de a lista de células chegar). */
  nomeAtual: string | null;
  aoMudar: (escopo: Escopo) => void;
};

// Filtro do painel: um só campo, com a campanha toda, as divisões, as redes, os discipuladores e as
// células em grupos. O valor de cada opção é a própria consulta (a mesma da URL da tela).
export function FiltroEscopo({ escopo, celulas, nomeAtual, aoMudar }: Props) {
  const grupos =
    celulas.tipo === "ok"
      ? gruposDoFiltro(celulas.celulas)
      : { redes: [], discipuladores: [], celulas: [] };
  const valor = chaveDoEscopo(escopo);
  // O recorte da URL ainda não está na lista (ela não chegou, falhou ou não tem mais esse item):
  // uma opção só para ele, para o campo mostrar o que está na tela.
  const opcaoAvulsa =
    "id" in escopo &&
    !grupos[GRUPO_DO_TIPO[escopo.tipo]].some((opcao) => opcao.id === escopo.id)
      ? (nomeAtual ?? `${ROTULO_DO_ESCOPO[escopo.tipo]} ${escopo.id}`)
      : null;

  return (
    <div className="visao-filtro">
      <Select
        rotulo="Filtrar por"
        ajuda={ajuda("filtro")}
        value={valor}
        onChange={(evento) =>
          aoMudar(escopoDosParams(new URLSearchParams(evento.target.value)))
        }
        dica={
          celulas.tipo === "erro"
            ? "Não foi possível carregar as redes e as células. Toque em Atualizar para tentar de novo."
            : undefined
        }
      >
        <option value="">{ROTULO_DO_ESCOPO.campanha}</option>
        <optgroup label="Divisão">
          {ORDEM_DIVISOES.map((divisao) => (
            <option
              key={divisao}
              value={chaveDoEscopo({ tipo: "divisao", divisao })}
            >
              {NOMES_DIVISAO[divisao]}
            </option>
          ))}
        </optgroup>
        {opcaoAvulsa !== null && <option value={valor}>{opcaoAvulsa}</option>}
        {TIPOS_COM_ID.map((tipo) =>
          grupos[GRUPO_DO_TIPO[tipo]].length > 0 ? (
            <optgroup key={tipo} label={ROTULO_DO_ESCOPO[tipo]}>
              {grupos[GRUPO_DO_TIPO[tipo]].map((opcao) => (
                <option
                  key={opcao.id}
                  value={chaveDoEscopo({ tipo, id: opcao.id })}
                >
                  {opcao.nome}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </Select>
    </div>
  );
}
