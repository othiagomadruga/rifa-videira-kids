import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLUNAS_CSV_HIERARQUIA,
  linhaCsvHierarquiaSchema,
} from "../../../shared/contracts";
import { renderizarRota, respostaJson } from "../../test/renderizar";
import { LIMITE_ERROS_NA_TELA } from "./ImportarPlanilha";
import {
  criarApiFalsa,
  criarCelula,
  relatorio,
  respostaErro,
  type ApiFalsa,
} from "./teste-apoio";

const IMPORTAR = "/api/admin/hierarquia/importar";
const CABECALHO = COLUNAS_CSV_HIERARQUIA.join(";");
const CSV = `${CABECALHO}\r\nRede Jovem Norte;jovens;;Ana Discipuladora;Célula Nova;10;Líder Novo;;\r\n`;

function arquivoCsv(conteudo: BlobPart, nome = "hierarquia.csv") {
  return new File([conteudo], nome, { type: "text/csv" });
}

async function abrirImportacao(api: ApiFalsa = criarApiFalsa()) {
  vi.stubGlobal("fetch", api.fetch);
  renderizarRota("/coordenacao/hierarquia");
  fireEvent.click(
    await screen.findByRole("tab", { name: "Importar planilha" }),
  );
  return api;
}

function botao(nome: string) {
  return screen.getByRole("button", { name: nome });
}

/** Escolhe o arquivo e espera a leitura terminar. */
async function escolherArquivo(arquivo: File) {
  fireEvent.change(screen.getByLabelText("Planilha em CSV"), {
    target: { files: [arquivo] },
  });
  await screen.findByText(arquivo.name);
  await waitFor(() =>
    expect(screen.queryByText("Lendo o arquivo…")).not.toBeInTheDocument(),
  );
}

function linhasDe(tabela: HTMLElement): string[][] {
  return within(tabela)
    .getAllByRole("row")
    .slice(1)
    .map((linha) =>
      within(linha)
        .getAllByRole("cell")
        .map((celula) => celula.textContent ?? ""),
    );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CA3: modelo da planilha", () => {
  it("'Baixar modelo' baixa o CSV de public/modelos", async () => {
    await abrirImportacao();

    const link = screen.getByRole("link", { name: "Baixar modelo" });
    expect(link).toHaveAttribute("href", "/modelos/hierarquia-modelo.csv");
    expect(link).toHaveAttribute("download", "hierarquia-modelo.csv");
  });

  it("o modelo tem o cabeçalho do contrato com ';', BOM UTF-8, CRLF e 2 linhas fictícias (jovens e adultos)", () => {
    const arquivos = import.meta.glob<string>(
      "/public/modelos/hierarquia-modelo.csv",
      { query: "?raw", import: "default", eager: true },
    );
    const modelo = arquivos["/public/modelos/hierarquia-modelo.csv"];

    expect(modelo.startsWith("\uFEFF")).toBe(true);
    // Toda quebra de linha é CRLF, inclusive a última.
    expect(modelo.endsWith("\r\n")).toBe(true);
    expect(modelo.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
    const [cabecalho, ...dados] = modelo.slice(1).split("\r\n").slice(0, -1);
    expect(cabecalho).toBe(CABECALHO);
    expect(dados).toHaveLength(2);

    const linhas = dados.map((linha) => {
      const valores = linha.split(";");
      expect(valores).toHaveLength(COLUNAS_CSV_HIERARQUIA.length);
      return linhaCsvHierarquiaSchema.parse(
        Object.fromEntries(
          COLUNAS_CSV_HIERARQUIA.map((coluna, i) => [coluna, valores[i]]),
        ),
      );
    });
    expect(linhas.map((linha) => linha.divisao)).toEqual(["jovens", "adultos"]);
    for (const linha of linhas) {
      expect(linha.rede).toMatch(/Exemplo/);
      expect(linha.celula).toMatch(/Exemplo/);
      expect(linha.lider_email ?? "@example.com").toMatch(/@example\.com$/);
    }
  });
});

describe("CA3: importação em 2 passos", () => {
  it("antes de conferir, Conferir e Importar ficam desabilitados", async () => {
    await abrirImportacao();

    expect(botao("Conferir")).toBeDisabled();
    expect(botao("Importar")).toBeDisabled();
    expect(botao("Importar")).toHaveAccessibleDescription(
      "Primeiro confira a planilha.",
    );
    expect(screen.getByText("Nenhum arquivo escolhido")).toBeInTheDocument();
  });

  it("arquivo que não é UTF-8 avisa para salvar como CSV UTF-8 e não deixa conferir", async () => {
    const api = await abrirImportacao();
    // "Célula" em Windows-1252 (é = 0xE9): bytes inválidos em UTF-8 viram U+FFFD na leitura.
    const latin1 = new Uint8Array([
      ...new TextEncoder().encode(`${CABECALHO}\r\nRede;jovens;;D;C`),
      0xe9,
      ...new TextEncoder().encode("lula;10;L;;\r\n"),
    ]);

    await escolherArquivo(arquivoCsv(latin1, "excel.csv"));

    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("O arquivo não está em UTF-8");
    expect(alerta).toHaveTextContent(/salve como CSV UTF-8/i);
    expect(botao("Conferir")).toBeDisabled();
    expect(api.chamadasA("POST", IMPORTAR)).toHaveLength(0);
  });

  it("arquivo vazio é recusado antes de chamar a API", async () => {
    const api = await abrirImportacao();

    await escolherArquivo(arquivoCsv(" \r\n", "vazio.csv"));

    expect(screen.getByRole("alert")).toHaveTextContent("O arquivo está vazio");
    expect(botao("Conferir")).toBeDisabled();
    expect(api.chamadasA("POST", IMPORTAR)).toHaveLength(0);
  });

  it("Conferir chama a importação com simular=true e mostra o relatório com os erros; Importar continua desabilitado", async () => {
    const api = criarApiFalsa();
    api.proxima(
      "POST",
      IMPORTAR,
      respostaJson(
        relatorio({
          simulado: true,
          total_linhas: 4,
          criados: { redes: 1, discipuladores: 1, celulas: 2 },
          atualizados: { redes: 0, discipuladores: 0, celulas: 1 },
          inalterados: { redes: 1, discipuladores: 0, celulas: 0 },
          erros: [
            {
              linha: 4,
              coluna: "qtd_pessoas",
              mensagem: "Use um número inteiro",
            },
            {
              linha: 5,
              coluna: null,
              mensagem:
                'A célula "Célula Nova" já aparece na linha 2 com dados diferentes (qtd_pessoas)',
            },
          ],
        }),
      ),
    );
    await abrirImportacao(api);

    await escolherArquivo(arquivoCsv(CSV));
    fireEvent.click(botao("Conferir"));

    const resultado = await screen.findByRole("region", {
      name: "Resultado da conferência",
    });
    expect(api.chamadasA("POST", IMPORTAR)).toEqual([
      { metodo: "POST", caminho: IMPORTAR, corpo: { csv: CSV, simular: true } },
    ]);
    expect(resultado).toHaveFocus();
    expect(resultado).toHaveAccessibleDescription(/A planilha tem 2 erros/);
    expect(resultado).toHaveTextContent("Nada foi gravado.");
    expect(resultado).toHaveTextContent(
      "4 linhas lidas. As contagens consideram só as linhas sem erro.",
    );
    expect(
      linhasDe(
        within(resultado).getByRole("table", {
          name: "O que a importação vai fazer",
        }),
      ),
    ).toEqual([
      ["Redes", "1", "0", "1"],
      ["Discipuladores", "1", "0", "0"],
      ["Células", "2", "1", "0"],
    ]);
    const erros = within(resultado).getByRole("table", {
      name: "Erros por linha",
    });
    expect(
      within(erros)
        .getAllByRole("columnheader")
        .map((cabecalho) => cabecalho.textContent),
    ).toEqual(["Linha", "Coluna", "Mensagem"]);
    expect(linhasDe(erros)).toEqual([
      ["Linha 4", "qtd_pessoas", "Use um número inteiro"],
      [
        "Linha 5",
        "Linha inteira",
        'A célula "Célula Nova" já aparece na linha 2 com dados diferentes (qtd_pessoas)',
      ],
    ]);
    expect(botao("Importar")).toBeDisabled();
    expect(botao("Importar")).toHaveAccessibleDescription(
      "Corrija os erros da planilha e confira de novo.",
    );
  });

  it("sem erros, Importar chama simular=false, mostra o resultado e recarrega as tabelas", async () => {
    const api = criarApiFalsa();
    const contagem = {
      total_linhas: 1,
      criados: { redes: 0, discipuladores: 0, celulas: 1 },
      inalterados: { redes: 1, discipuladores: 1, celulas: 0 },
    };
    api.proxima(
      "POST",
      IMPORTAR,
      respostaJson(relatorio({ ...contagem, simulado: true })),
    );
    api.proxima("POST", IMPORTAR, () => {
      // O que a importação gravou aparece na próxima leitura das listas.
      const ana = api.dados.discipuladores[0];
      api.dados.celulas.push(criarCelula(105, "Célula Nova", ana));
      return respostaJson(
        relatorio({ ...contagem, simulado: false, aplicado: true }),
      );
    });
    await abrirImportacao(api);
    // O modelo salvo pelo Excel tem BOM: a leitura em UTF-8 tira o BOM antes de enviar.
    await escolherArquivo(arquivoCsv(`\uFEFF${CSV}`));

    fireEvent.click(botao("Conferir"));
    expect(
      await screen.findByText("Nenhum erro encontrado"),
    ).toBeInTheDocument();
    expect(botao("Importar")).toBeEnabled();
    const leiturasAntes = api.chamadasA("GET", "/api/admin/celulas").length;

    fireEvent.click(botao("Importar"));

    const resultado = await screen.findByRole("region", {
      name: "Resultado da importação",
    });
    expect(api.chamadasA("POST", IMPORTAR).map((c) => c.corpo)).toEqual([
      { csv: CSV, simular: true },
      { csv: CSV, simular: false },
    ]);
    expect(resultado).toHaveFocus();
    expect(resultado).toHaveAccessibleDescription(/Planilha importada/);
    expect(
      linhasDe(
        within(resultado).getByRole("table", { name: "O que foi gravado" }),
      ),
    ).toEqual([
      ["Redes", "0", "0", "1"],
      ["Discipuladores", "0", "0", "1"],
      ["Células", "1", "0", "0"],
    ]);
    // Não dá para importar duas vezes a mesma conferência.
    expect(botao("Importar")).toBeDisabled();
    await waitFor(() =>
      expect(api.chamadasA("GET", "/api/admin/celulas").length).toBe(
        leiturasAntes + 1,
      ),
    );

    fireEvent.click(
      within(resultado).getByRole("button", { name: "Ver células" }),
    );
    expect(screen.getByRole("tab", { name: "Células" })).toHaveFocus();
    expect(
      await screen.findByRole("cell", { name: "Célula Nova" }),
    ).toBeInTheDocument();
  });

  it("400 csv_invalido mostra a mensagem da API", async () => {
    const api = criarApiFalsa();
    api.proxima(
      "POST",
      IMPORTAR,
      respostaErro(
        400,
        "csv_invalido",
        "Faltam colunas obrigatórias no cabeçalho (linha 1): qtd_pessoas",
        { motivo: "colunas_faltando", colunas: ["qtd_pessoas"] },
      ),
    );
    await abrirImportacao(api);
    await escolherArquivo(arquivoCsv("rede;divisao\r\nRede;jovens\r\n"));

    fireEvent.click(botao("Conferir"));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível conferir a planilha");
    expect(alerta).toHaveTextContent(
      "Faltam colunas obrigatórias no cabeçalho (linha 1): qtd_pessoas",
    );
    expect(alerta.parentElement).toHaveFocus();
    expect(botao("Importar")).toBeDisabled();
  });

  it("escolher outro arquivo recomeça: o relatório some e Importar desabilita", async () => {
    const api = criarApiFalsa();
    api.proxima(
      "POST",
      IMPORTAR,
      respostaJson(relatorio({ total_linhas: 1, simulado: true })),
    );
    await abrirImportacao(api);
    await escolherArquivo(arquivoCsv(CSV, "primeiro.csv"));
    fireEvent.click(botao("Conferir"));
    await screen.findByRole("region", { name: "Resultado da conferência" });
    expect(botao("Importar")).toBeEnabled();

    await escolherArquivo(arquivoCsv(CSV, "segundo.csv"));

    expect(
      screen.queryByRole("region", { name: "Resultado da conferência" }),
    ).not.toBeInTheDocument();
    expect(botao("Importar")).toBeDisabled();
    expect(botao("Conferir")).toBeEnabled();
  });

  it(`mostra no máximo ${LIMITE_ERROS_NA_TELA} erros e diz quantos são`, async () => {
    const api = criarApiFalsa();
    const erros = Array.from({ length: LIMITE_ERROS_NA_TELA + 5 }, (_, i) => ({
      linha: i + 2,
      coluna: "celula" as const,
      mensagem: "Preencha esta coluna",
    }));
    api.proxima(
      "POST",
      IMPORTAR,
      respostaJson(relatorio({ total_linhas: erros.length, erros })),
    );
    await abrirImportacao(api);
    await escolherArquivo(arquivoCsv(CSV));

    fireEvent.click(botao("Conferir"));

    const tabela = await screen.findByRole("table", {
      name: "Erros por linha",
    });
    expect(within(tabela).getAllByRole("row")).toHaveLength(
      LIMITE_ERROS_NA_TELA + 1,
    );
    expect(
      screen.getByText(
        `Mostrando os primeiros ${LIMITE_ERROS_NA_TELA} de ${LIMITE_ERROS_NA_TELA + 5} erros.`,
      ),
    ).toBeInTheDocument();
  });
});
