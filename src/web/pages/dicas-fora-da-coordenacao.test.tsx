// RIFA-045 fase 2b: as telas fora da coordenação têm dica em todo botão e campo. Mesma varredura das fases 1 e 2a
// (pages/coordenacao/dicas.test.tsx e dicas-fase2.test.tsx): passa o mouse em cada botão, campo, aba, link com cara de
// botão e <summary> visível (com um diálogo aberto, só nele), espera o tempo da dica e confere a dica e que ela some
// ao tirar o mouse. Um caso por estado que mostra botões: a visão individual (/minha, com a moldura), o link pessoal
// (/acesso), a 404 e as falhas com "Tentar de novo" das telas abertas. As telas e os estados sem nenhum botão nem
// campo (o telão, /entrar, o ranking aberto e o /status carregados) também entram, para a regra valer se um botão
// aparecer nelas.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { respostaRankingPublicoSchema } from "../../shared/contracts/api";
import type {
  Divisao,
  JanelaRanking,
  ReferenciaCampanha,
} from "../../shared/contracts/calculos";
import {
  ATRASO_DA_DICA_MS,
  FOLGA_DA_DICA_MS,
  TITULO_SEM_CONEXAO,
} from "../components/ui";
import {
  contarControles,
  controlesSemDica,
  dicaDe,
  passarOMouse,
  tirarOMouse,
  titulosSemAjuda,
} from "../test/dicas";
import { esperarIndisponivel } from "../test/indisponivel";
import { renderizarRota, respostaJson } from "../test/renderizar";
import { DICAS as DICAS_ACESSO } from "./acesso/textos";
import {
  criarApiFalsa,
  respostaErro,
  sessaoDaVisao,
  visaoDe,
  type ApiFalsa,
} from "./minha/teste-apoio";
import { DICAS as DICAS_MINHA } from "./minha/textos";
import { DICAS_DA_MOLDURA } from "./minha/textos-moldura";
import { DICAS as DICAS_404 } from "./nao-encontrada/textos";

/** As telas com `lazy` (a visão individual e o QR code): o primeiro teste do arquivo carrega os pacotes. */
const ESPERA_DO_PACOTE = { timeout: 5000 };

/** Confere a página inteira (com os diálogos abertos): nenhum controle sem dica, e a varredura achou controles. */
const TELAS_COM_AJUDA = new Set(["Campanha"]);

async function conferirDicas(minimo: number) {
  expect(contarControles()).toBeGreaterThanOrEqual(minimo);
  expect(controlesSemDica()).toEqual([]);
  // RIFA-066: e todo título de seção e todo rótulo de campo com a explicação (mouse no título e toque no "?").
  // Enquanto as telas recebem a ajuda, uma por commit, a lista diz quais já têm (sai quando todas tiverem).
  const tela = document.querySelector("h1")?.textContent ?? "";
  if (TELAS_COM_AJUDA.has(tela)) expect(await titulosSemAjuda()).toEqual([]);
}

/** O texto da dica que abre com o mouse parado no controle (e some ao tirar o mouse), como na varredura. */
function textoDaDica(controle: Element): string | null {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    passarOMouse(controle);
    act(() => vi.advanceTimersByTime(ATRASO_DA_DICA_MS));
    const texto = dicaDe(controle)?.textContent ?? null;
    tirarOMouse(controle);
    act(() => vi.advanceTimersByTime(FOLGA_DA_DICA_MS));
    return texto;
  } finally {
    vi.useRealTimers();
  }
}

const botao = (nome: string | RegExp) =>
  screen.getByRole("button", { name: nome });

/** Uma resposta que nunca chega (o botão fica em "Saindo…", "Entrando…"...). Sair da tela no fim a descarta. */
const pendente = () => new Promise<Response>(() => {});

// As varreduras passam o mouse em cada controle, título e rótulo da tela e tocam em cada "?" (RIFA-066): com a
// máquina ocupada (a suíte inteira em paralelo), uma tela grande passa dos 5 s padrão do Vitest.
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("/minha (visão individual, com a moldura)", () => {
  type Papel = "lider" | "discipulador" | "rede";

  /** Abre a /minha do papel com a API falsa e espera a visão e o link de vendas carregarem. */
  async function abrir(papel: Papel = "lider", api?: ApiFalsa) {
    const visao = visaoDe({ papel });
    const falsa = api ?? criarApiFalsa(visao);
    vi.stubGlobal("fetch", falsa.fetch);
    renderizarRota("/minha", { usuario: sessaoDaVisao(visao) });
    await screen.findByRole(
      "heading",
      { level: 2, name: "Ranking" },
      ESPERA_DO_PACOTE,
    );
    await waitFor(() =>
      expect(screen.queryByText(/^Carregando o link de vendas/)).toBeNull(),
    );
    // O QR code do líder (outro pacote à parte) já desenhado, com "Baixar imagem" e "Imprimir".
    if (papel === "lider")
      await screen.findByRole(
        "button",
        { name: /^Baixar imagem/ },
        ESPERA_DO_PACOTE,
      );
    return falsa;
  }

  it("líder: Sair, 'Ver os dados em tabela' da curva e o cartão do link de vendas", async () => {
    await abrir("lider");
    expect(screen.getByText("Ver os dados em tabela")).toBeInTheDocument();
    await conferirDicas(7);
    expect(textoDaDica(botao("Sair"))).toBe(DICAS_DA_MOLDURA.sair);
    expect(textoDaDica(screen.getByText("Ver os dados em tabela"))).toBe(
      DICAS_MINHA.dadosDaCurva,
    );
  });

  it("discipulador: a equipe e os links das células, com 'Ver QR'", async () => {
    await abrir("discipulador");
    expect(
      screen.getAllByRole("button", { name: /^Ver QR code/ }).length,
    ).toBeGreaterThan(0);
    await conferirDicas(10);
  });

  it("rede: a equipe agrupada e os links de todas as células", async () => {
    await abrir("rede");
    expect(
      screen.getAllByRole("button", { name: /^Ver QR code/ }).length,
    ).toBeGreaterThan(1);
    await conferirDicas(14);
  });

  it("saindo: 'Saindo…' diz por que está indisponível", async () => {
    const api = criarApiFalsa(visaoDe());
    api.proxima("POST", "/api/sessao/sair", pendente);
    await abrir("lider", api);
    fireEvent.click(botao("Sair"));
    const saindo = await screen.findByRole("button", { name: "Saindo…" });
    esperarIndisponivel(saindo);
    expect(textoDaDica(saindo)).toBe(DICAS_DA_MOLDURA.saindo);
    await conferirDicas(7);
  });

  it("falha ao carregar os números: 'Tentar de novo', com o Sair", async () => {
    const api = criarApiFalsa(visaoDe());
    api.proxima(
      "GET",
      "/api/minha/visao",
      respostaErro(500, "erro_interno", "Erro interno"),
    );
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/minha", { usuario: sessaoDaVisao(visaoDe()) });
    await screen.findByRole(
      "button",
      { name: "Tentar de novo" },
      ESPERA_DO_PACOTE,
    );
    expect(botao("Sair")).toBeInTheDocument();
    await conferirDicas(2);
  });

  it("sem conexão ao carregar os números (RIFA-051): o cartão neutro, com 'Tentar de novo' e o Sair", async () => {
    const api = criarApiFalsa(visaoDe());
    api.proxima("GET", "/api/minha/visao", () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/minha", { usuario: sessaoDaVisao(visaoDe()) });
    const tentar = await screen.findByRole(
      "button",
      { name: "Tentar de novo" },
      ESPERA_DO_PACOTE,
    );
    expect(tentar.closest(".ui-estado--conexao")).not.toBeNull();
    expect(botao("Sair")).toBeInTheDocument();
    await conferirDicas(2);
  });

  it("carregando os números (RIFA-051, o esqueleto): só o Sair, com a dica", async () => {
    const api = criarApiFalsa(visaoDe());
    api.proxima("GET", "/api/minha/visao", pendente);
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/minha", { usuario: sessaoDaVisao(visaoDe()) });
    await waitFor(() =>
      expect(api.chamadasA("GET", "/api/minha/visao")).toHaveLength(1),
    );
    expect(document.querySelector(".minha-moldura__esqueleto")).not.toBeNull();
    expect(contarControles()).toBe(1);
    await conferirDicas(1);
    expect(textoDaDica(botao("Sair"))).toBe(DICAS_DA_MOLDURA.sair);
  });

  it("falha ao conferir a sessão: 'Tentar de novo' na moldura", async () => {
    const visao = visaoDe();
    const api = criarApiFalsa(visao, sessaoDaVisao(visao));
    api.proxima("GET", "/api/sessao", () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", api.fetch);
    renderizarRota("/minha", { usuario: null });
    await screen.findByText("Não foi possível conferir o seu acesso.");
    await conferirDicas(1);
  });

  it("endereço desconhecido dentro de /minha: 'Voltar ao início' leva à visão", async () => {
    vi.stubGlobal("fetch", criarApiFalsa(visaoDe()).fetch);
    renderizarRota("/minha/nao-existe", { usuario: sessaoDaVisao(visaoDe()) });
    const voltar = await screen.findByRole("link", {
      name: "Voltar ao início",
    });
    await conferirDicas(2);
    expect(textoDaDica(voltar)).toBe(DICAS_404.voltarAoInicio["/minha"]);
  });
});

describe("/acesso (link pessoal)", () => {
  /** Token fictício no formato do contrato (43 caracteres base64url). */
  const TOKEN = "TokenFicticioDeTeste_0123456789-abcdefghijk";

  /** fetch simulado: POST /api/sessao responde com `aoEntrar`. */
  function abrir(aoEntrar: () => Promise<Response>, token = TOKEN) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (caminho: string, init?: RequestInit) =>
        (init?.method ?? "GET") === "POST" && caminho === "/api/sessao"
          ? aoEntrar()
          : respostaErro(404, "nao_encontrado", "Rota não encontrada"),
      ),
    );
    renderizarRota(`/acesso/${token}`, { usuario: null });
  }

  it("pronto: Entrar; entrando, 'Entrando…' diz por que está indisponível", async () => {
    abrir(pendente);
    const entrar = await screen.findByRole("button", { name: "Entrar" });
    await conferirDicas(1);
    expect(textoDaDica(entrar)).toBe(DICAS_ACESSO.entrar);

    fireEvent.click(entrar);
    const entrando = await screen.findByRole("button", { name: "Entrando…" });
    esperarIndisponivel(entrando);
    expect(textoDaDica(entrando)).toBe(DICAS_ACESSO.entrando);
    await conferirDicas(1);
  });

  it("falha ao entrar (sem conexão): o aviso e Entrar de novo", async () => {
    abrir(async () => {
      throw new TypeError("Failed to fetch");
    });
    fireEvent.click(await screen.findByRole("button", { name: "Entrar" }));
    await screen.findByText("Não foi possível entrar agora.");
    await conferirDicas(1);
  });

  it("link que não vale mais: sem botão nem campo", async () => {
    abrir(async () =>
      respostaErro(401, "nao_autenticado", "Link de acesso inválido"),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Entrar" }));
    await screen.findByText(
      "Este link não vale mais: peça um link novo à coordenação.",
    );
    expect(contarControles()).toBe(0);
  });

  it("link incompleto: sem botão nem campo", async () => {
    abrir(pendente, "curto-demais");
    await screen.findByText("Este link está incompleto.");
    expect(contarControles()).toBe(0);
  });
});

describe("/entrar", () => {
  it("sem sessão: só a explicação, sem botão nem campo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respostaErro(401, "nao_autenticado", "Sessão inválida"),
      ),
    );
    renderizarRota("/entrar", { usuario: null });
    await screen.findByRole("heading", { level: 2, name: "Como entrar" });
    expect(contarControles()).toBe(0);
  });
});

describe("telas abertas: ranking da campanha, telão, /status e a 404", () => {
  const DURANTE: ReferenciaCampanha = {
    data: "2026-12-04",
    fase: "durante",
    data_inicio: "2026-11-23",
    data_fim: "2026-12-16",
    duracao_dias: 24,
    dia_campanha: 12,
    dias_restantes: 13,
    dias_para_inicio: null,
    periodo: {
      ordem: 2,
      nome: "Semana 2",
      data_inicio: "2026-12-03",
      data_fim: "2026-12-09",
      dias: 7,
      dia_no_periodo: 2,
      dias_restantes: 6,
    },
  };

  /** fetch simulado do ranking aberto (o mesmo da página inicial e do telão); `falhar`: sem conexão. */
  function simularRanking({ falhar = false } = {}) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: string) => {
        const url = new URL(entrada, "http://localhost");
        if (url.pathname !== "/api/publico/ranking")
          return respostaErro(404, "nao_encontrado", "Rota inesperada");
        if (falhar) throw new TypeError("Failed to fetch");
        const periodo = url.searchParams.get("periodo") as JanelaRanking;
        const divisao = url.searchParams.get("divisao") as Divisao;
        return respostaJson(
          respostaRankingPublicoSchema.parse({
            nivel: "celula",
            divisao,
            janela:
              periodo === "atual"
                ? {
                    tipo: "atual",
                    ordem: 2,
                    nome: "Semana 2",
                    data_inicio: "2026-12-03",
                    data_fim: "2026-12-09",
                  }
                : {
                    tipo: "campanha",
                    ordem: null,
                    nome: "Campanha inteira",
                    data_inicio: "2026-11-23",
                    data_fim: "2026-12-16",
                  },
            criterio: "percentual_meta",
            referencia: DURANTE,
            itens: [
              { posicao: 1, nome: "Célula Ágape", divisao },
              { posicao: 2, nome: "Célula Betel", divisao },
            ],
            atualizado_em: "2026-12-04T18:30:00.000Z",
          }),
        );
      }),
    );
  }

  it("ranking da campanha (página inicial): carregado, sem botão nem campo; na falha, 'Tentar de novo'", async () => {
    simularRanking();
    const { unmount } = renderizarRota("/", { usuario: null });
    expect(await screen.findAllByText("Célula Ágape")).not.toHaveLength(0);
    expect(contarControles()).toBe(0);
    unmount();

    simularRanking({ falhar: true });
    renderizarRota("/", { usuario: null });
    await screen.findByRole("button", { name: "Tentar de novo" });
    await conferirDicas(1);
  });

  it("telão: sem botão nem campo, com o ranking e na falha (ele tenta de novo sozinho)", async () => {
    simularRanking();
    const { unmount } = renderizarRota("/telao", { usuario: null });
    expect(await screen.findAllByText("Célula Ágape")).not.toHaveLength(0);
    expect(contarControles()).toBe(0);
    unmount();

    simularRanking({ falhar: true });
    renderizarRota("/telao", { usuario: null });
    // Sem conexão (o fetch rejeita): o título neutro desde a RIFA-053.
    await screen.findByText(TITULO_SEM_CONEXAO);
    expect(contarControles()).toBe(0);
  });

  it("/status: com a API no ar, sem botão; na falha, 'Tentar de novo'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respostaJson({ ok: true, db: "ok", latenciaMs: 1 })),
    );
    const { unmount } = renderizarRota("/status", { usuario: null });
    await screen.findByText("API ok");
    expect(contarControles()).toBe(0);
    unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respostaJson({ ok: false, db: "erro" }, 503)),
    );
    renderizarRota("/status", { usuario: null });
    await screen.findByRole("button", { name: "Tentar de novo" });
    await conferirDicas(1);
  });

  it("404: 'Voltar ao início' diz para onde leva, nas telas abertas e na coordenação", async () => {
    const { unmount } = renderizarRota("/nao-existe", { usuario: null });
    const voltar = await screen.findByRole("link", {
      name: "Voltar ao início",
    });
    await conferirDicas(1);
    expect(textoDaDica(voltar)).toBe(DICAS_404.voltarAoInicio["/"]);
    unmount();

    // Na coordenação, dentro do menu (a Visão geral pede o alerta de webhook à API: responde vazio).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respostaErro(404, "nao_encontrado", "Rota")),
    );
    renderizarRota("/coordenacao/nao-existe");
    const voltarNaCoordenacao = await screen.findByRole("link", {
      name: "Voltar ao início",
    });
    await conferirDicas(13);
    expect(textoDaDica(voltarNaCoordenacao)).toBe(
      DICAS_404.voltarAoInicio["/coordenacao"],
    );
  });
});
