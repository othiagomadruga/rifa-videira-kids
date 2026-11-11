// Chamadas à API da tela de adesão: o painel (GET /api/admin/adesao + a fila de órfãos de
// GET /api/admin/afiliados), o vínculo afiliado → célula (PUT /api/admin/afiliados/:affiliateId) e, só para o
// admin, remover um afiliado de teste (DELETE no mesmo caminho; RIFA-031, D20).
//
// Do contrato vêm só os tipos: importar ROTAS ou os schemas poria o zod no pacote do site (veja
// lib/api.ts). Os caminhos ficam escritos aqui, e o tipo confere que são os mesmos de ROTAS.
import type { z } from "zod";
import type {
  AfiliadoResumo,
  ROTAS,
  ROTAS_REGRAS_CAMPANHA,
  corpoSalvarAfiliadoSchema,
  respostaAdesaoSchema,
  respostaListaAfiliadosSchema,
} from "../../../shared/contracts";
import { ErroApi, api } from "../../lib/api";

export type { AfiliadoResumo };
export type RespostaAdesao = z.infer<typeof respostaAdesaoSchema>;
export type CelulaAdesao = RespostaAdesao["itens"][number];
type RespostaListaAfiliados = z.infer<typeof respostaListaAfiliadosSchema>;
type CorpoSalvarAfiliado = z.input<typeof corpoSalvarAfiliadoSchema>;

const CAMINHO_ADESAO: (typeof ROTAS)["adesao"]["caminho"] = "/api/admin/adesao";
export const CAMINHO_AFILIADOS: (typeof ROTAS)["listarAfiliados"]["caminho"] =
  "/api/admin/afiliados";
/** ROTAS_REGRAS_CAMPANHA.removerAfiliado (o `:affiliateId` vai no fim). */
export const CAMINHO_REMOVER_AFILIADO: (typeof ROTAS_REGRAS_CAMPANHA)["removerAfiliado"]["caminho"] =
  "/api/admin/afiliados/:affiliateId";
/** A busca exata pelo id na tela Pedidos (`?id=`), para achar e desconsiderar o pedido que ainda conta. */
export const CAMINHO_TELA_PEDIDOS = "/coordenacao/pedidos";

export type PainelAdesao = {
  adesao: RespostaAdesao;
  /** Afiliados sem célula, o mais recente primeiro (ordem da API). */
  orfaos: AfiliadoResumo[];
  /** Quando os dados chegaram (Date.now()): a base do "há 2 min". */
  obtidoEm: number;
};

export async function carregarPainel(
  opcoes: { signal?: AbortSignal } = {},
): Promise<PainelAdesao> {
  const [adesao, afiliados] = await Promise.all([
    api.get<RespostaAdesao>(CAMINHO_ADESAO, opcoes),
    api.get<RespostaListaAfiliados>(
      `${CAMINHO_AFILIADOS}?vinculado=false`,
      opcoes,
    ),
  ]);
  return { adesao, orfaos: afiliados.itens, obtidoEm: Date.now() };
}

/**
 * Vincula ou troca (`celulaId`) ou desvincula (`null`) a célula do afiliado. Se o código ainda não existe
 * no sistema, a API cria o afiliado (pré-cadastro). Falha vira ErroApi (ex.: `referencia_invalida`).
 */
export function salvarVinculo(
  affiliateId: number,
  celulaId: number | null,
): Promise<AfiliadoResumo> {
  const corpo: CorpoSalvarAfiliado = { celula_id: celulaId };
  return api.put<AfiliadoResumo>(`${CAMINHO_AFILIADOS}/${affiliateId}`, corpo);
}

/**
 * Remove o afiliado de teste (só admin): 204. 409 `afiliado_com_pedidos` se algum pedido dele ainda conta (os
 * detalhes dizem quantos e quais; veja `pedidosQueContam`); 404 se ele não existe mais.
 */
export async function removerAfiliado(affiliateId: number): Promise<void> {
  await api.delete(
    CAMINHO_REMOVER_AFILIADO.replace(":affiliateId", String(affiliateId)),
  );
}

/** Os `detalhes` do 409 `afiliado_com_pedidos`: quantos pedidos do afiliado contam e os ids dos mais recentes. */
export type PedidosQueContam = { quantidade: number; ids: string[] };

/** O 409 `afiliado_com_pedidos`, lido; null se o erro é outro. */
export function pedidosQueContam(erro: unknown): PedidosQueContam | null {
  if (
    !(erro instanceof ErroApi) ||
    erro.status !== 409 ||
    erro.codigo !== "afiliado_com_pedidos"
  )
    return null;
  const detalhes = erro.detalhes as
    { pedidos_que_contam?: unknown; pedidos?: unknown } | null | undefined;
  const ids = Array.isArray(detalhes?.pedidos)
    ? detalhes.pedidos.filter((id): id is string => typeof id === "string")
    : [];
  const quantidade =
    typeof detalhes?.pedidos_que_contam === "number"
      ? detalhes.pedidos_que_contam
      : ids.length;
  return { quantidade: Math.max(quantidade, ids.length), ids };
}

/** O link da tela Pedidos com a busca exata pelo id do pedido. */
export function linkDoPedido(id: string): string {
  return `${CAMINHO_TELA_PEDIDOS}?${new URLSearchParams({ id }).toString()}`;
}
