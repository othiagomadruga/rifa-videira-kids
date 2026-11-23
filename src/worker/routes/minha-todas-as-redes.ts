/**
 * Ranking geral (RIFA-090, adendo da D12; docs/api.md): GET /api/minha/todas-as-redes?janela=atual|campanha, SÓ do
 * discipulador e da rede (o líder leva 403 `proibido`, antes de ler a consulta). Embaixo do que ele já vê na /minha,
 * todos os discipuladores e todas as células em ranking: posição, nome (e o discipulador da célula), % da meta e
 * bilhetes da janela, com `eu` nas linhas de quem pede. Nunca dinheiro, comprador, telefone ou id.
 *
 * O index.ts monta este sub-app sob /api/minha, DEPOIS do login da hierarquia (passo 4c), e ele exige o login de novo
 * só na rota dele, com os papéis do contrato (a sessão é lida uma vez por requisição). O alvo vem só da sessão; a
 * consulta só tem `janela` (o schema descarta o resto).
 *
 * A conta é a do ranking da coordenação, sem nenhum SQL novo: a leitura do painel (db/painel.ts, `lerEntradaDoCalculo`)
 * e `montarRankingPainel` (calculos.ts) duas vezes, discipuladores e células, sem filtro de divisão; o contrato
 * (`montarTodasAsRedes`) tira os valores e marca o `eu`. Os dois rankings são iguais para todo mundo, então ficam até
 * 30 s na memória do isolate, por janela (como a base da visão e as rotas abertas, D10 e D14): a seção se atualiza a
 * cada minuto em cada celular aberto, e sem isso cada atualização leria do D1 todos os pedidos da campanha. A resposta,
 * que é por pessoa (o `eu`), nunca fica em cache (`no-store`) e passa pelo schema estrito do contrato antes de sair (um
 * campo a mais vira 500). Sem campanha ativa: 404 (nada vai para o cache).
 */
import { Hono } from "hono";
import {
  ROTAS_TODAS_AS_REDES,
  montarRankingPainel,
  montarTodasAsRedes,
  type JanelaRanking,
  type RespostaRanking,
} from "../../shared/contracts";
import {
  lerEntradaDoCalculo,
  relogioDoSistema,
  type Relogio,
} from "../db/painel";
import { responderErro } from "../lib/respostas-erro";
import { exigirSessao, type AmbienteSessao } from "../middleware/sessao";
import { validarConsulta } from "../middleware/validacao";
import { PREFIXO_MINHA } from "./minha";

const ROTA = ROTAS_TODAS_AS_REDES.todasAsRedes;
/** O caminho da rota dentro do sub-app ("/todas-as-redes"). */
const LOCAL = ROTA.caminho.slice(PREFIXO_MINHA.length);

/** Prazo dos rankings guardados na memória do isolate (o mesmo da base da visão e das rotas abertas). */
export const TTL_TODAS_AS_REDES_MS = 30_000;

/** Os dois rankings da coordenação de uma janela (com valores: nunca saem como estão). */
export type RankingsDaJanela = {
  discipuladores: RespostaRanking;
  celulas: RespostaRanking;
};

export interface CacheDosRankings {
  /** Os rankings guardados da janela, se ainda estiverem no prazo em `agora`; senão, null. */
  ler(janela: JanelaRanking, agora: Date): RankingsDaJanela | null;
  gravar(janela: JanelaRanking, rankings: RankingsDaJanela, agora: Date): void;
}

/** Guarda os últimos rankings de cada janela, por `ttlMs`, na memória do isolate. */
export function criarCacheDosRankings(
  ttlMs: number = TTL_TODAS_AS_REDES_MS,
): CacheDosRankings {
  const guardados = new Map<
    JanelaRanking,
    { em: number; rankings: RankingsDaJanela }
  >();
  return {
    ler(janela, agora) {
      const guardado = guardados.get(janela);
      if (guardado === undefined) return null;
      const idade = agora.getTime() - guardado.em;
      return idade >= 0 && idade < ttlMs ? guardado.rankings : null;
    },
    gravar(janela, rankings, agora) {
      guardados.set(janela, { em: agora.getTime(), rankings });
    },
  };
}

/** Sem cache: toda requisição lê o banco (testes que mudam o banco entre chamadas). */
export const SEM_CACHE_DOS_RANKINGS: CacheDosRankings = {
  ler: () => null,
  gravar: () => {},
};

export interface OpcoesMinhaTodasAsRedes {
  /** "Agora" (os testes fixam o instante); padrão: o relógio do sistema. */
  relogio?: Relogio;
  /** Cache dos rankings; padrão: 30 s na memória do isolate. */
  cache?: CacheDosRankings;
}

export function criarMinhaTodasAsRedes({
  relogio = relogioDoSistema,
  cache = criarCacheDosRankings(),
}: OpcoesMinhaTodasAsRedes = {}) {
  const app = new Hono<AmbienteSessao>();

  // Por pessoa (o `eu`): nunca em cache, nem nos erros. Só no caminho desta rota (o sub-app fica sob /api/minha).
  app.use(LOCAL, async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.get(
    LOCAL,
    // Só o discipulador e a rede (o líder: 403), antes de ler a consulta; a chave do papel (D20) também aqui.
    exigirSessao(ROTA.papeis, { acessoDaCampanha: true }),
    validarConsulta(ROTA.consulta),
    async (c) => {
      const { alvo } = c.var.usuario;
      // Os dois papéis sempre têm o alvo deles (o banco garante); a conferência é a defesa a mais.
      if (alvo == null || alvo.tipo === "celula")
        return responderErro(
          c,
          "proibido",
          "Seu acesso não tem o ranking geral",
        );
      const { janela } = c.req.valid("query");
      const agora = relogio();
      let rankings = cache.ler(janela, agora);
      if (rankings === null) {
        const lido = await lerEntradaDoCalculo(c.env.DB, () => agora);
        if (!lido.ok)
          return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
        rankings = {
          discipuladores: montarRankingPainel(
            lido.entrada,
            { nivel: "discipulador", periodo: janela },
            lido.agora,
          ),
          celulas: montarRankingPainel(
            lido.entrada,
            { nivel: "celula", periodo: janela },
            lido.agora,
          ),
        };
        cache.gravar(janela, rankings, agora);
      }
      return c.json(
        ROTA.sucesso.corpo.parse(montarTodasAsRedes(rankings, alvo)),
        200,
      );
    },
  );

  return app;
}

/** O sub-app de produção (relógio do sistema e cache de 30 s). */
export const minhaTodasAsRedes = criarMinhaTodasAsRedes();
