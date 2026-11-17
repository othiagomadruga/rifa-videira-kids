/*
 * APRESENTAÇÃO da Rifa Videira Kids (RIFA-062; publicada em /exemplo pela RIFA-063, D28; só da apresentação, não
 * faz parte do site): a campanha simulada no meio, com muitas vendas fictícias, para o PO apresentar aos líderes e à
 * igreja. O pacote do site ao lado foi construído com VITE_ROTEADOR=hash: a tela fica no hash (/exemplo/#/telao) e o
 * servidor só vê /exemplo/, então recarregar continua aqui (nunca no site oficial, que mora na mesma origem).
 * Carregado antes do pacote do site (script clássico no <head>), depois de demo/dados.js:
 *  1. endereço sem tela no hash vai para "#/" (o ranking público); o papel da barra fica na aba (sessionStorage) e,
 *     ao recarregar em #/coordenacao ou #/minha, volta o papel daquela área;
 *  2. troca window.fetch para /api/*: GET devolve a resposta gravada do papel atual; a sessão segue o
 *     papel escolhido; escrita não grava nada e responde um erro no formato do contrato; o relatório da
 *     campanha (CSV) volta como arquivo, com text/csv, Content-Disposition e o BOM;
 *  3. mostra a faixa "Simulação com dados fictícios de vendas · nada é gravado" com os papéis.
 * Ao vivo: o ranking público e o telão buscam de novo a cada minuto (useRankingPublico). A cada busca, o ranking
 * aberto vem do retrato seguinte da sequência gravada (window.__DEMO_AO_VIVO__: o retrato 0 e um por minuto
 * simulado, com as vendas daquele minuto), até o último, onde para (sem voltar). As buscas de uma mesma rodada
 * (feitas juntas) e as que vêm menos de 45 s depois da anterior (trocar de tela e voltar) repetem o retrato. A hora
 * da atualização é a da busca (o "Atualizado às" do telão acompanha o relógio). Recarregar a página recomeça.
 * Sem internet no aparelho (navigator.onLine falso), /api/* falha como um fetch de verdade, e o site mostra a
 * falha de conexão neutra ("Sem conexão agora"). Sem rede: nada sai para /api/* real.
 * Mesma origem do site oficial: o destino "voltar para" que o site guarda no localStorage volta, ao sair da
 * página, ao que era antes da apresentação; os links "#<id>" de dentro da página (ex.: "Pular para o conteúdo")
 * levam ao elemento, sem virar tela no roteador de hash.
 */
(function () {
  "use strict";

  var GRAVACOES = window.__DEMO_GRAVACOES__ || {};
  var RETRATOS = window.__DEMO_AO_VIVO__ || [];
  var MENSAGEM_ESCRITA = "Simulação: nada é gravado.";
  var ATRASO_MS = 120;
  var CHAVE_DESTINO = "rifa-videira-kids:voltar-para";
  var CHAVE_PAPEL = "rifa-videira-kids:exemplo-papel";
  var TOKEN_DEMO = ("demonstracao_sem_token_real_" + new Array(44).join("0")).slice(0, 43);

  var PAPEIS = [
    { id: "publico", rotulo: "Público", inicio: "/" },
    { id: "admin", rotulo: "Coordenação", inicio: "/coordenacao" },
    { id: "lider", rotulo: "Líder", inicio: "/minha" },
    { id: "discipulador", rotulo: "Discipulador", inicio: "/minha" },
  ];
  // Sem o papel Rede (decisão do PO, 17/11, RIFA-063): a apresentação não mostra o nome da rede.

  function papelPorId(id) {
    for (var i = 0; i < PAPEIS.length; i++) if (PAPEIS[i].id === id) return PAPEIS[i];
    return PAPEIS[0];
  }

  var estado = {
    /** Papel da sessão simulada (definido logo abaixo, ao abrir: papelInicial). */
    papel: "publico",
    /** O site já perguntou pela sessão (depois disso, ele guarda a resposta na memória). */
    sessaoConsultada: false,
    /** Papel que o site guardou da última resposta de sessão (null: sem sessão). */
    papelNoSite: null,
  };

  // ------------------------------------------------------------------------------------------------
  // 1. Endereço inicial (a tela no hash) e o papel ao recarregar
  // ------------------------------------------------------------------------------------------------
  /** A tela do site: o caminho que está no hash ("#/telao?x=1" → "/telao"); sem tela no hash, "/". */
  function caminhoAtual() {
    var hash = location.hash.charAt(0) === "#" ? location.hash.slice(1) : "";
    if (hash.charAt(0) !== "/") return "/";
    var fim = hash.search(/[?#]/);
    return fim < 0 ? hash : hash.slice(0, fim);
  }

  function naArea(caminho, area) {
    return caminho === area || caminho.indexOf(area + "/") === 0;
  }

  if (location.hash.indexOf("#/") !== 0) {
    try {
      history.replaceState(null, "", location.pathname + location.search + "#/");
    } catch (erro) {
      // Endereço que não pode ser reescrito: o roteador de hash abre no ranking público do mesmo jeito.
    }
  }

  function lerPapelGuardado() {
    try {
      return sessionStorage.getItem(CHAVE_PAPEL);
    } catch (erro) {
      return null;
    }
  }

  function guardarPapel(id) {
    try {
      sessionStorage.setItem(CHAVE_PAPEL, id);
    } catch (erro) {
      // Armazenamento indisponível: ao recarregar, o papel vem da área do endereço.
    }
  }

  /** Ao abrir ou recarregar: a área do endereço manda (coordenação, ou a /minha com o papel dela); fora delas, o guardado. */
  function papelInicial() {
    var caminho = caminhoAtual();
    var guardado = lerPapelGuardado();
    var daMinha = guardado === "lider" || guardado === "discipulador";
    if (naArea(caminho, "/coordenacao")) return "admin";
    if (naArea(caminho, "/minha")) return daMinha ? guardado : "lider";
    return papelPorId(guardado).id;
  }

  // O destino "voltar para" do site oficial (mesma origem): ao sair da apresentação, volta ao que era antes dela.
  var destinoAntes = null;
  try {
    destinoAntes = localStorage.getItem(CHAVE_DESTINO);
  } catch (erro) {
    // Armazenamento indisponível: não há o que devolver.
  }
  window.addEventListener("pagehide", function () {
    try {
      if (localStorage.getItem(CHAVE_DESTINO) === destinoAntes) return;
      if (destinoAntes === null) localStorage.removeItem(CHAVE_DESTINO);
      else localStorage.setItem(CHAVE_DESTINO, destinoAntes);
    } catch (erro) {
      // Armazenamento indisponível: nada foi guardado.
    }
  });

  // ------------------------------------------------------------------------------------------------
  // 2. API simulada
  // ------------------------------------------------------------------------------------------------
  var fetchOriginal = typeof window.fetch === "function" ? window.fetch.bind(window) : null;

  window.fetch = function (entrada, opcoes) {
    var url;
    var metodo = "GET";
    var sinal = opcoes && opcoes.signal ? opcoes.signal : null;
    try {
      if (typeof Request !== "undefined" && entrada instanceof Request) {
        url = new URL(entrada.url);
        metodo = entrada.method;
        sinal = sinal || entrada.signal;
      } else {
        url = new URL(String(entrada), location.href);
      }
      if (opcoes && opcoes.method) metodo = opcoes.method;
    } catch (erro) {
      return fetchOriginal ? fetchOriginal(entrada, opcoes) : Promise.reject(erro);
    }
    var ehApi = url.origin === location.origin && url.pathname.indexOf("/api/") === 0;
    if (!ehApi) {
      return fetchOriginal ? fetchOriginal(entrada, opcoes) : Promise.reject(new TypeError("fetch"));
    }
    return responderComAtraso(url, String(metodo).toUpperCase(), sinal);
  };

  function erroDeCancelamento(sinal) {
    if (sinal && sinal.reason !== undefined) return sinal.reason;
    try {
      return new DOMException("A requisição foi cancelada.", "AbortError");
    } catch (erro) {
      return new Error("AbortError");
    }
  }

  function responderComAtraso(url, metodo, sinal) {
    return new Promise(function (resolve, reject) {
      if (sinal && sinal.aborted) {
        reject(erroDeCancelamento(sinal));
        return;
      }
      function aoCancelar() {
        clearTimeout(temporizador);
        reject(erroDeCancelamento(sinal));
      }
      var temporizador = setTimeout(function () {
        if (sinal) sinal.removeEventListener("abort", aoCancelar);
        // Aparelho sem internet: falha como o fetch de verdade (TypeError), e o site mostra "Sem conexão agora".
        if (navigator.onLine === false) {
          reject(new TypeError("Failed to fetch"));
          return;
        }
        try {
          resolve(responder(url, metodo));
        } catch (erro) {
          resolve(respostaDeErro(500, "erro_interno", "Demonstração: falha ao montar a resposta."));
        }
      }, ATRASO_MS);
      if (sinal) sinal.addEventListener("abort", aoCancelar, { once: true });
    });
  }

  function respostaJson(status, corpo) {
    return new Response(corpo === null || corpo === undefined ? "" : JSON.stringify(corpo), {
      status: status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  /** Formato único de erro do contrato (src/shared/contracts/erros.ts). */
  function respostaDeErro(status, codigo, mensagem) {
    return respostaJson(status, { erro: { codigo: codigo, mensagem: mensagem } });
  }

  function ehRotaAberta(caminho) {
    return caminho.indexOf("/api/publico/") === 0 || caminho === "/api/health";
  }

  function sessaoGravada(papel) {
    var lista = GRAVACOES[papel] || [];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].caminho === "/api/sessao" && lista[i].status === 200) return lista[i].corpo;
    }
    return null;
  }

  function respostaDaSessao() {
    estado.sessaoConsultada = true;
    var corpo = estado.papel === "publico" ? null : sessaoGravada(estado.papel);
    if (!corpo) {
      estado.papelNoSite = null;
      return respostaDeErro(401, "nao_autenticado", "Sessão ausente ou expirada.");
    }
    estado.papelNoSite = estado.papel;
    return respostaJson(200, corpo);
  }

  function responder(url, metodo) {
    var caminho = url.pathname;

    // Sessão: entrar, sair e quem está conectado seguem o papel escolhido na barra.
    if (caminho === "/api/sessao" && metodo === "GET") return respostaDaSessao();
    if (caminho === "/api/sessao" && metodo === "POST") {
      // Entrar pelo link (simulado): entra no papel escolhido na barra ou, no Público, como Coordenação.
      if (estado.papel === "publico") definirPapel("admin");
      return respostaDaSessao();
    }
    if (caminho === "/api/sessao/sair" && metodo === "POST") {
      estado.sessaoConsultada = true;
      estado.papelNoSite = null;
      definirPapel("publico");
      return new Response(null, { status: 204 });
    }

    if (metodo !== "GET" && metodo !== "HEAD") {
      // O modelo do link de vendas (Adesão) lê o 403 como "Só o admin muda o modelo.": lá a recusa da
      // demonstração vai com outro status, para a tela mostrar "Demonstração: nada é salvo.".
      if (caminho === "/api/admin/links-vendas/modelo") return respostaDeErro(405, "demonstracao", MENSAGEM_ESCRITA);
      return respostaDeErro(403, "proibido", MENSAGEM_ESCRITA);
    }

    // Sem sessão, as rotas fechadas respondem 401, como a API (o site leva para /entrar).
    if (estado.papel === "publico" && !ehRotaAberta(caminho)) {
      estado.papelNoSite = null;
      return respostaDeErro(401, "nao_autenticado", "Sessão ausente ou expirada.");
    }

    var gravada = procurar(estado.papel, caminho, url.searchParams);
    // Busca de pedido pelo id (?id=) sem a consulta exata gravada: procura o pedido em todas as páginas gravadas.
    if (caminho === "/api/admin/pedidos" && url.searchParams.has("id") && !(gravada && gravada.exata)) {
      var busca = buscarPedido(url.searchParams);
      if (busca) return respostaJson(200, busca);
    }
    // Ao vivo: o ranking aberto vem do retrato da vez (a consulta exata gravada nele).
    if (caminho === RANKING_PUBLICO) {
      var doRetrato = respostaAoVivo(url.searchParams);
      if (doRetrato) return respostaJson(200, doRetrato);
    }
    if (!gravada && ehRotaAberta(caminho)) gravada = procurar("publico", caminho, url.searchParams);
    // Arquivo para baixar (o relatório da campanha): só a consulta exata, nunca o de outro tipo.
    if (gravada && gravada.cabecalhos && !gravada.exata) gravada = null;
    if (!gravada) {
      return respostaDeErro(404, "nao_encontrado", "Demonstração: esta consulta não foi gravada.");
    }
    if (gravada.cabecalhos) return respostaArquivo(gravada);
    return respostaJson(gravada.status, gravada.corpo);
  }

  // ------------------------------------------------------------------------------------------------
  // Ao vivo: a sequência de retratos do ranking aberto (telão e ranking público)
  // ------------------------------------------------------------------------------------------------
  var RANKING_PUBLICO = "/api/publico/ranking";
  /** Menos que isto desde o último retrato servido: a mesma rodada (ou trocar de tela e voltar), o mesmo retrato. */
  var INTERVALO_MINIMO_MS = 45000;
  /** O retrato da vez (-1: nenhum servido ainda) e quando ele começou a ser servido (Date.now()). */
  var aoVivo = { indice: -1, desde: 0 };
  var ouvintesDoRetrato = [];
  var ouvintesDeTela = [];

  function avisarRetrato() {
    for (var i = 0; i < ouvintesDoRetrato.length; i++) ouvintesDoRetrato[i]();
  }

  /** O retrato desta busca: o 1º na primeira; depois, o seguinte a cada nova rodada, até o último (sem voltar). */
  function indiceDoRetrato() {
    var agora = Date.now();
    if (aoVivo.indice < 0) {
      aoVivo = { indice: 0, desde: agora };
      avisarRetrato();
    } else if (aoVivo.indice < RETRATOS.length - 1 && agora - aoVivo.desde >= INTERVALO_MINIMO_MS) {
      aoVivo = { indice: aoVivo.indice + 1, desde: agora };
      avisarRetrato();
    }
    return aoVivo.indice;
  }

  function ultimoRetrato() {
    return RETRATOS.length > 0 && aoVivo.indice === RETRATOS.length - 1;
  }

  /**
   * A resposta do ranking aberto no retrato da vez (a consulta exata, em qualquer ordem dos parâmetros), com a hora
   * da atualização = agora. null: sem retratos, ou a consulta não está no retrato (vale a gravação principal).
   */
  function respostaAoVivo(params) {
    if (RETRATOS.length === 0) return null;
    var retrato = RETRATOS[indiceDoRetrato()];
    var chave = chaveOrdenada(paresDe(params));
    for (var i = 0; i < retrato.respostas.length; i++) {
      var registro = retrato.respostas[i];
      if (registro.status !== 200 || chaveOrdenada(paresDe(new URLSearchParams(registro.consulta))) !== chave) continue;
      var copia = JSON.parse(JSON.stringify(registro.corpo));
      copia.atualizado_em = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
      return copia;
    }
    return null;
  }

  // Cada troca de tela do site (history.pushState/replaceState do roteador e o voltar do navegador) atualiza a
  // frase da faixa (só no ranking público e no telão).
  function telaMudou() {
    for (var i = 0; i < ouvintesDeTela.length; i++) ouvintesDeTela[i]();
  }
  ["pushState", "replaceState"].forEach(function (nome) {
    var original = history[nome];
    history[nome] = function () {
      var resultado = original.apply(this, arguments);
      telaMudou();
      return resultado;
    };
  });
  window.addEventListener("popstate", telaMudou);
  window.addEventListener("hashchange", telaMudou);

  /** As telas que buscam o ranking público de minuto em minuto. */
  function ehTelaDoRanking(caminho) {
    return caminho === "/" || caminho === "/telao";
  }

  /**
   * O relatório da campanha em CSV (RIFA-038), como a API: os bytes do texto gravado (o BOM U+FEFF vira EF BB BF),
   * text/csv e o Content-Disposition com o nome do arquivo. O site lê como Blob (os bytes, com o BOM) e baixa.
   */
  function respostaArquivo(gravada) {
    var tipo = gravada.cabecalhos["content-type"] || "text/csv; charset=utf-8";
    var cabecalhos = { "content-type": tipo, "cache-control": "no-store" };
    if (gravada.cabecalhos["content-disposition"])
      cabecalhos["content-disposition"] = gravada.cabecalhos["content-disposition"];
    var bytes = new TextEncoder().encode(String(gravada.corpo));
    return new Response(new Blob([bytes], { type: tipo }), { status: gravada.status, headers: cabecalhos });
  }

  function paresDe(params) {
    var pares = [];
    params.forEach(function (valor, chave) {
      pares.push([chave, valor]);
    });
    return pares;
  }

  function chaveOrdenada(pares) {
    return pares
      .map(function (par) {
        return par[0] + "=" + par[1];
      })
      .sort()
      .join("&");
  }

  /**
   * A resposta gravada do papel: a da consulta exata (a ordem dos parâmetros não importa; volta com
   * `exata: true`); sem ela, a do mesmo caminho com a consulta mais parecida.
   */
  function procurar(papel, caminho, params) {
    var lista = GRAVACOES[papel] || [];
    var pedidos = paresDe(params);
    var chave = chaveOrdenada(pedidos);
    var melhor = null;
    var melhorNota = -Infinity;
    for (var i = 0; i < lista.length; i++) {
      var registro = lista[i];
      if (registro.caminho !== caminho) continue;
      var gravados = paresDe(new URLSearchParams(registro.consulta));
      if (chaveOrdenada(gravados) === chave)
        return { status: registro.status, corpo: registro.corpo, cabecalhos: registro.cabecalhos, exata: true };
      var nota = 0;
      var mapa = {};
      gravados.forEach(function (par) {
        mapa[par[0]] = par[1];
      });
      pedidos.forEach(function (par) {
        if (!(par[0] in mapa)) return;
        nota += mapa[par[0]] === par[1] ? 2 : -1;
      });
      gravados.forEach(function (par) {
        if (!params.has(par[0])) nota -= 1;
      });
      if (registro.status !== 200) nota -= 0.5;
      if (nota > melhorNota) {
        melhorNota = nota;
        melhor = registro;
      }
    }
    return melhor;
  }

  /**
   * Busca pelo id do pedido (?id=): procura o pedido em todas as páginas gravadas. Como a API: o filtro
   * `desconsiderado` vale para a lista, e os totais contam só o que conta (sem os desconsiderados, D20).
   */
  function buscarPedido(params) {
    var id = (params.get("id") || "").trim();
    var status = params.get("status");
    var desconsiderado = params.get("desconsiderado");
    var celulaId = params.get("celula_id");
    var semCelula = params.get("sem_celula") === "true";
    var lista = GRAVACOES[estado.papel] || [];
    var achados = {};
    var modelo = null;
    for (var i = 0; i < lista.length; i++) {
      var registro = lista[i];
      if (registro.caminho !== "/api/admin/pedidos" || registro.status !== 200 || !registro.corpo) continue;
      if (!modelo && registro.corpo.totais) modelo = registro.corpo;
      var itens = registro.corpo.itens || [];
      for (var j = 0; j < itens.length; j++) if (itens[j].id === id) achados[id] = itens[j];
    }
    if (!modelo) return null;
    var porCelula = Object.keys(achados)
      .map(function (chave) {
        return achados[chave];
      })
      .filter(function (item) {
        if (celulaId) return String(item.celula_id) === celulaId;
        if (semCelula) return item.celula_id === null;
        return true;
      });
    var totais = {};
    Object.keys(modelo.totais).forEach(function (chave) {
      totais[chave] = { pedidos: 0, bilhetes: 0, total_centavos: 0 };
    });
    porCelula.forEach(function (item) {
      if (item.desconsiderado) return;
      var total = totais[item.status];
      if (!total) return;
      total.pedidos += 1;
      total.bilhetes += item.qtd_bilhetes || 0;
      total.total_centavos += item.total_centavos || 0;
    });
    return {
      itens: porCelula.filter(function (item) {
        if (desconsiderado === "true" && !item.desconsiderado) return false;
        if (desconsiderado === "false" && item.desconsiderado) return false;
        return !status || item.status === status;
      }),
      proximo: null,
      totais: params.has("antes_de") ? null : totais,
    };
  }

  // ------------------------------------------------------------------------------------------------
  // Troca de papel
  // ------------------------------------------------------------------------------------------------
  var ouvintesDoPapel = [];

  function definirPapel(id) {
    estado.papel = papelPorId(id).id;
    guardarPapel(estado.papel);
    for (var i = 0; i < ouvintesDoPapel.length; i++) ouvintesDoPapel[i](estado.papel);
  }

  /** Navega como o site: history.pushState do hash ("#/telao") + popstate (o roteador de hash escuta o popstate). */
  function navegar(caminho) {
    var atual = history.state;
    var indice = atual && typeof atual.idx === "number" ? atual.idx + 1 : 0;
    var chave = Math.random().toString(36).slice(2, 10);
    history.pushState({ usr: null, key: chave, idx: indice }, "", "#" + caminho);
    var evento;
    try {
      evento = new PopStateEvent("popstate", { state: history.state });
    } catch (erro) {
      evento = document.createEvent("Event");
      evento.initEvent("popstate", false, false);
    }
    window.dispatchEvent(evento);
    window.scrollTo(0, 0);
  }

  function esquecerDestinoGuardado() {
    try {
      localStorage.removeItem(CHAVE_DESTINO);
    } catch (erro) {
      // Armazenamento indisponível: não havia destino guardado.
    }
  }

  var trocaEmAndamento = 0;

  // Ao abrir ou recarregar: o papel da área do endereço (ou o guardado nesta aba).
  definirPapel(papelInicial());

  function trocarPara(id) {
    var papel = papelPorId(id);
    var troca = ++trocaEmAndamento;
    esquecerDestinoGuardado();
    definirPapel(papel.id);
    // Público, o site ainda sem a sessão na memória ou com o mesmo papel: basta navegar (a guarda da área
    // pergunta a sessão quando precisa).
    if (papel.id === "publico" || !estado.sessaoConsultada || estado.papelNoSite === papel.id) {
      navegar(papel.inicio);
      return;
    }
    // O site guardou outra sessão na memória: entra pelo link pessoal (simulado), como a pessoa faria.
    entrarPeloLink(papel, troca);
  }

  function entrarPeloLink(papel, troca) {
    var raiz = document.documentElement;
    avisoTroca.textContent = "Abrindo como " + papel.rotulo + "…";
    raiz.classList.add("demo-trocando");
    navegar("/acesso/" + TOKEN_DEMO);
    var inicio = Date.now();
    var clicou = false;
    (function conferir() {
      if (troca !== trocaEmAndamento) return;
      var chegou = naArea(caminhoAtual(), papel.inicio);
      if (clicou && chegou) {
        raiz.classList.remove("demo-trocando");
        return;
      }
      if (Date.now() - inicio > 5000) {
        raiz.classList.remove("demo-trocando");
        if (!chegou) navegar(papel.inicio);
        return;
      }
      if (!clicou) {
        var botoes = document.querySelectorAll(".acesso button");
        for (var i = 0; i < botoes.length; i++) {
          if (botoes[i].textContent.trim() === "Entrar" && !botoes[i].disabled) {
            clicou = true;
            botoes[i].click();
            break;
          }
        }
      }
      setTimeout(conferir, 30);
    })();
  }

  // Link "#<id>" de dentro da página que o site não tratou (ex.: "Pular para o conteúdo"): no roteador de hash ele
  // viraria a tela "<id>" (não encontrada); aqui leva ao elemento, como no site oficial. Fase de bolha na janela:
  // os que o site trata (preventDefault no onClick) passam direto.
  window.addEventListener("click", function (evento) {
    if (evento.defaultPrevented || evento.button !== 0) return;
    var alvo = evento.target;
    var link = alvo && alvo.closest ? alvo.closest("a[href^='#']") : null;
    if (!link) return;
    var href = link.getAttribute("href");
    if (href.indexOf("#/") === 0) return;
    evento.preventDefault();
    var destino = href.length > 1 ? document.getElementById(decodeURIComponent(href.slice(1))) : null;
    if (!destino) return;
    destino.scrollIntoView();
    if (typeof destino.focus === "function") destino.focus({ preventScroll: true });
  });

  // ------------------------------------------------------------------------------------------------
  // 3. Barra da demonstração
  // ------------------------------------------------------------------------------------------------
  var avisoTroca = document.createElement("div");
  avisoTroca.className = "demo-aviso-troca";
  avisoTroca.setAttribute("aria-hidden", "true");

  function montarBarra() {
    var barra = document.createElement("div");
    barra.className = "demo-barra";
    barra.setAttribute("role", "region");
    barra.setAttribute("aria-label", "Simulação");

    var dentro = document.createElement("div");
    dentro.className = "demo-barra__dentro";

    var texto = document.createElement("p");
    texto.className = "demo-barra__texto";
    var ponto = document.createElement("span");
    ponto.className = "demo-barra__ponto";
    ponto.setAttribute("aria-hidden", "true");
    texto.appendChild(ponto);
    texto.appendChild(document.createTextNode("Simulação com dados fictícios de vendas · nada é gravado"));

    var grupo = document.createElement("div");
    grupo.className = "demo-barra__grupo";
    grupo.setAttribute("role", "group");
    grupo.setAttribute("aria-label", "Ver como");
    var rotulo = document.createElement("span");
    rotulo.className = "demo-barra__rotulo";
    rotulo.setAttribute("aria-hidden", "true");
    rotulo.textContent = "Ver como:";
    grupo.appendChild(rotulo);

    var botoes = PAPEIS.map(function (papel) {
      var botao = document.createElement("button");
      botao.type = "button";
      botao.className = "demo-barra__botao";
      botao.textContent = papel.rotulo;
      botao.setAttribute("aria-pressed", String(papel.id === estado.papel));
      botao.addEventListener("click", function () {
        trocarPara(papel.id);
      });
      grupo.appendChild(botao);
      return { papel: papel, botao: botao };
    });
    ouvintesDoPapel.push(function (atual) {
      botoes.forEach(function (item) {
        item.botao.setAttribute("aria-pressed", String(item.papel.id === atual));
      });
    });

    // Só no ranking público e no telão: a frase da simulação ao vivo; no último retrato, como recomeçar.
    var FRASE_AO_VIVO = "Simulação: a cada 1 minuto entram vendas novas.";
    var FRASE_FIM = "Fim da simulação: recarregue a página para ver de novo.";
    var dica = document.createElement("span");
    dica.className = "demo-barra__dica";
    function atualizarDica() {
      var texto = ultimoRetrato() ? FRASE_FIM : FRASE_AO_VIVO;
      if (dica.textContent !== texto) dica.textContent = texto;
      if (ehTelaDoRanking(caminhoAtual()) && RETRATOS.length > 0) dica.removeAttribute("hidden");
      else dica.setAttribute("hidden", "");
    }
    ouvintesDoRetrato.push(atualizarDica);
    ouvintesDeTela.push(atualizarDica);
    atualizarDica();

    var textos = document.createElement("div");
    textos.className = "demo-barra__textos";
    textos.appendChild(texto);
    textos.appendChild(dica);
    dentro.appendChild(textos);
    dentro.appendChild(grupo);
    barra.appendChild(dentro);
    document.body.appendChild(avisoTroca);
    document.body.appendChild(barra);

    // A altura da barra reserva o espaço no fim da página (demo.css).
    function medir() {
      document.documentElement.style.setProperty(
        "--demo-barra-altura",
        Math.ceil(barra.getBoundingClientRect().height) + "px",
      );
    }
    medir();
    if (typeof ResizeObserver === "function") new ResizeObserver(medir).observe(barra);
    else window.addEventListener("resize", medir);
  }

  // Para conferir a demonstração (testes): papel atual, trocar de papel e navegar como o site.
  window.__demoRifa = {
    papel: function () {
      return estado.papel;
    },
    trocarPara: trocarPara,
    navegar: navegar,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montarBarra);
  } else {
    montarBarra();
  }
})();
