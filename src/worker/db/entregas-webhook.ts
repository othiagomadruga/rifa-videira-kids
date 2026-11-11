/**
 * Entregas do webhook para a coordenação (RIFA-025, D16; docs/api.md, GET /api/admin/webhook/entregas): cada
 * entrega autenticada (webhook_eventos, D3), da mais nova para a mais antiga, com o resultado, a transição de
 * status e só os CÓDIGOS do erro e dos avisos. Só lê.
 *
 * Nada de dado pessoal (D1): o payload redigido não sai, e o erro e os avisos gravados (DetalheResumido: caminho,
 * código, mensagem, ocorrências) saem reduzidos a campo, código e ocorrências (`reduzirDetalhes`). A mensagem
 * nunca sai; o campo é o caminho do schema, e qualquer parte dele que não tenha a forma de um nome de campo vira
 * "?" (o zod 4 não põe a entrada no caminho, mas a redução não confia nisso).
 *
 * Custo (D10): uma consulta, pelo id (a chave primária) ou, com `resultado`, pelo índice
 * webhook_eventos_por_resultado_id da migração 0007; com `pedido_id`, pelo índice por pedido. A leitura para no
 * limite, sem B-tree temporária (plano travado em db/pedidos-webhook-desempenho.test.ts).
 */
import type {
  ConsultaEntregasWebhook,
  EntregaWebhook,
  RespostaEntregasWebhook,
} from "../../shared/contracts";
import type { ComandoSql } from "./lista-pedidos";

type CodigoDetalhe = EntregaWebhook["avisos"][number];
type CodigoRecusa = NonNullable<EntregaWebhook["erro"]>["codigo"];

/** Recusas que a rota do webhook grava como um único problema de caminho vazio (routes/webhook-rifei.ts). */
const RECUSAS_DO_CORPO: readonly CodigoRecusa[] = [
  "json_invalido",
  "corpo_muito_grande",
];

/** Parte de caminho com a forma de um nome de campo do schema (ex.: buyer, numbers_count). */
const NOME_DE_CAMPO = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Código com a forma do vocabulário do zod e da D11 (ex.: invalid_type, fracao_de_centavo). */
const FORMA_DO_CODIGO = /^[a-z][a-z0-9_]{0,63}$/;
const CODIGO_DESCONHECIDO = "codigo_desconhecido";
const TAMANHO_MAXIMO_CAMPO = 200;

function parteDoCampo(parte: unknown): string {
  if (typeof parte === "number" || parte === "*") return "*";
  if (typeof parte === "string" && /^\d+$/.test(parte)) return "*";
  return typeof parte === "string" && NOME_DE_CAMPO.test(parte) ? parte : "?";
}

function campoDoCaminho(caminho: unknown): string {
  const partes = Array.isArray(caminho) ? caminho.map(parteDoCampo) : [];
  return partes.join(".").slice(0, TAMANHO_MAXIMO_CAMPO);
}

/** A lista gravada (JSON), ou vazia se o JSON é nulo, inválido ou não é uma lista. */
function listaGravada(json: string | null): unknown[] {
  if (json === null) return [];
  try {
    const gravados: unknown = JSON.parse(json);
    return Array.isArray(gravados) ? gravados : [];
  } catch {
    return [];
  }
}

/**
 * Problemas ou avisos gravados (JSON de DetalheResumido[]) reduzidos a { campo, codigo, ocorrencias }: o campo é
 * o caminho juntado com "." e "*" no lugar das posições de lista; itens com o mesmo campo e código somam as
 * ocorrências. A mensagem é descartada. JSON nulo, inválido ou fora do formato dá lista vazia (itens que não são
 * objeto são ignorados).
 */
export function reduzirDetalhes(json: string | null): CodigoDetalhe[] {
  const grupos = new Map<string, CodigoDetalhe>();
  for (const item of listaGravada(json)) {
    if (item === null || typeof item !== "object") continue;
    const { caminho, codigo, ocorrencias } = item as Record<string, unknown>;
    const reduzido: CodigoDetalhe = {
      campo: campoDoCaminho(caminho),
      codigo:
        typeof codigo === "string" && FORMA_DO_CODIGO.test(codigo)
          ? codigo
          : CODIGO_DESCONHECIDO,
      ocorrencias:
        typeof ocorrencias === "number" &&
        Number.isSafeInteger(ocorrencias) &&
        ocorrencias >= 1
          ? ocorrencias
          : 1,
    };
    const chave = JSON.stringify([reduzido.campo, reduzido.codigo]);
    const grupo = grupos.get(chave);
    if (grupo) grupo.ocorrencias += reduzido.ocorrencias;
    else grupos.set(chave, reduzido);
  }
  return [...grupos.values()];
}

/** O código da recusa: json_invalido ou corpo_muito_grande se o erro gravado é esse ÚNICO problema, de caminho vazio. */
function codigoDaRecusa(gravados: unknown[]): CodigoRecusa {
  if (gravados.length !== 1) return "payload_invalido";
  const [unico] = gravados;
  if (unico === null || typeof unico !== "object") return "payload_invalido";
  const { caminho, codigo } = unico as Record<string, unknown>;
  return Array.isArray(caminho) &&
    caminho.length === 0 &&
    RECUSAS_DO_CORPO.includes(codigo as CodigoRecusa)
    ? (codigo as CodigoRecusa)
    : "payload_invalido";
}

/**
 * O erro de uma entrega erro_validacao: o código da recusa e os problemas reduzidos. Se nada sobrar da redução
 * (gravação fora do formato), o problema é o próprio código da recusa, de campo vazio.
 */
export function erroDaEntrega(
  json: string,
): NonNullable<EntregaWebhook["erro"]> {
  const codigo = codigoDaRecusa(listaGravada(json));
  const problemas = reduzirDetalhes(json);
  return {
    codigo,
    problemas:
      problemas.length > 0
        ? problemas
        : [{ campo: "", codigo, ocorrencias: 1 }],
  };
}

/** A página: `limite + 1` linhas (a a mais só diz se há próxima), com o id menor que o cursor. */
export function comandoEntregasWebhook({
  limite,
  antes_de,
  resultado,
  pedido_id,
}: ConsultaEntregasWebhook): ComandoSql {
  const valores: unknown[] = [];
  const valor = (dado: unknown) => {
    valores.push(dado);
    return `?${valores.length}`;
  };
  const condicoes: string[] = [];
  if (resultado !== undefined)
    condicoes.push(`resultado = ${valor(resultado)}`);
  if (pedido_id !== undefined)
    condicoes.push(`pedido_id = ${valor(pedido_id)}`);
  if (antes_de !== undefined) condicoes.push(`id < ${valor(antes_de)}`);
  const onde =
    condicoes.length > 0 ? `\n  WHERE ${condicoes.join(" AND ")}` : "";
  const sql = `SELECT id, recebido_em, evento, pedido_id, slug, resultado, status_anterior, status_resultante,
    erro, avisos
  FROM webhook_eventos${onde}
  ORDER BY id DESC
  LIMIT ${valor(limite + 1)}`;
  return { sql, valores };
}

interface LinhaEntrega extends Omit<EntregaWebhook, "erro" | "avisos"> {
  erro: string | null;
  avisos: string | null;
}

/** Uma página das entregas. `proximo` é o id a passar em `antes_de` na página seguinte. */
export async function listarEntregasWebhook(
  db: D1Database,
  consulta: ConsultaEntregasWebhook,
): Promise<RespostaEntregasWebhook> {
  const comando = comandoEntregasWebhook(consulta);
  const { results } = await db
    .prepare(comando.sql)
    .bind(...comando.valores)
    .all<LinhaEntrega>();
  const itens = results
    .slice(0, consulta.limite)
    .map(({ erro, avisos, ...linha }): EntregaWebhook => ({
      ...linha,
      // O CHECK da tabela: erro existe se e somente se erro_validacao.
      erro:
        linha.resultado === "erro_validacao" && erro !== null
          ? erroDaEntrega(erro)
          : null,
      avisos: reduzirDetalhes(avisos),
    }));
  return {
    itens,
    proximo:
      results.length > consulta.limite ? (itens.at(-1)?.id ?? null) : null,
  };
}
