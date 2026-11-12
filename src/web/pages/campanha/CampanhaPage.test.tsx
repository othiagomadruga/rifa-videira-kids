// CA2 a CA4: tela /coordenacao/campanha pela rota de verdade, com a API simulada (fetch trocado).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACESSO_PADRAO,
  MENSAGENS_PADRAO,
  PEDIDOS_PADRAO,
  type CampanhaEntrada,
} from "../../../shared/contracts";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import {
  CONFIGURADA,
  NAO_ENCONTRADA,
  campanhaDaEntrada,
  simularApi,
} from "./teste-apoio";

async function abrirTela() {
  const resultado = renderizarRota("/coordenacao/campanha");
  await screen.findByRole("heading", { level: 2, name: "Identificação" });
  return resultado;
}

const campo = (rotulo: string) => screen.getByLabelText(rotulo);

function digitar(rotulo: string, valor: string) {
  fireEvent.change(campo(rotulo), { target: { value: valor } });
}

/** Preenche um formulário válido (valores fictícios) com os períodos do modelo de Santo André. */
function preencherFormularioValido() {
  digitar("Nome da campanha", "  Rifa de teste ");
  digitar("Slug da campanha na Rifei", "rifa-teste");
  digitar("Data de início", "2026-11-23");
  fireEvent.click(
    screen.getByRole("button", { name: /Usar o modelo de Santo André/ }),
  );
  digitar("Preço do bilhete (R$)", "12,34");
  digitar("Unidade da meta", "bilhetes");
  digitar("Regra da meta", "por_pessoa");
  digitar("Meta por pessoa (bilhetes)", "7");
  digitar("Critério do ranking", "percentual_meta");
}

/** Corpo que o formulário acima manda no PUT: centavos, pontos-base e os padrões do contrato. */
const CORPO_DO_FORMULARIO_VALIDO = {
  nome: "Rifa de teste",
  slug_rifei: "rifa-teste",
  fuso_horario: "America/Belem",
  data_inicio: "2026-11-23",
  preco_bilhete_centavos: 1234,
  meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 7 },
  periodos: [
    { nome: "Período 1", dias: 10, percentual_bp: 3500 },
    { nome: "Período 2", dias: 7, percentual_bp: 2500 },
    { nome: "Período 3", dias: 7, percentual_bp: 4500 },
  ],
  ranking: { criterio: "percentual_meta" },
  publico: { mostra_percentual_meta: false, limite_ranking: 3 },
  // Regras do admin (D20): sem campanha, o formulário manda os padrões.
  pedidos: { ...PEDIDOS_PADRAO },
  acesso: { ...ACESSO_PADRAO },
  mensagens: { ...MENSAGENS_PADRAO },
};

function periodo(numero: number) {
  return screen.getByRole("group", { name: `Período ${numero}` });
}

function botao(nome: string | RegExp) {
  return screen.getByRole("button", { name: nome });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CA2/CA4: carregar a campanha", () => {
  it("vazia (404): avisa que as vendas são ignoradas e mostra o formulário com os padrões do contrato", async () => {
    const { chamadas } = simularApi();

    await abrirTela();

    expect(
      screen.getByRole("heading", { level: 1, name: "Campanha" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Campanha · Rifa Videira Kids");
    expect(screen.getByText("Não ativada")).toBeInTheDocument();
    expect(
      screen.getByText(/o sistema ignora as vendas que chegam da Rifei/),
    ).toBeInTheDocument();
    expect(campo("Nome da campanha")).toHaveValue("");
    expect(campo("Slug da campanha na Rifei")).toHaveValue("");
    expect(campo("Data de início")).toHaveValue("");
    expect(campo("Fuso horário")).toHaveValue("America/Belem");
    expect(campo("Preço do bilhete (R$)")).toHaveValue("");
    expect(campo("Unidade da meta")).toHaveValue("");
    expect(campo("Regra da meta")).toHaveValue("");
    expect(campo("Critério do ranking")).toHaveValue("");
    expect(
      campo("Mostrar também o percentual da meta atingido"),
    ).not.toBeChecked();
    expect(campo("Quantas posições o público vê")).toHaveValue("3");
    expect(screen.getByText("Nenhum período ainda")).toBeInTheDocument();
    expect(botao("Ativar a campanha")).toBeInTheDocument();
    expect(chamadas).toEqual([
      { metodo: "GET", caminho: "/api/admin/campanha", corpo: undefined },
    ]);
  });

  it("configurada: preenche cada seção, com o preço em R$, as datas dos períodos e a soma", async () => {
    simularApi({ campanha: CONFIGURADA });

    await abrirTela();

    expect(screen.getByText("Ativa")).toBeInTheDocument();
    expect(screen.getByText(/As vendas da Rifei com o slug/)).toHaveTextContent(
      "As vendas da Rifei com o slug rifa-teste contam para esta campanha.",
    );
    expect(campo("Nome da campanha")).toHaveValue("Rifa de teste");
    expect(campo("Slug da campanha na Rifei")).toHaveValue("rifa-teste");
    expect(campo("Data de início")).toHaveValue("2026-11-23");
    expect(campo("Preço do bilhete (R$)")).toHaveValue("12,34");
    expect(campo("Preço do bilhete (R$)")).toHaveAccessibleDescription(
      "Cada bilhete custa R$\u00a012,34.",
    );
    expect(campo("Unidade da meta")).toHaveValue("centavos");
    expect(campo("Regra da meta")).toHaveValue("total_proporcional");
    expect(campo("Meta total da campanha (R$)")).toHaveValue("4.567,89");
    expect(campo("Critério do ranking")).toHaveValue("bilhetes");
    expect(campo("Mostrar também o percentual da meta atingido")).toBeChecked();
    expect(campo("Quantas posições o público vê")).toHaveValue("");

    const datas = [
      "23/11/2026 a 02/12/2026",
      "03/12/2026 a 09/12/2026",
      "10/12/2026 a 16/12/2026",
    ];
    datas.forEach((texto, indice) => {
      expect(within(periodo(indice + 1)).getByText(texto)).toBeInTheDocument();
    });
    expect(campo("Dias do período 1")).toHaveValue("10");
    expect(campo("Percentual (%) do período 3")).toHaveValue("45");
    expect(screen.getByText(/Data final:/).closest("p")).toHaveTextContent(
      "Data final: 16/12/2026 (24 dias a partir de 23/11/2026)",
    );
    expect(
      screen.getByText(/Soma dos percentuais:/).closest("p"),
    ).toHaveTextContent("Soma dos percentuais: 105%");
    expect(botao("Salvar alterações")).toBeInTheDocument();
  });

  it("falha ao carregar: mostra o erro da API e tenta de novo", async () => {
    let tentativas = 0;
    simularApi({
      aoCarregar: () =>
        ++tentativas === 1
          ? respostaJson(
              { erro: { codigo: "erro_interno", mensagem: "Erro interno" } },
              500,
            )
          : NAO_ENCONTRADA(),
    });

    renderizarRota("/coordenacao/campanha");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar a campanha.Erro interno",
    );
    fireEvent.click(botao("Tentar de novo"));
    expect(await screen.findByText("Não ativada")).toBeInTheDocument();
    expect(tentativas).toBe(2);
  });

  it("fase pelas datas, no fuso da campanha: antes do início diz quando começa", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T15:00:00.000Z"));
    simularApi({ campanha: CONFIGURADA });

    await abrirTela();

    expect(screen.getByText("Antes do início")).toBeInTheDocument();
    expect(
      screen.getByText(
        "As vendas começam em 23/11/2026 (faltam 17 dias) e vão até 16/12/2026.",
      ),
    ).toBeInTheDocument();
  });
});

describe("CA2: datas e períodos", () => {
  it("modelo de Santo André: 3 períodos de 10, 7 e 7 dias com 35/25/45%, datas e data final, sem mexer em preço e meta", async () => {
    simularApi();
    await abrirTela();
    digitar("Preço do bilhete (R$)", "9,99");
    digitar("Unidade da meta", "bilhetes");
    digitar("Valor da meta (bilhetes)", "5");

    fireEvent.click(botao(/Usar o modelo de Santo André/));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Períodos preenchidos com o modelo de Santo André. Preço e meta continuam como estavam.",
    );
    expect(
      [1, 2, 3].map((numero) => [
        (campo(`Nome do período ${numero}`) as HTMLInputElement).value,
        (campo(`Dias do período ${numero}`) as HTMLInputElement).value,
        (campo(`Percentual (%) do período ${numero}`) as HTMLInputElement)
          .value,
      ]),
    ).toEqual([
      ["Período 1", "10", "35"],
      ["Período 2", "7", "25"],
      ["Período 3", "7", "45"],
    ]);
    expect(screen.queryByRole("group", { name: "Período 4" })).toBeNull();
    expect(
      within(periodo(1)).getByText(
        "Informe a data de início para ver as datas",
      ),
    ).toBeInTheDocument();

    digitar("Data de início", "2026-11-23");

    expect(
      within(periodo(1)).getByText("23/11/2026 a 02/12/2026"),
    ).toBeInTheDocument();
    expect(
      within(periodo(2)).getByText("03/12/2026 a 09/12/2026"),
    ).toBeInTheDocument();
    expect(
      within(periodo(3)).getByText("10/12/2026 a 16/12/2026"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Data final:/).closest("p")).toHaveTextContent(
      "Data final: 16/12/2026 (24 dias a partir de 23/11/2026)",
    );
    expect(campo("Preço do bilhete (R$)")).toHaveValue("9,99");
    expect(campo("Unidade da meta")).toHaveValue("bilhetes");
    expect(campo("Valor da meta (bilhetes)")).toHaveValue("5");
  });

  it("soma diferente de 100%: mostra a soma e explica que o sistema normaliza; com 100% o aviso some", async () => {
    simularApi();
    await abrirTela();
    fireEvent.click(botao(/Usar o modelo de Santo André/));

    expect(
      screen.getByText(/Soma dos percentuais:/).closest("p"),
    ).toHaveTextContent("Soma dos percentuais: 105%");
    expect(screen.getByText(/o sistema normaliza/)).toHaveTextContent(
      "A soma dá 105%, e não 100%. Não tem problema: o sistema normaliza, isto é, divide cada percentual pela soma. Na prática, os períodos ficam com 33,3%, 23,8% e 42,9% da meta.",
    );

    digitar("Percentual (%) do período 3", "40");

    expect(
      screen.getByText(/Soma dos percentuais:/).closest("p"),
    ).toHaveTextContent("Soma dos percentuais: 100%");
    expect(screen.queryByText(/o sistema normaliza/)).toBeNull();
  });

  it("adicionar e remover períodos recalcula as datas e a data final", async () => {
    simularApi();
    await abrirTela();
    digitar("Data de início", "2026-12-28");

    fireEvent.click(botao("Adicionar período"));
    fireEvent.click(botao("Adicionar período"));
    digitar("Dias do período 1", "5");
    digitar("Dias do período 2", "3");

    expect(
      within(periodo(1)).getByText("28/12/2026 a 01/01/2027"),
    ).toBeInTheDocument();
    expect(
      within(periodo(2)).getByText("02/01/2027 a 04/01/2027"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Data final:/).closest("p")).toHaveTextContent(
      "Data final: 04/01/2027 (8 dias a partir de 28/12/2026)",
    );

    fireEvent.click(botao("Remover o período 1"));

    expect(campo("Dias do período 1")).toHaveValue("3");
    expect(
      within(periodo(1)).getByText("28/12/2026 a 30/12/2026"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Período 2" })).toBeNull();
  });
});

describe("CA2: slug, meta e público", () => {
  it("colar o link inteiro no slug sugere usar só a parte final", async () => {
    simularApi();
    await abrirTela();

    expect(campo("Slug da campanha na Rifei")).toHaveAccessibleDescription(
      /identificador da campanha no endereço dela na Rifei/,
    );
    digitar(
      "Slug da campanha na Rifei",
      "https://rifei.com.br/rifa-teste?ref=1",
    );
    fireEvent.click(botao("Usar só o slug"));

    expect(campo("Slug da campanha na Rifei")).toHaveValue("rifa-teste");
    expect(screen.queryByRole("button", { name: "Usar só o slug" })).toBeNull();
  });

  it("regra e unidade da meta mudam o rótulo e a explicação; o público nunca recebe opção em R$", async () => {
    simularApi();
    await abrirTela();

    digitar("Regra da meta", "fixa_por_celula");
    digitar("Unidade da meta", "centavos");
    digitar("Meta de cada célula (R$)", "1.500,5");

    expect(campo("Regra da meta")).toHaveAccessibleDescription(
      "Todas as células têm a mesma meta, qualquer que seja o tamanho.",
    );
    expect(campo("Meta de cada célula (R$)")).toHaveAccessibleDescription(
      "Meta de R$\u00a01.500,50.",
    );
    const publico = screen
      .getByRole("heading", { name: "O que o público vê" })
      .closest("div") as HTMLElement;
    expect(publico).toHaveTextContent(
      "Valores em R$ nunca aparecem para o público, com qualquer configuração.",
    );
    expect(within(publico).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(publico).getAllByRole("textbox")).toEqual([
      campo("Quantas posições o público vê"),
    ]);
  });
});

describe("CA3: ativar e salvar", () => {
  it("ativar pede confirmação explícita com o slug; 'Voltar e revisar' não chama a API", async () => {
    const { puts } = simularApi();
    await abrirTela();
    preencherFormularioValido();

    fireEvent.click(botao("Ativar a campanha"));

    const confirmacao = screen.getByRole("alertdialog", {
      name: "Ativar a campanha?",
    });
    expect(confirmacao).toHaveAccessibleDescription(
      /A partir de agora, as vendas da Rifei com o slug rifa-teste passam a contar para esta campanha/,
    );
    expect(
      within(confirmacao).getByRole("button", { name: "Voltar e revisar" }),
    ).toHaveFocus();

    fireEvent.click(
      within(confirmacao).getByRole("button", { name: "Voltar e revisar" }),
    );

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(botao("Ativar a campanha")).toHaveFocus();
    expect(puts()).toEqual([]);
  });

  it("confirmar ativa: PUT com centavos e pontos-base, mensagem de sucesso e a situação vira 'Ativa'", async () => {
    const { puts } = simularApi();
    await abrirTela();
    preencherFormularioValido();
    fireEvent.click(botao("Ativar a campanha"));

    fireEvent.click(botao("Sim, ativar a campanha"));

    expect(
      await screen.findByText(
        "Campanha ativada. A partir de agora, as vendas da Rifei com o slug rifa-teste contam para ela.",
      ),
    ).toHaveAttribute("role", "status");
    expect(puts()).toEqual([
      {
        metodo: "PUT",
        caminho: "/api/admin/campanha",
        corpo: CORPO_DO_FORMULARIO_VALIDO,
      },
    ]);
    expect(screen.getByText("Ativa")).toBeInTheDocument();
    expect(screen.queryByText("Não ativada")).toBeNull();
    expect(campo("Nome da campanha")).toHaveValue("Rifa de teste");
    await waitFor(() => expect(botao("Salvar alterações")).toHaveFocus());
  });

  it("enquanto salva, o formulário fica travado: nada digitado se perde quando a resposta chega", async () => {
    const resposta = Promise.withResolvers<Response>();
    simularApi({ aoSalvar: () => resposta.promise });
    await abrirTela();
    preencherFormularioValido();
    fireEvent.click(botao("Ativar a campanha"));

    fireEvent.click(botao("Sim, ativar a campanha"));

    expect(
      await screen.findByRole("button", { name: "Salvando…" }),
    ).toBeDisabled();
    expect(campo("Nome da campanha")).toBeDisabled();
    expect(campo("Dias do período 1")).toBeDisabled();
    resposta.resolve(
      respostaJson(
        campanhaDaEntrada(CORPO_DO_FORMULARIO_VALIDO as CampanhaEntrada),
      ),
    );
    expect(await screen.findByText(/^Campanha ativada\./)).toBeInTheDocument();
    expect(campo("Nome da campanha")).toBeEnabled();
  });

  it("campanha ativa com o mesmo slug: salva sem confirmação e mostra 'Alterações salvas.'", async () => {
    const { puts } = simularApi({ campanha: CONFIGURADA });
    await abrirTela();

    digitar("Preço do bilhete (R$)", "15");
    fireEvent.click(botao("Salvar alterações"));

    expect(await screen.findByText("Alterações salvas.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(puts()).toHaveLength(1);
    expect(puts()[0]?.corpo).toMatchObject({
      slug_rifei: "rifa-teste",
      preco_bilhete_centavos: 1500,
      meta: { unidade: "centavos", regra: "total_proporcional", valor: 456789 },
      publico: { mostra_percentual_meta: true, limite_ranking: null },
    });
    expect(campo("Preço do bilhete (R$)")).toHaveValue("15,00");
  });

  it("trocar o slug de uma campanha ativa pede confirmação com o slug novo e o antigo", async () => {
    const { puts } = simularApi({ campanha: CONFIGURADA });
    await abrirTela();

    digitar("Slug da campanha na Rifei", "rifa-teste-2");
    fireEvent.click(botao("Salvar alterações"));

    expect(
      screen.getByRole("alertdialog", { name: "Trocar o slug da campanha?" }),
    ).toHaveAccessibleDescription(
      /só as vendas da Rifei com o slug rifa-teste-2 passam a contar. As que chegarem com o slug rifa-teste passam a ser ignoradas/,
    );
    expect(puts()).toEqual([]);

    fireEvent.click(botao("Sim, trocar o slug"));

    expect(
      await screen.findByText(
        "Alterações salvas. Agora contam as vendas da Rifei com o slug rifa-teste-2.",
      ),
    ).toBeInTheDocument();
    expect(puts()[0]?.corpo).toMatchObject({ slug_rifei: "rifa-teste-2" });
  });
});

describe("CA3/CA4: erros em português perto do campo", () => {
  it("validação do contrato no próprio navegador: mensagens nos campos, lista de erros e nenhuma chamada à API", async () => {
    const { puts } = simularApi();
    await abrirTela();
    digitar("Preço do bilhete (R$)", "doze reais");

    fireEvent.click(botao("Ativar a campanha"));

    const resumo = screen.getByRole("alert");
    expect(resumo).toHaveFocus();
    expect(resumo).toHaveTextContent("Não foi possível salvar. Confira:");
    const esperados: [string, string][] = [
      [
        "Nome da campanha",
        "Informe o nome da campanha, com até 120 caracteres.",
      ],
      [
        "Slug da campanha na Rifei",
        "Informe o slug da campanha na Rifei, com até 200 caracteres.",
      ],
      ["Data de início", "Informe uma data de início válida."],
      [
        "Preço do bilhete (R$)",
        "Use só números, com até 2 casas decimais. Ex.: 20,00.",
      ],
      ["Unidade da meta", "Escolha a unidade da meta."],
      ["Regra da meta", "Escolha a regra da meta."],
      ["Valor da meta", "Informe a meta."],
      ["Critério do ranking", "Escolha o critério do ranking."],
    ];
    for (const [rotulo, mensagem] of esperados) {
      expect(campo(rotulo)).toHaveAttribute("aria-invalid", "true");
      expect(campo(rotulo)).toHaveAccessibleDescription(
        expect.stringContaining(mensagem),
      );
      expect(resumo).toHaveTextContent(mensagem);
    }
    expect(
      screen.getByText("A campanha precisa de 1 a 53 períodos."),
    ).toBeInTheDocument();
    expect(
      within(resumo)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Nome da campanha",
      "Slug da campanha na Rifei",
      "Data de início",
      "Períodos",
      "Preço do bilhete",
      "Unidade da meta",
      "Regra da meta",
      "Valor da meta",
      "Critério do ranking",
    ]);
    fireEvent.click(
      within(resumo).getByRole("link", { name: "Preço do bilhete" }),
    );
    expect(campo("Preço do bilhete (R$)")).toHaveFocus();
    expect(puts()).toEqual([]);

    // Corrigir o campo tira o erro dele.
    digitar("Preço do bilhete (R$)", "12,34");
    expect(campo("Preço do bilhete (R$)")).not.toHaveAttribute("aria-invalid");
  });

  it("períodos: dias e percentual inválidos no campo do período; todos zerados dá a mensagem do contrato", async () => {
    const { puts } = simularApi();
    await abrirTela();
    preencherFormularioValido();
    digitar("Dias do período 2", "7,5");
    digitar("Percentual (%) do período 3", "150");

    fireEvent.click(botao("Ativar a campanha"));

    expect(campo("Dias do período 2")).toHaveAccessibleDescription(
      "Use um número inteiro de 1 a 366.",
    );
    expect(campo("Percentual (%) do período 3")).toHaveAccessibleDescription(
      "Use um percentual de 0 a 100.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Dias do período 2: Use um número inteiro de 1 a 366.",
    );

    for (const numero of [1, 2, 3]) {
      digitar(`Dias do período ${numero}`, "7");
      digitar(`Percentual (%) do período ${numero}`, "0");
    }
    fireEvent.click(botao("Ativar a campanha"));

    expect(
      screen.getAllByText(
        "Pelo menos um período precisa ter percentual maior que zero",
        { exact: false },
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Períodos: Pelo menos um período precisa ter percentual maior que zero",
    );
    expect(puts()).toEqual([]);
  });

  it("400 requisicao_invalida da API: cada problema vira a mensagem do campo, em português", async () => {
    simularApi({
      aoSalvar: () =>
        respostaJson(
          {
            erro: {
              codigo: "requisicao_invalida",
              mensagem: "Dados inválidos",
              detalhes: [
                {
                  caminho: ["slug_rifei"],
                  codigo: "too_big",
                  mensagem: "Too big: expected string to have <=200 characters",
                },
                {
                  caminho: ["periodos", 1, "dias"],
                  codigo: "too_big",
                  mensagem: "Too big: expected number to be <=366",
                },
              ],
            },
          },
          400,
        ),
    });
    await abrirTela();
    preencherFormularioValido();
    fireEvent.click(botao("Ativar a campanha"));

    fireEvent.click(botao("Sim, ativar a campanha"));

    const resumo = await screen.findByRole("alert");
    await waitFor(() => expect(resumo).toHaveFocus());
    expect(campo("Slug da campanha na Rifei")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(campo("Slug da campanha na Rifei")).toHaveAccessibleDescription(
      expect.stringContaining(
        "Informe o slug da campanha na Rifei, com até 200 caracteres.",
      ),
    );
    expect(campo("Dias do período 2")).toHaveAccessibleDescription(
      "Use um número inteiro de 1 a 366.",
    );
    expect(document.body).not.toHaveTextContent(/Too big|expected/);
    expect(screen.getByText("Não ativada")).toBeInTheDocument();
  });

  it("409 do slug (outra campanha) aparece no campo do slug com a mensagem da API", async () => {
    const mensagem =
      "Este slug já pertence a outra campanha (inativa) do sistema";
    simularApi({
      aoSalvar: () =>
        respostaJson(
          {
            erro: {
              codigo: "nome_duplicado",
              mensagem,
              detalhes: [
                { caminho: ["slug_rifei"], codigo: "slug_duplicado", mensagem },
              ],
            },
          },
          409,
        ),
    });
    await abrirTela();
    preencherFormularioValido();
    fireEvent.click(botao("Ativar a campanha"));
    fireEvent.click(botao("Sim, ativar a campanha"));

    await screen.findByRole("alert");
    expect(campo("Slug da campanha na Rifei")).toHaveAccessibleDescription(
      expect.stringContaining(mensagem),
    );
  });

  it("falha sem detalhes (500): mensagem geral, e o que foi digitado continua no formulário", async () => {
    simularApi({
      aoSalvar: () =>
        respostaJson(
          { erro: { codigo: "erro_interno", mensagem: "Erro interno" } },
          500,
        ),
    });
    await abrirTela();
    preencherFormularioValido();
    fireEvent.click(botao("Ativar a campanha"));
    fireEvent.click(botao("Sim, ativar a campanha"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível salvar. Erro interno",
    );
    expect(campo("Nome da campanha")).toHaveValue("  Rifa de teste ");
    expect(campo("Preço do bilhete (R$)")).toHaveValue("12,34");
    await waitFor(() => expect(botao("Ativar a campanha")).toBeEnabled());
  });
});
