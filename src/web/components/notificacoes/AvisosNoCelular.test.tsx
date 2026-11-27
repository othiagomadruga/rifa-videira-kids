// RIFA-095 (D43), compacto desde a RIFA-096: o botão "Avisos no celular" com o navegador e a API falsos (o jsdom não
// tem service worker nem Push API). Os estados: sem suporte, desligado no servidor, iPhone fora do app (o balão), pedir
// permissão, ligado ("Avisos ligados", aria-pressed), negado (o balão com o como liberar), desligar e as falhas (no
// balão); o balão abre e fecha (X, Esc, toque fora, o próprio botão) e fica dentro da tela; a dica de cada estado
// (RIFA-045). Nenhum texto fixo na página além do rótulo do botão.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respostaEstadoNotificacoesSchema } from "../../../shared/contracts/notificacoes";
import {
  contarControles,
  controlesSemDica,
  textosDasDicas,
} from "../../test/dicas";
import {
  AvisosNoCelular,
  CHAVE_SINCRONIA,
  INTERVALO_SINCRONIA_MS,
  posicionarBalao,
} from "./AvisosNoCelular";
import type { ApiNotificacoes } from "./notificacoes-api";
import type {
  InscricaoDoNavegador,
  PushDoNavegador,
  SuporteDoNavegador,
} from "./navegador";
import { DICAS_AVISOS, TEXTOS_AVISOS } from "./textos";

const CHAVE = `B${"V".repeat(86)}`;
const INSCRICAO: InscricaoDoNavegador = {
  endpoint: "https://fcm.googleapis.com/fcm/send/aparelho-ficticio",
  p256dh: `B${"A".repeat(86)}`,
  auth: "A".repeat(22),
};
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15";

function criarApi(
  estado = { ligadas: true, chave_publica: CHAVE as string | null },
) {
  return {
    estado: vi.fn(async () => respostaEstadoNotificacoesSchema.parse(estado)),
    inscrever: vi.fn(async () => undefined),
    cancelar: vi.fn(async () => undefined),
  } satisfies ApiNotificacoes;
}

function criarNavegador({
  suporte = "pronto" as SuporteDoNavegador,
  permissao = "default" as NotificationPermission,
  inscricao = null as InscricaoDoNavegador | null,
  respostaDaPermissao = "granted" as NotificationPermission,
} = {}) {
  let atual = inscricao;
  let permissaoAtual = permissao;
  return {
    suporte: vi.fn(() => suporte),
    permissao: vi.fn(() => permissaoAtual),
    pedirPermissao: vi.fn(async () => {
      permissaoAtual = respostaDaPermissao;
      return respostaDaPermissao;
    }),
    registrar: vi.fn(async () => undefined),
    inscricaoAtual: vi.fn(async () => atual),
    inscrever: vi.fn(async (chave: string) => {
      expect(chave).toBe(CHAVE);
      atual = INSCRICAO;
      return INSCRICAO;
    }),
    cancelar: vi.fn(async () => {
      const endpoint = atual?.endpoint ?? null;
      atual = null;
      return endpoint;
    }),
  } satisfies PushDoNavegador;
}

function desenhar(
  navegador: PushDoNavegador,
  api: ApiNotificacoes,
  origem: "publico" | "minha" = "publico",
) {
  return render(
    <>
      <AvisosNoCelular origem={origem} navegador={navegador} api={api} />
      <p>Fora do botão</p>
    </>,
  );
}

/** O botão (o nome muda com o estado: "Avisos no celular", "Avisos ligados", "Ligando…", "Desligando…"). */
const botao = (nome: string) => screen.getByRole("button", { name: nome });
const acharBotao = (nome: string) =>
  screen.findByRole("button", { name: nome });
const balao = () =>
  screen.queryByRole("dialog", { name: TEXTOS_AVISOS.titulo });
const envoltorio = () => document.querySelector<HTMLElement>(".avisos-celular");

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quando o botão não aparece", () => {
  it("navegador sem suporte: nada na tela e nenhuma chamada à API", async () => {
    const api = criarApi();
    desenhar(criarNavegador({ suporte: "sem_suporte" }), api);
    await act(async () => {});
    expect(envoltorio()).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(api.estado).not.toHaveBeenCalled();
  });

  it("notificações desligadas no servidor (sem as chaves ou com a opção da campanha desligada): nada", async () => {
    const api = criarApi({ ligadas: false, chave_publica: null });
    const navegador = criarNavegador();
    desenhar(navegador, api);
    await waitFor(() => expect(api.estado).toHaveBeenCalledOnce());
    expect(envoltorio()).toBeNull();
    expect(navegador.registrar).not.toHaveBeenCalled();
  });

  it("a API não respondeu: o botão some (é um extra, a tela segue igual)", async () => {
    const api = criarApi();
    api.estado.mockRejectedValueOnce(new Error("sem conexão"));
    desenhar(criarNavegador(), api);
    await waitFor(() => expect(api.estado).toHaveBeenCalled());
    await act(async () => {});
    expect(envoltorio()).toBeNull();
  });
});

describe("o botão compacto (RIFA-096)", () => {
  it("do mesmo tamanho e estilo do 'Som das vendas' (secundário pequeno, com ícone), sem nenhum texto fixo além do rótulo", async () => {
    desenhar(criarNavegador(), criarApi());
    const ligar = await acharBotao(TEXTOS_AVISOS.rotulo);
    expect(ligar).toHaveClass(
      "ui-button",
      "ui-button--secundario",
      "ui-button--pequeno",
    );
    expect(ligar).toHaveAttribute("aria-pressed", "false");
    expect(ligar.querySelector("svg")).not.toBeNull();
    expect(envoltorio()?.textContent).toBe(TEXTOS_AVISOS.rotulo);
    expect(balao()).toBeNull();
  });
});

describe("iPhone fora do app da Tela de Início", () => {
  it("o toque abre o balão com a frase do PO, sem pedir nada; o X fecha e devolve o foco ao botão", async () => {
    const navegador = criarNavegador({ suporte: "iphone_fora_do_app" });
    desenhar(navegador, criarApi());
    const iphone = await acharBotao(TEXTOS_AVISOS.rotulo);
    expect(iphone).toHaveAttribute("aria-haspopup", "dialog");
    expect(iphone).toHaveAttribute("aria-expanded", "false");
    expect(iphone).not.toHaveAttribute("aria-pressed");
    expect(balao()).toBeNull();

    fireEvent.click(iphone);

    const aberto = balao()!;
    expect(aberto).toHaveAccessibleDescription(
      "No iPhone: Compartilhar → Adicionar à Tela de Início. Depois abra pelo ícone e toque aqui.",
    );
    expect(iphone).toHaveAttribute("aria-expanded", "true");
    expect(iphone).toHaveAttribute("aria-controls", aberto.id);
    // O foco vai para o X do balão (o leitor de tela lê o nome e a frase do diálogo).
    expect(document.activeElement).toBe(botao(TEXTOS_AVISOS.fechar));
    expect(navegador.pedirPermissao).not.toHaveBeenCalled();
    expect(navegador.registrar).not.toHaveBeenCalled();

    fireEvent.click(botao(TEXTOS_AVISOS.fechar));
    expect(balao()).toBeNull();
    expect(iphone).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(iphone);
  });

  it("o Esc fecha (o foco volta ao botão); um toque fora fecha; o próprio botão abre e fecha; um toque dentro do balão não fecha", async () => {
    desenhar(criarNavegador({ suporte: "iphone_fora_do_app" }), criarApi());
    const iphone = await acharBotao(TEXTOS_AVISOS.rotulo);

    fireEvent.click(iphone);
    expect(balao()).not.toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(balao()).toBeNull();
    expect(document.activeElement).toBe(iphone);

    fireEvent.click(iphone);
    fireEvent.pointerDown(balao()!.querySelector("p")!);
    expect(balao()).not.toBeNull();
    fireEvent.pointerDown(screen.getByText("Fora do botão"));
    expect(balao()).toBeNull();

    fireEvent.click(iphone);
    expect(balao()).not.toBeNull();
    fireEvent.pointerDown(iphone);
    fireEvent.click(iphone);
    expect(balao()).toBeNull();
  });
});

describe("pedir a permissão e ligar", () => {
  it("o toque pede a permissão, inscreve e o botão vira 'Avisos ligados' (aria-pressed, como o som)", async () => {
    const navegador = criarNavegador();
    const api = criarApi();
    desenhar(navegador, api, "minha");
    fireEvent.click(await acharBotao(TEXTOS_AVISOS.rotulo));
    expect(navegador.registrar).toHaveBeenCalledOnce();
    const ligado = await acharBotao(TEXTOS_AVISOS.ligado);
    expect(ligado).toHaveAttribute("aria-pressed", "true");
    expect(navegador.pedirPermissao).toHaveBeenCalledOnce();
    expect(navegador.inscrever).toHaveBeenCalledWith(CHAVE);
    expect(api.inscrever).toHaveBeenCalledWith(INSCRICAO, "minha");
    expect(envoltorio()).toHaveAttribute("data-estado", "ligado");
    expect(envoltorio()?.textContent).toBe(TEXTOS_AVISOS.ligado);
    expect(balao()).toBeNull();
    expect(
      Number(window.localStorage.getItem(CHAVE_SINCRONIA)),
    ).toBeGreaterThan(0);
  });

  it("enquanto liga, o botão diz 'Ligando…', fica indisponível e um segundo toque não faz nada", async () => {
    const navegador = criarNavegador();
    const api = criarApi();
    const segurar = Promise.withResolvers<undefined>();
    api.inscrever.mockImplementationOnce(() => segurar.promise);
    desenhar(navegador, api);
    fireEvent.click(await acharBotao(TEXTOS_AVISOS.rotulo));
    const ligando = await acharBotao(TEXTOS_AVISOS.ligando);
    expect(ligando).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(ligando);
    await act(async () => segurar.resolve(undefined));
    expect(await acharBotao(TEXTOS_AVISOS.ligado)).toBeInTheDocument();
    expect(navegador.pedirPermissao).toHaveBeenCalledOnce();
    expect(api.inscrever).toHaveBeenCalledOnce();
  });

  it("a pessoa fecha o pedido sem escolher: o botão continua, sem inscrever e sem balão", async () => {
    const navegador = criarNavegador({ respostaDaPermissao: "default" });
    const api = criarApi();
    desenhar(navegador, api);
    fireEvent.click(await acharBotao(TEXTOS_AVISOS.rotulo));
    await waitFor(() =>
      expect(botao(TEXTOS_AVISOS.rotulo)).not.toHaveAttribute("aria-disabled"),
    );
    expect(navegador.inscrever).not.toHaveBeenCalled();
    expect(api.inscrever).not.toHaveBeenCalled();
    expect(balao()).toBeNull();
  });

  it("a inscrição falhou (navegador ou API): o balão com a mensagem; o toque seguinte tenta de novo", async () => {
    const navegador = criarNavegador();
    const api = criarApi();
    api.inscrever.mockRejectedValueOnce(new Error("503"));
    desenhar(navegador, api);
    fireEvent.click(await acharBotao(TEXTOS_AVISOS.rotulo));
    await waitFor(() =>
      expect(balao()).toHaveAccessibleDescription(TEXTOS_AVISOS.falhouLigar),
    );
    fireEvent.click(botao(TEXTOS_AVISOS.rotulo));
    expect(await acharBotao(TEXTOS_AVISOS.ligado)).toBeInTheDocument();
    expect(balao()).toBeNull();
  });
});

describe("permissão negada", () => {
  it("negada ao pedir: o balão explica como liberar nas configurações do navegador; o botão abre e fecha o balão", async () => {
    const navegador = criarNavegador({ respostaDaPermissao: "denied" });
    desenhar(navegador, criarApi());
    fireEvent.click(await acharBotao(TEXTOS_AVISOS.rotulo));
    await waitFor(() =>
      expect(balao()).toHaveAccessibleDescription(TEXTOS_AVISOS.negado),
    );
    const negado = botao(TEXTOS_AVISOS.rotulo);
    expect(negado).toHaveAttribute("aria-expanded", "true");
    expect(envoltorio()).toHaveAttribute("data-estado", "negado");
    expect(navegador.inscrever).not.toHaveBeenCalled();

    fireEvent.click(botao(TEXTOS_AVISOS.fechar));
    expect(balao()).toBeNull();
    fireEvent.click(negado);
    expect(balao()).toHaveAccessibleDescription(TEXTOS_AVISOS.negado);
    expect(navegador.pedirPermissao).toHaveBeenCalledOnce();
  });

  it("já negada ao abrir (no iPhone, pelo app): o balão só abre no toque, com o caminho dos Ajustes", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(UA_IPHONE);
    desenhar(criarNavegador({ permissao: "denied" }), criarApi());
    const negado = await acharBotao(TEXTOS_AVISOS.rotulo);
    expect(balao()).toBeNull();
    fireEvent.click(negado);
    expect(balao()).toHaveAccessibleDescription(TEXTOS_AVISOS.negadoNoIphone);
  });
});

describe("ligado e desligar", () => {
  it("já inscrito: 'Avisos ligados', e manda a inscrição de novo no máximo uma vez por dia", async () => {
    const agora = 1_800_000_000_000;
    const api = criarApi();
    const navegador = () =>
      criarNavegador({ permissao: "granted", inscricao: INSCRICAO });
    const primeira = render(
      <AvisosNoCelular
        origem="publico"
        navegador={navegador()}
        api={api}
        agora={() => agora}
      />,
    );
    expect(await acharBotao(TEXTOS_AVISOS.ligado)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(api.inscrever).toHaveBeenCalledWith(INSCRICAO, "publico"),
    );
    primeira.unmount();

    render(
      <AvisosNoCelular
        origem="publico"
        navegador={navegador()}
        api={api}
        agora={() => agora + INTERVALO_SINCRONIA_MS - 1}
      />,
    );
    expect(await acharBotao(TEXTOS_AVISOS.ligado)).toBeInTheDocument();
    await act(async () => {});
    expect(api.inscrever).toHaveBeenCalledOnce();
  });

  it("a inscrição feita com outra chave VAPID (o servidor trocou a chave): o botão volta para ativar de novo", async () => {
    const api = criarApi();
    desenhar(
      criarNavegador({
        permissao: "granted",
        inscricao: { ...INSCRICAO, chave: `B${"Z".repeat(86)}` },
      }),
      api,
    );
    expect(await acharBotao(TEXTOS_AVISOS.rotulo)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(api.inscrever).not.toHaveBeenCalled();
  });

  it("o toque em 'Avisos ligados' desliga: cancela no navegador e na API e volta o botão", async () => {
    const navegador = criarNavegador({
      permissao: "granted",
      inscricao: INSCRICAO,
    });
    const api = criarApi();
    desenhar(navegador, api);
    fireEvent.click(await acharBotao(TEXTOS_AVISOS.ligado));
    expect(await acharBotao(TEXTOS_AVISOS.rotulo)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(navegador.cancelar).toHaveBeenCalledOnce();
    expect(api.cancelar).toHaveBeenCalledWith(INSCRICAO.endpoint);
  });

  it("enquanto desliga, 'Desligando…' indisponível; o navegador falhou: continua ligado, com a mensagem no balão", async () => {
    const navegador = criarNavegador({
      permissao: "granted",
      inscricao: INSCRICAO,
    });
    const segurar = Promise.withResolvers<string | null>();
    navegador.cancelar.mockImplementationOnce(() => segurar.promise);
    desenhar(navegador, criarApi());
    fireEvent.click(await acharBotao(TEXTOS_AVISOS.ligado));
    const desligando = await acharBotao(TEXTOS_AVISOS.desligando);
    expect(desligando).toHaveAttribute("aria-disabled", "true");
    expect(desligando).toHaveAttribute("aria-pressed", "true");
    await act(async () => segurar.reject(new Error("falhou")));
    expect(await acharBotao(TEXTOS_AVISOS.ligado)).toBeInTheDocument();
    expect(balao()).toHaveAccessibleDescription(TEXTOS_AVISOS.falhouDesligar);
  });

  it("a API falhou ao cancelar: o aparelho já saiu, o botão volta (o servidor apaga no próximo envio)", async () => {
    const navegador = criarNavegador({
      permissao: "granted",
      inscricao: INSCRICAO,
    });
    const api = criarApi();
    api.cancelar.mockRejectedValueOnce(new Error("sem conexão"));
    desenhar(navegador, api);
    fireEvent.click(await acharBotao(TEXTOS_AVISOS.ligado));
    expect(await acharBotao(TEXTOS_AVISOS.rotulo)).toBeInTheDocument();
    expect(balao()).toBeNull();
  });
});

describe("dicas (RIFA-045)", () => {
  it("cada estado tem a sua dica: ligar (pede a permissão), ocupado e desligar", async () => {
    const navegador = criarNavegador();
    const api = criarApi();
    const segurar = Promise.withResolvers<undefined>();
    api.inscrever.mockImplementationOnce(() => segurar.promise);
    desenhar(navegador, api);
    await acharBotao(TEXTOS_AVISOS.rotulo);
    expect(contarControles()).toBe(1);
    expect(controlesSemDica()).toEqual([]);
    expect(textosDasDicas()).toEqual([DICAS_AVISOS.ligar]);
    expect(DICAS_AVISOS.ligar).toMatch(/permissão/);

    fireEvent.click(botao(TEXTOS_AVISOS.rotulo));
    await acharBotao(TEXTOS_AVISOS.ligando);
    expect(textosDasDicas()).toEqual([DICAS_AVISOS.ocupado]);
    await act(async () => segurar.resolve(undefined));
    await acharBotao(TEXTOS_AVISOS.ligado);
    expect(textosDasDicas()).toEqual([DICAS_AVISOS.desligar]);
    expect(DICAS_AVISOS.desligar).toMatch(/desligar/);
  });

  it("iPhone e negado: a dica diz que o toque explica; o X do balão também tem dica", async () => {
    desenhar(criarNavegador({ suporte: "iphone_fora_do_app" }), criarApi());
    await acharBotao(TEXTOS_AVISOS.rotulo);
    expect(textosDasDicas()).toEqual([DICAS_AVISOS.iphone]);
    fireEvent.click(botao(TEXTOS_AVISOS.rotulo));
    expect(contarControles()).toBe(2);
    expect(controlesSemDica()).toEqual([]);
    expect(textosDasDicas()).toEqual([
      DICAS_AVISOS.iphone,
      DICAS_AVISOS.fechar,
    ]);
  });

  it("os textos não têm o comprador nem R$", () => {
    for (const texto of [
      ...Object.values(TEXTOS_AVISOS),
      ...Object.values(DICAS_AVISOS),
    ])
      expect(texto).not.toMatch(/R\$|comprador|@|1234/i);
  });
});

describe("o balão fica dentro da tela, com a seta no meio do botão", () => {
  function medir(esquerdaDoBotao: number, larguraDoBotao = 160) {
    const alvo = document.createElement("span");
    const balaoFalso = document.createElement("div");
    vi.spyOn(alvo, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({
        x: esquerdaDoBotao,
        y: 100,
        width: larguraDoBotao,
        height: 36,
      }),
    );
    Object.defineProperty(balaoFalso, "offsetWidth", { value: 288 });
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
      390,
    );
    posicionarBalao(alvo, balaoFalso);
    return {
      esquerda: balaoFalso.style.getPropertyValue("left"),
      seta: balaoFalso.style.getPropertyValue("--balao-seta"),
    };
  }

  it("centrado embaixo do botão quando cabe", () => {
    // Botão de 160 px a partir de 115: o meio em 195 (o meio da tela).
    expect(medir(115)).toEqual({ esquerda: "-64px", seta: "144px" });
  });

  it("botão na borda direita (a 390 px): o balão é empurrado para dentro, a 8 px da borda", () => {
    // 214 + x + 288 = 382 → x = -120; a seta continua no meio do botão (80 + 120).
    expect(medir(214)).toEqual({ esquerda: "-120px", seta: "200px" });
  });

  it("botão na borda esquerda (quebrou para a linha de baixo): o balão começa a 8 px da borda", () => {
    expect(medir(16)).toEqual({ esquerda: "-8px", seta: "88px" });
  });
});
