// RIFA-045 CA4: toda tela da fase 1 tem dica em todos os botões e campos. A varredura (`controlesSemDica`, em
// test/dicas.ts) passa o mouse em cada botão, campo, aba, link com cara de botão e link do menu visível (com um
// diálogo aberto, só nele: o resto da página fica `inert`), espera o tempo da dica e confere a dica e que ela some
// ao tirar o mouse. Cada tela entra nos estados que mostram os outros botões (diálogos, confirmações, listas com
// "Carregar mais", filtros sem resultado, só leitura). A fase 2 acrescenta aqui as telas dela.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  respostaPedidosSuspeitosSchema,
  type PedidoSuspeito,
} from "../../../shared/contracts";
import { contarControles, controlesSemDica } from "../../test/dicas";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
  respostaJson,
} from "../../test/renderizar";
import { criarApiFalsa, link, pessoasExemplo } from "../acessos/teste-apoio";
import { CENARIOS, criarApiWebhook } from "../acessos/teste-apoio-webhook";
import {
  CONFIGURADA,
  simularApi as simularCampanha,
} from "../campanha/teste-apoio";
import {
  entrega,
  entregasEmSequencia,
  estado,
  pedido,
  pedidosVariados,
  simularApi as simularPedidos,
} from "../pedidos/teste-apoio";

/** Confere a página inteira (com os diálogos abertos): nenhum controle sem dica, e a varredura achou controles. */
function conferirDicas(minimo: number) {
  expect(contarControles()).toBeGreaterThanOrEqual(minimo);
  expect(controlesSemDica()).toEqual([]);
}

/** Foca e clica, como o toque e o Enter fazem no navegador (o jsdom não foca no clique). */
function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

const botao = (nome: string | RegExp) =>
  screen.getByRole("button", { name: nome });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Campanha", () => {
  async function abrir(usuario = ADMIN_DE_TESTE) {
    renderizarRota("/coordenacao/campanha", { usuario });
    await screen.findByRole(
      "heading",
      { level: 2, name: "Identificação" },
      { timeout: 5000 },
    );
  }

  it("admin, campanha configurada: o formulário, os períodos, as chaves, as mensagens (padrão e editada), a sugestão do slug e a confirmação da troca do slug", async () => {
    simularCampanha({ campanha: CONFIGURADA });
    await abrir();
    const mensagem = screen.getByLabelText("Mensagem do link da coordenação");
    fireEvent.change(mensagem, { target: { value: "Olá! {link}" } });
    fireEvent.change(screen.getByLabelText("Slug da campanha na Rifei"), {
      target: { value: "https://rifei.com.br/videira-kids" },
    });
    expect(botao("Usar só o slug")).toBeInTheDocument();
    // Um "Voltar ao texto padrão" disponível (o editado) e os outros indisponíveis (já no padrão).
    expect(
      screen
        .getAllByRole("button", { name: /^Voltar ao texto padrão/ })
        .filter((voltar) => voltar.getAttribute("aria-disabled") === "true"),
    ).toHaveLength(3);
    conferirDicas(30);

    fireEvent.click(botao("Usar só o slug"));
    fireEvent.click(botao("Salvar alterações"));
    expect(
      await screen.findByRole("alertdialog", {
        name: "Trocar o slug da campanha?",
      }),
    ).toBeInTheDocument();
    conferirDicas(30);
  });

  it("admin, sem campanha: 'Ativar a campanha', o modelo de Santo André e a confirmação da ativação", async () => {
    simularCampanha();
    await abrir();
    expect(botao("Ativar a campanha")).toBeInTheDocument();
    conferirDicas(20);

    const digitar = (rotulo: string, valor: string) =>
      fireEvent.change(screen.getByLabelText(rotulo), {
        target: { value: valor },
      });
    digitar("Nome da campanha", "Rifa de teste");
    digitar("Slug da campanha na Rifei", "rifa-teste");
    digitar("Data de início", "2026-11-23");
    fireEvent.click(botao(/Usar o modelo de Santo André/));
    digitar("Preço do bilhete (R$)", "12,34");
    digitar("Unidade da meta", "bilhetes");
    digitar("Regra da meta", "por_pessoa");
    digitar("Meta por pessoa (bilhetes)", "7");
    digitar("Critério do ranking", "percentual_meta");
    fireEvent.click(botao("Ativar a campanha"));
    expect(
      await screen.findByRole("alertdialog", { name: "Ativar a campanha?" }),
    ).toBeInTheDocument();
    conferirDicas(30);
  });

  it("coordenação: as chaves e as mensagens só leitura também têm dica (dizem por que estão indisponíveis)", async () => {
    simularCampanha({ campanha: CONFIGURADA });
    await abrir(USUARIO_DE_TESTE);
    expect(
      screen.getByRole("checkbox", { name: "Acesso das redes" }),
    ).toHaveAttribute("aria-disabled", "true");
    conferirDicas(25);
  });
});

describe("Pedidos", () => {
  const abrir = (caminho = "/coordenacao/pedidos") =>
    renderizarRota(caminho, { usuario: ADMIN_DE_TESTE });
  const tabela = () =>
    screen.findByRole(
      "table",
      { name: "Pedidos, do mais recente para o mais antigo" },
      { timeout: 5000 },
    );

  it("admin com a chave ligada: filtros, busca, 'Carregar mais', Desconsiderar, Desfazer, o selo Suspeito, o alerta com o link e os diálogos", async () => {
    const pedidos = pedidosVariados(60);
    pedidos[0] = { ...pedidos[0], suspeito: true };
    pedidos[1] = {
      ...pedidos[1],
      desconsiderado: {
        motivo: "teste",
        observacao: null,
        em: "2026-11-25T16:00:00.000Z",
      },
    };
    simularPedidos({
      pedidos,
      desconsiderar: true,
      estado: estado("erros_recentes", {
        ultimas_24h: {
          processado: 0,
          duplicado: 0,
          ignorado_outra_campanha: 0,
          ignorado_transicao: 0,
          erro_validacao: 2,
        },
      }),
    });
    abrir();
    await tabela();
    await screen.findByRole("link", { name: "Ver as entregas com erro" });
    expect(botao("Carregar mais")).toBeInTheDocument();
    await screen.findAllByRole("button", { name: /^Desconsiderar o pedido/ });
    conferirDicas(40);

    acionar(
      screen.getAllByRole("button", { name: /^Desconsiderar o pedido/ })[0],
    );
    const dialogo = await screen.findByRole("dialog", {
      name: /^Desconsiderar o pedido/,
    });
    conferirDicas(5);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    acionar(botao(/^Desfazer a desconsideração/));
    await screen.findByRole("alertdialog", { name: /^Desfazer: o pedido/ });
    conferirDicas(3);
  });

  it("busca sem resultado: 'Limpar busca' e 'Limpar filtros'", async () => {
    simularPedidos({ pedidos: [pedido(1)] });
    abrir("/coordenacao/pedidos?id=NAOEXISTE");
    await screen.findByText("Nenhum pedido com estes filtros.", undefined, {
      timeout: 5000,
    });
    expect(botao("Limpar busca")).toBeInTheDocument();
    expect(botao("Limpar filtros")).toBeInTheDocument();
    conferirDicas(10);
  });

  it("entregas do webhook: o filtro, 'Carregar mais' e, sem resultado, 'Ver todas as entregas'", async () => {
    simularPedidos({ entregas: entregasEmSequencia(60) });
    abrir("/coordenacao/pedidos?aba=entregas");
    await screen.findByRole(
      "button",
      { name: "Carregar mais" },
      { timeout: 5000 },
    );
    conferirDicas(10);
  });

  it("entregas filtradas sem resultado: 'Ver todas as entregas'", async () => {
    simularPedidos({ entregas: [entrega(1)] });
    abrir("/coordenacao/pedidos?aba=entregas&resultado=erro_validacao");
    await screen.findByRole(
      "button",
      { name: "Ver todas as entregas" },
      { timeout: 5000 },
    );
    conferirDicas(10);
  });
});

describe("Pedidos suspeitos", () => {
  const suspeito: PedidoSuspeito = {
    pedido_id: "PEDTESTE0001",
    affiliate_id: 1042,
    celula_id: 7,
    celula_nome: "Célula Ficticia 07",
    qtd_bilhetes: 300,
    total_centavos: 6000,
    esperado_centavos: 600000,
    motivos: [
      {
        caminho: ["numbers_count"],
        codigo: "quantidade_acima_do_teto",
        mensagem: "Mais de 200 bilhetes num pedido só",
        ocorrencias: 1,
      },
    ],
    aprovado_em: "2026-12-01T12:20:31.512Z",
    marcado_em: "2026-12-01T12:20:32.004Z",
    desconsiderado: null,
  };

  it("a lista (só o menu e a moldura têm botões) e o erro com 'Tentar de novo'", async () => {
    let falhar = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        falhar
          ? respostaJson(
              { erro: { codigo: "interno", mensagem: "Falhou" } },
              500,
            )
          : respostaJson(
              respostaPedidosSuspeitosSchema.parse({
                itens: [suspeito],
                total: 1,
              }),
            ),
      ),
    );
    const { unmount } = renderizarRota("/coordenacao/pedidos-suspeitos");
    await screen.findByRole("table", undefined, { timeout: 5000 });
    conferirDicas(12);
    unmount();

    falhar = true;
    renderizarRota("/coordenacao/pedidos-suspeitos");
    await screen.findByRole(
      "button",
      { name: "Tentar de novo" },
      { timeout: 5000 },
    );
    conferirDicas(12);
  });
});

describe("Acessos", () => {
  async function abrir(fetch: typeof globalThis.fetch) {
    vi.stubGlobal("fetch", fetch);
    renderizarRota("/coordenacao/acessos", { usuario: ADMIN_DE_TESTE });
    await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
  }

  it("aba Coordenação: os cartões, o aviso, 'Nova pessoa' e os diálogos (nova pessoa, link criado, revogar, desativar)", async () => {
    const pessoas = pessoasExemplo();
    pessoas[0].links = [link(1, { desta_sessao: true })];
    const api = criarApiFalsa(pessoas);
    await abrir(api.fetch);
    acionar(botao("Reativar acesso de Pastor Fictício"));
    // O aviso do resultado, com o × "Fechar aviso".
    await screen.findByRole("button", { name: "Fechar aviso" });
    conferirDicas(20);

    acionar(botao("Nova pessoa"));
    const nova = await screen.findByRole("dialog", { name: "Nova pessoa" });
    conferirDicas(6);
    fireEvent.change(within(nova).getByLabelText("Nome"), {
      target: { value: "Fábio Fictício" },
    });
    fireEvent.click(
      within(nova).getByRole("button", { name: "Criar e gerar link" }),
    );
    const criado = await screen.findByRole("dialog", {
      name: "Link de acesso de Fábio Fictício",
    });
    conferirDicas(5);
    fireEvent.click(within(criado).getByRole("button", { name: "Pronto" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    acionar(botao(/^Revogar link de Admin de Teste/));
    await screen.findByRole("alertdialog", {
      name: "Revogar o link deste aparelho?",
    });
    conferirDicas(3);
    fireEvent.click(botao("Cancelar"));

    acionar(botao("Desativar acesso de Felipe Coordenador"));
    await screen.findByRole("alertdialog", {
      name: "Desativar o acesso de Felipe Coordenador?",
    });
    conferirDicas(3);
  });

  it("aba Líderes, discipuladores e redes: a tabela, o lote, os links gerados, a confirmação de fechar e a troca de acesso", async () => {
    const api = criarApiFalsa();
    await abrir(api.fetch);
    acionar(
      screen.getByRole("tab", { name: "Líderes, discipuladores e redes" }),
    );
    await screen.findByRole(
      "table",
      { name: "Acessos: Líderes de célula" },
      { timeout: 5000 },
    );
    conferirDicas(20);

    acionar(botao(/^Gerar links para quem ainda não tem/));
    const gerados = await screen.findByRole("dialog", {
      name: /links? de acesso/i,
    });
    conferirDicas(5);
    fireEvent.click(within(gerados).getByRole("button", { name: "Pronto" }));
    await screen.findByRole("alertdialog", {
      name: "Fechar sem mandar todos os links?",
    });
    conferirDicas(3);
    fireEvent.click(botao("Fechar mesmo assim"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    acionar(screen.getAllByRole("button", { name: /^Trocar acesso de/ })[0]);
    await screen.findByRole("alertdialog", { name: /^Trocar o acesso de/ });
    conferirDicas(3);
  });

  it("aba Webhook da Rifei: a situação, a URL, o botão de gerar, a confirmação da troca e o token gerado", async () => {
    const api = criarApiWebhook(CENARIOS.segredo);
    await abrir(api.fetch);
    acionar(screen.getByRole("tab", { name: "Webhook da Rifei" }));
    await screen.findByRole(
      "heading",
      { level: 2, name: "Situação" },
      { timeout: 5000 },
    );
    conferirDicas(15);

    acionar(botao("Gerar token do webhook"));
    await screen.findByRole("alertdialog", {
      name: "Trocar o segredo do Worker por um token do site?",
    });
    conferirDicas(3);
    fireEvent.click(botao("Gerar token novo"));
    await screen.findByRole("button", { name: "Copiar token" });
    conferirDicas(15);
  });
});
