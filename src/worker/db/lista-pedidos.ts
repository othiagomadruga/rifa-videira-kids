/**
 * Lista de pedidos da coordenação (RIFA-025, D16; docs/api.md, GET /api/admin/pedidos): os pedidos da campanha
 * ativa, do registrado mais novo para o mais antigo (empate pelo id), com a célula EFETIVA (RIFA-088, D41: a do
 * afiliado, resolvida na leitura, D7; sem ela, a atribuída à mão pelo admin) e a origem dela (`celula_origem`), `suspeito` (pedidos_suspeitos, D11), `desconsiderado` (D20), `origem` (D16, RIFA-012), totais por
 * status e cursor opaco. Só lê. Do comprador, o DDD (D1) e, só para o admin, o nome e o telefone (RIFA-076, D36).
 *
 * Desconsiderados (RIFA-028, D20): ficam na lista, com o selo, e fora dos totais (que contam só o que conta). O
 * filtro `desconsiderado=true` sem célula usa o índice parcial da migração 0008
 * (`pedidos_desconsiderados_por_registro`) e lê só os desconsiderados; com `false`, o da 0007, conferindo a coluna
 * na linha. O `+` de `+p.desconsiderado_em IS NULL` tira do planejador o índice parcial da 0003 recriado (com
 * `status=approved`, a consulta satisfaz o WHERE dele, e a página o leria inteiro e ordenaria numa B-tree
 * temporária): hoje ele já escolhe o da 0007 sem o `+` (conferido na -db); o `+` é a garantia, como no mapa.
 *
 * Custo (o D1 cobra por linha lida, D10). Uma ida ao banco: a página e, só na primeira, os totais, no mesmo
 * db.batch (uma transação: os totais batem com a lista). A campanha ativa entra como subconsulta. Cada forma de
 * filtro tem a sua consulta, porque o índice da migração 0007 (`pedidos_por_campanha_registro`) atrai o
 * planejador também onde ele piora a leitura; os desvios abaixo são de propósito e os planos ficam travados
 * por teste (db/pedidos-webhook-desempenho.test.ts):
 * - sem filtro de célula: a página desce pelo índice da 0007 a partir do cursor e para no limite;
 * - por célula (a efetiva, RIFA-088): `affiliate_id IN (afiliados da célula) OR (celula_atribuida_id = célula AND sem
 *   célula pelo afiliado)`, um MULTI-INDEX OR (os afiliados da célula, os pedidos de cada um pelo índice por afiliado,
 *   e os atribuídos pelo índice parcial da 0020) e `+p.campanha_id`; pela campanha, o planejador percorria todos os
 *   pedidos dela (antes da 0020 era `afiliados CROSS JOIN pedidos`, com o mesmo custo);
 * - sem célula: `affiliate_id IS NULL OR affiliate_id IN (afiliados sem célula)`, que vira um MULTI-INDEX OR
 *   sobre o índice por afiliado, e `celula_atribuida_id IS NULL` conferido na linha; o LEFT JOIN com
 *   `a.celula_id IS NULL` percorria a campanha;
 * - pelo id: a chave primária, com os demais filtros conferidos na linha;
 * - totais: `+p.campanha_id`, para o planejador NÃO usar o índice da 0007 (lido por ele, cada pedido custa duas
 *   linhas: o índice e a tabela).
 */
import type {
  ConsultaPedidos,
  ItemPedido,
  MotivoDesconsideracao,
  RespostaPedidos,
  StatusPedido,
} from "../../shared/contracts";
import { STATUS_PEDIDO, instanteSchema } from "../../shared/contracts";
import {
  celulaEfetiva,
  juntarAfiliado,
  juntarCelulaEfetiva,
  origemDaCelula,
  semCelulaDoAfiliado,
} from "./celula-efetiva";

/** Posição na lista: o último item da página anterior. */
export interface CursorPedidos {
  registrado_em: string;
  id: string;
}

/** Filtros da lista (os da consulta, menos a paginação). */
export type FiltrosPedidos = Pick<
  ConsultaPedidos,
  "status" | "celula_id" | "sem_celula" | "id" | "desconsiderado"
>;

/** Um comando SQL montado: o texto (só trechos constantes do código) e os valores, sempre por bind. */
export interface ComandoSql {
  sql: string;
  valores: unknown[];
}

// ---------------------------------------------------------------------------------------------------
// Cursor opaco: base64url (sem "=") do JSON [registrado_em, id]
// ---------------------------------------------------------------------------------------------------

const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** O id do pedido tem de 1 a 128 caracteres (CHECK de pedidos.id; o length do SQLite conta code points). */
const TAMANHO_MAXIMO_ID = 128;

function bytesParaBase64url(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** O `proximo` da resposta. */
export function codificarCursorPedidos(cursor: CursorPedidos): string {
  return bytesParaBase64url(
    new TextEncoder().encode(JSON.stringify([cursor.registrado_em, cursor.id])),
  );
}

/**
 * O cursor recebido em `antes_de`, ou null se não é um cursor que esta API emitiu: base64url, JSON com um
 * instante e um id válidos e, por fim, a mesma forma canônica (codificar de novo dá o mesmo texto).
 */
export function decodificarCursorPedidos(texto: string): CursorPedidos | null {
  if (!BASE64URL.test(texto)) return null;
  let valor: unknown;
  try {
    const binario = atob(texto.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binario, (letra) => letra.charCodeAt(0));
    valor = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    );
  } catch {
    return null;
  }
  if (!Array.isArray(valor) || valor.length !== 2) return null;
  const [registradoEm, id] = valor as unknown[];
  if (
    typeof registradoEm !== "string" ||
    !instanteSchema.safeParse(registradoEm).success ||
    typeof id !== "string" ||
    id.length === 0 ||
    [...id].length > TAMANHO_MAXIMO_ID
  )
    return null;
  const cursor = { registrado_em: registradoEm, id };
  return codificarCursorPedidos(cursor) === texto ? cursor : null;
}

// ---------------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------------

const ID_DA_ATIVA = "(SELECT id FROM campanhas WHERE ativa = 1)";

export const COLUNAS_ITEM = `p.id, p.status, p.qtd_bilhetes, p.total_centavos, p.affiliate_id,
    ${celulaEfetiva()} AS celula_id, c.nome AS celula_nome, ${origemDaCelula()} AS celula_origem, p.ddd, p.criado_em, p.aprovado_em, p.expirado_em, p.registrado_em, p.atualizado_em,
    EXISTS (SELECT 1 FROM pedidos_suspeitos AS s WHERE s.pedido_id = p.id) AS suspeito, p.origem,
    p.desconsiderado_em, p.desconsiderado_motivo, p.desconsiderado_observacao,
    p.comprador_nome, p.comprador_telefone`;

/** O que conta (D20): sem a desconsideração do admin. */
const CONTA = "p.desconsiderado_em IS NULL";

const PEDIDOS_COM_AFILIADO = `pedidos AS p
    ${juntarAfiliado()}`;

/**
 * Sem célula EFETIVA (RIFA-088, D41): sem célula pelo afiliado (sem afiliado ou afiliado não vinculado, D7) e sem
 * atribuição à mão. A atribuição é conferida na linha do pedido, que o MULTI-INDEX OR já lê (nenhuma linha a mais).
 */
const SEM_CELULA = `${semCelulaDoAfiliado()}
    AND p.celula_atribuida_id IS NULL`;

/**
 * Da célula ?n, pela célula EFETIVA (RIFA-088, D41): os pedidos dos afiliados dela OU os atribuídos à mão a ela que não
 * têm célula pelo afiliado. Vira um MULTI-INDEX OR: os afiliados da célula pelo índice `afiliados_por_celula` e os
 * pedidos de cada um pelo índice por afiliado (o caminho de antes), mais os atribuídos pelo índice parcial da 0020
 * (`pedidos_por_celula_atribuida`, poucos).
 */
const daCelula = (
  n: string,
) => `(p.affiliate_id IN (SELECT affiliate_id FROM afiliados WHERE celula_id = ${n})
      OR (p.celula_atribuida_id = ${n} AND ${semCelulaDoAfiliado()}))`;

/** FROM e condições da forma de filtro (célula, sem célula, id), compartilhados pela lista e pelos totais. */
function origem(
  filtros: FiltrosPedidos,
  comCelulas: boolean,
): ComandoSql & {
  condicoes: string[];
} {
  const celulas = comCelulas ? `\n    ${juntarCelulaEfetiva()}` : "";
  const valores: unknown[] = [];
  const valor = (dado: unknown) => {
    valores.push(dado);
    return `?${valores.length}`;
  };
  if (filtros.id !== undefined) {
    const condicoes = [
      `p.id = ${valor(filtros.id)}`,
      `+p.campanha_id = ${ID_DA_ATIVA}`,
    ];
    if (filtros.celula_id !== undefined)
      condicoes.push(`${celulaEfetiva()} = ${valor(filtros.celula_id)}`);
    else if (filtros.sem_celula === true)
      condicoes.push(`${celulaEfetiva()} IS NULL`);
    return {
      sql: `${PEDIDOS_COM_AFILIADO}${celulas}`,
      valores,
      condicoes,
    };
  }
  if (filtros.celula_id !== undefined)
    return {
      sql: `${PEDIDOS_COM_AFILIADO}${celulas}`,
      valores,
      condicoes: [
        `+p.campanha_id = ${ID_DA_ATIVA}`,
        daCelula(valor(filtros.celula_id)),
      ],
    };
  if (filtros.sem_celula === true)
    return {
      sql: `${PEDIDOS_COM_AFILIADO}${celulas}`,
      valores,
      condicoes: [`+p.campanha_id = ${ID_DA_ATIVA}`, SEM_CELULA],
    };
  return {
    sql: `${PEDIDOS_COM_AFILIADO}${celulas}`,
    valores,
    condicoes: [`p.campanha_id = ${ID_DA_ATIVA}`],
  };
}

/**
 * A página: `limite + 1` linhas (a a mais só diz se há próxima), a partir do cursor. A comparação de linha
 * `(registrado_em, id) < (?, ?)` é a mesma ordem do ORDER BY: nenhuma linha se repete nem fica de fora entre
 * as páginas. O filtro `desconsiderado` (D20): `true` repete o WHERE do índice parcial da 0008
 * (`desconsiderado_em IS NOT NULL`); `false` vai com o `+`, conferido na linha (veja o topo do arquivo).
 */
export function comandoListaPedidos(
  filtros: FiltrosPedidos,
  cursor: CursorPedidos | null,
  limite: number,
): ComandoSql {
  const base = origem(filtros, true);
  const valores = [...base.valores];
  const valor = (dado: unknown) => {
    valores.push(dado);
    return `?${valores.length}`;
  };
  const condicoes = [...base.condicoes];
  if (filtros.status !== undefined)
    condicoes.push(`p.status = ${valor(filtros.status)}`);
  if (filtros.desconsiderado === true)
    condicoes.push("p.desconsiderado_em IS NOT NULL");
  else if (filtros.desconsiderado === false) condicoes.push(`+${CONTA}`);
  if (cursor !== null)
    condicoes.push(
      `(p.registrado_em, p.id) < (${valor(cursor.registrado_em)}, ${valor(cursor.id)})`,
    );
  const sql = `SELECT ${COLUNAS_ITEM}
  FROM ${base.sql}
  WHERE ${condicoes.join("\n    AND ")}
  ORDER BY p.registrado_em DESC, p.id DESC
  LIMIT ${valor(limite + 1)}`;
  return { sql, valores };
}

/**
 * Totais por status com os mesmos filtros de célula, sem célula e id (sem os de status e de desconsiderado nem a
 * paginação). Contam só os pedidos que contam (D20): o desconsiderado aparece na lista, mas não nos totais. A coluna
 * está na linha que os totais já leem (nenhuma linha a mais).
 */
export function comandoTotaisPedidos(filtros: FiltrosPedidos): ComandoSql {
  const comAfiliado = filtros.id !== undefined;
  const base = origem(filtros, false);
  // Sem o id, as formas por célula, sem célula e sem filtro não precisam do JOIN do afiliado: as condições delas são
  // na linha do pedido (o afiliado, por subconsulta).
  const de = comAfiliado ? base.sql : "pedidos AS p";
  const sql = `SELECT p.status, count(*) AS pedidos, sum(p.qtd_bilhetes) AS bilhetes,
    sum(p.total_centavos) AS total_centavos
  FROM ${de}
  WHERE ${[...base.condicoes.map(semIndiceDaCampanha), CONTA].join("\n    AND ")}
  GROUP BY p.status`;
  return { sql, valores: base.valores };
}

/** Nos totais, a campanha nunca escolhe o índice (troca `p.campanha_id =` por `+p.campanha_id =`). */
function semIndiceDaCampanha(condicao: string): string {
  return condicao.startsWith("p.campanha_id = ") ? `+${condicao}` : condicao;
}

// ---------------------------------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------------------------------

/** Uma linha de COLUNAS_ITEM, como o D1 devolve. */
export interface LinhaPedido extends Omit<
  ItemPedido,
  "suspeito" | "desconsiderado" | "comprador"
> {
  suspeito: number;
  comprador_nome: string | null;
  comprador_telefone: string | null;
  desconsiderado_em: string | null;
  desconsiderado_motivo: MotivoDesconsideracao | null;
  desconsiderado_observacao: string | null;
}

/**
 * A linha lida (COLUNAS_ITEM) como um item da lista: a desconsideração vira o selo `desconsiderado`. RIFA-076 (D36):
 * `comComprador` (SÓ para a sessão de admin) põe o `comprador`; sem ele, o campo nem existe no item.
 */
export function itemDaLinha(
  linha: LinhaPedido,
  comComprador = false,
): ItemPedido {
  const {
    suspeito,
    desconsiderado_em: em,
    desconsiderado_motivo: motivo,
    desconsiderado_observacao: observacao,
    comprador_nome: nome,
    comprador_telefone: telefone,
    ...resto
  } = linha;
  return {
    ...resto,
    suspeito: suspeito === 1,
    desconsiderado:
      em === null || motivo === null ? null : { motivo, observacao, em },
    ...(comComprador ? { comprador: { nome, telefone } } : {}),
  };
}

interface LinhaTotal {
  status: StatusPedido;
  pedidos: number;
  bilhetes: number;
  total_centavos: number;
}

type Totais = NonNullable<RespostaPedidos["totais"]>;

function totaisZerados(): Totais {
  const zerado = () => ({ pedidos: 0, bilhetes: 0, total_centavos: 0 });
  return { in_process: zerado(), approved: zerado(), expired: zerado() };
}

/**
 * Uma página da lista. `cursor` já decodificado (a rota responde 400 ao cursor inválido); com ele, `totais`
 * sai null (D16: poupa uma leitura do D1 por "carregar mais"). Sem campanha ativa, a subconsulta da campanha dá
 * NULL: lista vazia e totais zerados.
 */
export async function listarPedidos(
  db: D1Database,
  consulta: ConsultaPedidos,
  cursor: CursorPedidos | null,
  /** RIFA-076 (D36): só a sessão de admin recebe o `comprador`. */
  opcoes: { comComprador?: boolean } = {},
): Promise<RespostaPedidos> {
  const lista = comandoListaPedidos(consulta, cursor, consulta.limite);
  const comandos = [db.prepare(lista.sql).bind(...lista.valores)];
  if (cursor === null) {
    const totais = comandoTotaisPedidos(consulta);
    comandos.push(db.prepare(totais.sql).bind(...totais.valores));
  }
  const [linhas, linhasTotais] = await db.batch(comandos);
  const resultados = linhas.results as LinhaPedido[];
  const itens = resultados
    .slice(0, consulta.limite)
    .map((linha) => itemDaLinha(linha, opcoes.comComprador === true));
  const ultimo = itens.at(-1);
  let totais: RespostaPedidos["totais"] = null;
  if (linhasTotais !== undefined) {
    totais = totaisZerados();
    for (const linha of linhasTotais.results as LinhaTotal[])
      if (STATUS_PEDIDO.includes(linha.status))
        totais[linha.status] = {
          pedidos: linha.pedidos,
          bilhetes: linha.bilhetes,
          total_centavos: linha.total_centavos,
        };
  }
  return {
    itens,
    proximo:
      resultados.length > consulta.limite && ultimo !== undefined
        ? codificarCursorPedidos(ultimo)
        : null,
    totais,
  };
}
