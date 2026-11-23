/**
 * Bilhetes pagos, reservados e livres (RIFA-075, D35; docs/api.md, "Bilhetes"). Lê os números de `pedidos.numeros`
 * (array JSON do webhook; nulo no pedido recuperado pela conferência) e monta os mapas de bits do contrato
 * (bilhetes.ts).
 *
 * - Pago: pedido `approved`. Reservado: `in_process` com `expira_em` nulo ou depois de agora. Pago vence reservado.
 * - O pedido desconsiderado pelo admin (D20) não conta, como em todo lugar que soma pedidos.
 * - Custo: duas idas ao D1 (a campanha e os pedidos pagos ou reservados, com a coluna `numeros` em texto); o Worker
 *   faz o JSON.parse e liga os bits. 100.000 números em 20.000 pedidos: medido em bilhetes-desempenho.test.ts.
 * - A busca por número percorre os números de todos os pedidos da campanha no próprio D1 (json_each), sem índice:
 *   é uma consulta por clique, não por atualização.
 */
import {
  LIMITE_PEDIDOS_POR_NUMERO,
  contarBits,
  criarMapaDeBits,
  ligarBit,
  mapaParaBase64,
  numeroInicialEfetivo,
  type NumeroInicial,
  type PedidoDoBilhete,
  type RespostaBilhete,
  type RespostaBilhetes,
  type SituacaoPedidoBilhete,
} from "../../shared/contracts";
import { buscarCampanhaAtiva } from "./campanha";
import type { Relogio } from "./painel";
import { juntarAfiliado, juntarCelulaEfetiva } from "./celula-efetiva";

type SemCampanha = { ok: false; codigo: "nao_encontrado"; mensagem: string };
const SEM_CAMPANHA: SemCampanha = {
  ok: false,
  codigo: "nao_encontrado",
  mensagem: "Nenhuma campanha ativa",
};

const PEDIDOS_COM_BILHETES = `
  SELECT status, numeros, qtd_bilhetes
  FROM pedidos
  WHERE campanha_id = ?1 AND desconsiderado_em IS NULL
    AND (status = 'approved' OR (status = 'in_process' AND (expira_em IS NULL OR expira_em > ?2)))`;

interface LinhaPedido {
  status: "approved" | "in_process";
  numeros: string | null;
  qtd_bilhetes: number;
}

/** Os números inteiros e não negativos do JSON gravado (o webhook já confere; o resto é ignorado). */
function numerosDoPedido(texto: string | null): number[] | null {
  if (texto === null) return null;
  let lido: unknown;
  try {
    lido = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!Array.isArray(lido)) return null;
  return lido.filter(
    (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0,
  );
}

/** A grade da campanha ativa, no formato do contrato; sem campanha ativa, 404. */
export async function lerBilhetes(
  db: D1Database,
  relogio: Relogio,
): Promise<{ ok: true; resposta: RespostaBilhetes } | SemCampanha> {
  const agora = relogio();
  const campanha = await buscarCampanhaAtiva(db);
  if (!campanha) return SEM_CAMPANHA;
  const { results } = await db
    .prepare(PEDIDOS_COM_BILHETES)
    .bind(campanha.id, agora.toISOString())
    .all<LinhaPedido>();

  const quantidade = campanha.bilhetes_quantidade;
  const pagosLidos: number[][] = [];
  const reservadosLidos: number[][] = [];
  const semNumeros = { pedidos: 0, bilhetes: 0 };
  let apareceuZero = false;
  for (const linha of results) {
    const numeros = numerosDoPedido(linha.numeros);
    if (numeros === null || numeros.length === 0) {
      if (linha.qtd_bilhetes > 0) {
        semNumeros.pedidos += 1;
        semNumeros.bilhetes += linha.qtd_bilhetes;
      }
      continue;
    }
    if (!apareceuZero && numeros.includes(0)) apareceuZero = true;
    (linha.status === "approved" ? pagosLidos : reservadosLidos).push(numeros);
  }

  const inicial = numeroInicialEfetivo(
    campanha.bilhetes_numero_inicial as NumeroInicial | null,
    apareceuZero,
  );
  const pagos = criarMapaDeBits(quantidade);
  const reservados = criarMapaDeBits(quantidade);
  const fora = new Set<number>();
  const ligar = (mapa: Uint8Array, listas: number[][]) => {
    for (const numeros of listas)
      for (const numero of numeros) {
        const indice = numero - inicial;
        if (indice < 0 || indice >= quantidade) fora.add(numero);
        else ligarBit(mapa, indice);
      }
  };
  ligar(pagos, pagosLidos);
  ligar(reservados, reservadosLidos);
  // Pago vence reservado: tira dos reservados o que está pago.
  for (let i = 0; i < reservados.length; i += 1)
    reservados[i] = (reservados[i] ?? 0) & ~(pagos[i] ?? 0);

  const qtdPagos = contarBits(pagos);
  const qtdReservados = contarBits(reservados);
  return {
    ok: true,
    resposta: {
      quantidade,
      numero_inicial: inicial,
      numero_inicial_automatico: campanha.bilhetes_numero_inicial === null,
      pagos: mapaParaBase64(pagos),
      reservados: mapaParaBase64(reservados),
      contagem: {
        pagos: qtdPagos,
        reservados: qtdReservados,
        livres: quantidade - qtdPagos - qtdReservados,
      },
      vendido_bp: Math.floor((qtdPagos * 10_000) / quantidade),
      sem_numeros: semNumeros,
      fora_da_faixa: fora.size,
      atualizado_em: agora.toISOString(),
    },
  };
}

const PEDIDOS_DO_NUMERO = `
  SELECT p.id, p.status, p.expira_em, p.aprovado_em, p.criado_em, p.registrado_em, p.qtd_bilhetes,
    p.desconsiderado_em, c.nome AS celula
  FROM pedidos AS p
  ${juntarAfiliado()}
  ${juntarCelulaEfetiva()}
  WHERE p.campanha_id = ?1 AND p.numeros IS NOT NULL
    AND EXISTS (SELECT 1 FROM json_each(p.numeros) AS j WHERE j.value = ?2)
  ORDER BY p.registrado_em DESC, p.id DESC
  LIMIT ${LIMITE_PEDIDOS_POR_NUMERO}`;

interface LinhaPedidoDoNumero {
  id: string;
  status: "approved" | "in_process" | "expired";
  expira_em: string | null;
  aprovado_em: string | null;
  criado_em: string | null;
  registrado_em: string;
  qtd_bilhetes: number;
  desconsiderado_em: string | null;
  celula: string | null;
}

function situacaoDoPedido(
  linha: LinhaPedidoDoNumero,
  agora: string,
): SituacaoPedidoBilhete {
  if (linha.status === "approved") return "pago";
  if (
    linha.status === "in_process" &&
    (linha.expira_em === null || linha.expira_em > agora)
  )
    return "reservado";
  return "expirado";
}

/** Os pedidos que têm o número (sem dado do comprador) e a situação dele; sem campanha ativa, 404. */
export async function lerBilhete(
  db: D1Database,
  relogio: Relogio,
  numero: number,
): Promise<{ ok: true; resposta: RespostaBilhete } | SemCampanha> {
  const agora = relogio().toISOString();
  const campanha = await buscarCampanhaAtiva(db);
  if (!campanha) return SEM_CAMPANHA;
  const { results } = await db
    .prepare(PEDIDOS_DO_NUMERO)
    .bind(campanha.id, numero)
    .all<LinhaPedidoDoNumero>();
  const pedidos: PedidoDoBilhete[] = results.map((linha) => {
    const situacao = situacaoDoPedido(linha, agora);
    return {
      id: linha.id,
      situacao,
      celula: linha.celula,
      data:
        (situacao === "pago" ? linha.aprovado_em : null) ??
        linha.criado_em ??
        linha.registrado_em,
      qtd_bilhetes: linha.qtd_bilhetes,
      desconsiderado: linha.desconsiderado_em !== null,
    };
  });
  const contam = pedidos.filter((p) => !p.desconsiderado);
  const situacao = contam.some((p) => p.situacao === "pago")
    ? "pago"
    : contam.some((p) => p.situacao === "reservado")
      ? "reservado"
      : "livre";
  return { ok: true, resposta: { numero, situacao, pedidos } };
}
