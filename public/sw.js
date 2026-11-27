// Service worker do Projeto Videira Kids (RIFA-095, docs/decisions.md D43; docs/frontend.md, "Avisos de venda no
// celular"). Arquivo estático do site (public/, servido em /sw.js, escopo "/"), sem build e sem dependência.
//
// Só trata o Web Push: `push` mostra a notificação que o Worker mandou ({ titulo, corpo, url }, cifrada até aqui pelo
// navegador) com o ícone da Videira, e `notificationclick` abre o ranking aberto (ou foca a aba que já está nele).
// Nada de cache offline nem de interceptar requisições (sem `fetch`). O `install` e o `activate` só fazem a versão
// nova deste arquivo valer logo, sem esperar todas as abas fecharem.
"use strict";

const TITULO_PADRAO = "Projeto Videira Kids";
const ICONE = "/icone-192.png";
const URL_PADRAO = "/";

/** A notificação a mostrar, a partir dos dados do push (tolerante: um campo estranho vira o padrão). */
function lerNotificacao(dados) {
  let conteudo;
  try {
    conteudo = dados ? dados.json() : {};
  } catch {
    conteudo = {};
  }
  if (conteudo === null || typeof conteudo !== "object") conteudo = {};
  const titulo =
    typeof conteudo.titulo === "string" && conteudo.titulo !== ""
      ? conteudo.titulo
      : TITULO_PADRAO;
  const corpo = typeof conteudo.corpo === "string" ? conteudo.corpo : "";
  // Só um caminho do próprio site ("/..."): nunca outro endereço.
  const url =
    typeof conteudo.url === "string" &&
    conteudo.url.startsWith("/") &&
    !conteudo.url.startsWith("//")
      ? conteudo.url
      : URL_PADRAO;
  return {
    titulo,
    opcoes: {
      body: corpo,
      icon: ICONE,
      lang: "pt-BR",
      data: { url },
    },
  };
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(self.clients.claim());
});

self.addEventListener("push", (evento) => {
  const { titulo, opcoes } = lerNotificacao(evento.data);
  evento.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const dados = evento.notification.data;
  const caminho =
    dados && typeof dados.url === "string" ? dados.url : URL_PADRAO;
  const destino = new URL(caminho, self.location.origin);
  evento.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const janela of janelas) {
        const aberta = new URL(janela.url);
        if (
          aberta.origin === destino.origin &&
          aberta.pathname === destino.pathname &&
          typeof janela.focus === "function"
        )
          return janela.focus();
      }
      return self.clients.openWindow(destino.href);
    })(),
  );
});
