// O Web Push do lado do navegador (RIFA-095, D43): o que o aparelho suporta e as operações do service worker e da
// inscrição. Fica atrás da interface PushDoNavegador para os testes trocarem por uma falsa (o jsdom não tem service
// worker nem PushManager).

/** O caminho e o escopo do service worker (public/sw.js). */
export const CAMINHO_SERVICE_WORKER = "/sw.js";
export const ESCOPO_SERVICE_WORKER = "/";

/**
 * - sem_suporte: o navegador não tem service worker, Push API ou notificações (o botão some);
 * - iphone_fora_do_app: iPhone ou iPad no navegador, fora do app da Tela de Início (o iOS só dá notificação ao site
 *   aberto pelo ícone, a partir do iOS 16.4): no lugar do botão, a explicação;
 * - pronto: dá para pedir a permissão e se inscrever.
 */
export type SuporteDoNavegador =
  "sem_suporte" | "iphone_fora_do_app" | "pronto";

/** O que a inscrição manda à API (o PushSubscription.toJSON() do navegador). */
export interface InscricaoDoNavegador {
  endpoint: string;
  p256dh: string;
  auth: string;
  /** A chave VAPID pública com que a inscrição foi feita (base64url), quando o navegador diz. */
  chave?: string | null;
}

export interface PushDoNavegador {
  suporte(): SuporteDoNavegador;
  /** A permissão de notificação deste site. */
  permissao(): NotificationPermission;
  /** Pede a permissão (precisa vir do toque no botão). */
  pedirPermissao(): Promise<NotificationPermission>;
  /** Registra o service worker (sem pedir nada à pessoa). */
  registrar(): Promise<void>;
  /** A inscrição que este aparelho já tem, ou null. */
  inscricaoAtual(): Promise<InscricaoDoNavegador | null>;
  /** Inscreve no serviço de push do navegador com a chave VAPID pública. */
  inscrever(chavePublica: string): Promise<InscricaoDoNavegador>;
  /** Cancela a inscrição deste aparelho; devolve o endpoint que tinha (ou null). */
  cancelar(): Promise<string | null>;
}

/** iPhone, iPod ou iPad (o iPadOS se apresenta como Mac com tela de toque). */
export function ehAparelhoApple(navegador: Navigator): boolean {
  if (/iPad|iPhone|iPod/.test(navegador.userAgent)) return true;
  return navegador.platform === "MacIntel" && navegador.maxTouchPoints > 1;
}

/** O site está aberto como app (pelo ícone da Tela de Início)? */
export function abertoComoApp(janela: Window): boolean {
  const navegador = janela.navigator as Navigator & { standalone?: boolean };
  if (navegador.standalone === true) return true;
  return (
    typeof janela.matchMedia === "function" &&
    janela.matchMedia("(display-mode: standalone)").matches
  );
}

/** O suporte do navegador desta janela. */
export function suporteDaJanela(janela: Window): SuporteDoNavegador {
  const navegador = janela.navigator;
  if (ehAparelhoApple(navegador) && !abertoComoApp(janela))
    return "iphone_fora_do_app";
  const temTudo =
    "serviceWorker" in navegador &&
    "PushManager" in janela &&
    "Notification" in janela;
  return temTudo ? "pronto" : "sem_suporte";
}

/** base64url → bytes (a chave VAPID pública para o `applicationServerKey`). */
export function base64UrlParaBytes(valor: string): Uint8Array<ArrayBuffer> {
  const base64 = valor
    .replace(/=+$/, "")
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const binario = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** bytes → base64url sem `=`. */
export function bytesParaBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function mesmosBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** A inscrição do navegador no formato da API, ou null se faltar uma das chaves. */
export function lerInscricao(
  inscricao: PushSubscription,
): InscricaoDoNavegador | null {
  const json = inscricao.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, p256dh, auth };
}

/** A implementação de verdade, sobre a janela do navegador. */
export function pushDaJanela(janela: Window = window): PushDoNavegador {
  const servicos = () => janela.navigator.serviceWorker;
  const notificacoes = () =>
    (janela as Window & { Notification: typeof Notification }).Notification;
  const registro = async () =>
    (await servicos().getRegistration(ESCOPO_SERVICE_WORKER)) ?? null;
  return {
    suporte: () => suporteDaJanela(janela),
    permissao: () => notificacoes().permission,
    pedirPermissao: () => notificacoes().requestPermission(),
    async registrar() {
      await servicos().register(CAMINHO_SERVICE_WORKER, {
        scope: ESCOPO_SERVICE_WORKER,
      });
    },
    async inscricaoAtual() {
      const atual = await (await registro())?.pushManager.getSubscription();
      if (!atual) return null;
      const lida = lerInscricao(atual);
      const chave = atual.options?.applicationServerKey;
      return (
        lida && {
          ...lida,
          chave: chave ? bytesParaBase64Url(new Uint8Array(chave)) : null,
        }
      );
    },
    async inscrever(chavePublica) {
      await servicos().register(CAMINHO_SERVICE_WORKER, {
        scope: ESCOPO_SERVICE_WORKER,
      });
      const pronto = await servicos().ready;
      // Uma inscrição feita com outra chave VAPID (o servidor trocou a chave) não aceita a nova: sai antes.
      const chave = base64UrlParaBytes(chavePublica);
      const existente = await pronto.pushManager.getSubscription();
      const chaveDela = existente?.options.applicationServerKey;
      if (
        existente &&
        (!chaveDela || !mesmosBytes(new Uint8Array(chaveDela), chave))
      )
        await existente.unsubscribe();
      const inscricao = await pronto.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chave,
      });
      const lida = lerInscricao(inscricao);
      if (lida === null) {
        await inscricao.unsubscribe();
        throw new Error("Inscrição sem as chaves");
      }
      return lida;
    },
    async cancelar() {
      const atual = await (await registro())?.pushManager.getSubscription();
      if (!atual) return null;
      const endpoint = atual.endpoint;
      await atual.unsubscribe();
      return endpoint;
    },
  };
}
