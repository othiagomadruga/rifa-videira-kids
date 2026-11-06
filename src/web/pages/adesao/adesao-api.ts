// Chamadas à API da tela de adesão: o painel (GET /api/admin/adesao + a fila de órfãos de
// GET /api/admin/afiliados) e o vínculo afiliado → célula (PUT /api/admin/afiliados/:affiliateId).
//
// Do contrato vêm só os tipos: importar ROTAS ou os schemas poria o zod no pacote do site (veja
// lib/api.ts). Os caminhos ficam escritos aqui, e o tipo confere que são os mesmos de ROTAS.
import type { z } from "zod";
import type {
  AfiliadoResumo,
  ROTAS,
  corpoSalvarAfiliadoSchema,
  respostaAdesaoSchema,
  respostaListaAfiliadosSchema,
} from "../../../shared/contracts";
import { api } from "../../lib/api";

export type { AfiliadoResumo };
export type RespostaAdesao = z.infer<typeof respostaAdesaoSchema>;
export type CelulaAdesao = RespostaAdesao["itens"][number];
type RespostaListaAfiliados = z.infer<typeof respostaListaAfiliadosSchema>;
type CorpoSalvarAfiliado = z.input<typeof corpoSalvarAfiliadoSchema>;

const CAMINHO_ADESAO: (typeof ROTAS)["adesao"]["caminho"] = "/api/admin/adesao";
const CAMINHO_AFILIADOS: (typeof ROTAS)["listarAfiliados"]["caminho"] =
  "/api/admin/afiliados";

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
