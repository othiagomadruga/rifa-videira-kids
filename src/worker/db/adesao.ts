/**
 * Afiliados (D7) e adesão das células: GET /api/admin/afiliados, PUT /api/admin/afiliados/:affiliateId e
 * GET /api/admin/adesao (docs/api.md).
 *
 * As vendas vêm sempre da view vendas_aprovadas (só pedidos `approved`), que resolve a célula na leitura.
 * Por isso vincular, trocar ou desvincular um afiliado reatribui todas as vendas dele na hora, sem
 * gravar nada em `pedidos` (D7).
 */
import type { z } from "zod";
import type {
  AfiliadoResumo,
  OrigemAfiliado,
  TotaisVendas,
  corpoSalvarAfiliadoSchema,
  respostaAdesaoSchema,
  respostaListaAfiliadosSchema,
} from "../../shared/contracts";
import { prepararRegistroAuditoria, type Autoria } from "./auditoria";

export type RespostaListaAfiliados = z.infer<
  typeof respostaListaAfiliadosSchema
>;
export type RespostaAdesao = z.infer<typeof respostaAdesaoSchema>;
export type AdesaoCelula = RespostaAdesao["itens"][number];
export type CorpoSalvarAfiliado = z.output<typeof corpoSalvarAfiliadoSchema>;

/** Linha de um afiliado com os totais das vendas aprovadas dele. */
interface LinhaAfiliado {
  affiliate_id: number;
  celula_id: number | null;
  celula_nome: string | null;
  rotulo: string | null;
  origem: OrigemAfiliado;
  criado_em: string;
  vinculado_em: string | null;
  atualizado_em: string;
  pedidos_aprovados: number;
  bilhetes: number;
  total_centavos: number;
  primeira_venda_em: string | null;
  ultima_venda_em: string | null;
}

const SELECT_AFILIADO = `
  SELECT a.affiliate_id, a.celula_id, c.nome AS celula_nome, a.rotulo, a.origem,
         a.criado_em, a.vinculado_em, a.atualizado_em,
         count(v.pedido_id) AS pedidos_aprovados,
         coalesce(sum(v.qtd_bilhetes), 0) AS bilhetes,
         coalesce(sum(v.total_centavos), 0) AS total_centavos,
         min(v.aprovado_em) AS primeira_venda_em,
         max(v.aprovado_em) AS ultima_venda_em
  FROM afiliados AS a
  LEFT JOIN celulas AS c ON c.id = a.celula_id
  LEFT JOIN vendas_aprovadas AS v ON v.affiliate_id = a.affiliate_id`;

function paraAfiliadoResumo(linha: LinhaAfiliado): AfiliadoResumo {
  return {
    affiliate_id: linha.affiliate_id,
    celula_id: linha.celula_id,
    celula_nome: linha.celula_nome,
    rotulo: linha.rotulo,
    origem: linha.origem,
    criado_em: linha.criado_em,
    vinculado_em: linha.vinculado_em,
    atualizado_em: linha.atualizado_em,
    vendas: {
      pedidos_aprovados: linha.pedidos_aprovados,
      bilhetes: linha.bilhetes,
      total_centavos: linha.total_centavos,
    },
    primeira_venda_em: linha.primeira_venda_em,
    ultima_venda_em: linha.ultima_venda_em,
  };
}

const FILTRO_VINCULADO = {
  sim: "WHERE a.celula_id IS NOT NULL",
  nao: "WHERE a.celula_id IS NULL",
  todos: "",
} as const;

/**
 * Afiliados com as vendas aprovadas de cada um. `vinculado`: true = só os ligados a uma célula; false =
 * só a fila de órfãos; ausente = todos.
 *
 * Ordem pensada para a fila de órfãos: os não vinculados primeiro e, em cada grupo, o que apareceu por
 * último no topo (criado_em decrescente; empate pelo affiliate_id, também decrescente).
 */
export async function listarAfiliados(
  db: D1Database,
  { vinculado }: { vinculado?: boolean },
): Promise<RespostaListaAfiliados> {
  const filtro =
    vinculado === undefined
      ? FILTRO_VINCULADO.todos
      : FILTRO_VINCULADO[vinculado ? "sim" : "nao"];
  const [afiliados, semAfiliado] = await Promise.all([
    db
      .prepare(
        `${SELECT_AFILIADO} ${filtro}
         GROUP BY a.affiliate_id
         ORDER BY a.celula_id IS NOT NULL, a.criado_em DESC, a.affiliate_id DESC`,
      )
      .all<LinhaAfiliado>(),
    db
      .prepare(
        `SELECT count(*) AS pedidos_aprovados,
                coalesce(sum(qtd_bilhetes), 0) AS bilhetes,
                coalesce(sum(total_centavos), 0) AS total_centavos
         FROM vendas_aprovadas
         WHERE affiliate_id IS NULL`,
      )
      .first<TotaisVendas>(),
  ]);
  return {
    itens: afiliados.results.map(paraAfiliadoResumo),
    sem_afiliado: semAfiliado ?? {
      pedidos_aprovados: 0,
      bilhetes: 0,
      total_centavos: 0,
    },
  };
}

export type ResultadoSalvarAfiliado =
  | { ok: true; afiliado: AfiliadoResumo }
  | { ok: false; motivo: "celula_inexistente" };

/**
 * Um só comando, atômico: só grava se `celula_id` é null ou a célula existe (senão nada muda e
 * `changes` é 0). Afiliado novo entra como pré-cadastro (origem `manual`). Afiliado existente:
 * - `vinculado_em` = agora quando a célula muda (vincular ou trocar); null ao desvincular; o mesmo de
 *   antes se a célula não mudou (ex.: só o rótulo mudou);
 * - `rotulo`: ?5 = 1 quando o corpo traz o campo (null apaga); ausente mantém o atual;
 * - `origem` e `criado_em` nunca mudam.
 */
const GRAVAR_AFILIADO = `
  INSERT INTO afiliados (affiliate_id, celula_id, rotulo, origem, criado_em, vinculado_em, atualizado_em)
  SELECT ?1, ?2, ?3, 'manual', ?4, CASE WHEN ?2 IS NULL THEN NULL ELSE ?4 END, ?4
  WHERE ?2 IS NULL OR EXISTS (SELECT 1 FROM celulas WHERE id = ?2)
  ON CONFLICT (affiliate_id) DO UPDATE SET
    celula_id = excluded.celula_id,
    vinculado_em = CASE
      WHEN excluded.celula_id IS NULL THEN NULL
      WHEN afiliados.celula_id IS excluded.celula_id THEN afiliados.vinculado_em
      ELSE excluded.atualizado_em
    END,
    rotulo = CASE WHEN ?5 = 1 THEN excluded.rotulo ELSE afiliados.rotulo END,
    atualizado_em = excluded.atualizado_em`;

/** O vínculo atual do afiliado (célula e rótulo), ou null se ele ainda não existe. */
export async function buscarVinculoDoAfiliado(
  db: D1Database,
  affiliateId: number,
): Promise<{ celula_id: number | null; rotulo: string | null } | null> {
  return db
    .prepare("SELECT celula_id, rotulo FROM afiliados WHERE affiliate_id = ?1")
    .bind(affiliateId)
    .first<{ celula_id: number | null; rotulo: string | null }>();
}

/**
 * O que o PUT muda, para a trilha de auditoria (RIFA-013b): as células pelo id e o rótulo só como
 * "alterado" ou "apagado" (é texto livre da coordenação e pode citar alguém).
 */
export function resumirMudancaDoAfiliado(
  antes: { celula_id: number | null; rotulo: string | null } | null,
  corpo: CorpoSalvarAfiliado,
): string {
  const celula = (id: number | null) => (id === null ? "nenhuma" : String(id));
  const partes = [
    antes === null
      ? `Pré-cadastro: célula ${celula(corpo.celula_id)}`
      : antes.celula_id === corpo.celula_id
        ? `Célula ${celula(corpo.celula_id)} mantida`
        : `Célula: ${celula(antes.celula_id)} → ${celula(corpo.celula_id)}${corpo.celula_id === null ? " (desvinculado)" : ""}`,
  ];
  if (corpo.rotulo !== undefined && corpo.rotulo !== (antes?.rotulo ?? null))
    partes.push(corpo.rotulo === null ? "rótulo apagado" : "rótulo alterado");
  return partes.join("; ");
}

/**
 * Vincula (`celula_id`), troca ou desvincula (`celula_id: null`) a célula do afiliado; se o afiliado
 * ainda não existe, cria (pré-cadastro). Devolve o afiliado com as vendas, já na célula nova: a gravação
 * e a leitura vão no mesmo batch (uma transação do D1). Com `auditoria` (RIFA-013b), o registro vai no
 * mesmo lote, com a mesma condição da gravação (célula inexistente: nada gravado, nada registrado).
 */
export async function salvarAfiliado(
  db: D1Database,
  affiliateId: number,
  corpo: CorpoSalvarAfiliado,
  agora: string,
  auditoria?: Autoria & { resumo: string },
): Promise<ResultadoSalvarAfiliado> {
  const informouRotulo = corpo.rotulo !== undefined;
  const [gravacao, leitura] = await db.batch<LinhaAfiliado>([
    db
      .prepare(GRAVAR_AFILIADO)
      .bind(
        affiliateId,
        corpo.celula_id,
        corpo.rotulo ?? null,
        agora,
        informouRotulo ? 1 : 0,
      ),
    db
      .prepare(
        `${SELECT_AFILIADO} WHERE a.affiliate_id = ?1 GROUP BY a.affiliate_id`,
      )
      .bind(affiliateId),
    ...(auditoria
      ? [
          prepararRegistroAuditoria(
            db,
            {
              ...auditoria,
              acao: "afiliado.salvar",
              alvo: `afiliado:${affiliateId}`,
            },
            {
              // A mesma condição do GRAVAR_AFILIADO.
              sql: "?6 IS NULL OR EXISTS (SELECT 1 FROM celulas WHERE id = ?6)",
              valores: [corpo.celula_id],
            },
          ),
        ]
      : []),
  ]);
  if (gravacao.meta.changes === 0) {
    return { ok: false, motivo: "celula_inexistente" };
  }
  const linha = leitura.results[0];
  if (!linha) {
    throw new Error(
      `Afiliado ${affiliateId} gravado, mas não encontrado na leitura`,
    );
  }
  return { ok: true, afiliado: paraAfiliadoResumo(linha) };
}

type LinhaCelula = Omit<
  AdesaoCelula,
  "afiliados" | "vinculada" | "primeira_venda_em" | "pedidos_aprovados"
>;

interface LinhaVinculo {
  celula_id: number;
  affiliate_id: number;
}

interface LinhaVendasCelula {
  celula_id: number;
  pedidos_aprovados: number;
  primeira_venda_em: string;
}

/**
 * Ordem das células pelo nome em português: o COLLATE NOCASE do SQLite só ignora maiúsculas ASCII e
 * poria "Célula Ágape" depois de "Célula Zoe"; `numeric` põe "Célula 2" antes de "Célula 10".
 */
const ordemDosNomes = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  numeric: true,
});

/**
 * Painel de adesão: uma linha por célula (afiliados vinculados, primeira venda e pedidos aprovados) e o
 * resumo. As quatro leituras vão num batch (uma transação), para o resumo bater com as linhas.
 */
export async function obterAdesao(db: D1Database): Promise<RespostaAdesao> {
  const [celulas, vinculos, vendas, orfaos] = await db.batch([
    db.prepare(
      `SELECT c.id AS celula_id, c.nome AS celula_nome, c.qtd_pessoas, c.lider_nome, c.lider_telefone,
              d.id AS discipulador_id, d.nome AS discipulador_nome,
              r.id AS rede_id, r.nome AS rede_nome, r.divisao
       FROM celulas AS c
       JOIN discipuladores AS d ON d.id = c.discipulador_id
       JOIN redes AS r ON r.id = d.rede_id`,
    ),
    db.prepare(
      `SELECT celula_id, affiliate_id FROM afiliados
       WHERE celula_id IS NOT NULL ORDER BY affiliate_id`,
    ),
    db.prepare(
      `SELECT celula_id, count(*) AS pedidos_aprovados, min(aprovado_em) AS primeira_venda_em
       FROM vendas_aprovadas
       WHERE celula_id IS NOT NULL
       GROUP BY celula_id`,
    ),
    db.prepare(
      "SELECT count(*) AS total FROM afiliados WHERE celula_id IS NULL",
    ),
  ]);

  const afiliadosPorCelula = new Map<number, number[]>();
  for (const {
    celula_id,
    affiliate_id,
  } of vinculos.results as LinhaVinculo[]) {
    const lista = afiliadosPorCelula.get(celula_id) ?? [];
    lista.push(affiliate_id);
    afiliadosPorCelula.set(celula_id, lista);
  }
  const vendasPorCelula = new Map(
    (vendas.results as LinhaVendasCelula[]).map((linha) => [
      linha.celula_id,
      linha,
    ]),
  );

  const itens: AdesaoCelula[] = (celulas.results as LinhaCelula[])
    .map((celula) => {
      const afiliados = afiliadosPorCelula.get(celula.celula_id) ?? [];
      const venda = vendasPorCelula.get(celula.celula_id);
      return {
        ...celula,
        afiliados,
        vinculada: afiliados.length > 0,
        primeira_venda_em: venda?.primeira_venda_em ?? null,
        pedidos_aprovados: venda?.pedidos_aprovados ?? 0,
      };
    })
    .sort(
      (a, b) =>
        ordemDosNomes.compare(a.celula_nome, b.celula_nome) ||
        a.celula_id - b.celula_id,
    );

  const [{ total: afiliadosNaoVinculados }] = orfaos.results as [
    { total: number },
  ];
  return {
    resumo: {
      celulas: itens.length,
      vinculadas: itens.filter((item) => item.vinculada).length,
      com_venda: itens.filter((item) => item.pedidos_aprovados > 0).length,
      afiliados_nao_vinculados: afiliadosNaoVinculados,
    },
    itens,
  };
}
