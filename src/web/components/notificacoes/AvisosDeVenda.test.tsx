// RIFA-095 (D43): o cartão "Avisos de venda no celular" com o navegador e a API falsos (o jsdom não tem service worker
// nem Push API). Os estados: sem suporte, desligado no servidor, iPhone fora do app, pedir permissão, ligado, negado,
// desligar e as falhas; e a dica de cada botão (RIFA-045).
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respostaEstadoNotificacoesSchema } from "../../../shared/contracts/notificacoes";
import { contarControles, controlesSemDica } from "../../test/dicas";
import {
  AvisosDeVenda,
  CHAVE_SINCRONIA,
  INTERVALO_SINCRONIA_MS,
} from "./AvisosDeVenda";
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
    <AvisosDeVenda origem={origem} navegador={navegador} api={api} />,
  );
}

const cartao = () =>
  screen.queryByRole("region", { name: TEXTOS_AVISOS.titulo });
const botao = (nome: string) => screen.getByRole("button", { name: nome });

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quando o cartão não aparece", () => {
  it("navegador sem suporte: nada na tela e nenhuma chamada à API", async () => {
    const api = criarApi();
    const { container } = desenhar(
      criarNavegador({ suporte: "sem_suporte" }),
      api,
    );
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(api.estado).not.toHaveBeenCalled();
  });

  it("notificações desligadas no servidor (sem as chaves ou com a opção da campanha desligada): nada", async () => {
    const api = criarApi({ ligadas: false, chave_publica: null });
    const navegador = criarNavegador();
    const { container } = desenhar(navegador, api);
    await waitFor(() => expect(api.estado).toHaveBeenCalledOnce());
    expect(container).toBeEmptyDOMElement();
    expect(navegador.registrar).not.toHaveBeenCalled();
  });

  it("a API não respondeu: o cartão some (é um extra, a tela segue igual)", async () => {
    const api = criarApi();
    api.estado.mockRejectedValueOnce(new Error("sem conexão"));
    const { container } = desenhar(criarNavegador(), api);
    await waitFor(() => expect(api.estado).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });
});

describe("iPhone fora do app da Tela de Início", () => {
  it("no lugar do botão, a explicação do PO; sem botão e sem pedir nada", async () => {
    const navegador = criarNavegador({ suporte: "iphone_fora_do_app" });
    desenhar(navegador, criarApi());
    expect(
      await screen.findByText(
        "No iPhone: toque em Compartilhar → Adicionar à Tela de Início, abra pelo ícone e ative aqui.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(navegador.pedirPermissao).not.toHaveBeenCalled();
    expect(navegador.registrar).not.toHaveBeenCalled();
  });
});

describe("pedir a permissão e ligar", () => {
  it("o botão 'Receber avisos de venda' pede a permissão, inscreve e mostra 'Avisos ligados neste aparelho'", async () => {
    const navegador = criarNavegador();
    const api = criarApi();
    desenhar(navegador, api, "minha");
    fireEvent.click(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.ligar }),
    );
    expect(navegador.registrar).toHaveBeenCalledOnce();
    expect(await screen.findByText(TEXTOS_AVISOS.ligado)).toBeInTheDocument();
    expect(navegador.pedirPermissao).toHaveBeenCalledOnce();
    expect(navegador.inscrever).toHaveBeenCalledWith(CHAVE);
    expect(api.inscrever).toHaveBeenCalledWith(INSCRICAO, "minha");
    expect(botao(TEXTOS_AVISOS.desligar)).toBeInTheDocument();
    expect(cartao()).toHaveAttribute("data-estado", "ligado");
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
    fireEvent.click(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.ligar }),
    );
    const ligando = await screen.findByRole("button", {
      name: TEXTOS_AVISOS.ligando,
    });
    expect(ligando).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(ligando);
    await act(async () => segurar.resolve(undefined));
    expect(await screen.findByText(TEXTOS_AVISOS.ligado)).toBeInTheDocument();
    expect(navegador.pedirPermissao).toHaveBeenCalledOnce();
    expect(api.inscrever).toHaveBeenCalledOnce();
  });

  it("a pessoa fecha o pedido sem escolher: o botão continua, sem inscrever", async () => {
    const navegador = criarNavegador({ respostaDaPermissao: "default" });
    const api = criarApi();
    desenhar(navegador, api);
    fireEvent.click(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.ligar }),
    );
    expect(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.ligar }),
    ).toBeInTheDocument();
    expect(navegador.inscrever).not.toHaveBeenCalled();
    expect(api.inscrever).not.toHaveBeenCalled();
  });

  it("a inscrição falhou (navegador ou API): a mensagem e o botão para tentar de novo", async () => {
    const navegador = criarNavegador();
    const api = criarApi();
    api.inscrever.mockRejectedValueOnce(new Error("503"));
    desenhar(navegador, api);
    fireEvent.click(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.ligar }),
    );
    expect(
      await screen.findByText(TEXTOS_AVISOS.falhouLigar),
    ).toBeInTheDocument();
    fireEvent.click(botao(TEXTOS_AVISOS.ligar));
    expect(await screen.findByText(TEXTOS_AVISOS.ligado)).toBeInTheDocument();
  });
});

describe("permissão negada", () => {
  it("negada ao pedir: explica como liberar, sem botão", async () => {
    const navegador = criarNavegador({ respostaDaPermissao: "denied" });
    desenhar(navegador, criarApi());
    fireEvent.click(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.ligar }),
    );
    expect(await screen.findByText(TEXTOS_AVISOS.negado)).toBeInTheDocument();
    expect(
      screen.getByText(TEXTOS_AVISOS.negadoComoLiberar),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(navegador.inscrever).not.toHaveBeenCalled();
  });

  it("já negada ao abrir: a explicação direto (no iPhone, pelos Ajustes)", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
    );
    desenhar(criarNavegador({ permissao: "denied" }), criarApi());
    expect(await screen.findByText(TEXTOS_AVISOS.negado)).toBeInTheDocument();
    expect(
      screen.getByText(TEXTOS_AVISOS.negadoComoLiberarNoIphone),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ligado e desligar", () => {
  it("já inscrito: 'Avisos ligados neste aparelho' + 'Desligar', e manda a inscrição de novo no máximo uma vez por dia", async () => {
    const agora = 1_800_000_000_000;
    const api = criarApi();
    const navegador = () =>
      criarNavegador({ permissao: "granted", inscricao: INSCRICAO });
    const primeira = render(
      <AvisosDeVenda
        origem="publico"
        navegador={navegador()}
        api={api}
        agora={() => agora}
      />,
    );
    expect(await screen.findByText(TEXTOS_AVISOS.ligado)).toBeInTheDocument();
    expect(botao(TEXTOS_AVISOS.desligar)).toBeInTheDocument();
    await waitFor(() =>
      expect(api.inscrever).toHaveBeenCalledWith(INSCRICAO, "publico"),
    );
    primeira.unmount();

    render(
      <AvisosDeVenda
        origem="publico"
        navegador={navegador()}
        api={api}
        agora={() => agora + INTERVALO_SINCRONIA_MS - 1}
      />,
    );
    expect(await screen.findByText(TEXTOS_AVISOS.ligado)).toBeInTheDocument();
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
    expect(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.ligar }),
    ).toBeInTheDocument();
    expect(api.inscrever).not.toHaveBeenCalled();
  });

  it("'Desligar' cancela no navegador e na API e volta o botão", async () => {
    const navegador = criarNavegador({
      permissao: "granted",
      inscricao: INSCRICAO,
    });
    const api = criarApi();
    desenhar(navegador, api);
    fireEvent.click(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.desligar }),
    );
    expect(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.ligar }),
    ).toBeInTheDocument();
    expect(navegador.cancelar).toHaveBeenCalledOnce();
    expect(api.cancelar).toHaveBeenCalledWith(INSCRICAO.endpoint);
  });

  it("o navegador falhou ao cancelar: continua ligado, com a mensagem", async () => {
    const navegador = criarNavegador({
      permissao: "granted",
      inscricao: INSCRICAO,
    });
    navegador.cancelar.mockRejectedValueOnce(new Error("falhou"));
    desenhar(navegador, criarApi());
    fireEvent.click(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.desligar }),
    );
    expect(
      await screen.findByText(TEXTOS_AVISOS.falhouDesligar),
    ).toBeInTheDocument();
    expect(botao(TEXTOS_AVISOS.desligar)).toBeInTheDocument();
  });

  it("a API falhou ao cancelar: o aparelho já saiu, o botão volta (o servidor apaga no próximo envio)", async () => {
    const navegador = criarNavegador({
      permissao: "granted",
      inscricao: INSCRICAO,
    });
    const api = criarApi();
    api.cancelar.mockRejectedValueOnce(new Error("sem conexão"));
    desenhar(navegador, api);
    fireEvent.click(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.desligar }),
    );
    expect(
      await screen.findByRole("button", { name: TEXTOS_AVISOS.ligar }),
    ).toBeInTheDocument();
  });
});

describe("dicas (RIFA-045)", () => {
  it("os botões 'Receber avisos de venda' e 'Desligar' têm dica", async () => {
    desenhar(criarNavegador(), criarApi());
    await screen.findByRole("button", { name: TEXTOS_AVISOS.ligar });
    expect(contarControles()).toBe(1);
    expect(controlesSemDica()).toEqual([]);
    fireEvent.click(botao(TEXTOS_AVISOS.ligar));
    await screen.findByRole("button", { name: TEXTOS_AVISOS.desligar });
    expect(controlesSemDica()).toEqual([]);
    expect(DICAS_AVISOS.ligar).toMatch(/permissão/);
  });
});
