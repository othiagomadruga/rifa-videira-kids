/**
 * Cliente da API interna do painel da Rifei (RIFA-070; docs/decisions.md D29; docs/integracao-rifei.md, seção 13).
 *
 * As chamadas são as mesmas que o painel (app.rifei.com.br) faz, mapeadas do código dele em 17/11/2026: base
 * `https://api.rifei.com.br/`, `Authorization: Bearer <token do login>` e `x-rate-limit: true`. A API não é
 * documentada e pode mudar sem aviso: tudo que vem dela é conferido (zod tolerante) e qualquer forma desconhecida vira
 * `resposta_inesperada`, nunca um 500.
 *
 * - O token nunca vai para log, resposta, banco ou trilha.
 * - 401/403 da Rifei = token recusado (o login expirou ou alguém clicou em "Sair" com ele): para tudo.
 * - 429, 5xx, rede ou tempo esgotado = `indisponivel`.
 * - As mensagens de erro da Rifei (`message`) são repassadas cortadas em LIMITE_MENSAGEM_RIFEI: são textos da Rifei
 *   sobre o pedido ("Pedido não encontrado"), não dados do comprador.
 */
import { z } from "zod";
import {
  CONVITE_AFILIADO_RIFEI,
  LIMITE_MENSAGEM_RIFEI,
  TEMPO_LIMITE_API_RIFEI_MS,
  URL_API_RIFEI,
  type MotivoFalhaRifei,
} from "../../shared/contracts";

/** A chamada inteira à Rifei falhou: a rota responde 502 `rifei_falhou` com o motivo. */
export class FalhaRifei extends Error {
  readonly motivo: MotivoFalhaRifei;
  constructor(motivo: MotivoFalhaRifei) {
    super(`Falha na API da Rifei: ${motivo}`);
    this.name = "FalhaRifei";
    this.motivo = motivo;
  }
}

/** Uma resposta da Rifei que não é 401/403/429/5xx: o status e o corpo (JSON ou null). */
export interface RespostaRifei {
  status: number;
  corpo: unknown;
}

const ok = (status: number) => status >= 200 && status < 300;

/** A mensagem da Rifei num corpo de erro (`message`, ou a primeira de `errors[]`), cortada; null sem mensagem. */
export function mensagemDaRifei(corpo: unknown): string | null {
  const candidatos: unknown[] = [];
  if (corpo && typeof corpo === "object") {
    const objeto = corpo as Record<string, unknown>;
    candidatos.push(objeto.message, objeto.mensagem, objeto.error);
    if (Array.isArray(objeto.errors))
      for (const erro of objeto.errors)
        if (erro && typeof erro === "object")
          candidatos.push((erro as Record<string, unknown>).message);
  }
  const texto = candidatos.find(
    (item): item is string => typeof item === "string" && item.trim() !== "",
  );
  if (texto === undefined) return null;
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length <= LIMITE_MENSAGEM_RIFEI
    ? limpo
    : `${limpo.slice(0, LIMITE_MENSAGEM_RIFEI - 1)}…`;
}

/** A campanha na Rifei (`GET raffles/<slug>`): o id interno e a versão (a v2 muda alguns caminhos). */
const campanhaRifeiSchema = z.looseObject({
  id: z.union([z.number().int().positive(), z.string().min(1)]),
  version: z.number().int().nullish(),
});
export interface CampanhaRifei {
  id: string;
  version: number;
}

/** Um afiliado da conta (`GET my-affiliates`), como o painel lê. */
const afiliadoDaContaSchema = z.looseObject({
  affiliate_id: z.number().int().positive(),
  code: z.string().nullish(),
  affiliate: z
    .looseObject({
      name: z.string().nullish(),
      email: z.string().nullish(),
    })
    .nullish(),
});
export interface AfiliadoDaConta {
  affiliate_id: number;
  codigo: string | null;
  nome: string | null;
  email: string | null;
}

/** O status de um pedido no corpo de `GET raffles/<id>/orders/<pedido>` (no objeto ou em `order`). */
function statusDoPedido(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== "object") return null;
  const objeto = corpo as Record<string, unknown>;
  if (typeof objeto.status === "string") return objeto.status;
  const pedido = objeto.order;
  if (pedido && typeof pedido === "object") {
    const status = (pedido as Record<string, unknown>).status;
    if (typeof status === "string") return status;
  }
  return null;
}

/** Os status da Rifei que querem dizer "pago". */
const STATUS_PAGO_NA_RIFEI = new Set(["approved", "paid"]);

/** O que aconteceu ao aprovar um pedido na Rifei. */
export type AprovacaoNaRifei =
  | { tipo: "aprovado" }
  | { tipo: "nao_encontrado" }
  | { tipo: "recusado"; mensagem: string | null };

export interface OpcoesClienteRifei {
  /** O fetch usado (os testes trocam). Padrão: o global. */
  fetch?: typeof fetch;
  tempoLimiteMs?: number;
}

export function criarClienteRifei(
  token: string,
  opcoes: OpcoesClienteRifei = {},
) {
  const buscar =
    opcoes.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const tempoLimiteMs = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_API_RIFEI_MS;

  async function chamar(
    metodo: "GET" | "POST" | "PUT",
    caminho: string,
    corpo?: unknown,
  ): Promise<RespostaRifei> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.trim()}`,
      Accept: "application/json",
      "x-rate-limit": "true",
    };
    if (corpo !== undefined) headers["Content-Type"] = "application/json";
    let resposta: Response;
    try {
      resposta = await buscar(new URL(caminho, URL_API_RIFEI).href, {
        method: metodo,
        headers,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(tempoLimiteMs),
      });
    } catch {
      // Rede, DNS ou tempo esgotado. O erro original pode trazer a URL; não vai para o log.
      throw new FalhaRifei("indisponivel");
    }
    if (resposta.status === 401 || resposta.status === 403)
      throw new FalhaRifei("token_invalido");
    if (resposta.status === 429 || resposta.status >= 500)
      throw new FalhaRifei("indisponivel");
    let lido: unknown;
    try {
      const texto = await resposta.text();
      lido = texto.trim() === "" ? null : (JSON.parse(texto) as unknown);
    } catch {
      lido = null;
    }
    return { status: resposta.status, corpo: lido };
  }

  return {
    /** A campanha pelo slug. 404: `campanha_nao_encontrada`; outro formato: `resposta_inesperada`. */
    async buscarCampanha(slug: string): Promise<CampanhaRifei> {
      const { status, corpo } = await chamar(
        "GET",
        `raffles/${encodeURIComponent(slug)}`,
      );
      if (status === 404) throw new FalhaRifei("campanha_nao_encontrada");
      const lida = campanhaRifeiSchema.safeParse(corpo);
      if (!ok(status) || !lida.success)
        throw new FalhaRifei("resposta_inesperada");
      return { id: String(lida.data.id), version: lida.data.version ?? 1 };
    },

    /**
     * Aprova um pedido (`PUT raffles/orders/many { orders: [id] }`, o "Aprovar" em lote do painel, que só aprova e nunca
     * desaprova; o PUT de um pedido só ALTERNA aprovar/desaprovar e não é usado). Um pedido por chamada, para saber o
     * resultado de cada um.
     */
    async aprovarPedido(pedidoId: string): Promise<AprovacaoNaRifei> {
      const { status, corpo } = await chamar("PUT", "raffles/orders/many", {
        orders: [pedidoId],
      });
      if (ok(status)) return { tipo: "aprovado" };
      if (status === 404) return { tipo: "nao_encontrado" };
      return { tipo: "recusado", mensagem: mensagemDaRifei(corpo) };
    },

    /**
     * O status do pedido na Rifei depois de aprovar: "pago", "nao_encontrado" (não está na lista de pedidos: expirou?),
     * o status que a Rifei deu, ou null se a resposta não traz o status.
     */
    async conferirPedido(
      campanha: CampanhaRifei,
      pedidoId: string,
    ): Promise<"pago" | "nao_encontrado" | string | null> {
      const { status, corpo } = await chamar(
        "GET",
        `raffles/${encodeURIComponent(campanha.id)}/orders/${encodeURIComponent(pedidoId)}`,
      );
      if (status === 404) return "nao_encontrado";
      if (!ok(status)) return null;
      const lido = statusDoPedido(corpo);
      if (lido === null) return null;
      return STATUS_PAGO_NA_RIFEI.has(lido) ? "pago" : lido;
    },

    /** Restaura um pedido expirado (o "Restaurar" de Pedidos expirados do painel; v2 tem o prefixo `v2/`). */
    async restaurarExpirado(
      campanha: CampanhaRifei,
      pedidoId: string,
    ): Promise<{ restaurado: boolean; mensagem: string | null }> {
      const prefixo = campanha.version === 2 ? "v2/" : "";
      const { status, corpo } = await chamar(
        "PUT",
        `${prefixo}raffles/expired-orders/${encodeURIComponent(pedidoId)}/restore`,
      );
      return { restaurado: ok(status), mensagem: mensagemDaRifei(corpo) };
    },

    /** Os afiliados da conta. Fora do formato: `resposta_inesperada`. */
    async listarAfiliados(): Promise<AfiliadoDaConta[]> {
      const { status, corpo } = await chamar("GET", "my-affiliates");
      const lidos = z.array(afiliadoDaContaSchema).safeParse(corpo);
      if (!ok(status) || !lidos.success)
        throw new FalhaRifei("resposta_inesperada");
      const texto = (valor: string | null | undefined) =>
        typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
      return lidos.data.map((afiliado) => ({
        affiliate_id: afiliado.affiliate_id,
        codigo: texto(afiliado.code)?.slice(0, 120) ?? null,
        nome: texto(afiliado.affiliate?.name)?.slice(0, 200) ?? null,
        email: texto(afiliado.affiliate?.email)?.slice(0, 320) ?? null,
      }));
    },

    /**
     * Gera um convite de afiliado (`POST affiliates`, o "Convidar" do painel): o link de uso único que vale 1 dia.
     * Sem link na resposta: recusado, com a mensagem da Rifei.
     */
    async criarConvite(): Promise<
      { link: string } | { link: null; mensagem: string | null }
    > {
      const { status, corpo } = await chamar(
        "POST",
        "affiliates",
        CONVITE_AFILIADO_RIFEI,
      );
      const link =
        corpo && typeof corpo === "object"
          ? (corpo as Record<string, unknown>).link
          : undefined;
      if (ok(status) && typeof link === "string" && link.trim() !== "")
        return { link: link.trim() };
      return { link: null, mensagem: mensagemDaRifei(corpo) };
    },
  };
}

export type ClienteRifei = ReturnType<typeof criarClienteRifei>;

/** Roda `tarefa` em cada item com no máximo `paralelas` ao mesmo tempo, mantendo a ordem dos resultados. */
export async function emLotes<T, R>(
  itens: readonly T[],
  paralelas: number,
  tarefa: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let proximo = 0;
  async function trabalhar() {
    while (proximo < itens.length) {
      const indice = proximo++;
      resultados[indice] = await tarefa(itens[indice]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(paralelas, itens.length) }, trabalhar),
  );
  return resultados;
}

/** O resultado de um pedido mandado à Rifei (os outros resultados são decididos antes, pelo banco). */
export interface PedidoMarcadoNaRifei {
  resultado:
    "marcado" | "restaurado_e_marcado" | "recusado_pela_rifei" | "falhou";
  mensagem: string | null;
}

const MENSAGEM_NAO_RESTAURADO =
  "O pedido não está entre os reservados na Rifei e não foi restaurado: restaure e aprove no painel da Rifei.";
const MENSAGEM_FALHOU =
  "A Rifei não respondeu para este pedido: tente de novo ou marque no painel da Rifei.";

/** A orientação do sistema e, se houver, a mensagem da Rifei entre parênteses, no limite da resposta. */
function comMensagemDaRifei(
  orientacao: string,
  daRifei: string | null,
): string {
  if (daRifei === null) return orientacao;
  const texto = `${orientacao} (Rifei: ${daRifei})`;
  return texto.length <= LIMITE_MENSAGEM_RIFEI
    ? texto
    : `${texto.slice(0, LIMITE_MENSAGEM_RIFEI - 1)}…`;
}

/** O status que a Rifei deixou no pedido, para a mensagem (curto; é o código do status, não dado do comprador). */
const statusNaMensagem = (status: string) =>
  `A Rifei manteve o pedido como "${status.slice(0, 40)}": confira no painel da Rifei.`;

/**
 * Marca um pedido como pago na Rifei:
 * 1. aprova (`PUT raffles/orders/many`) e confere o status (`GET raffles/<id>/orders/<pedido>`);
 * 2. se a Rifei não acha o pedido entre os reservados (expirou: no painel v1 ele vai para "Pedidos expirados"),
 *    restaura (`PUT raffles/expired-orders/<pedido>/restore`), aprova e confere de novo.
 * A conferência que não traz o status (formato desconhecido) aceita a aprovação: o webhook confirma depois.
 * `indisponivel` vira `falhou` só neste pedido; `token_invalido` e o resto param tudo (a rota responde 502).
 */
export async function marcarPedidoNaRifei(
  cliente: ClienteRifei,
  campanha: CampanhaRifei,
  pedidoId: string,
): Promise<PedidoMarcadoNaRifei> {
  const recusado = (mensagem: string | null): PedidoMarcadoNaRifei => ({
    resultado: "recusado_pela_rifei",
    mensagem,
  });

  async function restaurarEAprovar(): Promise<PedidoMarcadoNaRifei> {
    const restauracao = await cliente.restaurarExpirado(campanha, pedidoId);
    if (!restauracao.restaurado)
      return recusado(
        comMensagemDaRifei(MENSAGEM_NAO_RESTAURADO, restauracao.mensagem),
      );
    const aprovacao = await cliente.aprovarPedido(pedidoId);
    if (aprovacao.tipo !== "aprovado")
      return recusado(
        aprovacao.tipo === "recusado"
          ? (aprovacao.mensagem ?? MENSAGEM_NAO_RESTAURADO)
          : MENSAGEM_NAO_RESTAURADO,
      );
    const conferido = await cliente.conferirPedido(campanha, pedidoId);
    if (conferido === "pago" || conferido === null)
      return { resultado: "restaurado_e_marcado", mensagem: null };
    return recusado(
      conferido === "nao_encontrado"
        ? MENSAGEM_NAO_RESTAURADO
        : statusNaMensagem(conferido),
    );
  }

  try {
    const aprovacao = await cliente.aprovarPedido(pedidoId);
    if (aprovacao.tipo === "recusado") return recusado(aprovacao.mensagem);
    if (aprovacao.tipo === "nao_encontrado") return await restaurarEAprovar();
    const conferido = await cliente.conferirPedido(campanha, pedidoId);
    if (conferido === "pago" || conferido === null)
      return { resultado: "marcado", mensagem: null };
    if (conferido === "nao_encontrado") return await restaurarEAprovar();
    return recusado(statusNaMensagem(conferido));
  } catch (erro) {
    if (erro instanceof FalhaRifei && erro.motivo === "indisponivel")
      return { resultado: "falhou", mensagem: MENSAGEM_FALHOU };
    throw erro;
  }
}
