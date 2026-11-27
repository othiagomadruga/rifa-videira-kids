// RIFA-094 (D42): os avisos de venda, com temporizadores falsos e a API falsa (as respostas passam pelo schema do
// contrato). Ao entrar (RIFA-096), as vendas da janela aparecem: até 5, as mais recentes, da mais antiga para a mais
// nova, sem repetir depois; a volta à aba escondida é uma entrada nova; a linha menor diz há quanto tempo ("agora
// mesmo", "há N min") pela `em` e pelo `agora` do servidor. Cada compra nova vira o seu aviso (a mesma célula também),
// com o texto certo; entram um de cada vez (0,8 s), ficam ~5 s e saem; até 4 no computador e 3 no celular; a fila
// guarda as 12 mais novas; com a aba escondida, não consulta; desligados na campanha, nada. O plim: um por aviso (os da
// entrada também), só depois de um gesto na página e com o som ligado; o botão alterna e guarda a escolha.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROTAS,
  respostaVendasRecentesSchema,
  type ItemVendaRecente,
  type RespostaVendasRecentes,
} from "../../../shared/contracts/api";
import { AvisosDeVenda, BotaoSomDasVendas } from "./AvisosDeVenda";
import { CAMINHO_VENDAS_RECENTES } from "./avisos-de-venda-api";
import { CHAVE_SOM_DAS_VENDAS, esquecerSomDasVendas } from "./som";
import * as TEXTOS from "./textos";
import { controlesSemDica } from "../../test/dicas";
import {
  AVISOS_NA_ENTRADA,
  INTERVALO_CONSULTA_MS,
  INTERVALO_ENTRE_AVISOS_MS,
  LIMITE_DA_FILA,
  TEMPO_DE_SAIDA_MS,
  TEMPO_NA_TELA_MS,
  VISIVEIS_NO_CELULAR,
  VISIVEIS_NO_COMPUTADOR,
} from "./useAvisosDeVenda";

const AGORA = "2026-12-01T15:00:00.000Z";
let sequencia = 0;

/** Uma venda com chave nova (16 hex), aprovada `segundosAtras` antes do AGORA do servidor. */
function venda(
  celula: string,
  bilhetes: number,
  segundosAtras = 0,
): ItemVendaRecente {
  sequencia += 1;
  return {
    k: sequencia.toString(16).padStart(16, "0"),
    celula,
    bilhetes,
    em: new Date(Date.parse(AGORA) - segundosAtras * 1000).toISOString(),
  };
}

/** As respostas em ordem (a última se repete); `itens` da mais nova para a mais antiga, como a API. */
let respostas: RespostaVendasRecentes[] = [];
let consultas = 0;

function simularApi(...lista: (ItemVendaRecente[] | false)[]) {
  respostas = lista.map((itens) =>
    respostaVendasRecentesSchema.parse(
      itens === false
        ? { ligados: false, itens: [], agora: AGORA }
        : { ligados: true, itens, agora: AGORA },
    ),
  );
  consultas = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      expect(String(entrada)).toBe(CAMINHO_VENDAS_RECENTES);
      const resposta = respostas[Math.min(consultas, respostas.length - 1)];
      consultas += 1;
      return new Response(JSON.stringify(resposta), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

/** Um AudioContext falso: conta os tons tocados (o plim tem 2). */
class AudioContextFalso {
  static criados: AudioContextFalso[] = [];
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {};
  tons = 0;
  constructor() {
    AudioContextFalso.criados.push(this);
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  createOscillator() {
    return {
      type: "sine",
      frequency: { setValueAtTime: () => undefined },
      connect: () => undefined,
      start: () => {
        this.tons += 1;
      },
      stop: () => undefined,
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    };
  }
}

const plins = () =>
  AudioContextFalso.criados.reduce((soma, ctx) => soma + ctx.tons, 0) / 2;

function simularTela(celular: boolean) {
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: celular,
    media: consulta,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function definirVisibilidade(estado: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const avancar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Os avisos na tela, como texto (sem os que estão saindo). */
function avisosNaTela(): string[] {
  return [
    ...document.querySelectorAll("[data-aviso-de-venda]:not([data-saindo])"),
  ].map((aviso) => aviso.textContent ?? "");
}

/** A frase do aviso ("A célula X vendeu N bilhetes!") e a linha menor ("há 3 min · Projeto Videira Kids"). */
const frase = (aviso: string) => aviso.slice(0, aviso.indexOf("!") + 1);
const linha = (aviso: string) => aviso.slice(aviso.indexOf("!") + 2);

/** Tudo o que passou pela tela (sem repetir), em ordem, olhando a cada meio segundo por `ms`. */
async function tudoQueApareceu(ms: number): Promise<string[]> {
  const vistos = new Set<string>();
  for (let passo = 0; passo <= ms / 500; passo++) {
    for (const aviso of avisosNaTela()) vistos.add(aviso);
    await avancar(500);
  }
  return [...vistos];
}

let ligados = vi.fn<(ligados: boolean) => void>();

async function abrir() {
  ligados = vi.fn<(ligados: boolean) => void>();
  render(
    <>
      <AvisosDeVenda aoSaberSeLigados={ligados} />
      <BotaoSomDasVendas />
    </>,
  );
  // A primeira consulta.
  await avancar(0);
}

/** A consulta seguinte (15 s depois). */
const proximaConsulta = () => avancar(INTERVALO_CONSULTA_MS);

beforeEach(() => {
  vi.useFakeTimers();
  simularTela(false);
  AudioContextFalso.criados = [];
  vi.stubGlobal("AudioContext", AudioContextFalso);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  esquecerSomDasVendas();
  window.localStorage.removeItem(CHAVE_SOM_DAS_VENDAS);
  definirVisibilidade("visible");
});

describe("RIFA-094: os avisos de venda", () => {
  it("o caminho é o do contrato", () => {
    expect(CAMINHO_VENDAS_RECENTES).toBe(ROTAS.vendasRecentes.caminho);
  });

  it(`RIFA-096: ao entrar, as vendas dos últimos 10 min aparecem: até ${AVISOS_NA_ENTRADA}, as mais recentes, da mais antiga para a mais nova, e não repetem depois`, async () => {
    // 7 vendas na janela (a API manda da mais nova para a mais antiga): as 2 mais antigas ficam de fora.
    const vendas = Array.from({ length: 7 }, (_, i) =>
      venda(`Célula ${i + 1}`, i + 1, (7 - i) * 60),
    );
    simularApi([...vendas].reverse());

    await abrir();
    expect(ligados).toHaveBeenLastCalledWith(true);
    expect(avisosNaTela().map(frase)).toEqual([
      "A Célula 3 vendeu 3 bilhetes!",
    ]);
    // O mesmo intervalo de 0,8 s e a mesma pilha (até 4 no computador) das vendas novas.
    await avancar(INTERVALO_ENTRE_AVISOS_MS);
    expect(avisosNaTela().map(frase)).toEqual([
      "A Célula 3 vendeu 3 bilhetes!",
      "A Célula 4 vendeu 4 bilhetes!",
    ]);
    const depois = await tudoQueApareceu(INTERVALO_CONSULTA_MS * 3);

    expect(consultas).toBe(4);
    expect([...new Set(depois.map(frase))]).toEqual([
      "A Célula 3 vendeu 3 bilhetes!",
      "A Célula 4 vendeu 4 bilhetes!",
      "A Célula 5 vendeu 5 bilhetes!",
      "A Célula 6 vendeu 6 bilhetes!",
      "A Célula 7 vendeu 7 bilhetes!",
    ]);
    expect(avisosNaTela()).toEqual([]);
    // A região viva existe desde o começo (o leitor de tela lê o que entra nela), sem roubar o foco.
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "polite");
    expect(document.activeElement).toBe(document.body);
  });

  it("RIFA-096: a linha menor diz há quanto tempo, pela `em` da venda e pelo `agora` do servidor (não pelo relógio do aparelho)", async () => {
    // O relógio do aparelho 2 dias adiantado: não muda nada.
    vi.setSystemTime(Date.parse(AGORA) + 2 * 24 * 60 * 60 * 1000);
    simularApi([
      venda("Bunker", 1, 59),
      venda("Shekinah", 2, 200),
      venda("Betel", 3, 600),
    ]);

    await abrir();
    await avancar(INTERVALO_ENTRE_AVISOS_MS * 2);

    expect(avisosNaTela()).toEqual([
      "A célula Betel vendeu 3 bilhetes! há 10 min · Projeto Videira Kids",
      "A célula Shekinah vendeu 2 bilhetes! há 3 min · Projeto Videira Kids",
      "A célula Bunker vendeu 1 bilhete! agora mesmo · Projeto Videira Kids",
    ]);
  });

  it("RIFA-096: o texto do tempo: menos de 1 min é 'agora mesmo'; depois, 'há N min' (1 a 10)", () => {
    const quando = (segundosAtras: number) =>
      TEXTOS.textoDoQuando(
        new Date(Date.parse(AGORA) - segundosAtras * 1000).toISOString(),
        AGORA,
      );
    expect([0, 30, 59.999, 60, 119, 120, 200, 599, 600].map(quando)).toEqual([
      "agora mesmo",
      "agora mesmo",
      "agora mesmo",
      "há 1 min",
      "há 1 min",
      "há 2 min",
      "há 3 min",
      "há 9 min",
      "há 10 min",
    ]);
    // A venda "depois" do agora (o relógio da Rifei adiantado) e um instante inválido não viram tempo negativo.
    expect(quando(-30)).toBe("agora mesmo");
    expect(TEXTOS.textoDoQuando("x", AGORA)).toBe("agora mesmo");
    expect(TEXTOS.linhaDoAviso(AGORA, AGORA)).toBe(
      "agora mesmo · Projeto Videira Kids",
    );
  });

  it("RIFA-096: ao voltar para a aba escondida, é como entrar de novo: até 5 das que chegaram, sem repetir as já mostradas", async () => {
    const vista = venda("Shekinah", 2, 30);
    // Enquanto a aba estava escondida, chegaram 7 vendas (da mais nova para a mais antiga, como a API manda).
    const chegaram = Array.from({ length: 7 }, (_, i) =>
      venda(`Célula ${i + 1}`, 1, 300 - i * 30),
    );
    simularApi([vista], [...[...chegaram].reverse(), vista]);

    await abrir();
    expect(avisosNaTela().map(frase)).toEqual([
      "A célula Shekinah vendeu 2 bilhetes!",
    ]);
    await avancar(TEMPO_NA_TELA_MS + TEMPO_DE_SAIDA_MS);
    expect(avisosNaTela()).toEqual([]);
    definirVisibilidade("hidden");
    await avancar(INTERVALO_CONSULTA_MS * 2);
    expect(consultas).toBe(1);

    definirVisibilidade("visible");
    const depois = await tudoQueApareceu(INTERVALO_CONSULTA_MS * 2);

    expect([...new Set(depois.map(frase))]).toEqual([
      "A Célula 3 vendeu 1 bilhete!",
      "A Célula 4 vendeu 1 bilhete!",
      "A Célula 5 vendeu 1 bilhete!",
      "A Célula 6 vendeu 1 bilhete!",
      "A Célula 7 vendeu 1 bilhete!",
    ]);
    expect(depois.map(linha)[0]).toBe("há 4 min · Projeto Videira Kids");
  });

  it("uma venda nova vira um aviso com a célula e os bilhetes", async () => {
    const nova = venda("Bunker", 3);
    simularApi([], [nova]);

    await abrir();
    expect(avisosNaTela()).toEqual([]);
    await proximaConsulta();

    expect(avisosNaTela()).toEqual([
      "A célula Bunker vendeu 3 bilhetes! agora mesmo · Projeto Videira Kids",
    ]);
    const aviso = screen.getByRole("log").firstElementChild!;
    expect(
      [...aviso.querySelectorAll("strong")].map((s) => s.textContent),
    ).toEqual(["Bunker", "3 bilhetes"]);
    expect(document.activeElement).toBe(document.body);
  });

  it("1 bilhete no singular; o nome que já começa com 'Célula' não repete a palavra", async () => {
    const um = venda("Célula Betel", 1);
    simularApi([], [um]);

    await abrir();
    await proximaConsulta();

    expect(avisosNaTela().map(frase)).toEqual([
      "A Célula Betel vendeu 1 bilhete!",
    ]);
  });

  it("duas compras da mesma célula viram dois avisos (um por compra), um depois do outro", async () => {
    const primeira = venda("Bunker", 3);
    const segunda = venda("Bunker", 5);
    // A API manda da mais nova para a mais antiga: a primeira compra entra primeiro.
    simularApi([], [segunda, primeira]);

    await abrir();
    await proximaConsulta();
    expect(avisosNaTela().map(frase)).toEqual([
      "A célula Bunker vendeu 3 bilhetes!",
    ]);

    await avancar(INTERVALO_ENTRE_AVISOS_MS);
    // O mais novo embaixo.
    expect(avisosNaTela().map(frase)).toEqual([
      "A célula Bunker vendeu 3 bilhetes!",
      "A célula Bunker vendeu 5 bilhetes!",
    ]);
  });

  it("cada aviso fica ~5 s e sai sozinho", async () => {
    simularApi([], [venda("Bunker", 3)]);

    await abrir();
    await proximaConsulta();
    expect(avisosNaTela()).toHaveLength(1);

    await avancar(TEMPO_NA_TELA_MS - 1);
    expect(avisosNaTela()).toHaveLength(1);
    await avancar(1);
    // Saindo (a animação), e depois fora da tela.
    expect(avisosNaTela()).toEqual([]);
    expect(document.querySelectorAll("[data-saindo]")).toHaveLength(1);
    await avancar(TEMPO_DE_SAIDA_MS);
    expect(document.querySelectorAll("[data-aviso-de-venda]")).toHaveLength(0);
  });

  it(`no computador, até ${VISIVEIS_NO_COMPUTADOR} empilhados; o próximo entra quando um sai`, async () => {
    const vendas = Array.from({ length: 6 }, (_, i) =>
      venda(`Célula ${i + 1}`, i + 1),
    );
    simularApi([], [...vendas].reverse());

    await abrir();
    await proximaConsulta();
    await avancar(INTERVALO_ENTRE_AVISOS_MS * 5);

    expect(avisosNaTela().map(frase)).toEqual([
      "A Célula 1 vendeu 1 bilhete!",
      "A Célula 2 vendeu 2 bilhetes!",
      "A Célula 3 vendeu 3 bilhetes!",
      "A Célula 4 vendeu 4 bilhetes!",
    ]);
    // O 1º sai (5 s depois de entrar) e o 5º entra no lugar dele.
    await avancar(
      TEMPO_NA_TELA_MS - INTERVALO_ENTRE_AVISOS_MS * 5 + TEMPO_DE_SAIDA_MS,
    );
    expect(avisosNaTela().map(frase)).toEqual([
      "A Célula 2 vendeu 2 bilhetes!",
      "A Célula 3 vendeu 3 bilhetes!",
      "A Célula 4 vendeu 4 bilhetes!",
      "A Célula 5 vendeu 5 bilhetes!",
    ]);
  });

  it(`no celular, até ${VISIVEIS_NO_CELULAR} empilhados`, async () => {
    simularTela(true);
    const vendas = Array.from({ length: 5 }, (_, i) =>
      venda(`Célula ${i + 1}`, 2),
    );
    simularApi([], [...vendas].reverse());

    await abrir();
    await proximaConsulta();
    await avancar(INTERVALO_ENTRE_AVISOS_MS * 4);

    expect(avisosNaTela().map(frase)).toEqual([
      "A Célula 1 vendeu 2 bilhetes!",
      "A Célula 2 vendeu 2 bilhetes!",
      "A Célula 3 vendeu 2 bilhetes!",
    ]);
  });

  it(`muitas de uma vez: a fila guarda as ${LIMITE_DA_FILA} mais novas, em ordem`, async () => {
    const vendas = Array.from({ length: 20 }, (_, i) =>
      venda(`Célula ${i + 1}`, 1),
    );
    simularApi([], [...vendas].reverse());

    await abrir();
    await proximaConsulta();
    const vistos = new Set<string>();
    for (let passo = 0; passo < 80; passo++) {
      for (const aviso of avisosNaTela()) vistos.add(frase(aviso));
      await avancar(500);
    }

    // As 20 chegam juntas: a fila fica com as 12 mais novas (9 a 20).
    expect([...vistos]).toEqual(
      vendas
        .slice(20 - LIMITE_DA_FILA)
        .map(({ celula }) => `A ${celula} vendeu 1 bilhete!`),
    );
  });

  it("com a aba escondida, não consulta; ao voltar, consulta na hora", async () => {
    simularApi([]);

    await abrir();
    expect(consultas).toBe(1);
    definirVisibilidade("hidden");
    await avancar(INTERVALO_CONSULTA_MS * 4);
    expect(consultas).toBe(1);

    definirVisibilidade("visible");
    await avancar(0);
    expect(consultas).toBe(2);
  });

  it("desligados na campanha: nada aparece e a tela sabe (para não mostrar o botão do som)", async () => {
    simularApi(false);

    await abrir();
    await proximaConsulta();

    expect(ligados).toHaveBeenLastCalledWith(false);
    expect(avisosNaTela()).toEqual([]);
  });
});

describe("RIFA-094: o plim e o botão 'Som das vendas'", () => {
  const botao = () => screen.getByRole("button", { name: "Som das vendas" });

  it("antes de um gesto na página, o aviso aparece sem som e nenhum áudio é criado", async () => {
    simularApi([], [venda("Bunker", 3)]);

    await abrir();
    await proximaConsulta();

    expect(avisosNaTela()).toHaveLength(1);
    expect(AudioContextFalso.criados).toHaveLength(0);
    expect(plins()).toBe(0);
  });

  it("depois de um toque na página, um plim por aviso, no momento em que cada um aparece", async () => {
    simularApi([], [venda("Bunker", 3), venda("Bunker", 1)]);

    await abrir();
    fireEvent.pointerDown(document.body);
    expect(AudioContextFalso.criados).toHaveLength(1);
    await proximaConsulta();
    expect(plins()).toBe(1);
    await avancar(INTERVALO_ENTRE_AVISOS_MS);
    expect(plins()).toBe(2);
    // Mais nenhum: um por aviso.
    await avancar(TEMPO_NA_TELA_MS * 2);
    expect(plins()).toBe(2);
  });

  it("RIFA-096: os avisos da entrada também tocam o plim, um por aviso (com o som liberado por um gesto)", async () => {
    simularApi([venda("Bunker", 1, 240), venda("Shekinah", 2, 120)]);

    ligados = vi.fn<(ligados: boolean) => void>();
    render(
      <>
        <AvisosDeVenda aoSaberSeLigados={ligados} />
        <BotaoSomDasVendas />
      </>,
    );
    // O toque vem antes de a 1ª resposta chegar.
    fireEvent.pointerDown(document.body);
    await avancar(0);

    expect(avisosNaTela()).toHaveLength(1);
    expect(plins()).toBe(1);
    await avancar(INTERVALO_ENTRE_AVISOS_MS);
    expect(avisosNaTela()).toHaveLength(2);
    expect(plins()).toBe(2);
  });

  it("RIFA-096: na volta à aba (o som já liberado), os avisos da entrada tocam o plim", async () => {
    simularApi([], [venda("Bunker", 1, 90), venda("Betel", 4, 100)]);

    await abrir();
    fireEvent.pointerDown(document.body);
    definirVisibilidade("hidden");
    definirVisibilidade("visible");
    await avancar(0);
    expect(avisosNaTela().map(frase)).toEqual([
      "A célula Betel vendeu 4 bilhetes!",
    ]);
    expect(plins()).toBe(1);
    await avancar(INTERVALO_ENTRE_AVISOS_MS);
    expect(plins()).toBe(2);
  });

  it("o botão alterna o som e guarda a escolha no aparelho; desligado, o aviso aparece em silêncio", async () => {
    simularApi([], [venda("Bunker", 3)]);

    await abrir();
    expect(botao()).toHaveAttribute("aria-pressed", "true");
    // O 1º toque no botão, com o áudio ainda bloqueado: libera e toca o plim de teste (não desliga).
    fireEvent.click(botao());
    await avancar(0);
    expect(botao()).toHaveAttribute("aria-pressed", "true");
    expect(plins()).toBe(1);

    fireEvent.click(botao());
    expect(botao()).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(CHAVE_SOM_DAS_VENDAS)).toBe("0");

    await proximaConsulta();
    expect(avisosNaTela()).toHaveLength(1);
    expect(plins()).toBe(1);

    fireEvent.click(botao());
    await avancar(0);
    expect(botao()).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(CHAVE_SOM_DAS_VENDAS)).toBe("1");
    // Ligar de novo toca o plim de teste.
    expect(plins()).toBe(2);
  });

  it("o botão tem dica (RIFA-045), e os textos públicos não têm senha, R$ nem a palavra rede (D30)", async () => {
    simularApi([]);

    await abrir();

    expect(controlesSemDica()).toEqual([]);
    const textos = [
      TEXTOS.linhaDoAviso(AGORA, AGORA),
      TEXTOS.linhaDoAviso("2026-12-01T14:53:00.000Z", AGORA),
      TEXTOS.ROTULO_SOM,
      ...Object.values(TEXTOS.DICAS_SOM),
    ];
    for (const texto of textos)
      expect(texto).not.toMatch(/@|1234|R\$|\brede\b/i);
  });

  it("a escolha guardada vale ao abrir a página de novo", async () => {
    window.localStorage.setItem(CHAVE_SOM_DAS_VENDAS, "0");
    simularApi([], [venda("Bunker", 3)]);

    await abrir();
    expect(botao()).toHaveAttribute("aria-pressed", "false");
    fireEvent.pointerDown(document.body);
    await proximaConsulta();

    expect(avisosNaTela()).toHaveLength(1);
    expect(plins()).toBe(0);
  });

  it("sem localStorage (janela anônima, bloqueado), o botão ainda alterna, só enquanto a página está aberta", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    simularApi([]);

    await abrir();
    fireEvent.click(botao());
    await avancar(0);
    fireEvent.click(botao());

    expect(botao()).toHaveAttribute("aria-pressed", "false");
    vi.restoreAllMocks();
  });
});
