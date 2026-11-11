// Apoio dos testes da tela Pedidos e do alerta de webhook parado (RIFA-025). A API falsa responde como as rotas da
// D16: pagina os pedidos com cursor opaco (do registrado mais novo para o mais antigo, empate pelo id), manda os
// totais por status só na primeira página, pagina as entregas pelo id e devolve o estado do webhook. Toda consulta
// passa pelo schema da rota e toda resposta pelo schema do contrato. Dados fictícios, sem nenhum dado pessoal.
import { vi } from "vitest";
import {
  consultaEntregasWebhookSchema,
  consultaPedidosSchema,
  respostaEntregasWebhookSchema,
  respostaEstadoWebhookSchema,
  respostaListaCelulasSchema,
  respostaPedidosSchema,
  type Celula,
  type EntregaWebhook,
  type ItemPedido,
  type RespostaEstadoWebhook,
  type RespostaPedidos,
  type StatusPedido,
} from "../../../shared/contracts";
import { respostaJson } from "../../test/renderizar";

export const ROTA_PEDIDOS = "/api/admin/pedidos";
export const ROTA_ENTREGAS = "/api/admin/webhook/entregas";
export const ROTA_ESTADO = "/api/admin/webhook/estado";
export const ROTA_CELULAS = "/api/admin/celulas";

type CelulaFicticia = Pick<Celula, "id" | "nome" | "rede_id" | "rede_nome">;

/** Três células em duas redes (fora de ordem, para conferir a ordenação do filtro). */
export const CELULAS: CelulaFicticia[] = [
  {
    id: 2,
    nome: "Célula Ficticia 10",
    rede_id: 1,
    rede_nome: "Rede Jovem Ficticia",
  },
  {
    id: 1,
    nome: "Célula Ficticia 02",
    rede_id: 1,
    rede_nome: "Rede Jovem Ficticia",
  },
  {
    id: 3,
    nome: "Célula Ficticia 03",
    rede_id: 2,
    rede_nome: "Rede Adulta Ficticia",
  },
];

/** Um item de GET /api/admin/celulas (Celula do contrato), com dados fictícios. */
function celulaDaApi(celula: CelulaFicticia): Celula {
  return {
    ...celula,
    discipulador_id: celula.rede_id,
    discipulador_nome: `Discipulador Ficticio ${celula.rede_id}`,
    qtd_pessoas: 12,
    lider_nome: `Lider Ficticio ${celula.id}`,
    lider_email: null,
    lider_telefone: null,
    divisao: celula.rede_id === 1 ? "jovens" : "adultos",
    criado_em: "2026-11-06T18:00:00.000Z",
    atualizado_em: "2026-11-06T18:00:00.000Z",
  };
}

/** 25/11/2026 às 12:00 em Belém (15:00 UTC). */
export const BASE_MS = Date.UTC(2026, 10, 25, 15, 0);
const instante = (minutos: number) =>
  new Date(BASE_MS + minutos * 60_000).toISOString();

/** Id fictício do pedido n ("PEDFIC0007"). */
export const idDoPedidoFicticio = (n: number) =>
  `PEDFIC${String(n).padStart(4, "0")}`;

/** Pedido fictício: n define a ordem (o maior é o mais novo, 1 minuto entre um e outro). Aprovado na célula 1. */
export function pedido(
  n: number,
  parcial: Partial<ItemPedido> = {},
): ItemPedido {
  const status: StatusPedido = parcial.status ?? "approved";
  const registrado = instante(n);
  return {
    id: idDoPedidoFicticio(n),
    status,
    qtd_bilhetes: 2,
    total_centavos: 4000,
    affiliate_id: 1001,
    celula_id: 1,
    celula_nome: "Célula Ficticia 02",
    ddd: "91",
    criado_em: registrado,
    aprovado_em: status === "approved" ? instante(n + 0.5) : null,
    expirado_em: status === "expired" ? instante(n + 30) : null,
    registrado_em: registrado,
    atualizado_em: registrado,
    suspeito: false,
    ...parcial,
  };
}

const STATUS_EM_CICLO: StatusPedido[] = ["approved", "in_process", "expired"];

/**
 * `quantidade` pedidos, do mais novo (n = quantidade) para o mais antigo (n = 1), com status em ciclo (aprovado,
 * aguardando, expirado), as células 1, 2 e 3 e um sem célula, e bilhetes de 1 a 7.
 */
export function pedidosVariados(quantidade: number): ItemPedido[] {
  return Array.from({ length: quantidade }, (_, i) => {
    const n = quantidade - i;
    const celula = CELULAS[n % 4];
    const bilhetes = (n % 7) + 1;
    return pedido(n, {
      status: STATUS_EM_CICLO[n % 3],
      qtd_bilhetes: bilhetes,
      total_centavos: bilhetes * 2000,
      ...(celula
        ? { celula_id: celula.id, celula_nome: celula.nome }
        : { celula_id: null, celula_nome: null, affiliate_id: 2002 }),
    });
  });
}

/** Entrega fictícia: o id define a ordem (o maior é a mais nova). Pagamento processado, sem erro nem aviso. */
export function entrega(
  id: number,
  parcial: Partial<EntregaWebhook> = {},
): EntregaWebhook {
  return {
    id,
    recebido_em: instante(id),
    evento: "paid_order",
    pedido_id: idDoPedidoFicticio(id),
    slug: "rifa-videira-kids",
    resultado: "processado",
    status_anterior: "in_process",
    status_resultante: "approved",
    erro: null,
    avisos: [],
    ...parcial,
  };
}

/** `quantidade` entregas processadas, da mais nova (id = quantidade) para a mais antiga (id = 1). */
export const entregasEmSequencia = (quantidade: number) =>
  Array.from({ length: quantidade }, (_, i) => entrega(quantidade - i));

/** O estado do webhook numa situação, verificado em 25/11/2026 às 12:00 em Belém, com tudo zerado nas 24 h. */
export function estado(
  situacao: RespostaEstadoWebhook["situacao"],
  parcial: Partial<RespostaEstadoWebhook> = {},
): RespostaEstadoWebhook {
  return respostaEstadoWebhookSchema.parse({
    situacao,
    ultima_entrega_em: null,
    ultima_processada_em: null,
    ultimo_aprovado_em: null,
    ultimas_24h: {
      processado: 0,
      duplicado: 0,
      ignorado_outra_campanha: 0,
      ignorado_transicao: 0,
      erro_validacao: 0,
    },
    verificado_em: instante(0),
    ...parcial,
  });
}

/** Cursor opaco como o da API: o (registrado_em, id) do último item, em base64url. */
function cursorDe(item: ItemPedido): string {
  return btoa(JSON.stringify([item.registrado_em, item.id]))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function lerCursor(cursor: string): [string, string] {
  return JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")));
}

/** Do mais novo para o mais antigo: registrado_em decrescente, empate pelo id decrescente. */
const maisNovoPrimeiro = (a: ItemPedido, b: ItemPedido) =>
  a.registrado_em === b.registrado_em
    ? b.id.localeCompare(a.id)
    : b.registrado_em.localeCompare(a.registrado_em);

const depoisDoCursor = (item: ItemPedido, [em, id]: [string, string]) =>
  item.registrado_em < em || (item.registrado_em === em && item.id < id);

function totaisDe(itens: ItemPedido[]): NonNullable<RespostaPedidos["totais"]> {
  const zero = () => ({ pedidos: 0, bilhetes: 0, total_centavos: 0 });
  const totais = { in_process: zero(), approved: zero(), expired: zero() };
  for (const item of itens) {
    totais[item.status].pedidos += 1;
    totais[item.status].bilhetes += item.qtd_bilhetes;
    totais[item.status].total_centavos += item.total_centavos;
  }
  return totais;
}

type Responder = (url: URL) => Response | Promise<Response>;

export type DadosApi = {
  pedidos?: ItemPedido[];
  entregas?: EntregaWebhook[];
  estado?: RespostaEstadoWebhook;
  celulas?: CelulaFicticia[];
  /** Responde só o estado do webhook e repassa o resto ao fetch que já estava trocado (ex.: a API da Visão geral). */
  repassar?: boolean;
};

export const respostaErro = (
  status: number,
  codigo: string,
  mensagem: string,
) => respostaJson({ erro: { codigo, mensagem } }, status);

/**
 * Troca o fetch pela API falsa. `api.chamadas` guarda cada caminho pedido (com a consulta); `api.proxima(rota, r)`
 * troca a resposta da próxima chamada a essa rota (na ordem em que foram pedidas); `api.dados` pode mudar com a
 * tela aberta (ex.: o estado do webhook entre duas consultas).
 */
export function simularApi(dados: DadosApi = {}) {
  const anterior = globalThis.fetch;
  const especiais = new Map<string, Responder[]>();
  const api = {
    dados: {
      pedidos: [] as ItemPedido[],
      entregas: [] as EntregaWebhook[],
      estado: estado("ok", { ultima_processada_em: instante(-12) }),
      celulas: CELULAS,
      ...dados,
    },
    chamadas: [] as string[],
    proxima(rota: string, responder: Responder) {
      especiais.set(rota, [...(especiais.get(rota) ?? []), responder]);
    },
    /** Os caminhos pedidos a uma rota, com a consulta. */
    pedidosA(rota: string) {
      return this.chamadas.filter(
        (caminho) => caminho === rota || caminho.startsWith(`${rota}?`),
      );
    },
  };

  const fetchSimulado = vi.fn(
    async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), "http://localhost");
      const rota = url.pathname;
      // Com `repassar`, só o estado do webhook é daqui (o resto é da API que já estava trocada).
      const conhecida = dados.repassar
        ? [ROTA_ESTADO]
        : [ROTA_PEDIDOS, ROTA_ENTREGAS, ROTA_ESTADO, ROTA_CELULAS];
      if (!conhecida.includes(rota)) {
        if (dados.repassar) return anterior(entrada, init);
        api.chamadas.push(`${rota}${url.search}`);
        return respostaErro(404, "nao_encontrado", "Rota não encontrada");
      }
      api.chamadas.push(`${rota}${url.search}`);
      const especial = especiais.get(rota)?.shift();
      if (especial) return especial(url);
      const consulta = Object.fromEntries(url.searchParams);
      switch (rota) {
        case ROTA_PEDIDOS:
          return respostaJson(responderPedidos(api.dados.pedidos, consulta));
        case ROTA_ENTREGAS:
          return respostaJson(responderEntregas(api.dados.entregas, consulta));
        case ROTA_ESTADO:
          return respostaJson(
            respostaEstadoWebhookSchema.parse(api.dados.estado),
          );
        default:
          return respostaJson(
            respostaListaCelulasSchema.parse({
              itens: api.dados.celulas.map(celulaDaApi),
            }),
          );
      }
    },
  );
  vi.stubGlobal("fetch", fetchSimulado);
  return api;
}

function responderPedidos(
  todos: ItemPedido[],
  consulta: Record<string, string>,
): RespostaPedidos {
  const { limite, antes_de, status, celula_id, sem_celula, id } =
    consultaPedidosSchema.parse(consulta);
  // Os totais usam os mesmos filtros, menos o status e a paginação.
  const filtrados = [...todos]
    .sort(maisNovoPrimeiro)
    .filter(
      (item) =>
        (celula_id === undefined || item.celula_id === celula_id) &&
        (sem_celula !== true || item.celula_id === null) &&
        (id === undefined || item.id === id),
    );
  const cursor = antes_de === undefined ? null : lerCursor(antes_de);
  const restantes = filtrados.filter(
    (item) =>
      (status === undefined || item.status === status) &&
      (cursor === null || depoisDoCursor(item, cursor)),
  );
  const itens = restantes.slice(0, limite);
  return respostaPedidosSchema.parse({
    itens,
    proximo:
      restantes.length > limite ? cursorDe(itens[itens.length - 1]) : null,
    totais: antes_de === undefined ? totaisDe(filtrados) : null,
  });
}

function responderEntregas(
  todas: EntregaWebhook[],
  consulta: Record<string, string>,
) {
  const { limite, antes_de, resultado, pedido_id } =
    consultaEntregasWebhookSchema.parse(consulta);
  const restantes = [...todas]
    .sort((a, b) => b.id - a.id)
    .filter(
      (item) =>
        (antes_de === undefined || item.id < antes_de) &&
        (resultado === undefined || item.resultado === resultado) &&
        (pedido_id === undefined || item.pedido_id === pedido_id),
    );
  const itens = restantes.slice(0, limite);
  return respostaEntregasWebhookSchema.parse({
    itens,
    proximo: restantes.length > limite ? itens[itens.length - 1].id : null,
  });
}
