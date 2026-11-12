// Cliente HTTP da API: só mesma origem, JSON nos dois sentidos e tempo limite.
// Arquivo para baixar (o relatório em CSV): baixarArquivo, com o mesmo tratamento de erro.
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
  const { resposta, corpo: texto } = await requisitar(
    caminho,
    opcoes,
    "application/json",
    (sucesso) => sucesso.text(),
  );
  const json = lerJson(texto);
  if (!json.valido) {
    throw new ErroApi({
      codigo: CODIGOS_CLIENTE.respostaInvalida,
      mensagem: "A API respondeu em um formato inesperado.",
      status: resposta.status,
    });
  }
  return json.valor as T;
}

export type OpcoesArquivo = OpcoesSemCorpo & {
  /** Nome do arquivo quando a resposta não traz o `filename` no `Content-Disposition`. */
  nomeReserva: string;
};

/**
 * Por quanto tempo o endereço do arquivo baixado (object URL) continua valendo depois do clique: o navegador
 * lê o arquivo depois, e no iPhone só quando a pessoa confirma o download. Depois disso, a memória é liberada.
 */
export const LIBERAR_ARQUIVO_DEPOIS_MS = 60_000;

/**
 * Baixa um arquivo da API (GET na mesma origem, com o cookie): fetch → Blob → link temporário com `download`
 * igual ao nome do `Content-Disposition` (ou `nomeReserva`), clicado e removido na hora; o object URL é
 * liberado depois de LIBERAR_ARQUIVO_DEPOIS_MS. Falhas e 401 como em requisitarJson (os erros da API vêm em
 * JSON, no formato único). Devolve o nome dado ao arquivo. Cancelada pelo `signal`, não baixa nada.
 */
export async function baixarArquivo(
  caminho: string,
  { nomeReserva, ...opcoes }: OpcoesArquivo,
): Promise<string> {
  const { resposta, corpo: arquivo } = await requisitar(
    caminho,
    { ...opcoes, metodo: "GET" },
    "*/*",
    (sucesso) => sucesso.blob(),
  );
  const { signal } = opcoes;
  if (signal?.aborted) throw erroSemResposta(signal.reason, false, signal);

  const nome =
    nomeDoContentDisposition(resposta.headers.get("content-disposition")) ??
    nomeReserva;
  const endereco = URL.createObjectURL(arquivo);
  const link = document.createElement("a");
  link.href = endereco;
  link.download = nome;
  link.hidden = true;
  // No documento durante o clique: alguns navegadores só baixam por um link que está na página.
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(endereco), LIBERAR_ARQUIVO_DEPOIS_MS);
  }
  return nome;
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

type Recebida<T> = { resposta: Response; corpo: T };

/**
 * O caminho comum de requisitarJson e baixarArquivo: mesma origem, tempo limite, cancelamento e o corpo
 * lido dentro do tempo limite (`lerCorpo` no sucesso; o texto do erro na falha, que vira ErroApi).
 */
async function requisitar<T>(
  caminho: string,
  opcoes: OpcoesRequisicao,
  aceitar: string,
  lerCorpo: (resposta: Response) => Promise<T>,
): Promise<Recebida<T>> {
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

  const headers: Record<string, string> = { accept: aceitar };
  if (corpo !== undefined) headers["content-type"] = "application/json";

  let resposta: Response;
  let lido: { ok: true; corpo: T } | { ok: false; texto: string };
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      credentials: "same-origin",
      signal: controle.signal,
    });
    lido = resposta.ok
      ? { ok: true, corpo: await lerCorpo(resposta) }
      : { ok: false, texto: await resposta.text() };
  } catch (causa) {
    throw erroSemResposta(causa, tempoEsgotado, signal);
  } finally {
    clearTimeout(temporizador);
    signal?.removeEventListener("abort", cancelar);
  }

  if (!lido.ok) throw erroDaResposta(caminho, resposta.status, lido.texto);
  return { resposta, corpo: lido.corpo };
}

/** A resposta de erro vira ErroApi; um 401 avisa os ouvintes antes (a sessão leva para /entrar). */
function erroDaResposta(
  caminho: string,
  status: number,
  texto: string,
): ErroApi {
  if (status === 401) {
    for (const ouvinte of [...ouvintes401]) ouvinte(caminho);
  }
  const json = lerJson(texto);
  const erroPadrao = json.valido ? lerCorpoErro(json.valor) : null;
  return new ErroApi(
    erroPadrao
      ? { ...erroPadrao, status }
      : {
          codigo: CODIGOS_CLIENTE.erroHttp,
          mensagem: `A API respondeu com falha (HTTP ${status}).`,
          status,
        },
  );
}

/**
 * O nome do arquivo no `Content-Disposition`: `filename*=UTF-8''...` (RFC 6266/8187) e, sem ele,
 * `filename="..."` ou `filename=...`. Null sem cabeçalho, sem nome ou com nome vazio.
 */
function nomeDoContentDisposition(cabecalho: string | null): string | null {
  if (!cabecalho) return null;
  const estendido = /filename\*\s*=\s*utf-8''([^;\s]+)/i.exec(cabecalho);
  if (estendido) {
    try {
      const nome = decodeURIComponent(estendido[1]).trim();
      if (nome) return nome;
    } catch {
      // Codificação inválida: fica o filename simples, se houver.
    }
  }
  const simples = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/i.exec(
    cabecalho,
  );
  const nome = (simples?.[1]?.replace(/\\(.)/g, "$1") ?? simples?.[2])?.trim();
  return nome ? nome : null;
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
