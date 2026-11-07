// Campanha: a leitura da campanha ativa e a gravação da configuração (docs/api.md, GET e PUT
// /api/admin/campanha).
//
// - A API v1 trabalha só com a campanha ativa, e o índice parcial campanhas_uma_ativa garante no
//   máximo uma. buscarCampanhaAtiva é a ÚNICA leitura dela: o webhook (D5: só conta o slug_rifei da
//   ativa) e a configuração (GET e a resposta do PUT) usam a mesma função.
// - A leitura é um comando só (a linha e os períodos agregados em JSON): sai inteira, de um mesmo
//   instante do banco, sem db.batch. O webhook a faz antes do db.batch dele, como sempre fez.
// - O PUT cria a campanha ativa ou substitui a configuração dela (mesmo id, então os pedidos já
//   gravados continuam ligados a ela); os períodos são substituídos inteiros. Tudo vai num único
//   db.batch (uma transação no D1): campanha, períodos e a leitura de volta. Se qualquer comando
//   falha, nada muda.
// - As datas dos períodos, a data final e a soma dos percentuais saem do contrato
//   (src/shared/contracts/calendario.ts), o mesmo código que a tela usa.
// - Auditoria (RIFA-013b): quem salvou e o que mudou vão no mesmo db.batch (resumirMudancaDaCampanha).
import type { z } from "zod";
import {
  calcularCalendario,
  respostaCampanhaSchema,
  somarPercentuais,
  type Campanha,
  type DetalheValidacao,
  type corpoSalvarCampanhaSchema,
} from "../../shared/contracts";
import { prepararRegistroAuditoria, type Autoria } from "./auditoria";

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

/** Período como está gravado em campanha_periodos. */
export interface PeriodoGravado {
  ordem: number;
  nome: string;
  dias: number;
  percentual_bp: number;
}

/**
 * A campanha ativa como está no banco: as colunas de `campanhas` e os períodos, na ordem. Não passa
 * pelo contrato: o webhook só usa `id` e `slug_rifei` (e funciona mesmo com uma campanha gravada sem
 * períodos); a resposta da API sai de `montarCampanha`.
 */
export interface CampanhaAtiva {
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
  periodos: PeriodoGravado[];
}

/** Linha da consulta: os períodos chegam como texto JSON. */
type LinhaCampanhaAtiva = Omit<CampanhaAtiva, "periodos"> & {
  periodos: string;
};

// A ativa e os períodos dela num comando só (json_group_array devolve "[]" sem períodos).
const SELECIONAR_CAMPANHA_ATIVA = `
  SELECT c.id, c.nome, c.slug_rifei, c.fuso_horario, c.data_inicio, c.preco_bilhete_centavos,
    c.meta_unidade, c.meta_regra, c.meta_valor, c.ranking_criterio,
    c.publico_mostra_percentual_meta, c.publico_limite_ranking, c.criado_em, c.atualizado_em,
    (SELECT json_group_array(json_object('ordem', p.ordem, 'nome', p.nome, 'dias', p.dias,
        'percentual_bp', p.percentual_bp))
      FROM campanha_periodos AS p WHERE p.campanha_id = c.id) AS periodos
  FROM campanhas AS c WHERE c.ativa = 1 LIMIT 1`;

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

function campanhaDaLinha(
  linha: LinhaCampanhaAtiva | null | undefined,
): CampanhaAtiva | null {
  if (!linha) return null;
  // A ordem dos itens do json_group_array não é garantida: ordena aqui.
  const periodos = (JSON.parse(linha.periodos) as PeriodoGravado[]).sort(
    (a, b) => a.ordem - b.ordem,
  );
  return { ...linha, periodos };
}

/**
 * A campanha ativa (no máximo uma), ou null enquanto nenhuma foi ativada. É a única leitura dela:
 * o webhook (D5) e a configuração (GET e PUT /api/admin/campanha) usam esta função.
 */
export async function buscarCampanhaAtiva(
  db: D1Database,
): Promise<CampanhaAtiva | null> {
  return campanhaDaLinha(
    await db.prepare(SELECIONAR_CAMPANHA_ATIVA).first<LinhaCampanhaAtiva>(),
  );
}

/**
 * O que um PUT muda, para a trilha de auditoria (sem dados pessoais: a campanha é só configuração). O slug
 * e o preço saem com o antes e o depois: o slug decide quais vendas contam (D5) e o preço é a base da
 * plausibilidade do webhook; os demais campos saem só pelo nome.
 */
export function resumirMudancaDaCampanha(
  antes: CampanhaAtiva | null,
  depois: DadosCampanha,
): string {
  if (antes === null)
    return `Campanha criada: slug_rifei ${JSON.stringify(depois.slug_rifei)}, preco_bilhete_centavos ${depois.preco_bilhete_centavos}`;
  const alterados: string[] = [];
  if (antes.nome !== depois.nome) alterados.push("nome");
  if (antes.slug_rifei !== depois.slug_rifei)
    alterados.push(
      `slug_rifei (${JSON.stringify(antes.slug_rifei)} → ${JSON.stringify(depois.slug_rifei)})`,
    );
  if (antes.fuso_horario !== depois.fuso_horario)
    alterados.push("fuso_horario");
  if (antes.data_inicio !== depois.data_inicio) alterados.push("data_inicio");
  if (antes.preco_bilhete_centavos !== depois.preco_bilhete_centavos)
    alterados.push(
      `preco_bilhete_centavos (${antes.preco_bilhete_centavos} → ${depois.preco_bilhete_centavos})`,
    );
  if (
    antes.meta_unidade !== depois.meta.unidade ||
    antes.meta_regra !== depois.meta.regra ||
    antes.meta_valor !== depois.meta.valor
  )
    alterados.push("meta");
  const periodos = (lista: readonly Omit<PeriodoGravado, "ordem">[]) =>
    JSON.stringify(
      lista.map(({ nome, dias, percentual_bp }) => [nome, dias, percentual_bp]),
    );
  if (periodos(antes.periodos) !== periodos(depois.periodos))
    alterados.push("periodos");
  if (antes.ranking_criterio !== depois.ranking.criterio)
    alterados.push("ranking");
  if (
    (antes.publico_mostra_percentual_meta === 1) !==
      depois.publico.mostra_percentual_meta ||
    antes.publico_limite_ranking !== depois.publico.limite_ranking
  )
    alterados.push("publico");
  return alterados.length === 0
    ? "Configuração salva sem mudanças"
    : `Alterado: ${alterados.join(", ")}`;
}

/**
 * Cria a campanha ativa ou substitui a configuração dela, numa transação só. Com `auditoria`, o registro
 * (quem e o resumo) vai no mesmo lote: se a gravação falha, ele também não fica.
 */
export async function salvarCampanhaAtiva(
  db: D1Database,
  dados: DadosCampanha,
  auditoria?: Autoria & { resumo: string },
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

  if (auditoria)
    gravacao.push(
      prepararRegistroAuditoria(db, {
        ...auditoria,
        acao: "campanha.salvar",
        // O id da campanha ativa já gravada (no primeiro PUT, ele nasce neste lote).
        alvo: { tipo: "campanha", idSql: ID_DA_ATIVA },
      }),
    );

  let resultados: D1Result[];
  try {
    // A leitura de volta vai na mesma transação: a resposta é o que ficou gravado.
    resultados = await db.batch([
      ...gravacao,
      db.prepare(SELECIONAR_CAMPANHA_ATIVA),
    ]);
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

  const gravada = campanhaDaLinha(
    resultados.at(-1)?.results[0] as LinhaCampanhaAtiva | undefined,
  );
  if (!gravada) throw new Error("A campanha gravada não foi encontrada");
  return { ok: true, campanha: montarCampanha(gravada) };
}

/** A campanha no formato do contrato, com as datas dos períodos, a data final e a soma calculadas. */
export function montarCampanha(campanha: CampanhaAtiva): Campanha {
  const { periodos } = campanha;
  const calendario = calcularCalendario(campanha.data_inicio, periodos);
  // O parse garante a resposta no formato do contrato (enums, datas, faixas), mesmo se o banco
  // tiver sido mexido à mão.
  return respostaCampanhaSchema.parse({
    id: campanha.id,
    nome: campanha.nome,
    slug_rifei: campanha.slug_rifei,
    fuso_horario: campanha.fuso_horario,
    data_inicio: campanha.data_inicio,
    data_fim: calendario.data_fim,
    preco_bilhete_centavos: campanha.preco_bilhete_centavos,
    meta: {
      unidade: campanha.meta_unidade,
      regra: campanha.meta_regra,
      valor: campanha.meta_valor,
    },
    periodos: periodos.map((periodo, indice) => ({
      ordem: periodo.ordem,
      nome: periodo.nome,
      dias: periodo.dias,
      percentual_bp: periodo.percentual_bp,
      ...calendario.periodos[indice],
    })),
    soma_percentuais_bp: somarPercentuais(periodos),
    ranking: { criterio: campanha.ranking_criterio },
    publico: {
      mostra_percentual_meta: campanha.publico_mostra_percentual_meta === 1,
      limite_ranking: campanha.publico_limite_ranking,
    },
    criado_em: campanha.criado_em,
    atualizado_em: campanha.atualizado_em,
  });
}

/** O slug só colide com uma campanha inativa (a ativa é a própria linha atualizada). */
function slugJaUsado(erro: unknown): boolean {
  return (
    erro instanceof Error &&
    erro.message.includes("UNIQUE constraint failed: campanhas.slug_rifei")
  );
}
