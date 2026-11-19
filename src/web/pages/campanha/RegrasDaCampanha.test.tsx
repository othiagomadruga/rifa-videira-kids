// Sprint 6 (D20), tela Campanha pela rota de verdade, com a API falsa de teste-apoio.ts:
// - CA1: as chaves (RIFA-064: também o login das células com senha) e as quatro mensagens do link pessoal são carregadas e salvas; a pré-visualização mostra o
//   texto final (preencherMensagem) e o modelo inválido é barrado antes de salvar;
// - CA2 (RIFA-030): o resumo "Regras da campanha" mostra cada decisão e o que falta preencher, e leva ao campo;
// - CA8: rótulos, descrição das chaves e a lista de erros com foco.
// - RIFA-042: pedidos, acesso e mensagens são só do admin: a coordenação os vê só leitura, com a explicação, e o PUT
//   dela não os manda; o modelo com o {link} colado ou com outro endereço é barrado antes de salvar.
// Os testes que editam as regras entram como admin (ADMIN_DE_TESTE); os da coordenação, com USUARIO_DE_TESTE.
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
import { conferirIndisponivel, lerCss } from "../../test/indisponivel";
import {
  ADMIN_DE_TESTE,
  USUARIO_DE_TESTE,
  renderizarRota,
} from "../../test/renderizar";
import {
  EXEMPLO_DA_MENSAGEM,
  TEXTO_SO_ADMIN,
  linkDeExemplo,
} from "./RegrasDoAdmin";
import { CONFIGURADA, simularApi } from "./teste-apoio";
import { DICAS } from "./textos";

async function abrirTela(usuario = ADMIN_DE_TESTE) {
  const resultado = renderizarRota("/coordenacao/campanha", { usuario });
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
        acesso: { discipuladores: true, redes: false, celulas_senha: true },
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
    // O admin edita: sem o aviso da coordenação, nada só leitura (RIFA-042).
    expect(screen.queryByText(TEXTO_SO_ADMIN)).not.toBeInTheDocument();
    expect(caixa("Acesso das redes")).not.toHaveAttribute("aria-disabled");
    expect(campoMensagem("Mensagem do link da rede")).not.toHaveAttribute(
      "readonly",
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
      acesso: { discipuladores: false, redes: true, celulas_senha: true },
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

describe("RIFA-061 (D27): a opção do ranking por divisão", () => {
  const ROTULO = "Separar o ranking por divisão (jovens e adultos)";

  it("sem campanha, ligada (o padrão), com a descrição do que acontece ligada e desligada", async () => {
    simularApi();
    await abrirTela();
    expect(caixa(ROTULO)).toBeChecked();
    expect(caixa(ROTULO)).toHaveAccessibleDescription(
      "Ligada: Jovens e Adultos disputam cada um o seu ranking, no telão, no ranking aberto, nos rankings e no bumbo. Desligada: um ranking só, com todas as células juntas, em todos esses lugares.",
    );
  });

  it("desmarcar e salvar manda por_divisao: false; o resumo e a descrição mudam com a resposta (admin e coordenação)", async () => {
    for (const usuario of [ADMIN_DE_TESTE, USUARIO_DE_TESTE]) {
      const { puts } = simularApi({ campanha: CONFIGURADA });
      const { unmount } = await abrirTela(usuario);
      expect(caixa(ROTULO)).not.toHaveAttribute("aria-disabled");
      fireEvent.click(caixa(ROTULO));
      fireEvent.click(
        screen.getByRole("button", { name: "Salvar alterações" }),
      );
      expect(await screen.findByText("Alterações salvas.")).toBeInTheDocument();
      expect(puts()[0].corpo).toMatchObject({
        ranking: { criterio: "bilhetes", por_divisao: false },
      });
      expect(caixa(ROTULO)).not.toBeChecked();
      expect(caixa(ROTULO)).toHaveAccessibleDescription(
        /^Desligada: um ranking só, com todas as células juntas, em todos esses lugares\. Ligada: /,
      );
      expect(linhasDoResumo()).toEqual(
        expect.arrayContaining([
          [
            "Ranking por divisão",
            "Um ranking só, com todas as células juntas.",
          ],
        ]),
      );
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it("salva desligada, a caixa vem desmarcada, e o nome no resumo leva o foco a ela", async () => {
    simularApi({
      campanha: {
        ...CONFIGURADA,
        ranking: { criterio: "bilhetes", por_divisao: false },
      },
    });
    await abrirTela();
    expect(caixa(ROTULO)).not.toBeChecked();
    fireEvent.click(screen.getByRole("link", { name: "Ranking por divisão" }));
    expect(caixa(ROTULO)).toHaveFocus();
  });
});

describe("o link para uma chave (aviso da tela Pedidos)", () => {
  it("abre a Campanha com o foco no campo do endereço (#campanha-pedidos-desconsiderar)", async () => {
    simularApi({ campanha: CONFIGURADA });

    renderizarRota("/coordenacao/campanha#campanha-pedidos-desconsiderar", {
      usuario: ADMIN_DE_TESTE,
    });

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
    // RIFA-047: no Tab, com a dica do motivo e a cara do disabled (a regra geral do Button.css); nada muda.
    await conferirIndisponivel(voltar, {
      dica: DICAS.voltarAoPadraoJaEstaNele,
      semEfeito: () =>
        expect(campo).toHaveValue(MENSAGENS_PADRAO.link_coordenacao),
      css: [
        lerCss("components/ui/Button.css"),
        lerCss("pages/campanha/campanha.css"),
      ],
    });
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

describe("RIFA-064 (D29): o login das células com a senha padrão, na Campanha", () => {
  it("ligado por padrão, com o que acontece ligado e desligado; o admin desliga, o PUT manda e o resumo diz", async () => {
    const { puts } = simularApi({ campanha: CONFIGURADA });
    await abrirTela();

    const chave = caixa("Login das células com senha padrão");
    expect(chave).toBeChecked();
    expect(chave).toHaveAccessibleDescription(
      /^Ligado: cada célula entra com o nome dela e a senha @ \+ nome da célula \+ 1234 e vê só a página dela \(ranking, meta e link de vendas\)\. Desligado: ninguém entra pela senha, e quem entrou assim sai na hora; o link pessoal do líder continua\./,
    );
    fireEvent.click(chave);
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText("Alterações salvas.")).toBeInTheDocument();
    expect(puts()[0].corpo).toMatchObject({
      acesso: { discipuladores: true, redes: true, celulas_senha: false },
    });
    expect(caixa("Login das células com senha padrão")).not.toBeChecked();
    expect(linhasDoResumo()).toEqual(
      expect.arrayContaining([
        ["Login das células com senha", "Desligado: só pelo link pessoal."],
      ]),
    );
  });

  it("para a coordenação, só leitura (como as outras chaves do admin), e o PUT dela não manda a chave", async () => {
    const { puts } = simularApi({
      campanha: {
        ...CONFIGURADA,
        acesso: { discipuladores: true, redes: true, celulas_senha: false },
      },
    });
    await abrirTela(USUARIO_DE_TESTE);

    const chave = caixa("Login das células com senha padrão");
    expect(chave).not.toBeChecked();
    expect(chave).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(chave);
    expect(chave).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByText("Alterações salvas.")).toBeInTheDocument();
    expect(puts()[0].corpo).not.toHaveProperty("acesso");
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
      // RIFA-061 (D27): a linha nova da opção.
      [
        "Ranking por divisão",
        "Separado: Jovens e Adultos disputam cada um o seu ranking.",
      ],
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
      // RIFA-064 (D29).
      [
        "Login das células com senha",
        "Ligado: cada célula entra com o nome e a senha padrão.",
      ],
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
      // RIFA-061 (D27): a linha nova da opção, com o padrão.
      [
        "Ranking por divisão",
        "Separado: Jovens e Adultos disputam cada um o seu ranking. (padrão)",
      ],
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
      [
        "Login das células com senha",
        "Ligado: cada célula entra com o nome e a senha padrão. (padrão)",
      ],
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
    expect(irPara("Login das células com senha")).toBe(
      caixa("Login das células com senha padrão"),
    );
    expect(irPara("Mensagens do link pessoal")).toBe(
      campoMensagem("Mensagem do link da coordenação"),
    );
  });
});

// ---------------------------------------------------------------------------------------------------
// RIFA-042: pedidos, acesso e mensagens só do admin; o {link} colado e outro endereço barrados na tela
// ---------------------------------------------------------------------------------------------------

const EXPLICACAO_SO_ADMIN =
  "Só o admin muda estas regras. Aqui você vê como estão valendo. Para mudar, fale com o admin.";

describe("RIFA-042 (CA2): para a coordenação, pedidos, acesso e mensagens ficam só leitura", () => {
  const modeloLider = "{saudacao} A {alvo} acompanha a rifa por aqui:\n{link}";
  const SALVA = {
    ...CONFIGURADA,
    pedidos: { desconsiderar: true },
    acesso: { discipuladores: true, redes: false, celulas_senha: true },
    mensagens: { ...MENSAGENS_PADRAO, link_lider: modeloLider },
  };

  it("os três grupos aparecem como estão, só leitura, com a explicação 'Só o admin muda estas regras.'; o resumo continua", async () => {
    simularApi({ campanha: SALVA });
    await abrirTela(USUARIO_DE_TESTE);

    // Um aviso em cada cartão: "Pedidos e acessos" (pedidos e acesso) e "Mensagens do link pessoal".
    for (const titulo of ["Pedidos e acessos", "Mensagens do link pessoal"]) {
      const cartao = screen
        .getByRole("heading", { level: 2, name: titulo })
        .closest(".ui-card") as HTMLElement;
      expect(within(cartao).getByText(TEXTO_SO_ADMIN)).toBeInTheDocument();
    }

    // As chaves: como estão salvas, indisponíveis (focáveis) e descritas pelo aviso; o clique não muda nada.
    const esperadas = [
      ["Permitir desconsiderar pedidos", true],
      ["Acesso dos discipuladores", true],
      ["Acesso das redes", false],
    ] as const;
    for (const [nome, ligada] of esperadas) {
      const elemento = caixa(nome);
      expect({ nome, ligada: (elemento as HTMLInputElement).checked }).toEqual({
        nome,
        ligada,
      });
      expect(elemento).toHaveAttribute("aria-disabled", "true");
      expect(elemento).not.toBeDisabled();
      expect(elemento).toHaveAccessibleDescription(
        new RegExp(
          `^${EXPLICACAO_SO_ADMIN.replaceAll(".", "\\.")} (Ligad|Desligad)`,
        ),
      );
      fireEvent.click(elemento);
      expect({ nome, ligada: (elemento as HTMLInputElement).checked }).toEqual({
        nome,
        ligada,
      });
    }

    // As mensagens: os modelos salvos, só leitura e descritos pelo aviso (com a dica), sem "Voltar ao texto padrão";
    // a pré-visualização continua.
    for (const tipo of TIPOS_MENSAGEM) {
      const campo = screen.getByDisplayValue(
        (_valor, elemento) =>
          (elemento as HTMLTextAreaElement | null)?.value ===
          SALVA.mensagens[tipo],
      );
      expect(campo).toHaveAttribute("readonly");
      expect(campo).toHaveAccessibleDescription(
        new RegExp(
          `^${EXPLICACAO_SO_ADMIN.replaceAll(".", "\\.")} Marcadores: `,
        ),
      );
    }
    const lider = campoMensagem("Mensagem do link do líder de célula");
    fireEvent.change(lider, { target: { value: "{link} editado" } });
    expect(lider).toHaveValue(modeloLider);
    expect(
      screen.queryByRole("button", { name: /Voltar ao texto padrão/ }),
    ).not.toBeInTheDocument();
    expect(
      within(previa(/mensagem do link do líder de célula/)).getByText(
        /Olá, Ana!/,
      ).textContent,
    ).toBe(
      `Olá, Ana! A Célula Ágape acompanha a rifa por aqui:\n${linkDeExemplo()}`,
    );

    // O resumo "Regras da campanha" continua para a coordenação, com o que está valendo, e leva ao campo.
    expect(linhasDoResumo()).toEqual(
      expect.arrayContaining([
        [
          "Desconsiderar pedidos",
          "Ligado: o admin pode tirar das contas um pedido de teste, fraude ou estorno.",
        ],
        ["Acesso de redes", "Desligado: não entram nem recebem link novo."],
        [
          "Mensagens do link pessoal",
          "1 editada; as outras com o texto padrão.",
        ],
      ]),
    );
    fireEvent.click(screen.getByRole("link", { name: "Acesso de redes" }));
    expect(caixa("Acesso das redes")).toHaveFocus();
  });

  it("o PUT da coordenação não manda os três (nem com um modelo gravado com problema, que não barra o resto); a resposta volta para a tela", async () => {
    const comProblema = {
      ...SALVA,
      // Gravado fora das regras (ex.: antes da RIFA-042): a coordenação não o corrige, e salva o resto.
      mensagens: { ...SALVA.mensagens, link_rede: "Oi {nomee}, sem o link" },
    };
    const { puts } = simularApi({ campanha: comProblema });
    await abrirTela(USUARIO_DE_TESTE);

    fireEvent.change(screen.getByLabelText("Preço do bilhete (R$)"), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText("Alterações salvas.")).toBeInTheDocument();
    expect(puts()).toHaveLength(1);
    const corpo = puts()[0].corpo as Record<string, unknown>;
    expect(corpo).toMatchObject({ preco_bilhete_centavos: 1500 });
    for (const grupo of ["pedidos", "acesso", "mensagens"])
      expect({ grupo, enviado: grupo in corpo }).toEqual({
        grupo,
        enviado: false,
      });
    // A resposta (com os grupos como estão gravados) volta para a tela.
    expect(caixa("Permitir desconsiderar pedidos")).toBeChecked();
    expect(caixa("Acesso das redes")).not.toBeChecked();
    expect(campoMensagem("Mensagem do link da rede")).toHaveValue(
      "Oi {nomee}, sem o link",
    );
  });

  it("o admin muda os três e o PUT dele os manda (o grupo inteiro)", async () => {
    const { puts } = simularApi({ campanha: SALVA });
    await abrirTela(ADMIN_DE_TESTE);

    fireEvent.click(caixa("Permitir desconsiderar pedidos"));
    fireEvent.click(caixa("Acesso das redes"));
    fireEvent.change(campoMensagem("Mensagem do link da coordenação"), {
      target: { value: "{saudacao} Seu acesso:\n{link}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText("Alterações salvas.")).toBeInTheDocument();
    expect(puts()[0].corpo).toMatchObject({
      pedidos: { desconsiderar: false },
      acesso: { discipuladores: true, redes: true, celulas_senha: true },
      mensagens: {
        ...SALVA.mensagens,
        link_coordenacao: "{saudacao} Seu acesso:\n{link}",
      },
    });
  });
});

describe("RIFA-042 (CA3): o modelo com o {link} colado ou com outro endereço é barrado na tela", () => {
  it("?u={link}, x{link} e outro endereço: o problema aparece enquanto digita e o 'Salvar' é barrado, sem chamar a API; os quatro padrões valem", async () => {
    const { puts } = simularApi({ campanha: CONFIGURADA });
    await abrirTela();

    // Os quatro padrões, ao abrir, não têm problema.
    for (const tipo of TIPOS_MENSAGEM)
      expect(
        screen.getByDisplayValue(
          (_valor, elemento) =>
            (elemento as HTMLTextAreaElement | null)?.value ===
            MENSAGENS_PADRAO[tipo],
        ),
      ).not.toHaveAttribute("aria-invalid");

    const COLADO =
      /Deixe o \{link\} no começo da mensagem ou depois de um espaço ou de uma quebra de linha: colado no texto de antes, o link pessoal vira parte de outro endereço\./;
    const ENDERECO =
      /Tire o outro endereço da mensagem \(http:\/\/, www\. ou site\.com\/\): o único link dela é o \{link\}\./;
    const coordenacao = campoMensagem("Mensagem do link da coordenação");
    for (const [modelo, problemas] of [
      [
        "{saudacao} Seu acesso: https://outro.site/?u={link}",
        [COLADO, ENDERECO],
      ],
      ["{saudacao} Seu acesso: ?u={link}", [COLADO]],
      ["{saudacao} Seu acesso: x{link}", [COLADO]],
      ["{saudacao} Veja www.outro.site antes:\n{link}", [ENDERECO]],
    ] as const) {
      fireEvent.change(coordenacao, { target: { value: modelo } });
      expect(coordenacao).toHaveAttribute("aria-invalid", "true");
      for (const problema of problemas)
        expect(coordenacao).toHaveAccessibleDescription(problema);
    }

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    const resumo = await screen.findByRole("alert");
    expect(resumo).toHaveTextContent("Não foi possível salvar. Confira:");
    expect(
      within(resumo).getByRole("link", {
        name: "Mensagem do link da coordenação",
      }),
    ).toBeInTheDocument();
    expect(puts()).toEqual([]);

    // De volta ao padrão, o problema some.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Voltar ao texto padrão da mensagem do link da coordenação",
      }),
    );
    expect(coordenacao).not.toHaveAttribute("aria-invalid");
  });
});
