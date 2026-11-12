/**
 * Link de vendas de cada célula no D1 (RIFA-046, docs/decisions.md D24; coluna `campanhas.link_vendas_modelo` da
 * migração 0010). O link é o de afiliado da Rifei, montado pelo modelo que só o admin grava; a montagem e a ordem
 * ficam em lib/links-vendas.ts (puro). Rotas: routes/links-vendas.ts (admin e coordenação) e routes/minha.ts (líder,
 * discipulador e rede).
 *
 * - Leitura (lerLinksVendas): UMA ida ao banco, um db.batch com três consultas e nenhum pedido: a campanha ativa (o
 *   id, o slug e o modelo; índice campanhas_uma_ativa), as células do escopo com a hierarquia (só o `lider_nome`:
 *   nunca o telefone nem o e-mail do líder) e os afiliados vinculados a elas pelo índice afiliados_por_celula (a
 *   ordem dos links, do vínculo mais recente para o mais antigo, é da montagem). Nunca o `rotulo` do afiliado (nota
 *   interna da coordenação). Sem cache e sem a réplica de leitura: mudar o modelo ou vincular um afiliado vale na
 *   requisição seguinte.
 * - Gravação (salvarModeloLinkVendas): um db.batch só, com o registro na trilha ANTES e sob a MESMA condição do
 *   UPDATE (`WHERE ativa = 1 AND link_vendas_modelo IS NOT ?`, que compara também o NULL: o mesmo modelo de novo não
 *   muda nada e não registra), o UPDATE e a leitura de todas as células, já com o modelo novo.
 * - O escopo vem SÓ do alvo da sessão (a rota não aceita id): o id entra por bind; o trecho SQL do filtro é constante
 *   do código, escolhido pelo tipo do alvo.
 */
import type { AcaoAuditoria, Divisao, TipoAlvo } from "../../shared/contracts";
import type { Autoria } from "./auditoria";

/** As células de um alvo da hierarquia (o da sessão), ou "todas" (a lista da coordenação). */
export type EscopoLinksVendas = { tipo: TipoAlvo; id: number } | "todas";

/** A campanha ativa como os links precisam: o slug ({slug}) e o modelo gravado (NULL = ainda não liberado). */
export interface CampanhaLinksVendas {
  id: number;
  slug_rifei: string;
  link_vendas_modelo: string | null;
}

/** Uma célula do escopo com a hierarquia: só nomes e ids (nunca o telefone nem o e-mail do líder). */
export interface CelulaDoEscopo {
  celula_id: number;
  celula_nome: string;
  lider_nome: string;
  discipulador_id: number;
  discipulador_nome: string;
  rede_id: number;
  rede_nome: string;
  divisao: Divisao;
}

/** Um afiliado vinculado a uma célula do escopo (sem o `rotulo`); `vinculado_em` só dá a ordem dos links. */
export interface AfiliadoDoEscopo {
  affiliate_id: number;
  celula_id: number;
  vinculado_em: string;
}

/**
 * O que a montagem precisa (lib/links-vendas.ts). `afiliados` vem só em ordem de célula: a montagem põe os links de
 * cada célula do vínculo mais recente para o mais antigo (`vinculado_em` decrescente; empate, `affiliate_id`
 * decrescente), no Worker (modelo-de-dados.md, seção 11: esse ORDER BY no SQL leria uma linha a mais por afiliado, a
 * da B-tree temporária, e a regra fica testada sem banco).
 */
export interface LeituraLinksVendas {
  campanha: CampanhaLinksVendas;
  celulas: CelulaDoEscopo[];
  afiliados: AfiliadoDoEscopo[];
}

/** (a) A campanha ativa: id, slug e modelo (1 linha, pelo índice parcial campanhas_uma_ativa). */
export const LER_CAMPANHA_LINKS_VENDAS =
  "SELECT id, slug_rifei, link_vendas_modelo FROM campanhas WHERE ativa = 1";

/** O filtro das células de cada escopo (`c` é a célula, `d` o discipulador); ?1 é o id do alvo. */
const FILTRO_DAS_CELULAS: Record<TipoAlvo | "todas", string> = {
  celula: "c.id = ?1",
  discipulador: "c.discipulador_id = ?1",
  rede: "d.rede_id = ?1",
  todas: "1",
};

/**
 * Os afiliados de cada escopo, pelas células dele (?1 é o id do alvo). Na lista da coordenação, todo afiliado
 * vinculado (a chave estrangeira garante a célula): `celula_id IS NOT NULL`, com o `ORDER BY celula_id` abaixo, desce
 * pelo índice só pelos vinculados, sem ler as células de novo.
 */
const AFILIADOS_DO_ESCOPO: Record<TipoAlvo | "todas", string> = {
  celula: "celula_id = ?1",
  discipulador:
    "celula_id IN (SELECT id FROM celulas WHERE discipulador_id = ?1)",
  rede: `celula_id IN (SELECT c.id FROM celulas AS c JOIN discipuladores AS d ON d.id = c.discipulador_id
      WHERE d.rede_id = ?1)`,
  todas: "celula_id IS NOT NULL",
};

const tipoDoEscopo = (escopo: EscopoLinksVendas) =>
  escopo === "todas" ? "todas" : escopo.tipo;

/** (b) As células do escopo com o caminho na hierarquia. A ordem é a da montagem (Intl.Collator, no Worker). */
export function sqlCelulasLinksVendas(escopo: EscopoLinksVendas): string {
  return `SELECT c.id AS celula_id, c.nome AS celula_nome, c.lider_nome,
      d.id AS discipulador_id, d.nome AS discipulador_nome,
      r.id AS rede_id, r.nome AS rede_nome, r.divisao
    FROM celulas AS c
      JOIN discipuladores AS d ON d.id = c.discipulador_id
      JOIN redes AS r ON r.id = d.rede_id
    WHERE ${FILTRO_DAS_CELULAS[tipoDoEscopo(escopo)]}`;
}

/**
 * (c) Os afiliados vinculados às células do escopo, pelo índice afiliados_por_celula. Só `ORDER BY celula_id`, que o
 * próprio índice já dá (sem B-tree temporária, que leria mais uma linha por afiliado); na lista da coordenação, é ele
 * que faz o planejador descer pelo índice só pelos vinculados, em vez de ler a tabela inteira (os sem célula também).
 * A ordem dos links dentro de cada célula (do vínculo mais recente para o mais antigo) é da montagem.
 */
export function sqlAfiliadosLinksVendas(escopo: EscopoLinksVendas): string {
  return `SELECT affiliate_id, celula_id, vinculado_em FROM afiliados
    WHERE ${AFILIADOS_DO_ESCOPO[tipoDoEscopo(escopo)]}
    ORDER BY celula_id`;
}

/** As três leituras, prontas para o db.batch (o id do alvo por bind; "todas" sem bind). */
function leituras(
  db: D1Database,
  escopo: EscopoLinksVendas,
): D1PreparedStatement[] {
  const comId = (sql: string) =>
    escopo === "todas" ? db.prepare(sql) : db.prepare(sql).bind(escopo.id);
  return [
    db.prepare(LER_CAMPANHA_LINKS_VENDAS),
    comId(sqlCelulasLinksVendas(escopo)),
    comId(sqlAfiliadosLinksVendas(escopo)),
  ];
}

/** Os três resultados do lote, ou null sem campanha ativa (as rotas respondem 404). */
function daLeitura(resultados: D1Result[]): LeituraLinksVendas | null {
  const [campanha, celulas, afiliados] = resultados.slice(-3);
  const ativa = campanha.results[0] as CampanhaLinksVendas | undefined;
  if (ativa === undefined) return null;
  return {
    campanha: ativa,
    celulas: celulas.results as CelulaDoEscopo[],
    afiliados: afiliados.results as AfiliadoDoEscopo[],
  };
}

/** A campanha ativa, as células do escopo e os afiliados delas numa ida só; null sem campanha ativa. */
export async function lerLinksVendas(
  db: D1Database,
  escopo: EscopoLinksVendas,
): Promise<LeituraLinksVendas | null> {
  return daLeitura(await db.batch(leituras(db, escopo)));
}

/** A ação da trilha (ACOES_AUDITORIA): a mesma do PUT da campanha (D24, sem ação nova). */
const ACAO: AcaoAuditoria = "campanha.salvar";

/** O resumo da trilha: "Modelo do link de vendas: <antes> → <depois>", com "(vazio)" no lugar do NULL. */
export const RESUMO_MODELO_LINK_VENDAS = {
  prefixo: "Modelo do link de vendas: ",
  seta: " → ",
  vazio: "(vazio)",
} as const;

/**
 * O registro da trilha, ANTES do UPDATE e sob a mesma condição dele (a linha da campanha ativa só existe aqui se o
 * UPDATE vai mudá-la). O antes sai da própria linha, na hora da gravação; o alvo é `campanha:<id>`. O resumo cabe na
 * coluna sem cortar: os dois modelos têm até 300 caracteres (o CHECK da 0010 e o schema do corpo).
 * ?1 autor, ?2 instante, ?3 o modelo novo (ou NULL), ?4 a ação, ?5 a ?7 os textos do resumo.
 */
export const REGISTRAR_MODELO_LINK_VENDAS = `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
  SELECT ?1, ?2, ?4, 'campanha:' || c.id,
    ?5 || coalesce(c.link_vendas_modelo, ?7) || ?6 || coalesce(?3, ?7)
  FROM campanhas AS c
  WHERE c.ativa = 1 AND c.link_vendas_modelo IS NOT ?3`;

/** A gravação: só a campanha ativa, só se o modelo muda (`IS NOT` compara também o NULL). ?1 modelo, ?2 instante. */
export const GRAVAR_MODELO_LINK_VENDAS = `UPDATE campanhas SET link_vendas_modelo = ?1, atualizado_em = ?2
  WHERE ativa = 1 AND link_vendas_modelo IS NOT ?1`;

export interface ModeloLinkVendasSalvo {
  /** A lista de todas as células, já com o modelo novo; null sem campanha ativa (nada foi gravado). */
  leitura: LeituraLinksVendas | null;
  /** O modelo mudou (e a trilha registrou); false com o mesmo modelo de novo ou sem campanha ativa. */
  mudou: boolean;
}

/**
 * Grava o modelo (ou NULL) na campanha ativa e lê a lista de todas as células, num db.batch só (uma transação do
 * D1): o registro na trilha, o UPDATE e as três leituras. `autoria.em` é também o `atualizado_em` da campanha.
 */
export async function salvarModeloLinkVendas(
  db: D1Database,
  modelo: string | null,
  autoria: Autoria,
): Promise<ModeloLinkVendasSalvo> {
  const { prefixo, seta, vazio } = RESUMO_MODELO_LINK_VENDAS;
  const resultados = await db.batch([
    db
      .prepare(REGISTRAR_MODELO_LINK_VENDAS)
      .bind(autoria.usuarioId, autoria.em, modelo, ACAO, prefixo, seta, vazio),
    db.prepare(GRAVAR_MODELO_LINK_VENDAS).bind(modelo, autoria.em),
    ...leituras(db, "todas"),
  ]);
  return {
    leitura: daLeitura(resultados),
    mudou: resultados[1].meta.changes > 0,
  };
}
