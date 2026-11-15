// RIFA-056: na Conferência, o "Pagamento não registrado" (pago na Rifei, pendente ou expirado no sistema) ganha a
// mesma seleção e o mesmo botão de gravar da venda perdida, só para o admin: os marcados, o "Registrar pagamento"
// (indisponível com aria-disabled e a dica), a confirmação com a prévia da API, o aviso depois de gravar e o tipo no
// histórico. A coordenação só vê o grupo. Com a API falsa de teste-apoio.ts; todo dado é fictício.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlesSemDica, dicaDe, passarOMouse } from "../../test/dicas";
import {
  conferirIndisponivel,
  esperarDisponivel,
  lerCss,
} from "../../test/indisponivel";
import { ADMIN_DE_TESTE, renderizarRota } from "../../test/renderizar";
import {
  ANALISE_COM_PAGAMENTOS,
  ANALISE_DEPOIS_DOS_PAGAMENTOS,
  ANALISE_SO_PAGAMENTOS,
  CSV_EXEMPLO,
  PAGAMENTOS_GRAVADOS,
  PREVIA_PAGAMENTOS,
  RECUPERACOES_COM_PAGAMENTOS,
  TEXTOS_PESSOAIS_DO_EXEMPLO,
  criarApiFalsa,
  type ApiFalsa,
} from "./teste-apoio";
import { DICAS, DIVERGENCIAS, OBSERVACOES, PAGAMENTOS } from "./textos";

const CAMINHO = "/coordenacao/conferencia";
const ROTULO_ARQUIVO = "Arquivo exportado da Rifei (CSV)";
const TITULO_DO_GRUPO = "Pagamento não registrado";
const TEXTO_ANTIGO = "A conferência ainda não corrige este caso";
const CSS = [
  lerCss("components/ui/Button.css"),
  lerCss("pages/conferencia/conferencia.css"),
];

async function abrir(api: ApiFalsa, admin = true) {
  vi.stubGlobal("fetch", api.fetch);
  renderizarRota(CAMINHO, admin ? { usuario: ADMIN_DE_TESTE } : {});
  expect(await screen.findByLabelText(ROTULO_ARQUIVO)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(ROTULO_ARQUIVO), {
    target: {
      files: [new File([CSV_EXEMPLO], "pedidos.csv", { type: "text/csv" })],
    },
  });
  await screen.findByText("Resultado da conferência");
  return api;
}

const grupo = () => screen.getByRole("region", { name: TITULO_DO_GRUPO });
const botao = (nome: string | RegExp) =>
  screen.getByRole("button", { name: nome });
const caixa = (codigo: string) =>
  within(grupo()).getByRole("checkbox", {
    name: new RegExp(`Pedido ${codigo}`),
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RIFA-056: o admin marca como pagos os pagamentos não registrados", () => {
  it("a seleção: o texto novo (sem o 'ainda não corrige'), os dois lados de cada pedido, os que dá para marcar já marcados e o que não dá, com o motivo", async () => {
    await abrir(criarApiFalsa({ analises: [ANALISE_COM_PAGAMENTOS] }));

    expect(screen.queryByText(new RegExp(TEXTO_ANTIGO))).toBeNull();
    expect(
      within(grupo()).getByText(
        DIVERGENCIAS.pagamento_nao_registrado.explicacao,
      ),
    ).toBeInTheDocument();
    expect(
      within(grupo()).getByText(PAGAMENTOS.comoFunciona),
    ).toBeInTheDocument();
    expect(caixa("R-0005")).toBeChecked();
    expect(caixa("R-0009")).toBeChecked();
    expect(caixa("R-0010")).toBeDisabled();
    expect(caixa("R-0010")).not.toBeChecked();
    expect(
      within(grupo()).getByText(OBSERVACOES.valor_diferente),
    ).toBeInTheDocument();
    // Na Rifei e no sistema, lado a lado.
    expect(
      within(grupo()).getAllByText(/^No sistema: Pendente · 2 bilhetes/),
    ).toHaveLength(2);
    expect(
      within(grupo()).getByText(/^No sistema: Expirado · 2 bilhetes/),
    ).toBeInTheDocument();
    expect(
      within(grupo()).getAllByText(/^Na Rifei: Pago · 2 bilhetes · R\$ 40,00/),
    ).toHaveLength(2);
    // A dica de cada linha (com o mouse em cima) diz se dá para marcar.
    for (const [codigo, dica] of [
      ["R-0005", DICAS.pagamentoRecuperavel],
      ["R-0010", DICAS.pagamentoNaoRecuperavel],
    ] as const) {
      passarOMouse(caixa(codigo).closest("label")!);
      await waitFor(() =>
        expect(dicaDe(caixa(codigo))).toHaveTextContent(dica),
      );
    }
    // O botão do grupo, com a frase do que acontece; o das vendas perdidas não muda.
    const registrar = botao("Registrar 2 pagamentos");
    esperarDisponivel(registrar);
    expect(registrar).toHaveAccessibleDescription(
      "Antes de gravar, o sistema mostra o que vai mudar. Só o pedido pendente ou expirado muda; o que já está pago fica como está.",
    );
    passarOMouse(registrar);
    await waitFor(() =>
      expect(dicaDe(registrar)).toHaveTextContent(DICAS.registrarPagamentos),
    );
    esperarDisponivel(botao("Recuperar 3 vendas"));
    // Toda caixa e todo botão da tela têm dica.
    expect(controlesSemDica()).toEqual([]);
  });

  it("sem nada marcado, o 'Registrar pagamento' fica indisponível com aria-disabled (no Tab, com a dica) e não abre a confirmação; desmarcar não mexe nas vendas perdidas", async () => {
    const api = await abrir(
      criarApiFalsa({ analises: [ANALISE_COM_PAGAMENTOS] }),
    );
    fireEvent.click(
      within(grupo()).getByRole("button", { name: "Desmarcar todos" }),
    );
    expect(caixa("R-0005")).not.toBeChecked();
    const registrar = botao("Registrar pagamento");
    expect(registrar).toHaveAccessibleDescription(
      "Marque os pedidos que quer marcar como pagos.",
    );
    esperarDisponivel(botao("Recuperar 3 vendas"));

    await conferirIndisponivel(registrar, {
      dica: DICAS.recuperarIndisponivel,
      semEfeito: () => {
        expect(screen.queryByRole("alertdialog")).toBeNull();
        expect(api.de("/recuperar")).toEqual([]);
      },
      css: CSS,
    });

    fireEvent.click(
      within(grupo()).getByRole("button", { name: "Marcar todos" }),
    );
    esperarDisponivel(botao("Registrar 2 pagamentos"));
    fireEvent.click(caixa("R-0009"));
    esperarDisponivel(botao("Registrar 1 pagamento"));
  });

  it("a confirmação: a prévia da API (só os marcados deste grupo), o que muda e o que fica de fora; gravar mostra o aviso e confere de novo", async () => {
    let vezes = 0;
    const api = await abrir(
      criarApiFalsa({
        analises: [ANALISE_COM_PAGAMENTOS, ANALISE_DEPOIS_DOS_PAGAMENTOS],
        recuperar: ({ simular }) =>
          simular ? PREVIA_PAGAMENTOS : PAGAMENTOS_GRAVADOS,
        recuperacoes: () => (vezes++ === 0 ? [] : RECUPERACOES_COM_PAGAMENTOS),
      }),
    );

    fireEvent.click(botao("Registrar 2 pagamentos"));

    const dialogo = await screen.findByRole("alertdialog", {
      name: "Registrar 2 pagamentos?",
    });
    expect(dialogo).toHaveAccessibleDescription(
      "Confira os pedidos que vão passar a pagos. Só muda o pedido pendente ou expirado: ele ganha a data do pagamento do arquivo, e o resto dele fica como está.",
    );
    // Só os do grupo (as vendas perdidas marcadas ficam para o "Recuperar" delas).
    expect(api.de("/recuperar").map((chamada) => chamada.corpo)).toEqual([
      expect.objectContaining({ pedidos: ["R-0005", "R-0009"], simular: true }),
    ]);
    expect(
      await within(dialogo).findByText(
        /Vão passar a pagos 1 pedido: 1 pedido · 2 bilhetes · R\$ 40,00\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText(/Passa a contar no painel e no ranking/),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText(
        /2 bilhetes · R\$ 40,00 · Célula Ágape \(afiliado 101\)/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText(
        "Pendente ou expirado no sistema: passa a pago.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText(/o arquivo só tem o dia/),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText("1 pedido fica de fora:"),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText("Já está no sistema (nada foi mudado)"),
    ).toBeInTheDocument();
    const gravar = within(dialogo).getByRole("button", {
      name: "Gravar 1 pagamento",
    });
    passarOMouse(gravar);
    await waitFor(() =>
      expect(dicaDe(gravar)).toHaveTextContent(DICAS.gravarPagamentos),
    );

    fireEvent.click(gravar);

    expect(
      await screen.findByText("1 pagamento registrado"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.de("/recuperar")[1].corpo).toMatchObject({
      pedidos: ["R-0005"],
      simular: false,
    });
    expect(
      screen.getByText(/2 bilhetes já contam no painel e no ranking/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "1 pedido ficou de fora: já estavam pagos no sistema ou mudaram desde a conferência.",
      ),
    ).toBeInTheDocument();
    // Confere de novo: o que virou pago sai do grupo.
    await waitFor(() => expect(api.de("/analisar")).toHaveLength(2));
    await waitFor(() =>
      expect(
        within(grupo()).queryByRole("checkbox", { name: /Pedido R-0005/ }),
      ).toBeNull(),
    );
    // Os corpos enviados não têm dado pessoal do arquivo.
    const enviados = JSON.stringify(
      api.chamadas.map((chamada) => chamada.corpo),
    );
    for (const texto of TEXTOS_PESSOAIS_DO_EXEMPLO)
      expect(enviados).not.toContain(texto);
  });

  it("só pagamentos não registrados: o aviso do topo diz que estão pendentes ou expirados no sistema e manda registrar", async () => {
    await abrir(criarApiFalsa({ analises: [ANALISE_SO_PAGAMENTOS] }));
    expect(
      screen.getByText(
        "3 pedidos pagos na Rifei estão pendentes ou expirados no sistema",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Eles não contam no painel nem no ranking\. Veja em “Pagamento não registrado” e registre o pagamento\./,
      ),
    ).toBeInTheDocument();
  });

  it("o histórico mostra o tipo de cada recuperação e, com os dois tipos, os pedidos de cada um", async () => {
    vi.stubGlobal(
      "fetch",
      criarApiFalsa({ recuperacoes: () => RECUPERACOES_COM_PAGAMENTOS }).fetch,
    );
    renderizarRota(CAMINHO, { usuario: ADMIN_DE_TESTE });
    const tabela = await screen.findByRole("table", {
      name: "Recuperações feitas",
    });
    expect(
      within(tabela).getByRole("columnheader", { name: "Tipo" }),
    ).toBeInTheDocument();
    const linhas = within(tabela).getAllByRole("row").slice(1);
    expect(
      linhas.map((linha) => within(linha).getAllByRole("cell")[2].textContent),
    ).toEqual([
      "2 vendas perdidas e 1 pagamento registrado",
      "Pagamento registrado",
      "Vendas perdidas",
    ]);
    expect(
      within(linhas[0]).getByText(
        "Vendas perdidas: R-0101, R-0105. Pagamentos registrados: R-0005.",
      ),
    ).toBeInTheDocument();
    expect(within(linhas[1]).getByText("R-0009")).toBeInTheDocument();
  });
});

describe("RIFA-056: a coordenação só vê", () => {
  it("o grupo sem seleção nem botão, com o aviso de que só o admin marca; o Recuperar das vendas perdidas continua e não leva os pendentes", async () => {
    const api = await abrir(
      criarApiFalsa({ analises: [ANALISE_COM_PAGAMENTOS] }),
      false,
    );

    expect(within(grupo()).getByText(PAGAMENTOS.soAdmin)).toBeInTheDocument();
    expect(within(grupo()).queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Registrar/ })).toBeNull();
    expect(
      within(grupo()).getByRole("table", { name: TITULO_DO_GRUPO }),
    ).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(TEXTO_ANTIGO))).toBeNull();
    // O aviso do topo é o das vendas perdidas (há vendas perdidas), e o pendente não vai no Recuperar.
    fireEvent.click(botao("Recuperar 3 vendas"));
    await screen.findByRole("alertdialog");
    expect(api.de("/recuperar")[0].corpo).toMatchObject({
      pedidos: ["R-0101", "R-0102", "R-0105"],
    });
  });

  it("só pagamentos não registrados: o aviso do topo não manda registrar", async () => {
    await abrir(criarApiFalsa({ analises: [ANALISE_SO_PAGAMENTOS] }), false);
    expect(
      screen.getByText(
        /Eles não contam no painel nem no ranking\. Veja em “Pagamento não registrado”\.$/,
      ),
    ).toBeInTheDocument();
  });
});
