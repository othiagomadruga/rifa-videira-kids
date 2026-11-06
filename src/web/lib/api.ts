// Cliente HTTP da API: só mesma origem, JSON nos dois sentidos e tempo limite.
// Toda falha vira ErroApi. Quando a API responde no formato de erro combinado,
//   { "erro": { "codigo": string, "mensagem": string, "detalhes"?: unknown } },
// o ErroApi traz esse código e essa mensagem; nos demais casos, um dos
// CODIGOS_CLIENTE com uma mensagem que pode ser mostrada ao usuário.
// Toda resposta 401 também avisa quem se inscreveu em aoReceber401 (a sessão).

// Corpo de erro padrão: o tipo vem do contrato. Só o tipo: o schema poria o zod
// no pacote do site (+24 kB gzip); lerCorpoErro confere o formato à mão.
import type { ErroApi as CorpoErroApi } from "../../shared/contracts/erros";

/** Códigos gerados pelo próprio cliente (sem resposta ou resposta fora do padrão). */
export const CODIGOS_CLIENTE = {
  semConexao: "SEM_CONEXAO",
  tempoEsgotado: "TEMPO_ESGOTADO",
  cancelada: "CANCELADA",
  respostaInvalida: "RESPOSTA_INVALIDA",
  erroHttp: "ERRO_HTTP",
} as const;

export const TEMPO_LIMITE_PADRAO_MS = 10_000;

type DadosErroApi = {
  codigo: string;
  mensagem: string;
  status?: number | null;
  detalhes?: unknown;
  causa?: unknown;
};

export class ErroApi extends Error {
  /** Código do erro: o que a API mandou ou um dos CODIGOS_CLIENTE. */
  readonly codigo: string;
  /** Mensagem para o usuário (o mesmo texto de `message`). */
  readonly mensagem: string;
  /** Status HTTP; null quando não houve resposta (sem conexão, tempo esgotado, cancelada). */
  readonly status: number | null;
  /** `detalhes` do corpo de erro da API, quando houver. */
  readonly detalhes: unknown;

  constructor(dados: DadosErroApi) {
    super(
      dados.mensagem,
      dados.causa === undefined ? undefined : { cause: dados.causa },
    );
    this.name = "ErroApi";
    this.codigo = dados.codigo;
    this.mensagem = dados.mensagem;
    this.status = dados.status ?? null;
    this.detalhes = dados.detalhes;
  }
}

export type MetodoHttp = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type OpcoesRequisicao = {
  metodo?: MetodoHttp;
  /** Corpo da requisição, enviado como JSON. */
  corpo?: unknown;
  /** Tempo limite em milissegundos (padrão: TEMPO_LIMITE_PADRAO_MS). */
  tempoLimiteMs?: number;
  /** Para cancelar (ex.: ao sair da tela). O cancelamento vira ErroApi CANCELADA. */
  signal?: AbortSignal;
};

type OpcoesSemCorpo = Omit<OpcoesRequisicao, "metodo" | "corpo">;

/** Recebe o caminho pedido (ex.: "/api/admin/campanha") de uma resposta 401. */
export type Ouvinte401 = (caminho: string) => void;

const ouvintes401 = new Set<Ouvinte401>();

/**
 * Gancho de 401 (sem sessão ou sessão vencida): `ouvinte` é chamado a cada resposta 401 da API, com o
 * caminho pedido, logo antes de a chamada falhar com o ErroApi. Devolve a função que desliga o gancho.
 * Quem usa: o provedor da sessão (lib/sessao.tsx), que leva a coordenação para /entrar.
 */
export function aoReceber401(ouvinte: Ouvinte401): () => void {
  ouvintes401.add(ouvinte);
  return () => {
    ouvintes401.delete(ouvinte);
  };
}

/**
 * Faz a requisição e devolve o JSON da resposta (undefined se vier sem corpo).
 * O tipo T não é validado em tempo de execução.
 */
export async function requisitarJson<T = unknown>(
  caminho: string,
  opcoes: OpcoesRequisicao = {},
): Promise<T> {
  garantirMesmaOrigem(caminho);
  const {
    metodo = "GET",
    corpo,
    tempoLimiteMs = TEMPO_LIMITE_PADRAO_MS,
    signal,
  } = opcoes;
  if (signal?.aborted) {
    throw erroSemResposta(signal.reason, false, signal);
  }

  const controle = new AbortController();
  let tempoEsgotado = false;
  const temporizador = setTimeout(() => {
    tempoEsgotado = true;
    controle.abort();
  }, tempoLimiteMs);
  const cancelar = () => controle.abort();
  signal?.addEventListener("abort", cancelar, { once: true });

  const headers: Record<string, string> = { accept: "application/json" };
  if (corpo !== undefined) headers["content-type"] = "application/json";

  let resposta: Response;
  let texto: string;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      credentials: "same-origin",
      signal: controle.signal,
    });
    texto = await resposta.text();
  } catch (causa) {
    throw erroSemResposta(causa, tempoEsgotado, signal);
  } finally {
    clearTimeout(temporizador);
    signal?.removeEventListener("abort", cancelar);
  }

  const json = lerJson(texto);
  if (!resposta.ok) {
    if (resposta.status === 401) {
      for (const ouvinte of [...ouvintes401]) ouvinte(caminho);
    }
    const erroPadrao = json.valido ? lerCorpoErro(json.valor) : null;
    throw new ErroApi(
      erroPadrao
        ? { ...erroPadrao, status: resposta.status }
        : {
            codigo: CODIGOS_CLIENTE.erroHttp,
            mensagem: `A API respondeu com falha (HTTP ${resposta.status}).`,
            status: resposta.status,
          },
    );
  }
  if (!json.valido) {
    throw new ErroApi({
      codigo: CODIGOS_CLIENTE.respostaInvalida,
      mensagem: "A API respondeu em um formato inesperado.",
      status: resposta.status,
    });
  }
  return json.valor as T;
}

/** Atalhos por método: api.get("/api/..."), api.post("/api/...", corpo)... */
export const api = {
  get: <T = unknown>(caminho: string, opcoes?: OpcoesSemCorpo) =>
    requisitarJson<T>(caminho, { ...opcoes, metodo: "GET" }),
  post: <T = unknown>(
    caminho: string,
    corpo?: unknown,
    opcoes?: OpcoesSemCorpo,
  ) => requisitarJson<T>(caminho, { ...opcoes, metodo: "POST", corpo }),
  put: <T = unknown>(
    caminho: string,
    corpo?: unknown,
    opcoes?: OpcoesSemCorpo,
  ) => requisitarJson<T>(caminho, { ...opcoes, metodo: "PUT", corpo }),
  patch: <T = unknown>(
    caminho: string,
    corpo?: unknown,
    opcoes?: OpcoesSemCorpo,
  ) => requisitarJson<T>(caminho, { ...opcoes, metodo: "PATCH", corpo }),
  delete: <T = unknown>(caminho: string, opcoes?: OpcoesSemCorpo) =>
    requisitarJson<T>(caminho, { ...opcoes, metodo: "DELETE" }),
};

/** Texto para mostrar ao usuário a partir de qualquer erro capturado. */
export function mensagemDoErro(erro: unknown): string {
  return erro instanceof ErroApi
    ? erro.mensagem
    : "Ocorreu um erro inesperado. Tente de novo.";
}

// Aceita só caminhos absolutos da própria origem ("/api/..."). Barra dupla,
// barra invertida e URLs completas de outro host são recusadas.
function garantirMesmaOrigem(caminho: string): void {
  const origem = window.location.origin;
  if (!caminho.startsWith("/") || new URL(caminho, origem).origin !== origem) {
    throw new TypeError(
      `O cliente da API só aceita caminhos da mesma origem, como "/api/...". Recebeu: "${caminho}".`,
    );
  }
}

function erroSemResposta(
  causa: unknown,
  tempoEsgotado: boolean,
  signal: AbortSignal | undefined,
): ErroApi {
  if (tempoEsgotado) {
    return new ErroApi({
      codigo: CODIGOS_CLIENTE.tempoEsgotado,
      mensagem: "A API demorou demais para responder. Tente de novo.",
      causa,
    });
  }
  if (signal?.aborted) {
    return new ErroApi({
      codigo: CODIGOS_CLIENTE.cancelada,
      mensagem: "A requisição foi cancelada.",
      causa,
    });
  }
  return new ErroApi({
    codigo: CODIGOS_CLIENTE.semConexao,
    mensagem: "Não foi possível conectar à API.",
    causa,
  });
}

type ResultadoJson = { valido: true; valor: unknown } | { valido: false };

function lerJson(texto: string): ResultadoJson {
  if (texto.trim() === "") return { valido: true, valor: undefined };
  try {
    return { valido: true, valor: JSON.parse(texto) as unknown };
  } catch {
    return { valido: false };
  }
}

function lerCorpoErro(corpo: unknown): CorpoErroApi["erro"] | null {
  if (!ehObjeto(corpo) || !ehObjeto(corpo.erro)) return null;
  const { codigo, mensagem, detalhes } = corpo.erro;
  if (typeof codigo !== "string" || typeof mensagem !== "string") return null;
  return { codigo, mensagem, detalhes };
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}
