// Chamadas do botão "Avisos no celular" (RIFA-095, D43): as três rotas abertas de /api/publico/notificacoes
// (ROTAS_NOTIFICACOES). O componente aparece no ranking aberto e na /minha, sem login: nenhuma rota da coordenação.
// Do contrato, só TIPOS (o ranking aberto não carrega o zod).
import type {
  OrigemInscricaoPush,
  ROTAS_NOTIFICACOES,
  RespostaEstadoNotificacoes,
} from "../../../shared/contracts/notificacoes";
import { api } from "../../lib/api";
import type { InscricaoDoNavegador } from "./navegador";

type Rotas = typeof ROTAS_NOTIFICACOES;

export const CAMINHO_ESTADO_NOTIFICACOES: Rotas["estadoNotificacoes"]["caminho"] =
  "/api/publico/notificacoes";
export const CAMINHO_INSCREVER_NOTIFICACOES: Rotas["inscreverNotificacoes"]["caminho"] =
  "/api/publico/notificacoes/inscrever";
export const CAMINHO_CANCELAR_NOTIFICACOES: Rotas["cancelarNotificacoes"]["caminho"] =
  "/api/publico/notificacoes/cancelar";

export interface ApiNotificacoes {
  estado(): Promise<RespostaEstadoNotificacoes>;
  inscrever(
    inscricao: InscricaoDoNavegador,
    origem: OrigemInscricaoPush,
  ): Promise<void>;
  cancelar(endpoint: string): Promise<void>;
}

export const apiNotificacoes: ApiNotificacoes = {
  estado: () =>
    api.get<RespostaEstadoNotificacoes>(CAMINHO_ESTADO_NOTIFICACOES),
  async inscrever(inscricao, origem) {
    await api.post(CAMINHO_INSCREVER_NOTIFICACOES, {
      endpoint: inscricao.endpoint,
      chaves: { p256dh: inscricao.p256dh, auth: inscricao.auth },
      origem,
    });
  },
  async cancelar(endpoint) {
    await api.post(CAMINHO_CANCELAR_NOTIFICACOES, { endpoint });
  },
};
