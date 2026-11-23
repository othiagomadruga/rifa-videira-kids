/**
 * Todas as redes (RIFA-090, adendo da D12): o ranking geral da campanha na /minha do discipulador e da rede. Embaixo do
 * que ele já vê (ele e as células dele), o quadro da igreja inteira: TODOS os discipuladores e TODAS as células em
 * ranking, com a posição, o nome, o % da meta e os bilhetes da janela. Nunca dinheiro (D12), nunca comprador, telefone
 * ou senha: só nomes de discipuladores e células, % e bilhetes (o schema estrito recusa qualquer outro campo).
 *
 * - **A mesma conta da coordenação**: os dois rankings saem de `montarRankingPainel` (calculos.ts), o do
 *   `GET /api/painel/ranking` sem filtro de divisão, na mesma janela (`atual` = o período de hoje; `campanha` = do 1º
 *   dia até hoje) e no critério da campanha (hoje `percentual_meta`, a meta por pessoa; o ranking unificado, D27). A
 *   posição e a ordem são as de lá; a resposta só tira os valores. A atribuição das vendas às células é a da leitura do
 *   painel (db/painel.ts): o que mudar lá (ex.: a célula efetiva da RIFA-088) vale aqui também.
 * - **Discipuladores**: os que têm células (R8, como no ranking); **células**: todas, com o nome do discipulador.
 * - **`eu`**: marca as linhas de quem pede, pelo id (nunca pelo nome): o discipulador, a linha dele e as células dele; a
 *   rede, os discipuladores e as células dela. Os ids não saem na resposta.
 * - `bilhetes` é a quantidade vendida na janela (pedidos aprovados que contam), com qualquer unidade de meta: não é
 *   dinheiro. `percentual_meta_bp` é null quando a meta na janela é zero.
 *
 * Os schemas e o catálogo (`ROTAS_TODAS_AS_REDES`) ficam aqui, num catálogo à parte de ROTAS, como os dos maiores
 * compradores; o site importa só os TIPOS deste módulo (o zod não vai para o pacote dele).
 */
import { z } from "zod";
import {
  JANELAS_RANKING,
  janelaRankingSchema,
  referenciaCampanhaSchema,
  type DefinicaoRota,
  type ItemRanking,
  type RespostaRanking,
} from "./api";
import { CRITERIOS_RANKING, instanteSchema, type Alvo } from "./dominio";

/** Quantas linhas de cada lista a tela mostra antes do "Ver todas" (a API manda todas). */
export const LINHAS_VISIVEIS_TODAS_AS_REDES = 10;

/**
 * `janela`: `atual` (padrão; o período que contém hoje, "esta semana") ou `campanha` (do 1º dia até hoje), a mesma
 * janela do ranking (`periodo` no painel). Outros parâmetros são ignorados (o alvo vem só da sessão).
 */
export const consultaTodasAsRedesSchema = z.object({
  janela: z.enum(JANELAS_RANKING).default("atual"),
});
export type ConsultaTodasAsRedes = z.output<typeof consultaTodasAsRedesSchema>;

const posicaoSchema = z.number().int().min(1);
/** Pontos-base truncados, sem teto (passam de 10000 acima da meta); null sem meta na janela. */
const percentualDaMetaSchema = z.number().int().nonnegative().nullable();
const bilhetesSchema = z.number().int().nonnegative();

/** Um discipulador no ranking geral: posição, nome, % da meta e bilhetes da janela. */
export const itemDiscipuladorTodasAsRedesSchema = z.strictObject({
  /** A do ranking dos discipuladores da coordenação (empates dividem a posição: 1, 1, 3). */
  posicao: posicaoSchema,
  nome: z.string().min(1),
  percentual_meta_bp: percentualDaMetaSchema,
  bilhetes: bilhetesSchema,
  /** A linha de quem pede: o próprio discipulador; na rede, os discipuladores dela. */
  eu: z.boolean(),
});
export type ItemDiscipuladorTodasAsRedes = z.infer<
  typeof itemDiscipuladorTodasAsRedesSchema
>;

/** Uma célula no ranking geral: posição, nome, o discipulador dela, % da meta e bilhetes da janela. */
export const itemCelulaTodasAsRedesSchema = z.strictObject({
  /** A do ranking das células da coordenação (empates dividem a posição: 1, 1, 3). */
  posicao: posicaoSchema,
  nome: z.string().min(1),
  /** O nome do discipulador da célula. */
  discipulador: z.string().min(1),
  percentual_meta_bp: percentualDaMetaSchema,
  bilhetes: bilhetesSchema,
  /** As células de quem pede: as do discipulador; na rede, as dela. */
  eu: z.boolean(),
});
export type ItemCelulaTodasAsRedes = z.infer<
  typeof itemCelulaTodasAsRedesSchema
>;

/** As posições de uma lista: a 1ª é 1; cada uma repete a anterior (empate) ou é o índice + 1 (1, 1, 3). */
function conferirPosicoes(
  lista: "discipuladores" | "celulas",
  itens: readonly { posicao: number }[],
  ctx: z.RefinementCtx,
): void {
  itens.forEach((item, indice) => {
    const anterior = itens[indice - 1];
    const certa =
      anterior === undefined
        ? item.posicao === 1
        : item.posicao === anterior.posicao || item.posicao === indice + 1;
    if (!certa)
      ctx.addIssue({
        code: "custom",
        path: [lista, indice, "posicao"],
        message: "Posição fora da ordem (empates dividem a posição: 1, 1, 3)",
      });
  });
}

export const respostaTodasAsRedesSchema = z
  .strictObject({
    janela: janelaRankingSchema,
    /** O critério da ordem (o da campanha): `percentual_meta`, `bilhetes` ou `arrecadacao`. */
    criterio: z.enum(CRITERIOS_RANKING),
    /** Fase, dia e período de hoje (sem valores), para a tela dizer "Resultado final" depois do fim. */
    referencia: referenciaCampanhaSchema,
    /** Todos os discipuladores com células, na ordem do ranking. */
    discipuladores: z.array(itemDiscipuladorTodasAsRedesSchema),
    /** Todas as células, na ordem do ranking. */
    celulas: z.array(itemCelulaTodasAsRedesSchema),
    atualizado_em: instanteSchema,
  })
  .superRefine((resposta, ctx) => {
    conferirPosicoes("discipuladores", resposta.discipuladores, ctx);
    conferirPosicoes("celulas", resposta.celulas, ctx);
  });
export type RespostaTodasAsRedes = z.infer<typeof respostaTodasAsRedesSchema>;

/**
 * O ranking geral (RIFA-090), SÓ do discipulador e da rede: o líder e a coordenação levam 403 `proibido`, antes de ler a
 * consulta. Catálogo à parte de ROTAS, como ROTAS_MAIORES_COMPRADORES: ROTAS continua com só a visão em /api/minha, e o
 * src/worker/protecao.test.ts põe este catálogo nas listas dele.
 *
 * Erros: 401 sem sessão; 403 `proibido` (líder e coordenação); 403 `acesso_desligado` com o acesso do papel desligado
 * (D20, como todo /api/minha/*); 400 `janela` inválida; 404 `nao_encontrado` sem campanha ativa. `Cache-Control:
 * no-store` (é por pessoa: o `eu`). A resposta passa pelo schema estrito antes de sair (um campo a mais vira 500).
 */
export const ROTAS_TODAS_AS_REDES = {
  todasAsRedes: {
    metodo: "GET",
    caminho: "/api/minha/todas-as-redes",
    grupo: "hierarquia",
    papeis: ["discipulador", "rede"],
    situacao: "detalhada",
    consulta: consultaTodasAsRedesSchema,
    sucesso: { status: 200, corpo: respostaTodasAsRedesSchema },
  },
} as const satisfies Record<string, DefinicaoRota>;

export type NomeRotaTodasAsRedes = keyof typeof ROTAS_TODAS_AS_REDES;

/** A linha é de quem pede? Pelo id do alvo da sessão (o discipulador ou a rede), nunca pelo nome. */
function eDoAlvo(item: ItemRanking, alvo: Alvo): boolean {
  switch (alvo.tipo) {
    case "discipulador":
      return item.discipulador === null
        ? item.id === alvo.id
        : item.discipulador.id === alvo.id;
    case "rede":
      return item.rede?.id === alvo.id;
    case "celula":
      return item.discipulador !== null && item.id === alvo.id;
  }
}

/**
 * A resposta a partir dos dois rankings da coordenação (`montarRankingPainel` na mesma entrada, janela e instante, sem
 * filtro de divisão): o de discipuladores e o de células. Mantém a posição e a ordem de lá e tira tudo o que não é
 * nome, % da meta e bilhetes. `alvo` marca as linhas de quem pede (`eu`).
 */
export function montarTodasAsRedes(
  rankings: { discipuladores: RespostaRanking; celulas: RespostaRanking },
  alvo: Alvo,
): RespostaTodasAsRedes {
  const { discipuladores, celulas } = rankings;
  if (discipuladores.nivel !== "discipulador" || celulas.nivel !== "celula")
    throw new RangeError(
      "Os rankings precisam ser de discipuladores e células",
    );
  return {
    janela: celulas.janela,
    criterio: celulas.criterio,
    referencia: celulas.referencia,
    discipuladores: discipuladores.itens.map((item) => ({
      posicao: item.posicao,
      nome: item.nome,
      percentual_meta_bp: item.percentual_meta_bp,
      bilhetes: item.vendas.bilhetes,
      eu: eDoAlvo(item, alvo),
    })),
    celulas: celulas.itens.map((item) => {
      if (item.discipulador === null)
        throw new RangeError("Célula sem discipulador no ranking");
      return {
        posicao: item.posicao,
        nome: item.nome,
        discipulador: item.discipulador.nome,
        percentual_meta_bp: item.percentual_meta_bp,
        bilhetes: item.vendas.bilhetes,
        eu: eDoAlvo(item, alvo),
      };
    }),
    atualizado_em: celulas.atualizado_em,
  };
}
