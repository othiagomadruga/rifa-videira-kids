// Campanha ativa: leitura e gravação da configuração (docs/api.md, GET e PUT /api/admin/campanha).
//
// - A API v1 trabalha só com a campanha ativa, e o índice parcial campanhas_uma_ativa garante no
//   máximo uma. O PUT cria a campanha ativa ou substitui a configuração dela (mesmo id, então os
//   pedidos já gravados continuam ligados a ela); os períodos são substituídos inteiros.
// - Tudo vai num único db.batch (uma transação no D1): campanha, períodos e a leitura de volta.
//   Se qualquer comando falha, nada muda.
// - As datas dos períodos, a data final e a soma dos percentuais saem de ../../web/pages/campanha/
//   calendario.ts, o mesmo código que a tela usa (a regra fica num lugar só).
import type { z } from "zod";
import {
  respostaCampanhaSchema,
  type Campanha,
  type DetalheValidacao,
  type corpoSalvarCampanhaSchema,
} from "../../shared/contracts";
import {
  calcularCalendario,
  somarPercentuais,
} from "../../web/pages/campanha/calendario";

/** Corpo do PUT depois da validação (com os padrões de fuso_horario e publico já aplicados). */
export type DadosCampanha = z.output<typeof corpoSalvarCampanhaSchema>;

export type ResultadoSalvarCampanha =
  | { ok: true; campanha: Campanha }
  | {
      ok: false;
      codigo: "nome_duplicado";
      mensagem: string;
      detalhes: DetalheValidacao[];
    };

interface LinhaCampanha {
  id: number;
  nome: string;
  slug_rifei: string;
  fuso_horario: string;
  data_inicio: string;
  preco_bilhete_centavos: number;
  meta_unidade: string;
  meta_regra: string;
  meta_valor: number;
  ranking_criterio: string;
  publico_mostra_percentual_meta: number;
  publico_limite_ranking: number | null;
  criado_em: string;
  atualizado_em: string;
}

interface LinhaPeriodo {
  ordem: number;
  nome: string;
  dias: number;
  percentual_bp: number;
}

const ID_DA_ATIVA = "(SELECT id FROM campanhas WHERE ativa = 1)";

// Cria a campanha ativa ou, se já existe uma, troca a configuração dela (upsert pelo índice parcial
// campanhas_uma_ativa). criado_em fica como estava; atualizado_em vira o instante da gravação.
const GRAVAR_CAMPANHA = `
  INSERT INTO campanhas (nome, slug_rifei, ativa, fuso_horario, data_inicio, preco_bilhete_centavos,
    meta_unidade, meta_regra, meta_valor, ranking_criterio, publico_mostra_percentual_meta,
    publico_limite_ranking)
  VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
  ON CONFLICT (ativa) WHERE ativa = 1 DO UPDATE SET
    nome = excluded.nome,
    slug_rifei = excluded.slug_rifei,
    fuso_horario = excluded.fuso_horario,
    data_inicio = excluded.data_inicio,
    preco_bilhete_centavos = excluded.preco_bilhete_centavos,
    meta_unidade = excluded.meta_unidade,
    meta_regra = excluded.meta_regra,
    meta_valor = excluded.meta_valor,
    ranking_criterio = excluded.ranking_criterio,
    publico_mostra_percentual_meta = excluded.publico_mostra_percentual_meta,
    publico_limite_ranking = excluded.publico_limite_ranking,
    atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

function lerCampanhaAtiva(db: D1Database) {
  return [
    db.prepare(
      `SELECT id, nome, slug_rifei, fuso_horario, data_inicio, preco_bilhete_centavos,
         meta_unidade, meta_regra, meta_valor, ranking_criterio, publico_mostra_percentual_meta,
         publico_limite_ranking, criado_em, atualizado_em
       FROM campanhas WHERE ativa = 1`,
    ),
    db.prepare(
      `SELECT p.ordem, p.nome, p.dias, p.percentual_bp
       FROM campanha_periodos AS p JOIN campanhas AS c ON c.id = p.campanha_id
       WHERE c.ativa = 1 ORDER BY p.ordem`,
    ),
  ];
}

/** A campanha ativa no formato do contrato, ou null enquanto nada foi configurado. */
export async function obterCampanhaAtiva(
  db: D1Database,
): Promise<Campanha | null> {
  // Campanha e períodos na mesma transação: nunca uma configuração pela metade.
  const [campanhas, periodos] = await db.batch(lerCampanhaAtiva(db));
  return montarCampanha(campanhas, periodos);
}

/** Cria a campanha ativa ou substitui a configuração dela, numa transação só. */
export async function salvarCampanhaAtiva(
  db: D1Database,
  dados: DadosCampanha,
): Promise<ResultadoSalvarCampanha> {
  const gravacao = [
    db
      .prepare(GRAVAR_CAMPANHA)
      .bind(
        dados.nome,
        dados.slug_rifei,
        dados.fuso_horario,
        dados.data_inicio,
        dados.preco_bilhete_centavos,
        dados.meta.unidade,
        dados.meta.regra,
        dados.meta.valor,
        dados.ranking.criterio,
        dados.publico.mostra_percentual_meta ? 1 : 0,
        dados.publico.limite_ranking,
      ),
    db.prepare(
      `DELETE FROM campanha_periodos WHERE campanha_id = ${ID_DA_ATIVA}`,
    ),
    ...dados.periodos.map((periodo, indice) =>
      db
        .prepare(
          `INSERT INTO campanha_periodos (campanha_id, ordem, nome, dias, percentual_bp)
           VALUES (${ID_DA_ATIVA}, ?, ?, ?, ?)`,
        )
        .bind(indice + 1, periodo.nome, periodo.dias, periodo.percentual_bp),
    ),
  ];

  let resultados: D1Result[];
  try {
    resultados = await db.batch([...gravacao, ...lerCampanhaAtiva(db)]);
  } catch (erro) {
    if (slugJaUsado(erro)) {
      const mensagem =
        "Este slug já pertence a outra campanha (inativa) do sistema";
      return {
        ok: false,
        codigo: "nome_duplicado",
        mensagem,
        detalhes: [
          { caminho: ["slug_rifei"], codigo: "slug_duplicado", mensagem },
        ],
      };
    }
    throw erro;
  }

  const [campanhas, periodos] = resultados.slice(-2);
  const campanha = montarCampanha(campanhas, periodos);
  if (!campanha) throw new Error("A campanha gravada não foi encontrada");
  return { ok: true, campanha };
}

function montarCampanha(
  resultadoCampanha: D1Result | undefined,
  resultadoPeriodos: D1Result | undefined,
): Campanha | null {
  const [linha] = (resultadoCampanha?.results ?? []) as LinhaCampanha[];
  if (!linha) return null;
  const periodos = (resultadoPeriodos?.results ?? []) as LinhaPeriodo[];
  const calendario = calcularCalendario(linha.data_inicio, periodos);
  // O parse garante a resposta no formato do contrato (enums, datas, faixas), mesmo se o banco
  // tiver sido mexido à mão.
  return respostaCampanhaSchema.parse({
    id: linha.id,
    nome: linha.nome,
    slug_rifei: linha.slug_rifei,
    fuso_horario: linha.fuso_horario,
    data_inicio: linha.data_inicio,
    data_fim: calendario.data_fim,
    preco_bilhete_centavos: linha.preco_bilhete_centavos,
    meta: {
      unidade: linha.meta_unidade,
      regra: linha.meta_regra,
      valor: linha.meta_valor,
    },
    periodos: periodos.map((periodo, indice) => ({
      ordem: periodo.ordem,
      nome: periodo.nome,
      dias: periodo.dias,
      percentual_bp: periodo.percentual_bp,
      ...calendario.periodos[indice],
    })),
    soma_percentuais_bp: somarPercentuais(periodos),
    ranking: { criterio: linha.ranking_criterio },
    publico: {
      mostra_percentual_meta: linha.publico_mostra_percentual_meta === 1,
      limite_ranking: linha.publico_limite_ranking,
    },
    criado_em: linha.criado_em,
    atualizado_em: linha.atualizado_em,
  });
}

/** O slug só colide com uma campanha inativa (a ativa é a própria linha atualizada). */
function slugJaUsado(erro: unknown): boolean {
  return (
    erro instanceof Error &&
    erro.message.includes("UNIQUE constraint failed: campanhas.slug_rifei")
  );
}
