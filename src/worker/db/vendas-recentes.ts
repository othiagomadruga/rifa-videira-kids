/**
 * Leitura dos avisos de venda (RIFA-094, docs/decisions.md D42; GET /api/publico/vendas-recentes): as vendas pagas
 * que contam dos últimos JANELA_VENDAS_RECENTES_MS, para o ranking aberto e a /minha mostrarem "A célula X vendeu N
 * bilhetes!".
 *
 * - Contam como no painel (db/painel.ts): pedido `approved` da campanha ativa, sem desconsiderar (D20), com a célula
 *   EFETIVA (D41; db/celula-efetiva.ts) e com o dia local da aprovação dentro das datas da campanha. Venda sem célula
 *   (sem afiliado, afiliado não vinculado, sem atribuição) não aparece.
 * - Sai só o nome da célula, os bilhetes e o instante da aprovação, mais a chave opaca `k`: o resumo SHA-256 do id do
 *   pedido com um sal da campanha (o id e o `criado_em` dela, que o público não vê), cortado em
 *   TAMANHO_CHAVE_VENDA_RECENTE caracteres. É estável (a mesma venda, a mesma chave em toda resposta e em todo isolate)
 *   e não deixa chegar ao id: nada do comprador, número de bilhete, valor ou id sai daqui.
 * - Custo (D10): o índice `pedidos_por_status_aprovacao` (status, aprovado_em), da 0001, entrega só os pedidos aprovados
 *   na janela (o INDEXED BY garante o plano; db/vendas-recentes.test.ts trava): poucas linhas lidas por consulta, com
 *   qualquer tamanho de campanha. A rota ainda guarda a resposta por 10 s (lib/cache-publico.ts).
 * - Opção `publico.avisos_de_venda` desligada (ou nenhuma campanha ativa): `ligados: false` e a lista vazia, sem ler
 *   os pedidos (a tela não mostra os avisos nem o botão do som).
 */
import {
  JANELA_VENDAS_RECENTES_MS,
  LIMITE_VENDAS_RECENTES,
  TAMANHO_CHAVE_VENDA_RECENTE,
  calcularCalendario,
  diaLocalDoInstante,
  type RespostaVendasRecentes,
} from "../../shared/contracts";
import { sha256Hex } from "../lib/cripto";
import { buscarCampanhaAtiva, type CampanhaAtiva } from "./campanha";
import { celulaEfetiva, juntarAfiliado } from "./celula-efetiva";

/**
 * As vendas da janela (?2 a ?3, instantes ISO), das mais recentes para as mais antigas, até ?4. O JOIN da célula
 * efetiva tira as vendas sem célula. O índice vem pelo INDEXED BY: sem ele, o planejador poderia escolher o índice
 * parcial da campanha (0020, campanha_id primeiro) e ler todos os pedidos aprovados.
 */
export const SELECIONAR_VENDAS_RECENTES = `
  SELECT p.id AS id, c.nome AS celula, p.qtd_bilhetes AS bilhetes, p.aprovado_em AS em
  FROM pedidos AS p INDEXED BY pedidos_por_status_aprovacao
  ${juntarAfiliado()}
  JOIN celulas AS c ON c.id = ${celulaEfetiva()}
  WHERE p.status = 'approved' AND p.aprovado_em >= ?2 AND p.aprovado_em <= ?3
    AND p.campanha_id = ?1 AND p.desconsiderado_em IS NULL
  ORDER BY p.aprovado_em DESC, p.id DESC
  LIMIT ?4`;

interface LinhaVendaRecente {
  id: string;
  celula: string;
  bilhetes: number;
  em: string;
}

/** A chave opaca de um pedido: SHA-256 do sal da campanha e do id, os primeiros TAMANHO_CHAVE_VENDA_RECENTE hex. */
export async function chaveDaVenda(
  campanha: Pick<CampanhaAtiva, "id" | "criado_em">,
  pedidoId: string,
): Promise<string> {
  const resumo = await sha256Hex(
    `vendas-recentes:${campanha.id}:${campanha.criado_em}:${pedidoId}`,
  );
  return resumo.slice(0, TAMANHO_CHAVE_VENDA_RECENTE);
}

/** As vendas recentes que contam, no formato da resposta (a rota ainda passa pelo schema estrito). */
export async function lerVendasRecentes(
  db: D1Database,
  agora: Date,
): Promise<RespostaVendasRecentes> {
  const vazia: RespostaVendasRecentes = {
    ligados: false,
    itens: [],
    agora: agora.toISOString(),
  };
  const campanha = await buscarCampanhaAtiva(db);
  // Só 0 desliga (uma linha lida sem a coluna, antes da 0021, fica com o padrão: ligada).
  if (!campanha || campanha.publico_avisos_de_venda === 0) return vazia;
  if (campanha.periodos.length === 0) return { ...vazia, ligados: true };
  const { data_fim } = calcularCalendario(
    campanha.data_inicio,
    campanha.periodos,
  );
  const desde = new Date(agora.getTime() - JANELA_VENDAS_RECENTES_MS);
  const { results } = await db
    .prepare(SELECIONAR_VENDAS_RECENTES)
    .bind(
      campanha.id,
      desde.toISOString(),
      agora.toISOString(),
      LIMITE_VENDAS_RECENTES,
    )
    .all<LinhaVendaRecente>();
  // Só as vendas dos dias da campanha contam no ranking (a compra de teste de antes do início não vira aviso).
  const daCampanha = results.filter((linha) => {
    const dia = diaLocalDoInstante(linha.em, campanha.fuso_horario);
    return dia >= campanha.data_inicio && dia <= data_fim;
  });
  return {
    ligados: true,
    itens: await Promise.all(
      daCampanha.map(async (linha) => ({
        k: await chaveDaVenda(campanha, linha.id),
        celula: linha.celula,
        bilhetes: linha.bilhetes,
        em: linha.em,
      })),
    ),
    agora: agora.toISOString(),
  };
}
