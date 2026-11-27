// RIFA-095 (D43): o que o navegador suporta (iPhone fora do app, sem suporte, pronto) e a leitura da inscrição, com
// janelas falsas. E a implementação de verdade (pushDaJanela) sobre um service worker falso.
import { describe, expect, it, vi } from "vitest";
import {
  CAMINHO_SERVICE_WORKER,
  base64UrlParaBytes,
  ehAparelhoApple,
  lerInscricao,
  pushDaJanela,
  suporteDaJanela,
} from "./navegador";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
};

function janela({
  ua,
  platform = "Linux armv8l",
  toques = 5,
  standalone,
  displayStandalone = false,
  push = true,
}: {
  ua: string;
  platform?: string;
  toques?: number;
  standalone?: boolean;
  displayStandalone?: boolean;
  push?: boolean;
}): Window {
  const navegador: Record<string, unknown> = {
    userAgent: ua,
    platform,
    maxTouchPoints: toques,
    ...(standalone === undefined ? {} : { standalone }),
    ...(push ? { serviceWorker: {} } : {}),
  };
  return {
    navigator: navegador,
    matchMedia: (consulta: string) => ({
      matches: consulta === "(display-mode: standalone)" && displayStandalone,
    }),
    ...(push ? { PushManager: class {}, Notification: class {} } : {}),
  } as unknown as Window;
}

describe("suporteDaJanela", () => {
  it("iPhone no Safari (fora do app): a explicação, mesmo que o navegador tenha a Push API", () => {
    expect(suporteDaJanela(janela({ ua: UA.iphone, standalone: false }))).toBe(
      "iphone_fora_do_app",
    );
    expect(
      suporteDaJanela(
        janela({ ua: UA.iphone, push: false, standalone: false }),
      ),
    ).toBe("iphone_fora_do_app");
  });

  it("iPhone aberto pelo ícone da Tela de Início (iOS 16.4+): pronto; num iOS antigo, sem suporte", () => {
    expect(suporteDaJanela(janela({ ua: UA.iphone, standalone: true }))).toBe(
      "pronto",
    );
    expect(
      suporteDaJanela(janela({ ua: UA.iphone, displayStandalone: true })),
    ).toBe("pronto");
    expect(
      suporteDaJanela(janela({ ua: UA.iphone, standalone: true, push: false })),
    ).toBe("sem_suporte");
  });

  it("iPad (que se apresenta como Mac com toque) também precisa do app; o Mac de verdade, não", () => {
    const ipad = janela({ ua: UA.mac, platform: "MacIntel", toques: 5 });
    expect(ehAparelhoApple(ipad.navigator)).toBe(true);
    expect(suporteDaJanela(ipad)).toBe("iphone_fora_do_app");
    const mac = janela({ ua: UA.mac, platform: "MacIntel", toques: 0 });
    expect(ehAparelhoApple(mac.navigator)).toBe(false);
    expect(suporteDaJanela(mac)).toBe("pronto");
  });

  it("Android e computador com a Push API: pronto; sem ela, sem suporte (o botão some)", () => {
    expect(suporteDaJanela(janela({ ua: UA.android }))).toBe("pronto");
    expect(suporteDaJanela(janela({ ua: UA.android, push: false }))).toBe(
      "sem_suporte",
    );
  });

  it("o jsdom dos testes (sem service worker): sem suporte", () => {
    expect(suporteDaJanela(window)).toBe("sem_suporte");
  });
});

describe("a inscrição", () => {
  it("lê o endpoint e as duas chaves do toJSON(); sem uma delas, null", () => {
    const inscricao = (json: PushSubscriptionJSON) =>
      ({ toJSON: () => json }) as PushSubscription;
    expect(
      lerInscricao(
        inscricao({
          endpoint: "https://fcm.googleapis.com/fcm/send/x",
          keys: { p256dh: "BBB", auth: "AAA" },
        }),
      ),
    ).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/x",
      p256dh: "BBB",
      auth: "AAA",
    });
    expect(
      lerInscricao(
        inscricao({ endpoint: "https://x", keys: { p256dh: "BBB" } }),
      ),
    ).toBeNull();
  });

  it("a chave VAPID pública em bytes (65, começando com 0x04)", () => {
    const bytes = base64UrlParaBytes(`B${"A".repeat(86)}`);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });

  it("pushDaJanela: registra /sw.js no escopo /, inscreve com a chave em bytes e cancela", async () => {
    const assinatura = {
      endpoint: "https://fcm.googleapis.com/fcm/send/x",
      options: { applicationServerKey: null },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/x",
        keys: { p256dh: "BBB", auth: "AAA" },
      }),
      unsubscribe: vi.fn(async () => true),
    };
    let atual: typeof assinatura | null = null;
    const pushManager = {
      getSubscription: vi.fn(async () => atual),
      subscribe: vi.fn(async () => {
        atual = assinatura;
        return assinatura;
      }),
    };
    const registro = { pushManager };
    const serviceWorker = {
      register: vi.fn(async () => registro),
      getRegistration: vi.fn(async () => registro),
      ready: Promise.resolve(registro),
    };
    const falsa = {
      navigator: { serviceWorker, userAgent: UA.android, maxTouchPoints: 5 },
      PushManager: class {},
      Notification: {
        permission: "default",
        requestPermission: vi.fn(async () => "granted"),
      },
      matchMedia: () => ({ matches: false }),
    } as unknown as Window;
    const push = pushDaJanela(falsa);
    expect(push.suporte()).toBe("pronto");
    expect(push.permissao()).toBe("default");
    expect(await push.pedirPermissao()).toBe("granted");
    expect(await push.inscricaoAtual()).toBeNull();
    const chave = `B${"A".repeat(86)}`;
    expect(await push.inscrever(chave)).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/x",
      p256dh: "BBB",
      auth: "AAA",
    });
    expect(serviceWorker.register).toHaveBeenCalledWith(
      CAMINHO_SERVICE_WORKER,
      {
        scope: "/",
      },
    );
    expect(CAMINHO_SERVICE_WORKER).toBe("/sw.js");
    const opcoes = (
      pushManager.subscribe.mock.calls[0] as unknown as [
        { userVisibleOnly: boolean; applicationServerKey: Uint8Array },
      ]
    )[0];
    expect(opcoes.userVisibleOnly).toBe(true);
    expect([...opcoes.applicationServerKey]).toEqual([
      ...base64UrlParaBytes(chave),
    ]);
    expect(await push.inscricaoAtual()).not.toBeNull();
    expect(await push.cancelar()).toBe("https://fcm.googleapis.com/fcm/send/x");
    expect(assinatura.unsubscribe).toHaveBeenCalled();
  });
});
