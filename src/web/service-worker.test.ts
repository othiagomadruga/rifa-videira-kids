// RIFA-095 (D43): o service worker do Web Push (public/sw.js), rodado aqui com um `self` falso. O `push` monta a
// notificação que o Worker mandou (título, texto, ícone da Videira e a URL do toque); o `notificationclick` foca a aba
// do ranking aberto ou abre uma. Sem `fetch` (nada de cache offline). E o manifesto do app.
import { describe, expect, it, vi } from "vitest";
import manifestoTexto from "../../public/manifest.webmanifest?raw";
import codigo from "../../public/sw.js?raw";
import indexHtml from "../../index.html?raw";
import { montarNotificacaoDeVenda } from "../shared/contracts/notificacoes";

type Ouvinte = (evento: Record<string, unknown>) => void;

function carregarServiceWorker() {
  const ouvintes = new Map<string, Ouvinte>();
  const mostradas: { titulo: string; opcoes: NotificationOptions }[] = [];
  const janelas: { url: string; focus: ReturnType<typeof vi.fn> }[] = [];
  const self = {
    location: { origin: "https://rifa.exemplo" },
    addEventListener: (tipo: string, ouvinte: Ouvinte) =>
      ouvintes.set(tipo, ouvinte),
    skipWaiting: vi.fn(),
    registration: {
      showNotification: vi.fn(
        async (titulo: string, opcoes: NotificationOptions) => {
          mostradas.push({ titulo, opcoes });
        },
      ),
    },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => janelas),
      openWindow: vi.fn(async () => null),
    },
  };
  new Function("self", codigo)(self);

  async function disparar(tipo: string, extra: Record<string, unknown>) {
    const esperas: Promise<unknown>[] = [];
    ouvintes.get(tipo)!({
      ...extra,
      waitUntil: (promessa: Promise<unknown>) => esperas.push(promessa),
    });
    await Promise.all(esperas);
  }
  return { self, ouvintes, mostradas, janelas, disparar };
}

const dados = (valor: unknown) => ({ json: () => valor });

describe("public/sw.js", () => {
  it("só trata push e notificationclick (e o install/activate para a versão nova valer logo): nada de fetch", () => {
    const { ouvintes } = carregarServiceWorker();
    expect([...ouvintes.keys()].sort()).toEqual([
      "activate",
      "install",
      "notificationclick",
      "push",
    ]);
    expect(codigo).not.toMatch(/caches\.|addEventListener\("fetch"/);
  });

  it("push: mostra a notificação do Worker, com o ícone da Videira e a URL do ranking aberto", async () => {
    const sw = carregarServiceWorker();
    await sw.disparar("push", {
      data: dados(montarNotificacaoDeVenda("Betel", 3)),
    });
    expect(sw.mostradas).toEqual([
      {
        titulo: "Projeto Videira Kids",
        opcoes: {
          body: "🎟️ A célula Betel vendeu 3 bilhetes!",
          icon: "/icone-192.png",
          lang: "pt-BR",
          data: { url: "/" },
        },
      },
    ]);
  });

  it("push sem dados, com JSON inválido ou com uma URL de fora: o título padrão e o ranking aberto (nunca outro site)", async () => {
    const sw = carregarServiceWorker();
    await sw.disparar("push", { data: null });
    await sw.disparar("push", {
      data: {
        json: () => {
          throw new SyntaxError("x");
        },
      },
    });
    await sw.disparar("push", {
      data: dados({ titulo: 1, corpo: "Oi", url: "https://outro.exemplo/" }),
    });
    await sw.disparar("push", {
      data: dados({ corpo: "Oi", url: "//outro.exemplo" }),
    });
    expect(
      sw.mostradas.map((m) => [m.titulo, m.opcoes.body, m.opcoes.data]),
    ).toEqual([
      ["Projeto Videira Kids", "", { url: "/" }],
      ["Projeto Videira Kids", "", { url: "/" }],
      ["Projeto Videira Kids", "Oi", { url: "/" }],
      ["Projeto Videira Kids", "Oi", { url: "/" }],
    ]);
  });

  it("notificationclick: fecha a notificação e foca a aba do ranking aberto que já existe", async () => {
    const sw = carregarServiceWorker();
    const ranking = { url: "https://rifa.exemplo/", focus: vi.fn() };
    sw.janelas.push(
      { url: "https://rifa.exemplo/minha", focus: vi.fn() },
      ranking,
    );
    const close = vi.fn();
    await sw.disparar("notificationclick", {
      notification: { close, data: { url: "/" } },
    });
    expect(close).toHaveBeenCalled();
    expect(ranking.focus).toHaveBeenCalled();
    expect(sw.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("notificationclick sem a aba aberta: abre o ranking aberto", async () => {
    const sw = carregarServiceWorker();
    sw.janelas.push({ url: "https://rifa.exemplo/minha", focus: vi.fn() });
    await sw.disparar("notificationclick", {
      notification: { close: vi.fn(), data: undefined },
    });
    expect(sw.self.clients.openWindow).toHaveBeenCalledWith(
      "https://rifa.exemplo/",
    );
  });
});

describe("o manifesto do app (iPhone: notificação só aberto pelo ícone)", () => {
  it("standalone, com o nome do projeto e os ícones de 192 e 512 px; ligado no index.html", () => {
    const manifesto = JSON.parse(manifestoTexto) as Record<string, unknown>;
    expect(manifesto).toMatchObject({
      name: "Projeto Videira Kids",
      display: "standalone",
      start_url: "/",
      scope: "/",
      icons: [
        { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
    expect(indexHtml).toContain(
      '<link rel="manifest" href="/manifest.webmanifest" />',
    );
    expect(indexHtml).toContain(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    );
  });
});
