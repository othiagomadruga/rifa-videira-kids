// Sprint 6 (D20), tela Campanha pela rota de verdade, com a API falsa de teste-apoio.ts:
// - CA1: as três chaves e as quatro mensagens do link pessoal são carregadas e salvas; a pré-visualização mostra o
//   texto final (preencherMensagem) e o modelo inválido é barrado antes de salvar;
// - CA2 (RIFA-030): o resumo "Regras da campanha" mostra cada decisão e o que falta preencher, e leva ao campo;
// - CA8: rótulos, descrição das chaves e a lista de erros com foco.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MENSAGENS_PADRAO,
  TIPOS_MENSAGEM,
  preencherMensagem,
} from "../../../shared/contracts";
import { renderizarRota } from "../../test/renderizar";
import { EXEMPLO_DA_MENSAGEM, linkDeExemplo } from "./RegrasDoAdmin";
import { CONFIGURADA, simularApi } from "./teste-apoio";

async function abrirTela() {
  const resultado = renderizarRota("/coordenacao/campanha");
  await screen.findByRole("heading", { level: 2, name: "Identificação" });
  return resultado;
}

const caixa = (nome: string) => screen.getByRole("checkbox", { name: nome });
const campoMensagem = (nome: string) =>
  screen.getByRole("textbox", { name: nome });
const previa = (nome: RegExp) => screen.getByRole("figure", { name: nome });

/** Os textos de cada linha do resumo: [nome, valor]. */
function linhasDoResumo() {
  const cartao = screen
    .getByRole("heading", { level: 2, name: "Regras da campanha" })
    .closest(".ui-card") as HTMLElement;
  return within(cartao)
    .getAllByRole("term")
    .map((termo) => [
      termo.textContent,
      termo.nextElementSibling?.textContent?.replace(/\u00a0/g, " "),
    ]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CA1: as chaves da campanha", () => {
  it("carregam como estão salvas, cada uma com o que acontece ligada e desligada (descrição do campo)", async () => {
    simularApi({
      campanha: {
        ...CONFIGURADA,
        pedidos: { desconsiderar: true },
        acesso: { discipuladores: true, redes: false },
      },
    });

    await abrirTela();

    expect(caixa("Permitir desconsiderar pedidos")).toBeChecked();
    expect(caixa("Acesso dos discipuladores")).toBeChecked();
    expect(caixa("Acesso das redes")).not.toBeChecked();
    expect(caixa("Permitir desconsiderar pedidos")).toHaveAccessibleDescription(
      /^Ligada: o admin tira das contas um pedido de teste, fraude ou estorno \(e desfaz\), na tela Pedidos\. Desligada: ninguém desconsidera nem desfaz; o que já foi desconsiderado continua fora das contas\.$/,
    );
    expect(caixa("Acesso das redes")).toHaveAccessibleDescription(
      /^Desligado: elas não entram nem recebem link novo; os links guardados voltam a valer quando religar\. Ligado: /,
    );
  });

  it("sem campanha: os padrões do contrato (desconsiderar desligado, os dois acessos ligados)", async () => {
    simularApi();

    await abrirTela();

    expect(caixa("Permitir desconsiderar pedidos")).not.toBeChecked();
    expect(caixa("Acesso dos discipuladores")).toBeChecked();
    expect(caixa("Acesso das redes")).toBeChecked();
    for (const tipo of TIPOS_MENSAGEM)
      expect(
        screen.getByDisplayValue(
          (_valor, elemento) =>
            (elemento as HTMLTextAreaElement | null)?.value ===
            MENSAGENS_PADRAO[tipo],
        ),
      ).toBeInTheDocument();
  });

  it("salvas no PUT (o grupo inteiro) e carregadas da resposta", async () => {
    const { puts } = simularApi({ campanha: CONFIGURADA });
    await abrirTela();

    fireEvent.click(caixa("Permitir desconsiderar pedidos"));
    fireEvent.click(caixa("Acesso dos discipuladores"));
    const novoModelo = "{saudacao} Rede {alvo}, entre por aqui:\n{link}";
    fireEvent.change(campoMensagem("Mensagem do link da rede"), {
      target: { value: novoModelo },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText("Alterações salvas.")).toBeInTheDocument();
    expect(puts()).toHaveLength(1);
    expect(puts()[0].corpo).toMatchObject({
      pedidos: { desconsiderar: true },
      acesso: { discipuladores: false, redes: true },
      mensagens: { ...MENSAGENS_PADRAO, link_rede: novoModelo },
    });
    // A resposta (o que a API gravou) volta para o formulário e para o resumo.
    expect(caixa("Permitir desconsiderar pedidos")).toBeChecked();
    expect(caixa("Acesso dos discipuladores")).not.toBeChecked();
    expect(campoMensagem("Mensagem do link da rede")).toHaveValue(novoModelo);
    expect(linhasDoResumo()).toEqual(
      expect.arrayContaining([
        [
          "Desconsiderar pedidos",
          "Ligado: o admin pode tirar das contas um pedido de teste, fraude ou estorno.",
        ],
        [
          "Acesso de discipuladores",
          "Desligado: não entram nem recebem link novo.",
        ],
        [
          "Mensagens do link pessoal",
          "1 editada; as outras com o texto padrão.",
        ],
      ]),
    );
  });
});

describe("o link para uma chave (aviso da tela Pedidos)", () => {
  it("abre a Campanha com o foco no campo do endereço (#campanha-pedidos-desconsiderar)", async () => {
    simularApi({ campanha: CONFIGURADA });

    renderizarRota("/coordenacao/campanha#campanha-pedidos-desconsiderar");

    const chave = await screen.findByRole("checkbox", {
      name: "Permitir desconsiderar pedidos",
    });
    await waitFor(() => expect(chave).toHaveFocus());
  });
});

describe("CA1: as mensagens do link pessoal", () => {
  it("cada modelo salvo aparece no campo, com a pré-visualização já preenchida (nomes e link de exemplo)", async () => {
    const modeloLider =
      "{saudacao} Acompanhe a {alvo} por este link, que é só seu:\n{link}";
    simularApi({
      campanha: {
        ...CONFIGURADA,
        mensagens: { ...MENSAGENS_PADRAO, link_lider: modeloLider },
      },
    });

    await abrirTela();

    expect(campoMensagem("Mensagem do link do líder de célula")).toHaveValue(
      modeloLider,
    );
    expect(
      within(previa(/mensagem do link do líder de célula/)).getByText(
        /Olá, Ana!/,
      ).textContent,
    ).toBe(
      `Olá, Ana! Acompanhe a Célula Ágape por este link, que é só seu:\n${linkDeExemplo()}`,
    );
    // As outras, com o padrão, mostram o texto de hoje.
    for (const tipo of ["link_coordenacao", "link_rede"] as const) {
      const figura = screen.getAllByRole("figure").find((elemento) =>
        elemento.textContent?.includes(
          preencherMensagem(MENSAGENS_PADRAO[tipo], {
            ...EXEMPLO_DA_MENSAGEM[tipo],
            url: linkDeExemplo(),
          }),
        ),
      );
      expect(figura, tipo).toBeDefined();
    }
  });

  it("a pré-visualização acompanha a digitação, e 'Voltar ao texto padrão' devolve o padrão e o foco ao campo", async () => {
    simularApi({ campanha: CONFIGURADA });
    await abrirTela();
    const campo = campoMensagem("Mensagem do link da coordenação");

    fireEvent.change(campo, {
      target: { value: "{saudacao} ({nome}) Seu acesso: {link}" },
    });

    expect(
      previa(/mensagem do link da coordenação/).querySelector("p")?.textContent,
    ).toBe(`Olá, Ana! (Ana) Seu acesso: ${linkDeExemplo()}`);
    const voltar = screen.getByRole("button", {
      name: "Voltar ao texto padrão da mensagem do link da coordenação",
    });
    expect(voltar).not.toHaveAttribute("aria-disabled");

    act(() => voltar.focus());
    fireEvent.click(voltar);

    expect(campo).toHaveValue(MENSAGENS_PADRAO.link_coordenacao);
    expect(campo).toHaveFocus();
    expect(voltar).toHaveAttribute("aria-disabled", "true");
    // Indisponível com a explicação: a contagem ao lado diz que já é o texto padrão.
    expect(voltar).toHaveAccessibleDescription(
      "115 de 1.000 caracteres · é o texto padrão",
    );
    expect(
      screen.getAllByText(/de 1\.000 caracteres · é o texto padrão/),
    ).toHaveLength(4);
  });

  it("modelo inválido: os problemas aparecem enquanto digita e o 'Salvar' é barrado, sem chamar a API", async () => {
    const { puts } = simularApi({ campanha: CONFIGURADA });
    await abrirTela();
    const campo = campoMensagem("Mensagem do link da coordenação");

    fireEvent.change(campo, {
      target: { value: "Oi {Nome}, tudo bem? {alvo}" },
    });

    // Os problemas do contrato, em português, ligados ao campo (aria-invalid e descrição).
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAccessibleDescription(
      /Marcador \{Nome\} não existe nesta mensagem\. Use: \{nome\}, \{saudacao\}, \{link\}\. Marcador \{alvo\} não existe nesta mensagem\. Use: \{nome\}, \{saudacao\}, \{link\}\. A mensagem precisa ter \{link\}: é por ele que a pessoa entra\./,
    );

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    const resumo = await screen.findByRole("alert");
    expect(resumo).toHaveTextContent("Não foi possível salvar. Confira:");
    const link = within(resumo).getByRole("link", {
      name: "Mensagem do link da coordenação",
    });
    await waitFor(() => expect(resumo).toHaveFocus());
    fireEvent.click(link);
    expect(campo).toHaveFocus();
    expect(puts()).toEqual([]);
  });

  it("vazia ou longa demais também é barrada; um modelo gravado com problema já aparece com o problema", async () => {
    simularApi({
      campanha: {
        ...CONFIGURADA,
        // Gravado fora das regras (ex.: SQL à mão): a resposta confere só o tamanho.
        mensagens: { ...MENSAGENS_PADRAO, link_discipulador: "Oi {nomee}" },
      },
    });
    await abrirTela();

    expect(
      campoMensagem("Mensagem do link do discipulador"),
    ).toHaveAccessibleDescription(
      /Marcador \{nomee\} não existe nesta mensagem/,
    );

    fireEvent.change(campoMensagem("Mensagem do link da rede"), {
      target: { value: "   " },
    });
    fireEvent.change(campoMensagem("Mensagem do link do líder de célula"), {
      target: { value: `{link} ${"a".repeat(1000)}` },
    });

    expect(
      campoMensagem("Mensagem do link da rede"),
    ).toHaveAccessibleDescription(/Escreva a mensagem\./);
    expect(
      campoMensagem("Mensagem do link do líder de célula"),
    ).toHaveAccessibleDescription(
      /A mensagem passou de 1\.000 caracteres \(tem 1\.007\)\./,
    );
    expect(linhasDoResumo()).toEqual(
      expect.arrayContaining([
        [
          "Mensagens do link pessoal",
          "1 editada; as outras com o texto padrão. 1 tem problema: até corrigir, a tela Acessos usa o texto padrão.",
        ],
      ]),
    );
  });
});

describe("CA2 (RIFA-030): o resumo 'Regras da campanha'", () => {
  it("mostra cada decisão do PO com o valor que está valendo, em linguagem simples", async () => {
    simularApi({ campanha: CONFIGURADA });

    await abrirTela();

    expect(linhasDoResumo()).toEqual([
      [
        "Datas e períodos",
        "23/11/2026 a 16/12/2026: 24 dias em 3 períodos (10, 7 e 7 dias).",
      ],
      ["Preço do bilhete", "R$ 12,34"],
      [
        "Meta",
        "Em valor arrecadado: R$ 4.567,89 no total, divididos entre as células pelo número de pessoas.",
      ],
      [
        "Percentuais dos períodos",
        "Período 1: 35%, Período 2: 25% e Período 3: 45% (a soma dá 105%: o sistema divide cada um pela soma).",
      ],
      ["Critério do ranking", "Bilhetes vendidos."],
      [
        "O que o público vê",
        "Todas as posições do ranking, com o percentual da meta. Nunca valores em R$.",
      ],
      [
        "Desconsiderar pedidos",
        "Desligado: ninguém desconsidera nem desfaz agora.",
      ],
      ["Acesso de discipuladores", "Ligado: entram pelo link pessoal."],
      ["Acesso de redes", "Ligado: entram pelo link pessoal."],
      ["Mensagens do link pessoal", "As 4 com o texto padrão."],
    ]);
    expect(screen.queryByText(/Falta preencher/)).not.toBeInTheDocument();
  });

  it("sem campanha: destaca o que falta preencher, mostra os padrões e leva ao campo", async () => {
    simularApi();

    await abrirTela();

    expect(screen.getByText("Falta preencher 5 itens")).toBeInTheDocument();
    expect(linhasDoResumo()).toEqual([
      ["Datas e períodos", "Falta preencher"],
      ["Preço do bilhete", "Falta preencher"],
      ["Meta", "Falta preencher"],
      ["Percentuais dos períodos", "Falta preencher"],
      ["Critério do ranking", "Falta preencher"],
      [
        "O que o público vê",
        "As 3 primeiras posições do ranking, sem o percentual da meta. Nunca valores em R$. (padrão)",
      ],
      [
        "Desconsiderar pedidos",
        "Desligado: ninguém desconsidera nem desfaz agora. (padrão)",
      ],
      [
        "Acesso de discipuladores",
        "Ligado: entram pelo link pessoal. (padrão)",
      ],
      ["Acesso de redes", "Ligado: entram pelo link pessoal. (padrão)"],
      ["Mensagens do link pessoal", "As 4 com o texto padrão. (padrão)"],
    ]);

    const irPara = (nome: string) => {
      fireEvent.click(screen.getByRole("link", { name: nome }));
      return document.activeElement;
    };
    expect(irPara("Datas e períodos")).toBe(
      screen.getByLabelText("Data de início"),
    );
    expect(irPara("Preço do bilhete")).toBe(
      screen.getByLabelText("Preço do bilhete (R$)"),
    );
    expect(irPara("Meta")).toBe(screen.getByLabelText("Unidade da meta"));
    // Sem períodos no formulário, o caminho mais curto é o modelo de Santo André.
    expect(irPara("Percentuais dos períodos")).toBe(
      screen.getByRole("button", { name: /Usar o modelo de Santo André/ }),
    );
    expect(irPara("Critério do ranking")).toBe(
      screen.getByLabelText("Critério do ranking"),
    );
    expect(irPara("Acesso de redes")).toBe(caixa("Acesso das redes"));
    expect(irPara("Mensagens do link pessoal")).toBe(
      campoMensagem("Mensagem do link da coordenação"),
    );
  });
});
