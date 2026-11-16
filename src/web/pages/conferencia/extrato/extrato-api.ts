// O que a seção do extrato pede ao sistema (RIFA-059, D26): só LÊ, pelas rotas que já existem, e nunca manda nada do
// extrato (nem no endereço, nem no corpo: as duas são GET sem corpo):
// - GET /api/admin/campanha: o fuso da campanha (as datas do extrato sem fuso são lidas nele);
// - GET /api/admin/pedidos?limite=200[&antes_de=<proximo>]: os pedidos da campanha ativa, de todos os status, do
//   registrado mais novo para o mais antigo, página a página, até passar do primeiro instante que serve ao extrato
//   (o primeiro crédito menos a maior janela). A lista traz o número, o status, a quantidade, o valor, a célula, a
//   reserva (criado_em), a aprovação e a desconsideração: tudo o que o cruzamento usa. Nada falta no contrato.
//
// Do contrato vêm só os TIPOS (os valores poriam o zod no pacote; veja lib/api.ts). O caminho e o tamanho da página
// são cópias, conferidas pelo tipo e por extrato-contrato.test.ts.
import type {
  ItemPedido,
  ROTAS,
  RespostaPedidos,
} from "../../../../shared/contracts";
import { api } from "../../../lib/api";
import type { PedidoDoCruzamento } from "./cruzamento";

export const CAMINHO_PEDIDOS: (typeof ROTAS)["listarPedidos"]["caminho"] =
  "/api/admin/pedidos";
/** PAGINA_PEDIDOS_MAXIMA do contrato: o maior tamanho de página da lista. */
export const PEDIDOS_POR_PAGINA = 200;
/** Teto de páginas por busca (12 mil pedidos): um extrato de um período longo não lê a campanha sem fim. */
export const MAXIMO_PAGINAS = 60;

/** O instante de um campo da lista (ISO com fuso; sem fuso, UTC, como o D1 grava). */
function instante(texto: string): number {
  return Date.parse(
    /[zZ]|[+-]\d{2}:?\d{2}$/.test(texto)
      ? texto
      : `${texto.replace(" ", "T")}Z`,
  );
}

export function pedidoDoCruzamento(item: ItemPedido): PedidoDoCruzamento {
  return {
    id: item.id,
    status: item.status,
    qtd_bilhetes: item.qtd_bilhetes,
    total_centavos: item.total_centavos,
    celula_nome: item.celula_nome,
    reserva: instante(item.criado_em ?? item.registrado_em),
    aprovado_em: item.aprovado_em === null ? null : instante(item.aprovado_em),
    // `desconsiderado` pode faltar numa API antiga (o contrato completa com null).
    desconsiderado: item.desconsiderado != null,
  };
}

export interface PedidosBuscados {
  pedidos: PedidoDoCruzamento[];
  /** A busca parou no teto de páginas antes de chegar ao instante pedido. */
  cortada: boolean;
}

/**
 * Os pedidos da campanha ativa registrados a partir de `desde` (ms), página a página. A lista vem do mais novo para o
 * mais antigo: para quando a página termina antes de `desde`, quando não há mais páginas ou no teto.
 */
export async function buscarPedidosDesde(
  desde: number,
  opcoes: { signal?: AbortSignal } = {},
): Promise<PedidosBuscados> {
  const pedidos: PedidoDoCruzamento[] = [];
  let antesDe: string | null = null;
  for (let pagina = 1; pagina <= MAXIMO_PAGINAS; pagina++) {
    const consulta = new URLSearchParams({
      limite: String(PEDIDOS_POR_PAGINA),
    });
    if (antesDe !== null) consulta.set("antes_de", antesDe);
    const resposta: RespostaPedidos = await api.get<RespostaPedidos>(
      `${CAMINHO_PEDIDOS}?${consulta.toString()}`,
      opcoes,
    );
    pedidos.push(...resposta.itens.map(pedidoDoCruzamento));
    const ultimo = resposta.itens.at(-1);
    if (
      resposta.proximo === null ||
      ultimo === undefined ||
      instante(ultimo.registrado_em) < desde
    )
      return { pedidos, cortada: false };
    antesDe = resposta.proximo;
  }
  return { pedidos, cortada: true };
}
