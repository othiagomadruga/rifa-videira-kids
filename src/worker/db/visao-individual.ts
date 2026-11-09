/**
 * Leitura da visão individual (RIFA-014; GET /api/minha/visao): os dados de BASE, iguais para todos os usuários,
 * que o montador (lib/visao-individual.ts) usa. Nenhuma regra de cálculo mora aqui.
 *
 * - A leitura do painel (db/painel.ts, D10: a campanha e um lote com as células e as vendas por célula e dia
 *   local), com três comandos a mais NO MESMO lote: os discipuladores (a equipe da rede lista também os sem
 *   células), as redes e, por célula, o líder e quantos afiliados estão vinculados. Por requisição, as mesmas
 *   duas idas ao banco do painel (além da sessão).
 * - Cache por isolate de até 30 s (TTL_BASE_DA_VISAO_MS), como as rotas abertas (D10): a visão de cada pessoa é
 *   atualizada a cada minuto no celular, e sem o cache cada uma leria do D1 todos os pedidos da campanha. Só os
 *   dados de base ficam guardados, NUNCA a resposta, que é por pessoa. A base guardada só serve se tiver o alvo
 *   de quem pede (um alvo criado depois dela faz uma leitura nova, que também renova o cache).
 */
import type { Alvo, Divisao, EntradaCalculo } from "../../shared/contracts";
import type { DadosDaVisao } from "../lib/visao-individual";
import { lerEntradaDoCalculo, type FalhaLeitura } from "./painel";

/** Prazo da base guardada na memória do isolate (o mesmo das rotas abertas). */
export const TTL_BASE_DA_VISAO_MS = 30_000;

export interface BaseDaVisao extends DadosDaVisao {
  entrada: EntradaCalculo;
  redes: readonly { id: number; nome: string; divisao: Divisao }[];
}

export interface CacheDaBase {
  /** A base guardada, se ainda estiver no prazo em `agora`; senão, null. */
  ler(agora: Date): BaseDaVisao | null;
  gravar(base: BaseDaVisao, agora: Date): void;
}

/** Guarda a última base lida, por `ttlMs`, na memória do isolate. */
export function criarCacheDaBase(
  ttlMs: number = TTL_BASE_DA_VISAO_MS,
): CacheDaBase {
  let guardada: { em: number; base: BaseDaVisao } | null = null;
  return {
    ler(agora) {
      if (guardada === null) return null;
      const idade = agora.getTime() - guardada.em;
      return idade >= 0 && idade < ttlMs ? guardada.base : null;
    },
    gravar(base, agora) {
      guardada = { em: agora.getTime(), base };
    },
  };
}

/** Sem cache: toda requisição lê o banco (testes que mudam o banco entre chamadas). */
export const SEM_CACHE_DA_BASE: CacheDaBase = {
  ler: () => null,
  gravar: () => {},
};

/** Os comandos a mais, no lote da leitura do painel (ordem fixa: discipuladores, redes, células). */
const comandosDaVisao = (db: D1Database) => [
  db.prepare("SELECT id, nome, rede_id FROM discipuladores ORDER BY id"),
  db.prepare("SELECT id, nome, divisao FROM redes ORDER BY id"),
  db.prepare(
    `SELECT c.id, c.lider_nome,
       (SELECT count(*) FROM afiliados AS a WHERE a.celula_id = c.id) AS afiliados_vinculados
     FROM celulas AS c ORDER BY c.id`,
  ),
];

/** A base tem o alvo? (Na base guardada, um alvo criado depois dela não está.) */
function temOAlvo(base: BaseDaVisao, alvo: Alvo): boolean {
  switch (alvo.tipo) {
    case "celula":
      return base.celulas.has(alvo.id);
    case "discipulador":
      return base.discipuladores.some((item) => item.id === alvo.id);
    case "rede":
      return base.redes.some((item) => item.id === alvo.id);
  }
}

/**
 * A base da visão, do cache (no prazo e com o alvo) ou do banco (e guarda). Sem campanha ativa: 404
 * `nao_encontrado`, como o painel (nada é guardado).
 */
export async function lerBaseDaVisao(
  db: D1Database,
  agora: Date,
  alvo: Alvo,
  cache: CacheDaBase,
): Promise<{ ok: true; base: BaseDaVisao } | FalhaLeitura> {
  const guardada = cache.ler(agora);
  if (guardada !== null && temOAlvo(guardada, alvo))
    return { ok: true, base: guardada };

  const lido = await lerEntradaDoCalculo(db, () => agora, {}, comandosDaVisao);
  if (!lido.ok) return lido;
  const [discipuladores, redes, celulas] = lido.extras;
  const base: BaseDaVisao = {
    entrada: lido.entrada,
    discipuladores: discipuladores.results as BaseDaVisao["discipuladores"],
    redes: redes.results as BaseDaVisao["redes"],
    celulas: new Map(
      (
        celulas.results as {
          id: number;
          lider_nome: string;
          afiliados_vinculados: number;
        }[]
      ).map(({ id, ...dados }) => [id, dados]),
    ),
  };
  cache.gravar(base, agora);
  return { ok: true, base };
}
