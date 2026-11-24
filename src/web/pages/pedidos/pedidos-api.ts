// Chamadas da tela Pedidos (coordenação, RIFA-025; docs/api.md, "Pedidos e entregas do webhook"):
// - GET /api/admin/pedidos: pedidos da campanha ativa, do registrado mais novo para o mais antigo, com os totais
//   por status só na primeira página e o cursor opaco (`antes_de` = o `proximo` da página anterior);
// - GET /api/admin/webhook/entregas: cada entrega do webhook, da mais nova para a mais antiga (cursor numérico);
// - GET /api/admin/celulas: as células da hierarquia, para as opções do filtro de célula;
// - POST /api/admin/pedidos/desconsiderar e .../reconsiderar (só admin, D20): tirar o pedido de todas as contas e
//   desfazer, com a chave `pedidos.desconsiderar` da campanha (GET /api/admin/campanha) ligada.
//
// Do contrato vêm só os TIPOS: os valores de src/shared/contracts poriam o zod no pacote do site (veja
// lib/api.ts). Caminhos, tamanhos de página, status e resultados são cópias, conferidas pelo tipo e por
// pedidos-contrato.test.ts.
import type {
  Campanha,
  Celula,
  CorpoAtribuirCelulaPedido,
  CorpoDesconsiderarPedido,
  ItemPedido,
  MotivoDesconsideracao,
  RespostaAtribuirCelulaPedido,
  RespostaEntregasWebhook,
  RespostaPedidos,
  ResultadoEventoWebhook,
  StatusPedido,
} from "../../../shared/contracts";
import type {
  ROTAS,
  ROTAS_REGRAS_CAMPANHA,
} from "../../../shared/contracts/api";
import { ErroApi, api, baixarArquivo } from "../../lib/api";

export const CAMINHO_PEDIDOS: (typeof ROTAS)["listarPedidos"]["caminho"] =
  "/api/admin/pedidos";
/** RIFA-076 (D36): a planilha de compradores, só admin. */
export const CAMINHO_COMPRADORES: (typeof ROTAS)["exportarCompradores"]["caminho"] =
  "/api/admin/pedidos/compradores";
export const CAMINHO_ENTREGAS: (typeof ROTAS)["entregasWebhook"]["caminho"] =
  "/api/admin/webhook/entregas";
export const CAMINHO_CELULAS: (typeof ROTAS)["listarCelulas"]["caminho"] =
  "/api/admin/celulas";
export const CAMINHO_CAMPANHA: (typeof ROTAS)["obterCampanha"]["caminho"] =
  "/api/admin/campanha";
export const CAMINHO_DESCONSIDERAR: (typeof ROTAS_REGRAS_CAMPANHA)["desconsiderarPedido"]["caminho"] =
  "/api/admin/pedidos/desconsiderar";
export const CAMINHO_RECONSIDERAR: (typeof ROTAS_REGRAS_CAMPANHA)["reconsiderarPedido"]["caminho"] =
  "/api/admin/pedidos/reconsiderar";

/** PAGINA_PEDIDOS_PADRAO do contrato: pedidos por página. */
export const PEDIDOS_POR_PAGINA = 50;
/** PAGINA_ENTREGAS_PADRAO do contrato: entregas por página. */
export const ENTREGAS_POR_PAGINA = 50;

/** STATUS_PEDIDO do contrato, na mesma ordem. */
export const STATUS_PEDIDO = [
  "in_process",
  "approved",
  "expired",
] as const satisfies readonly StatusPedido[];

/** RESULTADOS_EVENTO_WEBHOOK do contrato, na mesma ordem. */
export const RESULTADOS_ENTREGA = [
  "processado",
  "duplicado",
  "ignorado_outra_campanha",
  "ignorado_transicao",
  "erro_validacao",
] as const satisfies readonly ResultadoEventoWebhook[];

/** Tamanho máximo do id do pedido na busca (o `id` de consultaPedidosSchema). */
export const TAMANHO_MAXIMO_ID = 128;

/** MOTIVOS_DESCONSIDERACAO do contrato (regras.ts), na mesma ordem. */
export const MOTIVOS_DESCONSIDERACAO = [
  "teste",
  "fraude",
  "estorno",
  "outro",
] as const satisfies readonly MotivoDesconsideracao[];

/** LIMITE_OBSERVACAO_DESCONSIDERACAO do contrato: caracteres da observação. */
export const LIMITE_OBSERVACAO = 140;

/**
 * `observacaoTemContato` do contrato (regras.ts): um "@" (e-mail) ou 8 dígitos seguidos, depois de tirar espaços,
 * pontos, traços, barras e parênteses (telefone, CPF, cartão). A API recusa com 400; a tela avisa antes.
 */
export function observacaoTemContato(texto: string): boolean {
  return texto.includes("@") || /\d{8}/.test(texto.replace(/[\s.()/-]/g, ""));
}

/** Filtros da lista de pedidos (a célula é uma célula, "só sem célula" ou todas). */
export type FiltrosPedidos = {
  status: StatusPedido | null;
  celula:
    { tipo: "todas" } | { tipo: "sem_celula" } | { tipo: "id"; id: number };
  /** Busca exata pelo id do pedido na Rifei. */
  id: string | null;
  /** D20: true = só os desconsiderados; false = só os que contam; null = todos. */
  desconsiderado: boolean | null;
};

export const SEM_FILTROS: FiltrosPedidos = {
  status: null,
  celula: { tipo: "todas" },
  id: null,
  desconsiderado: null,
};

/** Filtro da lista de entregas. */
export type FiltrosEntregas = { resultado: ResultadoEventoWebhook | null };

const ID_NUMERICO = /^[1-9]\d{0,8}$/;

const ehStatus = (valor: string | null): valor is StatusPedido =>
  (STATUS_PEDIDO as readonly (string | null)[]).includes(valor);

const ehResultado = (valor: string | null): valor is ResultadoEventoWebhook =>
  (RESULTADOS_ENTREGA as readonly (string | null)[]).includes(valor);

/** Texto da busca como a API aceita: sem os espaços das pontas, de 1 a 128 caracteres (senão, sem busca). */
export function idDaBusca(texto: string | null): string | null {
  const id = texto?.trim() ?? "";
  return id.length > 0 && id.length <= TAMANHO_MAXIMO_ID ? id : null;
}

/**
 * Os filtros da URL da tela (`?status=approved&celula_id=3&id=ABC`, `?sem_celula=true`), com os mesmos nomes da
 * consulta da API. O que estiver fora do contrato é ignorado; com `celula_id` e `sem_celula`, vale a célula.
 */
export function filtrosDosPedidos(params: URLSearchParams): FiltrosPedidos {
  const status = params.get("status");
  const celulaId = params.get("celula_id");
  const celula: FiltrosPedidos["celula"] =
    celulaId !== null && ID_NUMERICO.test(celulaId)
      ? { tipo: "id", id: Number(celulaId) }
      : params.get("sem_celula") === "true"
        ? { tipo: "sem_celula" }
        : { tipo: "todas" };
  const desconsiderado = params.get("desconsiderado");
  return {
    status: ehStatus(status) ? status : null,
    celula,
    id: idDaBusca(params.get("id")),
    desconsiderado:
      desconsiderado === "true"
        ? true
        : desconsiderado === "false"
          ? false
          : null,
  };
}

/** O filtro de resultado da URL (`?resultado=erro_validacao`); fora do contrato, nenhum. */
export function filtrosDasEntregas(params: URLSearchParams): FiltrosEntregas {
  const resultado = params.get("resultado");
  return { resultado: ehResultado(resultado) ? resultado : null };
}

/** Os parâmetros dos filtros (os da URL da tela, que são também os da consulta da API), sem os vazios. */
export function paramsDosPedidos(filtros: FiltrosPedidos): [string, string][] {
  const params: [string, string][] = [];
  if (filtros.status) params.push(["status", filtros.status]);
  if (filtros.celula.tipo === "id")
    params.push(["celula_id", String(filtros.celula.id)]);
  if (filtros.celula.tipo === "sem_celula") params.push(["sem_celula", "true"]);
  if (filtros.id) params.push(["id", filtros.id]);
  if (filtros.desconsiderado !== null)
    params.push(["desconsiderado", String(filtros.desconsiderado)]);
  return params;
}

export function paramsDasEntregas(
  filtros: FiltrosEntregas,
): [string, string][] {
  return filtros.resultado ? [["resultado", filtros.resultado]] : [];
}

export const temFiltro = (filtros: FiltrosPedidos) =>
  paramsDosPedidos(filtros).length > 0;

/** Quantos filtros estão escolhidos: o status, a célula (ou "só os sem célula"), os desconsiderados e a busca. */
export const quantosFiltros = (filtros: FiltrosPedidos) =>
  [
    filtros.status !== null,
    filtros.celula.tipo !== "todas",
    filtros.desconsiderado !== null,
    filtros.id !== null,
  ].filter(Boolean).length;

/** "/api/admin/pedidos?limite=50&status=..." e, da segunda página em diante, "&antes_de=<proximo>". */
export function caminhoDosPedidos(
  filtros: FiltrosPedidos,
  antesDe: string | null,
): string {
  const consulta = new URLSearchParams([
    ["limite", String(PEDIDOS_POR_PAGINA)],
    ...paramsDosPedidos(filtros),
  ]);
  if (antesDe !== null) consulta.set("antes_de", antesDe);
  return `${CAMINHO_PEDIDOS}?${consulta.toString()}`;
}

/** "/api/admin/webhook/entregas?limite=50&resultado=..." e, depois, "&antes_de=<id>". */
export function caminhoDasEntregas(
  filtros: FiltrosEntregas,
  antesDe: number | null,
): string {
  const consulta = new URLSearchParams([
    ["limite", String(ENTREGAS_POR_PAGINA)],
    ...paramsDasEntregas(filtros),
  ]);
  if (antesDe !== null) consulta.set("antes_de", String(antesDe));
  return `${CAMINHO_ENTREGAS}?${consulta.toString()}`;
}

type Opcoes = { signal?: AbortSignal };

export function carregarPedidos(
  filtros: FiltrosPedidos,
  antesDe: string | null,
  opcoes: Opcoes = {},
): Promise<RespostaPedidos> {
  return api.get<RespostaPedidos>(caminhoDosPedidos(filtros, antesDe), opcoes);
}

export function carregarEntregas(
  filtros: FiltrosEntregas,
  antesDe: number | null,
  opcoes: Opcoes = {},
): Promise<RespostaEntregasWebhook> {
  return api.get<RespostaEntregasWebhook>(
    caminhoDasEntregas(filtros, antesDe),
    opcoes,
  );
}

/** O que o filtro de célula usa de cada célula (um item de GET /api/admin/celulas traz isso e mais). */
export type CelulaDoFiltro = Pick<
  Celula,
  "id" | "nome" | "rede_id" | "rede_nome"
>;

export async function carregarCelulas(
  opcoes: Opcoes = {},
): Promise<CelulaDoFiltro[]> {
  const { itens } = await api.get<{ itens: CelulaDoFiltro[] }>(
    CAMINHO_CELULAS,
    opcoes,
  );
  return itens;
}

/**
 * A chave `pedidos.desconsiderar` da campanha ativa (D20): ligada, o admin desconsidera e desfaz. Sem campanha
 * (404), vale o padrão: desligada.
 */
export async function carregarDesconsiderarLigado(
  opcoes: Opcoes = {},
): Promise<boolean> {
  try {
    const campanha = await api.get<Campanha>(CAMINHO_CAMPANHA, opcoes);
    return campanha.pedidos?.desconsiderar === true;
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 404) return false;
    throw erro;
  }
}

/** Tira o pedido de todas as contas (só admin, com a chave ligada): 200 com o pedido como a lista mostra. */
export function desconsiderarPedido(
  corpo: CorpoDesconsiderarPedido,
): Promise<ItemPedido> {
  return api.post<ItemPedido>(CAMINHO_DESCONSIDERAR, corpo);
}

/**
 * RIFA-088 (D41): o caminho de PUT /api/admin/pedidos/:id/celula (o id do pedido codificado: é o texto da Rifei).
 */
export function caminhoDaCelulaDoPedido(pedidoId: string): string {
  return `/api/admin/pedidos/${encodeURIComponent(pedidoId)}/celula`;
}

/**
 * RIFA-091: o tempo limite da atribuição. Na venda sem afiliado a API chama a Rifei duas vezes, uma depois da outra (o
 * id da campanha e o link-affiliate), cada uma com até TEMPO_LIMITE_API_RIFEI_MS (10 s, cópia conferida por
 * pedidos-contrato.test.ts). Com o padrão do site (10 s), a Rifei lenta cortava a espera antes da resposta: a tela dizia
 * que não deu com a atribuição já gravada (e o Worker podia ser cancelado no meio da chamada à Rifei).
 */
export const TEMPO_LIMITE_ATRIBUIR_MS = 30_000;

/**
 * RIFA-088 (D41), só admin: atribui à mão a célula do pedido sem célula pelo afiliado (`celulaId`) ou desfaz a
 * atribuição (`null`). 200 com o pedido como a lista mostra (a célula efetiva e `celula_origem`) e o resultado na
 * Rifei (RIFA-091).
 */
export function atribuirCelulaDoPedido(
  pedidoId: string,
  celulaId: number | null,
): Promise<RespostaAtribuirCelulaPedido> {
  return api.put<RespostaAtribuirCelulaPedido>(
    caminhoDaCelulaDoPedido(pedidoId),
    {
      celula_id: celulaId,
    } satisfies CorpoAtribuirCelulaPedido,
    { tempoLimiteMs: TEMPO_LIMITE_ATRIBUIR_MS },
  );
}

/** 409 `pedido_ja_tem_celula`: o afiliado do pedido ganhou célula (a do afiliado vale). */
export function ehPedidoJaTemCelula(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 409 &&
    erro.codigo === "pedido_ja_tem_celula"
  );
}

/** Desfaz: o pedido volta a contar. 200 com o pedido como a lista mostra (`desconsiderado: null`). */
export function reconsiderarPedido(pedidoId: string): Promise<ItemPedido> {
  return api.post<ItemPedido>(CAMINHO_RECONSIDERAR, { pedido_id: pedidoId });
}

/** 409 `acao_desligada`: a chave da campanha foi desligada (ex.: por outra pessoa, com a tela aberta). */
export function ehAcaoDesligada(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 409 &&
    erro.codigo === "acao_desligada"
  );
}

/**
 * Código do detalhe do 400 `requisicao_invalida` quando o cursor dos pedidos não vale mais (docs/api.md). Não está
 * no contrato (é um código de detalhe da rota): por isso a tela aceita também qualquer problema no `antes_de`.
 */
export const CODIGO_CURSOR_INVALIDO = "cursor_invalido";

/**
 * 400 por causa do cursor (`antes_de`): ele não vale mais (ex.: o formato mudou numa publicação). A lista recomeça
 * da primeira página.
 */
export function ehCursorInvalido(erro: unknown): boolean {
  if (!(erro instanceof ErroApi) || erro.status !== 400) return false;
  const detalhes: unknown[] = Array.isArray(erro.detalhes) ? erro.detalhes : [];
  return detalhes.some((detalhe) => {
    if (typeof detalhe !== "object" || detalhe === null) return false;
    const { codigo, caminho } = detalhe as {
      codigo?: unknown;
      caminho?: unknown;
    };
    return (
      codigo === CODIGO_CURSOR_INVALIDO ||
      (Array.isArray(caminho) && caminho[0] === "antes_de")
    );
  });
}

/** 403: a sessão não tem permissão (ex.: o papel mudou com a tela aberta). */
export function ehSemPermissao(erro: unknown): boolean {
  return erro instanceof ErroApi && erro.status === 403;
}

/**
 * RIFA-076 (D36): baixa a planilha de compradores (CSV para o Excel em português), só admin. `soPagou`: só quem pagou
 * ao menos um pedido. Devolve o nome do arquivo.
 */
export function baixarCompradores(
  soPagou: boolean,
  opcoes: { signal?: AbortSignal } = {},
): Promise<string> {
  return baixarArquivo(
    soPagou ? `${CAMINHO_COMPRADORES}?so_pagou=true` : CAMINHO_COMPRADORES,
    { ...opcoes, nomeReserva: "rifa-videira-kids-compradores.csv" },
  );
}
