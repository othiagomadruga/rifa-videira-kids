import {
  NOMES_DIVISAO,
  ORDEM_DIVISOES,
} from "../../../shared/contracts/calculos";
import { Select } from "../../components/ui";
import { LOCALIDADE } from "../../lib/formatadores";
import { ajuda } from "../ajuda-sob-demanda";
import { useRedes } from "../../lib/redes";
import { ROTULO_DO_ESCOPO, TEXTOS_REDE_UNICA } from "./textos";
import type { EstadoCelulas } from "./useCelulasDoFiltro";
import {
  chaveDoEscopo,
  escopoDosParams,
  type CelulaDoFiltro,
  type Escopo,
  type GrupoDoFiltro,
} from "./visao-geral-api";

type Opcao = { id: number; nome: string };

export type GruposDoFiltro = {
  /** RIFA-092: os grupos (adultos da manhã, adultos da noite...) que têm células, na ordem da lista dos grupos. */
  grupos: Opcao[];
  redes: Opcao[];
  discipuladores: Opcao[];
  celulas: Opcao[];
  /** Quantas divisões as células têm: com uma só (ou nenhuma), a seção Divisão sai do filtro (RIFA-092). */
  divisoes: number;
};

const colacao = new Intl.Collator(LOCALIDADE, {
  numeric: true,
  sensitivity: "base",
});
const porNome = (a: Opcao, b: Opcao) => colacao.compare(a.nome, b.nome);

/**
 * Grupos, redes, discipuladores e células das células cadastradas. Redes, discipuladores e células em ordem de nome
 * ("Célula 2" antes de "Célula 10"); os grupos (o efetivo de cada célula, RIFA-092) na ordem de `ordemDosGrupos` (a de
 * GET /api/admin/grupos: Adultos da manhã, Adultos da noite, Jovens, Adolescentes); sem ela, ou um grupo fora dela,
 * pelo nome, depois.
 */
export function gruposDoFiltro(
  celulas: readonly CelulaDoFiltro[],
  ordemDosGrupos: readonly GrupoDoFiltro[] | null = null,
): GruposDoFiltro {
  const grupos = new Map<number, string>();
  const redes = new Map<number, string>();
  const discipuladores = new Map<number, string>();
  const divisoes = new Set<string>();
  for (const celula of celulas) {
    const { grupo_efetivo_id: grupo, grupo_efetivo_nome: nomeDoGrupo } = celula;
    if (typeof grupo === "number")
      grupos.set(grupo, nomeDoGrupo ?? `Grupo ${grupo}`);
    redes.set(celula.rede_id, celula.rede_nome);
    discipuladores.set(celula.discipulador_id, celula.discipulador_nome);
    divisoes.add(celula.divisao);
  }
  const lista = (mapa: Map<number, string>) =>
    [...mapa].map(([id, nome]) => ({ id, nome })).sort(porNome);
  const posicao = new Map(
    (ordemDosGrupos ?? []).map((grupo, indice) => [grupo.id, indice]),
  );
  const naOrdem = (opcao: Opcao) =>
    posicao.get(opcao.id) ?? Number.MAX_SAFE_INTEGER;
  return {
    grupos: lista(grupos).sort((a, b) => naOrdem(a) - naOrdem(b)),
    redes: lista(redes),
    discipuladores: lista(discipuladores),
    celulas: celulas.map(({ id, nome }) => ({ id, nome })).sort(porNome),
    divisoes: divisoes.size,
  };
}

/** Os grupos de opções com id, na ordem do campo. */
const GRUPO_DO_TIPO = {
  grupo: "grupos",
  rede: "redes",
  discipulador: "discipuladores",
  celula: "celulas",
} as const;
const TIPOS_COM_ID = ["grupo", "rede", "discipulador", "celula"] as const;

const NENHUM: GruposDoFiltro = {
  grupos: [],
  redes: [],
  discipuladores: [],
  celulas: [],
  divisoes: 0,
};

type Props = {
  escopo: Escopo;
  celulas: EstadoCelulas;
  /** Nome do recorte atual dado pela API (para mostrá-lo antes de a lista de células chegar). */
  nomeAtual: string | null;
  aoMudar: (escopo: Escopo) => void;
};

// Filtro do painel: um só campo, com a campanha toda, os grupos (RIFA-092), as divisões, as redes, os discipuladores e
// as células em seções. O valor de cada opção é a própria consulta (a mesma da URL da tela). Com uma rede só (RIFA-065,
// D30), sem a seção das redes. Com as células todas numa divisão só (o caso de uma rede só), sem a seção Divisão:
// escolher a divisão daria a campanha toda ou nada (RIFA-092). Antes de a lista chegar (ou se ela falhar), a Divisão
// fica, como antes; e fica sempre que o recorte da tela é uma divisão (o campo mostra o que está na tela).
export function FiltroEscopo({ escopo, celulas, nomeAtual, aoMudar }: Props) {
  const redeUnica = useRedes().unica;
  const todos =
    celulas.tipo === "ok"
      ? gruposDoFiltro(celulas.celulas, celulas.grupos)
      : NENHUM;
  const grupos = redeUnica ? { ...todos, redes: [] } : todos;
  const mostrarDivisao =
    celulas.tipo !== "ok" || todos.divisoes > 1 || escopo.tipo === "divisao";
  const valor = chaveDoEscopo(escopo);
  // O recorte da URL ainda não está na lista (ela não chegou, falhou ou não tem mais esse item):
  // uma opção só para ele, para o campo mostrar o que está na tela.
  const opcaoAvulsa =
    "id" in escopo &&
    !grupos[GRUPO_DO_TIPO[escopo.tipo]].some((opcao) => opcao.id === escopo.id)
      ? (nomeAtual ?? `${ROTULO_DO_ESCOPO[escopo.tipo]} ${escopo.id}`)
      : null;

  // Uma seção com id (grupo, rede, discipulador ou célula), só se tiver opções.
  const secao = (tipo: (typeof TIPOS_COM_ID)[number]) =>
    grupos[GRUPO_DO_TIPO[tipo]].length > 0 ? (
      <optgroup key={tipo} label={ROTULO_DO_ESCOPO[tipo]}>
        {grupos[GRUPO_DO_TIPO[tipo]].map((opcao) => (
          <option key={opcao.id} value={chaveDoEscopo({ tipo, id: opcao.id })}>
            {opcao.nome}
          </option>
        ))}
      </optgroup>
    ) : null;

  return (
    <div className="visao-filtro">
      <Select
        ajuda={redeUnica ? TEXTOS_REDE_UNICA.filtro : ajuda("filtro")}
        rotulo="Filtrar por"
        value={valor}
        onChange={(evento) =>
          aoMudar(escopoDosParams(new URLSearchParams(evento.target.value)))
        }
        dica={
          celulas.tipo !== "erro"
            ? undefined
            : redeUnica
              ? TEXTOS_REDE_UNICA.falhaDoFiltro
              : "Não foi possível carregar as redes e as células. Toque em Atualizar para tentar de novo."
        }
      >
        <option value="">{ROTULO_DO_ESCOPO.campanha}</option>
        {secao("grupo")}
        {mostrarDivisao && (
          <optgroup label={ROTULO_DO_ESCOPO.divisao}>
            {ORDEM_DIVISOES.map((divisao) => (
              <option
                key={divisao}
                value={chaveDoEscopo({ tipo: "divisao", divisao })}
              >
                {NOMES_DIVISAO[divisao]}
              </option>
            ))}
          </optgroup>
        )}
        {opcaoAvulsa !== null && <option value={valor}>{opcaoAvulsa}</option>}
        {TIPOS_COM_ID.filter((tipo) => tipo !== "grupo").map(secao)}
      </Select>
    </div>
  );
}
