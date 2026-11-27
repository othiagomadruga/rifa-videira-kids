// Um navegador com Web Push para as telas (RIFA-096): o jsdom não tem service worker, PushManager nem Notification, e
// sem eles o botão "Avisos no celular" (components/notificacoes) não aparece. `simularWebPush()` põe os três (com a
// permissão ainda não pedida) ou, com `iphone`, só o userAgent de um iPhone fora do app da Tela de Início. Devolve a
// função que desfaz (chame no fim do teste). A resposta de GET /api/publico/notificacoes fica com quem simula o fetch:
// `ESTADO_NOTIFICACOES_LIGADAS`.
import { vi } from "vitest";

/** Uma chave VAPID pública fictícia (87 caracteres, como a de verdade). */
export const CHAVE_VAPID_FICTICIA = `B${"V".repeat(86)}`;

/** O corpo de GET /api/publico/notificacoes com as notificações ligadas. */
export const ESTADO_NOTIFICACOES_LIGADAS = {
  ligadas: true,
  chave_publica: CHAVE_VAPID_FICTICIA,
} as const;

export function simularWebPush({ iphone = false } = {}): () => void {
  if (iphone) {
    const agente = vi
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
      );
    return () => agente.mockRestore();
  }
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: vi.fn(async () => ({})),
      getRegistration: vi.fn(async () => undefined),
      ready: new Promise(() => {}),
    },
  });
  const janela = window as unknown as Record<string, unknown>;
  janela.PushManager = class {};
  janela.Notification = {
    permission: "default",
    requestPermission: vi.fn(async () => "default"),
  };
  return () => {
    delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
    delete janela.PushManager;
    delete janela.Notification;
  };
}
