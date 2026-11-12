// Apoio dos testes da aba "Webhook da Rifei" (RIFA-039, D21): uma API falsa do token do webhook que segue as regras
// da API de verdade (docs/api.md, "Token do webhook da Rifei"): o GET nunca traz o token; o POST gera um token novo
// (201, a única vez em que ele aparece) e, com uma credencial vigente e sem `substituir: true`, responde 409 `em_uso`
// com a credencial e não muda nada. O token da tela tem prioridade sobre o segredo do Worker. As respostas, os
// detalhes do 409 e os corpos recebidos passam pelos schemas do contrato. O resto (pessoas, campanha) fica com a API
// falsa da tela Acessos (teste-apoio.ts).
import { vi } from "vitest";
import {
  CAMINHOS_WEBHOOK_RIFEI,
  ROTAS_TOKEN_WEBHOOK,
  corpoGerarTokenWebhookSchema,
  credencialVigenteDoWebhook,
  detalhesTokenWebhookEmUsoSchema,
  estadoTokenWebhookSchema,
  respostaGerarTokenWebhookSchema,
  ultimoUsoDoWebhook,
  type EstadoTokenWebhook,
} from "../../../shared/contracts";
import { respostaJson } from "../../test/renderizar";
import { criarApiFalsa, respostaErro, type Chamada } from "./teste-apoio";

export const ROTA_TOKEN = ROTAS_TOKEN_WEBHOOK.obterTokenWebhook.caminho;

/** O que o Worker sabe: o token da tela (quando foi gerado), o segredo e a última entrega autenticada. */
export type Credenciais = {
  geradoEm: string | null;
  segredo: boolean;
  ultimaEntregaEm: string | null;
};

/** As três situações da tela, com o último uso (12/11/2026 10:00 e 10:05 em Belém). */
export const CENARIOS = {
  tela: {
    geradoEm: "2026-11-12T13:00:00.000Z",
    segredo: false,
    ultimaEntregaEm: "2026-11-12T13:05:00.000Z",
  },
  segredo: {
    geradoEm: null,
    segredo: true,
    ultimaEntregaEm: "2026-11-11T22:30:00.000Z",
  },
  nenhum: { geradoEm: null, segredo: false, ultimaEntregaEm: null },
} as const satisfies Record<string, Credenciais>;

/** O token fictício da geração `n` (64 hex minúsculos, como FORMATO_TOKEN_WEBHOOK). */
export function tokenFicticio(n: number): string {
  return (0xabc0de00 + n).toString(16).repeat(8);
}

export function criarApiWebhook(inicial: Credenciais = CENARIOS.nenhum) {
  const acessos = criarApiFalsa();
  const credenciais: Credenciais = { ...inicial };
  /** Todas as chamadas, do token e das outras rotas da tela, na ordem. */
  const chamadas: Chamada[] = [];
  /** Os tokens que o POST devolveu (cada um só na resposta que o criou). */
  const tokens: string[] = [];
  /**
   * As chamadas seguram a resposta até `liberar()` (para conferir o que a tela faz enquanto espera). O GET lê o
   * estado antes de esperar, como a API que leu o banco e demorou a responder.
   */
  const seguradas = new Map<string, Promise<void>>();
  /** Respostas marcadas para a próxima chamada ao token, por método (uma vez só). */
  const marcadas = new Map<string, () => Response>();

  function estado(): EstadoTokenWebhook {
    const vigente = credencialVigenteDoWebhook({
      tokenDaTela: credenciais.geradoEm !== null,
      segredoConfigurado: credenciais.segredo,
    });
    return estadoTokenWebhookSchema.parse({
      vigente,
      gerado_em: credenciais.geradoEm,
      ultimo_uso_em: ultimoUsoDoWebhook(
        vigente,
        credenciais.geradoEm,
        credenciais.ultimaEntregaEm,
      ),
      segredo_configurado: credenciais.segredo,
      url: `${window.location.origin}${CAMINHOS_WEBHOOK_RIFEI[0]}`,
    });
  }

  function gerar(corpo: unknown): Response {
    const lido = corpoGerarTokenWebhookSchema.safeParse(corpo);
    if (!lido.success)
      return respostaErro(400, "requisicao_invalida", "Dados inválidos");
    const vigente = estado().vigente;
    if (vigente && !lido.data.substituir)
      return respostaErro(
        409,
        "em_uso",
        "Já existe uma credencial do webhook valendo",
        detalhesTokenWebhookEmUsoSchema.parse({ vigente }),
      );
    const token = tokenFicticio(tokens.length + 1);
    tokens.push(token);
    // Um minuto depois do token anterior e da última entrega (a primeira geração sai às 10:00 de 12/11/2026 em
    // Belém): nenhuma entrega ainda com o token novo.
    const base = Math.max(
      Date.parse("2026-11-12T12:59:00.000Z"),
      ...[credenciais.geradoEm, credenciais.ultimaEntregaEm].map((instante) =>
        instante === null ? 0 : Date.parse(instante),
      ),
    );
    credenciais.geradoEm = new Date(base + 60_000).toISOString();
    return respostaJson(
      respostaGerarTokenWebhookSchema.parse({ token, estado: estado() }),
      201,
    );
  }

  const fetchFalso = vi.fn(
    async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      const chamada: Chamada = {
        metodo: init?.method ?? "GET",
        caminho: url.pathname,
        corpo:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      chamadas.push(chamada);
      if (chamada.caminho !== ROTA_TOKEN) return acessos.fetch(entrada, init);
      const marcada = marcadas.get(chamada.metodo);
      if (marcada) {
        marcadas.delete(chamada.metodo);
        return marcada();
      }
      if (chamada.metodo === "GET") {
        const lido = estado();
        await seguradas.get("GET");
        return respostaJson(lido);
      }
      if (chamada.metodo === "POST") {
        await seguradas.get("POST");
        return gerar(chamada.corpo);
      }
      return respostaErro(404, "nao_encontrado", "Rota não encontrada");
    },
  );

  return {
    fetch: fetchFalso,
    credenciais,
    chamadas,
    tokens,
    chamadasAoToken(metodo?: string) {
      return chamadas.filter(
        (chamada) =>
          chamada.caminho === ROTA_TOKEN &&
          (metodo === undefined || chamada.metodo === metodo),
      );
    },
    /** A próxima chamada ao token com este método recebe esta resposta (ou lança o erro: sem conexão). */
    proxima(metodo: "GET" | "POST", resposta: Response | Error) {
      marcadas.set(metodo, () => {
        if (resposta instanceof Error) throw resposta;
        return resposta;
      });
    },
    /** As chamadas ao token com este método esperam até `liberar()`; devolve a função que libera. */
    segurar(metodo: "GET" | "POST" = "POST"): () => void {
      let liberar = () => {};
      seguradas.set(
        metodo,
        new Promise<void>((resolver) => {
          liberar = () => {
            seguradas.delete(metodo);
            resolver();
          };
        }),
      );
      return () => liberar();
    },
  };
}

export type ApiWebhook = ReturnType<typeof criarApiWebhook>;
